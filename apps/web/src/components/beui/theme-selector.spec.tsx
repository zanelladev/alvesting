import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSelector, themeScript } from './theme-selector';

// O script do tema roda no <head>, antes da pintura (layout.tsx o põe em linha). Aqui ele roda num DOM de mentira, o mínimo que ele toca:
// o <html> (atributos, classe e estilo), os radios do seletor, as metas de cor, o localStorage, as media queries e os eventos. O e2e
// (e2e/tema.spec.ts) prova o resto no navegador de verdade, nos seis projetos.
type Listener = (event: Record<string, unknown>) => void;

function fakeDom({
  stored,
  systemDark = false,
  storageThrows = false,
}: {
  stored?: string;
  systemDark?: boolean;
  storageThrows?: boolean;
}) {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const style = new Map<string, string>();
  const root = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    removeAttribute: (name: string) => attributes.delete(name),
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name: string) => classes.has(name),
    },
    style: { setProperty: (name: string, value: string) => style.set(name, value) },
    // a leitura que força o estilo novo antes de as transições voltarem
    getBoundingClientRect: () => ({}),
  };
  const radio = (value: string) => ({
    value,
    checked: false,
    closest: (selector: string) => (selector === '.tema' ? {} : null),
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 44, height: 44 }),
  });
  const radios = ['claro', 'escuro', 'sistema', 'claro', 'escuro', 'sistema'].map(radio);
  const metas = [
    { media: '(prefers-color-scheme: light)', content: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', content: '#171717' },
  ];
  const documentListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const mediaListeners: Listener[] = [];
  const store = new Map<string, string>(stored ? [['tema', stored]] : []);
  const media = (query: string) => ({
    matches: query.includes('dark') ? systemDark : false,
    addEventListener: (_: string, listener: Listener) => mediaListeners.push(listener),
  });
  const transitions: (() => void)[] = [];
  const document = {
    documentElement: root,
    head: { appendChild: vi.fn() },
    createElement: () => ({ textContent: '', remove: vi.fn() }),
    querySelectorAll: (selector: string) =>
      selector === '.tema input' ? radios : selector.startsWith('meta') ? metas : [],
    addEventListener: (type: string, listener: Listener) =>
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]),
    startViewTransition: (update: () => void) => {
      transitions.push(update);
      update();
      return { finished: Promise.resolve() };
    },
  };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error('bloqueado');
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  vi.stubGlobal('document', document);
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('matchMedia', media);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
  vi.stubGlobal('getComputedStyle', () => ({ colorScheme: 'light dark' }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
    },
  );
  vi.stubGlobal('addEventListener', (type: string, listener: Listener) =>
    windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]),
  );
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  const fire = (type: string, event: Record<string, unknown>) =>
    (documentListeners.get(type) ?? []).forEach((listener) => listener(event));
  return {
    attributes,
    classes,
    style,
    radios,
    metas,
    store,
    transitions,
    // o usuário escolhe uma opção: com o dedo ou o mouse (o pointerdown vem antes) ou pelo teclado
    choose(index: number, how: 'pointer' | 'keyboard') {
      const input = radios[index]!;
      if (how === 'pointer') fire('pointerdown', { target: input });
      else fire('keydown', { target: input });
      input.checked = true;
      fire('change', { target: { ...input, matches: () => true } });
    },
    systemFlips(dark: boolean) {
      mediaListeners.forEach((listener) => listener({ matches: dark }));
    },
  };
}

describe('themeScript (o tema antes da pintura)', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('sem escolha guardada, é o "sistema": o tema em uso segue o sistema', () => {
    const dom = fakeDom({ systemDark: true });
    themeScript();
    expect(dom.attributes.get('data-tema')).toBe('sistema');
    expect(dom.classes.has('dark')).toBe(true);
    // o `data-theme` saiu (o nome da Arc, que nenhuma peça lia: o fechamento da onda, 05/11/2026)
    expect(dom.attributes.has('data-theme')).toBe(false);
  });

  it('a escolha guardada vale sobre o sistema, e o radio dela fica marcado em todo seletor', () => {
    const dom = fakeDom({ stored: 'claro', systemDark: true });
    themeScript();
    expect(dom.attributes.get('data-tema')).toBe('claro');
    expect(dom.classes.has('dark')).toBe(false);
    expect(dom.radios.map((r) => r.checked)).toEqual([true, false, false, true, false, false]);
    // a barra do navegador acompanha o tema escolhido, e não o do sistema
    expect(dom.metas.map((m) => m.content)).toEqual(['#ffffff', '#ffffff']);
  });

  it('valor estranho ou localStorage bloqueado viram "sistema", sem erro', () => {
    const weird = fakeDom({ stored: 'roxo' });
    themeScript();
    expect(weird.attributes.get('data-tema')).toBe('sistema');
    vi.unstubAllGlobals();
    const blocked = fakeDom({ storageThrows: true, systemDark: true });
    expect(() => themeScript()).not.toThrow();
    expect(blocked.attributes.get('data-tema')).toBe('sistema');
    expect(blocked.classes.has('dark')).toBe(true);
  });

  it('escolher guarda a escolha, troca o tema e sincroniza os outros seletores; "sistema" apaga a escolha', () => {
    const dom = fakeDom({ systemDark: false });
    themeScript();
    dom.choose(1, 'keyboard');
    expect(dom.store.get('tema')).toBe('escuro');
    expect(dom.attributes.get('data-tema')).toBe('escuro');
    expect(dom.classes.has('dark')).toBe(true);
    expect(dom.radios.map((r) => r.checked)).toEqual([false, true, false, false, true, false]);
    expect(dom.metas.map((m) => m.content)).toEqual(['#171717', '#171717']);
    dom.choose(2, 'keyboard');
    expect(dom.store.has('tema')).toBe(false);
    expect(dom.attributes.get('data-tema')).toBe('sistema');
    expect(dom.classes.has('dark')).toBe(false);
    expect(dom.metas.map((m) => m.content)).toEqual(['#ffffff', '#171717']);
  });

  // a revelação (a View Transition) só no toque que muda o tema em uso; o teclado troca na hora
  it('o toque que muda o tema revela a página nova a partir do controle; o teclado não anima', () => {
    const dom = fakeDom({ systemDark: false });
    themeScript();
    dom.choose(1, 'keyboard');
    expect(dom.transitions).toHaveLength(0);
    dom.choose(0, 'pointer');
    expect(dom.transitions).toHaveLength(1);
    expect(dom.style.get('--tema-x')).toBe('32px');
    expect(dom.style.get('--tema-y')).toBe('42px');
    expect(Number.parseFloat(dom.style.get('--tema-r') ?? '0')).toBeGreaterThan(800);
    // a mesma cor (do claro para o sistema, com o sistema claro): só a pílula anda, sem revelar a página
    dom.choose(2, 'pointer');
    expect(dom.transitions).toHaveLength(1);
  });

  it('no "sistema", a troca do sistema troca o tema em uso; com uma escolha guardada, não', () => {
    const dom = fakeDom({ systemDark: false });
    themeScript();
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined }));
    dom.systemFlips(true);
    expect(dom.classes.has('dark')).toBe(true);
    dom.choose(0, 'keyboard');
    dom.systemFlips(true);
    expect(dom.classes.has('dark')).toBe(false);
  });
});

// A marcação do seletor sai do servidor (nenhum JavaScript do React): um grupo de radios com a legenda "Tema", cada opção com o nome em
// texto, e nenhum radio marcado no HTML (quem marca é o script, com a escolha guardada).
describe('ThemeSelector', () => {
  const out = renderToStaticMarkup(<ThemeSelector name="tema-teste" />);

  it('é um grupo de três radios com o nome "Tema" e as opções Claro, Escuro e Sistema', () => {
    expect(out).toMatch(/^<fieldset class="tema"><legend class="sr-only">Tema<\/legend>/);
    expect(
      out.match(/<input type="radio" name="tema-teste" value="(claro|escuro|sistema)"\/>/g),
    ).toHaveLength(3);
    expect([...out.matchAll(/<span class="sr-only">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual([
      'Claro',
      'Escuro',
      'Sistema',
    ]);
    expect(out).not.toContain('checked');
  });

  it('em pé no trilho, e com o rótulo visível quando o lugar pede', () => {
    expect(renderToStaticMarkup(<ThemeSelector name="t" vertical />)).toMatch(
      /^<fieldset class="tema tema-vertical">/,
    );
    expect(renderToStaticMarkup(<ThemeSelector name="t" label />)).toMatch(
      /^<div class="tema-linha"><span class="tema-rotulo" aria-hidden="true">Tema<\/span><fieldset class="tema">/,
    );
  });
});
