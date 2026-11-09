import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENDA, cronMatches, occurrences } from './agenda.js';

// A agenda do operador local é a mesma dos agendadores de produção: este teste lê o Bicep (infra/modules/containerapps.bicep, o vetor
// `schedulers`) e compara cron por cron. Mudou um lado, cai aqui.
const bicep = readFileSync(
  new URL('../../../../infra/modules/containerapps.bicep', import.meta.url),
  'utf8',
);
const fromBicep: Record<string, string> = Object.fromEntries(
  [...bicep.matchAll(/\{\s*name:\s*'([a-z-]+)'\s*,\s*cron:\s*'([^']+)'\s*\}/g)].map(
    (m): [string, string] => [m[1]!, m[2]!],
  ),
);

describe('a agenda do operador local contra os crons do Bicep', () => {
  it('o leitor acha os sete agendadores do Bicep (se achasse menos, a comparação passaria à toa)', () => {
    expect(Object.keys(fromBicep).sort()).toEqual([
      'backup',
      'briefing',
      'cycle',
      'eod',
      'news',
      'retention',
      'universe',
    ]);
  });

  it('cada job da agenda tem o MESMO cron do Bicep, e só o backup fica de fora (é da Azure: pede o pg_dump e um servidor)', () => {
    for (const [job, cron] of Object.entries(AGENDA)) expect(cron, job).toBe(fromBicep[job]);
    expect(Object.keys(fromBicep).filter((job) => !(job in AGENDA))).toEqual(['backup']);
  });
});

describe('cronMatches e occurrences: o minuto em UTC', () => {
  it('o eod é 21:30 de Brasília de segunda a sexta (00:30 UTC de terça a sábado)', () => {
    expect(cronMatches(AGENDA.eod, new Date('2026-11-10T00:30:00Z'))).toBe(true); // segunda 09/11, 21:30
    expect(cronMatches(AGENDA.eod, new Date('2026-11-14T00:30:00Z'))).toBe(true); // sexta 13/11, 21:30
    expect(cronMatches(AGENDA.eod, new Date('2026-11-15T00:30:00Z'))).toBe(false); // sábado 14/11
    expect(cronMatches(AGENDA.eod, new Date('2026-11-09T00:30:00Z'))).toBe(false); // domingo 08/11
    expect(cronMatches(AGENDA.eod, new Date('2026-11-10T00:31:00Z'))).toBe(false);
  });

  it('o briefing e o ciclo são 07:30 e 08:00 de Brasília nos dias úteis; a notícia, a cada meia hora', () => {
    expect(cronMatches(AGENDA.briefing, new Date('2026-11-09T10:30:00Z'))).toBe(true);
    expect(cronMatches(AGENDA.cycle, new Date('2026-11-09T11:00:00Z'))).toBe(true);
    expect(cronMatches(AGENDA.cycle, new Date('2026-11-08T11:00:00Z'))).toBe(false); // domingo
    expect(cronMatches(AGENDA.news, new Date('2026-11-08T03:00:00Z'))).toBe(true);
    expect(cronMatches(AGENDA.news, new Date('2026-11-08T03:30:00Z'))).toBe(true);
    expect(cronMatches(AGENDA.news, new Date('2026-11-08T03:15:00Z'))).toBe(false);
    expect(cronMatches(AGENDA.universe, new Date('2026-11-08T12:00:00Z'))).toBe(true); // domingo 09:00
  });

  it('occurrences: do instante exclusivo ao inclusivo, em ordem', () => {
    const at = (iso: string) => new Date(iso);
    expect(
      occurrences(AGENDA.news, at('2026-11-09T10:00:00Z'), at('2026-11-09T11:00:00Z')).map((d) =>
        d.toISOString(),
      ),
    ).toEqual(['2026-11-09T10:30:00.000Z', '2026-11-09T11:00:00.000Z']);
    // a noite inteira com o Mac dormindo (sexta 18:00 a segunda 08:00 de Brasília): o eod de sexta, o universo de domingo, as duas limpezas,
    // o briefing e o ciclo de segunda
    const from = at('2026-11-06T21:00:00Z');
    const until = at('2026-11-09T11:00:00Z');
    expect(occurrences(AGENDA.eod, from, until).map((d) => d.toISOString())).toEqual([
      '2026-11-07T00:30:00.000Z',
    ]);
    expect(occurrences(AGENDA.universe, from, until)).toHaveLength(1);
    expect(occurrences(AGENDA.retention, from, until)).toHaveLength(2);
    expect(occurrences(AGENDA.briefing, from, until)).toHaveLength(1);
    expect(occurrences(AGENDA.cycle, from, until)).toHaveLength(1);
  });

  it('cron fora do que a agenda usa é erro, nunca um "nunca dispara" calado', () => {
    expect(() => cronMatches('0 11 * *', new Date())).toThrow(/campos/);
    expect(() => cronMatches('0 11 * * MON', new Date())).toThrow(/não usa/);
  });
});
