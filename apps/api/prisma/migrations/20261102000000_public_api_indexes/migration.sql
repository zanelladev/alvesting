-- Índices da API pública (etapa 9; docs/API.md). Migration só aditiva: dois índices, nenhum dado tocado.
--
-- news_item, as consultas de /api/v1/news e de /api/v1/stocks/:ticker:
--   a) "as notícias que citam o ticker": WHERE tickers @> ARRAY[$1]  -> GIN em tickers
--   b) "da mais nova à mais antiga", com a paginação por posição: ORDER BY published_at DESC, id DESC e
--      WHERE (published_at, id) < ($1, $2)                            -> btree em (published_at DESC, id DESC)
-- Medido com EXPLAIN (ANALYZE, BUFFERS) em 250 mil notícias sintéticas: sem os índices toda consulta lia a tabela inteira
-- (7,5 mil páginas, 14 a 37 ms, e isso com varredura paralela); com eles, 0,02 a 0,6 ms. Os do ranking, do feed de decisões e
-- da ação (tabelas de centenas a poucos milhares de linhas por temporada) já usam os índices que existem: nada a acrescentar.
--
-- ponytail: CREATE INDEX comum, dentro da transação da migration, segura a escrita em news_item enquanto constrói. Com a tabela
-- ainda pequena (milissegundos) não importa; com milhões de linhas, criar com CREATE INDEX CONCURRENTLY fora da transação.

-- CreateIndex
CREATE INDEX "news_item_tickers_idx" ON "news_item" USING GIN ("tickers");

-- CreateIndex
CREATE INDEX "news_item_published_at_id_idx" ON "news_item"("published_at" DESC, "id" DESC);
