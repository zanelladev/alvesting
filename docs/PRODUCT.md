# Product

## Register

product

## Users

- **Principal: o investidor da B3.** Pessoa que investe em ações brasileiras e quer ver, a cada pregão, o que seis modelos de linguagem
  decidem (BUY, HOLD ou SELL), comparar com a própria carteira e pedir uma leitura ao chat (o software não é responsável pelas
  decisões). Olha pelo celular durante o dia e pelo computador quando quer ler com calma. A pergunta de cada tela: quem está ganhando, o
  que cada modelo tem e por que decidiu.
- **Secundário: a banca e o orientador do TCC.** Avaliam o experimento: precisam entender a metodologia (o mesmo prompt para todos,
  oculto e com o hash publicado; as mesmas notícias; o percentil contra mil carteiras sorteadas; o CDI e a carteira igual-peso) e confiar
  nos números.

## Product Purpose

A Alvesting é uma arena pública em que seis LLMs (Claude, GPT, Gemini, Grok, DeepSeek e Qwen) administram carteiras simuladas nas ações
mais líquidas da B3, com as mesmas notícias e o mesmo prompt, decidindo BUY, HOLD ou SELL em todo pregão. Quem visita acompanha o
ranking, lê o raciocínio de cada modelo, lança a própria carteira e conversa com um chat que conhece o contexto. É o TCC do Artur.

Sucesso: o investidor entende em segundos quem está à frente e por quê; a banca confia na metodologia; nada parece recomendação de
investimento nem aposta.

## Brand Personality

**Precisa, calma, premium.** Voz em português simples e direto, sem jargão; números exatos; afirmações modestas ("simulado", "não é
recomendação"). A emoção buscada é confiança e clareza, nunca euforia.

Referências: o Rallies AI (limpo: muito respiro, o dado em primeiro plano, fios finos, movimento discreto) e, para o dado animado com cara
premium, as bibliotecas que o Artur escolheu: o bloco market-terminal da uiarc.dev e os gráficos da beui.dev e da reui.io.

## Anti-references

- **Cassino de cripto:** neon, gradiente, contagem regressiva, cara de aposta.
- **Corretora tradicional:** home broker carregado, cheio de caixas, menus e banners.
- **Painel SaaS genérico:** cards iguais com ícone, números gigantes soltos, gradiente roxo.
- **Terminal hacker:** tudo preto, fonte mono em tudo, verde de matriz.

## Design Principles

1. **O dado é o protagonista.** Cada tela responde a uma pergunta antes de qualquer enfeite: quem está ganhando, o que cada modelo tem,
   por que decidiu.
2. **Calma que passa confiança.** Respiro, fios finos e cor contida; o movimento explica a mudança (o valor que conta, a linha que se
   desenha), nunca decora.
3. **Honestidade à vista.** "Simulado", as fontes (brapi, CVM), os hashes e a metodologia ficam sempre a um toque; nenhum número sem
   contexto.
4. **Premium nos detalhes.** Alinhamento exato, algarismos tabulares, transições suaves e estados completos (carregando, vazio, erro).
5. **Celular primeiro.** O investidor olha no telefone: tudo funciona em 360 px, com alvos de 44 px.

## Accessibility & Inclusion

- WCAG 2.2 AA: contraste de 4,5:1 no texto e 3:1 no texto grande e nos elementos de interface; axe sem violação em toda tela (é gate do
  e2e).
- Movimento reduzido obrigatório: com `prefers-reduced-motion`, troca instantânea ou esmaecimento curto, nunca deslocamento.
- A cor nunca é o único sinal: alta, queda e estável levam ▲ ▼ ■, além do verde e do vermelho.
- Alvos de toque de 44 px; nenhuma rolagem horizontal de 360 a 1920 px.
- O e2e roda no Pixel 7, no iPhone 15 (WebKit) e no desktop, nos temas claro e escuro.
