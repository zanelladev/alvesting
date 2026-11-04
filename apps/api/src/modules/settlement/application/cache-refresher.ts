import type { DefaultAzureCredential } from '@azure/identity';
import { Logger } from '@nestjs/common';
import type { Env } from '../../../config/env.js';

// Revalidação do site e purge do Front Door depois de uma liquidação (plano §5.5 e §7; docs/JOBS.md, seção 4.2). O resultado do
// pregão mudou, então o que está em cache deixa de valer: primeiro o site (o cache de dados do Next), depois a borda (o cache do
// Front Door sobre /api/v1/*). Nessa ordem.
//
// Nunca lança e nunca falha a liquidação: o resultado já está gravado, e o tempo de vida do cache público (300 s,
// PUBLIC_CACHE_TTL_SECONDS) limita o atraso se uma das duas chamadas falhar. Cada falha vira um evento de log com a etapa e o
// motivo (status, nome do erro e, na falha de rede, o código curto do erro de sistema), sem URL, sem cabeçalho e sem o texto do
// erro: nem o segredo do site, nem o token da Azure, nem o ID da assinatura passam por log. Sem as variáveis (dev, o ensaio e o
// perfil econômico, que não tem Front Door) o passo é pulado, com uma linha de log. Nenhuma das duas chamadas segue
// redirecionamento (`redirect: 'error'`): o Bearer do site e o token da Azure só vão para o endereço configurado.
//
// A ARM REST do purge do endpoint (conferida em 01/11/2026 no repositório oficial de especificações da Azure,
// Azure/azure-rest-api-specs, Microsoft.Cdn/Cdn/stable/2025-06-01/openapi.json, AFDEndpoints_PurgeContent):
//   POST {FRONT_DOOR_ENDPOINT_ID}/purge?api-version=2025-06-01   corpo { "contentPaths": ["/api/v1/*"] }   200 ou 202 (assíncrono)
// A api-version é a mesma do Bicep (infra/modules/frontdoor.bicep). O papel da id-alvesting-worker tem só essa ação
// (Microsoft.Cdn/profiles/afdEndpoints/purge/action). O Front Door leva até 10 minutos para propagar o purge a todos os pontos
// de presença (Learn, "Purge cache in Azure Front Door"), e a limpeza por caminho vale para toda variação de query string.
const ARM_SCOPE = 'https://management.azure.com/.default';
const PURGE_API_VERSION = '2025-06-01';
// o que a API pública guarda na borda (docs/API.md): as GET de /api/v1/*
const PURGE_PATHS = ['/api/v1/*'];
export const CALL_TIMEOUT_MS = 10_000;

export type StepResult = 'ok' | 'skipped' | 'failed';
export interface RefreshResult {
  revalidate: StepResult;
  purge: StepResult;
}

export interface CacheRefresherDeps {
  env: Partial<Pick<Env, 'WEB_INTERNAL_URL' | 'REVALIDATE_SECRET' | 'FRONT_DOOR_ENDPOINT_ID'>>;
  // injetáveis nos testes: nenhum teste chama o site nem a Azure
  fetch?: typeof fetch;
  credential?: Pick<DefaultAzureCredential, 'getToken'>;
}

export class CacheRefresher {
  private readonly logger = new Logger(CacheRefresher.name);
  private readonly http: typeof fetch;
  // criada na primeira vez que há purge e reaproveitada: o token fica em cache dentro dela
  private credential: Pick<DefaultAzureCredential, 'getToken'> | undefined;

  constructor(private readonly deps: CacheRefresherDeps) {
    this.http = deps.fetch ?? fetch;
  }

  async afterSettle(): Promise<RefreshResult> {
    return { revalidate: await this.revalidateSite(), purge: await this.purgeFrontDoor() };
  }

  // POST /interno/revalidar no site, pelo endereço interno do ingress (WEB_INTERNAL_URL), com o REVALIDATE_SECRET no cabeçalho
  // de autorização. O site marca como vencidas as tags de dados do Next (apps/web/src/lib/api.ts).
  private async revalidateSite(): Promise<StepResult> {
    const { WEB_INTERNAL_URL: base, REVALIDATE_SECRET: secret } = this.deps.env;
    if (!base || !secret) {
      this.logger.log(
        { etapa: 'revalidacao' },
        'revalidação do site pulada: sem WEB_INTERNAL_URL ou REVALIDATE_SECRET',
      );
      return 'skipped';
    }
    try {
      const response = await this.http(new URL('/interno/revalidar', base), {
        method: 'POST',
        headers: { authorization: `Bearer ${secret.reveal()}`, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      return this.outcome('revalidacao', response, [200]);
    } catch (error) {
      return this.failed('revalidacao', error);
    }
  }

  // Limpa /api/v1/* do endpoint do Front Door pela ARM REST, com o token da identidade gerenciada do worker.
  private async purgeFrontDoor(): Promise<StepResult> {
    const endpoint = this.deps.env.FRONT_DOOR_ENDPOINT_ID;
    if (!endpoint) {
      this.logger.log(
        { etapa: 'purge' },
        'purge do Front Door pulado: sem FRONT_DOOR_ENDPOINT_ID (dev ou perfil econômico)',
      );
      return 'skipped';
    }
    try {
      this.credential ??= this.deps.credential ?? (await defaultCredential());
      const token = await this.credential.getToken(ARM_SCOPE, {
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      const response = await this.http(
        `https://management.azure.com${endpoint}/purge?api-version=${PURGE_API_VERSION}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ contentPaths: PURGE_PATHS }),
          redirect: 'error',
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        },
      );
      return this.outcome('purge', response, [200, 202]);
    } catch (error) {
      return this.failed('purge', error);
    }
  }

  private outcome(etapa: string, response: Response, accepted: number[]): StepResult {
    // o corpo da resposta nunca é lido nem registrado
    void response.body?.cancel().catch(() => undefined);
    if (accepted.includes(response.status)) {
      this.logger.log({ etapa, status: response.status }, 'cache público atualizado');
      return 'ok';
    }
    this.logger.warn(
      { etapa, evento: 'cache_publico_falhou', status: response.status },
      'o cache público não foi atualizado: o tempo de vida do cache limita o atraso',
    );
    return 'failed';
  }

  private failed(etapa: string, error: unknown): StepResult {
    // O nome do erro (TimeoutError, TypeError...) e, se houver, o código do erro de sistema por trás (ECONNREFUSED, ENOTFOUND,
    // UND_ERR_CONNECT_TIMEOUT): é o que separa "o site caiu" de "o DNS" e de "o prazo" para quem está de plantão. Nunca a mensagem,
    // que numa falha de rede ou de credencial pode trazer URL e segredo, e o código só entra se tiver a forma de um código.
    const cause =
      error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
    const code =
      typeof cause?.code === 'string' && ERROR_CODE.test(cause.code) ? cause.code : undefined;
    this.logger.warn(
      {
        etapa,
        evento: 'cache_publico_falhou',
        erro: error instanceof Error ? error.name : 'desconhecido',
        ...(code ? { causa: code } : {}),
      },
      'o cache público não foi atualizado: o tempo de vida do cache limita o atraso',
    );
    return 'failed';
  }
}

// ECONNREFUSED, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT...
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;

// A credencial só nasce quando há purge a fazer: em dev e no ensaio nem se importa o SDK da identidade.
async function defaultCredential(): Promise<Pick<DefaultAzureCredential, 'getToken'>> {
  const { DefaultAzureCredential: Credential } = await import('@azure/identity');
  return new Credential();
}
