// Formatação das telas (plano §3 e §13): R$ e % em pt-BR, horários de Brasília. Sem float em dinheiro: o contrato manda centavo
// inteiro (`int().safe()`) e ponto-base inteiro, então a conta é de inteiros e de BigInt, e o texto é montado dígito a dígito. O
// separador de milhar é feito à mão (não pelo Intl) para o texto sair igual em qualquer build do ICU.

const NB = ' '; // espaço que não quebra: "R$" nunca fica numa linha e o número na outra

function assertSafeInteger(value: number): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`inteiro seguro esperado, veio ${value}`);
}

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+$)/g, '.');
const pad2 = (n: number | bigint): string => String(n).padStart(2, '0');

// 123456789 centavos -> "R$ 1.234.567,89". BigInt: 90.071.992.547.409,91 (o maior inteiro seguro) em float arredondaria o centavo.
export function formatBRL(cents: number): string {
  assertSafeInteger(cents);
  const abs = BigInt(Math.abs(cents));
  return `${cents < 0 ? '-' : ''}R$${NB}${group(String(abs / 100n))},${pad2(abs % 100n)}`;
}

// O preço sem o símbolo ("66,90"): rótulo de eixo, onde a moeda está no título do gráfico.
export const formatPrice = (cents: number): string => formatBRL(cents).replace(`R$${NB}`, '');

// O resultado de uma posição: o ganho leva + e a perda leva -.
export const formatBRLSigned = (cents: number): string =>
  cents > 0 ? `+${formatBRL(cents)}` : formatBRL(cents);

// A variação entre dois fechamentos em pontos-base, inteira: o meio vai para longe do zero (a regra de arredondamento do projeto,
// docs/METODOLOGIA.md). Em BigInt: o produto por 10.000 passaria do inteiro seguro com valores grandes.
export function variationBps(close: number, previous: number): number {
  assertSafeInteger(close);
  assertSafeInteger(previous);
  if (previous <= 0) throw new RangeError('fechamento anterior positivo esperado');
  const diff = BigInt(close - previous);
  const abs = (diff < 0n ? -diff : diff) * 10_000n;
  const rounded = (2n * abs + BigInt(previous)) / (2n * BigInt(previous));
  return Number(diff < 0n ? -rounded : rounded);
}

// Reais inteiros, sem símbolo: rótulo de eixo. Arredonda o meio para longe do zero, como o resto do projeto (METODOLOGIA).
export function formatReais(cents: number): string {
  assertSafeInteger(cents);
  const reais = (BigInt(Math.abs(cents)) + 50n) / 100n;
  return `${cents < 0 && reais > 0n ? '-' : ''}${group(String(reais))}`;
}

// Pontos-base (1 bp = 0,01%) em porcentagem: 20 -> "+0,20%". `signed`: variação leva sinal (e o zero não); drawdown e acerto não.
export function formatBps(bps: number, { signed = true }: { signed?: boolean } = {}): string {
  assertSafeInteger(bps);
  const abs = Math.abs(bps);
  const sign = bps < 0 ? '-' : signed && bps > 0 ? '+' : '';
  return `${sign}${group(String((abs - (abs % 100)) / 100))},${pad2(abs % 100)}%`;
}

// Percentil do Monte Carlo (0 a 10.000 bps) como 0 a 100 com uma casa; o meio sobe.
export function formatPercentile(bps: number): string {
  assertSafeInteger(bps);
  const tenths = Math.floor((bps + 5) / 10);
  return `${(tenths - (tenths % 10)) / 10},${tenths % 10}`;
}

export const formatQuantity = (n: number): string => {
  assertSafeInteger(n);
  return n < 0 ? `-${group(String(-n))}` : group(String(n));
};

// Custo de LLM em micro-dólares (1 US$ = 1.000.000): quatro casas, o meio sobe.
export function formatUsdMicro(micro: number): string {
  assertSafeInteger(micro);
  const hundredths = (BigInt(Math.abs(micro)) + 50n) / 100n; // décimos de milésimo de dólar = 1e-4
  return `US$${NB}${group(String(hundredths / 10_000n))},${String(hundredths % 10_000n).padStart(4, '0')}`;
}

// Os valores do BCB chegam como texto decimal exato ("0.050762"). Só troca o ponto: nunca vira número.
export function formatDecimalString(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value))
    throw new RangeError(`decimal em texto esperado, veio ${value}`);
  return value.replace('.', ',');
}

// O que o modelo respondeu: percentual (10, 12.5) e confiança (0 a 1). Não é dinheiro.
export const formatPercentValue = (value: number): string =>
  `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(value)}%`;
export const formatConfidence = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value,
  );

// --- datas ---------------------------------------------------------------------------------------------------------------------
// A data de pregão chega como AAAA-MM-DD e é só reordenada: passar por Date deixaria o fuso do servidor mudar o dia.
function parseIsoDate(iso: string): [string, string, string] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new RangeError(`data AAAA-MM-DD esperada, veio ${iso}`);
  return [match[1]!, match[2]!, match[3]!];
}

export function formatDate(iso: string): string {
  const [year, month, day] = parseIsoDate(iso);
  return `${day}/${month}/${year}`;
}

export function formatShortDate(iso: string): string {
  const [, month, day] = parseIsoDate(iso);
  return `${day}/${month}`;
}

const WEEKDAYS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

export function formatWeekdayDate(iso: string): string {
  const [year, month, day] = parseIsoDate(iso);
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  return `${WEEKDAYS[weekday]}, ${day}/${month}/${year}`;
}

// Horário de Brasília. America/Sao_Paulo (e não um -03:00 fixo) para acompanhar a história do fuso; o servidor pode estar em UTC.
const BRT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function brasilia(iso: string): Record<string, string> {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) throw new RangeError(`instante ISO esperado, veio ${iso}`);
  return Object.fromEntries(BRT.formatToParts(instant).map((part) => [part.type, part.value]));
}

export function formatTime(iso: string, seconds = false): string {
  const t = brasilia(iso);
  return `${t.hour}:${t.minute}${seconds ? `:${t.second}` : ''}`;
}

export function formatDateTime(iso: string): string {
  const t = brasilia(iso);
  return `${t.day}/${t.month}/${t.year} ${t.hour}:${t.minute}`;
}

// Só o dia, em Brasília: para o dado que não tem hora (o documento da CVM chega com o dia, e a api o guarda à meia-noite de Brasília).
export function formatDay(iso: string): string {
  const t = brasilia(iso);
  return `${t.day}/${t.month}/${t.year}`;
}

// A contagem para o próximo ciclo: "1 dia e 3 horas", "3 horas e 12 minutos". Dias e horas, ou horas e minutos, ou minutos.
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'agora';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'menos de 1 minuto';
  const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts =
    days > 0
      ? [unit(days, 'dia', 'dias'), hours > 0 ? unit(hours, 'hora', 'horas') : '']
      : hours > 0
        ? [unit(hours, 'hora', 'horas'), rest > 0 ? unit(rest, 'minuto', 'minutos') : '']
        : [unit(rest, 'minuto', 'minutos'), ''];
  return parts.filter(Boolean).join(' e ');
}

// A frase da contagem. O servidor a escreve ao renderizar e o relógio do navegador a refaz (src/components/countdown.tsx).
export function countdownText(at: string, now: number): string {
  const ms = Date.parse(at) - now;
  return ms <= 0 ? 'O ciclo está abrindo agora.' : `Faltam ${formatCountdown(ms)}.`;
}
