import { describe, expect, it } from 'vitest';
import { loadTradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { buildMarket } from './market.js';
import { brl, pct, plannedBrapiRequests } from './report.js';

describe('brl: dinheiro em centavos, sem float', () => {
  it('formata reais com milhar e vírgula', () => {
    expect(brl(0n)).toBe('R$ 0,00');
    expect(brl(5n)).toBe('R$ 0,05');
    expect(brl(100n)).toBe('R$ 1,00');
    expect(brl(10_000_000n)).toBe('R$ 100.000,00');
    expect(brl(123_456_789n)).toBe('R$ 1.234.567,89');
  });

  it('o sinal vai na frente', () => {
    expect(brl(-1050n)).toBe('-R$ 10,50');
    expect(brl(-5n)).toBe('-R$ 0,05');
  });

  it('não perde precisão acima do inteiro seguro do float', () => {
    expect(brl(900_719_925_474_099_300n)).toBe('R$ 9.007.199.254.740.993,00');
  });
});

describe('pct: pontos-base como porcentagem', () => {
  it('vírgula e duas casas', () => {
    expect(pct(0)).toBe('0,00%');
    expect(pct(5)).toBe('0,05%');
    expect(pct(1234)).toBe('12,34%');
    expect(pct(10_000)).toBe('100,00%');
  });

  it('negativo mantém o sinal, inclusive abaixo de 1%', () => {
    expect(pct(-90)).toBe('-0,90%');
    expect(pct(-1234)).toBe('-12,34%');
  });

  it('sem valor é um traço', () => {
    expect(pct(null)).toBe('-');
  });
});

// O plano das requisições do ensaio: a conta que o relatório e o teste do ensaio conferem contra o que a brapi falsa recebeu.
describe('plannedBrapiRequests: uma por papel que falta, e o papel sem negócio não é pedido de novo', () => {
  const calendar = loadTradingCalendar();
  const market = buildMarket({
    seed: 1,
    stocks: 12,
    firstDay: '2026-11-03',
    sessions: 3,
    calendar,
  });
  const [D1, D2, D3] = market.sessionDays as [string, string, string];
  const required = market.stocks.length + 1; // as ações e o BOVA11

  it('cada pregão custa o conjunto obrigatório, uma requisição por papel, com ou sem papel sem negócio', () => {
    const stragglersOn = (day: string) => {
      const traded = new Set((market.bars.get(day) ?? []).map((bar) => bar.ticker));
      return [...market.stocks.map((s) => s.ticker), 'BOVA11'].filter((t) => !traded.has(t));
    };
    // o SECA3 sem negócio no 2º pregão e o PAUS3 suspenso do 3º em diante: a brapi falsa os responde sem a barra, a falta é definitiva e o
    // eod conclui na primeira tentativa, sem pedi-los de novo
    expect(stragglersOn(D2)).toContain('SECA3');
    expect(stragglersOn(D3)).toContain('PAUS3');
    const planned = plannedBrapiRequests(market);
    expect([...planned.values()]).toEqual([required, required, required]);
  });

  it('o pregão cuja barra sai atrasada começa por uma sonda de uma requisição, e a tentativa das 22:30 pede o conjunto', () => {
    expect(plannedBrapiRequests(market, D2).get(D2)).toBe(1 + required);
    // o atraso de um pregão não muda a conta dos outros
    expect(plannedBrapiRequests(market, D2).get(D1)).toBe(plannedBrapiRequests(market).get(D1));
    expect(plannedBrapiRequests(market, D2).get(D3)).toBe(required);
  });

  it('a falta acima do limite do alerta (10% do obrigatório) espera o prazo: cada papel sem barra é pedido nas três novas tentativas', () => {
    // só 5 dos 13 papéis negociam em D1: 8 faltando
    const sparse = {
      ...market,
      bars: new Map(market.bars).set(D1, market.bars.get(D1)!.slice(0, 5)),
    };
    expect(plannedBrapiRequests(sparse).get(D1)).toBe(required + 8 * 3);
    // no pregão atrasado as novas tentativas são as de 23:30 e 00:30
    expect(plannedBrapiRequests(sparse, D1).get(D1)).toBe(1 + required + 8 * 2);
  });
});
