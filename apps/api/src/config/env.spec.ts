import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { QUOTES_SECRET_EXAMPLE, parseEnv, requireApiLogin, useApiLogin } from './env.js';
import { Secret } from './secret.js';

const base = { DATABASE_URL: 'postgresql://alvesting:alvesting@localhost:25432/alvesting_dev' };

describe('parseEnv', () => {
  it('aplica os padrões quando só o banco está definido', () => {
    expect(parseEnv(base)).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_HOST: '0.0.0.0',
      API_PORT: 4310,
      DATABASE_URL: base.DATABASE_URL,
      SERVICEBUS_CONNECTION_STRING: undefined,
    });
  });

  it('converte a porta de texto para número', () => {
    expect(parseEnv({ ...base, API_PORT: '4311' }).API_PORT).toBe(4311);
  });

  // O padrão escuta em todas as interfaces porque é o que o contêiner precisa (o ingress fala com a
  // porta pelo IP do contêiner). O .env.example fixa 127.0.0.1 para o `pnpm dev`, que não deve ficar
  // exposto na rede local.
  it.each(['127.0.0.1', '0.0.0.0', '::1', 'localhost'])('aceita API_HOST %s', (API_HOST) => {
    expect(parseEnv({ ...base, API_HOST }).API_HOST).toBe(API_HOST);
  });

  it('aceita postgres:// e postgresql://', () => {
    expect(parseEnv({ DATABASE_URL: 'postgres://u:p@h:5432/db' }).DATABASE_URL).toBe(
      'postgres://u:p@h:5432/db',
    );
  });

  it('trata variável em branco (VAR= no .env) como ausente', () => {
    expect(
      parseEnv({ ...base, SERVICEBUS_CONNECTION_STRING: '', LOG_LEVEL: '' })
        .SERVICEBUS_CONNECTION_STRING,
    ).toBeUndefined();
    expect(parseEnv({ ...base, LOG_LEVEL: '' }).LOG_LEVEL).toBe('info');
    expect(parseEnv({ ...base, API_HOST: '' }).API_HOST).toBe('0.0.0.0');
  });

  it('guarda a connection string do Service Bus quando existe', () => {
    const cs =
      'Endpoint=sb://localhost:25672;SharedAccessKeyName=K;SharedAccessKey=S;UseDevelopmentEmulator=true;';
    expect(
      parseEnv({ ...base, SERVICEBUS_CONNECTION_STRING: cs }).SERVICEBUS_CONNECTION_STRING,
    ).toBe(cs);
  });

  // Segredo colado no Key Vault costuma levar a quebra de linha do `echo`: o Headers recusaria o token, e o erro pareceria "brapi fora do ar".
  it('BRAPI_TOKEN: aparado nas pontas; vazio, só espaço e PENDENTE valem como ausente', () => {
    expect(parseEnv({ ...base, BRAPI_TOKEN: ' abc123XYZ\n' }).BRAPI_TOKEN?.reveal()).toBe(
      'abc123XYZ',
    );
    for (const BRAPI_TOKEN of ['', '  \n', 'PENDENTE', ' PENDENTE\n']) {
      expect(parseEnv({ ...base, BRAPI_TOKEN }).BRAPI_TOKEN, JSON.stringify(BRAPI_TOKEN)).toBe(
        undefined,
      );
    }
  });

  // O token da brapi é o segredo que o Artur pediu para nunca aparecer: um Secret como os outros. Um `console.log(env)`, um JSON.stringify do
  // ambiente ou um relatório de falha não o mostram, e depois do parse o texto cru sai do process.env.
  it('BRAPI_TOKEN é um Secret: não aparece em JSON, em inspect nem em template, e sai do process.env', () => {
    const token = 'abc123XYZ-token-sintetico';
    const env = parseEnv({ ...base, BRAPI_TOKEN: token });
    expect(env.BRAPI_TOKEN).toBeInstanceOf(Secret);
    for (const shown of [JSON.stringify(env), inspect(env), `${String(env.BRAPI_TOKEN)}`]) {
      expect(shown).not.toContain(token);
    }
    vi.stubEnv('DATABASE_URL', base.DATABASE_URL);
    vi.stubEnv('BRAPI_TOKEN', token);
    try {
      expect(parseEnv().BRAPI_TOKEN?.reveal()).toBe(token);
      expect(process.env.BRAPI_TOKEN).toBeUndefined();
      expect(JSON.stringify(process.env)).not.toContain(token);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // A trava de origem liga com FRONT_DOOR_ID (plano 5.4). Sem a variável não há trava.
  it('FRONT_DOOR_ID é opcional: ausente ou em branco, a trava fica desligada', () => {
    expect(parseEnv(base).FRONT_DOOR_ID).toBeUndefined();
    expect(parseEnv({ ...base, FRONT_DOOR_ID: '' }).FRONT_DOOR_ID).toBeUndefined();
  });

  it('FRONT_DOOR_ID guarda o GUID do perfil do Front Door', () => {
    const id = 'c0ffee00-1234-4abc-8def-0123456789ab';
    expect(parseEnv({ ...base, FRONT_DOOR_ID: id }).FRONT_DOOR_ID).toBe(id);
  });

  // Valor torto trancaria todo mundo para fora com o /health ainda verde. Melhor não subir.
  it.each(['PENDENTE', 'c0ffee00', ' c0ffee00-1234-4abc-8def-0123456789ab', 'banana'])(
    'FRONT_DOOR_ID inválido (%s) impede o boot, sem repetir o valor',
    (FRONT_DOOR_ID) => {
      expect(() => parseEnv({ ...base, FRONT_DOOR_ID })).toThrow(/FRONT_DOOR_ID/);
      expect(() => parseEnv({ ...base, FRONT_DOOR_ID })).not.toThrow(/banana|PENDENTE/);
    },
  );

  // Contrato fail closed (docs/INFRA.md, 3.3): o Bicep injeta ORIGIN_LOCK=front-door nos apps atrás do Front Door.
  // Sem o ID, a API não sobe: um ID perdido por erro de configuração desligaria a trava em silêncio.
  describe('ORIGIN_LOCK', () => {
    const id = 'c0ffee00-1234-4abc-8def-0123456789ab';

    it('ausente ou em branco: sem exigência (dev, teste e perfil econômico)', () => {
      expect(parseEnv(base).ORIGIN_LOCK).toBeUndefined();
      expect(parseEnv({ ...base, ORIGIN_LOCK: '' }).ORIGIN_LOCK).toBeUndefined();
    });

    it('front-door com o ID: sobe, e a trava vale', () => {
      const env = parseEnv({ ...base, ORIGIN_LOCK: 'front-door', FRONT_DOOR_ID: id });
      expect(env.ORIGIN_LOCK).toBe('front-door');
      expect(env.FRONT_DOOR_ID).toBe(id);
    });

    it.each([
      ['sem FRONT_DOOR_ID', { ORIGIN_LOCK: 'front-door' }],
      ['com FRONT_DOOR_ID em branco', { ORIGIN_LOCK: 'front-door', FRONT_DOOR_ID: '' }],
    ])('front-door %s: recusa subir', (_nome, extra) => {
      expect(() => parseEnv({ ...base, ...extra })).toThrow(
        /FRONT_DOOR_ID.*ORIGIN_LOCK=front-door/,
      );
    });

    it('valor desconhecido: recusa subir', () => {
      expect(() => parseEnv({ ...base, ORIGIN_LOCK: 'desligado', FRONT_DOOR_ID: id })).toThrow(
        /ORIGIN_LOCK/,
      );
    });
  });

  it.each([
    ['sem DATABASE_URL', {}],
    ['DATABASE_URL de outro banco', { DATABASE_URL: 'mysql://u:p@h/db' }],
    ['DATABASE_URL que não é URL', { DATABASE_URL: 'banana' }],
    ['porta não numérica', { ...base, API_PORT: 'abc' }],
    ['porta zero', { ...base, API_PORT: '0' }],
    ['porta acima de 65535', { ...base, API_PORT: '70000' }],
    ['porta fracionária', { ...base, API_PORT: '43.5' }],
    ['API_HOST com espaço', { ...base, API_HOST: '127.0.0.1 ' }],
    ['API_HOST que é URL', { ...base, API_HOST: 'http://127.0.0.1' }],
    ['API_HOST com porta', { ...base, API_HOST: '127.0.0.1:4310' }],
    ['LOG_LEVEL desconhecido', { ...base, LOG_LEVEL: 'verbose' }],
    ['NODE_ENV desconhecido', { ...base, NODE_ENV: 'staging' }],
  ])('falha com %s', (_nome, source) => {
    expect(() => parseEnv(source)).toThrow(/Variáveis de ambiente inválidas/);
  });

  it('lista os nomes das variáveis erradas, nunca os valores (podem ser segredos)', () => {
    let message = '';
    try {
      parseEnv({ DATABASE_URL: 'mysql://usuario:senha-secreta@host/db', API_PORT: 'abc' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('API_PORT');
    expect(message).not.toContain('senha-secreta');
    expect(message).not.toContain('usuario');
  });

  // A arena (etapa 6): o prompt e a chave do OpenRouter só chegam ao job de decisões (docs/INFRA.md, 2.7). Os dois são
  // segredo: o valor fica dentro de um Secret, que não aparece em JSON, em template string nem em util.inspect, para um
  // `logger.log(env)` descuidado não vazar o prompt (regra 4 do CLAUDE.md).
  describe('arena', () => {
    const prompt = 'TEXTO-SECRETO-DO-PROMPT';
    const key = 'sk-or-chave-secreta';
    const version = '0123456789abcdef0123456789abcdef';

    it('ausentes, nada da arena é exigido (api, worker e agendadores não têm o prompt)', () => {
      const env = parseEnv(base);
      expect(env.PROMPT_ARENA).toBeUndefined();
      expect(env.PROMPT_ARENA_VERSION).toBeUndefined();
      expect(env.OPENROUTER_API_KEY).toBeUndefined();
      expect(env.ARENA_MONTHLY_COST_CAP_USD).toBeUndefined();
      expect(env.AZURE_OPENAI_ENDPOINT).toBeUndefined();
    });

    it('o prompt e a chave viram Secret: reveal devolve o valor, o resto não', () => {
      const env = parseEnv({ ...base, PROMPT_ARENA: prompt, OPENROUTER_API_KEY: key });
      expect(env.PROMPT_ARENA?.reveal()).toBe(prompt);
      expect(env.OPENROUTER_API_KEY?.reveal()).toBe(key);
      for (const shown of [
        JSON.stringify(env),
        String(env.PROMPT_ARENA),
        `${String(env.OPENROUTER_API_KEY)}`,
        inspect(env, { depth: 5 }),
        JSON.stringify({ secret: env.PROMPT_ARENA }),
        inspect(env.PROMPT_ARENA),
      ]) {
        expect(shown).not.toContain(prompt);
        expect(shown).not.toContain(key);
      }
    });

    // process.env fica com o texto cru durante todo o processo: um despejo do ambiente, um relatório de falha ou a telemetria
    // da etapa 10 o exporia. Depois do parse só o Secret o guarda.
    it('lido de process.env, o texto cru do prompt e da chave sai de lá; a versão (que não é segredo) e as outras ficam', () => {
      vi.stubEnv('DATABASE_URL', base.DATABASE_URL);
      vi.stubEnv('PROMPT_ARENA', prompt);
      vi.stubEnv('OPENROUTER_API_KEY', key);
      vi.stubEnv('PROMPT_ARENA_VERSION', version);
      try {
        const env = parseEnv();
        expect(env.PROMPT_ARENA?.reveal()).toBe(prompt);
        expect(env.OPENROUTER_API_KEY?.reveal()).toBe(key);
        expect(process.env.PROMPT_ARENA).toBeUndefined();
        expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
        expect(JSON.stringify(process.env)).not.toContain(prompt);
        expect(JSON.stringify(process.env)).not.toContain(key);
        expect(process.env.PROMPT_ARENA_VERSION).toBe(version);
        expect(process.env.DATABASE_URL).toBe(base.DATABASE_URL);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('com ambiente inválido os segredos também saem de process.env, e o erro não repete o valor', () => {
      vi.stubEnv('DATABASE_URL', 'banana');
      vi.stubEnv('PROMPT_ARENA', prompt);
      try {
        expect(() => parseEnv()).toThrow(/DATABASE_URL/);
        expect(process.env.PROMPT_ARENA).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('com outra origem (a dos testes) nada é apagado de process.env', () => {
      vi.stubEnv('PROMPT_ARENA', prompt);
      try {
        const env = parseEnv({ ...base, PROMPT_ARENA: prompt });
        expect(env.PROMPT_ARENA?.reveal()).toBe(prompt);
        expect(process.env.PROMPT_ARENA).toBe(prompt);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('o Secret não deixa o valor em propriedade enumerável (spread, Object.values, structuredClone)', () => {
      const secret = parseEnv({ ...base, PROMPT_ARENA: prompt }).PROMPT_ARENA!;
      expect(JSON.stringify({ ...secret })).not.toContain(prompt);
      expect(JSON.stringify(Object.values(secret))).not.toContain(prompt);
      expect(JSON.stringify(Object.getOwnPropertyNames(secret))).not.toContain(prompt);
      expect(secret instanceof Secret).toBe(true);
    });

    it.each(['', 'PENDENTE'])(
      'PROMPT_ARENA e OPENROUTER_API_KEY %j valem como ausentes (placeholder do Key Vault)',
      (value) => {
        const env = parseEnv({ ...base, PROMPT_ARENA: value, OPENROUTER_API_KEY: value });
        expect(env.PROMPT_ARENA).toBeUndefined();
        expect(env.OPENROUTER_API_KEY).toBeUndefined();
      },
    );

    it('prompt acima de 25 KB (o teto de um segredo do Key Vault) impede o boot, sem repetir o texto', () => {
      const big = 'x'.repeat(25_601);
      expect(() => parseEnv({ ...base, PROMPT_ARENA: big })).toThrow(/PROMPT_ARENA/);
      expect(() => parseEnv({ ...base, PROMPT_ARENA: big })).not.toThrow(/xxxxxxxx/);
    });

    it('PROMPT_ARENA_VERSION são os 32 hexadecimais da versão do segredo', () => {
      expect(parseEnv({ ...base, PROMPT_ARENA_VERSION: version }).PROMPT_ARENA_VERSION).toBe(
        version,
      );
      expect(parseEnv({ ...base, PROMPT_ARENA_VERSION: '' }).PROMPT_ARENA_VERSION).toBeUndefined();
    });

    it.each(['latest', '0123456789ABCDEF0123456789ABCDEF', '0123456789abcdef', ` ${version}`])(
      'PROMPT_ARENA_VERSION inválida (%s) impede o boot',
      (value) => {
        expect(() => parseEnv({ ...base, PROMPT_ARENA_VERSION: value })).toThrow(
          /PROMPT_ARENA_VERSION/,
        );
      },
    );

    it('o teto de custo do mês é um valor em dólares com até 6 casas', () => {
      expect(
        parseEnv({ ...base, ARENA_MONTHLY_COST_CAP_USD: '50' }).ARENA_MONTHLY_COST_CAP_USD,
      ).toBe('50');
      expect(
        parseEnv({ ...base, ARENA_MONTHLY_COST_CAP_USD: '49.5' }).ARENA_MONTHLY_COST_CAP_USD,
      ).toBe('49.5');
    });

    it.each(['-1', '1e2', '5,5', 'cinquenta', '1.1234567'])(
      'teto de custo inválido (%s) impede o boot',
      (value) => {
        expect(() => parseEnv({ ...base, ARENA_MONTHLY_COST_CAP_USD: value })).toThrow(
          /ARENA_MONTHLY_COST_CAP_USD/,
        );
      },
    );

    it('AZURE_OPENAI_ENDPOINT é uma URL', () => {
      expect(
        parseEnv({ ...base, AZURE_OPENAI_ENDPOINT: 'https://oai-alvesting.openai.azure.com/' })
          .AZURE_OPENAI_ENDPOINT,
      ).toBe('https://oai-alvesting.openai.azure.com/');
      expect(() => parseEnv({ ...base, AZURE_OPENAI_ENDPOINT: 'banana' })).toThrow(
        /AZURE_OPENAI_ENDPOINT/,
      );
    });
  });
  // Revalidação do site e purge do Front Door depois da liquidação (etapa 9; docs/JOBS.md, 4.2). Só o worker-data as recebe.
  describe('revalidação e purge', () => {
    const secret = 'segredo-de-revalidacao-longo-e-aleatorio';
    const endpoint =
      '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-alvesting-prod/providers/Microsoft.Cdn/profiles/afd-alvesting/afdEndpoints/alvesting';

    it('ausentes, nada é exigido (api, agendadores, dev e perfil econômico)', () => {
      const env = parseEnv(base);
      expect(env.WEB_INTERNAL_URL).toBeUndefined();
      expect(env.REVALIDATE_SECRET).toBeUndefined();
      expect(env.FRONT_DOOR_ENDPOINT_ID).toBeUndefined();
    });

    it('lê a URL interna do site, o segredo e o endpoint do Front Door', () => {
      const env = parseEnv({
        ...base,
        WEB_INTERNAL_URL: 'https://ca-web.exemplo.azurecontainerapps.io',
        REVALIDATE_SECRET: secret,
        FRONT_DOOR_ENDPOINT_ID: endpoint,
      });
      expect(env.WEB_INTERNAL_URL).toBe('https://ca-web.exemplo.azurecontainerapps.io');
      expect(env.REVALIDATE_SECRET?.reveal()).toBe(secret);
      expect(env.FRONT_DOOR_ENDPOINT_ID).toBe(endpoint);
    });

    it('em branco (VAR= no .env) e PENDENTE valem como ausente', () => {
      for (const value of ['', 'PENDENTE']) {
        expect(parseEnv({ ...base, REVALIDATE_SECRET: value }).REVALIDATE_SECRET).toBeUndefined();
      }
      expect(parseEnv({ ...base, WEB_INTERNAL_URL: '' }).WEB_INTERNAL_URL).toBeUndefined();
      expect(
        parseEnv({ ...base, FRONT_DOOR_ENDPOINT_ID: '' }).FRONT_DOOR_ENDPOINT_ID,
      ).toBeUndefined();
    });

    it('o segredo vira Secret: não aparece em JSON, em inspect nem em template', () => {
      const env = parseEnv({ ...base, REVALIDATE_SECRET: secret });
      for (const shown of [JSON.stringify(env), inspect(env), `${String(env.REVALIDATE_SECRET)}`]) {
        expect(shown).not.toContain(secret);
      }
    });

    it('lido de process.env, o texto cru do segredo sai de lá (o despejo do ambiente não o expõe)', () => {
      vi.stubEnv('DATABASE_URL', base.DATABASE_URL);
      vi.stubEnv('REVALIDATE_SECRET', secret);
      try {
        const env = parseEnv();
        expect(env.REVALIDATE_SECRET?.reveal()).toBe(secret);
        expect(process.env.REVALIDATE_SECRET).toBeUndefined();
        expect(JSON.stringify(process.env)).not.toContain(secret);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    // A rota do site é alcançável da internet (pelo Front Door e pelo endereço direto do ca-web), então o segredo é a única defesa dela:
    // um segredo curto é um erro de configuração que não pode passar calado.
    it('o segredo tem 32 caracteres ou mais: o curto impede o boot, sem repetir o valor', () => {
      for (const short of ['curto', 'x'.repeat(31), 'a', '12345678']) {
        expect(() => parseEnv({ ...base, REVALIDATE_SECRET: short }), short).toThrow(
          /REVALIDATE_SECRET/,
        );
      }
      expect(() => parseEnv({ ...base, REVALIDATE_SECRET: 'segredo-curto-demais' })).not.toThrow(
        /segredo-curto-demais/,
      );
      expect(
        parseEnv({ ...base, REVALIDATE_SECRET: 'x'.repeat(32) }).REVALIDATE_SECRET,
      ).toBeDefined();
      // o PENDENTE do Key Vault (ainda sem valor) e o em branco continuam valendo como ausente
      expect(
        parseEnv({ ...base, REVALIDATE_SECRET: 'PENDENTE' }).REVALIDATE_SECRET,
      ).toBeUndefined();
    });

    it('em produção a URL do site é https (o Bearer não vai em claro); só o loopback aceita http', () => {
      const production = { ...base, NODE_ENV: 'production' };
      expect(
        parseEnv({ ...production, WEB_INTERNAL_URL: 'https://ca-web.exemplo.io' }).WEB_INTERNAL_URL,
      ).toBe('https://ca-web.exemplo.io');
      for (const url of ['http://127.0.0.1:4300', 'http://localhost:4300', 'http://[::1]:4300']) {
        expect(
          parseEnv({ ...production, WEB_INTERNAL_URL: url }).WEB_INTERNAL_URL,
          url,
        ).toBeTruthy();
      }
      for (const url of [
        'http://ca-web.exemplo.io',
        'http://127.0.0.1.exemplo.io',
        'http://localhost.exemplo.io',
        'http://10.0.0.4:4300',
      ]) {
        expect(() => parseEnv({ ...production, WEB_INTERNAL_URL: url }), url).toThrow(
          /WEB_INTERNAL_URL/,
        );
      }
      // fora de produção (dev, teste) http vale: o `pnpm dev` e o ensaio não têm TLS
      expect(
        parseEnv({ ...base, WEB_INTERNAL_URL: 'http://ca-web.exemplo.io' }).WEB_INTERNAL_URL,
      ).toBe('http://ca-web.exemplo.io');
    });

    it.each([
      'ftp://ca-web.exemplo.io',
      'javascript:alert(1)',
      'banana',
      'https://u:p@ca-web.io',
      '//ca-web.io',
    ])('WEB_INTERNAL_URL inválida (%s) impede o boot, sem repetir o valor', (value) => {
      expect(() => parseEnv({ ...base, WEB_INTERNAL_URL: value })).toThrow(/WEB_INTERNAL_URL/);
      expect(() => parseEnv({ ...base, WEB_INTERNAL_URL: value })).not.toThrow(/banana|u:p/);
    });

    // O ID é concatenado a management.azure.com: nada além do caminho de um endpoint do Front Door pode passar.
    it.each([
      '/subscriptions/x/resourceGroups/rg/providers/Microsoft.Cdn/profiles/p/afdEndpoints/e',
      `${endpoint}/purge`,
      `${endpoint}?api-version=1`,
      `${endpoint}#x`,
      endpoint.replace('Microsoft.Cdn', 'Microsoft.Storage'),
      endpoint.replace('afdEndpoints', 'routes'),
      `https://management.azure.com${endpoint}`,
      endpoint.replace('/profiles/afd-alvesting', '/profiles/../afd'),
      'banana',
    ])('FRONT_DOOR_ENDPOINT_ID inválido (%s) impede o boot', (value) => {
      expect(() => parseEnv({ ...base, FRONT_DOOR_ENDPOINT_ID: value })).toThrow(
        /FRONT_DOOR_ENDPOINT_ID/,
      );
    });
  });

  // O segredo da rota interna de cotações (docs/API.md, seção 6; ADR 0033). Só a api (e o site, que manda o mesmo valor) o recebe.
  describe('segredo da rota interna de cotações', () => {
    const secret = 'segredo-das-cotacoes-longo-e-aleatorio-123';

    it('ausente, nada é exigido: a rota fica desligada (404 para todos) e o resto sobe', () => {
      expect(parseEnv(base).QUOTES_SECRET).toBeUndefined();
    });

    it('lê o segredo, e em branco (VAR= no .env) e PENDENTE valem como ausente', () => {
      expect(parseEnv({ ...base, QUOTES_SECRET: secret }).QUOTES_SECRET?.reveal()).toBe(secret);
      for (const value of ['', 'PENDENTE']) {
        expect(parseEnv({ ...base, QUOTES_SECRET: value }).QUOTES_SECRET).toBeUndefined();
      }
    });

    it('vira Secret: não aparece em JSON, em inspect nem em template', () => {
      const env = parseEnv({ ...base, QUOTES_SECRET: secret });
      for (const shown of [JSON.stringify(env), inspect(env), `${String(env.QUOTES_SECRET)}`]) {
        expect(shown).not.toContain(secret);
      }
    });

    it('lido de process.env, o texto cru sai de lá (o despejo do ambiente não o expõe)', () => {
      vi.stubEnv('DATABASE_URL', base.DATABASE_URL);
      vi.stubEnv('QUOTES_SECRET', secret);
      try {
        const env = parseEnv();
        expect(env.QUOTES_SECRET?.reveal()).toBe(secret);
        expect(process.env.QUOTES_SECRET).toBeUndefined();
        expect(JSON.stringify(process.env)).not.toContain(secret);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    // O site apara as pontas do que lê e manda o valor em `Authorization: Bearer`: se a api não aparasse, o segredo colado à mão no Key Vault
    // (com a quebra de linha do `echo`) nunca bateria com o do site. E o que tem espaço, controle ou acento no meio impede o boot dos dois lados:
    // o `fetch` do Node repetiria o valor inteiro na mensagem do erro de cabeçalho inválido, que o site manda para o log.
    it('aparado nas pontas; espaço, quebra de linha, controle ou acento no meio impedem o boot, sem repetir o valor', () => {
      expect(parseEnv({ ...base, QUOTES_SECRET: ` ${secret}\n` }).QUOTES_SECRET?.reveal()).toBe(
        secret,
      );
      expect(parseEnv({ ...base, QUOTES_SECRET: ' PENDENTE\n' }).QUOTES_SECRET).toBeUndefined();
      for (const bad of [
        `${secret.slice(0, 20)} ${secret.slice(20)}`,
        `${secret.slice(0, 20)}\n${secret.slice(20)}`,
        `${secret.slice(0, 20)}\t${secret.slice(20)}`,
        `${secret.slice(0, 20)}\u0000${secret.slice(20)}`,
        `${secret.slice(0, 20)}ç${secret.slice(20)}`,
      ]) {
        const attempt = () => parseEnv({ ...base, QUOTES_SECRET: bad });
        expect(attempt, JSON.stringify(bad)).toThrow(/QUOTES_SECRET/);
        expect(attempt, JSON.stringify(bad)).not.toThrow(new RegExp(secret.slice(0, 20)));
      }
      // o que o `openssl rand -base64 48` gera (letras, dígitos, + / =) passa
      expect(
        parseEnv({ ...base, QUOTES_SECRET: 'dGVzdGU+L3NlZ3JlZG8vYmFzZTY0Zm9ybWF0bz09abcdef==' })
          .QUOTES_SECRET,
      ).toBeDefined();
    });

    // A rota é alcançável pelo endereço direto da api: o segredo é a única defesa dela, e o curto é erro de configuração.
    it('32 caracteres ou mais: o curto impede o boot, sem repetir o valor', () => {
      for (const short of ['curto', 'x'.repeat(31), 'a']) {
        expect(() => parseEnv({ ...base, QUOTES_SECRET: short }), short).toThrow(/QUOTES_SECRET/);
      }
      expect(() => parseEnv({ ...base, QUOTES_SECRET: 'segredo-curto' })).not.toThrow(
        /segredo-curto/,
      );
      expect(parseEnv({ ...base, QUOTES_SECRET: 'x'.repeat(32) }).QUOTES_SECRET).toBeDefined();
    });

    // O .env.example traz um valor de dev para o `pnpm dev` rodar sem configurar nada, e ele é público (o repositório pode ficar público). Copiar
    // o arquivo para a produção abriria a rota a quem o lê: a produção recusa o valor, como recusa o segredo da conta e a senha do banco de exemplo.
    it('o valor de dev do .env.example sobe em dev e é recusado em produção, sem repeti-lo', () => {
      const example = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');
      const line = /^QUOTES_SECRET=(.*)$/m.exec(example)?.[1];
      expect(line).toBe(QUOTES_SECRET_EXAMPLE);
      expect(QUOTES_SECRET_EXAMPLE.length).toBeGreaterThanOrEqual(32);
      expect(
        parseEnv({ ...base, QUOTES_SECRET: QUOTES_SECRET_EXAMPLE }).QUOTES_SECRET,
      ).toBeDefined();
      for (const NODE_ENV of ['development', 'test']) {
        expect(() =>
          parseEnv({ ...base, NODE_ENV, QUOTES_SECRET: QUOTES_SECRET_EXAMPLE }),
        ).not.toThrow();
      }
      const production = { ...base, NODE_ENV: 'production', QUOTES_SECRET: QUOTES_SECRET_EXAMPLE };
      expect(() => parseEnv(production)).toThrow(/QUOTES_SECRET/);
      expect(() => parseEnv(production)).not.toThrow(new RegExp(QUOTES_SECRET_EXAMPLE));
      // um segredo de verdade passa em produção
      expect(
        parseEnv({ ...production, QUOTES_SECRET: 'x'.repeat(48) }).QUOTES_SECRET,
      ).toBeDefined();
    });
  });

  // A conta (etapa 11; docs/CONTA.md). Só a api (HTTP) os recebe (docs/INFRA.md, 2.7). A exigência de produção não mora aqui, porque
  // o worker e os agendadores também leem este schema e não têm nada disso: ela está em modules/account/infrastructure/account-config.ts.
  describe('conta', () => {
    const secret = 'segredo-sintetico-da-sessao-com-mais-de-32-caracteres';

    it('ausentes, nada é exigido (worker, agendadores e o job de decisões não têm nada disto)', () => {
      const env = parseEnv(base);
      for (const name of [
        'PUBLIC_URL',
        'BETTER_AUTH_SECRET',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'ACS_CONNECTION_STRING',
        'EMAIL_SENDER_ADDRESS',
        'EMAIL_OUTBOX_DIR',
        'LEGAL_CONTROLLER_NAME',
        'LEGAL_CONTACT_EMAIL',
      ] as const) {
        expect(env[name], name).toBeUndefined();
      }
    });

    it('os três segredos viram Secret: não aparecem em JSON, em inspect nem em template', () => {
      const env = parseEnv({
        ...base,
        BETTER_AUTH_SECRET: secret,
        GOOGLE_CLIENT_SECRET: 'segredo-sintetico-do-google',
        ACS_CONNECTION_STRING: 'endpoint=https://x.communication.azure.com/;accesskey=c2VtLXZhbG9y',
      });
      expect(env.BETTER_AUTH_SECRET?.reveal()).toBe(secret);
      for (const shown of [
        JSON.stringify(env),
        inspect(env, { depth: 5 }),
        `${String(env.BETTER_AUTH_SECRET)}`,
      ]) {
        expect(shown).not.toContain(secret);
        expect(shown).not.toContain('segredo-sintetico-do-google');
        expect(shown).not.toContain('c2VtLXZhbG9y');
      }
    });

    it('lidos de process.env, os três saem de lá (o despejo do ambiente não os expõe)', () => {
      vi.stubEnv('DATABASE_URL', base.DATABASE_URL);
      vi.stubEnv('BETTER_AUTH_SECRET', secret);
      vi.stubEnv('GOOGLE_CLIENT_SECRET', 'segredo-sintetico-do-google');
      vi.stubEnv(
        'ACS_CONNECTION_STRING',
        'endpoint=https://x.communication.azure.com/;accesskey=c2VtLXZhbG9y',
      );
      vi.stubEnv('PUBLIC_URL', 'https://alvesting.example.test');
      try {
        const env = parseEnv();
        expect(env.BETTER_AUTH_SECRET?.reveal()).toBe(secret);
        expect(process.env.BETTER_AUTH_SECRET).toBeUndefined();
        expect(process.env.GOOGLE_CLIENT_SECRET).toBeUndefined();
        expect(process.env.ACS_CONNECTION_STRING).toBeUndefined();
        expect(process.env.PUBLIC_URL).toBe('https://alvesting.example.test');
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('em branco e PENDENTE (o placeholder do Key Vault) valem como ausentes', () => {
      for (const value of ['', 'PENDENTE']) {
        const env = parseEnv({
          ...base,
          BETTER_AUTH_SECRET: value,
          GOOGLE_CLIENT_SECRET: value,
          ACS_CONNECTION_STRING: value,
        });
        expect(env.BETTER_AUTH_SECRET).toBeUndefined();
        expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
        expect(env.ACS_CONNECTION_STRING).toBeUndefined();
      }
      expect(
        parseEnv({ ...base, GOOGLE_CLIENT_ID: '', PUBLIC_URL: '' }).GOOGLE_CLIENT_ID,
      ).toBeUndefined();
    });

    it('o segredo da sessão tem 32 caracteres ou mais, e o erro não repete o valor', () => {
      expect(
        parseEnv({ ...base, BETTER_AUTH_SECRET: 'x'.repeat(32) }).BETTER_AUTH_SECRET,
      ).toBeDefined();
      expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: 'curto-demais' })).toThrow(
        /BETTER_AUTH_SECRET/,
      );
      expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: 'curto-demais' })).not.toThrow(
        /curto-demais/,
      );
    });

    it('PUBLIC_URL, o remetente e o contato têm de ser o que dizem ser', () => {
      expect(parseEnv({ ...base, PUBLIC_URL: 'https://alvesting.example.test' }).PUBLIC_URL).toBe(
        'https://alvesting.example.test',
      );
      expect(() => parseEnv({ ...base, PUBLIC_URL: 'banana' })).toThrow(/PUBLIC_URL/);
      expect(() => parseEnv({ ...base, EMAIL_SENDER_ADDRESS: 'banana' })).toThrow(
        /EMAIL_SENDER_ADDRESS/,
      );
      expect(() => parseEnv({ ...base, LEGAL_CONTACT_EMAIL: 'banana' })).toThrow(
        /LEGAL_CONTACT_EMAIL/,
      );
      expect(() => parseEnv({ ...base, LEGAL_CONTROLLER_NAME: 'x'.repeat(201) })).toThrow(
        /LEGAL_CONTROLLER_NAME/,
      );
    });
  });
});

// O login da api no Postgres (papel mínimo, onda 3d; docs/INFRA.md, 2.7): só o papel HTTP o usa, e nenhum outro papel o lê.
describe('API_DATABASE_URL: o login de menor privilégio da api', () => {
  const apiUrl = 'postgresql://alvesting_api:alvesting_api@localhost:25432/alvesting_dev';

  it('é opcional, em branco vale como ausente, e só aceita URL de Postgres', () => {
    expect(parseEnv(base).API_DATABASE_URL).toBeUndefined();
    expect(parseEnv({ ...base, API_DATABASE_URL: '' }).API_DATABASE_URL).toBeUndefined();
    expect(parseEnv({ ...base, API_DATABASE_URL: apiUrl }).API_DATABASE_URL).toBe(apiUrl);
    expect(() => parseEnv({ ...base, API_DATABASE_URL: 'banana' })).toThrow(/API_DATABASE_URL/);
    // o erro lista o nome e a regra, nunca o valor (a URL leva a senha)
    expect(() => parseEnv({ ...base, API_DATABASE_URL: 'senha-e-segredo' })).not.toThrow(
      /senha-e-segredo/,
    );
  });

  it('useApiLogin: com a variável, o DATABASE_URL do papel HTTP passa a ser o do login da api', () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: base.DATABASE_URL, API_DATABASE_URL: apiUrl };
    useApiLogin(env);
    expect(env.DATABASE_URL).toBe(apiUrl);
  });

  it('useApiLogin: sem a variável (ou em branco) o DATABASE_URL fica como está, que é o caso da Azure', () => {
    for (const API_DATABASE_URL of [undefined, '']) {
      const env: NodeJS.ProcessEnv = { DATABASE_URL: base.DATABASE_URL, API_DATABASE_URL };
      useApiLogin(env);
      expect(env.DATABASE_URL).toBe(base.DATABASE_URL);
    }
  });

  // Fail closed (etapa 10, parte 4; docs/INFRA.md, 2.2): na Azure o ca-api recebe o login da api no DATABASE_URL (segredo database-url-api). Um
  // segredo trocado por engano pelo do administrador, dono das tabelas, a poria de volta com poder de DDL e em silêncio. Em produção o papel
  // HTTP recusa subir com outro usuário; fora dela (dev, teste, e2e) o login vale o que o ambiente disser.
  describe('requireApiLogin', () => {
    const production = { NODE_ENV: 'production' };

    it('em produção, aceita o login da api (inclusive com a senha codificada na URL)', () => {
      for (const url of [
        apiUrl,
        'postgresql://alvesting_api:p%2Fa%2Bs%3Ds@psql-alvesting.postgres.database.azure.com:5432/alvesting?sslmode=require',
        'postgresql://alvesting%5Fapi:x@h:5432/alvesting',
      ]) {
        expect(() => requireApiLogin({ ...production, DATABASE_URL: url })).not.toThrow();
      }
    });

    it('em produção, recusa o administrador, outro usuário, uma URL torta e a falta de URL, sem repetir a URL', () => {
      for (const url of [
        'postgresql://alvesting:segredo-do-admin@h:5432/alvesting',
        'postgresql://postgres:segredo-do-admin@h:5432/alvesting',
        'postgresql://alvesting_api_x:segredo-do-admin@h:5432/alvesting',
        'postgresql://:segredo-do-admin@h:5432/alvesting',
        'segredo-do-admin',
        undefined,
      ]) {
        const attempt = () => requireApiLogin({ ...production, DATABASE_URL: url });
        expect(attempt).toThrow(/login alvesting_api/);
        expect(attempt).not.toThrow(/segredo-do-admin/);
      }
    });

    it('fora de produção não confere nada (dev, teste e e2e escolhem o login)', () => {
      for (const NODE_ENV of ['development', 'test', undefined]) {
        expect(() => requireApiLogin({ NODE_ENV, DATABASE_URL: base.DATABASE_URL })).not.toThrow();
      }
    });

    it('vale depois do useApiLogin: em produção o API_DATABASE_URL também passa pelo guarda', () => {
      const env: NodeJS.ProcessEnv = {
        ...production,
        DATABASE_URL: base.DATABASE_URL,
        API_DATABASE_URL: apiUrl,
      };
      useApiLogin(env);
      expect(() => requireApiLogin(env)).not.toThrow();
      // e o API_DATABASE_URL de outro usuário é recusado do mesmo jeito
      const wrong: NodeJS.ProcessEnv = {
        ...production,
        DATABASE_URL: base.DATABASE_URL,
        API_DATABASE_URL: 'postgresql://alvesting:x@h:5432/alvesting',
      };
      useApiLogin(wrong);
      expect(() => requireApiLogin(wrong)).toThrow(/login alvesting_api/);
    });
  });
});
