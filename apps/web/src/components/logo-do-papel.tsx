// O logo de um papel, ao lado do ticker (ADR 0036, "Como o site mostra"; docs/TELAS.md, "Logos das ações"), como o Rallies mostra o da
// empresa: um círculo de 16 px nas listas e tabelas e um de 40 px no cabeçalho da página da ação (o do logo do laboratório no cabeçalho do
// modelo). Com a versão (lib/logos.ts, versoesDosLogos, no servidor), o <img> da rota do site (app/logos): o SVG nunca entra na página como
// marcação, e o navegador só fala com o nosso domínio. O círculo é branco nos dois temas (o desenho da brapi conta com o branco atrás; no
// escuro o círculo aparece, no claro some no fundo), com o contorno de 1 px da better-ui por dentro da borda: preto a 10% no claro e branco a
// 10% no escuro (os tokens `logo-fundo` e `logo-contorno` do globals.css, que seguem o `color-scheme` da página). Largura e altura fixas (nada se desloca quando o
// desenho chega), `loading="lazy"` e `decoding="async"`. Sem a versão (o papel sem logo, ou a leitura do índice que falhou), o monograma: a
// primeira letra do ticker num círculo com as cores do tema, o mesmo desenho da inicial do competidor (globals.css, `.logo[data-inicial]`).
// Os dois são decorativos (o ticker está ao lado): `alt=""` e `aria-hidden`, e a letra vem do atributo (`::before`), fora do textContent e do
// innerText que o e2e lê. O respiro até o ticker é de quem chama (`className`; nas listas, `mr-3.5`, os 14 px do Rallies).
// Sem 'use client' e sem import nenhum: serve aos componentes de servidor e aos de cliente.
const TAMANHOS = {
  lista: { px: 16, classe: 'size-4' },
  cabecalho: { px: 40, classe: 'size-10' },
} as const;

// inline-block: o preflight do Tailwind faz todo <img> virar bloco, e no h1 (texto corrido) o logo ficaria numa linha só dele
const IMAGEM =
  'inline-block shrink-0 rounded-full bg-logo-fundo align-middle outline -outline-offset-1 outline-logo-contorno';
const MONOGRAMA =
  'inline-grid shrink-0 place-items-center rounded-full border border-hairline bg-surface-strong align-middle text-muted [container-type:size] before:font-semibold before:leading-none before:text-[length:46cqh] before:content-[attr(data-inicial)]';

export function LogoDoPapel({
  ticker,
  versao,
  tamanho = 'lista',
  className,
}: {
  ticker: string;
  // a versão do SVG (o começo do SHA-256, do índice dos logos); sem ela, o monograma
  versao: string | undefined;
  tamanho?: keyof typeof TAMANHOS;
  className?: string;
}) {
  const { px, classe } = TAMANHOS[tamanho];
  const extra = className ? ` ${className}` : '';
  return versao ? (
    // O <img> comum, e não o next/image: o otimizador do Next não serve SVG (e não precisa: o desenho é vetor, de uns 1,4 KB).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/logos/${encodeURIComponent(ticker)}.svg?v=${encodeURIComponent(versao)}`}
      alt=""
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      data-logo="imagem"
      className={`${classe} ${IMAGEM}${extra}`}
    />
  ) : (
    <span
      aria-hidden="true"
      data-logo="monograma"
      data-inicial={ticker.charAt(0)}
      className={`${classe} ${MONOGRAMA}${extra}`}
    />
  );
}
