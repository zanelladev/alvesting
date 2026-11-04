import { notFound } from 'next/navigation';
import { FEED_ACTIONS, cursorSchema } from '@alvesting/contracts';
import { ApiError } from './api';

// Os ajudantes das páginas. O que vem da URL (parâmetro de caminho e de busca) é do leitor e pode ser qualquer coisa: cada página o
// valida com os schemas do contrato antes de usar, e o que não tem a forma vira 404 ou é ignorado, nunca erro 500.

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Parâmetro repetido (?a=1&a=2): vale o primeiro.
export const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

// 404 da api: o recurso não existe. 400: o site montou o pedido com o que o leitor digitou (um cursor forjado, que passa pela forma e
// a api recusa), então é o pedido que não existe. Qualquer outro erro sobe como está: a página, embrulhada em `withApiDown`
// (src/lib/with-api-down.tsx), responde com a tela de erro montada no servidor.
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
}

// Filtro do feed (?filtro=BUY): valor que não é uma ação é ignorado, e a lista sai sem filtro.
export const actionOf = (value: string | undefined) =>
  FEED_ACTIONS.find((action) => action === value);

// Cursor da lista (?cursor=...): opaco. O que não tem a forma dele é página que não existe.
export function cursorOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = cursorSchema.safeParse(value);
  if (!parsed.success) notFound();
  return parsed.data;
}
