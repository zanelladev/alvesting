import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnimatedCounter } from './animated-counter/animated-counter';
import { Tooltip } from './tooltip/tooltip';

// As peças da Arc em uso (ADR 0037: o contador e o tooltip; o segmentado e o esqueleto saíram por falta de uso), no HTML que o servidor manda:
// o que o leitor de tela e o teclado encontram antes da hidratação. O movimento (a roda do algarismo) é do navegador; aqui fica o contrato.
describe('as peças da Arc', () => {
  it('o contador escreve o número em português, inteiro, para o leitor de tela', () => {
    const out = renderToStaticMarkup(<AnimatedCounter value={1234.5} decimals={2} prefix="R$ " />);
    expect(out).toContain('R$ 1.234,50');
    expect(out).toMatch(/aria-hidden="true"/);
  });

  it('o tooltip deixa o gatilho como está (o balão só nasce no navegador, no hover ou no foco)', () => {
    const out = renderToStaticMarkup(
      <Tooltip content="Claro">
        <button type="button">☀</button>
      </Tooltip>,
    );
    expect(out).toMatch(/^<button type="button"[^>]*data-state="closed"[^>]*>☀<\/button>$/);
  });
});
