# Arte com brasa

A arte é arquivo, e o código só troca o quadro (ADR 0034). Nada de canvas, shader nem `motion`.

## Pôr uma arte numa tela

```tsx
<Arte nome="escadaria" className="-z-10 lg:bottom-22" />
```

- `components/arte.tsx` (servidor) manda o **quadro 0 inteiro no HTML**, e a brasa é o sprite do quadro 0 (`<nome>-q0.png`, uns 4 KB), que o CSS pede, sem `preload` (o pedido de alta prioridade entrava no LCP da home: `docs/TELAS.md`, seção 5). O texto vem de `src/arte/<nome>-q0.json`, importado (entra no build; nada de ler `public/` do disco, que no standalone muda de lugar). Uma arte nova entra no `ARTES` do componente.
- O tamanho é CSS (`.arte` em `globals.css`): `font-size: max(100cqw / colunas, 100cqh / linhas)`, o `cover` sem `ResizeObserver`. A
  célula tem 1 em em qualquer mono (`letter-spacing: calc(1em - 1ch)`, o glifo no meio dela). `--linhas` faz só as linhas de baixo
  encherem a altura; `--deslocar` anda a grade para o lado.
- O host é absoluto, com `overflow: hidden` e a máscara que dissolve as bordas (10% nas laterais, 14% em cima e embaixo).
- `components/arte-viva.tsx` (cliente, o único JavaScript da arte) toca o laço **só a partir de 1024 px**, sem `prefers-reduced-motion` e
  sem Save-Data, depois do `load`: busca `<nome>.json` e `<nome>.png`, troca o texto do `<pre>` e a posição do sprite a 12 quadros por
  segundo, e para fora da tela e com a aba oculta. No celular, nenhum pedido.
- Peça larga que não cabe ao lado do texto vai num bloco **abaixo** dele, nunca atrás.

## Antes: o motivo e a fonte

1. **A linha do motivo**, em termos do produto. Se não convence, não entra arte.
2. **A procedência**: toda arte tem linha em `docs/DEPENDENCIAS.md`, "Artes" (de onde veio, a licença, o que a deriva). Obra protegida (o
   Charging Bull, o Touro de Ouro), modelo 3D sem licença confirmada e quadro de vídeo de terceiro **não entram**. A arte da escadaria
   depende de o Artur conferir os termos vigentes da API do Higgsfield antes de o repositório ser público.
3. **A fonte boa para virar ASCII**: laço que fecha (vídeo com o primeiro quadro igual ao último), sujeito realista sobre fundo escuro, luz
   do alto à esquerda, câmera parada.

## O gerador (fica na v1)

As artes da v2 vêm prontas do commit `cddd320` da v1, geradas por `packages/config/ascii-arte.py` de lá (ffmpeg, numpy e PIL). O gerador
**não veio** para a v2: arte nova traz o gerador junto, e as ferramentas entram em `docs/DEPENDENCIAS.md`. Os `-q0` saem dos arquivos
prontos pelos comandos do apêndice do ADR 0034.

Os parâmetros que a v1 usava, para quem for gerar de novo:

| Chave              | O que faz                                                                                        | Ponto de partida               |
| ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------ |
| `filtro`           | ffmpeg `crop`/`pad` antes da grade: recorte na proporção do lugar, com o foco onde ele deve cair | hero: ~1,67:1, foco em y ≈ 0,7 |
| `cols`             | colunas da grade (célula quadrada; as linhas saem da proporção)                                  | 200 para a largura da tela     |
| `preto` / `branco` | níveis: abaixo de `preto` vira vazio (céu limpo)                                                 | 0,06 / 0,82                    |
| `gamma`            | acima de 1 abre a sombra (a figura em contraluz volta a ter corpo)                               | 1,5                            |
| `caixa`            | brilho a partir do qual a célula vira ladrilho                                                   | 0,86                           |
| `halo`             | raio (em células) do brilho borrado que acende `.` e `:` em volta                                | 2,2                            |
| `vazado`           | o glifo vazado no ladrilho                                                                       | `?`                            |
| `nitidez`          | máscara de desfoque na grade: aresta e contorno sobem um nível                                   | 0,9                            |
| `vinheta`          | `{x, y, r0, r1}` em fração da altura: apaga o contexto longe do foco                             | r0 0,35, r1 1,25               |
| `focos`            | `[{x, y, r, pulso, acende}]`: a gaussiana da brasa                                               | r 0,2, acende 0,5              |

## Diagnóstico

Olhe a prévia **em 1:1** (a miniatura engana). Sintoma e ajuste:

| Sintoma                                                           | Ajuste                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| O ponto mais claro da fonte não é o sujeito (fachada, névoa, céu) | `vinheta` centrada no foco, ou recorte fora                                |
| Sujeito pequeno, ilegível                                         | recorte mais justo em volta dele (largura ≈ 4× a do sujeito)               |
| Sujeito vira mancha de ladrilho                                   | baixe `acende`, suba `caixa`                                               |
| A sombra do sujeito some e a silhueta quebra                      | suba `gamma` (abre o escuro), não `acende`                                 |
| Estrutura (degrau, coluna) vira textura uniforme                  | `nitidez` 0,8 a 1,0                                                        |
| Fervura (o glifo trocando a cada quadro)                          | `preto` um pouco maior                                                     |
| O sujeito cai atrás do texto na página                            | no hero, `--deslocar` e `--linhas`; na fonte, o foco mais baixo no recorte |

## Peso

O JSON comprime muito (os quadros se parecem): a escadaria tem 2,9 MB crus e 58 KB em gzip. O sprite é o peso de verdade: PNG de paleta,
`2 × colunas` por `linhas × quadros` pixels (a escadaria, 325 KB). No primeiro paint só vão o quadro 0 no HTML (uns 1,7 KB comprimidos, duas
vezes: o HTML e o payload do React) e o sprite do quadro 0 (3,9 KB).

## Formato

`frames[i]` é o texto do quadro i (linhas separadas por `\n`); célula vazia é espaço; o ladrilho tem o glifo vazado no texto e tinta preta no
sprite. O sprite tem um bloco por quadro, empilhado: a metade esquerda é a tinta de cada célula, a direita o ladrilho. O laço move
`background-position-y` em `-i × linhas em`, e o glifo veste a tinta por `background-clip: text`.
