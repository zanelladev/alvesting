// Passos do deploy.yml que falam com o Container Apps (plano 5.10 e 16, etapas 3 e 10; ADR 0029). É um blue/green com o label `green`: a
// revisão nova nasce com 0% do tráfego e com o label, é provada pelo endereço do label e pelo endpoint green do Front Door (smoke e
// Playwright mobile) e só então recebe os 100%, a api primeiro e depois o web. Cada subcomando é um passo do workflow, na ordem em que o
// workflow os chama:
//
//   current-tags       imprime as tags das imagens que estão no ar (entrada do what-if do ci.yml)
//   pin                fixa o tráfego de ca-api e ca-web, pelo nome, na revisão que está no ar
//   migrate            atualiza a imagem do job-migrate (migrate deploy e db:roles), dispara e espera terminar com sucesso
//   create <api|web>   cria a revisão nova do app (nasce com 0% de tráfego), espera ficar saudável e dá a ela o label green
//   smoke-green <api|web>  /health (e /api/v1/health na api) no endereço do label green do app
//   probe-green <api|web>  perfil econômico: a revisão do label, pronta e saudável pelas sondas da plataforma (a api é interna)
//   green-url <api|web>    perfil econômico: imprime GREEN_URL=<endereço do label> (vai para o GITHUB_ENV do Playwright do web)
//   promote <api|web>  100% do tráfego do app para a revisão nova
//   smoke-edge         /health do site e /api/v1/health da api, pelo Front Door de produção
//   cleanup            confirma o deploy e desativa as revisões antigas
//   roll-roles         leva worker, job de decisões e agendadores para a imagem nova
//   rollback           volta o tráfego às revisões antigas, tira o label das novas e as desativa (se ainda não confirmado)
//   revert <revisão>   volta UMA revisão à mão, depois de um deploy confirmado (docs/DEPLOY.md, seção 6)
//
// A GARANTIA de que uma prova falha mantém a revisão antiga com 100%:
//  1. `pin` roda antes de qualquer revisão nova existir. Com o tráfego fixado por nome (e não "sempre a
//     última"), a Azure cria a revisão nova com 0% (Microsoft Learn, "Traffic splitting").
//  2. `create` confere isso depois de criar e de pôr o label (que, pela documentação, vale sem peso de tráfego) e, se a Azure
//     mandar tráfego para a nova, devolve na hora.
//  3. Só `promote` move tráfego para a revisão nova, e o workflow só chega nele depois do smoke no label e do Playwright mobile pelo
//     Front Door verde daquele app. A api vai antes: o web novo pode depender dela, e a migration é só aditiva.
//  4. `rollback` (passo `if: failure() || cancelled()`) devolve 100% à antiga, tira o label e desativa a nova, nos dois apps.
//  5. Depois de `cleanup` (deploy confirmado) o rollback não faz mais nada: a antiga já foi desativada. Voltar de lá é `revert`.
//
// O PERFIL ECONÔMICO (ADR 0039; docs/DEPLOY.md, seção 1): sem Front Door, a api tem ingress INTERNO e o endereço do label dela
// (<app>---green.internal.<domínio>) só responde dentro do ambiente (fora, o proxy do ambiente dá 404: Learn, "Communicate between container
// apps"). Então a api verde é provada só pelas sondas da plataforma (`probe-green api`: o label na revisão nova, Provisioned, Healthy e
// ativa), um portão mais fraco que o do padrão; o web verde (ingress externo) leva o smoke no label e o Playwright no endereço do label
// (`green-url web`), e o web novo já fala com a api nova pelo repasse do site. A mesma garantia de tráfego vale: só `promote` vira.
//
// O estado entre passos fica num arquivo JSON (DEPLOY_STATE). As entradas vêm do ambiente, que o workflow
// declara: RESOURCE_GROUP, REGISTRY (servidor do ACR, ou ghcr.io/<dono> no econômico), IMAGE_TAG, REVISION_SUFFIX, SITE_URL e
// DEPLOY_STATE.
// Saída: 0 passo ok · 1 o passo falhou · 2 uso errado ou variável de ambiente faltando.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Ordem da virada: a api primeiro, para o site novo nunca falar com uma api mais velha que ele.
const APPS = ['ca-api', 'ca-web'];
const SHORT = { api: 'ca-api', web: 'ca-web' };
const IMAGE = { 'ca-api': 'alvesting-api', 'ca-web': 'alvesting-web' };
const SERVICE = { 'ca-api': 'api', 'ca-web': 'web' };
const SMOKE_PATHS = { 'ca-api': ['/health', '/api/v1/health'], 'ca-web': ['/health'] };
// O label da revisão em prova (Learn, "Blue-green deployment in Azure Container Apps"). Mora numa revisão por vez e muda de dono sozinho:
// o endereço dele (<app>---green.<domínio do ambiente>) é fixo, e o endpoint green do Front Door aponta para ele (infra/modules/frontdoor.bicep).
const LABEL = 'green';

// Esperas: tentativas × intervalo, para o teste não depender de relógio.
const READY = { attempts: 120, intervalMs: 5_000 }; // 10 min: a primeira puxada da imagem de ~900 MB é a parte lenta
// O portão do econômico (`probe-green`): saudável em 3 leituras seguidas, 10 s entre elas, o período da sonda de liveness
// (infra/modules/containerapps.bicep): uma revisão que sobe e cai em seguida não passa.
const STABLE = { checks: 3, intervalMs: 10_000 };
const SMOKE = { attempts: 12, intervalMs: 5_000 }; // 1 min por URL (a borda leva um instante para enxergar)
const MIGRATE = { attempts: 90, intervalMs: 10_000 }; // 15 min, o timeout do job

const NEEDS = {
  'current-tags': ['RESOURCE_GROUP'],
  pin: ['RESOURCE_GROUP', 'DEPLOY_STATE'],
  migrate: ['RESOURCE_GROUP', 'REGISTRY', 'IMAGE_TAG'],
  create: ['RESOURCE_GROUP', 'REGISTRY', 'IMAGE_TAG', 'REVISION_SUFFIX', 'DEPLOY_STATE'],
  'smoke-green': ['RESOURCE_GROUP', 'DEPLOY_STATE'],
  'probe-green': ['RESOURCE_GROUP', 'DEPLOY_STATE'],
  'green-url': ['RESOURCE_GROUP', 'DEPLOY_STATE'],
  'smoke-edge': ['SITE_URL'],
  promote: ['RESOURCE_GROUP', 'DEPLOY_STATE'],
  cleanup: ['RESOURCE_GROUP', 'DEPLOY_STATE'],
  'roll-roles': ['RESOURCE_GROUP', 'REGISTRY', 'IMAGE_TAG'],
  rollback: ['RESOURCE_GROUP', 'DEPLOY_STATE'],
  revert: ['RESOURCE_GROUP'],
};

// --- az e estado -----------------------------------------------------------------------------------

// execFile com lista de argumentos: nada passa por shell. --only-show-errors tira o ruído de aviso do stderr.
async function realAz(args) {
  try {
    const { stdout } = await run('az', [...args, '--only-show-errors', '-o', 'json'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const text = stdout.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (error) {
    const detail = String(error.stderr || error.message).trim();
    throw new Error(`az ${args.slice(0, 4).join(' ')} falhou: ${detail}`);
  }
}

async function loadState(ctx) {
  try {
    return JSON.parse(await readFile(ctx.env.DEPLOY_STATE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveState(ctx, state) {
  await mkdir(path.dirname(ctx.env.DEPLOY_STATE), { recursive: true });
  await writeFile(ctx.env.DEPLOY_STATE, JSON.stringify(state, null, 2));
}

const needState = async (ctx) => {
  const state = await loadState(ctx);
  if (!state) throw new Error('sem estado do deploy: rode o passo "pin" antes');
  return state;
};

// A revisão nova de um app, ou o erro que diz qual passo faltou.
const newRevisionOf = (state, app) => {
  const revision = state.apps[app]?.new;
  if (!revision)
    throw new Error(`${app}: a revisão nova ainda não foi criada: rode "create" antes`);
  return revision;
};

const group = (ctx) => ['-g', ctx.env.RESOURCE_GROUP];
const imageOf = (ctx, app) => `${ctx.env.REGISTRY}/${IMAGE[app]}:${ctx.env.IMAGE_TAG}`;

// --- tráfego ---------------------------------------------------------------------------------------

async function setTraffic(ctx, app, revision) {
  await ctx.az([
    'containerapp',
    'ingress',
    'traffic',
    'set',
    ...group(ctx),
    '-n',
    app,
    '--revision-weight',
    `${revision}=100`,
  ]);
}

const trafficOf = (ctx, app) =>
  ctx.az(['containerapp', 'ingress', 'traffic', 'show', ...group(ctx), '-n', app]);

// Quem tem tráfego agora (peso > 0).
async function holders(ctx, app) {
  const traffic = await trafficOf(ctx, app);
  return (traffic ?? []).filter((entry) => entry.weight > 0);
}

// 100% numa revisão só, citada pelo nome (não pela regra "última").
async function onlyOn(ctx, app, revision) {
  const [only, ...others] = await holders(ctx, app);
  return (
    others.length === 0 &&
    only?.weight === 100 &&
    only.revisionName === revision &&
    !only.latestRevision
  );
}

// A revisão que está servindo o app: a única com 100%. Qualquer outra situação (divisão, nada) é recusada,
// porque "voltar para a antiga" deixaria de ter um alvo certo.
async function currentRevision(ctx, app) {
  const active = await holders(ctx, app);
  if (active.length !== 1 || active[0].weight !== 100) {
    throw new Error(
      `${app}: o tráfego não está 100% numa revisão só (${JSON.stringify(active)}); acerte à mão antes de publicar`,
    );
  }
  if (active[0].revisionName) return active[0].revisionName;
  if (active[0].latestRevision) {
    const shown = await ctx.az(['containerapp', 'show', ...group(ctx), '-n', app]);
    const name = shown?.properties?.latestReadyRevisionName;
    if (name) return name;
  }
  throw new Error(`${app}: não consegui descobrir qual revisão está no ar`);
}

// A revisão que tem o label green agora (ou undefined). O label mora numa revisão por vez.
async function labelHolder(ctx, app) {
  const entry = ((await trafficOf(ctx, app)) ?? []).find((e) => e.label === LABEL);
  return entry?.revisionName ?? (entry?.latestRevision ? 'latest' : undefined);
}

// O endereço do app, pela ingress dele: <app>.<domínio do ambiente>, ou <app>.internal.<domínio> quando o ingress é interno (a api do
// perfil econômico), que só responde dentro do ambiente (Learn, "Communicate between container apps": de fora, o proxy do ambiente dá 404).
async function ingressOf(ctx, app) {
  const shown = await ctx.az(['containerapp', 'show', ...group(ctx), '-n', app]);
  const ingress = shown?.properties?.configuration?.ingress;
  const fqdn = ingress?.fqdn;
  if (typeof fqdn !== 'string' || !fqdn.startsWith(`${app}.`)) {
    throw new Error(`${app}: não consegui descobrir o endereço do app (ingress desligado?)`);
  }
  return { fqdn, internal: ingress.external === false };
}

// O endereço do label: <app>---green.<domínio do ambiente> (ou .internal.<domínio>), três hífens (Learn, "Blue-green deployment in Azure
// Container Apps" e "Communicate between container apps", "Revision label FQDNs").
const labelUrlOf = (app, fqdn) => `https://${app}---${LABEL}.${fqdn.slice(app.length + 1)}`;

// O label tem de estar na revisão nova: senão a prova seria de outra revisão.
async function assertLabel(ctx, app, revision) {
  const holder = await labelHolder(ctx, app);
  if (holder !== revision) {
    throw new Error(
      `${app}: o label ${LABEL} não está na revisão ${revision} (está em ${holder ?? 'nenhuma'}); o smoke provaria outra revisão`,
    );
  }
}

// --- passos ----------------------------------------------------------------------------------------

const tagOf = (image) => /:([^:/@]+)$/.exec(image ?? '')?.[1] ?? 'latest';

// A tag da imagem que está servindo cada app. O Bicep define a revisão pelo template: quem roda a infra (ou o
// what-if do CI) precisa informar a tag que está no ar, senão a infra reverte o deploy (docs/INFRA.md, 7.3).
// Lê da revisão com tráfego, e não do template do app, que depois de um rollback ainda guarda a imagem que falhou.
// Sem o app (antes do primeiro deploy) ou sem uma revisão única no ar, vale latest, com aviso.
export async function currentTags(ctx) {
  const tags = {};
  for (const app of APPS) {
    try {
      const revision = await currentRevision(ctx, app);
      const shown = await showRevision(ctx, app, revision);
      tags[`${SERVICE[app]}ImageTag`] = tagOf(shown.properties.template.containers[0].image);
    } catch (error) {
      ctx.warn?.(`${app}: ${error.message}; usando a tag latest`);
      tags[`${SERVICE[app]}ImageTag`] = 'latest';
    }
  }
  return tags;
}

export async function pin(ctx) {
  const apps = {};
  for (const app of APPS) {
    // Antes da fase 2 da infra os apps não existem. Diz isso claramente, em vez de só repassar o erro do az.
    await ctx.az(['containerapp', 'show', ...group(ctx), '-n', app]).catch((error) => {
      throw new Error(
        `não consegui ler ${app} no grupo ${ctx.env.RESOURCE_GROUP}. Ele existe? A fase 2 da infra já rodou? (docs/DEPLOY.md, "Primeiro deploy"). ${error.message}`,
      );
    });
    apps[app] = { old: await currentRevision(ctx, app), new: null };
  }
  // O estado vai para o disco antes de mexer em qualquer coisa: o rollback precisa saber para onde voltar.
  await saveState(ctx, { apps, committed: false });
  for (const app of APPS) {
    await setTraffic(ctx, app, apps[app].old);
    if (!(await onlyOn(ctx, app, apps[app].old))) {
      throw new Error(`${app}: não consegui fixar o tráfego em ${apps[app].old}`);
    }
    ctx.log(`${app}: 100% do tráfego fixado em ${apps[app].old}`);
  }
}

export async function migrate(ctx) {
  const job = 'job-migrate';
  const image = `${ctx.env.REGISTRY}/${IMAGE['ca-api']}:${ctx.env.IMAGE_TAG}`;
  // `job start --image` trocaria o contêiner inteiro (sem o comando do prisma); atualizar o job mantém o resto.
  await ctx.az(['containerapp', 'job', 'update', ...group(ctx), '-n', job, '--image', image]);
  const started = await ctx.az(['containerapp', 'job', 'start', ...group(ctx), '-n', job]);
  const execution = started?.name;
  if (!execution) throw new Error(`${job}: a Azure não devolveu o nome da execução`);
  ctx.log(`${job}: execução ${execution} iniciada com ${image}`);

  for (let i = 0; i < MIGRATE.attempts; i++) {
    const shown = await ctx.az([
      'containerapp',
      'job',
      'execution',
      'show',
      ...group(ctx),
      '-n',
      job,
      '--job-execution-name',
      execution,
    ]);
    const status = shown?.properties?.status;
    if (status === 'Succeeded') {
      ctx.log(`${job}: migrations aplicadas e login da api no banco conferido`);
      return;
    }
    if (status === 'Failed' || status === 'Stopped' || status === 'Degraded') {
      throw new Error(
        `${job}: a execução ${execution} terminou com status ${status}; veja o log no portal`,
      );
    }
    await ctx.sleep(MIGRATE.intervalMs);
  }
  throw new Error(`${job}: a execução ${execution} não terminou em 15 minutos`);
}

async function showRevision(ctx, app, revision) {
  return ctx.az([
    'containerapp',
    'revision',
    'show',
    ...group(ctx),
    '-n',
    app,
    '--revision',
    revision,
  ]);
}

async function waitReady(ctx, app, revision) {
  for (let i = 0; i < READY.attempts; i++) {
    const { properties: p } = await showRevision(ctx, app, revision);
    if (p.provisioningState === 'Failed') throw new Error(`${revision} falhou ao provisionar`);
    if (p.provisioningState === 'Provisioned' && p.healthState === 'Healthy' && p.active) return;
    await ctx.sleep(READY.intervalMs);
  }
  throw new Error(`${revision} não ficou saudável em 10 minutos`);
}

// A revisão nova tem de seguir sem tráfego. Se a Azure fizer diferente (ao criá-la ou ao pôr o label), devolve à antiga e para.
async function keepTraffic(ctx, app, old, when) {
  if (await onlyOn(ctx, app, old)) return;
  await setTraffic(ctx, app, old);
  throw new Error(`${app}: a revisão nova recebeu tráfego ${when}; o tráfego voltou para ${old}`);
}

// A revisão nova de UM app, com 0% de tráfego e o label green. Só depois de ela ficar saudável é que o label entra: sem revisão pronta o
// endereço do label não serve nada, e o label de uma revisão que não subiu não tem o que provar. O `--yes` é de verdade necessário: o
// label muda de dono (estava na revisão que ficou no ar no deploy anterior) e a CLI pergunta antes; sem TTY, no CI, a pergunta é um erro.
export async function create(ctx, app) {
  const state = await needState(ctx);
  const suffix = ctx.env.REVISION_SUFFIX;
  // O nome da revisão é <app>--<sufixo>. Vai para o estado antes de criar: se o `update` morrer no meio, o
  // rollback ainda sabe o que desativar.
  const revision = `${app}--${suffix}`;
  state.apps[app].new = revision;
  await saveState(ctx, state);

  await ctx.az([
    'containerapp',
    'update',
    ...group(ctx),
    '-n',
    app,
    '--image',
    imageOf(ctx, app),
    '--revision-suffix',
    suffix,
  ]);
  const shown = await ctx.az(['containerapp', 'show', ...group(ctx), '-n', app]);
  if (shown?.properties?.latestRevisionName !== revision) {
    throw new Error(
      `${app}: a revisão ${revision} não apareceu (a última é ${shown?.properties?.latestRevisionName})`,
    );
  }
  await keepTraffic(ctx, app, state.apps[app].old, 'ao nascer');
  await waitReady(ctx, app, revision);
  await ctx.az([
    'containerapp',
    'revision',
    'label',
    'add',
    ...group(ctx),
    '-n',
    app,
    '--label',
    LABEL,
    '--revision',
    revision,
    '--yes',
  ]);
  await keepTraffic(ctx, app, state.apps[app].old, `ao receber o label ${LABEL}`);
  ctx.log(`${app}: revisão ${revision} criada com 0% de tráfego e o label ${LABEL}`);
}

// GET que exige o envelope de health do serviço certo. Tenta de novo: a revisão e a borda levam um instante.
async function expectHealthy(ctx, label, url, service) {
  let reason = '';
  for (let i = 0; i < SMOKE.attempts; i++) {
    try {
      const response = await ctx.fetch(url, {
        headers: { 'Cache-Control': 'no-cache' },
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== 200) {
        reason = `status ${response.status}`;
      } else {
        const body = await response.json().catch(() => null);
        if (body?.success === true && body.data?.status === 'ok' && body.data.service === service) {
          ctx.log(`${label}: ${url} respondeu ok (${service})`);
          return;
        }
        reason = `200 sem o envelope esperado com service "${service}"`;
      }
    } catch (error) {
      reason = String(error.message ?? error);
    }
    await ctx.sleep(SMOKE.intervalMs);
  }
  throw new Error(`${label}: ${url} não ficou saudável (${reason})`);
}

// O /health no endereço do LABEL (<app>---green.<domínio>), que o Container Apps documenta para provar a revisão sem afetar o tráfego. O
// /health é o que a trava de origem deixa passar sem cabeçalho (ADR 0018). Antes, confere que o label está mesmo na revisão nova: se ele
// estivesse noutra, o smoke provaria a revisão errada. O resto (as rotas, o WAF, a trava de origem) o Playwright prova pelo Front Door verde.
export async function smokeGreen(ctx, app) {
  const state = await needState(ctx);
  const revision = newRevisionOf(state, app);
  await assertLabel(ctx, app, revision);
  const { fqdn, internal } = await ingressOf(ctx, app);
  if (internal) {
    throw new Error(
      `${app}: o ingress é interno (perfil econômico) e o endereço do label só responde dentro do ambiente; a prova dele é o probe-green`,
    );
  }
  const base = labelUrlOf(app, fqdn);
  for (const route of SMOKE_PATHS[app]) {
    await expectHealthy(ctx, app, `${base}${route}`, SERVICE[app]);
  }
}

// O portão do perfil econômico para a revisão que o runner não alcança (a api, de ingress interno): o label green na revisão nova, e ela
// Provisioned, Healthy e ativa em STABLE.checks leituras seguidas, que é o que as sondas de startup, readiness e liveness da plataforma dizem
// (GET /health no contêiner, infra/modules/containerapps.bicep). É mais fraco que o smoke do padrão: não prova rota nenhuma além do /health,
// nem a borda, nem o caminho do site até ela. Quem prova o par é o Playwright do web verde, que fala com a api nova pelo repasse do site,
// depois da virada da api (docs/DEPLOY.md, seção 1). A revisão segue sem tráfego: a conferência de `create` vale de novo aqui.
export async function probeGreen(ctx, app) {
  const state = await needState(ctx);
  const revision = newRevisionOf(state, app);
  await assertLabel(ctx, app, revision);
  let healthy = 0;
  for (let i = 0; i < READY.attempts && healthy < STABLE.checks; i++) {
    const { properties: p } = await showRevision(ctx, app, revision);
    if (p.provisioningState === 'Failed') throw new Error(`${revision} falhou ao provisionar`);
    healthy =
      p.provisioningState === 'Provisioned' && p.healthState === 'Healthy' && p.active
        ? healthy + 1
        : 0;
    if (healthy < STABLE.checks) await ctx.sleep(STABLE.intervalMs);
  }
  if (healthy < STABLE.checks) {
    throw new Error(`${revision} não ficou saudável por ${STABLE.checks} leituras seguidas`);
  }
  await keepTraffic(ctx, app, state.apps[app].old, 'na espera pelas sondas');
  ctx.log(
    `${app}: revisão ${revision} pronta e saudável pelas sondas da plataforma (o portão do perfil econômico, sem smoke no label)`,
  );
}

// O endereço do label green do app (o web do perfil econômico, de ingress externo), para o Playwright: o workflow junta a linha
// `GREEN_URL=<endereço>` ao GITHUB_ENV. Confere antes que o label está na revisão nova e recusa o app de ingress interno.
export async function greenUrl(ctx, app) {
  const state = await needState(ctx);
  await assertLabel(ctx, app, newRevisionOf(state, app));
  const { fqdn, internal } = await ingressOf(ctx, app);
  if (internal) {
    throw new Error(`${app}: o ingress é interno; o endereço do label não responde ao runner`);
  }
  return labelUrlOf(app, fqdn);
}

export async function smokeEdge(ctx) {
  const site = ctx.env.SITE_URL.replace(/\/+$/, '');
  await expectHealthy(ctx, 'site', `${site}/health`, 'web');
  await expectHealthy(ctx, 'api', `${site}/api/v1/health`, 'api');
}

// Os 100% de UM app para a revisão nova. O workflow chama a api primeiro e o web depois.
export async function promote(ctx, app) {
  const state = await needState(ctx);
  const revision = newRevisionOf(state, app);
  await setTraffic(ctx, app, revision);
  if (!(await onlyOn(ctx, app, revision))) {
    throw new Error(`${app}: o tráfego não foi para ${revision}`);
  }
  ctx.log(`${app}: 100% do tráfego em ${revision}`);
}

async function activeRevisions(ctx, app) {
  const revisions = await ctx.az(['containerapp', 'revision', 'list', ...group(ctx), '-n', app]);
  return (revisions ?? []).filter((r) => r.properties.active).map((r) => r.name);
}

const deactivate = (ctx, app, revision) =>
  ctx.az([
    'containerapp',
    'revision',
    'deactivate',
    ...group(ctx),
    '-n',
    app,
    '--revision',
    revision,
  ]);

// Ponto sem volta: daqui o rollback não faz mais nada, porque as antigas vão ser desativadas. O tráfego já
// está nas novas e o smoke pelo Front Door de produção já passou com elas. O label green fica na revisão que está no ar (o endpoint green
// do Front Door segue com origem saudável) e muda de dono no deploy seguinte.
export async function cleanup(ctx) {
  const state = await needState(ctx);
  // Sem a revisão nova no estado, "todas menos a nova" seria todas, a que está servindo inclusive.
  for (const app of APPS) newRevisionOf(state, app);
  state.committed = true;
  await saveState(ctx, state);
  for (const app of APPS) {
    for (const revision of await activeRevisions(ctx, app)) {
      if (revision === state.apps[app].new) continue;
      await deactivate(ctx, app, revision);
      ctx.log(`${app}: revisão ${revision} desativada`);
    }
  }
}

// Worker, job de decisões e agendadores rodam a MESMA imagem da api (plano 4), só com outro comando. Quem
// roda a imagem da api e não é a ca-api (que vai por revisão) precisa ir para a imagem nova, senão fica velho.
// Eles NÃO têm revisão para provar nem para voltar (job não tem; o worker é de revisão única): o que muda é a imagem do template, na
// próxima execução (docs/DEPLOY.md, seção 1, sobre o que acontece se este passo falhar).
export async function rollRoles(ctx) {
  const image = imageOf(ctx, 'ca-api');
  const prefix = `${ctx.env.REGISTRY}/${IMAGE['ca-api']}:`;
  const stale = (list) =>
    (list ?? [])
      .filter((r) => {
        const current = r.properties?.template?.containers?.[0]?.image ?? '';
        return current.startsWith(prefix) && current !== image;
      })
      .map((r) => r.name);

  const apps = stale(await ctx.az(['containerapp', 'list', ...group(ctx)])).filter(
    (n) => !APPS.includes(n),
  );
  const jobs = stale(await ctx.az(['containerapp', 'job', 'list', ...group(ctx)]));
  for (const name of apps) {
    await ctx.az(['containerapp', 'update', ...group(ctx), '-n', name, '--image', image]);
    ctx.log(`${name}: imagem ${image}`);
  }
  for (const name of jobs) {
    await ctx.az(['containerapp', 'job', 'update', ...group(ctx), '-n', name, '--image', image]);
    ctx.log(`${name}: imagem ${image}`);
  }
}

// Idempotente: pode rodar duas vezes, ou sem nada a desfazer. Tenta tudo e só no fim reclama dos erros.
// Por app: o tráfego volta à antiga (nos dois, inclusive na api que já tinha virado), o label green sai da nova (se for ela que o tem) e a
// nova é desativada.
export async function rollback(ctx) {
  const state = await loadState(ctx);
  if (!state) {
    ctx.log('rollback: o deploy nem chegou a fixar o tráfego; nada a desfazer');
    return;
  }
  if (state.committed) {
    ctx.log('rollback: o deploy já foi confirmado; nada a desfazer');
    return;
  }
  const errors = [];
  for (const app of APPS) {
    const { old, new: created } = state.apps[app] ?? {};
    if (!old) continue;
    try {
      await setTraffic(ctx, app, old);
      ctx.log(`${app}: 100% do tráfego de volta em ${old}`);
    } catch (error) {
      errors.push(`${app}: tráfego: ${error.message}`);
    }
    if (!created || created === old) continue;
    try {
      if ((await labelHolder(ctx, app)) === created) {
        await ctx.az([
          'containerapp',
          'revision',
          'label',
          'remove',
          ...group(ctx),
          '-n',
          app,
          '--label',
          LABEL,
        ]);
        ctx.log(`${app}: label ${LABEL} tirado de ${created}`);
      }
    } catch (error) {
      errors.push(`${app}: tirar o label ${LABEL}: ${error.message}`);
    }
    try {
      if ((await activeRevisions(ctx, app)).includes(created)) {
        await deactivate(ctx, app, created);
        ctx.log(`${app}: revisão ${created} desativada`);
      }
    } catch (error) {
      errors.push(`${app}: desativar ${created}: ${error.message}`);
    }
  }
  if (errors.length > 0) throw new Error(`rollback incompleto: ${errors.join('; ')}`);
}

// Volta UMA revisão à mão, depois de um deploy confirmado (as antigas estão desativadas): `node scripts/deploy.mjs revert ca-api--<sufixo>`.
// Reativa a revisão se for preciso, espera ficar saudável, passa a ela os 100% e desativa a que servia (a defeituosa; reativa-se com
// `az containerapp revision activate` para investigar). Confere o /health do app no fim. Só mexe no app da revisão: voltar os dois é rodar duas
// vezes. Não toca no label (ele é do deploy) nem nos jobs (docs/DEPLOY.md, seção 6).
export async function revert(ctx, revision) {
  const app = APPS.find((name) => revision.startsWith(`${name}--`));
  if (!app) {
    throw new Error(
      `"${revision}" não é o nome de uma revisão de ca-api ou ca-web (o formato é <app>--<sufixo>; veja \`az containerapp revision list --all\`: sem o --all a CLI só lista as ativas, e as antigas estão desativadas)`,
    );
  }
  const current = await currentRevision(ctx, app);
  if (current === revision) {
    ctx.log(`${app}: ${revision} já é a revisão no ar; nada a fazer`);
    return;
  }
  const shown = await showRevision(ctx, app, revision);
  if (!shown.properties.active) {
    await ctx.az([
      'containerapp',
      'revision',
      'activate',
      ...group(ctx),
      '-n',
      app,
      '--revision',
      revision,
    ]);
    ctx.log(`${app}: revisão ${revision} reativada`);
  }
  await waitReady(ctx, app, revision);
  await setTraffic(ctx, app, revision);
  if (!(await onlyOn(ctx, app, revision))) {
    throw new Error(`${app}: o tráfego não foi para ${revision}`);
  }
  ctx.log(`${app}: 100% do tráfego em ${revision}`);
  await deactivate(ctx, app, current);
  ctx.log(`${app}: revisão ${current} desativada`);
  const { fqdn, internal } = await ingressOf(ctx, app);
  if (!internal) {
    for (const route of SMOKE_PATHS[app]) {
      await expectHealthy(ctx, app, `https://${fqdn}${route}`, SERVICE[app]);
    }
  } else if (ctx.env.SITE_URL) {
    // a api de ingress interno (perfil econômico) se confere pelo repasse do site, que a alcança
    await expectHealthy(ctx, app, `${ctx.env.SITE_URL.replace(/\/+$/, '')}/api/v1/health`, 'api');
  } else {
    ctx.warn?.(
      `${app}: o ingress é interno; conferido só pelas sondas (com SITE_URL, a conferência passa pelo site)`,
    );
  }
}

// --- linha de comando ------------------------------------------------------------------------------

const STEPS = {
  'current-tags': async (ctx) => {
    const tags = await currentTags(ctx);
    for (const [name, value] of Object.entries(tags)) ctx.log(`${name}=${value}`);
  },
  pin,
  migrate,
  create,
  'smoke-green': smokeGreen,
  'probe-green': probeGreen,
  // só a linha nome=valor no stdout: ela vai direto para o GITHUB_ENV
  'green-url': async (ctx, app) => ctx.log(`GREEN_URL=${await greenUrl(ctx, app)}`),
  'smoke-edge': smokeEdge,
  promote,
  cleanup,
  'roll-roles': rollRoles,
  rollback,
  revert,
};

// Os passos que cuidam de UM app pedem `api` ou `web`; o `revert`, o nome da revisão.
const PER_APP = new Set(['create', 'smoke-green', 'probe-green', 'green-url', 'promote']);

const USAGE = `Uso: node scripts/deploy.mjs <current-tags | pin | migrate | create api|web | smoke-green api|web | probe-green api|web | green-url api|web | smoke-edge | promote api|web | cleanup | roll-roles | rollback | revert <revisão>>`;

/** @returns {Promise<number>} código de saída */
export async function main(argv, env = process.env, io = console, deps = {}) {
  const name = argv[0];
  const step = STEPS[name];
  if (!step) {
    io.error(USAGE);
    return 2;
  }
  let arg;
  if (PER_APP.has(name)) {
    arg = SHORT[argv[1]];
    if (!arg) {
      io.error(`"${name}" pede o app: api ou web (${USAGE})`);
      return 2;
    }
  } else if (name === 'revert') {
    arg = argv[1];
    if (!arg) {
      io.error('"revert" pede o nome da revisão, por exemplo ca-api--r1234567-12-1');
      return 2;
    }
  }
  const missing = NEEDS[name].filter((variable) => !env[variable]);
  if (missing.length > 0) {
    io.error(`faltam variáveis de ambiente para "${name}": ${missing.join(', ')}`);
    return 2;
  }
  const ctx = {
    az: deps.az ?? realAz,
    fetch: deps.fetch ?? globalThis.fetch,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    log: io.log.bind(io),
    warn: io.error.bind(io),
    env,
  };
  try {
    await step(ctx, arg);
    return 0;
  } catch (error) {
    io.error(`erro em "${name}": ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
