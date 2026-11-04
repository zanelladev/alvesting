import { monotonicFactory } from 'ulid';

// IDs são ULID gerados na aplicação. A fábrica monotônica mantém a ordem de criação
// mesmo para IDs gerados no mesmo milissegundo.
const next = monotonicFactory();

export const newId = (): string => next();
