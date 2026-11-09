import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlobServiceClient } from '@azure/storage-blob';
import type { Env } from '../config/env.js';
import { Secret } from '../config/secret.js';
import type { SimClock } from '../ensaio/bus.js';
import { prefixedBlob, type WorldPieces } from '../ensaio/world.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import { hasCanary } from '../modules/arena/domain/leak-filter.js';
import { sha256Hex } from '../modules/briefing/domain/canonical-json.js';
import { LogoRefresh } from '../modules/market-data/application/logo-refresh.js';
import type { TradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { MarketRepository } from '../modules/market-data/infrastructure/market.repository.js';
import { BcbFetcher } from '../modules/news/application/bcb-fetcher.js';
import { CvmFetcher } from '../modules/news/application/cvm-fetcher.js';
import { RssFetcher } from '../modules/news/application/rss-fetcher.js';
import { BCB_HOST } from '../modules/news/domain/bcb.js';
import { CVM_HOST } from '../modules/news/domain/cvm.js';
import { NEWS_SOURCES } from '../modules/news/domain/sources.js';
import { retroBriefingReads } from './visibility.js';

// As peças REAIS do motor do ensaio (src/ensaio/world.ts) para o arena:retroativo e o operador local (ADR 0038): a brapi, a CVM, o BCB, o RSS,
// o OpenRouter e o Azurite de verdade, cada uma só onde o modo pede.

// A lista branca do guarda de rede (src/ensaio/network-guard.ts): só estes hosts, exatos, e o loopback (o Postgres e o Azurite). O retroativo
// fala com o OpenRouter, a brapi, a CVM e o BCB; o operador também com os quatro feeds RSS da lista fixa e com o icons.brapi.dev (os logos da
// semana). O resto é bloqueado e vai para o log.
export const RETRO_HOSTS: readonly string[] = ['openrouter.ai', 'brapi.dev', CVM_HOST, BCB_HOST];
export const OPERATOR_HOSTS: readonly string[] = [
  ...RETRO_HOSTS,
  'icons.brapi.dev',
  ...NEWS_SOURCES.flatMap((source) =>
    source.kind === 'rss' ? [new URL(source.url).hostname] : [],
  ),
];

// Os containers do Azurite da temporada local: fora dos de dev (briefings, llm-io) e dos do ensaio (ensaio-).
export const TEMPORADA_CONTAINER_PREFIX = 'temporada-';

// O relógio da máquina, no formato do relógio simulado (o barramento e os handlers não sabem a diferença); `set` não faz nada.
export const realClock: SimClock = { now: () => new Date(), set: () => undefined };

// O fetch de verdade, resolvido na hora de cada chamada: assim ele passa pelo guarda de rede, que troca o fetch global depois da montagem.
const network: typeof fetch = (input, init) => globalThis.fetch(input, init);

export type LocalMode = 'retroativo' | 'ao-vivo' | 'so-dados';

export interface LoadedPrompt {
  text: Secret;
  sha256: string;
  // a versão que o ciclo fixa em prompt_version: a PROMPT_ARENA_VERSION, se veio, ou os 32 primeiros hexadecimais do SHA-256
  version: string;
}

const MAX_PROMPT_CHARS = 25_600;

// O prompt da arena, de PROMPT_ARENA (já um Secret do parseEnv) ou de PROMPT_ARENA_FILE (o caminho de um arquivo FORA do git: fora do
// repositório, ou em .data/, que o git ignora). Um dos dois, nunca os dois. O texto não vai a log nem a mensagem de erro: os erros dizem só a
// regra. O canário é exigido aqui, antes de qualquer ciclo, como o job de decisões exige (docs/ARENA.md, seção 6).
export async function loadPrompt(input: {
  env: Pick<Env, 'PROMPT_ARENA' | 'PROMPT_ARENA_VERSION'>;
  file: string | undefined;
  repoRoot: string;
}): Promise<LoadedPrompt> {
  const { env, file, repoRoot } = input;
  if (env.PROMPT_ARENA && file) {
    throw new Error('Use PROMPT_ARENA ou PROMPT_ARENA_FILE, não os dois');
  }
  let text: string;
  if (env.PROMPT_ARENA) {
    text = env.PROMPT_ARENA.reveal();
  } else if (file) {
    const resolved = path.resolve(file);
    const inside = (dir: string) => !path.relative(dir, resolved).startsWith('..');
    if (inside(repoRoot) && !inside(path.join(repoRoot, '.data'))) {
      throw new Error(
        'PROMPT_ARENA_FILE aponta para dentro do repositório: o prompt fica fora do git (fora do repositório ou em .data/)',
      );
    }
    try {
      text = await readFile(resolved, 'utf8');
    } catch {
      throw new Error('Não consegui ler o arquivo de PROMPT_ARENA_FILE');
    }
  } else {
    throw new Error(
      'Defina PROMPT_ARENA ou PROMPT_ARENA_FILE (o caminho de um arquivo fora do git)',
    );
  }
  if (text.trim() === '' || text.length > MAX_PROMPT_CHARS) {
    throw new Error(`O prompt tem de ter de 1 a ${MAX_PROMPT_CHARS} caracteres`);
  }
  if (!hasCanary(text)) {
    throw new Error(
      'O prompt não tem a linha de canário (alv-canary-<16 a 64 letras minúsculas ou dígitos): docs/ARENA.md, seção 6',
    );
  }
  const sha256 = sha256Hex(Buffer.from(text, 'utf8'));
  return {
    text: new Secret(text),
    sha256,
    version: env.PROMPT_ARENA_VERSION ?? sha256.slice(0, 32),
  };
}

// As peças de cada modo. O retroativo: relógio simulado, sem a fila news (as fontes ele lê de uma vez, antes dos pregões: retro.ts), sem a
// atualização semanal da brapi (o universo das semanas passadas sai do banco), o macro filtrado pela regra de visibilidade e o ciclo
// RETROATIVO. O operador: relógio da máquina, as fontes de verdade pela fila, os logos da semana e o ciclo AO_VIVO; no `--so-dados`, sem a
// liquidação depois do eod (ele só coleta: quem decide e liquida o pregão é o retroativo).
export function localPieces(input: {
  prisma: PrismaService;
  calendar: TradingCalendar;
  clock: SimClock;
  blob: BlobServiceClient;
  env: Pick<Env, 'BRAPI_TOKEN' | 'OPENROUTER_API_KEY' | 'ARENA_MONTHLY_COST_CAP_USD'>;
  prompt: LoadedPrompt;
  mode: LocalMode;
}): WorldPieces {
  const { prisma, calendar, clock, env, prompt, mode } = input;
  const retro = mode === 'retroativo';
  const offQueue = () =>
    Promise.reject(
      new Error('O retroativo não busca fonte pela fila news (retro.ts lê as fontes antes)'),
    );
  return {
    prisma,
    calendar,
    clock,
    files: prefixedBlob(input.blob, TEMPORADA_CONTAINER_PREFIX),
    brapi: { token: env.BRAPI_TOKEN?.reveal(), fetch: network },
    ...(retro ? {} : { weekly: { logos: new LogoRefresh(new MarketRepository(prisma), network) } }),
    news: ({ news, macro }) =>
      retro
        ? { rss: { run: offQueue }, cvm: { run: offQueue }, bcb: { run: offQueue } }
        : {
            rss: new RssFetcher(news, network),
            cvm: new CvmFetcher(news, network),
            bcb: new BcbFetcher(macro, network),
          },
    ...(retro ? { briefingReads: (repo) => retroBriefingReads(repo, calendar) } : {}),
    llm: { env: { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, AZURE_OPENAI_ENDPOINT: undefined } },
    prompt: { text: prompt.text, version: prompt.version },
    monthlyCostCapUsd: env.ARENA_MONTHLY_COST_CAP_USD,
    ...(retro ? { cycleMode: () => 'RETROATIVO' as const } : {}),
    settleAfterEod: mode !== 'so-dados',
    sleep: retro
      ? (ms) => {
          clock.set(new Date(clock.now().getTime() + ms));
          return Promise.resolve();
        }
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

// Para o retroativo, as buscas que ele faz de uma vez, fora da fila: o BCB e a CVM com o fetch de verdade.
export function retroFetchers(world: {
  newsRepo: ConstructorParameters<typeof CvmFetcher>[0];
  macroRepo: ConstructorParameters<typeof BcbFetcher>[0];
}): { cvm: CvmFetcher; bcb: BcbFetcher } {
  return {
    cvm: new CvmFetcher(world.newsRepo, network),
    bcb: new BcbFetcher(world.macroRepo, network),
  };
}
