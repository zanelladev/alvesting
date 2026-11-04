# ADR 0001: Emulador do Service Bus num profile do compose, com teste de integração condicional

- **Status:** aceita
- **Data:** 31/10/2026
- **Etapa:** 1, fundação do monorepo

## Contexto

O plano (5.5) manda usar o emulador oficial do Service Bus no dev e no CI, e pede um teste de integração da fiação
com as 6 filas (publicar, consumir, tentar de novo até a DLQ, reenviar da DLQ; a política de nova tentativa mudou no ADR 0015).

O emulador oficial precisa de um SQL Server ao lado (a Microsoft pede pelo menos 2 GB de RAM livres). A VM do Docker
Desktop do Artur tem 2 CPUs e 1,8 GB de RAM no total, e não vamos mexer nessa configuração. Subir o emulador ali junto do
Postgres e do Azurite derrubaria o ambiente. O CI do GitHub tem memória de sobra.

## Decisão

1. **Profile `servicebus` no `docker-compose.yml`.** O `sqlserver` e o `servicebus-emulator` só sobem com
   `ACCEPT_EULA=Y docker compose --profile servicebus up -d`. O `docker compose up -d` comum sobe só o Postgres 17 e o
   Azurite, que cabem na VM.
2. **Config.json com as 6 filas** em `docker/servicebus/Config.json` (`market`, `news`, `briefing`, `decisions`,
   `settlement`, `maintenance`), com as entregas máximas da tabela 5.5 do plano (10, 5, 5, 3, 5, 3) e DLQ na expiração.
   Imita o tier **Basic**: sem sessão e sem detecção de duplicata. Um teste unitário
   (`queues-config.spec.ts`) compara o arquivo com a tabela `QUEUES` de `packages/contracts`, para as duas não
   divergirem.
3. **Handlers de fila são funções comuns.** `handleDelivery(queue, body, handler)` valida a mensagem e decide
   concluir, pedir nova tentativa (ADR 0015) ou mandar para a DLQ sem conhecer o Service Bus. O `MessagingService` só liga isso ao SDK.
   Por isso o domínio das etapas 4 a 7 é testável sem fila nenhuma. A lógica do `MessagingService` (publicar com
   `MessageId` determinístico, agendar, consumir, ler e reenviar a DLQ) tem testes unitários com um Service Bus falso.
4. **Teste de integração condicional.** `messaging.integration.spec.ts` roda contra o emulador quando
   `SERVICEBUS_EMULATOR=1` (é o que o CI define). Sem isso, o Vitest o mostra como **pulado, com o motivo no nome do
   teste** (`[pulado: defina SERVICEBUS_EMULATOR=1 ...]`), em vez de passar em silêncio ou falhar.
5. **No CI**, o `ci.yml` sobe só `sqlserver` e `servicebus-emulator` do profile (o Postgres é um `service` do job) e
   espera o `/health` do emulador antes de rodar `pnpm check`.

As portas de host são altas e só em `127.0.0.1`: Postgres 25432, Azurite (Blob) 25100, Service Bus AMQP 25672 e
saúde do emulador 25300.

## Consequências

- Na máquina do Artur o teste de integração do Service Bus **não roda** (aparece como pulado). A primeira execução
  real é no CI. Quem tiver Docker com 2 GB ou mais pode rodar localmente com o profile.
- No Apple Silicon a imagem do SQL Server 2022 só existe para amd64 e roda emulada (mais lenta, e às vezes instável).
  O emulador e o Azurite têm build arm64.
- O emulador tem limites que o serviço real não tem: TTL de mensagem de 1 h, sem entidades particionadas e só AMQP
  sobre TCP. O Config.json usa `PT1H` e o teste de reagendamento espera segundos, não horas.
- O tier Basic não detecta duplicata. O `MessageId` determinístico (`eod:2026-10-30`) identifica a mensagem e a reenvia
  igual da DLQ, mas quem impede o processamento em dobro é a chave única `(type, idempotency_key)` de `job_run`.
- Aceitar o EULA do SQL Server e do emulador (`ACCEPT_EULA=Y`) é uma decisão explícita: local, de quem roda o compose;
  no CI, está declarada no `ci.yml`.

## Alternativas consideradas

- **Aumentar a memória da VM do Docker:** fora do que podemos mexer na máquina do Artur.
- **Azure SQL Edge no lugar do SQL Server:** é menor e tem arm64, mas a Microsoft o descontinuou e a documentação atual
  do emulador usa o SQL Server.
- **Namespace real do Service Bus para testes:** custa dinheiro, exige segredo no CI e depende de rede. O emulador
  cobre o que o teste precisa.
- **Só um Service Bus falso em memória:** não valida o SDK, o `peekLock`, a DLQ por entregas máximas nem o agendamento.
  Ele continua nos testes unitários, mas não substitui a integração.
