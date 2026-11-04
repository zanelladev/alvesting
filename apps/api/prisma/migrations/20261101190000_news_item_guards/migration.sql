-- Rede de segurança de news_item (revisões de banco e de segurança da etapa 5). O código já garante tudo isto antes de
-- gravar; a restrição é para o dia em que um caminho novo esquecer. Migration só aditiva: cada restrição é validada contra o
-- que já está na tabela, e a coluna passa a ter valor padrão antes de virar NOT NULL.

-- A lista de tickers nunca é NULL. O Prisma não emite NOT NULL para lista, e um INSERT por SQL que esquecesse a coluna
-- gravaria NULL, que as buscas has/isEmpty do Prisma ignoram (a notícia sumiria da consulta por ticker).
ALTER TABLE "news_item" ALTER COLUMN "tickers" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "news_item" ALTER COLUMN "tickers" SET NOT NULL;

-- A hora que a fonte diz nunca é depois da hora em que o worker viu o item (o schema sempre prometeu isso), e a URL tem o
-- teto que o código aplica (2048 caracteres).
ALTER TABLE "news_item" ADD CONSTRAINT "news_item_time_check" CHECK (
    "published_at" <= "first_seen_at"
    AND char_length("url") <= 2048
);

-- Título e trecho não têm o começo de uma tag: "<" seguido de letra, "/", "!" ou "?" (o que domain/text.ts, cleanText, tira).
-- O "<" solto ("lucro < 5%") é texto e passa. A página pública e os e-mails leem o dado em repouso, não o briefing.
ALTER TABLE "news_item" ADD CONSTRAINT "news_item_text_check" CHECK (
    "title" !~ '<[/A-Za-z!?]'
    AND "snippet" !~ '<[/A-Za-z!?]'
);
