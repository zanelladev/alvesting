# ADR 0015: Nova tentativa agendada, não abandono imediato

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** revisão do fechamento da etapa 1; `docs/PLANO.md`, §5.5 e §5.15 ("Provedor de LLM fora: redelivery da fila + prazo 09:30")

## Contexto

O Service Bus não espera entre entregas. `abandonMessage` devolve a mensagem à fila na hora e conta uma entrega; a única espera embutida é o vencimento da trava (`LockDuration`, 1 min). Com o abandono imediato, um provedor de LLM fora do ar gasta as 3 entregas da fila `decisions` (5 da `news`, 10 da `market`) em segundos. O modelo vira HOLD por uma falha passageira e o alerta de DLQ dispara. Isso anula a mitigação do plano (§5.15), que conta com a janela de 90 minutos entre a decisão (08:00) e o prazo (09:30).

Segundo ponto do mesmo fluxo: o SDK renova a trava de uma mensagem só por 5 minutos (`maxAutoLockRenewalDurationInMs`, padrão do `@azure/service-bus` 7.10.0). O job de decisões leva até 25 minutos (plano, §5.3). Passados 5 minutos a trava expira: outra réplica recebe a mesma mensagem (segunda chamada de LLM paga), o `completeMessage` da primeira falha e as entregas queimam até a DLQ, mesmo com o modelo tendo respondido.

## Decisão

1. **Trava.** `createReceiver` recebe `maxAutoLockRenewalDurationInMs = QUEUES[fila].lockRenewalMs`: 26 minutos em `decisions` (timeout de 25 do job, mais 1 de folga) e 5 nas demais. O `LockDuration` continua PT1M no `Config.json` e no Bicep.
2. **Nova tentativa agendada.** Quando o handler falha e ainda há tentativa, o `MessagingService` agenda uma cópia da mensagem (mesmo `MessageId`, mesmo corpo já validado) para daqui a `retryDelayMs × n`, com a propriedade de aplicação `attempt = n + 1`, e só então conclui a original. `n` é a tentativa atual (propriedade ausente = 1).
3. **Última tentativa.** Com `n >= maxDeliveryCount` da fila, a mensagem vai para a DLQ com o motivo `max_attempts_exceeded`. A descrição da DLQ só diz quantas tentativas houve; o texto do erro vai para o log, porque pode carregar segredo.
4. **Falha ao agendar.** Se o `scheduleMessages` falha, a mensagem é abandonada: volta na hora, conta uma entrega do broker e não se perde.
5. **Esperas** (`QUEUES` em `packages/contracts`): base de 1 minuto nas filas comuns (esperas de 1, 2, 3... minutos) e de 10 minutos em `decisions` (esperas de 10 e 20 minutos: o provedor tem uns 30 minutos para voltar dentro da janela de 90).
6. **Rede de segurança.** O `MaxDeliveryCount` do broker continua configurado, mas passa a contar só processo que cai e trava que expira. O contador de tentativas do handler vive na mensagem, não no banco.

## Consequências

- Falha passageira de provedor não consome as tentativas. No pior caso de `decisions` o handler roda 3 vezes ao longo de uns 30 minutos, antes do prazo das 09:30.
- Agendar antes de concluir é ao-menos-uma-vez: se o processo cair entre os dois passos sobra uma duplicata, que a chave única de `job_run` barra (ADR 0005). O contrário perderia a mensagem.
- A mensagem que o admin reenvia da DLQ volta como tentativa 1 e ganha o ciclo completo de novo.
- `job_run.attempts` não é usado pelo messaging. O embrulho de idempotência das etapas 4 a 7 pode copiar o `attempt` da mensagem para lá, se quiser registrar.
- O Basic não tem detecção de duplicata, então a cópia agendada com o mesmo `MessageId` não é descartada.
- Documentos a ajustar por quem cuida deles: `docs/JOBS.md` (seção 7) diz que a opção de renovação é do `receiver.subscribe` e que, na falha, o job "abandona a mensagem e sai com 1". A opção é do `createReceiver`, e a falha agora agenda a nova tentativa. `docs/INFRA.md` (seção 11) deixa a renovação para as etapas 3 e 6; ela já está no `MessagingService`.
- Testes: unidade com o SDK falso (`messaging.service.spec.ts`) e integração com o emulador (espera mínima entre tentativas, DLQ e renovação de trava), esta última só roda com o emulador no ar (ADR 0001).

## Alternativas consideradas

- **Aceitar o abandono imediato.** É o mais simples, mas deixa a janela de 90 minutos sem uso e transforma falha passageira em DLQ e alerta.
- **Tentar de novo dentro do handler, com espera.** Prende a trava e o lugar do processo por minutos; nas filas serializadas, atrasa as outras mensagens; e o estado se perde se o processo cair. Os retries curtos do cliente HTTP do LLM continuam valendo, mas não substituem isto.
- **Contar em `job_run.attempts`.** Acopla a camada de mensagens ao banco antes de existir o embrulho de idempotência. A propriedade na mensagem não precisa do banco e se testa sem ele.
- **Deixar a trava expirar sem liquidar.** A espera seria sempre de 1 minuto (o `LockDuration`), implícita e igual para todas as filas.
