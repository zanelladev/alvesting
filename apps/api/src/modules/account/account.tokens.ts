// Os tokens de injeção do módulo da conta. Ficam num arquivo à parte para os guards e os testes importarem sem ciclo.
export const AUTH = Symbol('AUTH');
export const ACCOUNT_CONFIG = Symbol('ACCOUNT_CONFIG');
export const LEGAL_DOCUMENTS = Symbol('LEGAL_DOCUMENTS');
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export type { Auth } from './infrastructure/auth.js';
