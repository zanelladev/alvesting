import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants.js';
import { describe, expect, it } from 'vitest';
import nextConfig, { devRewrites } from '../../next.config';

// O navegador fala com uma origem só (docs/CONTA.md, seção 9). Na Azure o Front Door manda `/api/*` para a api e o resto para o site; o
// site NÃO tem caminho de produção que faça isso. Em dev (site na 4300, api na 4310) quem faz é o `rewrites` do Next, ligado só na fase
// do servidor de desenvolvimento: o build e o servidor de produção não o têm. Aqui também: a página de redefinição responde sem Referer.
// (A fase de desenvolvimento lê o .env.local da raiz, que guarda segredos: os testes não a chamam. Quem a prova é o `pnpm dev`, à mão.)
describe('next.config: o roteamento de /api em dev', () => {
  it('/api/* vai para o endereço interno da api', () => {
    expect(devRewrites({ API_INTERNAL_URL: 'http://127.0.0.1:4310' })).toEqual([
      { source: '/api/:path*', destination: 'http://127.0.0.1:4310/api/:path*' },
    ]);
  });

  it('só a origem importa: barra no fim, caminho e query do endereço não entram', () => {
    for (const base of ['http://127.0.0.1:4999/', 'http://127.0.0.1:4999/api/v1?x=1']) {
      expect(devRewrites({ API_INTERNAL_URL: base })).toEqual([
        { source: '/api/:path*', destination: 'http://127.0.0.1:4999/api/:path*' },
      ]);
    }
  });

  it('sem o endereço, vale o da api do pnpm dev (4310)', () => {
    expect(devRewrites({})).toEqual([
      { source: '/api/:path*', destination: 'http://127.0.0.1:4310/api/:path*' },
    ]);
  });

  it('um endereço que não é http(s) é erro claro, e não um repasse para lugar nenhum', () => {
    for (const base of ['banana', 'file:///etc/passwd', 'javascript:alert(1)']) {
      expect(() => devRewrites({ API_INTERNAL_URL: base }), base).toThrow(/API_INTERNAL_URL/);
    }
  });

  it.each([[PHASE_PRODUCTION_BUILD], [PHASE_PRODUCTION_SERVER]])(
    'fora do desenvolvimento (%s) o site não repassa nada: nenhum rewrites',
    (phase) => {
      expect(nextConfig(phase).rewrites).toBeUndefined();
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
