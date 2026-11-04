-- Guarda da liquidação (etapa 7): o BUY que vale está entre 5% e 25% do patrimônio. O decision_item_check só exige de 1 a 100 para
-- qualquer ação, e a faixa do BUY só era barrada pelo Zod e pelo validador. A liquidação relê a faixa e lança RangeError, o que
-- interromperia a liquidação da temporada inteira a cada entrega; com a restrição o erro aparece na gravação da decisão, onde só
-- aquele modelo vira HOLD. O item descartado guarda o que o modelo pediu, mesmo fora da faixa (é o motivo do descarte). Os 5 e 25
-- são BUY_PERCENT_OF_EQUITY (packages/contracts/src/llm-decision.ts): se a faixa mudar lá, uma migration nova muda aqui.
-- Migration só aditiva: não apaga nem reescreve dado, e as tabelas da arena estão vazias em todos os ambientes até a Temporada 0.
ALTER TABLE "decision_item" ADD CONSTRAINT "decision_item_buy_range_check" CHECK (
    "dropped" OR "action" IS DISTINCT FROM 'BUY' OR ("percent" >= 5 AND "percent" <= 25)
);
