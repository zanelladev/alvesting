-- O GIN de news_item.tickers sem a lista pendente (docs/API.md, seção 4). Migration só aditiva: muda um parâmetro de armazenamento
-- do índice criado em 20261102000000_public_api_indexes, nenhum dado é tocado e o índice não é reconstruído.
--
-- Com fastupdate ligado (o padrão do GIN) as linhas novas esperam numa lista pendente, e TODA consulta que usa o índice paga a leitura
-- dessa lista. Medido em 250 mil notícias sintéticas: o ticker raro ou ausente levou 3,6 a 4,5 ms lendo 344 páginas com a lista cheia, e
-- 0,013 ms depois de esvaziá-la (gin_clean_pending_list). Em produção a lista só esvazia pelo autovacuum ou ao passar de 4 MB, e a
-- escrita é de uns 700 itens por dia: o custo de escrever direto no índice é nenhum, e a consulta passa a ter tempo estável.
--
-- Desligar não esvazia o que já está na lista: isso fica para o próximo autovacuum (ou gin_clean_pending_list), e são poucas entradas.
-- O Prisma não modela parâmetros de armazenamento de índice (o schema.prisma descreve o GIN sem eles), e o `migrate diff` segue vazio.

ALTER INDEX "news_item_tickers_idx" SET (fastupdate = off);
