import type { InternalTape, Macro } from '@alvesting/contracts';
import { glyphOf } from './ascii';
import { formatBps, formatDate, formatDecimalString, formatPrice, variationBps } from './format';

// O texto da fita do pé do hero (components/fita.tsx; ADR 0034). É exibir a cotação, o que a licença da brapi permite, com o crédito na
// legenda e no rodapé (docs/API.md, seção 6). Nada de float: o fechamento é centavo inteiro e a variação, ponto-base inteiro.

export const TAPE_SEPARATOR = '   ·   ';
export const NO_QUOTES = 'sem cotações ainda';

// Uma cotação: "PETR4 38,12 ▲ +1,20%", o fechamento sem o símbolo e a variação sobre o anterior, com o glifo e o sinal. Sem o anterior
// (o primeiro pregão do papel), só o fechamento. Para o leitor de tela, sem o glifo (`glyph: false`): o sinal já diz a direção, e ele leria
// "triângulo preto para cima" em cada papel (nas tabelas o glifo também é só decoração, do CSS).
export interface TapeQuote {
  ticker: string;
  closeCents: number;
  previousCloseCents: number | null;
}
export function quoteText(
  { ticker, closeCents, previousCloseCents }: TapeQuote,
  glyph = true,
): string {
  const head = `${ticker} ${formatPrice(closeCents)}`;
  if (previousCloseCents === null || previousCloseCents <= 0) return head;
  const bps = variationBps(closeCents, previousCloseCents);
  return `${head} ${glyph ? `${glyphOf(bps)} ` : ''}${formatBps(bps)}`;
}

// O macro do Banco Central, como a faixa "Cotações e macro" o mostra (o valor que falta não entra).
export function macroParts(macro: Macro): string[] {
  const parts: string[] = [];
  const add = (point: Macro['cdi'], text: (value: string) => string) => {
    if (point) parts.push(text(formatDecimalString(point.value)));
  };
  add(macro.cdi, (v) => `CDI ${v}% ao dia`);
  add(macro.selic, (v) => `Selic ${v}% ao ano`);
  add(macro.ipcaMonth, (v) => `IPCA ${v}% no mês`);
  add(macro.ipca12m, (v) => `IPCA ${v}% em 12 meses`);
  add(macro.usd, (v) => `Dólar R$ ${v}`);
  return parts;
}

// A linha inteira, ou o aviso de que não há o que mostrar.
export const tapeText = (parts: readonly string[]): string =>
  parts.length > 0 ? parts.join(TAPE_SEPARATOR) : NO_QUOTES;

// Uma volta da fita: a linha e o separador, repetidos até passar de `min` caracteres. O trilho leva duas voltas e anda uma (50%): com a
// volta mais larga que a tela, a ponta da direita nunca fica vazia.
// ponytail: 320 caracteres de 13 px na mono dão uns 2.500 px; tela mais larga que isso mostraria o fim do trilho. Suba o mínimo se
// aparecer.
export function tapeLoop(text: string, min = 320): string {
  const unit = `${text}${TAPE_SEPARATOR}`;
  return unit.repeat(Math.max(1, Math.ceil(min / unit.length)));
}

// A fita do hero e a legenda dela. Com a rota interna da fita (`readTape`, src/lib/quotes.ts), o universo da semana do último ciclo: os papéis
// que o briefing deu a todos os modelos, na ordem do universo (o maior volume primeiro), com o fechamento do pregão. Sem ela (antes do
// primeiro ciclo, ou sem universo nem barra), o que a home já lê: o BOVA11 e o macro do Banco Central, e a legenda diz isso.
// ponytail: a fita leva só os TAPE_LIMIT primeiros do universo (os de maior volume): o universo inteiro (até 500 papéis) somaria uns 20 KB ao
// documento da home, que vai duas vezes (o HTML e o payload do React), e o LCP do celular conta cada KB (docs/TELAS.md, seção 5). Mais
// papéis, só medindo de novo com `pnpm lighthouse`.
export const TAPE_LIMIT = 40;

export function heroTape(
  universe: InternalTape,
  bova11: (Omit<TapeQuote, 'ticker'> & { date: string }) | null,
  macro: Macro,
): { text: string; label: string; caption: string } {
  if (universe.date !== null) {
    const day = formatDate(universe.date);
    const rows = universe.rows.slice(0, TAPE_LIMIT);
    const some = universe.rows.length > TAPE_LIMIT ? `, os ${TAPE_LIMIT} de maior volume` : '';
    return {
      text: tapeText(rows.map((row) => quoteText(row))),
      label: `Fechamentos do pregão de ${day}${some}: ${rows.map((row) => quoteText(row, false)).join('; ')}.`,
      caption: `Os mesmos ${universe.rows.length} papéis da B3, lidos por todos os modelos. Cotações: brapi.dev, pregão de ${day}.`,
    };
  }
  const parts = (glyph: boolean) => [
    ...(bova11 ? [quoteText({ ticker: 'BOVA11', ...bova11 }, glyph)] : []),
    ...macroParts(macro),
  ];
  const spoken = parts(false);
  return {
    text: tapeText(parts(true)),
    label:
      spoken.length > 0 ? `O BOVA11 e o macro do Banco Central: ${spoken.join('; ')}.` : NO_QUOTES,
    caption: `O mesmo briefing para todos os modelos: o BOVA11 e o macro do Banco Central. Cotações: brapi.dev${bova11 ? `, pregão de ${formatDate(bova11.date)}` : ''}.`,
  };
}
