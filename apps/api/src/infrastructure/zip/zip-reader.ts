import yauzl from 'yauzl';

// Leitura de ZIP em fluxo, sem extrair nada para o disco. Quem usa hoje é o CSV da CVM (news/infrastructure/zip-csv.ts), cujos ZIPs vêm
// da rede. O yauzl lê o diretório central do ZIP e infla só a entrada pedida, com o zlib do Node. (O fflate, que o plano previa, tenta
// achar o fim de cada entrada procurando a assinatura do data descriptor e errou num arquivo de 800 MB: "unexpected EOF" aos 418 MB.)

// O nome aparece no log e em job_run.error.
export class ZipError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ZipError';
  }
}

const wrap = (error: unknown): ZipError =>
  error instanceof ZipError
    ? error
    : new ZipError(`ZIP inválido: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });

export function openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // validateEntrySizes: o yauzl confere o tamanho declarado no diretório com os bytes que de fato saem, então um ZIP que mente
    // para passar pelo teto de tamanho cai na leitura
    const options = { lazyEntries: true, autoClose: false, validateEntrySizes: true };
    yauzl.fromBuffer(buffer, options, (error, zip) => (error ? reject(wrap(error)) : resolve(zip)));
  });
}

// O nome das entradas vem do ZIP, que vem da rede: a mensagem de erro (que vai para o log e para job_run.error) lista poucos
// nomes, curtos e sem caracteres de controle, em vez de despejar as milhares de entradas de um ZIP hostil.
const MAX_LISTED_NAMES = 10;
const MAX_NAME_LENGTH = 80;

export function findEntry(
  zip: yauzl.ZipFile,
  pattern: RegExp,
  label: string,
): Promise<yauzl.Entry> {
  return new Promise((resolve, reject) => {
    const names: string[] = [];
    let others = 0;
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName.split('/').pop() ?? '';
      if (pattern.test(name)) return resolve(entry);
      if (names.length < MAX_LISTED_NAMES) {
        names.push(entry.fileName.slice(0, MAX_NAME_LENGTH).replace(/\p{C}/gu, '?'));
      } else {
        others += 1;
      }
      zip.readEntry();
    });
    zip.once('end', () =>
      reject(
        new ZipError(
          `O ZIP não tem o arquivo ${label} (tem: ${names.join(', ') || 'nada'}${others > 0 ? ` e mais ${others}` : ''})`,
        ),
      ),
    );
    zip.once('error', (error: Error) => reject(wrap(error)));
    zip.readEntry();
  });
}

export function openStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<AsyncIterable<Buffer>> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => (error ? reject(wrap(error)) : resolve(stream)));
  });
}
