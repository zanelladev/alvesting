import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@alvesting/contracts';
import { ApiError } from '../../lib/api';

// A página da conta (etapa 11, parte 2): o que ela faz com o que a api diz sobre a sessão e o aceite. Os e2e conferem o caminho de
// verdade (cookie, api, navegador); aqui entram os estados que a api do e2e não produz, como o texto que mudou de versão.
const readMe = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${path}` });
  }),
);
const cookieHeader = vi.hoisted(() => ({
  value: 'alvesting.session_token=a.b%2Bc; _ga=rastreador',
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ cookie: cookieHeader.value })),
}));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('../../lib/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/account')>()),
  readMe,
}));

const { default: AccountPage } = await import('./page');

const documents = (accepted: boolean, termsVersion = '0.1') => [
  {
    document: 'TERMS' as const,
    version: termsVersion,
    effectiveDate: '2026-11-02',
    sha256: 'a'.repeat(64),
    acceptedAt: accepted ? '2026-11-02T12:30:00.000Z' : null,
  },
  {
    document: 'PRIVACY' as const,
    version: '0.1',
    effectiveDate: '2026-11-02',
    sha256: 'b'.repeat(64),
    acceptedAt: '2026-11-02T12:30:00.000Z',
  },
];

const me = (overrides: Partial<Me> = {}): Me => ({
  id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  name: 'Pessoa do <teste>',
  email: 'pessoa@example.test',
  emailVerified: true,
  role: 'USER',
  consent: { upToDate: true, documents: documents(true) },
  ...overrides,
});

const render = async () => renderToStaticMarkup(await AccountPage({}));

beforeEach(() => {
  readMe.mockReset();
  redirect.mockClear();
});

describe('a página /conta', () => {
  it('lê a api só com o cookie da sessão: o de um rastreador não vai', async () => {
    readMe.mockResolvedValue(me());
    await render();
    expect(readMe).toHaveBeenCalledWith('alvesting.session_token=a.b%2Bc');
  });

  it('sem sessão (a api diz que ninguém está logado) manda para a entrada, com o caminho de volta', async () => {
    readMe.mockResolvedValue(null);
    await expect(render()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;/entrar?proximo=%2Fconta',
    });
    expect(redirect).toHaveBeenCalledWith('/entrar?proximo=%2Fconta');
  });

  it('sem cookie nenhum, também: a página nem chama a api com nada', async () => {
    cookieHeader.value = '_ga=so-rastreador';
    readMe.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    expect(readMe).toHaveBeenCalledWith(undefined);
    cookieHeader.value = 'alvesting.session_token=a.b%2Bc; _ga=rastreador';
  });

  it('a api fora do ar vira a tela de erro montada no servidor, e não um redirecionamento para a entrada', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    readMe.mockRejectedValue(new ApiError(503, 'UNAVAILABLE'));
    const out = await render();
    expect(out).toContain('Não foi possível carregar os dados');
    expect(redirect).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('mostra os dados mínimos como texto (o nome com HTML sai escapado) e os aceites com a versão e a data de Brasília', async () => {
    readMe.mockResolvedValue(me());
    const out = await render();
    expect(out).toContain('Pessoa do &lt;teste&gt;');
    expect(out).not.toContain('<teste>');
    expect(out).toContain('pessoa@example.test');
    expect(out).toContain('Termos de uso, versão 0.1: aceito em 02/11/2026 09:30');
    expect(out).toContain('Política de privacidade, versão 0.1: aceito em 02/11/2026 09:30');
    // o aceite é um registro legal: o fuso está na tela, e não só na documentação
    expect(out).toContain('Datas e horas no horário de Brasília.');
  });

  it('o admin vê o caminho do painel da arena na conta; o usuário comum não vê nada disso', async () => {
    readMe.mockResolvedValue(me({ role: 'ADMIN' }));
    const admin = await render();
    expect(admin).toMatch(/<a[^>]*href="\/admin"[^>]*>[^<]*Abrir o painel da arena/);
    expect(admin).toContain('admin');
    readMe.mockResolvedValue(me({ role: 'USER' }));
    const user = await render();
    expect(user).not.toContain('href="/admin"');
    expect(user).not.toContain('painel da arena');
  });

  it('com o aceite em dia não pede aceite novo', async () => {
    readMe.mockResolvedValue(me());
    const out = await render();
    expect(out).not.toContain('Aceitar as versões novas');
    expect(out).not.toContain('Os textos mudaram');
  });

  it('versão nova de um texto: mostra o pedido de aceite com a versão nova, e diz que exportar e excluir seguem abertos', async () => {
    readMe.mockResolvedValue(
      me({ consent: { upToDate: false, documents: documents(false, '0.2') } }),
    );
    const out = await render();
    expect(out).toContain('Os textos mudaram.');
    expect(out).toContain(
      'Exportar os dados e excluir a conta seguem disponíveis sem o aceite novo.',
    );
    expect(out).toContain('Termos de uso, versão 0.2: ainda não aceito');
    expect(out).toContain('Li e aceito os termos de uso (versão 0.2).');
    expect(out).toContain('Aceitar as versões novas');
    // exportar e excluir não dependem do aceite
    expect(out).toContain('href="/api/v1/me/export"');
    expect(out).toContain('Excluir minha conta');
  });

  it('a exportação é um link comum para um download (funciona sem JavaScript)', async () => {
    readMe.mockResolvedValue(me());
    const out = await render();
    expect(out).toMatch(
      /<a[^>]*href="\/api\/v1\/me\/export"[^>]*download="alvesting-meus-dados\.json"/,
    );
  });

  it('diz o que a exclusão apaga e o que fica, antes do botão', async () => {
    readMe.mockResolvedValue(me());
    const out = await render();
    for (const part of [
      'o seu cadastro (nome e e-mail) e a senha',
      'o vínculo com o Google',
      'todas as sessões abertas',
      'o histórico de aceites',
      // a carteira (etapa 12; política 0.2, item 5): a exclusão a apaga, e a tela diz isso antes do botão
      'a sua carteira, com todos os lançamentos',
      'os pedidos de confirmação e de redefinição de senha ainda pendentes',
      'o registro de auditoria da exclusão',
      'As cópias de segurança do banco',
    ]) {
      expect(out, part).toContain(part);
    }
    expect(out.indexOf('a sua carteira, com todos os lançamentos')).toBeLessThan(
      out.indexOf('Excluir minha conta<'),
    );
    expect(out.indexOf('o histórico de aceites')).toBeLessThan(out.indexOf('Excluir minha conta<'));
  });

  it('diz que a exportação leva a carteira com os lançamentos (a política 0.2 promete isso)', async () => {
    readMe.mockResolvedValue(me());
    const out = await render();
    expect(out).toContain('os aceites e a carteira com os lançamentos, em um arquivo JSON');
  });

  it('a página não é indexada (a conta de ninguém é conteúdo público)', async () => {
    const { metadata } = await import('./page');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
