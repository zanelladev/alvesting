import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// O segredo da rota interna de cotações (QUOTES_SECRET) é só do servidor (docs/API.md, seção 6; ADR 0033). Três travas, nesta ordem:
//  1. a variável não tem NEXT_PUBLIC_ (o Next copiaria o valor para o JavaScript do navegador);
//  2. só um módulo a lê, src/lib/quotes.ts, que começa com `import 'server-only'` (um componente de cliente que o importe quebra o build);
//  3. nenhum componente de cliente ('use client'), direto ou por qualquer cadeia de imports, chega a esse módulo.
// A terceira não depende do bundler: se alguém tirar o `server-only`, ela ainda reprova.
const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUOTES = path.join(SRC, 'lib', 'quotes.ts');

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) sources(file, found);
    else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) found.push(file);
  }
  return found;
}

const files = sources(SRC);
const text = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));

// os arquivos que um arquivo importa (só os relativos: o repositório não usa alias de caminho)
function importsOf(file: string): string[] {
  const specifiers = [
    ...text.get(file)!.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g),
  ].map((match) => match[1]!);
  return specifiers.flatMap((specifier) => {
    const base = path.resolve(path.dirname(file), specifier);
    return [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
    ].filter((candidate) => text.has(candidate));
  });
}

describe('o segredo das cotações é só do servidor', () => {
  it('não tem NEXT_PUBLIC_ em lugar nenhum', () => {
    for (const [file, content] of text) {
      expect(content, path.relative(SRC, file)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*QUOTES/);
    }
  });

  it('um módulo só lê QUOTES_SECRET, e ele começa com `import "server-only"`', () => {
    const readers = [...text]
      .filter(([, content]) => content.includes('QUOTES_SECRET'))
      .map(([file]) => file);
    expect(readers.map((file) => path.relative(SRC, file))).toEqual(['lib/quotes.ts']);
    const first = text
      .get(QUOTES)!
      .split('\n')
      .find((line) => line.startsWith('import '));
    expect(first).toBe("import 'server-only';");
  });

  it('nenhum componente de cliente chega a lib/quotes.ts, direto ou por uma cadeia de imports', () => {
    const clients = files.filter((file) => /^\s*['"]use client['"]/.test(text.get(file)!));
    expect(clients.length).toBeGreaterThanOrEqual(5);
    for (const client of clients) {
      const seen = new Set<string>([client]);
      const queue = [client];
      while (queue.length > 0) {
        for (const next of importsOf(queue.shift()!)) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      expect(seen.has(QUOTES), `${path.relative(SRC, client)} chega a lib/quotes.ts`).toBe(false);
    }
  });

  it('o verificador pega o que quer pegar: um cliente que importasse o módulo reprovaria', () => {
    const fake = path.join(SRC, 'components', 'zz-cliente.tsx');
    text.set(fake, "'use client';\nimport { readBars } from '../lib/quotes';\n");
    try {
      expect(importsOf(fake)).toContain(QUOTES);
    } finally {
      text.delete(fake);
    }
  });
});
