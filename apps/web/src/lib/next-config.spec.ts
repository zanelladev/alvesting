import { LOGO_HEADERS } from '@alvesting/contracts';
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants.js';
import { describe, expect, it } from 'vitest';
import nextConfig, { DEV_API_URL, devApiProxy } from '../../next.config';

// O navegador fala com uma origem só (docs/CONTA.md, seção 9). Na Azure, no perfil padrão, o Front Door manda `/api/*` para a api e o resto
// para o site; no econômico (ADR 0039) e no `pnpm dev` (site na 4300, api na 4310) quem faz é o próprio site, o repasse de src/lib/api-proxy.ts,
// ligado por API_PROXY=on (no econômico, o Bicep a põe; em dev, a fase de desenvolvimento desta config). O build e o servidor de produção não
// mexem nisso: lá vale o ambiente do processo. Aqui também: a página de redefinição responde sem Referer.
// (A fase de desenvolvimento lê o .env.local da raiz, que guarda segredos: os testes não a chamam. Quem a prova é o `pnpm dev`, à mão.)
describe('next.config: o repasse de /api em dev', () => {
  it('liga o repasse do site e, sem endereço, aponta para a api do pnpm dev (4310)', () => {
    const env: Record<string, string | undefined> = {};
    devApiProxy(env);
    expect(env).toEqual({ API_PROXY: 'on', API_INTERNAL_URL: DEV_API_URL });
    expect(DEV_API_URL).toBe('http://127.0.0.1:4310');
  });

  it('o endereço que já está no ambiente (do .env.local ou do shell) vale; em branco vale como ausente', () => {
    const env: Record<string, string | undefined> = { API_INTERNAL_URL: 'http://127.0.0.1:4999' };
    devApiProxy(env);
    expect(env).toEqual({ API_PROXY: 'on', API_INTERNAL_URL: 'http://127.0.0.1:4999' });
    const blank: Record<string, string | undefined> = { API_INTERNAL_URL: '', API_PROXY: 'off' };
    devApiProxy(blank);
    expect(blank).toEqual({ API_PROXY: 'on', API_INTERNAL_URL: DEV_API_URL });
  });

  it.each([[PHASE_PRODUCTION_BUILD], [PHASE_PRODUCTION_SERVER]])(
    'fora do desenvolvimento (%s) a config não repassa nada nem mexe no ambiente: nenhum rewrites',
    (phase) => {
      const before = {
        API_PROXY: process.env.API_PROXY,
        API_INTERNAL_URL: process.env.API_INTERNAL_URL,
      };
      expect(nextConfig(phase).rewrites).toBeUndefined();
      expect({
        API_PROXY: process.env.API_PROXY,
        API_INTERNAL_URL: process.env.API_INTERNAL_URL,
      }).toEqual(before);
    },
  );
});

describe('next.config: cabeçalhos', () => {
  it('a página de redefinição de senha responde com Referrer-Policy: no-referrer, depois da regra geral (a última vence)', async () => {
    const rules = await nextConfig(PHASE_PRODUCTION_BUILD).headers!();
    const policyOf = (path: string) => {
      // o Next aplica as regras na ordem e a última que casa com a mesma chave vence
      let value: string | undefined;
      for (const rule of rules) {
        if (rule.source !== '/:path*' && rule.source !== path) continue;
        for (const header of rule.headers) {
          if (header.key === 'Referrer-Policy') value = header.value;
        }
      }
      return value;
    };
    expect(policyOf('/redefinir-senha')).toBe('no-referrer');
    // o resto do site segue com a política geral
    expect(policyOf('/conta')).toBe('strict-origin-when-cross-origin');
    expect(policyOf('/')).toBe('strict-origin-when-cross-origin');
  });

  // As telas da conta têm formulário de senha e ação sem volta. O CSP não pode ter script-src sem nonce (o Next injeta scripts inline na
  // hidratação), mas as diretivas que não pedem nonce fecham o que um HTML injetado faria: trocar a base dos caminhos relativos, mandar o
  // formulário para fora, carregar <object>/<embed>, ou embutir o site.
  it('o CSP de toda página fecha frame-ancestors, base-uri, form-action e object-src', async () => {
    const rules = await nextConfig(PHASE_PRODUCTION_BUILD).headers!();
    const general = rules.find((rule) => rule.source === '/:path*')!;
    const csp = general.headers.find((header) => header.key === 'Content-Security-Policy')!.value;
    expect(csp.split(/;\s*/)).toEqual([
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ]);
  });

  // O logo de um papel (app/logos, ADR 0036) é imagem, nunca documento: a resposta tem de sair com a CSP dos logos, a do contrato da T1 (com
  // `sandbox`). O Next só põe o cabeçalho da rota quando a config ainda não pôs o mesmo (node_modules/next/dist/server/send-response.js), então
  // a CSP geral, que toda resposta ganha, venceria a da rota: a regra de /logos repete a CSP dos logos DEPOIS da geral, e a última vence. A
  // regra é de um segmento só (o arquivo da rota): a página 404 do Next em /logos ou em /logos/a/b segue com a CSP geral, e com o CSS dela.
  it('/logos/<arquivo> sai com a CSP dos logos (com sandbox) e o nosniff, numa regra depois da geral; o resto do site segue com a geral', async () => {
    const rules = await nextConfig(PHASE_PRODUCTION_BUILD).headers!();
    // as três formas de `source` que o next.config.ts usa (o Next as lê com o path-to-regexp)
    const matches = (source: string, path: string) =>
      source === '/:path*' ||
      source === path ||
      (source === '/logos/:arquivo' && /^\/logos\/[^/]+$/.test(path));
    const effective = (path: string, key: string) => {
      let value: string | undefined;
      for (const rule of rules) {
        if (!matches(rule.source, path)) continue;
        for (const header of rule.headers) if (header.key === key) value = header.value;
      }
      return value;
    };
    const general = rules.findIndex((rule) => rule.source === '/:path*');
    const logos = rules.findIndex((rule) => rule.source === '/logos/:arquivo');
    expect(logos).toBeGreaterThan(general);
    expect(effective('/logos/PETR4.svg', 'Content-Security-Policy')).toBe(
      LOGO_HEADERS['Content-Security-Policy'],
    );
    expect(LOGO_HEADERS['Content-Security-Policy']).toMatch(/; sandbox$/);
    expect(effective('/logos/PETR4.svg', 'X-Content-Type-Options')).toBe('nosniff');
    for (const path of ['/', '/acoes/PETR4', '/logos', '/logos/a/b', '/logotipos']) {
      expect(effective(path, 'Content-Security-Policy'), path).toMatch(/^frame-ancestors 'none'/);
    }
  });

  // O navegador só aprende o HSTS do host na primeira resposta em https; sem o cabeçalho nas páginas, ela seria a de /api/*, depois do
  // primeiro envio de formulário. Em http o navegador o ignora (RFC 6797, 8.1), então dev e e2e seguem iguais.
  it('toda página manda Strict-Transport-Security de um ano', async () => {
    const rules = await nextConfig(PHASE_PRODUCTION_BUILD).headers!();
    const general = rules.find((rule) => rule.source === '/:path*')!;
    expect(
      general.headers.find((header) => header.key === 'Strict-Transport-Security')?.value,
    ).toBe('max-age=31536000');
  });
});
