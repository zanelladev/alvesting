import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../config/env.js';
import {
  BETTER_AUTH_SECRET_EXAMPLE,
  LEGAL_CONTACT_EMAIL_EXAMPLE,
  LEGAL_CONTROLLER_NAME_EXAMPLE,
  accountConfig,
} from './account-config.js';

// O contrato de ambiente da conta (etapa 11; docs/INFRA.md, 2.7, e docs/CONTA.md). Em produção o app RECUSA SUBIR com o segredo
// vazio, curto ou igual ao do .env.example, sem o Communication Services, com o remetente falso ligado, sem o controlador e o
// contato da privacidade, ou com a URL pública fora de https. Fora de produção (dev e teste) tudo isso é frouxo de propósito.
// Os valores abaixo são sintéticos.
const base = { DATABASE_URL: 'postgresql://alvesting:alvesting@localhost:25432/alvesting_test' };
const STRONG = 'k9Zq4Wm7Xr2Pv8Ls5Nd3Hb6Ty1Fc0GjQe7Ua4Ro2Ki9Mz3';
const production = {
  ...base,
  NODE_ENV: 'production',
  PUBLIC_URL: 'https://alvesting.example.test',
  BETTER_AUTH_SECRET: STRONG,
  ACS_CONNECTION_STRING:
    'endpoint=https://acs-teste.communication.azure.com/;accesskey=c2VtLXZhbG9yLXJlYWw=',
  EMAIL_SENDER_ADDRESS: 'DoNotReply@0123abcd.azurecomm.net',
  LEGAL_CONTROLLER_NAME: 'Controlador de Teste',
  LEGAL_CONTACT_EMAIL: 'privacidade@example.test',
};
const dev = { ...base, EMAIL_OUTBOX_DIR: '/tmp/alvesting-outbox-de-teste' };

const without = (source: Record<string, string>, name: string) => {
  const { [name]: _removed, ...rest } = source;
  return rest;
};

describe('em produção', () => {
  it('com tudo no lugar: sobe, com o Communication Services e a URL só da origem', () => {
    const config = accountConfig(parseEnv(production));
    expect(config).toMatchObject({
      publicUrl: 'https://alvesting.example.test',
      controller: { name: 'Controlador de Teste', contact: 'privacidade@example.test' },
      google: null,
      behindFrontDoor: false,
    });
    expect(config.email).toMatchObject({
      kind: 'acs',
      sender: 'DoNotReply@0123abcd.azurecomm.net',
    });
    expect(config.secret.reveal()).toBe(STRONG);
  });

  it.each([
    'PUBLIC_URL',
    'BETTER_AUTH_SECRET',
    'ACS_CONNECTION_STRING',
    'EMAIL_SENDER_ADDRESS',
    'LEGAL_CONTROLLER_NAME',
    'LEGAL_CONTACT_EMAIL',
  ])('sem %s: recusa subir', (name) => {
    expect(() => accountConfig(parseEnv(without(production, name)))).toThrow(new RegExp(name));
  });

  it('o segredo em branco ou PENDENTE (o placeholder do Key Vault) vale como ausente: recusa', () => {
    for (const value of ['', 'PENDENTE']) {
      expect(() => accountConfig(parseEnv({ ...production, BETTER_AUTH_SECRET: value }))).toThrow(
        /BETTER_AUTH_SECRET/,
      );
    }
  });

  it('o segredo curto não passa nem do parseEnv (menos de 32 caracteres)', () => {
    expect(() => parseEnv({ ...production, BETTER_AUTH_SECRET: 'x'.repeat(31) })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('o segredo de exemplo do .env.example é recusado', () => {
    expect(() =>
      accountConfig(parseEnv({ ...production, BETTER_AUTH_SECRET: BETTER_AUTH_SECRET_EXAMPLE })),
    ).toThrow(/BETTER_AUTH_SECRET.*exemplo/);
  });

  // Copiar o .env.example para a produção publicaria uma política de privacidade com um controlador de mentira, que o art. 9 da LGPD
  // não admite.
  it('o controlador e o contato de exemplo do .env.example são recusados', () => {
    expect(() =>
      accountConfig(
        parseEnv({ ...production, LEGAL_CONTROLLER_NAME: LEGAL_CONTROLLER_NAME_EXAMPLE }),
      ),
    ).toThrow(/LEGAL_CONTROLLER_NAME.*exemplo/);
    expect(() =>
      accountConfig(parseEnv({ ...production, LEGAL_CONTACT_EMAIL: LEGAL_CONTACT_EMAIL_EXAMPLE })),
    ).toThrow(/LEGAL_CONTACT_EMAIL.*exemplo/);
  });

  it('o segredo que repete poucos caracteres é recusado, mesmo comprido', () => {
    for (const weak of ['a'.repeat(64), 'ab'.repeat(40), '0123456789'.repeat(5)]) {
      expect(() => accountConfig(parseEnv({ ...production, BETTER_AUTH_SECRET: weak }))).toThrow(
        /BETTER_AUTH_SECRET/,
      );
    }
  });

  it('o remetente falso (EMAIL_OUTBOX_DIR) não liga: recusa subir', () => {
    expect(() =>
      accountConfig(parseEnv({ ...production, EMAIL_OUTBOX_DIR: '/tmp/caixa-de-saida' })),
    ).toThrow(/EMAIL_OUTBOX_DIR/);
  });

  it.each([
    ['http', 'http://alvesting.example.test'],
    ['com caminho', 'https://alvesting.example.test/app'],
    ['com query', 'https://alvesting.example.test/?x=1'],
    ['com usuário', 'https://u:p@alvesting.example.test'],
    ['que não é URL', 'banana'],
  ])('PUBLIC_URL %s: recusa', (_nome, PUBLIC_URL) => {
    expect(() => accountConfig(parseEnv({ ...production, PUBLIC_URL }))).toThrow(/PUBLIC_URL/);
  });

  it('a barra no fim da URL pública é aceita e some', () => {
    expect(
      accountConfig(parseEnv({ ...production, PUBLIC_URL: 'https://alvesting.example.test/' }))
        .publicUrl,
    ).toBe('https://alvesting.example.test');
  });

  it('o ACS_CONNECTION_STRING precisa ter a forma endpoint=https://...;accesskey=...', () => {
    for (const bad of [
      'banana',
      'endpoint=http://x.example.test/;accesskey=abc',
      'accesskey=abc',
    ]) {
      expect(() => accountConfig(parseEnv({ ...production, ACS_CONNECTION_STRING: bad }))).toThrow(
        /ACS_CONNECTION_STRING/,
      );
    }
  });

  it('atrás do Front Door (ORIGIN_LOCK) a configuração sabe: o IP vem do X-Azure-SocketIP', () => {
    const config = accountConfig(
      parseEnv({
        ...production,
        ORIGIN_LOCK: 'front-door',
        FRONT_DOOR_ID: 'c0ffee00-1234-4abc-8def-0123456789ab',
      }),
    );
    expect(config.behindFrontDoor).toBe(true);
  });

  it('a mensagem de erro lista só os nomes, nunca os valores', () => {
    let message = '';
    try {
      accountConfig(
        parseEnv({
          ...production,
          PUBLIC_URL: 'http://segredo-no-host.example.test',
          BETTER_AUTH_SECRET: 'a'.repeat(64),
          EMAIL_OUTBOX_DIR: '/tmp/caminho-sensivel',
        }),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('PUBLIC_URL');
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).toContain('EMAIL_OUTBOX_DIR');
    for (const leaked of ['segredo-no-host', 'aaaaaaaa', 'caminho-sensivel']) {
      expect(message).not.toContain(leaked);
    }
  });
});

describe('fora de produção (dev e teste)', () => {
  it('só com a caixa de saída: URL do site de dev, segredo de exemplo, remetente falso e sem controlador', () => {
    const config = accountConfig(parseEnv(dev));
    expect(config).toMatchObject({
      publicUrl: 'http://127.0.0.1:4300',
      controller: null,
      google: null,
    });
    expect(config.secret.reveal()).toBe(BETTER_AUTH_SECRET_EXAMPLE);
    expect(config.email).toMatchObject({ kind: 'outbox', dir: '/tmp/alvesting-outbox-de-teste' });
  });

  it('sem nenhum jeito de mandar e-mail, recusa (melhor que cadastrar usuário que nunca recebe o link)', () => {
    expect(() => accountConfig(parseEnv(base))).toThrow(/EMAIL_OUTBOX_DIR|ACS_CONNECTION_STRING/);
  });

  it('aceita http, a URL do site de dev e o Communication Services no lugar da caixa de saída', () => {
    const config = accountConfig(
      parseEnv({
        ...base,
        PUBLIC_URL: 'http://127.0.0.1:4301',
        ACS_CONNECTION_STRING: production.ACS_CONNECTION_STRING,
        EMAIL_SENDER_ADDRESS: production.EMAIL_SENDER_ADDRESS,
      }),
    );
    expect(config.publicUrl).toBe('http://127.0.0.1:4301');
    expect(config.email.kind).toBe('acs');
  });

  it('o controlador e o contato vêm juntos ou não vêm: um sem o outro é erro', () => {
    expect(() => accountConfig(parseEnv({ ...dev, LEGAL_CONTROLLER_NAME: 'Só o nome' }))).toThrow(
      /LEGAL_CONTACT_EMAIL/,
    );
    expect(() =>
      accountConfig(parseEnv({ ...dev, LEGAL_CONTACT_EMAIL: 'privacidade@example.test' })),
    ).toThrow(/LEGAL_CONTROLLER_NAME/);
  });

  it('o contato tem de ser um e-mail', () => {
    expect(() => parseEnv({ ...dev, LEGAL_CONTACT_EMAIL: 'banana' })).toThrow(
      /LEGAL_CONTACT_EMAIL/,
    );
  });
});

describe('o login com o Google', () => {
  const google = {
    GOOGLE_CLIENT_ID: 'id-sintetico.apps.example.test',
    GOOGLE_CLIENT_SECRET: 'segredo-sintetico-do-google',
  };

  it('só existe com o id e o secret os dois', () => {
    const config = accountConfig(parseEnv({ ...dev, ...google }));
    expect(config.google?.clientId).toBe(google.GOOGLE_CLIENT_ID);
    expect(config.google?.clientSecret.reveal()).toBe(google.GOOGLE_CLIENT_SECRET);
  });

  it.each([
    ['sem nenhum dos dois', {}],
    ['só o id', { GOOGLE_CLIENT_ID: google.GOOGLE_CLIENT_ID }],
    ['só o secret', { GOOGLE_CLIENT_SECRET: google.GOOGLE_CLIENT_SECRET }],
    [
      'o secret PENDENTE (placeholder do Key Vault)',
      { ...google, GOOGLE_CLIENT_SECRET: 'PENDENTE' },
    ],
    ['o id em branco', { ...google, GOOGLE_CLIENT_ID: '' }],
  ])('%s: o login por Google não existe e nada quebra', (_nome, extra) => {
    expect(accountConfig(parseEnv({ ...dev, ...extra })).google).toBeNull();
    expect(accountConfig(parseEnv({ ...production, ...extra })).google).toBeNull();
  });

  it('o secret do Google não aparece em JSON nem em template', () => {
    const config = accountConfig(parseEnv({ ...dev, ...google }));
    expect(JSON.stringify(config)).not.toContain(google.GOOGLE_CLIENT_SECRET);
    expect(JSON.stringify(config)).not.toContain(BETTER_AUTH_SECRET_EXAMPLE);
    expect(`${String(config.secret)}`).not.toContain(BETTER_AUTH_SECRET_EXAMPLE);
  });
});

describe('o .env.example', () => {
  const example = readFileSync(new URL('../../../../../../.env.example', import.meta.url), 'utf8');
  const line = (name: string) => new RegExp(`^${name}=(.*)$`, 'm').exec(example)?.[1];

  it('traz o segredo, o controlador e o contato de exemplo que a produção recusa', () => {
    expect(line('BETTER_AUTH_SECRET')).toBe(BETTER_AUTH_SECRET_EXAMPLE);
    expect(line('LEGAL_CONTROLLER_NAME')).toBe(LEGAL_CONTROLLER_NAME_EXAMPLE);
    expect(line('LEGAL_CONTACT_EMAIL')).toBe(LEGAL_CONTACT_EMAIL_EXAMPLE);
  });

  it('o ambiente de exemplo, sozinho, sobe em dev e não sobe em produção', () => {
    const env: Record<string, string> = { ...base };
    for (const match of example.matchAll(/^([A-Z_]+)=(.*)$/gm)) env[match[1]!] = match[2]!;
    expect(() => accountConfig(parseEnv({ ...env, NODE_ENV: 'development' }))).not.toThrow();
    expect(() => accountConfig(parseEnv({ ...env, NODE_ENV: 'production' }))).toThrow();
  });

  it('não escreve e-mail de ninguém: o contato é de exemplo, em example.com ou example.test', () => {
    const mails = example.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
    for (const mail of mails) expect(mail, mail).toMatch(/@example\.(com|test)$/);
  });
});
