import { describe, expect, it } from 'vitest';
import { zipOf } from '../../../infrastructure/zip/zip.fixture.js';
import { zipOfEntries } from '../testing/zip.fixture.js';
import { csvRecords, type CsvOptions } from './zip-csv.js';

// O ZIP da CVM vem da rede: o CSV é lido em fluxo, com teto de tamanho inflado e conferência do CRC32, e só devolve as
// linhas se o arquivo inteiro for coerente. Os dados abaixo são sintéticos no formato do IPE e do FCA.
const IPE = /^ipe_cia_aberta_\d{4}\.csv$/;
const OPTIONS = { label: 'ipe_cia_aberta_AAAA.csv', maxInflatedBytes: 10_000_000 };

const latin1 = (text: string): Buffer => Buffer.from(text, 'latin1');

async function collect(
  zip: Buffer,
  entry = IPE,
  options: CsvOptions = OPTIONS,
): Promise<Array<Record<string, string>>> {
  const rows: Array<Record<string, string>> = [];
  for await (const row of csvRecords(zip, entry, options)) rows.push(row);
  return rows;
}

const HEADER = 'CNPJ_Companhia;Nome_Companhia;Categoria;Assunto\r\n';

describe('csvRecords', () => {
  it('lê o CSV separado por ponto e vírgula, em latin1, com o cabeçalho como chaves', async () => {
    const csv = latin1(
      `${HEADER}33.000.167/0001-01;PETRÓLEO BRASILEIRO S.A. - PETROBRAS;Fato Relevante;Produção e vendas 3T26\r\n` +
        `60.872.504/0001-23;ITAÚ UNIBANCO HOLDING S.A.;Comunicado ao Mercado;Panorama Itaúsa\r\n`,
    );
    expect(await collect(zipOf('ipe_cia_aberta_2026.csv', csv))).toEqual([
      {
        CNPJ_Companhia: '33.000.167/0001-01',
        Nome_Companhia: 'PETRÓLEO BRASILEIRO S.A. - PETROBRAS',
        Categoria: 'Fato Relevante',
        Assunto: 'Produção e vendas 3T26',
      },
      {
        CNPJ_Companhia: '60.872.504/0001-23',
        Nome_Companhia: 'ITAÚ UNIBANCO HOLDING S.A.',
        Categoria: 'Comunicado ao Mercado',
        Assunto: 'Panorama Itaúsa',
      },
    ]);
  });

  it('campo entre aspas com ponto e vírgula e aspas duplicadas; aspa solta no meio do campo', async () => {
    const csv = latin1(
      `${HEADER}1;A;Fato Relevante;"Resgate; conversão de ações classe ""C"" - PNCs"\r\n` +
        `2;B;Fato Relevante;Resgate de ações classe "C" - PNCs\r\n`,
    );
    const rows = await collect(zipOf('ipe_cia_aberta_2026.csv', csv));
    expect(rows[0]?.Assunto).toBe('Resgate; conversão de ações classe "C" - PNCs');
    expect(rows[1]?.Assunto).toBe('Resgate de ações classe "C" - PNCs');
  });

  it('aceita BOM, LF no lugar de CRLF, linha em branco e última linha sem quebra', async () => {
    const csv = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      latin1(
        'CNPJ_Companhia;Nome_Companhia;Categoria;Assunto\n1;A;Fato Relevante;x\n\n2;B;Fato Relevante;y',
      ),
    ]);
    const rows = await collect(zipOf('ipe_cia_aberta_2026.csv', csv));
    expect(rows.map((r) => r.CNPJ_Companhia)).toEqual(['1', '2']);
  });

  it('linha com colunas a menos ou a mais não derruba o arquivo', async () => {
    const csv = latin1(`${HEADER}1;A\r\n2;B;Fato Relevante;y;sobra\r\n`);
    const rows = await collect(zipOf('ipe_cia_aberta_2026.csv', csv));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.CNPJ_Companhia).toBe('1');
  });

  it('guarda o caractere de controle como veio (a limpeza é do cleanText)', async () => {
    const csv = latin1(`${HEADER}1;A;Fato Relevante;${String.fromCodePoint(7)}Deliberar\r\n`);
    const rows = await collect(zipOf('ipe_cia_aberta_2026.csv', csv));
    expect(rows[0]?.Assunto).toBe(`${String.fromCodePoint(7)}Deliberar`);
  });

  it('acha a entrada certa entre várias (o ZIP do FCA tem dez CSV)', async () => {
    const zip = zipOfEntries([
      { name: 'fca_cia_aberta_2026.csv', content: latin1('x;y\r\n1;2\r\n') },
      {
        name: 'fca_cia_aberta_valor_mobiliario_2026.csv',
        content: latin1('Codigo_Negociacao;CNPJ_Companhia\r\nPETR4;33.000.167/0001-01\r\n'),
      },
      { name: 'fca_cia_aberta_auditor_2026.csv', content: latin1('a;b\r\n3;4\r\n') },
    ]);
    const rows = await collect(zip, /^fca_cia_aberta_valor_mobiliario_\d{4}\.csv$/, {
      label: 'fca_cia_aberta_valor_mobiliario_AAAA.csv',
      maxInflatedBytes: 1_000_000,
    });
    expect(rows).toEqual([{ Codigo_Negociacao: 'PETR4', CNPJ_Companhia: '33.000.167/0001-01' }]);
  });

  it('sem a entrada pedida, o erro diz o que o ZIP tem', async () => {
    await expect(collect(zipOf('outro.csv', latin1(HEADER)))).rejects.toThrow(
      /ipe_cia_aberta_AAAA\.csv.*outro\.csv/,
    );
  });

  // O cabeçalho é conferido antes da primeira linha: coluna que a CVM renomeou não vira "todas as linhas vazias".
  describe('requiredColumns', () => {
    const csv = (header: string) =>
      zipOf(
        'ipe_cia_aberta_2026.csv',
        latin1(`${header}\r\n1;SEGREDO-NA-LINHA;Fato Relevante;x\r\n`),
      );

    it('com todas as colunas, lê normalmente', async () => {
      const rows = await collect(csv(HEADER.trim()), IPE, {
        ...OPTIONS,
        requiredColumns: ['CNPJ_Companhia', 'Categoria'],
      });
      expect(rows).toHaveLength(1);
    });

    it('sem uma delas, falha dizendo quais faltam e sem repetir o conteúdo do arquivo', async () => {
      const error = await collect(csv('CNPJ;Nome_Companhia;Categoria_v2;Assunto'), IPE, {
        ...OPTIONS,
        requiredColumns: ['CNPJ_Companhia', 'Nome_Companhia', 'Categoria'],
      }).catch((e: unknown) => e);
      const message = (error as Error).message;
      expect(message).toContain('as colunas CNPJ_Companhia, Categoria');
      expect(message).toContain('ipe_cia_aberta_AAAA.csv');
      expect(message).not.toContain('Nome_Companhia ('); // a que existe não é citada
      expect(message).not.toContain('SEGREDO');
      expect(message).not.toContain('Categoria_v2');
    });

    it('arquivo só com o cabeçalho errado também falha (nenhuma linha para denunciar)', async () => {
      await expect(
        collect(zipOf('ipe_cia_aberta_2026.csv', latin1('A;B\r\n')), IPE, {
          ...OPTIONS,
          requiredColumns: ['CNPJ_Companhia'],
        }),
      ).rejects.toThrow(/colunas CNPJ_Companhia/);
    });

    it('sem a opção, o cabeçalho não é conferido', async () => {
      await expect(collect(csv('A;B;C;D'))).resolves.toHaveLength(1);
    });
  });

  // O nome das entradas é do ZIP, e o ZIP é da rede. A mensagem vai para o log e para job_run.error (revisão de segurança):
  // lista poucos nomes, curtos e sem caractere de controle, não as milhares de entradas de um ZIP hostil.
  it('ZIP com milhares de entradas e nomes hostis: o erro lista só 10, curtos e sem controle', async () => {
    const hostile = `a\n${String.fromCharCode(27)}[31m${'x'.repeat(200)}.csv`;
    const entries = [
      { name: hostile, content: latin1('x') },
      ...Array.from({ length: 2999 }, (_, i) => ({ name: `lixo-${i}.csv`, content: latin1('x') })),
    ];
    const error = await collect(zipOfEntries(entries)).catch((e: unknown) => e);
    const message = (error as Error).message;
    expect(message).toMatch(/ipe_cia_aberta_AAAA\.csv/);
    expect(message.length).toBeLessThan(1000);
    expect(message).toContain('e mais 2990');
    expect(message).not.toMatch(/\p{C}/u);
    expect(message).not.toContain('x'.repeat(100));
    expect(message).toContain('a?'); // o controle virou "?"
    expect(message).not.toContain('lixo-2999');
  });

  it('o que não é ZIP (página HTML de erro) falha', async () => {
    await expect(collect(Buffer.from('<html>erro</html>'))).rejects.toThrow();
  });

  it('CRC32 que não bate é arquivo corrompido: falha, sem entregar linhas como boas', async () => {
    const zip = zipOf('ipe_cia_aberta_2026.csv', latin1(`${HEADER}1;A;Fato Relevante;x\r\n`), {
      crcOverride: 123456,
    });
    await expect(collect(zip)).rejects.toThrow(/CRC32/);
  });

  it('entrada que, inflada, passa do teto é recusada antes de ser lida (bomba de ZIP)', async () => {
    const bomb = zipOf('ipe_cia_aberta_2026.csv', Buffer.alloc(3_000_000, 'A')); // uns 3 KB compactados
    const started = Date.now();
    await expect(collect(bomb, IPE, { ...OPTIONS, maxInflatedBytes: 1_000_000 })).rejects.toThrow(
      /passa do teto/,
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('ZIP que declara o tamanho menor que o real não escapa do teto', async () => {
    const zip = zipOf(
      'ipe_cia_aberta_2026.csv',
      latin1(`${HEADER}${'1;A;Fato Relevante;x\r\n'.repeat(500)}`),
    );
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(10, central + 24); // tamanho descompactado no diretório central
    await expect(collect(zip)).rejects.toThrow(/bytes/);
  });

  it('um campo que abre aspas e nunca fecha não engole o arquivo inteiro', async () => {
    const csv = latin1(
      `${HEADER}1;A;Fato Relevante;"nunca fecha${'x'.repeat(400_000)}\r\n2;B;Fato Relevante;y\r\n`,
    );
    await expect(collect(zipOf('ipe_cia_aberta_2026.csv', csv))).rejects.toThrow(/record/i);
  });
});
