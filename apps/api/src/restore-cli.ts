import { parseEnv } from './config/env.js';
import { createBlobServiceClient } from './infrastructure/storage/blob-client.js';
import {
  RESTORE_CONTAINER,
  TEMPORADA_BLOB_CONTAINERS,
  countTables,
  exportBlobs,
  restoreSeason,
} from './modules/maintenance/application/season-restore.js';

// Linha de comando da restauração da temporada na Azure (ADR 0039; docs/RUNBOOK.md, 13.6). Na Azure roda numa execução do job-migrate com o
// comando trocado (docs/INFRA.md, 8.6), o único lugar que alcança o Postgres privado: lê o DATABASE_URL (o administrador) e o Blob pela
// identidade do migrate (STORAGE_BLOB_ENDPOINT e AZURE_CLIENT_ID, só no perfil econômico) ou, no Azurite, pela STORAGE_CONNECTION_STRING.
// O `contagens` imprime as mesmas linhas para qualquer banco: na máquina, contra a origem, antes do dump; na Azure, depois da restauração.
const USAGE = `Uso:
  temporada <dump> <sha256>   restaura só os dados do dump (container ${RESTORE_CONTAINER} do Blob) no banco do DATABASE_URL, que tem de
                              estar migrado e sem temporada; confere o SHA-256 antes e as contagens depois
  contagens                   as linhas de cada tabela do banco do DATABASE_URL, uma por linha (<tabela> <linhas>)
  exportar-blob <pasta>       os arquivos da temporada local no Azurite (STORAGE_CONNECTION_STRING) para <pasta>/briefings e
                              <pasta>/llm-io, com os mesmos nomes (o envio à Azure é o az storage blob upload-batch do RUNBOOK)`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'contagens' && rest.length === 0) {
    const env = parseEnv();
    for (const [table, rows] of Object.entries(await countTables(env.DATABASE_URL))) {
      console.log(`${table} ${rows}`);
    }
    return 0;
  }
  if (command === 'exportar-blob' && rest.length === 1) {
    const counts = await exportBlobs(
      createBlobServiceClient(parseEnv()),
      rest[0]!,
      TEMPORADA_BLOB_CONTAINERS,
    );
    for (const [to, files] of Object.entries(counts)) console.log(`${to} ${files} arquivos`);
    return 0;
  }
  if (command === 'temporada' && rest.length === 2) {
    const env = parseEnv();
    const result = await restoreSeason({
      databaseUrl: env.DATABASE_URL,
      blob: createBlobServiceClient(env),
      blobName: rest[0]!,
      sha256: rest[1]!,
      log: (line) => console.log(line),
    });
    console.log(
      `restauração conferida: ${result.blob}, ${Object.keys(result.tables).length} tabelas com as linhas do dump`,
    );
    return 0;
  }
  console.error(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    // a mensagem dos passos não leva a URL do banco nem linha nenhuma dele (season-restore.ts)
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
