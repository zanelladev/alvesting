-- AlterEnum
-- Aditiva (ADR 0032): o pregão confirmado pela brapi, a fonte única das cotações. O valor COTAHIST do enum e a coluna cotahist_sha256 ficam
-- como legado do dev (nada novo os grava); nenhum dado existente muda.
ALTER TYPE "trading_day_source" ADD VALUE 'BRAPI';
