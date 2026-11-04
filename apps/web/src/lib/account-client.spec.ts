import { describe, expect, it, vi } from 'vitest';
import { SEND_TIMEOUT_MS, googleBody, messageFor, send, type Reply } from './account-client';

// O que o navegador faz ao falar com a api da conta (a mesma origem, `/api/auth/*` e `/api/v1/me*`) e como a resposta vira a frase
// da tela. Nenhum teste chama rede: o fetch é falso. Nenhuma frase carrega a mensagem crua da api (em inglês, ou com texto do cliente).
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function fakeFetch(respond: () => Response | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      init: init ?? {},
    });
    const next = respond();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { calls, fetch: fn as unknown as typeof fetch };
}

describe('send', () => {
  it('POST em JSON, com o cookie da mesma origem e sem seguir redirecionamento', async () => {
    const { calls, fetch } = fakeFetch(() => json({ status: true }));
    const out = await send('/api/auth/sign-in/email', { body: { email: 'a@example.test' } }, fetch);
    expect(out).toMatchObject({ ok: true, status: 200 });
    expect(calls[0]!.url).toBe('/api/auth/sign-in/email');
    expect(calls[0]!.init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      body: '{"email":"a@example.test"}',
    });
    expect(calls[0]!.init.headers).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/json',
    });
  });

  it('DELETE sem corpo não manda corpo nem content-type', async () => {
    const { calls, fetch } = fakeFetch(() => json({ success: true, data: { deleted: true } }));
    await send('/api/v1/me', { method: 'DELETE' }, fetch);
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.init.body).toBeUndefined();
    expect(calls[0]!.init.headers).not.toHaveProperty('content-type');
  });

  it('PATCH em JSON (a edição de um lançamento da carteira), como o POST', async () => {
    const { calls, fetch } = fakeFetch(() => json({ success: true, data: {} }));
    await send('/api/v1/me/portfolio/lots/01J', { method: 'PATCH', body: { quantity: 5 } }, fetch);
    expect(calls[0]!.init).toMatchObject({
      method: 'PATCH',
      credentials: 'same-origin',
      redirect: 'error',
      body: '{"quantity":5}',
    });
    expect(calls[0]!.init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('no 400 de validação do envelope devolve o campo de cada problema, sem a mensagem nem o valor', async () => {
    const { fetch } = fakeFetch(() =>
      json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Entrada inválida',
            details: [
              { code: 'custom', path: ['ticker'], message: 'ação desconhecida' },
              { code: 'custom', path: ['valueCents', 0], message: 'o custo total passa do teto' },
              // sem caminho, ou com caminho que não é texto: não vira campo
              { code: 'custom', path: [], message: 'x' },
              { code: 'custom', path: [3], message: 'y' },
              'lixo',
              null,
            ],
          },
        },
        400,
      ),
    );
    const out = await send('/a', {}, fetch);
    expect(out).toEqual({
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      paths: ['ticker', 'valueCents'],
    });
  });

  it('detalhes que não são uma lista (ou nenhum) não criam `paths`', async () => {
    for (const details of [undefined, 'texto', { path: ['ticker'] }, []]) {
      const { fetch } = fakeFetch(() =>
        json(
          {
            success: false,
            data: null,
            error: { code: 'VALIDATION_ERROR', message: 'x', ...(details ? { details } : {}) },
          },
          400,
        ),
      );
      expect(await send('/a', {}, fetch), JSON.stringify(details)).toEqual({
        ok: false,
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
  });

  it('lê o código do erro do Better Auth ({ code }) e o do envelope ({ error: { code } })', async () => {
    const better = fakeFetch(() => json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'x' }, 401));
    expect(await send('/a', {}, better.fetch)).toMatchObject({
      ok: false,
      status: 401,
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });
    const envelope = fakeFetch(() =>
      json({ success: false, data: null, error: { code: 'REAUTH_REQUIRED', message: 'y' } }, 403),
    );
    expect(await send('/a', {}, envelope.fetch)).toMatchObject({
      ok: false,
      status: 403,
      code: 'REAUTH_REQUIRED',
    });
  });

  it('o prazo do limite de tentativas vem do X-Retry-After', async () => {
    const { fetch } = fakeFetch(() =>
      json({ message: 'Too many requests' }, 429, { 'x-retry-after': '7' }),
    );
    expect(await send('/a', {}, fetch)).toMatchObject({ ok: false, status: 429, retryAfter: 7 });
  });

  it.each([['abc'], ['-3'], ['0'], ['']])('ignora o X-Retry-After torto (%j)', async (value) => {
    const { fetch } = fakeFetch(() => json({}, 429, { 'x-retry-after': value }));
    expect((await send('/a', {}, fetch)).retryAfter).toBeUndefined();
  });

  it('corpo que não é JSON (a borda caiu, HTML de erro) não quebra: só o status', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>502</html>', { status: 502 }));
    expect(await send('/a', {}, fetch)).toEqual({ ok: false, status: 502 });
  });

  it('falha de rede vira status 0, sem lançar', async () => {
    const { fetch } = fakeFetch(() => new TypeError('Failed to fetch'));
    expect(await send('/a', {}, fetch)).toEqual({ ok: false, status: 0 });
  });

  it('devolve o corpo de sucesso, para quem precisa dele (a URL do Google)', async () => {
    const { fetch } = fakeFetch(() => json({ url: 'https://accounts.example.test/auth' }));
    expect((await send('/a', {}, fetch)).body).toEqual({
      url: 'https://accounts.example.test/auth',
    });
  });

  // Uma rede que trava depois do envio: sem prazo o formulário ficava em "Enviando…" até o navegador desistir, minutos depois.
  it('manda um prazo de 15 s junto do pedido', async () => {
    const { calls, fetch } = fakeFetch(() => json({}));
    await send('/a', {}, fetch);
    const signal = calls[0]!.init.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
    expect(SEND_TIMEOUT_MS).toBe(15_000);
  });

  it('o pedido que nunca responde é cortado no prazo e vira "sem conexão" (status 0), sem lançar', async () => {
    const hanging = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('o prazo estourou', 'TimeoutError')),
          );
        }),
    ) as unknown as typeof fetch;
    const started = Date.now();
    expect(await send('/a', {}, hanging, 30)).toEqual({ ok: false, status: 0 });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('messageFor', () => {
  const out = (over: Partial<Reply>): Reply => ({ ok: false, status: 400, ...over });

  it.each([
    ['INVALID_EMAIL_OR_PASSWORD', 'E-mail ou senha incorretos.'],
    ['INVALID_PASSWORD', 'Senha incorreta.'],
    ['INVALID_TOKEN', 'Este link venceu ou já foi usado. Peça um novo.'],
    ['TOKEN_EXPIRED', 'Este link venceu. Peça um novo.'],
    ['PASSWORD_TOO_SHORT', 'A senha precisa ter pelo menos 10 caracteres.'],
    ['PASSWORD_TOO_LONG', 'A senha pode ter no máximo 128 caracteres.'],
    ['CONSENT_REQUIRED', 'Aceite os termos de uso e a política de privacidade para criar a conta.'],
    ['UNAUTHORIZED', 'Sua sessão acabou. Entre de novo.'],
  ])('%s', (code, text) => {
    expect(messageFor(out({ code }))).toBe(text);
  });

  it('o erro do perfil diz o que conferir, sem repetir o que a pessoa digitou', () => {
    expect(messageFor(out({ code: 'INVALID_PROFILE' }))).toMatch(/nome.*e-mail/);
  });

  it('429 diz quanto esperar quando a api diz, e o que fazer quando não diz', () => {
    expect(messageFor(out({ status: 429, retryAfter: 7 }))).toBe(
      'Muitas tentativas. Espere 7 segundos e tente de novo.',
    );
    expect(messageFor(out({ status: 429, retryAfter: 1 }))).toBe(
      'Muitas tentativas. Espere 1 segundo e tente de novo.',
    );
    expect(messageFor(out({ status: 429, retryAfter: 120 }))).toBe(
      'Muitas tentativas. Espere 2 minutos e tente de novo.',
    );
    expect(messageFor(out({ status: 429 }))).toBe(
      'Muitas tentativas. Espere um pouco e tente de novo.',
    );
  });

  it('sem conexão, corpo grande demais e erro do servidor têm frase própria', () => {
    expect(messageFor(out({ status: 0 }))).toMatch(/conexão/);
    expect(messageFor(out({ status: 413, code: 'PAYLOAD_TOO_LARGE' }))).toMatch(/grande demais/);
    for (const status of [500, 502, 503]) {
      expect(messageFor(out({ status }))).toBe(
        'Não foi possível concluir agora. Tente de novo em alguns minutos.',
      );
    }
  });

  it('código desconhecido cai na frase do status, e nunca na mensagem crua da api', () => {
    const text = messageFor(out({ status: 400, code: 'ALGO_NOVO_EM_INGLES' }));
    expect(text).not.toContain('ALGO_NOVO');
    expect(text).toBe('Não foi possível concluir. Confira os dados e tente de novo.');
  });
});

// O que o CONTA.md manda para o Google: entrar não cria conta; cadastrar manda requestSignUp com o aceite no additionalData.
describe('googleBody', () => {
  it('entrar: só o provedor e para onde voltar, sem criar conta', () => {
    expect(googleBody({ next: '/conta' })).toEqual({
      provider: 'google',
      callbackURL: '/conta',
      newUserCallbackURL: '/conta',
      errorCallbackURL: '/entrar',
    });
  });

  it('cadastrar: requestSignUp e o aceite explícito das versões que a pessoa viu', () => {
    expect(googleBody({ next: '/conta', consent: { terms: '0.1', privacy: '0.2' } })).toEqual({
      provider: 'google',
      callbackURL: '/conta',
      newUserCallbackURL: '/conta',
      errorCallbackURL: '/entrar',
      requestSignUp: true,
      additionalData: { consent: { terms: '0.1', privacy: '0.2' } },
    });
  });
});
