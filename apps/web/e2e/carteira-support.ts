import { expect, type APIRequestContext } from '@playwright/test';
import { envelopeSchema, portfolioSchema, type Portfolio } from '@alvesting/contracts';
import { FRONT_DOOR_URL } from './api-server';

// Apoio dos e2e da carteira (carteira.spec.ts e carteira-layout.spec.ts; docs/TELAS.md, seção 9). Tudo sintético: os tickers são os do mercado do
// ensaio (MOVE3, SINA3, PAUS3...) e a pessoa é uma conta @example.test. Uma spec não importa a outra (o Playwright não deixa), por isso isto mora aqui.

// A mutação da api confere que o Origin é o do site (o Front Door imitado).
export const ORIGIN = { origin: FRONT_DOOR_URL };

// A carteira como a api a devolve, validada pelo contrato: é o que a tela tem de mostrar.
export async function wallet(request: APIRequestContext): Promise<Portfolio> {
  const response = await request.get('/api/v1/me/portfolio');
  expect(response.status()).toBe(200);
  const body = envelopeSchema(portfolioSchema).parse(await response.json());
  if (!body.success) throw new Error('GET /api/v1/me/portfolio falhou');
  return body.data;
}

export interface NewLot {
  ticker: string;
  quantity: number;
  mode: 'unit' | 'total';
  valueCents: number;
  boughtOn?: string;
}

// Um lançamento pela api, com a sessão do jar: para montar o estado de um teste sem passar pelo formulário (que tem os testes dele).
export async function addLot(request: APIRequestContext, lot: NewLot): Promise<void> {
  const response = await request.post('/api/v1/me/portfolio/lots', { headers: ORIGIN, data: lot });
  expect(response.status(), await response.text()).toBe(201);
}
