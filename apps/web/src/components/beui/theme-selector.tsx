// Adaptado do Theme Toggle da beUI (https://beui.dev/components/motion/theme-toggle; registro https://beui.dev/r/theme-toggle, lido em
// 05/11/2026). Copyright (c) 2026 Saurabh Chauhan, licença MIT (o texto inteiro em components/beui/LICENSE).
// O que veio de lá: a troca de tema que repinta a página pela View Transition API, com o tema novo revelado num círculo que cresce de um
// ponto (o `clip-path` no `::view-transition-new(root)`, no globals.css), e a troca na hora com movimento reduzido ou sem a API.
// O que mudou (ADR 0037): três escolhas (claro, escuro e sistema) num grupo de radios, no lugar do botão de dois estados; sem React no
// cliente, sem Motion, sem next-themes e sem lucide-react (a landing não pode carregar biblioteca acima da dobra): a marcação sai do
// servidor, e o comportamento é o script curto do <head> (`themeScript`), que o layout raiz põe em linha. O círculo nasce do controle
// tocado e dura os 250 ms do token; o teclado e a escolha que não muda a cor em uso trocam sem ele; nenhuma transição roda durante a troca
// (o "borrão" de todas as cores mudando juntas, da better-ui); a barra do navegador (`theme-color`) segue a escolha.
import { Icone } from '../icones';

const IconeClaro = () => (
  <Icone size={18}>
    <circle cx="10" cy="10" r="3.25" />
    <path d="M10 2.75v1.5M10 15.75v1.5M2.75 10h1.5M15.75 10h1.5M4.87 4.87l1.06 1.06M14.07 14.07l1.06 1.06M4.87 15.13l1.06-1.06M14.07 5.93l1.06-1.06" />
  </Icone>
);
const IconeEscuro = () => (
  <Icone size={18}>
    <path d="M16.25 12.1A6.75 6.75 0 0 1 7.9 3.75a6.75 6.75 0 1 0 8.35 8.35z" />
  </Icone>
);
const IconeSistema = () => (
  <Icone size={18}>
    <rect x="2.75" y="3.75" width="14.5" height="10" rx="1.5" />
    <path d="M7.5 17.25h5M10 13.75v3.5" />
  </Icone>
);

const OPCOES = [
  ['claro', 'Claro', IconeClaro],
  ['escuro', 'Escuro', IconeEscuro],
  ['sistema', 'Sistema', IconeSistema],
] as const;

// O seletor: um grupo de radios (o leitor de tela diz "Tema, grupo" e "Claro, botão de opção, 1 de 3"; as setas trocam a escolha), com o
// ícone à vista e o nome em texto. Cada lugar dá o seu `name` (dois grupos com o mesmo nome seriam um grupo só). Nenhum radio vem marcado
// do servidor: o script marca o da escolha guardada antes da pintura. O desenho e a pílula da escolha estão no globals.css (`.tema`).
export function ThemeSelector({
  name,
  vertical = false,
  label = false,
}: {
  name: string;
  vertical?: boolean;
  label?: boolean;
}) {
  const group = (
    <fieldset className={vertical ? 'tema tema-vertical' : 'tema'}>
      <legend className="sr-only">Tema</legend>
      {OPCOES.map(([value, text, Icon]) => (
        <label key={value} data-opcao={value}>
          <input type="radio" name={name} value={value} />
          <Icon />
          <span className="sr-only">{text}</span>
        </label>
      ))}
    </fieldset>
  );
  if (!label) return group;
  return (
    <div className="tema-linha">
      <span className="tema-rotulo" aria-hidden="true">
        Tema
      </span>
      {group}
    </div>
  );
}

// O script do tema, posto em linha no <head> pelo layout raiz (`(${themeScript})()`): roda antes da pintura, então o primeiro quadro já
// vem no tema certo, sem piscar. Ele não pode ler nada de fora da função (vai como texto) e fica no JavaScript que todo navegador do site
// entende. A escolha mora no localStorage (`tema`: "claro" ou "escuro"; sem a chave, "sistema"). No <html>: `data-tema` (a escolha, que
// fixa o `color-scheme` e com ele cada `light-dark()` do globals.css) e a classe `dark` (o tema em uso: a sombra do escuro a lê). O
// `data-theme` da Arc saiu no fechamento da onda: nenhuma peça o lia (as da Arc leem os nossos tokens).
export function themeScript() {
  const KEY = 'tema';
  const root = document.documentElement;
  let pointer = false;
  function read() {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'claro' || value === 'escuro' ? value : 'sistema';
    } catch {
      return 'sistema';
    }
  }
  function dark(choice: string) {
    return (
      choice === 'escuro' ||
      (choice === 'sistema' && matchMedia('(prefers-color-scheme: dark)').matches)
    );
  }
  // os radios de todo seletor na página e a cor da barra do navegador seguem a escolha
  function sync() {
    const choice = root.getAttribute('data-tema');
    const inputs = document.querySelectorAll<HTMLInputElement>('.tema input');
    for (let i = 0; i < inputs.length; i += 1) inputs[i]!.checked = inputs[i]!.value === choice;
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    const night = root.classList.contains('dark');
    for (let j = 0; j < metas.length; j += 1) {
      const meta = metas[j]!;
      const own = meta.media.indexOf('dark') < 0 ? '#ffffff' : '#171717';
      meta.content = choice === 'sistema' ? own : night ? '#171717' : '#ffffff';
    }
  }
  function apply(choice: string) {
    const night = dark(choice);
    root.setAttribute('data-tema', choice);
    root.classList.toggle('dark', night);
    sync();
  }
  // a troca sem o borrão: nenhuma transição enquanto as cores mudam, e elas voltam dois quadros depois
  function swap(choice: string) {
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none!important}';
    document.head.appendChild(style);
    apply(choice);
    root.getBoundingClientRect();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        style.remove();
      });
    });
  }
  apply(read());
  // os seletores chegam com o HTML (ou com a navegação suave): cada um nasce desmarcado e é marcado no quadro seguinte
  let queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      sync();
    });
  }).observe(root, { childList: true, subtree: true });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (root.getAttribute('data-tema') === 'sistema') swap('sistema');
  });
  addEventListener('storage', function (event: StorageEvent) {
    if (event.key === KEY || event.key === null) swap(read());
  });
  document.addEventListener(
    'pointerdown',
    function (event: Event) {
      const target = event.target as Element | null;
      pointer = !!(target && target.closest && target.closest('.tema'));
    },
    true,
  );
  document.addEventListener(
    'keydown',
    function () {
      pointer = false;
    },
    true,
  );
  document.addEventListener('change', function (event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input || !input.closest || !input.closest('.tema')) return;
    const choice = input.value;
    try {
      if (choice === 'sistema') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      // sem o localStorage a escolha vale só nesta página
    }
    const touched = pointer;
    pointer = false;
    // a mesma cor em uso (do escuro para o sistema escuro): só a pílula anda
    if (dark(choice) === root.classList.contains('dark')) return apply(choice);
    if (
      !touched ||
      !document.startViewTransition ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return swap(choice);
    const box = input.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    root.style.setProperty('--tema-x', x + 'px');
    root.style.setProperty('--tema-y', y + 'px');
    root.style.setProperty(
      '--tema-r',
      Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 'px',
    );
    root.setAttribute('data-tema-revelar', '');
    void document
      .startViewTransition(function () {
        swap(choice);
      })
      .finished.finally(function () {
        root.removeAttribute('data-tema-revelar');
      });
  });
}
