// A origem legada do banco de dev (docs/DADOS.md, seção 1): as barras e os dias que vieram do arquivo da B3 antes de a brapi ser a fonte
// única. Nada novo grava este valor do enum (`bar_source` e `trading_day_source`); os testes só o escrevem à mão, para provar que o dado
// legado nunca é sobrescrito e conta como confirmado. É o único lugar fora do schema que os nomeia. Só os testes importam este arquivo.
export const LEGACY_SOURCE = 'COTAHIST' as const;
// A coluna legada de trading_day (o SHA-256 do ZIP diário que o dev guardou): nula nos dias confirmados pela brapi.
export const LEGACY_SHA = 'cotahistSha256' as const;
