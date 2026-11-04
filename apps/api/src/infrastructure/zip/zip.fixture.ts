// Monta um ZIP mínimo de uma entrada (deflate), à mão, para testar a leitura (zip-reader.ts e o CSV da CVM) sem arquivo de terceiros.
// Só os testes importam este arquivo (fica fora do build, ver tsconfig.build.json).
// dataDescriptor: tamanhos e CRC fora do cabeçalho local (bit 3), como os ZIPs da CVM.
import { crc32, deflateRawSync } from 'node:zlib';

export function zipOf(
  name: string,
  content: Buffer,
  options: { dataDescriptor?: boolean; stored?: boolean; crcOverride?: number } = {},
): Buffer {
  const method = options.stored ? 0 : 8;
  const compressed = options.stored ? content : deflateRawSync(content);
  const crc = options.crcOverride ?? crc32(content);
  const fileName = Buffer.from(name, 'utf8');
  const flags = (options.dataDescriptor ? 0x0008 : 0) | 0x0800;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(options.dataDescriptor ? 0 : crc, 14);
  local.writeUInt32LE(options.dataDescriptor ? 0 : compressed.length, 18);
  local.writeUInt32LE(options.dataDescriptor ? 0 : content.length, 22);
  local.writeUInt16LE(fileName.length, 26);

  const descriptor = Buffer.alloc(options.dataDescriptor ? 16 : 0);
  if (options.dataDescriptor) {
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(content.length, 12);
  }

  const centralStart = local.length + fileName.length + compressed.length + descriptor.length;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 42); // deslocamento do cabeçalho local

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(centralStart, 16);

  return Buffer.concat([local, fileName, compressed, descriptor, central, fileName, end]);
}
