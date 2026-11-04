import { isIsoDate, type IsoDate } from './modules/market-data/domain/dates.js';

// Os argumentos do market:backfill (src/market-cli.ts). Estritos: a carga gasta cota da brapi e escreve num banco, então argumento
// desconhecido, valor que falta ou data torta é erro, e nada é buscado sem a confirmação do nome do banco.

export interface BackfillArgs {
  tickers?: string[];
  from?: IsoDate;
  to?: IsoDate;
  // o nome do banco que o modo sem rede mostrou; só com ele a carga busca de verdade
  confirmDatabase?: string;
}

const TICKER_LIST = /^[A-Za-z0-9]{1,12}(,[A-Za-z0-9]{1,12})*$/;

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  const args: BackfillArgs = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} pede um valor`);
    }
    switch (flag) {
      case '--papeis':
        if (!TICKER_LIST.test(value)) {
          throw new Error('--papeis pede códigos separados por vírgula, sem espaço (PETR4,VALE3)');
        }
        args.tickers = value.split(',');
        break;
      case '--de':
      case '--ate':
        if (!isIsoDate(value))
          throw new Error(`${flag} pede uma data AAAA-MM-DD (veio "${value}")`);
        if (flag === '--de') args.from = value;
        else args.to = value;
        break;
      case '--confirmo-banco':
        args.confirmDatabase = value;
        break;
      default:
        throw new Error(`argumento desconhecido: ${flag}`);
    }
  }
  if (args.from && args.to && args.from > args.to) throw new Error('--de é depois de --ate');
  return args;
}

// O banco de destino como a pessoa o reconhece, SEM usuário nem senha: o que a carga mostra antes de buscar e o que a confirmação repete.
export function databaseLabel(url: string): { host: string; name: string } {
  const parsed = new URL(url);
  return { host: parsed.host, name: decodeURIComponent(parsed.pathname.replace(/^\//, '')) };
}
