import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ZipError, findEntry, openStream, openZip } from './zip-reader.js';
import { zipOf } from './zip.fixture.js';

const NAME = 'dados.csv';
const TEXT = Buffer.from('a;b\r\n1;2\r\n', 'latin1');

async function read(zip: Buffer, pattern = /\.csv$/i): Promise<Buffer> {
  const file = await openZip(zip);
  try {
    const entry = await findEntry(file, pattern, '*.csv');
    const chunks: Buffer[] = [];
    for await (const chunk of await openStream(file, entry)) chunks.push(chunk);
    return Buffer.concat(chunks);
  } finally {
    file.close();
  }
}

describe('zip-reader: ZIP lido em fluxo', () => {
  it('lê a entrada que casa com o padrão', async () => {
    expect((await read(zipOf(NAME, TEXT))).equals(TEXT)).toBe(true);
  });

  it('lê o ZIP com tamanhos e CRC depois dos dados (data descriptor) e a entrada sem compressão', async () => {
    expect((await read(zipOf(NAME, TEXT, { dataDescriptor: true }))).equals(TEXT)).toBe(true);
    expect((await read(zipOf(NAME, TEXT, { stored: true }))).equals(TEXT)).toBe(true);
  });

  it('o CRC32 que o diretório declara é o do conteúdo (quem lê confere no fim do fluxo)', async () => {
    const file = await openZip(zipOf(NAME, TEXT));
    const entry = await findEntry(file, /\.csv$/i, '*.csv');
    file.close();
    expect(entry.crc32).toBe(crc32(TEXT));
    expect(entry.uncompressedSize).toBe(TEXT.length);
  });

  it('ZIP sem a entrada pedida: a mensagem lista poucos nomes, curtos e sem caractere de controle', async () => {
    const zip = zipOf(`${'x'.repeat(200)}\u0007.txt`, Buffer.from('oi'));
    const error = await read(zip).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(ZipError);
    expect((error as Error).message).toMatch(/não tem o arquivo \*\.csv/);
    expect((error as Error).message.length).toBeLessThan(200);
    expect((error as Error).message).not.toContain('\u0007');
  });

  it('recusa o que não é ZIP, como uma página HTML devolvida com status 200', async () => {
    await expect(openZip(Buffer.from('<!DOCTYPE html><html></html>'))).rejects.toThrow(ZipError);
  });

  it('recusa ZIP cortado no meio', async () => {
    const zip = zipOf(NAME, TEXT);
    await expect(openZip(zip.subarray(0, zip.length - 40))).rejects.toThrow(ZipError);
  });

  // O yauzl (validateEntrySizes) confere o tamanho declarado com os bytes que de fato saem: um ZIP que declara menos para passar
  // pelo teto de tamanho inflado cai na leitura do fluxo, com o erro do próprio yauzl (quem consome o fluxo, zip-csv.ts, o deixa subir).
  it('um ZIP que declara o tamanho menor que o real não escapa: a leitura falha', async () => {
    const zip = zipOf(NAME, Buffer.alloc(4_000, 'A'));
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(10, central + 24); // tamanho descompactado no diretório central
    await expect(read(zip)).rejects.toThrow(/too many bytes/);
  });
});
