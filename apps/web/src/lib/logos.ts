import 'server-only';
import { cache } from 'react';
import { readLogos } from './quotes';

// A versão do logo de cada papel, para as telas (ADR 0036, "Como o site mostra"; docs/TELAS.md, "Logos das ações"): o índice lido uma vez por
// requisição (o `cache` do React vale por renderização no servidor) e guardado por uma hora entre elas (o cache de dados do Next,
// lib/quotes.ts). `logos.get(ticker)` é a versão que vai ao `<LogoDoPapel versao>`, ou undefined, o monograma; a leitura que falha é o mapa
// vazio (só monogramas). Só do servidor: o componente de cliente recebe a versão pronta, por prop.
export const versoesDosLogos = cache(
  async (): Promise<ReadonlyMap<string, string>> =>
    new Map((await readLogos()).map(({ ticker, version }) => [ticker, version])),
);
