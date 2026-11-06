import { createHash } from 'node:crypto';
import type {
  LogoRow,
  MarketRepository,
} from '../modules/market-data/infrastructure/market.repository.js';

// Os logos sintéticos do e2e (ADR 0036, "Como o site mostra"): o seed do e2e (`arena:ensaio --logos-sinteticos`, o que o e2e:seed e o
// playwright.config.ts rodam) grava, DEPOIS do relatório, que não os vê, um SVG desenhado aqui para dois papéis do mercado sintético. São
// formas simples, de marca nenhuma: nenhum SVG da brapi entra no repositório. O resto dos papéis fica sem logo (o monograma do site).
// O MOVE3 é como 300 dos 357 logos da brapi: `width` e `height` numéricos na raiz e nenhum `viewBox`, que a rota do site põe (sem ele o
// desenho não encolhe num <img> pequeno: o de 16 px mostraria só o canto verde, e não o disco branco no meio). O SINA3 já traz o viewBox.
export const SYNTHETIC_LOGOS = {
  MOVE3:
    '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><path fill="#2f6f4f" d="M0 0h56v56H0z"/><circle cx="28" cy="28" r="12" fill="#fff"/></svg>',
  SINA3:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#3a5fcd" d="M0 0h32v32H0z"/><path fill="#fff" d="M8 9h16v3H8zm0 5.5h16v3H8zM8 20h16v3H8z"/></svg>',
} as const;

// Grava os logos como a passada da atualização semanal grava um logo baixado (o SHA-256 e o tamanho dos bytes), pelo mesmo repositório; o
// papel que o banco não tem fica de fora. Devolve os tickers gravados.
export async function seedSyntheticLogos(
  repository: Pick<MarketRepository, 'logoTargets' | 'saveLogo'>,
  fetchedAt: Date,
): Promise<string[]> {
  const targets = await repository.logoTargets(Object.keys(SYNTHETIC_LOGOS));
  for (const { instrumentId, ticker } of targets) {
    const svg = SYNTHETIC_LOGOS[ticker as keyof typeof SYNTHETIC_LOGOS];
    const row: LogoRow = {
      instrumentId,
      sourceUrl: `https://example.test/e2e/logos/${ticker}.svg`,
      svg,
      sha256: createHash('sha256').update(svg).digest('hex'),
      bytes: Buffer.byteLength(svg),
      fetchedAt,
    };
    await repository.saveLogo(row);
  }
  return targets.map(({ ticker }) => ticker);
}
