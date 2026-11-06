-- Os logos das ações (ADR 0036; docs/DADOS.md, seção 3a): a cópia própria do SVG que a brapi serve em icons.brapi.dev, um por papel, para o
-- site o servir do próprio domínio. Migration só aditiva: uma tabela nova, nenhuma tabela, linha ou privilégio existente muda. O SQL da tabela
-- é a saída de `prisma migrate diff`; o CHECK e o GRANT do papel da api são o que o Prisma não emite.

-- CreateTable
CREATE TABLE "instrument_logo" (
    "instrument_id" VARCHAR(26) NOT NULL,
    "source_url" TEXT NOT NULL,
    "svg" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instrument_logo_pkey" PRIMARY KEY ("instrument_id")
);

-- AddForeignKey
ALTER TABLE "instrument_logo" ADD CONSTRAINT "instrument_logo_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- A rede de segurança do que o job grava (o validador, svg-check.ts, já recusa tudo isto): de 1 byte ao teto de 200 KB (LOGO_MAX_BYTES), o
-- tamanho é o do próprio SVG em UTF-8 (o texto guardado é o que foi baixado, byte a byte) e o SHA-256 é hexadecimal minúsculo.
ALTER TABLE "instrument_logo" ADD CONSTRAINT "instrument_logo_values_check"
  CHECK ("bytes" BETWEEN 1 AND 204800 AND octet_length("svg") = "bytes" AND "sha256" ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- O papel mínimo da api (ADR 0028), sem ALTER DEFAULT PRIVILEGES: só SELECT, para a rota interna dos logos (GET /api/v1/interno/logos/:ticker).
-- Quem grava é a atualização semanal e o market:logos, com o login administrador. A matriz é table-policy.ts; o api-role.integration.spec.ts
-- compara o catálogo com ela. O GRANT é repetível: concedido de novo, não muda nada.
GRANT SELECT ON "instrument_logo" TO "alvesting_api_group";
