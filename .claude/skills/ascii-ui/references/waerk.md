# WAERK: a ficha da referência

Post de Basit A. Khan (@basit_designs, X, 20/11/2025): "This one wild design experiment turned into 5 new projects, all from playing with
dither + ASCII UI art." Vídeo de 8,5 s, 2386 × 2160, a landing "WAERK." numa moldura de mockup sobre cinza claro. Medido nos quadros
(ffmpeg e numpy), não de olho. Só o texto da ficha vem para a v2: os quadros do vídeo são de terceiro e não entram no repositório.

## Casca

| Peça      | Medida                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Página    | preto puro `rgb(0,0,0)`                                                                                                                                |
| Nav       | pílula flutuante `rgb(23,23,23)`, raio cheio, afastada das bordas; a marca à esquerda, os links no meio, à direita o idioma, o login e a pílula branca |
| Título    | neo-grotesca (Inter ou Geist), branca, peso ~500, tracking negativo, duas linhas, ~44 a 48 px numa página de 1440                                      |
| Subtítulo | ~14 px, branco a ~80%, duas linhas                                                                                                                     |
| CTA       | pílula branca, texto preto, ~40 px de altura                                                                                                           |
| Prova     | uma legenda mínima e uma fileira em marquee, com máscara de dissolver nas duas pontas                                                                  |

## A arte

- **Grade quadrada**: a autocorrelação dá período de **14 px nos dois eixos** a 2386 px de largura, ≈ 9,3 px CSS numa página de 1440 (~155
  colunas). Glifo de monoespaçada com espaçamento: a célula é 1:1, não 0,6:1.
- **Rampa** pelo brilho: `.` `:` `+` `*` `#` `%` `@`, e no topo a **célula invertida**: o quadrado aceso com o glifo `?` vazado em preto.
- **Cinza** em tudo que não é foco: do `#333` apagado ao quase branco.
- **Brasa** só no ponto de foco: vinho, vermelho, laranja, âmbar e amarelo claro, na mesma rampa de glifos. Em volta, `.` e `:` em vinho
  escuro fazem o brilho espalhar.
- **Halo**: uma grade fantasma de `.` muito escura em volta da figura, que some antes da borda.
- **Composição**: diagonal do canto inferior esquerdo ao superior direito; o foco logo abaixo do CTA; a arte sangra pelas bordas laterais e
  para antes da fileira do pé.
- **Movimento**: lento, e a brasa acende no foco.

## O que atravessa e o que não

| Atravessa                                                       | Não atravessa                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| preto puro, nav em pílula, pílula branca, título no vazio       | o motivo da referência: aqui a imagem tem de ser a ideia do produto |
| grade quadrada, rampa, célula invertida, halo, brasa só no foco | o `?` como significado: na Alvesting é só o glifo vazado            |
| fileira de prova em marquee                                     | logos de marca: aqui é a fita de cotações, dado real                |

## Como a Alvesting leu

O touro sobe a escadaria (um degrau por pregão; a brasa é o ciclo de agora): a diagonal da escada é a diagonal da referência, o touro aceso
fica logo abaixo e à direita do CTA, os degraus leem como fileiras de ladrilho cinza, e a fachada no canto, que era o ponto mais claro da
fonte, é apagada pela vinheta para não roubar o foco. Na v2 o título fica à esquerda (o `minimal` do Arc), e a arte anda para a direita o
bastante para nunca passar atrás do texto.
