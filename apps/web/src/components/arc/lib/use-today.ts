// Adaptado da Arc (https://uiarc.dev/components/calendar), o "lib/use-today.ts" que o item "calendar" traz (registro
// https://uiarc.dev/r/calendar.json, lido em 06/11/2026). Copyright (c) 2026 Elia Kuratli, licença MIT (o texto inteiro em
// components/arc/LICENSE).
// O que mudou: o `dateKey` e o `fromKey` saem exportados, e o calendário e o lançamento da carteira (components/wallet-lots.tsx) os usam: a
// data vai ao formulário como AAAA-MM-DD montado das partes LOCAIS dela (nunca `toISOString`, que muda o dia pelo fuso: 23:30 em Brasília já
// é o dia seguinte em UTC). E o hoje é o de Brasília, e não o do aparelho (o `todayKey`, abaixo), relido a cada minuto, ao voltar à aba e
// no foco; o resto é o da Arc.
import { useMemo, useSyncExternalStore } from 'react';

export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const fromKey = (key: string) => {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

/** Today turns over at Brasília's midnight, not the device's; every minute, returning to the tab and focusing the window read it again. */
const subscribeToday = (notify: () => void) => {
  // ponytail: relê a cada minuto (o useSyncExternalStore só redesenha quando o dia muda), e o dia vira até 1 min depois da meia-noite de
  // Brasília; agendar essa meia-noite, se o minuto um dia pesar
  const timer = window.setInterval(notify, 60_000);
  const onVisible = () => {
    if (document.visibilityState === 'visible') notify();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', notify);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', notify);
  };
};
// O dia de Brasília, o mesmo que o servidor manda como limite da data (carteira/page.tsx): com o do aparelho, num aparelho à frente do fuso o
// "Hoje" passava do limite e ficava desativado da meia-noite dele até a de Brasília (no CI, em UTC, das 21h às 24h; 10/11/2026). Pelas
// partes, e não pelo texto do `en-CA`, para o AAAA-MM-DD não depender do formato de data que cada navegador traz.
const brasilia = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export const todayKey = (now = new Date()) => {
  const parts = brasilia.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const serverToday = () => '';

/** Brasília's date (the limit the server sends). Undefined on the server and during hydration, so markup never depends on the server clock; afterwards it follows the real date across midnight. */
export function useToday() {
  const key = useSyncExternalStore(subscribeToday, todayKey, serverToday);
  return useMemo(() => (key ? fromKey(key) : undefined), [key]);
}
