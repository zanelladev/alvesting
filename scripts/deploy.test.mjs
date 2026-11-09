import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  cleanup,
  create,
  currentTags,
  greenUrl,
  main,
  migrate,
  pin,
  probeGreen,
  promote,
  revert,
  rollback,
  rollRoles,
  smokeEdge,
  smokeGreen,
} from './deploy.mjs';

const REGISTRY = 'cralvesting.azurecr.io';
const TAG = 'abc123def456';
const SUFFIX = 'rabc123d-7-1';
const SITE = 'https://alvesting-x.z01.azurefd.net';
const RG = 'rg-alvesting-prod';
const DOMAIN = 'env.eastus2.azurecontainerapps.io';
// O endereço do LABEL de cada app: <app>---green.<domínio do ambiente> (Learn, "Blue-green deployment in Azure Container Apps").
const GREEN = { api: `https://ca-api---green.${DOMAIN}`, web: `https://ca-web---green.${DOMAIN}` };
// O endereço próprio de cada app (o que balanceia por peso), onde o `revert` confere o /health.
const APP = { api: `https://ca-api.${DOMAIN}`, web: `https://ca-web.${DOMAIN}` };
// O perfil econômico (ADR 0039): as imagens no GHCR, o site no endereço do ca-web e a api de ingress INTERNO, cujo endereço (e o do label)
// tem o `.internal.` e só responde dentro do ambiente (Learn, "Communicate between container apps").
const GHCR = 'ghcr.io/zanelladev';
const ECO_SITE = APP.web;
const INTERNAL = {
  api: `https://ca-api.internal.${DOMAIN}`,
  apiGreen: `https://ca-api---green.internal.${DOMAIN}`,
};

const flag = (args, name) => args[args.indexOf(name) + 1];
const has = (args, ...words) => words.every((word, i) => args[i] === word);

// Um Container Apps de mentira, só com as regras da Azure que o deploy usa (Microsoft Learn, "Revisions", "Traffic splitting" e
// "Blue-green deployment"): com a regra "sempre a última" (latestRevision com peso), a revisão mais nova recebe o tráfego; com o tráfego
// fixado em revisões por nome, a nova nasce com 0%. `newTakesTraffic` simula a Azure quebrando essa regra, e `labelTakesTraffic`, o label
// mexendo no tráfego.
// O `traffic set` imita o `az containerapp ingress traffic set` real (azure-cli 2.86, _update_revision_weights e
// _update_weights): não substitui a lista, MESCLA. A entrada citada ganha o peso, as outras são reescaladas para
// somar 100, e nenhuma é apagada (a regra "última" fica na lista com peso 0), o label inclusive.
// O `revision label add` e o `remove` imitam o código do mesmo azure-cli (add_revision_label e remove_revision_label): o label só mora
// numa revisão por vez e MUDA de dono ao ser adicionado; se ele já está noutra revisão e não vai `--yes`, a CLI pergunta (e sem TTY, no
// CI, falha); a revisão sem entrada na lista ganha uma com peso 0; o `remove` de um label que ninguém tem é erro.
// `internalApi` é o perfil econômico: o ingress da ca-api é interno (external false, endereço <app>.internal.<domínio>).
function azure({
  traffic = 'latest',
  newTakesTraffic = false,
  labelTakesTraffic = false,
  staleGreenOnOld = false,
  migrationStatus = 'Succeeded',
  missing = [],
  internalApi = false,
  registry = REGISTRY,
} = {}) {
  const log = [];
  const state = { apps: {}, jobs: {} };
  const revision = (name, app, image, active = true) => ({
    name,
    app,
    image,
    properties: {
      active,
      template: { containers: [{ image }] },
      fqdn: `${name}.${DOMAIN}`,
      provisioningState: 'Provisioned',
      healthState: 'Healthy',
      runningState: 'Running',
    },
  });
  for (const [app, repo] of [
    ['ca-api', 'alvesting-api'],
    ['ca-web', 'alvesting-web'],
  ]) {
    const old = `${app}--v0`;
    const internal = internalApi && app === 'ca-api';
    state.apps[app] = {
      image: `${registry}/${repo}:antiga`,
      latest: old,
      fqdn: internal ? `${app}.internal.${DOMAIN}` : `${app}.${DOMAIN}`,
      internal,
      traffic:
        traffic === 'latest'
          ? [{ latestRevision: true, weight: 100 }]
          : traffic === 'split'
            ? [
                { revisionName: old, weight: 80 },
                { revisionName: `${app}--v-1`, weight: 20 },
              ]
            : [{ revisionName: old, weight: 100 }],
      revisions: { [old]: revision(old, app, `${registry}/${repo}:antiga`) },
    };
    // o deploy anterior deixa o label green na revisão que ficou no ar
    if (staleGreenOnOld) state.apps[app].traffic[0].label = 'green';
  }
  state.apps['ca-worker-data'] = {
    image: `${registry}/alvesting-api:antiga`,
    latest: 'ca-worker-data--v0',
    traffic: [],
    revisions: {},
  };
  for (const name of ['job-migrate', 'job-sched-news', 'job-worker-decisions']) {
    state.jobs[name] = { image: `${registry}/alvesting-api:antiga` };
  }

  for (const app of missing) delete state.apps[app];

  const weightOf = (app, name) =>
    state.apps[app].traffic
      .filter(
        (t) => t.revisionName === name || (t.latestRevision && name === state.apps[app].latest),
      )
      .reduce((sum, t) => sum + t.weight, 0);

  async function az(args) {
    log.push({ az: args.join(' ') });
    const app = flag(args, '-n');
    if (args[1] !== 'job' && args[1] !== 'list' && !state.apps[app]) {
      throw new Error(`ResourceNotFound: ${app}`);
    }
    if (has(args, 'containerapp', 'ingress', 'traffic', 'show')) {
      return structuredClone(state.apps[app].traffic);
    }
    if (has(args, 'containerapp', 'ingress', 'traffic', 'set')) {
      // O deploy só usa uma revisão com 100: as demais entradas vão a 0, mas continuam na lista (e com o label).
      const [revisionName, weight] = flag(args, '--revision-weight').split('=');
      assert.equal(Number(weight), 100, 'o fake só modela uma revisão com 100');
      const list = state.apps[app].traffic;
      for (const entry of list) entry.weight = 0;
      const existing = list.find((t) => t.revisionName === revisionName);
      if (existing) existing.weight = 100;
      else list.push({ revisionName, weight: 100, latestRevision: false });
      return structuredClone(list);
    }
    if (has(args, 'containerapp', 'revision', 'label', 'add')) {
      const target = state.apps[app];
      const label = flag(args, '--label');
      const name = flag(args, '--revision');
      if (!target.revisions[name])
        throw new Error(`Revision '${name}' is not a valid revision name.`);
      const holder = target.traffic.find((t) => t.label === label);
      if (holder && holder.revisionName !== name && !args.includes('--yes')) {
        throw new Error('NoTTYException: o label já existe em outra revisão e não foi dito --yes');
      }
      for (const entry of target.traffic) if (entry.label === label) entry.label = null;
      let entry = target.traffic.find((t) => t.revisionName === name);
      if (!entry) {
        entry = { revisionName: name, weight: 0, latestRevision: false };
        target.traffic.push(entry);
      }
      entry.label = label;
      if (labelTakesTraffic) {
        for (const other of target.traffic) other.weight = 0;
        entry.weight = 100;
      }
      return structuredClone(target.traffic);
    }
    if (has(args, 'containerapp', 'revision', 'label', 'remove')) {
      const entry = state.apps[app].traffic.find((t) => t.label === flag(args, '--label'));
      if (!entry) throw new Error('Please specify a label name with an associated traffic weight.');
      entry.label = null;
      return structuredClone(state.apps[app].traffic);
    }
    if (has(args, 'containerapp', 'update')) {
      const target = state.apps[app];
      const suffix = flag(args, '--revision-suffix');
      if (suffix) {
        const name = `${app}--${suffix}`;
        target.revisions[name] = revision(name, app, flag(args, '--image'));
        const latestRule = target.traffic.some((t) => t.latestRevision && t.weight > 0);
        target.latest = name;
        if (latestRule || newTakesTraffic) {
          for (const entry of target.traffic) entry.weight = 0;
          target.traffic.push({ revisionName: name, weight: 100, latestRevision: false });
        }
      }
      target.image = flag(args, '--image');
      return { name: app };
    }
    if (has(args, 'containerapp', 'show')) {
      const target = state.apps[app];
      return {
        properties: {
          latestRevisionName: target.latest,
          latestReadyRevisionName: target.latest,
          configuration: { ingress: { fqdn: target.fqdn, external: !target.internal } },
        },
      };
    }
    if (has(args, 'containerapp', 'revision', 'show')) {
      const found = state.apps[app].revisions[flag(args, '--revision')];
      if (!found) throw new Error(`ResourceNotFound: revisão ${flag(args, '--revision')}`);
      return {
        ...found,
        properties: { ...found.properties, trafficWeight: weightOf(app, found.name) },
      };
    }
    if (has(args, 'containerapp', 'revision', 'list')) {
      return Object.values(state.apps[app].revisions).map((r) => ({
        name: r.name,
        properties: { ...r.properties, trafficWeight: weightOf(app, r.name) },
      }));
    }
    if (has(args, 'containerapp', 'revision', 'deactivate')) {
      state.apps[app].revisions[flag(args, '--revision')].properties.active = false;
      return null;
    }
    if (has(args, 'containerapp', 'revision', 'activate')) {
      state.apps[app].revisions[flag(args, '--revision')].properties.active = true;
      return null;
    }
    if (has(args, 'containerapp', 'job', 'update')) {
      state.jobs[app].image = flag(args, '--image');
      return { name: app };
    }
    if (has(args, 'containerapp', 'job', 'start')) {
      return { name: `${app}-exec1` };
    }
    if (has(args, 'containerapp', 'job', 'execution', 'show')) {
      return { properties: { status: migrationStatus } };
    }
    if (has(args, 'containerapp', 'job', 'list')) {
      return Object.entries(state.jobs).map(([name, job]) => ({
        name,
        properties: { template: { containers: [{ image: job.image }] } },
      }));
    }
    if (has(args, 'containerapp', 'list')) {
      return Object.entries(state.apps).map(([name, a]) => ({
        name,
        properties: { template: { containers: [{ image: a.image }] } },
      }));
    }
    throw new Error(`az falso: comando sem tratamento: ${args.join(' ')}`);
  }
  return { az, state, log, weightOf };
}

// fetch de mentira: `routes` mapeia URL para uma lista de respostas (a última se repete).
function web(routes) {
  const seen = [];
  const fetchFake = async (url) => {
    seen.push(String(url));
    const replies = routes[String(url)] ?? [{ status: 502, body: 'bad gateway' }];
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), {
      status: reply.status,
    });
  };
  return { fetch: fetchFake, seen };
}
const healthy = (service) => [
  { status: 200, body: { success: true, data: { status: 'ok', service }, error: null } },
];
const okEverywhere = () => ({
  [`${GREEN.api}/health`]: healthy('api'),
  [`${GREEN.api}/api/v1/health`]: healthy('api'),
  [`${GREEN.web}/health`]: healthy('web'),
  [`${APP.api}/health`]: healthy('api'),
  [`${APP.api}/api/v1/health`]: healthy('api'),
  [`${APP.web}/health`]: healthy('web'),
  [`${SITE}/health`]: healthy('web'),
  [`${SITE}/api/v1/health`]: healthy('api'),
});

async function world(options = {}, routes = okEverywhere(), envOverrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'deploy-test-'));
  const cloud = azure(options);
  const site = web(routes);
  const events = [];
  // Uma linha do tempo só, com chamadas ao az e ao site: dá para afirmar a ordem entre elas.
  const ctx = {
    az: async (args) => {
      events.push(`az ${args.join(' ')}`);
      return cloud.az(args);
    },
    fetch: async (url, init) => {
      events.push(`get ${url}`);
      return site.fetch(url, init);
    },
    sleep: async () => {},
    log: () => {},
    env: {
      RESOURCE_GROUP: RG,
      REGISTRY,
      IMAGE_TAG: TAG,
      REVISION_SUFFIX: SUFFIX,
      SITE_URL: `${SITE}/`,
      DEPLOY_STATE: path.join(dir, 'state.json'),
      ...envOverrides,
    },
  };
  // Quem recebe tráfego agora: as entradas com peso > 0 (a lista guarda também as de peso 0).
  const trafficOf = (app) =>
    cloud.state.apps[app].traffic
      .filter((t) => t.weight > 0)
      .map((t) => ({ revisionName: t.revisionName ?? 'latest', weight: t.weight }));
  const activeOf = (app) =>
    Object.values(cloud.state.apps[app].revisions)
      .filter((r) => r.properties.active)
      .map((r) => r.name);
  // A revisão que tem o label green agora (ou undefined).
  const greenOf = (app) =>
    cloud.state.apps[app].traffic.find((t) => t.label === 'green')?.revisionName;
  return { ctx, cloud, events, trafficOf, activeOf, greenOf };
}

const OLD = { api: 'ca-api--v0', web: 'ca-web--v0' };
const NEW = { api: `ca-api--${SUFFIX}`, web: `ca-web--${SUFFIX}` };
const only = (name) => [{ revisionName: name, weight: 100 }];
const promotions = (events) =>
  events.filter((e) => /traffic set .*--revision-weight ca-\w+--r/.test(e));

// --- O workflow de verdade ----------------------------------------------------------------------------------------------------------
// O job `deploy` do deploy.yml, lido do arquivo e executado contra o Container Apps falso: cada `node scripts/deploy.mjs <passo>` roda o
// `main` do script, e cada `playwright test` chama o `playwright` que o teste dá (e que enxerga o estado do tráfego naquele instante). Assim
// a ORDEM do rollout (o green a 0% antes do smoke, a virada só depois do Playwright verde, a api antes do web) é provada no arquivo que o
// GitHub executa, e não numa cópia dela. Passos de uma linha só; o resto (instalação, login, SSE) não interessa aqui. Passo com
// `if: failure()` só roda depois de uma falha, como no GitHub, e o `if:` do perfil (`vars.ALVESTING_PROFILE == 'economico'` ou `!=`) é
// avaliado com o perfil do teste: sem perfil (o padrão de sempre), os passos do econômico não rodam.
async function jobSteps(job) {
  const text = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const start = text.indexOf(`\n  ${job}:`);
  const next = text.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  const body = next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
  return body
    .split(/\n {6}- (?=name:|uses:)/)
    .slice(1)
    .map((block) => ({
      name: /^name: (.+)$/m.exec(block)?.[1] ?? /^uses: ([^@\s]+)/.exec(block)?.[1],
      run: /^ {8}run: (.+)$/m.exec(block)?.[1],
      script: /^ {8}run: \|\n((?: {10}.*(?:\n|$))+)/m.exec(block)?.[1]?.replace(/^ {10}/gm, ''),
      cond: /^ {8}if: (.+)$/m.exec(block)?.[1] ?? '',
      baseUrl:
        /^ {10}BASE_URL: \$\{\{ vars\.(\w+) \}\}$/m.exec(block)?.[1] ??
        /BASE_URL="\$\{(\w+):\?\}"/.exec(block)?.[1],
      continueOnError: /^ {8}continue-on-error: true$/m.test(block),
    }));
}
const deploySteps = () => jobSteps('deploy');

// O `if:` do perfil no GitHub: `vars.ALVESTING_PROFILE` vale '' sem a variável.
function profileAllows(cond, profile) {
  const match = /vars\.ALVESTING_PROFILE (==|!=) 'economico'/.exec(cond);
  if (!match) return true;
  return match[1] === '==' ? profile === 'economico' : profile !== 'economico';
}

async function runWorkflow(w, { playwright = async () => {}, profile = '' } = {}) {
  const ran = [];
  const errors = [];
  // o que um passo escreveu no GITHUB_ENV (o `>> "$GITHUB_ENV"`), para os passos seguintes
  const githubEnv = {};
  let failed = false;
  for (const step of await deploySteps()) {
    if (!step.run || step.continueOnError) continue;
    if (!profileAllows(step.cond, profile)) continue;
    const onFailure = /failure\(\)|cancelled\(\)/.test(step.cond);
    if (onFailure ? !failed : failed) continue;
    const deploy = /^node scripts\/deploy\.mjs (.+?)( >> "\$GITHUB_ENV")?$/.exec(step.run);
    const e2e = /playwright test (.+)$/.exec(step.run);
    if (!deploy && !e2e) continue;
    ran.push(deploy ? deploy[1] : `playwright ${step.baseUrl}`);
    try {
      if (deploy) {
        const out = [];
        const io = { log: (line) => out.push(line), error: (line) => errors.push(line) };
        const code = await main(deploy[1].split(' '), w.ctx.env, io, {
          az: w.ctx.az,
          fetch: w.ctx.fetch,
          sleep: w.ctx.sleep,
        });
        if (code !== 0) throw new Error(errors.at(-1) ?? `saiu com ${code}`);
        if (deploy[2]) {
          for (const line of out) {
            const pair = /^(\w+)=(.*)$/.exec(line);
            assert.ok(pair, `linha que não é nome=valor no GITHUB_ENV: ${line}`);
            githubEnv[pair[1]] = pair[2];
          }
        }
      } else {
        // o `${GREEN_URL:?}` do bash: sem o valor, o passo falha antes do Playwright
        const url = githubEnv[step.baseUrl] ?? w.ctx.env[step.baseUrl] ?? step.baseUrl;
        if (/:\?\}/.test(step.run) && !githubEnv[step.baseUrl]) {
          throw new Error(`${step.baseUrl}: parameter null or not set`);
        }
        w.events.push(`playwright ${step.baseUrl} ${e2e[1]}`);
        await playwright({ baseUrl: step.baseUrl, url, args: e2e[1] });
      }
    } catch (error) {
      errors.push(String(error.message ?? error));
      failed = true;
    }
  }
  return { failed, errors, ran, githubEnv };
}

// O que o Playwright "vê" quando é chamado: o tráfego e o label de cada app naquele instante.
const recorder = (w, seen) => async (call) => {
  seen.push({
    ...call,
    api: w.trafficOf('ca-api'),
    web: w.trafficOf('ca-web'),
    apiGreen: w.greenOf('ca-api'),
    webGreen: w.greenOf('ca-web'),
  });
};

describe('pin', () => {
  it('troca a regra "sempre a última" por revisão fixa pelo nome', async () => {
    const w = await world({ traffic: 'latest' });
    await pin(w.ctx);
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
    assert.deepEqual(w.trafficOf('ca-web'), only(OLD.web));
    const saved = JSON.parse(await readFile(w.ctx.env.DEPLOY_STATE, 'utf8'));
    assert.equal(saved.apps['ca-api'].old, OLD.api);
    assert.equal(saved.committed, false);
  });

  it('com o tráfego já fixado, mantém', async () => {
    const w = await world({ traffic: 'pinned' });
    await pin(w.ctx);
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
  });

  it('app que ainda não existe (antes da fase 2 da infra): diz o que fazer e não grava estado', async () => {
    const w = await world({ missing: ['ca-api'] });
    await assert.rejects(pin(w.ctx), /fase 2 da infra/);
    await assert.rejects(readFile(w.ctx.env.DEPLOY_STATE, 'utf8'), { code: 'ENOENT' });
  });

  it('tráfego dividido entre revisões: recusa sem mudar nada', async () => {
    const w = await world({ traffic: 'split' });
    await assert.rejects(pin(w.ctx), /100%/);
    assert.equal(w.events.filter((e) => e.includes('traffic set')).length, 0);
  });
});

describe('create (a revisão nova de UM app, com o label green a 0%)', () => {
  it('cria a revisão com o label green e 0% de tráfego; a antiga segue com 100% e o outro app não é tocado', async () => {
    const w = await world({ traffic: 'latest' });
    await pin(w.ctx);
    await create(w.ctx, 'ca-api');
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
    assert.equal(w.greenOf('ca-api'), NEW.api);
    assert.deepEqual(w.activeOf('ca-api').sort(), [OLD.api, NEW.api].sort());
    const update = w.events.find(
      (e) => e.startsWith('az containerapp update') && e.includes('-n ca-api'),
    );
    assert.match(update, new RegExp(`--image ${REGISTRY}/alvesting-api:${TAG}`));
    assert.match(update, new RegExp(`--revision-suffix ${SUFFIX}`));
    // o web não foi tocado
    assert.deepEqual(w.trafficOf('ca-web'), only(OLD.web));
    assert.deepEqual(w.activeOf('ca-web'), [OLD.web]);
    assert.equal(w.greenOf('ca-web'), undefined);
    assert.equal(
      w.events.filter((e) => e.startsWith('az containerapp update') && e.includes('-n ca-web'))
        .length,
      0,
    );
  });

  it('só põe o label depois de a revisão ficar saudável, e o label não move o tráfego', async () => {
    const w = await world({ traffic: 'pinned' });
    await pin(w.ctx);
    await create(w.ctx, 'ca-api');
    const ready = w.events.findIndex((e) => e.includes('revision show') && e.includes(NEW.api));
    const label = w.events.findIndex((e) => e.includes('revision label add'));
    assert.ok(ready !== -1 && label > ready, 'o label vem depois de a revisão estar saudável');
    assert.match(w.events[label], new RegExp(`-n ca-api --label green --revision ${NEW.api}`));
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
  });

  it('o label sai da revisão que o tinha (a do deploy anterior) e passa à nova, sem perguntar (--yes: sem TTY a CLI não pergunta, falha)', async () => {
    const w = await world({ traffic: 'pinned', staleGreenOnOld: true });
    assert.equal(w.greenOf('ca-api'), OLD.api);
    await pin(w.ctx);
    await create(w.ctx, 'ca-api');
    assert.equal(w.greenOf('ca-api'), NEW.api);
    assert.match(
      w.events.find((e) => e.includes('revision label add')),
      / --yes( |$)/,
    );
  });

  it('se a Azure mandar tráfego para a revisão nova ao criar, devolve à antiga e falha', async () => {
    const w = await world({ traffic: 'latest', newTakesTraffic: true });
    await pin(w.ctx);
    await assert.rejects(create(w.ctx, 'ca-api'), /recebeu tráfego/);
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
  });

  it('a revisão que nasce com tráfego é devolvida na hora: nem espera ficar saudável (até 10 min com a doente no ar) nem ganha o label', async () => {
    const w = await world({ traffic: 'latest', newTakesTraffic: true });
    await pin(w.ctx);
    await assert.rejects(create(w.ctx, 'ca-api'), /recebeu tráfego ao nascer/);
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
    assert.equal(w.events.filter((e) => e.includes('revision show')).length, 0, 'não esperou');
    assert.equal(w.events.filter((e) => e.includes('label add')).length, 0, 'não pôs o label');
  });

  it('se o label mexer no tráfego (a Azure fizer diferente), devolve à antiga e falha', async () => {
    const w = await world({ traffic: 'pinned', labelTakesTraffic: true });
    await pin(w.ctx);
    await assert.rejects(create(w.ctx, 'ca-api'), /recebeu tráfego/);
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
  });

  it('espera a revisão ficar saudável e, se ela quebrar, falha sem pôr o label', async () => {
    const w = await world({ traffic: 'pinned' });
    await pin(w.ctx);
    const original = w.cloud.az;
    w.ctx.az = async (args) => {
      const reply = await original(args);
      if (has(args, 'containerapp', 'revision', 'show') && args.at(-1).includes('--r')) {
        reply.properties.provisioningState = 'Failed';
      }
      return reply;
    };
    await assert.rejects(create(w.ctx, 'ca-api'), /falhou ao provisionar/);
    assert.equal(w.greenOf('ca-api'), undefined, 'revisão que não subiu não ganha o label');
  });

  it('sem o `pin` antes, recusa (o rollback precisaria saber para onde voltar)', async () => {
    const w = await world();
    await assert.rejects(create(w.ctx, 'ca-api'), /sem estado/);
  });
});

describe('smoke-green (o /health no endereço do label)', () => {
  const ready = async (options, routes, apps = ['ca-api']) => {
    const w = await world(options, routes);
    await pin(w.ctx);
    for (const app of apps) await create(w.ctx, app);
    return w;
  };

  it('api: /health e /api/v1/health no endereço do LABEL, e não no do app nem no da revisão', async () => {
    const w = await ready({ traffic: 'pinned' });
    await smokeGreen(w.ctx, 'ca-api');
    const gets = w.events.filter((e) => e.startsWith('get '));
    assert.deepEqual(gets, [`get ${GREEN.api}/health`, `get ${GREEN.api}/api/v1/health`]);
  });

  it('web: /health no endereço do label', async () => {
    const w = await ready({ traffic: 'pinned' }, undefined, ['ca-web']);
    await smokeGreen(w.ctx, 'ca-web');
    assert.deepEqual(
      w.events.filter((e) => e.startsWith('get ')),
      [`get ${GREEN.web}/health`],
    );
  });

  it('recusa se o label green não está na revisão nova (o smoke provaria outra revisão)', async () => {
    const w = await ready({ traffic: 'pinned' });
    // alguém moveu o label de volta para a antiga
    await w.cloud.az([
      'containerapp',
      'revision',
      'label',
      'add',
      '-g',
      RG,
      '-n',
      'ca-api',
      '--label',
      'green',
      '--revision',
      OLD.api,
      '--yes',
    ]);
    await assert.rejects(smokeGreen(w.ctx, 'ca-api'), /label green não está/);
    assert.equal(w.events.filter((e) => e.startsWith('get ')).length, 0);
  });

  it('tenta de novo enquanto a revisão sobe e passa quando responde', async () => {
    const routes = okEverywhere();
    routes[`${GREEN.web}/health`] = [
      { status: 503, body: 'subindo' },
      { status: 503, body: 'subindo' },
      ...healthy('web'),
    ];
    const w = await ready({ traffic: 'pinned' }, routes, ['ca-web']);
    await smokeGreen(w.ctx, 'ca-web');
    assert.equal(w.events.filter((e) => e === `get ${GREEN.web}/health`).length, 3);
  });

  it('falha se a revisão nunca ficar saudável', async () => {
    const routes = okEverywhere();
    routes[`${GREEN.api}/health`] = [{ status: 500, body: 'erro' }];
    const w = await ready({ traffic: 'pinned' }, routes);
    await assert.rejects(smokeGreen(w.ctx, 'ca-api'), /ca-api.*\/health.*500/);
  });
});

describe('smoke-edge (pelo Front Door de produção)', () => {
  it('web em /health e api em /api/v1/health', async () => {
    const w = await world();
    await smokeEdge(w.ctx);
    assert.deepEqual(
      w.events.filter((e) => e.startsWith('get ')),
      [`get ${SITE}/health`, `get ${SITE}/api/v1/health`],
    );
  });

  it('recusa resposta 200 que não é a do serviço certo (rota caiu no app errado)', async () => {
    const w = await world({}, { ...okEverywhere(), [`${SITE}/api/v1/health`]: healthy('web') });
    await assert.rejects(smokeEdge(w.ctx), /service "api"/);
  });

  it('recusa resposta 200 sem o envelope (página de erro do proxy, por exemplo)', async () => {
    const w = await world(
      {},
      { ...okEverywhere(), [`${SITE}/health`]: [{ status: 200, body: '<html>' }] },
    );
    await assert.rejects(smokeEdge(w.ctx), /health/);
  });
});

describe('promote (os 100% de UM app)', () => {
  it('passa o tráfego da api para a revisão nova e não mexe no web', async () => {
    const w = await world({ traffic: 'latest' });
    await pin(w.ctx);
    await create(w.ctx, 'ca-api');
    await promote(w.ctx, 'ca-api');
    assert.deepEqual(w.trafficOf('ca-api'), only(NEW.api));
    assert.deepEqual(w.trafficOf('ca-web'), only(OLD.web));
    assert.equal(promotions(w.events).length, 1);
  });

  it('recusa promover o app cuja revisão nova ainda não foi criada', async () => {
    const w = await world({ traffic: 'latest' });
    await pin(w.ctx);
    await assert.rejects(promote(w.ctx, 'ca-web'), /create/);
    assert.equal(promotions(w.events).length, 0);
  });
});

describe('cleanup (o ponto sem volta)', () => {
  it('sem a revisão nova de um dos apps no estado, recusa sem desativar nada nem confirmar (todas menos a nova seria todas, a que serve inclusive)', async () => {
    const w = await world({ traffic: 'latest' });
    await pin(w.ctx);
    await create(w.ctx, 'ca-api'); // o web nunca foi criado
    await assert.rejects(cleanup(w.ctx), /ca-web: a revisão nova ainda não foi criada/);
    assert.equal(w.events.filter((e) => e.includes('revision deactivate')).length, 0);
    assert.deepEqual(w.activeOf('ca-web'), [OLD.web], 'a que serve segue ativa');
    // não ficou confirmado: o rollback ainda desfaz
    await rollback(w.ctx);
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
    assert.deepEqual(w.activeOf('ca-api'), [OLD.api]);
    assert.equal(w.greenOf('ca-api'), undefined);
  });
});

describe('migrate', () => {
  it('atualiza a imagem do job, dispara e espera terminar com sucesso', async () => {
    const w = await world();
    await migrate(w.ctx);
    const update = w.events.findIndex((e) => e.includes('job update') && e.includes('job-migrate'));
    const start = w.events.findIndex((e) => e.includes('job start') && e.includes('job-migrate'));
    assert.ok(update !== -1 && update < start);
    assert.match(w.events[update], new RegExp(`--image ${REGISTRY}/alvesting-api:${TAG}`));
    assert.ok(
      w.events.some((e) => e.includes('job execution show') && e.includes('job-migrate-exec1')),
    );
  });

  it('falha se a migration falhar', async () => {
    const w = await world({ migrationStatus: 'Failed' });
    await assert.rejects(migrate(w.ctx), /Failed/);
  });

  it('falha se não terminar a tempo', async () => {
    const w = await world({ migrationStatus: 'Running' });
    await assert.rejects(migrate(w.ctx), /não terminou/);
  });
});

// O coração do aceite, no deploy.yml de verdade: o green nasce a 0%, é provado (smoke no label e Playwright mobile pelo Front Door verde)
// ANTES de receber tráfego, a api vai antes do web, e nenhum caminho de falha deixa a revisão nova com tráfego.
describe('o rollout inteiro (o job deploy do deploy.yml contra o Container Apps falso)', () => {
  const MOBILE = '--project=pixel-7 --project=iphone-15';

  it('sucesso: a ordem dos passos, o green a 0% em cada prova e a api antes do web', async () => {
    const w = await world({ traffic: 'latest' });
    const seen = [];
    const result = await runWorkflow(w, { playwright: recorder(w, seen) });
    assert.equal(result.failed, false, result.errors.join('\n'));
    assert.deepEqual(result.ran, [
      'pin',
      'migrate',
      'create api',
      'smoke-green api',
      'playwright SITE_GREEN_URL',
      'promote api',
      'create web',
      'smoke-green web',
      'playwright SITE_GREEN_URL',
      'promote web',
      'smoke-edge',
      'playwright SITE_URL',
      'cleanup',
      'roll-roles',
    ]);

    // As três provas do Playwright, todas em Pixel 7 e iPhone 15 (mobile é gate de merge).
    assert.equal(seen.length, 3);
    for (const call of seen) assert.ok(call.args.includes(MOBILE), call.args);
    // 1. a api verde: SÓ os testes da api (o web verde ainda não existe), e a api nova com label e 0%
    assert.equal(seen[0].baseUrl, 'SITE_GREEN_URL');
    assert.match(seen[0].args, / --grep @api$/);
    assert.deepEqual(seen[0].api, only(OLD.api), 'a api nova ainda tem 0%');
    assert.deepEqual(seen[0].web, only(OLD.web));
    assert.equal(seen[0].apiGreen, NEW.api);
    // 2. o web verde: a suíte inteira, com a api JÁ promovida (o web novo pode depender dela) e o web novo a 0%
    assert.equal(seen[1].baseUrl, 'SITE_GREEN_URL');
    assert.doesNotMatch(seen[1].args, /--grep/);
    assert.deepEqual(seen[1].api, only(NEW.api), 'a api vem antes do web');
    assert.deepEqual(seen[1].web, only(OLD.web), 'o web novo ainda tem 0%');
    assert.equal(seen[1].webGreen, NEW.web);
    // 3. o Front Door de produção, a suíte inteira, com os dois já no ar
    assert.equal(seen[2].baseUrl, 'SITE_URL');
    assert.doesNotMatch(seen[2].args, /--grep/);
    assert.deepEqual(seen[2].api, only(NEW.api));
    assert.deepEqual(seen[2].web, only(NEW.web));

    // A linha do tempo do az e do site: label -> smoke no label -> virada, na api; só então o web nasce.
    const at = (pattern) => w.events.findIndex((e) => pattern.test(e));
    const labelApi = at(/revision label add .*-n ca-api/);
    const smokeApi = at(new RegExp(`^get ${GREEN.api}`));
    const turnApi = at(/traffic set .*-n ca-api .*--revision-weight ca-api--r/);
    const createWeb = at(/containerapp update .*-n ca-web/);
    const smokeWeb = at(new RegExp(`^get ${GREEN.web}`));
    const turnWeb = at(/traffic set .*-n ca-web .*--revision-weight ca-web--r/);
    const edge = at(new RegExp(`^get ${SITE}/health`));
    const confirm = at(/revision deactivate .*ca-api--v0/);
    for (const [before, after, why] of [
      [labelApi, smokeApi, 'o smoke da api vem depois do label'],
      [smokeApi, turnApi, 'a api só vira depois do smoke verde'],
      [turnApi, createWeb, 'o web só nasce depois de a api virar'],
      [createWeb, smokeWeb, 'o smoke do web vem depois de ele nascer'],
      [smokeWeb, turnWeb, 'o web só vira depois do smoke verde'],
      [turnWeb, edge, 'o Front Door de produção é provado depois das duas viradas'],
      [edge, confirm, 'as antigas só saem depois de tudo provado'],
    ]) {
      assert.ok(before !== -1 && after !== -1 && before < after, why);
    }
    assert.equal(promotions(w.events).length, 2, 'uma virada por app');

    // O estado final: as novas servem, as antigas saíram, e o label fica na que está no ar.
    assert.deepEqual(w.trafficOf('ca-api'), only(NEW.api));
    assert.deepEqual(w.trafficOf('ca-web'), only(NEW.web));
    assert.deepEqual(w.activeOf('ca-api'), [NEW.api]);
    assert.deepEqual(w.activeOf('ca-web'), [NEW.web]);
    assert.equal(w.greenOf('ca-api'), NEW.api);
    assert.equal(w.greenOf('ca-web'), NEW.web);
  });

  // Estado depois de uma falha antes do ponto sem volta: tudo como estava, e o green saiu.
  const unchanged = (w) => {
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
    assert.deepEqual(w.trafficOf('ca-web'), only(OLD.web));
    assert.deepEqual(w.activeOf('ca-api'), [OLD.api]);
    assert.deepEqual(w.activeOf('ca-web'), [OLD.web]);
    assert.equal(w.greenOf('ca-api'), undefined, 'o label green saiu da api');
    assert.equal(w.greenOf('ca-web'), undefined, 'o label green saiu do web');
  };

  it('o smoke do label da api falha: o tráfego nunca muda, o web nem nasce e o green sai', async () => {
    const routes = okEverywhere();
    routes[`${GREEN.api}/api/v1/health`] = [{ status: 500, body: 'erro' }];
    const w = await world({ traffic: 'latest' }, routes);
    const seen = [];
    const result = await runWorkflow(w, { playwright: recorder(w, seen) });
    assert.equal(result.failed, true);
    assert.equal(result.ran.at(-1), 'rollback');
    assert.equal(seen.length, 0, 'o Playwright nem roda');
    assert.equal(promotions(w.events).length, 0, 'a revisão nova nunca recebeu tráfego');
    assert.equal(
      w.events.filter((e) => e.startsWith('az containerapp update') && e.includes('-n ca-web'))
        .length,
      0,
      'o web nem foi criado',
    );
    unchanged(w);
  });

  it('o Playwright mobile do green da api falha: nada vira, e o green sai', async () => {
    const w = await world({ traffic: 'latest' });
    const result = await runWorkflow(w, {
      playwright: async () => {
        throw new Error('Playwright reprovou');
      },
    });
    assert.equal(result.failed, true);
    assert.deepEqual(result.ran.slice(-2), ['playwright SITE_GREEN_URL', 'rollback']);
    assert.equal(promotions(w.events).length, 0);
    unchanged(w);
  });

  it('o Playwright mobile do green do web falha com a api já promovida: o rollback devolve os DOIS à antiga', async () => {
    const w = await world({ traffic: 'latest' });
    let calls = 0;
    const result = await runWorkflow(w, {
      playwright: async () => {
        if (++calls === 2) throw new Error('Playwright reprovou no web');
      },
    });
    assert.equal(result.failed, true);
    assert.equal(promotions(w.events).length, 1, 'só a api tinha virado');
    assert.equal(result.ran.at(-1), 'rollback');
    unchanged(w);
  });

  it('o smoke pelo Front Door de produção, depois das duas viradas, falha: tudo volta à antiga', async () => {
    const w = await world(
      { traffic: 'latest' },
      { ...okEverywhere(), [`${SITE}/health`]: [{ status: 403, body: 'x' }] },
    );
    const result = await runWorkflow(w);
    assert.equal(result.failed, true);
    assert.equal(promotions(w.events).length, 2);
    unchanged(w);
  });

  it('o Playwright de produção, depois das viradas, falha: tudo volta à antiga', async () => {
    const w = await world({ traffic: 'latest' });
    let calls = 0;
    const result = await runWorkflow(w, {
      playwright: async () => {
        if (++calls === 3) throw new Error('Playwright reprovou em produção');
      },
    });
    assert.equal(result.failed, true);
    unchanged(w);
  });

  it('a migration falha: nada é criado, e o rollback não deixa rastro', async () => {
    const w = await world({ traffic: 'latest', migrationStatus: 'Failed' });
    const result = await runWorkflow(w);
    assert.equal(result.failed, true);
    assert.deepEqual(result.ran, ['pin', 'migrate', 'rollback']);
    assert.equal(w.events.filter((e) => e.startsWith('az containerapp update')).length, 0);
    unchanged(w);
  });

  it('falha ao criar o web (cota) com a api já promovida: desfaz a api também', async () => {
    const w = await world({ traffic: 'latest' });
    const original = w.ctx.az;
    w.ctx.az = async (args) => {
      if (has(args, 'containerapp', 'update') && flag(args, '-n') === 'ca-web') {
        throw new Error('quota excedida');
      }
      return original(args);
    };
    const result = await runWorkflow(w);
    assert.equal(result.failed, true);
    assert.match(result.errors.join('\n'), /quota/);
    unchanged(w);
  });

  it('depois de confirmado (cleanup), o rollback não mexe mais no tráfego', async () => {
    const w = await world({ traffic: 'latest' });
    const result = await runWorkflow(w);
    assert.equal(result.failed, false, result.errors.join('\n'));
    const before = w.events.length;
    await rollback(w.ctx);
    assert.deepEqual(w.trafficOf('ca-api'), only(NEW.api));
    assert.equal(w.events.length, before, 'nenhuma chamada ao az');
  });

  it('o rollback é idempotente e não falha sem estado (a falha veio antes do primeiro passo)', async () => {
    const w = await world({ traffic: 'latest' });
    await rollback(w.ctx);
    assert.equal(w.events.length, 0);
    await pin(w.ctx);
    await create(w.ctx, 'ca-api');
    await rollback(w.ctx);
    await rollback(w.ctx);
    unchanged(w);
  });

  it('o rollback limpa o label mesmo se o `create` morreu antes de pô-lo', async () => {
    const w = await world({ traffic: 'pinned' });
    await pin(w.ctx);
    const original = w.ctx.az;
    w.ctx.az = async (args) => {
      if (has(args, 'containerapp', 'revision', 'label', 'add')) throw new Error('label recusado');
      return original(args);
    };
    await assert.rejects(create(w.ctx, 'ca-api'), /label recusado/);
    w.ctx.az = original;
    await rollback(w.ctx);
    unchanged(w);
  });
});

describe('revert (voltar uma revisão)', () => {
  // O estado depois de um deploy confirmado: as novas servem e as antigas estão desativadas.
  const deployed = async (options) => {
    const w = await world(options);
    const result = await runWorkflow(w);
    assert.equal(result.failed, false, result.errors.join('\n'));
    return w;
  };

  it('ativa a antiga, espera ficar saudável, passa os 100%, desativa a que servia e confere o /health', async () => {
    const w = await deployed({ traffic: 'latest' });
    assert.deepEqual(w.activeOf('ca-api'), [NEW.api]);
    w.events.length = 0;
    await revert(w.ctx, OLD.api);
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
    assert.deepEqual(w.activeOf('ca-api'), [OLD.api], 'a defeituosa saiu do ar');
    assert.deepEqual(w.trafficOf('ca-web'), only(NEW.web), 'o outro app não é tocado');
    const at = (pattern) => w.events.findIndex((e) => pattern.test(e));
    const order = [
      at(/revision activate .*ca-api--v0/),
      // a ESPERA pela saúde vem depois de ativar (a primeira consulta à revisão é só para saber se ela está ativa)
      w.events.findLastIndex((e) => /revision show .*ca-api--v0/.test(e)),
      at(/traffic set .*--revision-weight ca-api--v0=100/),
      at(/revision deactivate .*ca-api--r/),
      at(new RegExp(`^get ${APP.api}/health`)),
    ];
    assert.ok(
      order.every((i) => i !== -1),
      JSON.stringify(order),
    );
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
      'ativar, esperar, virar, desativar, conferir',
    );
    assert.deepEqual(
      w.events.filter((e) => e.startsWith('get ')),
      [`get ${APP.api}/health`, `get ${APP.api}/api/v1/health`],
    );
  });

  it('a revisão já está no ar: não faz nada', async () => {
    const w = await deployed({ traffic: 'latest' });
    w.events.length = 0;
    await revert(w.ctx, NEW.web);
    assert.ok(
      w.events.every((e) => !/activate|deactivate|traffic set/.test(e)),
      w.events.join('\n'),
    );
    assert.deepEqual(w.trafficOf('ca-web'), only(NEW.web));
  });

  it('a revisão ainda está ativa (voltar antes do cleanup): só passa os 100% e desativa a que servia', async () => {
    const w = await world({ traffic: 'pinned' });
    await pin(w.ctx);
    await create(w.ctx, 'ca-api');
    await promote(w.ctx, 'ca-api');
    w.events.length = 0;
    await revert(w.ctx, OLD.api);
    assert.ok(
      w.events.every((e) => !/revision activate/.test(e)),
      'já estava ativa',
    );
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
    assert.deepEqual(w.activeOf('ca-api'), [OLD.api]);
  });

  it('tráfego dividido entre revisões: recusa sem mudar nada', async () => {
    const w = await world({ traffic: 'split' });
    await assert.rejects(revert(w.ctx, 'ca-api--v-1'), /100%/);
    assert.equal(w.events.filter((e) => /traffic set|activate|deactivate/.test(e)).length, 0);
  });

  it('revisão que não existe: falha sem mexer no tráfego', async () => {
    const w = await deployed({ traffic: 'latest' });
    w.events.length = 0;
    await assert.rejects(revert(w.ctx, 'ca-api--nao-existe'), /nao-existe/);
    assert.equal(w.events.filter((e) => /traffic set|activate|deactivate/.test(e)).length, 0);
    assert.deepEqual(w.trafficOf('ca-api'), only(NEW.api));
  });

  it('nome de revisão de um app que o deploy não cuida: recusa', async () => {
    const w = await world();
    await assert.rejects(revert(w.ctx, 'ca-worker-data--v0'), /ca-api ou ca-web/);
    await assert.rejects(revert(w.ctx, 'sem-sufixo'), /ca-api ou ca-web/);
    assert.equal(w.events.length, 0);
  });

  it('a revisão que volta não fica saudável: o tráfego não muda', async () => {
    const w = await deployed({ traffic: 'latest' });
    const original = w.ctx.az;
    w.ctx.az = async (args) => {
      const reply = await original(args);
      if (has(args, 'containerapp', 'revision', 'show') && args.at(-1) === OLD.api) {
        reply.properties.provisioningState = 'Failed';
      }
      return reply;
    };
    await assert.rejects(revert(w.ctx, OLD.api), /falhou ao provisionar/);
    assert.deepEqual(w.trafficOf('ca-api'), only(NEW.api));
    assert.deepEqual(
      w.activeOf('ca-api').sort(),
      [NEW.api, OLD.api].sort(),
      'a que serve segue ativa',
    );
  });
});

describe('rollRoles', () => {
  it('leva worker, job de decisões e agendadores para a imagem nova, sem tocar em web e api', async () => {
    const w = await world({ traffic: 'pinned' });
    await pin(w.ctx);
    await rollRoles(w.ctx);
    const image = `${REGISTRY}/alvesting-api:${TAG}`;
    assert.equal(w.cloud.state.apps['ca-worker-data'].image, image);
    assert.equal(w.cloud.state.jobs['job-sched-news'].image, image);
    assert.equal(w.cloud.state.jobs['job-worker-decisions'].image, image);
    const touched = w.events.filter((e) => e.includes('update'));
    assert.ok(touched.every((e) => !e.includes('-n ca-web') && !e.includes('-n ca-api ')));
  });

  it('não repete o que já está na imagem nova (o job de migração, por exemplo)', async () => {
    const w = await world({ traffic: 'pinned' });
    await migrate(w.ctx);
    const before = w.events.filter((e) => e.includes('job update')).length;
    await rollRoles(w.ctx);
    const updates = w.events.filter((e) => e.includes('job update') && e.includes('job-migrate'));
    assert.equal(updates.length, 1);
    assert.equal(w.events.filter((e) => e.includes('job update')).length, before + 2);
  });
});

describe('currentTags', () => {
  it('lê a tag da imagem que está no ar em cada app (para o what-if não reverter a revisão)', async () => {
    const w = await world({ traffic: 'latest' });
    assert.deepEqual(await currentTags(w.ctx), { apiImageTag: 'antiga', webImageTag: 'antiga' });
  });

  it('depois de um deploy, devolve a tag nova; não a do último `update` que falhou', async () => {
    const w = await world({ traffic: 'latest' });
    await pin(w.ctx);
    await create(w.ctx, 'ca-api');
    await create(w.ctx, 'ca-web'); // as revisões novas existem, mas quem serve ainda são as antigas
    assert.deepEqual(await currentTags(w.ctx), { apiImageTag: 'antiga', webImageTag: 'antiga' });
    await promote(w.ctx, 'ca-api');
    await promote(w.ctx, 'ca-web');
    assert.deepEqual(await currentTags(w.ctx), { apiImageTag: TAG, webImageTag: TAG });
  });

  it('app que ainda não existe (antes do primeiro deploy): latest, com aviso', async () => {
    const w = await world({ missing: ['ca-api', 'ca-web'] });
    const warnings = [];
    w.ctx.warn = (line) => warnings.push(line);
    assert.deepEqual(await currentTags(w.ctx), { apiImageTag: 'latest', webImageTag: 'latest' });
    assert.equal(warnings.length, 2);
  });
});

// O `az` de verdade, chamado pelo main como o workflow chama: um programa no PATH que só registra os argumentos.
// Cobre o que o az falso não cobre: argumentos sem shell, JSON do stdout, stderr e código de saída.
describe('main com o az do PATH', () => {
  async function withAzOnPath(script, run) {
    const dir = await mkdtemp(path.join(tmpdir(), 'az-shim-'));
    const log = path.join(dir, 'calls.log');
    await writeFile(path.join(dir, 'az'), `#!/bin/sh\necho "$@" >> "${log}"\n${script}\n`);
    await chmod(path.join(dir, 'az'), 0o755);
    const original = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${original}`;
    try {
      return await run({
        dir,
        calls: async () => (await readFile(log, 'utf8')).trim().split('\n'),
      });
    } finally {
      process.env.PATH = original;
    }
  }
  const sink = () => {
    const lines = [];
    return { lines, io: { log: (l) => lines.push(l), error: (l) => lines.push(l) } };
  };

  it('pin: pergunta o tráfego, fixa pelo nome e sai com 0', async () => {
    const script = `case "$*" in
  *"ingress traffic show"*) echo '[{"revisionName":"ca-api--v0","weight":100}]' ;;
  *) echo '{}' ;;
esac`;
    await withAzOnPath(script, async ({ dir, calls }) => {
      const { io } = sink();
      const env = { RESOURCE_GROUP: RG, DEPLOY_STATE: path.join(dir, 'state.json') };
      assert.equal(await main(['pin'], env, io), 0);
      const lines = await calls();
      assert.ok(
        lines.includes(
          `containerapp ingress traffic set -g ${RG} -n ca-api --revision-weight ca-api--v0=100 --only-show-errors -o json`,
        ),
        lines.join('\n'),
      );
    });
  });

  it('o az falhar vira erro do passo (código 1) com a mensagem do az, sem derrubar o processo', async () => {
    await withAzOnPath(`echo "ERROR: ResourceNotFound ca-api" >&2\nexit 3`, async ({ dir }) => {
      const { io, lines } = sink();
      const env = { RESOURCE_GROUP: RG, DEPLOY_STATE: path.join(dir, 'state.json') };
      assert.equal(await main(['pin'], env, io), 1);
      assert.match(lines.join('\n'), /ResourceNotFound ca-api/);
    });
  });

  it('current-tags escreve só linhas nome=valor no stdout (vai direto para o GITHUB_OUTPUT)', async () => {
    const script = `case "$*" in
  *"ingress traffic show"*) echo '[{"revisionName":"ca-x--r1","weight":100}]' ;;
  *"revision show"*) echo '{"properties":{"template":{"containers":[{"image":"cr.azurecr.io/alvesting-api:deadbeef"}]}}}' ;;
esac`;
    await withAzOnPath(script, async () => {
      const { io, lines } = sink();
      assert.equal(await main(['current-tags'], { RESOURCE_GROUP: RG }, io), 0);
      assert.deepEqual(lines, ['apiImageTag=deadbeef', 'webImageTag=deadbeef']);
    });
  });
});

describe('main', () => {
  const sink = () => {
    const lines = [];
    return { lines, io: { log: (l) => lines.push(l), error: (l) => lines.push(l) } };
  };

  it('subcomando desconhecido: mostra o uso e sai com 2', async () => {
    const { lines, io } = sink();
    assert.equal(await main(['abracadabra'], {}, io), 2);
    assert.match(lines.join('\n'), /Uso:/);
  });

  it('nomeia a variável de ambiente que falta', async () => {
    const { lines, io } = sink();
    assert.equal(await main(['pin'], { RESOURCE_GROUP: RG }, io), 2);
    assert.match(lines.join('\n'), /DEPLOY_STATE|REGISTRY/);
  });

  for (const argv of [['create'], ['create', 'worker'], ['promote'], ['smoke-green', 'ca-api']]) {
    it(`${argv.join(' ')}: pede api ou web e sai com 2 sem tocar na Azure`, async () => {
      const { lines, io } = sink();
      const env = {
        RESOURCE_GROUP: RG,
        REGISTRY,
        IMAGE_TAG: TAG,
        REVISION_SUFFIX: SUFFIX,
        DEPLOY_STATE: '/x',
      };
      const az = async () => assert.fail('não pode chamar o az');
      assert.equal(await main(argv, env, io, { az }), 2);
      assert.match(lines.join('\n'), /api ou web/);
    });
  }

  it('revert: pede a revisão e sai com 2', async () => {
    const { lines, io } = sink();
    assert.equal(await main(['revert'], { RESOURCE_GROUP: RG }, io), 2);
    assert.match(lines.join('\n'), /revisão/);
  });
});

// O fim da etiqueta @pos-virada (ADR 0029): com o green provado ANTES da virada, pelo mesmo Front Door, a suíte inteira do smoke roda em
// todas as provas, então teste nenhum precisa esperar a virada. Se alguém a trouxer de volta, o deploy voltaria a pular teste em silêncio.
describe('o fim da etiqueta @pos-virada', () => {
  for (const file of ['../.github/workflows/deploy.yml', '../apps/web/e2e/smoke.spec.ts']) {
    it(`${path.basename(file)} não usa mais a etiqueta nem o --grep-invert`, async () => {
      const text = await readFile(new URL(file, import.meta.url), 'utf8');
      assert.doesNotMatch(text.replace(/\/\/.*$|#.*$/gm, ''), /pos-virada|grep-invert/);
    });
  }
});

// O primeiro passo do job `deploy` (antes de a Azure ser tocada), lido do deploy.yml e executado de verdade com o bash: confere as duas variáveis
// do repositório. O Playwright pelo Front Door verde só prova a revisão NOVA se `SITE_GREEN_URL` for o endpoint green: igual à `SITE_URL` (uma cópia
// errada) ele provaria a revisão antiga, que ainda tem os 100%, e o `promote` viraria código não provado pela borda.
describe('o passo "Conferir as variáveis do repositório"', () => {
  const GREEN_URL = 'https://alvesting-green-x.z01.azurefd.net';
  // o `run: |` do passo, sem o recuo do YAML
  async function script() {
    const text = await readFile(
      new URL('../.github/workflows/deploy.yml', import.meta.url),
      'utf8',
    );
    const block = text
      .slice(text.indexOf('\n  deploy:'))
      .split(/\n {6}- (?=name:|uses:)/)
      .find((candidate) => candidate.startsWith('name: Conferir as variáveis do repositório'));
    const run = /^ {8}run: \|\n((?: {10}.*(?:\n|$))+)/m.exec(block ?? '')?.[1];
    assert.ok(run, 'o passo "Conferir as variáveis do repositório" não foi achado no deploy.yml');
    return run.replace(/^ {10}/gm, '');
  }
  const run = async (env) =>
    spawnSync('bash', ['-e', '-c', await script()], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });

  it('aceita as duas https e diferentes', async () => {
    assert.equal((await run({ SITE_URL: SITE, SITE_GREEN_URL: GREEN_URL })).status, 0);
  });

  for (const [what, env, message] of [
    [
      'SITE_GREEN_URL igual à SITE_URL',
      { SITE_URL: SITE, SITE_GREEN_URL: SITE },
      /não pode ser igual/,
    ],
    [
      'SITE_GREEN_URL igual à SITE_URL, só com uma barra a mais',
      { SITE_URL: SITE, SITE_GREEN_URL: `${SITE}/` },
      /não pode ser igual/,
    ],
    ['SITE_GREEN_URL ausente', { SITE_URL: SITE }, /falta a variável SITE_GREEN_URL/],
    ['SITE_URL ausente', { SITE_GREEN_URL: GREEN_URL }, /falta a variável SITE_URL/],
    [
      'SITE_GREEN_URL sem https',
      { SITE_URL: SITE, SITE_GREEN_URL: 'http://x.example.test' },
      /SITE_GREEN_URL precisa começar com https/,
    ],
  ]) {
    it(`recusa ${what}`, async () => {
      const result = await run(env);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, message);
    });
  }
});

// --- O perfil econômico (ALVESTING_PROFILE = economico; ADR 0039) -----------------------------------------------------------------------
// Sem Front Door: as imagens vão para o GHCR, a api tem ingress INTERNO (o runner não alcança nem o endereço dela nem o do label: de fora,
// o proxy do ambiente dá 404) e o web verde é provado no endereço do label dele. A garantia de tráfego é a do padrão: só o `promote` vira,
// e o `Desfazer` devolve os dois apps.
const ECO = { internalApi: true, registry: GHCR };
const ecoRoutes = () => ({
  [`${GREEN.web}/health`]: healthy('web'),
  [`${ECO_SITE}/health`]: healthy('web'),
  [`${ECO_SITE}/api/v1/health`]: healthy('api'),
});
const ecoWorld = (options = {}, routes = ecoRoutes()) =>
  world({ traffic: 'latest', ...ECO, ...options }, routes, {
    REGISTRY: GHCR,
    SITE_URL: `${ECO_SITE}/`,
  });
// Estado depois de uma falha antes do ponto sem volta: tudo como estava, e o green saiu (o mesmo `unchanged` do rollout do padrão).
const untouched = (w) => {
  assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
  assert.deepEqual(w.trafficOf('ca-web'), only(OLD.web));
  assert.deepEqual(w.activeOf('ca-api'), [OLD.api]);
  assert.deepEqual(w.activeOf('ca-web'), [OLD.web]);
  assert.equal(w.greenOf('ca-api'), undefined, 'o label green saiu da api');
  assert.equal(w.greenOf('ca-web'), undefined, 'o label green saiu do web');
};

describe('perfil econômico: o rollout inteiro (o job deploy do deploy.yml com ALVESTING_PROFILE=economico)', () => {
  const MOBILE = '--project=pixel-7 --project=iphone-15';

  it('sucesso: a api pelas sondas (nenhum pedido a ela), o Playwright no label do web, a api antes do web e as imagens do GHCR', async () => {
    const w = await ecoWorld();
    const seen = [];
    const result = await runWorkflow(w, { playwright: recorder(w, seen), profile: 'economico' });
    assert.equal(result.failed, false, result.errors.join('\n'));
    assert.deepEqual(result.ran, [
      'pin',
      'migrate',
      'create api',
      'probe-green api',
      'promote api',
      'create web',
      'smoke-green web',
      'green-url web',
      'playwright GREEN_URL',
      'promote web',
      'smoke-edge',
      'playwright SITE_URL',
      'cleanup',
      'roll-roles',
    ]);
    // o endereço do label do web, que o deploy.mjs calcula e o passo seguinte usa
    assert.equal(result.githubEnv.GREEN_URL, GREEN.web);

    // duas provas do Playwright, em Pixel 7 e iPhone 15: o web verde (com a api JÁ promovida e o web novo a 0%) e o site de produção
    assert.equal(seen.length, 2);
    for (const call of seen) assert.ok(call.args.includes(MOBILE), call.args);
    assert.equal(seen[0].url, GREEN.web);
    assert.doesNotMatch(seen[0].args, /--grep/);
    assert.deepEqual(seen[0].api, only(NEW.api), 'a api vem antes do web');
    assert.deepEqual(seen[0].web, only(OLD.web), 'o web novo ainda tem 0%');
    assert.equal(seen[0].webGreen, NEW.web);
    assert.equal(seen[1].baseUrl, 'SITE_URL');
    assert.deepEqual(seen[1].api, only(NEW.api));
    assert.deepEqual(seen[1].web, only(NEW.web));

    // o runner nunca pede nada à api interna (nem ao endereço dela, nem ao do label): ela é provada pelas sondas da plataforma
    const gets = w.events.filter((e) => e.startsWith('get '));
    assert.deepEqual(gets, [
      `get ${GREEN.web}/health`,
      `get ${ECO_SITE}/health`,
      `get ${ECO_SITE}/api/v1/health`,
    ]);
    // a ordem: as sondas da api, a virada da api, e só então o web nasce
    const probe = w.events.findLastIndex((e) => e.includes('revision show') && e.includes(NEW.api));
    const turnApi = w.events.findIndex((e) =>
      /traffic set .*-n ca-api .*--revision-weight ca-api--r/.test(e),
    );
    const createWeb = w.events.findIndex((e) => /containerapp update .*-n ca-web/.test(e));
    assert.ok(probe !== -1 && probe < turnApi && turnApi < createWeb, 'sondas, virada, web');
    assert.equal(promotions(w.events).length, 2, 'uma virada por app');

    // toda imagem que o deploy põe (apps, migrate, worker, decisões e agendadores) é a do GHCR
    const images = w.events.filter((e) => /containerapp (job )?update/.test(e));
    assert.ok(images.length > 0);
    for (const e of images)
      assert.match(e, new RegExp(`--image ${GHCR}/alvesting-(api|web):${TAG}`));
    assert.deepEqual(w.trafficOf('ca-api'), only(NEW.api));
    assert.deepEqual(w.trafficOf('ca-web'), only(NEW.web));
    assert.deepEqual(w.activeOf('ca-api'), [NEW.api]);
    assert.deepEqual(w.activeOf('ca-web'), [NEW.web]);
  });

  it('a api nova cai depois de ganhar o label (as sondas a dão por doente): nada vira, o web nem nasce e o green sai', async () => {
    const w = await ecoWorld();
    const original = w.ctx.az;
    let labeled = false;
    w.ctx.az = async (args) => {
      const reply = await original(args);
      if (has(args, 'containerapp', 'revision', 'label', 'add')) labeled = true;
      if (labeled && has(args, 'containerapp', 'revision', 'show') && args.at(-1) === NEW.api) {
        reply.properties.healthState = 'Unhealthy';
      }
      return reply;
    };
    const result = await runWorkflow(w, { profile: 'economico' });
    assert.equal(result.failed, true);
    assert.deepEqual(result.ran, ['pin', 'migrate', 'create api', 'probe-green api', 'rollback']);
    assert.match(result.errors.join('\n'), /não ficou saudável por 3 leituras seguidas/);
    assert.equal(promotions(w.events).length, 0, 'a revisão nova nunca recebeu tráfego');
    assert.equal(
      w.events.filter((e) => e.startsWith('az containerapp update') && e.includes('-n ca-web'))
        .length,
      0,
      'o web nem foi criado',
    );
    untouched(w);
  });

  it('o Playwright no label do web reprova com a api já promovida: o rollback devolve os DOIS à antiga', async () => {
    const w = await ecoWorld();
    const result = await runWorkflow(w, {
      profile: 'economico',
      playwright: async ({ baseUrl }) => {
        if (baseUrl === 'GREEN_URL') throw new Error('Playwright reprovou no web verde');
      },
    });
    assert.equal(result.failed, true);
    assert.deepEqual(result.ran.slice(-2), ['playwright GREEN_URL', 'rollback']);
    assert.equal(promotions(w.events).length, 1, 'só a api tinha virado');
    untouched(w);
  });

  it('o site de produção não repassa /api (o smoke-edge vê o 404): tudo volta à antiga', async () => {
    const routes = ecoRoutes();
    routes[`${ECO_SITE}/api/v1/health`] = [{ status: 404, body: 'Cannot GET /api/v1/health' }];
    const w = await ecoWorld({}, routes);
    const result = await runWorkflow(w, { profile: 'economico' });
    assert.equal(result.failed, true);
    assert.equal(promotions(w.events).length, 2);
    assert.equal(result.ran.at(-1), 'rollback');
    untouched(w);
  });
});

describe('perfil econômico: os passos novos do deploy.mjs', () => {
  const created = async (apps) => {
    const w = await ecoWorld();
    await pin(w.ctx);
    for (const app of apps) await create(w.ctx, app);
    return w;
  };

  it('smoke-green recusa a api de ingress interno, sem pedido nenhum: a prova dela é o probe-green', async () => {
    const w = await created(['ca-api']);
    await assert.rejects(smokeGreen(w.ctx, 'ca-api'), /ingress é interno/);
    assert.equal(w.events.filter((e) => e.startsWith('get ')).length, 0);
  });

  it('probe-green pede 3 leituras saudáveis seguidas: a revisão que oscila só passa quando firma, e segue sem tráfego', async () => {
    const w = await created(['ca-api']);
    const states = ['Healthy', 'Unhealthy', 'Healthy', 'Healthy', 'Healthy'];
    const original = w.ctx.az;
    let shown = 0;
    w.ctx.az = async (args) => {
      const reply = await original(args);
      if (has(args, 'containerapp', 'revision', 'show') && args.at(-1) === NEW.api) {
        reply.properties.healthState = states[Math.min(shown, states.length - 1)];
        shown += 1;
      }
      return reply;
    };
    await probeGreen(w.ctx, 'ca-api');
    assert.equal(shown, 5, 'parou na terceira leitura saudável seguida');
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
  });

  it('probe-green recusa o label fora da revisão nova (provaria outra revisão)', async () => {
    const w = await created(['ca-api']);
    await w.cloud.az([
      'containerapp',
      'revision',
      'label',
      'add',
      '-g',
      RG,
      '-n',
      'ca-api',
      '--label',
      'green',
      '--revision',
      OLD.api,
      '--yes',
    ]);
    await assert.rejects(probeGreen(w.ctx, 'ca-api'), /label green não está/);
  });

  it('probe-green devolve o tráfego à antiga e falha se a Azure o mandar à nova na espera', async () => {
    const w = await created(['ca-api']);
    await w.cloud.az([
      'containerapp',
      'ingress',
      'traffic',
      'set',
      '-g',
      RG,
      '-n',
      'ca-api',
      '--revision-weight',
      `${NEW.api}=100`,
    ]);
    await assert.rejects(probeGreen(w.ctx, 'ca-api'), /recebeu tráfego na espera pelas sondas/);
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
  });

  it('green-url: pelo main, uma linha só no stdout, GREEN_URL=<endereço do label do web> (vai para o GITHUB_ENV)', async () => {
    const w = await created(['ca-web']);
    const lines = [];
    const io = { log: (l) => lines.push(l), error: (l) => lines.push(`stderr: ${l}`) };
    const deps = { az: w.ctx.az, fetch: w.ctx.fetch, sleep: w.ctx.sleep };
    assert.equal(await main(['green-url', 'web'], w.ctx.env, io, deps), 0);
    assert.deepEqual(lines, [`GREEN_URL=${GREEN.web}`]);
  });

  it('green-url recusa o app de ingress interno e o label fora da revisão nova', async () => {
    const w = await created(['ca-api', 'ca-web']);
    await assert.rejects(greenUrl(w.ctx, 'ca-api'), /ingress é interno/);
    await w.cloud.az([
      'containerapp',
      'revision',
      'label',
      'add',
      '-g',
      RG,
      '-n',
      'ca-web',
      '--label',
      'green',
      '--revision',
      OLD.web,
      '--yes',
    ]);
    await assert.rejects(greenUrl(w.ctx, 'ca-web'), /label green não está/);
  });

  it('revert da api interna: o /api/v1/health pelo repasse do site, e nunca o endereço interno', async () => {
    const w = await ecoWorld();
    const result = await runWorkflow(w, { profile: 'economico' });
    assert.equal(result.failed, false, result.errors.join('\n'));
    w.events.length = 0;
    await revert(w.ctx, OLD.api);
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
    assert.deepEqual(
      w.events.filter((e) => e.startsWith('get ')),
      [`get ${ECO_SITE}/api/v1/health`],
    );
  });

  it('revert da api interna sem SITE_URL: só as sondas, com um aviso, e nenhum pedido', async () => {
    const w = await ecoWorld();
    const result = await runWorkflow(w, { profile: 'economico' });
    assert.equal(result.failed, false, result.errors.join('\n'));
    delete w.ctx.env.SITE_URL;
    const warnings = [];
    w.ctx.warn = (line) => warnings.push(line);
    w.events.length = 0;
    await revert(w.ctx, OLD.api);
    assert.deepEqual(w.trafficOf('ca-api'), only(OLD.api));
    assert.equal(w.events.filter((e) => e.startsWith('get ')).length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /interno/);
  });

  it('o padrão não muda: com a api de ingress externo, o revert confere no endereço do app', async () => {
    const w = await world({ traffic: 'latest' });
    await runWorkflow(w);
    assert.ok(INTERNAL.api.includes('.internal.'));
    w.events.length = 0;
    await revert(w.ctx, OLD.api);
    assert.ok(w.events.every((e) => !e.includes('.internal.')));
  });
});

// O primeiro passo do job `deploy`, no econômico: sem Front Door não há SITE_GREEN_URL, e um valor torto da variável não pode rodar os passos
// do padrão em silêncio.
describe('o passo "Conferir as variáveis do repositório", por perfil', () => {
  const run = async (env) => {
    const step = (await deploySteps()).find(
      (s) => s.name === 'Conferir as variáveis do repositório',
    );
    assert.ok(step?.script, 'o passo não foi achado no deploy.yml');
    return spawnSync('bash', ['-e', '-c', step.script], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });
  };

  it('econômico: basta o SITE_URL (o ca-web), sem SITE_GREEN_URL', async () => {
    const r = await run({ ALVESTING_PROFILE: 'economico', SITE_URL: ECO_SITE });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  for (const [what, env, message] of [
    ['econômico sem SITE_URL', { ALVESTING_PROFILE: 'economico' }, /falta a variável SITE_URL/],
    [
      'econômico com SITE_URL sem https',
      { ALVESTING_PROFILE: 'economico', SITE_URL: 'http://ca-web.example.test' },
      /SITE_URL precisa começar com https/,
    ],
    [
      '"padrao" escrito: o mesmo que sem a variável (pede o SITE_GREEN_URL)',
      { ALVESTING_PROFILE: 'padrao', SITE_URL: SITE },
      /falta a variável SITE_GREEN_URL/,
    ],
    [
      'um valor torto (com acento)',
      { ALVESTING_PROFILE: 'econômico', SITE_URL: ECO_SITE },
      /ALVESTING_PROFILE vale economico ou padrao/,
    ],
  ]) {
    it(`recusa ${what}`, async () => {
      const r = await run(env);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout + r.stderr, message);
    });
  }
});

describe('perfil econômico: o job images publica no GHCR', () => {
  it('cada perfil roda só os passos dele: o padrão segue com azure/login, ACR e o build de sempre; o econômico não toca na Azure', async () => {
    const steps = await jobSteps('images');
    assert.deepEqual(
      steps.filter((s) => profileAllows(s.cond, '')).map((s) => s.name),
      ['actions/checkout', 'azure/login', 'Entrar no ACR', 'Construir e publicar as imagens'],
    );
    assert.deepEqual(
      steps.filter((s) => profileAllows(s.cond, 'economico')).map((s) => s.name),
      ['actions/checkout', 'Entrar no GHCR e publicar as imagens (perfil econômico)'],
    );
  });

  it('continua pulado sem as variáveis de OIDC (fork, repositório não configurado) e pede packages: write', async () => {
    const text = await readFile(
      new URL('../.github/workflows/deploy.yml', import.meta.url),
      'utf8',
    );
    const images = text.slice(text.indexOf('\n  images:'), text.indexOf('\n  deploy:'));
    assert.match(images, /^ {4}if: \$\{\{ vars\.AZURE_CLIENT_ID != '' \}\}$/m);
    assert.match(images, /^ {6}packages: write$/m);
    assert.match(images, /^ {6}registry: \$\{\{ steps\.ghcr\.outputs\.registry \}\}$/m);
  });

  it('o passo do GHCR: o dono em minúsculas, o token pela entrada padrão (nunca em argumento), o rótulo do repositório e o registro na saída', async () => {
    const step = (await jobSteps('images')).find((s) => s.name.startsWith('Entrar no GHCR'));
    assert.ok(step?.script, 'o passo do GHCR não foi achado');
    const dir = await mkdtemp(path.join(tmpdir(), 'ghcr-'));
    const log = path.join(dir, 'docker.log');
    // um docker de mentira: registra os argumentos e o que chegou na entrada padrão do login
    await writeFile(
      path.join(dir, 'docker'),
      `#!/bin/sh\necho "$*" >> "${log}"\nif [ "$1" = login ]; then echo "entrada: $(cat)" >> "${log}"; fi\n`,
    );
    await chmod(path.join(dir, 'docker'), 0o755);
    const summary = path.join(dir, 'summary');
    const output = path.join(dir, 'output');
    const token = 'token-de-mentira-0123456789';
    const r = spawnSync('bash', ['-e', '-c', step.script], {
      env: {
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        GITHUB_REPOSITORY_OWNER: 'ZanellaDev',
        GITHUB_REPOSITORY: 'ZanellaDev/alvesting',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_ACTOR: 'zanelladev',
        GITHUB_TOKEN: token,
        IMAGE_TAG: TAG,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_OUTPUT: output,
      },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const source = 'org.opencontainers.image.source=https://github.com/ZanellaDev/alvesting';
    const calls = (await readFile(log, 'utf8')).trim().split('\n');
    assert.deepEqual(calls, [
      'login ghcr.io --username zanelladev --password-stdin',
      `entrada: ${token}`,
      `build -f apps/api/Dockerfile --label ${source} -t ${GHCR}/alvesting-api:${TAG} .`,
      `push ${GHCR}/alvesting-api:${TAG}`,
      `build -f apps/web/Dockerfile --label ${source} -t ${GHCR}/alvesting-web:${TAG} .`,
      `push ${GHCR}/alvesting-web:${TAG}`,
    ]);
    assert.ok(
      calls.filter((c) => !c.startsWith('entrada:')).every((c) => !c.includes(token)),
      'o token nunca vai em argumento',
    );
    assert.equal(await readFile(output, 'utf8'), `registry=${GHCR}\n`);
    assert.match(await readFile(summary, 'utf8'), /publicada: ghcr\.io\/zanelladev\/alvesting-web/);
  });
});

// "Padrão intacto" (ADR 0039): sem ALVESTING_PROFILE, o job deploy roda os mesmos passos de antes desta onda, na mesma ordem. O econômico só
// acrescenta passos com o `if:` dele, e os do padrão só ganharam o `if:` contrário.
describe('sem ALVESTING_PROFILE o deploy.yml faz o que já fazia', () => {
  it('o job deploy no padrão: os mesmos 24 passos, na mesma ordem', async () => {
    const names = (await deploySteps()).filter((s) => profileAllows(s.cond, '')).map((s) => s.name);
    assert.deepEqual(names, [
      'actions/checkout',
      'pnpm/action-setup',
      'actions/setup-node',
      'Conferir as variáveis do repositório',
      'Dependências do e2e',
      'azure/login',
      'Nome da revisão',
      'Fixar o tráfego na revisão atual',
      'Migrations e login da api no banco (job-migrate)',
      'API, passo 1 - criar a revisão nova, com o label green e sem tráfego',
      'API, passo 2 - smoke no endereço do label green',
      'API, passo 3 - Playwright (mobile) pelo Front Door verde',
      'API, passo 4 - virar o tráfego da api',
      'Web, passo 1 - criar a revisão nova, com o label green e sem tráfego',
      'Web, passo 2 - smoke no endereço do label green',
      'Web, passo 3 - Playwright (mobile) pelo Front Door verde',
      'Web, passo 4 - virar o tráfego do web',
      'Smoke pelo Front Door de produção',
      'Smoke do Playwright (mobile) pelo Front Door de produção',
      'Confirmar e desativar as revisões antigas',
      'Atualizar worker, decisões e agendadores',
      'Teste de SSE pelo Front Door (informativo)',
      'actions/upload-artifact',
      'Desfazer (a antiga volta a ter 100% nos dois apps, o label green sai e a nova é desativada)',
    ]);
  });
});
