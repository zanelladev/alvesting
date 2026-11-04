import { Readable, pipeline } from 'node:stream';
import { crc32 } from 'node:zlib';
import { parse } from 'csv-parse';
import { findEntry, openStream, openZip } from '../../../infrastructure/zip/zip-reader.js';

// Uma entrada CSV de um ZIP da CVM, lida em fluxo e devolvida linha a linha como objeto (a primeira linha é o cabeçalho).
// O ZIP vem da rede (docs/DADOS.md, seção 14), então:
// - o teto de tamanho inflado vale o declarado no diretório central, e o yauzl confere o declarado com os bytes que
//   de fato saem (um ZIP que mente cai na leitura): uma bomba de ZIP é recusada antes de ser inflada;
// - o CRC32 é conferido no fim: arquivo corrompido falha em vez de entregar linhas como boas;
// - a linha tem teto, para uma aspa que abre e nunca fecha não engolir o arquivo todo como um campo só.
// Os CSV da CVM são latin1, separados por ponto e vírgula, com CRLF; há aspa solta no meio de campo (classe "C").

export interface CsvOptions {
  // como o arquivo aparece na mensagem de erro
  label: string;
  maxInflatedBytes: number;
  // as colunas que o código lê: se o cabeçalho não tem alguma, o arquivo mudou de formato e falha, em vez de devolver
  // linhas em que tudo é "vazio". A mensagem cita só os nomes que o código espera, nunca o conteúdo do arquivo.
  requiredColumns?: readonly string[];
}

// A maior linha do IPE de 2026 tem 5 KB.
const MAX_RECORD_BYTES = 128 * 1024;

export async function* csvRecords(
  zipBytes: Buffer,
  entryPattern: RegExp,
  options: CsvOptions,
): AsyncGenerator<Record<string, string>, void, undefined> {
  const zip = await openZip(zipBytes);
  try {
    const entry = await findEntry(zip, entryPattern, options.label);
    if (entry.uncompressedSize > options.maxInflatedBytes) {
      throw new Error(
        `${options.label}: ${entry.uncompressedSize} bytes inflado passa do teto de ${options.maxInflatedBytes}`,
      );
    }
    const stream = await openStream(zip, entry);
    async function* verified(): AsyncGenerator<Buffer, void, undefined> {
      let crc = 0;
      for await (const chunk of stream) {
        crc = crc32(chunk, crc);
        yield chunk;
      }
      if (crc >>> 0 !== entry.crc32) {
        throw new Error(`${options.label}: o CRC32 não bate com o do ZIP (arquivo corrompido)`);
      }
    }
    const parser = parse({
      delimiter: ';',
      columns: (header: string[]) => {
        const missing = (options.requiredColumns ?? []).filter((name) => !header.includes(name));
        if (missing.length > 0) {
          throw new Error(
            `${options.label}: o cabeçalho não tem as colunas ${missing.join(', ')} (o formato mudou)`,
          );
        }
        return header;
      },
      bom: true,
      encoding: 'latin1',
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      max_record_size: MAX_RECORD_BYTES,
    });
    // pipeline: o erro de qualquer ponta (CRC, ZIP, CSV) destrói a outra e chega no for await abaixo
    const records = pipeline(Readable.from(verified()), parser, () => undefined);
    for await (const record of records) yield record as Record<string, string>;
  } finally {
    zip.close();
  }
}
