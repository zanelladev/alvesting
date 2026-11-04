// Monta um ZIP de várias entradas (deflate) à mão, para testar a leitura dos arquivos da CVM sem baixar nada. O ZIP do
// FCA traz dez CSV, e o leitor tem de achar o certo entre eles. A fixture de uma entrada só (zipOf, de infrastructure/zip)
// não serve para isso.
// Só os testes importam este arquivo (fica fora do build, ver tsconfig.build.json).
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  content: Buffer;
}

export function zipOfEntries(entries: ZipEntry[]): Buffer {
  const body: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const fileName = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(content);
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(fileName.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42); // deslocamento do cabeçalho local

    body.push(local, fileName, compressed);
    directory.push(central, fileName);
    offset += local.length + fileName.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, centralDirectory, end]);
}
