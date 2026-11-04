import type { Request } from 'express';

// Quem está logado, como os guards deixam na requisição: o ULID e o papel lidos do BANCO a cada requisição (nunca de um cookie
// assinado que sobreviva a uma promoção ou a uma exclusão).
export interface AccountContext {
  userId: string;
  role: 'USER' | 'ADMIN';
}

export type AccountRequest = Request & { account?: AccountContext };
