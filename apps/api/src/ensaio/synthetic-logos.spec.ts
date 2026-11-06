import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { svgRefusal } from '../modules/market-data/domain/svg-check.js';
import type { LogoRow } from '../modules/market-data/infrastructure/market.repository.js';
import { SYNTHETIC_LOGOS, seedSyntheticLogos } from './synthetic-logos.js';

// Os logos que o seed do e2e grava depois do ensaio (`arena:ensaio --logos-sinteticos`, o que o e2e:seed e o playwright.config.ts rodam): dois
// papéis do mercado sintético com um SVG desenhado aqui, formas simples e de marca nenhuma, para o e2e provar a rota do site e o componente
// (apps/web/e2e/logos.spec.ts). Nenhum SVG da brapi entra no repositório.
describe('os logos sintéticos do e2e', () => {
  it('são de dois papéis do mercado sintético, e o validador dos logos de verdade aceita os dois', () => {
    expect(Object.keys(SYNTHETIC_LOGOS)).toEqual(['MOVE3', 'SINA3']);
    for (const [ticker, svg] of Object.entries(SYNTHETIC_LOGOS)) {
      expect(svgRefusal(svg), ticker).toBeNull();
    }
  });

  // A rota do site põe o viewBox no SVG que não tem (300 dos 357 da brapi): o MOVE3 é como eles, e o SINA3 já traz o dele.
  it('um sem viewBox, com width e height numéricos na raiz, como os da brapi; o outro com viewBox', () => {
    expect(SYNTHETIC_LOGOS.MOVE3).toMatch(/^<svg [^>]*width="56" height="56"[^>]*>/);
    expect(SYNTHETIC_LOGOS.MOVE3).not.toMatch(/viewBox/i);
    expect(SYNTHETIC_LOGOS.SINA3).toMatch(/^<svg [^>]*viewBox="0 0 32 32"[^>]*>/);
  });

  it('grava cada um como a passada grava o logo baixado (o SHA-256 e o tamanho dos bytes) e pula o papel que o banco não tem', async () => {
    const saved: LogoRow[] = [];
    const repository = {
      logoTargets: vi.fn((_tickers: readonly string[]) =>
        Promise.resolve([
          { instrumentId: '01JZSINA3000000000000000AA', ticker: 'SINA3', stored: null },
        ]),
      ),
      saveLogo: vi.fn((row: LogoRow) => {
        saved.push(row);
        return Promise.resolve();
      }),
    };
    const at = new Date('2026-11-03T12:00:00Z');

    await expect(seedSyntheticLogos(repository, at)).resolves.toEqual(['SINA3']);
    expect(repository.logoTargets).toHaveBeenCalledWith(['MOVE3', 'SINA3']);
    const svg = SYNTHETIC_LOGOS.SINA3;
    expect(saved).toEqual([
      {
        instrumentId: '01JZSINA3000000000000000AA',
        sourceUrl: 'https://example.test/e2e/logos/SINA3.svg',
        svg,
        sha256: createHash('sha256').update(svg).digest('hex'),
        bytes: Buffer.byteLength(svg),
        fetchedAt: at,
      },
    ]);
  });
});
