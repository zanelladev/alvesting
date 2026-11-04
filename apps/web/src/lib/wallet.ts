import { portfolioSchema, type Portfolio } from '@alvesting/contracts';
import { apiGetFresh, type ApiDeps } from './api';

// A leitura do servidor para a tela da carteira (etapa 12, parte 2; docs/TELAS.md, seção 9; docs/API.md, seção 9). É dado de uma pessoa só e é
// dinheiro, então nunca passa pelo cache de dados do Next: `apiGetFresh` (no-store, sem tags, sem revalidate), com o cookie da sessão e o
// X-Azure-FDID, e a resposta validada pelo schema do contrato. O erro sobe como ApiError com o status da api: a página decide (401: entrar;
// 403 CONSENT_REQUIRED: a conta, para aceitar o texto novo).
export const readPortfolio = (cookie: string, deps: ApiDeps = {}): Promise<Portfolio> =>
  apiGetFresh('/me/portfolio', portfolioSchema, { cookie }, deps);
