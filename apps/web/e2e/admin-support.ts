import { execFile } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, type APIRequestContext } from '@playwright/test';
import { registerVerifiedUser, test as base, type User } from './account-support';
import { ADMIN_BUS_DIR, E2E_DATABASE_URL } from './api-server';

// Apoio dos e2e do painel de admin (etapa 10, parte 2; docs/TELAS.md, seção 8). Tudo sintético: e-mails @example.test, mensagens inventadas
// e o Service Bus FALSO (uma pasta; apps/api/src/modules/messaging/infrastructure/fake-service-bus.ts). Nada vai à rede nem à Azure.
const API_DIR = fileURLToPath(new URL('../../api/', import.meta.url));

// O papel admin só nasce pelo comando account:promote (nenhuma rota HTTP o troca): o e2e roda o comando de verdade, o `dist` da api, contra o
// banco do e2e. A saída leva só o ULID da conta, nunca o e-mail.
export async function promote(address: string): Promise<void> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--enable-source-maps', 'dist/account-cli.js', 'promote', address],
    { cwd: API_DIR, env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL } },
  );
  expect(stdout).toMatch(/promovida a admin|já era admin/);
}

// Uma conta pronta para entrar (cadastro, e-mail verificado), promovida a admin pelo comando.
export async function registerAdmin(
  request: APIRequestContext,
  ip: string,
  label: string,
): Promise<User> {
  const user = await registerVerifiedUser(request, ip, label);
  await promote(user.email);
  return user;
}

// Um pregão de 2100 a 2199 que nenhum outro teste usa: o MessageId (`eod:2143-03-14`) precisa ser único por teste, porque os três projetos
// rodam juntos na mesma pasta de DLQ (36.500 datas: uma colisão entre seis mensagens é rara demais para valer um contador).
export const uniqueEodDate = (): string =>
  new Date(Date.UTC(2100, 0, 1) + randomInt(36_500) * 86_400_000).toISOString().slice(0, 10);

async function writeDead(queue: string, record: Record<string, unknown>): Promise<void> {
  const dir = path.join(ADMIN_BUS_DIR, queue, 'dead');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${Date.now()}-${randomInt(1e9)}.json`),
    JSON.stringify({
      deliveryCount: 10,
      deadLetterReason: 'max_attempts_exceeded',
      deadLetterErrorDescription: 'O handler falhou em 10 tentativas',
      enqueuedTimeUtc: '2026-11-04T00:30:00.000Z',
      ...record,
    }),
  );
}

// Uma mensagem `eod` na DLQ da fila `market`, como o broker a deixa depois de 10 entregas.
export async function seedDeadLetter(date = uniqueEodDate()): Promise<{ messageId: string }> {
  const messageId = `eod:${date}`;
  await writeDead('market', { messageId, body: { type: 'eod', date } });
  return { messageId };
}

// Um ULID de mentira: 26 caracteres do alfabeto de Crockford, o primeiro de 0 a 7 (a forma que o contrato aceita).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const fakeUlid = (): string =>
  `${randomInt(8)}${Array.from({ length: 25 }, () => CROCKFORD[randomInt(32)]).join('')}`;

// Uma mensagem `decide` na DLQ da fila `decisions`, com o MessageId de verdade: `decide:<ciclo>:<competidor>`, 60 caracteres SEM espaço. É
// o que mais chega à DLQ (a fila `decisions` tem 3 entregas) e a palavra mais larga que o painel mostra: a tela de 360 px tem de a
// quebrar dentro da caixa, e não alargar a página (o e2e do layout semeia esta). Um id novo por teste: os três projetos dividem a pasta.
export async function seedLongDeadLetter(): Promise<{ messageId: string }> {
  const cycleId = fakeUlid();
  const competitorId = fakeUlid();
  const messageId = `decide:${cycleId}:${competitorId}`;
  await writeDead('decisions', {
    messageId,
    body: { type: 'decide', cycleId, competitorId },
    deliveryCount: 3,
  });
  return { messageId };
}

// Os messageId que ainda estão na DLQ de uma fila, e os que a api publicou nela. Os três projetos mexem na mesma pasta ao mesmo tempo: o
// arquivo que sumiu (reenviado por outro teste) ou que ainda está sendo escrito entre o `readdir` e o `readFile` fica fora da leitura.
async function readBox(queue: string, box: 'dead' | 'active'): Promise<string[]> {
  const dir = path.join(ADMIN_BUS_DIR, queue, box);
  const names = await readdir(dir).catch(() => [] as string[]);
  const ids: string[] = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      const record = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as {
        messageId: string;
      };
      ids.push(record.messageId);
    } catch {
      // some ou está pela metade
    }
  }
  return ids;
}
export const deadLetters = (queue: string) => readBox(queue, 'dead');
export const published = (queue: string) => readBox(queue, 'active');

// Tira da DLQ a mensagem que o teste semeou e ninguém reenviou. O painel lista as 20 primeiras da DLQ, da mais antiga à mais nova: o que
// um teste deixa para trás empurra a mensagem do teste seguinte para fora da lista.
export async function removeDeadLetter(messageId: string, queue = 'market'): Promise<void> {
  const dir = path.join(ADMIN_BUS_DIR, queue, 'dead');
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    try {
      const record = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as {
        messageId: string;
      };
      if (record.messageId === messageId) await rm(path.join(dir, name), { force: true });
    } catch {
      // some ou está pela metade
    }
  }
}

// O teste de admin: o `test` da conta mais a mensagem na DLQ falsa, semeada antes do teste e removida depois (se o teste não a reenviou).
// `longDeadLetter` é a `decide` com o MessageId de 60 caracteres (só o e2e do layout a pede).
export const test = base.extend<{
  deadLetter: { messageId: string };
  longDeadLetter: { messageId: string };
}>({
  // eslint-disable-next-line no-empty-pattern -- o Playwright exige o objeto de dependências, mesmo vazio
  deadLetter: async ({}, provide) => {
    const dead = await seedDeadLetter();
    await provide(dead);
    await removeDeadLetter(dead.messageId);
  },
  // eslint-disable-next-line no-empty-pattern -- o Playwright exige o objeto de dependências, mesmo vazio
  longDeadLetter: async ({}, provide) => {
    const dead = await seedLongDeadLetter();
    await provide(dead);
    await removeDeadLetter(dead.messageId, 'decisions');
  },
});

// O arquivo da temporada (o mesmo do season:create) mais curto que serve: um modelo fake, o Sorteio e as três referências.
export function seasonFile(slug: string, name = `Temporada do e2e ${slug}`) {
  return {
    slug,
    name,
    params: { randomSeed: 'e2e-sorteio', monteCarloSeed: 'e2e-monte-carlo' },
    competitors: [
      {
        kind: 'MODEL',
        slug: 'fake-e2e',
        name: 'Fake do e2e',
        provider: 'fake',
        modelId: 'fake/e2e',
        capabilities: { jsonSchema: false, reasoningEffort: false },
      },
      { kind: 'RANDOM', slug: 'sorteio', name: 'Sorteio' },
      { kind: 'BENCHMARK', slug: 'igual-peso', name: 'Igual-peso', benchmark: 'EQUAL_WEIGHT' },
      { kind: 'BENCHMARK', slug: 'cdi', name: 'CDI', benchmark: 'CDI' },
      { kind: 'BENCHMARK', slug: 'bova11', name: 'BOVA11', benchmark: 'BOVA11' },
    ],
  };
}

// Um slug por teste e por projeto (os três rodam juntos no mesmo banco, e o slug é único).
export const uniqueSlug = (label: string): string =>
  `e2e-${label}-${Date.now().toString(36)}-${randomInt(1e6).toString(36)}`;
