import { readFileSync } from 'node:fs';
import type { BlobServiceClient } from '@azure/storage-blob';
import { Secret } from '../../config/secret.js';
import { createSimClock, type SimClock } from '../../ensaio/bus.js';
import { FIRST_DAY } from '../../ensaio/driver.js';
import { FAKE_TOKEN, createFakeBrapi } from '../../ensaio/fake-brapi.js';
import { createSgsFetch, cvmDocuments } from '../../ensaio/feeds.js';
import { buildMarket } from '../../ensaio/market.js';
import { assembleWorld, prefixedBlob } from '../../ensaio/world.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { createFakeFetch } from '../../modules/arena/infrastructure/fake-llm.js';
import { addDays, brasiliaDate, brasiliaInstant } from '../../modules/market-data/domain/dates.js';
import { loadTradingCalendar } from '../../modules/market-data/domain/trading-calendar.js';
import { BcbFetcher } from '../../modules/news/application/bcb-fetcher.js';
import { cvmDraft } from '../../modules/news/domain/draft.js';
import { localPieces, type LoadedPrompt, type LocalMode } from '../pieces.js';
import { parseDatedSeasonFile, type DatedSeasonFile } from '../plan.js';
import type { RetroSources } from '../retro.js';

// O retroativo e o operador local nos testes: as peças de verdade (localPieces), trocando só o que sairia da máquina pelos substitutos do
// ensaio (a brapi falsa, o provedor fake, o SGS sintético, a CVM sintética e as fontes de notícia vazias). Só os testes importam este arquivo.

// Os arquivos dos testes ficam em containers "rt-<banco de teste>-" do Azurite: nunca nos "temporada-" da temporada de verdade, e cada
// execução com o seu TEST_DATABASE_URL tem os seus (duas execuções ao mesmo tempo, em bancos diferentes, não apagam os arquivos uma da outra).
export const PREFIX = `rt-${(process.env.TEST_DATABASE_URL ?? 'x/sem_banco')
  .split('/')
  .at(-1)!
  .split('?')[0]!
  .replace(/[^a-z0-9]+/g, '-')}-`;
export const calendar = loadTradingCalendar();
export const market = buildMarket({
  seed: 1,
  stocks: 12,
  firstDay: FIRST_DAY,
  sessions: 5,
  calendar,
});
export const LAST = market.sessionDays.at(-1)!;
// o "hoje" das fontes: dois dias depois do último pregão, quando a brapi falsa e o SGS sintético já têm tudo
export const after = createSimClock(brasiliaInstant(addDays(LAST, 2), '12:00'));
export const TODAY = brasiliaDate(after.now());

// hora de Brasília de um pregão, com segundos
export const brt = (date: string, hhmm: string, seconds = 0): Date =>
  new Date(brasiliaInstant(date, hhmm).getTime() + seconds * 1000);

// a temporada sintética do ensaio (os seis modelos com estratégias fake), com a data fixa do primeiro pregão
export function seasonFile(overrides: Record<string, unknown> = {}): DatedSeasonFile {
  const raw = JSON.parse(
    readFileSync(new URL('../../../seasons/ensaio.json', import.meta.url), 'utf8'),
  ) as { params: Record<string, unknown> };
  return parseDatedSeasonFile({
    ...raw,
    slug: 'temporada-teste',
    name: 'Temporada de teste',
    startDate: FIRST_DAY,
    params: { ...raw.params, sessions: 5 },
    ...overrides,
  });
}

// O provedor fake, contando as chamadas: o modelo, o texto do sistema (o prompt) e, se o teste pede, um custo informado por chamada.
export function countingLlm(options: { costUsd?: number; onCall?: (count: number) => void } = {}) {
  const fake = createFakeFetch();
  const calls: Array<{ model: string; system: string }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    calls.push({
      model: body.model,
      system: body.messages.find((m) => m.role === 'system')?.content ?? '',
    });
    const response = await fake(input, init);
    options.onCall?.(calls.length);
    if (options.costUsd === undefined) return response;
    const json = (await response.json()) as { usage: Record<string, unknown> };
    json.usage.cost = options.costUsd;
    return new Response(JSON.stringify(json), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchFn };
}

// Um processo do retroativo ou do operador: o motor montado de novo, como numa execução nova do comando.
export function localWorld(input: {
  prisma: PrismaService;
  blob: BlobServiceClient;
  prompt: LoadedPrompt;
  llm: typeof fetch;
  mode: LocalMode;
  env?: { ARENA_MONTHLY_COST_CAP_USD?: string };
  clock?: SimClock;
}) {
  const brapi = createFakeBrapi({ market, clock: after });
  const quiet = { run: () => Promise.resolve({}) } as never;
  const pieces = localPieces({
    prisma: input.prisma,
    calendar,
    clock: input.clock ?? createSimClock(new Date(0)),
    blob: input.blob,
    env: {
      BRAPI_TOKEN: undefined,
      OPENROUTER_API_KEY: undefined,
      ARENA_MONTHLY_COST_CAP_USD: input.env?.ARENA_MONTHLY_COST_CAP_USD,
    },
    prompt: input.prompt,
    mode: input.mode,
  });
  const world = assembleWorld({
    ...pieces,
    files: prefixedBlob(input.blob, PREFIX),
    brapi: { token: FAKE_TOKEN, fetch: brapi.fetch, sleep: () => Promise.resolve() },
    llm: {
      env: { OPENROUTER_API_KEY: new Secret('chave-de-teste'), AZURE_OPENAI_ENDPOINT: undefined },
      fetch: input.llm,
    },
    // o operador: as fontes de notícia não saem da máquina (nada novo), e a semana não busca logo
    ...(input.mode === 'retroativo'
      ? {}
      : { news: () => ({ rss: quiet, cvm: quiet, bcb: quiet }), weekly: {} }),
  });
  const docs = cvmDocuments(market);
  const sources: RetroSources = {
    bars: (from, to) => world.backfill.run({ from, to, today: TODAY, fetch: true }),
    bcb: new BcbFetcher(
      world.macroRepo,
      createSgsFetch({ now: () => after.now(), calendar, seed: 1 }),
    ),
    // a CVM sintética com o mesmo contrato da de verdade (CvmFetcher.backfill): cada documento com a hora da regra, só os vistos até o horizonte
    cvm: {
      backfill: async (window) => {
        for (const doc of docs) {
          const seen = window.seenAt(doc.deliveredOn);
          if (doc.deliveredOn < window.from || doc.deliveredOn > window.to) continue;
          if (seen > window.horizon) continue;
          const draft = cvmDraft(doc, [doc.ticker], seen);
          if (draft) await world.newsRepo.saveNews([draft], seen);
        }
      },
    },
  };
  return { world, sources, brapi };
}

// Apaga os arquivos que os testes deixaram no Azurite.
export async function clearTestBlobs(blob: BlobServiceClient): Promise<void> {
  for await (const container of blob.listContainers({ prefix: PREFIX })) {
    const client = blob.getContainerClient(container.name);
    for await (const item of client.listBlobsFlat()) await client.deleteBlob(item.name);
  }
}
