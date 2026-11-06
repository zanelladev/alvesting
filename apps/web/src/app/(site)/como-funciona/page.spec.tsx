import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// A página lê a api para os números da temporada; o sumário não depende dela (a api fora do ar basta).
vi.mock('../../../lib/api', () => ({
  api: { arenaCurrent: vi.fn().mockRejectedValue(new Error('api fora do ar')) },
}));

// O sumário "Nesta página" (components/legal-text.tsx, `Sumario`) repete à mão as seções da página: um link por seção, na ordem, cada um para o
// id de uma seção que existe. Seção nova, renomeada ou fora de ordem reprova aqui, e não vira um link quebrado.
describe('o sumário "Nesta página" do Como funciona', () => {
  it('um link por seção, na ordem da página, cada um para o id dela', async () => {
    const { default: Page } = await import('./page');
    const out = renderToStaticMarkup(await Page());
    const inicio = out.indexOf('<nav aria-label="Nesta página"');
    expect(inicio).toBeGreaterThan(-1);
    const nav = out.slice(inicio, out.indexOf('</nav>', inicio));
    const links = [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    const secoes = [...out.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
    expect(secoes.length).toBeGreaterThanOrEqual(9);
    expect(links).toEqual(secoes);
  });
});
