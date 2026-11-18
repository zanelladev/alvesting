import type { ReactNode } from 'react';

// Os ícones da casca (ADR 0035 e ADR 0041): SVG em linha, desenhados à mão, formas genéricas (colunas, bússola, carteira, balão, três pontos, lupa,
// pessoa), sem biblioteca. 20 px (`size` muda: o chat os usa em 16 e 18), traço de 1,5 na cor do texto (o tema pinta). Decorativos: o nome
// vem sempre ao lado, em texto. O chat (components/chat/chat-desligado.tsx) desenha os dele com o mesmo `Icone`.
type Tamanho = { size?: number };
export const Icone = ({ size = 20, children }: Tamanho & { children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

// a arena: três colunas de alturas diferentes sobre a linha do chão
export const IconeArena = (p: Tamanho) => (
  <Icone {...p}>
    <path d="M3 16.5h14M5 16.5v-5h3v5M8.5 16.5V5h3v11.5M12 16.5V9h3v7.5" />
  </Icone>
);
export const IconeExplorar = (p: Tamanho) => (
  <Icone {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="m12.8 7.2-1.6 4-4 1.6 1.6-4z" />
  </Icone>
);
export const IconeCarteira = (p: Tamanho) => (
  <Icone {...p}>
    <path d="M3.5 6.5v8a2 2 0 0 0 2 2h10v-10h-10a2 2 0 0 1-2-2 2 2 0 0 1 2-2h8.5v2" />
    <circle cx="12.75" cy="11.5" r=".75" fill="currentColor" stroke="none" />
  </Icone>
);
export const IconeChat = (p: Tamanho) => (
  <Icone {...p}>
    <path d="M4 4.5h12a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H9l-3.5 2.75V14H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" />
  </Icone>
);
export const IconeMais = (p: Tamanho) => (
  <Icone {...p}>
    <circle cx="4.5" cy="10" r=".9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="10" r=".9" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="10" r=".9" fill="currentColor" stroke="none" />
  </Icone>
);
export const IconeBuscar = (p: Tamanho) => (
  <Icone {...p}>
    <circle cx="8.75" cy="8.75" r="5.25" />
    <path d="m12.5 12.5 4 4" />
  </Icone>
);
export const IconeConta = (p: Tamanho) => (
  <Icone {...p}>
    <circle cx="10" cy="7" r="3.25" />
    <path d="M3.75 16.75c.9-2.9 3.3-4.5 6.25-4.5s5.35 1.6 6.25 4.5" />
  </Icone>
);
export const IconeFechar = () => (
  <Icone>
    <path d="M5 5l10 10M15 5 5 15" />
  </Icone>
);
export const IconeMenu = () => (
  <Icone>
    <path className="menu-abrir" d="M3.5 6h13M3.5 10h13M3.5 14h13" />
    <path className="menu-x" d="M5 5l10 10M15 5 5 15" />
  </Icone>
);
// Os do lançamento da carteira (no lugar do lucide-react das peças da Arc: o Plus, o Minus, o CalendarDays e os Chevron): o "+" do botão
// "Lançar compra" e do campo de número, o "−" dele, o calendário do seletor de data e as setas (a do campo e as do mês).
export const IconeAdicionar = (p: Tamanho) => (
  <Icone {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icone>
);
export const IconeSubtrair = (p: Tamanho) => (
  <Icone {...p}>
    <path d="M4.5 10h11" />
  </Icone>
);
export const IconeCalendario = (p: Tamanho) => (
  <Icone {...p}>
    <rect x="3.5" y="4.5" width="13" height="12" rx="2" />
    <path d="M3.5 8.5h13M7 3v3M13 3v3" />
    <circle cx="7.25" cy="12.25" r=".75" fill="currentColor" stroke="none" />
    <circle cx="10" cy="12.25" r=".75" fill="currentColor" stroke="none" />
    <circle cx="12.75" cy="12.25" r=".75" fill="currentColor" stroke="none" />
  </Icone>
);
export const IconeSetaBaixo = (p: Tamanho) => (
  <Icone {...p}>
    <path d="m6 8 4 4 4-4" />
  </Icone>
);
export const IconeSetaEsquerda = (p: Tamanho) => (
  <Icone {...p}>
    <path d="m12 6-4 4 4 4" />
  </Icone>
);
export const IconeSetaDireita = (p: Tamanho) => (
  <Icone {...p}>
    <path d="m8 6 4 4-4 4" />
  </Icone>
);
// o "i" num círculo: o botão que abre a explicação de um termo (a faixa do Monte Carlo, `.info` no globals.css)
export const IconeInfo = (p: Tamanho) => (
  <Icone {...p}>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M10 9.25v4.5" />
    <circle cx="10" cy="6.5" r=".9" fill="currentColor" stroke="none" />
  </Icone>
);

// Os da landing (ADR 0041): os dos selos de seção, os dos ícones dentro do texto e os das cenas do método. O mesmo traço de 1,5.
export const IconeBriefing = (p: Tamanho) => (
  <Icone {...p}>
    <rect x="3" y="4" width="14" height="12" rx="1.5" />
    <path d="M6 7.5h8M6 10.5h8M6 13.5h5" />
  </Icone>
);
export const IconeCadeado = (p: Tamanho) => (
  <Icone {...p}>
    <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </Icone>
);
export const IconeGrafico = (p: Tamanho) => (
  <Icone {...p}>
    <path d="M3 16h14M4.5 13l3.5-4 3 2.5L16 5" />
  </Icone>
);
export const IconeMoeda = (p: Tamanho) => (
  <Icone {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M12.2 7.6c-.4-.7-1.2-1.1-2.2-1.1-1.3 0-2.2.7-2.2 1.7 0 2.3 4.6 1.2 4.6 3.6 0 1-.9 1.8-2.4 1.8-1.1 0-2-.5-2.4-1.3M10 5v1.5M10 13.5V15" />
  </Icone>
);
export const IconeCheck = (p: Tamanho) => (
  <Icone {...p}>
    <path d="m5 10.5 3.2 3L15 7" />
  </Icone>
);
export const IconeMetodo = (p: Tamanho) => (
  <Icone {...p}>
    <path d="M10 3 17 6.5 10 10 3 6.5zM3 10l7 3.5 7-3.5M3 13.5 10 17l7-3.5" />
  </Icone>
);
export const IconeElenco = (p: Tamanho) => (
  <Icone {...p}>
    <circle cx="7" cy="7.5" r="2.5" />
    <circle cx="13.5" cy="8" r="2" />
    <path d="M2.75 16c.6-2.4 2.2-3.75 4.25-3.75S10.65 13.6 11.25 16M11.5 12.6c.6-.25 1.3-.35 2-.35 1.8 0 3.1 1.2 3.75 3.75" />
  </Icone>
);
export const IconePergunta = (p: Tamanho) => (
  <Icone {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M8 8a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.6M10 13.6v.1" />
  </Icone>
);

// A marca: o touro do Artur (o Group.svg de 06/11/2026), na primária (o azul do logo, #14144C, no claro; o tom claro dele no escuro). O
// desenho é o arquivo public/marca.svg, usado como máscara pelo CSS (.marca, no globals.css): trocar o logo é trocar esse arquivo (e o
// app/icon.svg, o ícone do navegador). Decorativa: o nome "Alvesting" vem sempre ao lado, em texto, na Exo 2 da marca (`font-marca`; a
// WCAG 1.4.3 deixa o logotipo fora da conta de contraste).
export const Marca = ({ size = 18 }: { size?: number }) => (
  <span className="marca" style={{ width: size, height: size }} aria-hidden="true" />
);
