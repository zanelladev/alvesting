import type { ReactNode } from 'react';

// Os ícones da casca (ADR 0035): SVG em linha, desenhados à mão, formas genéricas (colunas, bússola, carteira, balão, três pontos, lupa,
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

// A marca: o ladrilho com o glifo de alta vazado, na primária (o azul do logo, #14144C, no claro; o tom claro dele no escuro). O desenho é o
// arquivo public/marca.svg, usado como máscara pelo CSS (.marca, no globals.css): trocar pelo logo do Artur é trocar esse arquivo (e o
// app/icon.svg, o ícone do navegador). Decorativa: o nome "Alvesting" vem sempre ao lado, em texto (a WCAG 1.4.3 deixa o logotipo fora da
// conta de contraste).
export const Marca = ({ size = 18 }: { size?: number }) => (
  <span className="marca" style={{ width: size, height: size }} aria-hidden="true" />
);
