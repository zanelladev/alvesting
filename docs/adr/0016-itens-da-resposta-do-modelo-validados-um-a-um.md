# ADR 0016: Itens da resposta do modelo validados um a um

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** revisão do fechamento da etapa 1; `docs/PLANO.md`, §2 ("JSON estrito; item inválido descartado; JSON inválido ganha 1 reparo") e `docs/METODOLOGIA.md`

## Contexto

O contrato da primeira versão (`llmDecisionSchema`) validava a lista `decisions` inteira: um item fora do limite (por exemplo `percent_of_equity: 30`) ou a 6ª ordem derrubava a resposta toda como `invalid_schema`, que cai no reparo único e, se falhar, em HOLD do modelo inteiro. O plano e a metodologia dizem outra coisa: item inválido é descartado. A diferença é metodológica, não de implementação: um modelo que acerta 4 ordens e erra uma viraria HOLD no pregão.

## Decisão

`parseLlmDecision` (em `packages/contracts`) lê a resposta em dois níveis:

1. **Envelope estrito.** Texto que não é JSON, chave desconhecida no topo, `summary` ou `market_view` fora do formato e `decisions` que não é lista falham como antes (`invalid_json` ou `invalid_schema`), e a etapa 6 faz o reparo único.
2. **Itens um a um.** Cada item de `decisions` passa sozinho no `decisionItemSchema`. O que não passa é descartado e devolvido em `dropped` com o índice e as issues (caminho e regra, nunca o valor). Os outros valem.
3. **Limite de 5 ordens.** Ordens BUY e SELL além da quinta, na ordem em que o modelo as listou, também são descartadas, com o motivo `over_order_limit`. HOLD não conta. Ordem inválida não gasta o limite. A regra é a mesma para todos os modelos.

O `llmDecisionSchema` estrito continua exportado, porque é o JSON Schema pedido aos provedores com saída estruturada e descreve a resposta totalmente válida. Ticker no universo, ticker repetido, venda sem posição e o teto de 10 posições dependem do domínio e ficam com o validador da etapa 6.

## Consequências

- Um erro pontual não zera o pregão do modelo, em linha com o plano.
- A ordem em que o modelo lista as ordens passa a importar quando ele passa de 5. É uma limitação a declarar (METODOLOGIA, linha "Validação"): o corte é por posição, não por qualidade.
- A etapa 6 grava `dropped` junto do IO bruto, para o descarte ser auditável.

## Complemento do fechamento da etapa 6 (01/11/2026)

A revisão de segurança e a de TypeScript da etapa 6 acrescentaram duas regras, sem mudar as três acima:

4. **Teto de itens.** `decisions` tem no máximo 50 itens (`MAX_DECISION_ITEMS`), no envelope e no schema estrito. O HOLD não conta como ordem
   e não passa por universo nem carteira, então sem teto seria um canal largo de texto livre (cada item leva um `rationale` público de até 280
   caracteres). Acima do teto a resposta inteira falha (reparo único, depois HOLD `resposta_invalida`): é a única regra desta lista que não
   descarta item a item, porque cortar em silêncio os itens além do 50º premiaria quem enche a lista.
5. **As posições são conferidas de novo depois do corte das ordens.** A vaga que a venda de 100% libera só vale se o corte das 5 ordens não
   derrubou essa venda (o SELL listado depois da quinta ordem). A compra que dependia dela cai com `max_positions`, e a decisão passa a mostrar o
   que a liquidação faria. A compra derrubada aqui já gastou uma das cinco ordens, e a ordem cortada antes não volta.

## Alternativas consideradas

- **Manter o estrito e ajustar o plano.** Reabriria uma decisão aprovada do plano e puniria o modelo inteiro por um item.
- **Tratar a 6ª ordem como resposta inválida e pedir reparo.** Gasta uma segunda chamada paga por um excesso que o corte determinístico resolve, e o reparo mudaria a resposta que o modelo deu no horário.
- **Cortar as ordens excedentes por maior `confidence` ou menor percentual.** Mais "justo" na aparência, mas inventa um critério que o modelo não conhece e que `confidence` (opcional e informativa) não sustenta.
