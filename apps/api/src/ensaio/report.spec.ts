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
describe('plannedBrapiRequests: uma por papel que falta, e só quem não veio é pedido de novo', () => {
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

  it('o pregão em que todos negociam custa o conjunto obrigatório, uma requisição por papel', () => {
    // uma ação de enchimento pode ficar sem negócio por sorteio: o plano soma as novas tentativas dela (22:30, 23:30 e 00:30)
    const traded = new Set((market.bars.get(D1) ?? []).map((bar) => bar.ticker));
    const stragglers = [...market.stocks.map((s) => s.ticker), 'BOVA11'].filter(
      (t) => !traded.has(t),
    ).length;
    expect(plannedBrapiRequests(market).get(D1)).toBe(required + stragglers * 3);
  });

  it('o papel sem negócio (SECA3 no 2º pregão) e o suspenso (PAUS3 do 3º em diante) são pedidos de novo em cada nova tentativa até o prazo', () => {
    const stragglersOn = (day: string) => {
      const traded = new Set((market.bars.get(day) ?? []).map((bar) => bar.ticker));
      return [...market.stocks.map((s) => s.ticker), 'BOVA11'].filter((t) => !traded.has(t));
    };
    expect(stragglersOn(D2)).toContain('SECA3');
    expect(stragglersOn(D3)).toContain('PAUS3');
    const planned = plannedBrapiRequests(market);
    expect(planned.get(D2)).toBe(required + stragglersOn(D2).length * 3);
    expect(planned.get(D3)).toBe(required + stragglersOn(D3).length * 3);
  });

  it('o pregão cuja barra sai atrasada começa por uma sonda de uma requisição, e as novas tentativas começam às 22:30', () => {
    const traded = new Set((market.bars.get(D2) ?? []).map((bar) => bar.ticker));
    const stragglers = [...market.stocks.map((s) => s.ticker), 'BOVA11'].filter(
      (t) => !traded.has(t),
    ).length;
    expect(plannedBrapiRequests(market, D2).get(D2)).toBe(1 + required + stragglers * 2);
    // o atraso de um pregão não muda a conta dos outros
    expect(plannedBrapiRequests(market, D2).get(D1)).toBe(plannedBrapiRequests(market).get(D1));
  });
});
