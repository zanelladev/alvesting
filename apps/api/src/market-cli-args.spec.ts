import { describe, expect, it } from 'vitest';
import { databaseLabel, parseBackfillArgs } from './market-cli-args.js';

describe('parseBackfillArgs', () => {
  it('sem argumentos: a carga inicial, no modo sem rede', () => {
    expect(parseBackfillArgs([])).toEqual({});
  });

  it('papéis, janela e a confirmação do banco', () => {
    expect(
      parseBackfillArgs([
        '--papeis',
        'PETR4,VALE3',
        '--de',
        '2026-10-26',
        '--ate',
        '2026-10-30',
        '--confirmo-banco',
        'alvesting_x_test',
      ]),
    ).toEqual({
      tickers: ['PETR4', 'VALE3'],
      from: '2026-10-26',
      to: '2026-10-30',
      confirmDatabase: 'alvesting_x_test',
    });
  });

  it.each([
    [['--papeis'], /pede um valor/],
    [['--papeis', '--de'], /pede um valor/],
    [['--papeis', 'PETR4, VALE3'], /códigos separados por vírgula/],
    [['--papeis', ''], /códigos separados/],
    [['--de', '30/10/2026'], /AAAA-MM-DD/],
    [['--ate', '2026-02-30'], /AAAA-MM-DD/],
    [['--de', '2026-10-30', '--ate', '2026-10-26'], /--de é depois de --ate/],
    [['--executar', 'sim'], /argumento desconhecido/],
    [['PETR4'], /pede um valor/],
  ])('recusa %j', (argv, message) => {
    expect(() => parseBackfillArgs(argv)).toThrow(message);
  });
});

describe('databaseLabel: o banco de destino sem credencial', () => {
  it('mostra só o servidor e o nome do banco', () => {
    const label = databaseLabel(
      'postgresql://alvesting:segredo@localhost:25432/alvesting_dev?sslmode=require',
    );
    expect(label).toEqual({ host: 'localhost:25432', name: 'alvesting_dev' });
    expect(JSON.stringify(label)).not.toContain('segredo');
    expect(JSON.stringify(label)).not.toContain('alvesting:');
  });

  it('nome com caractere especial é decodificado', () => {
    expect(databaseLabel('postgresql://u:p@db.example.test/meu%20banco').name).toBe('meu banco');
  });
});
