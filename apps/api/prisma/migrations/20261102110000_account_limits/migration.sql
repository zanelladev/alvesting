-- A conta, endurecimento depois da revisão (etapa 11, fechamento; docs/CONTA.md). Migration só aditiva: acrescenta guardas e troca um índice;
-- nenhum dado é apagado nem reescrito, e as tabelas da conta ainda estão vazias em todo ambiente. O código já impede tudo o que estas
-- guardas impedem (hooks do Better Auth, ConsentService); o banco é a última barreira, para o dia em que um caminho novo esquecer.

-- Teto dos campos que um cadastro anônimo escreve. Antes, um nome de 5 milhões de caracteres era gravado sem erro. O teto do nome (200) é
-- o dobro do que a API aceita no cadastro (100): sobra para um nome vindo do Google. 254 é o maior endereço de e-mail (RFC 5321). A
-- imagem é sempre nula (não temos foto); o teto é só a rede de segurança.
ALTER TABLE "user" ADD CONSTRAINT "user_name_len" CHECK (char_length("name") <= 200);
ALTER TABLE "user" ADD CONSTRAINT "user_email_len" CHECK (char_length("email") <= 254);
ALTER TABLE "user" ADD CONSTRAINT "user_image_len" CHECK ("image" IS NULL OR char_length("image") <= 2048);

-- O índice de verification.value passa de btree a hash (o SQL abaixo é a saída de `prisma migrate diff`). O Better Auth guarda no
-- value o estado do fluxo do Google, texto do cliente (callbackURL, errorURL e dado extra), e o btree recusa linha acima de 2704
-- bytes: um corpo anônimo comprido virava 500. A consulta que o índice atende é só a igualdade (value = ULID, na exclusão da conta).
-- DropIndex
DROP INDEX "verification_value_idx";

-- CreateIndex
CREATE INDEX "verification_value_idx" ON "verification" USING HASH ("value");

-- O histórico de aceite também não se apaga à mão: o gatilho de UPDATE (migration da conta) já o protege, e este fecha o DELETE. A linha
-- só some junto com a conta: a exclusão em cascata roda como gatilho do Postgres (pg_trigger_depth() > 1) e passa; o DELETE direto
-- (pg_trigger_depth() = 1) é recusado.
CREATE FUNCTION "consent_reject_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'consent é um histórico de aceite: a linha só some junto com a conta (excluir o usuário leva o aceite em cascata)';
END;
$$;

CREATE TRIGGER "consent_no_delete" BEFORE DELETE ON "consent" FOR EACH ROW EXECUTE FUNCTION "consent_reject_delete"();
