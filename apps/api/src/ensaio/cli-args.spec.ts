import { describe, expect, it } from 'vitest';
import { ensaioDatabaseUrl, parseArgs } from './cli-args.js';

describe('parseArgs: os argumentos do arena:ensaio', () => {
  it('sem argumento valem 5 pregões e a semente 1', () => {
    expect(parseArgs([])).toEqual({ kind: 'run', sessions: 5, seed: 1 });
  });

  it('lê --pregoes e --semente, em qualquer ordem', () => {
    expect(parseArgs(['--pregoes', '3', '--semente', '42'])).toEqual({
      kind: 'run',
      sessions: 3,
      seed: 42,
    });
    expect(parseArgs(['--semente', '7', '--pregoes', '20'])).toEqual({
      kind: 'run',
      sessions: 20,
      seed: 7,
    });
  });

  it('--ajuda mostra o uso', () => {
    expect(parseArgs(['--ajuda'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--pregoes', '4', '--help'])).toEqual({ kind: 'help' });
  });

  it('recusa o que não é inteiro, o que falta, o desconhecido e os pregões fora de 3 a 20 (o comando esvazia um banco)', () => {
    const bad = [
      ['--pregoes', 'cinco'],
      ['--pregoes', '5.5'],
      ['--pregoes', '-1'],
      ['--semente', ''],
      ['--semente'],
      ['--pregoes', '2'],
      ['--pregoes', '21'],
      ['--pregoes', '0'],
      ['--outra', '1'],
      ['5'],
    ];
    for (const argv of bad) {
      expect(parseArgs(argv), argv.join(' ')).toMatchObject({ kind: 'error' });
    }
  });
});

describe('ensaioDatabaseUrl: de onde sai o banco do ensaio', () => {
  it('ENSAIO_DATABASE_URL vale como veio', () => {
    expect(
      ensaioDatabaseUrl({ ENSAIO_DATABASE_URL: 'postgresql://u:p@host:5432/outro_ensaio' }),
    ).toBe('postgresql://u:p@host:5432/outro_ensaio');
  });

  it('nunca é deduzido do DATABASE_URL: sem a variável o comando recusa, e o banco de dev nem é cogitado', () => {
    const env = { DATABASE_URL: 'postgresql://alvesting:alvesting@localhost:25432/alvesting_dev' };
    expect(() => ensaioDatabaseUrl(env)).toThrow(/ENSAIO_DATABASE_URL/);
    expect(() => ensaioDatabaseUrl({})).toThrow(/ENSAIO_DATABASE_URL/);
    expect(() => ensaioDatabaseUrl({ ENSAIO_DATABASE_URL: '' })).toThrow(/ENSAIO_DATABASE_URL/);
  });
});
