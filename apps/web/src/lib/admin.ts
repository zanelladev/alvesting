import {
  adminCostsSchema,
  adminJobsSchema,
  adminSeasonsSchema,
  type AdminCosts,
  type AdminJobs,
  type AdminSeasons,
} from '@alvesting/contracts';
import { apiGetFresh, type ApiDeps } from './api';

// As leituras do servidor para o painel de admin (etapa 10, parte 2; docs/TELAS.md, seção 8). É dado de operação e de uma pessoa só (o
// admin), então nunca passa pelo cache de dados do Next: `apiGetFresh` (no-store, sem tags, sem revalidate), com o cookie da sessão e o
// X-Azure-FDID, e cada resposta validada pelo schema do contrato. O erro sobe como ApiError com o status da api: a página decide (401:
// entrar; 403: a página não existe).
export interface AdminData {
  jobs: AdminJobs;
  costs: AdminCosts;
  seasons: AdminSeasons;
}

export async function readAdmin(
  cookie: string | undefined,
  deps: ApiDeps = {},
): Promise<AdminData> {
  const [jobs, costs, seasons] = await Promise.all([
    apiGetFresh('/admin/jobs', adminJobsSchema, { cookie }, deps),
    apiGetFresh('/admin/costs', adminCostsSchema, { cookie }, deps),
    apiGetFresh('/admin/seasons', adminSeasonsSchema, { cookie }, deps),
  ]);
  return { jobs, costs, seasons };
}
