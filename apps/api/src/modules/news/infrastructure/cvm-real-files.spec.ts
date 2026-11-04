import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FCA_COLUMNS,
  FCA_ENTRY,
  IPE_COLUMNS,
  IPE_ENTRY,
  buildTickerCnpj,
  cvmDocument,
  fcaPair,
  type CvmDocument,
  type FcaPair,
} from '../domain/cvm.js';
import { cvmDraft } from '../domain/draft.js';
import { csvRecords } from './zip-csv.js';

// Conferência com arquivos REAIS da CVM, baixados à mão para .data/cvm/ (fora do git; docs/DEPENDENCIAS.md traz a URL,
// o tamanho e o SHA-256). Nenhum teste baixa nada. Desde 01/11/2026 o bloco só roda com pedido explícito
// (REAL_DATA_TESTS=1): dado de terceiro não entra num `pnpm test` comum até o Artur e o orientador decidirem. Sem o pedido
// ou sem os arquivos, o bloco aparece como pulado, com o motivo no nome.
// Os números esperados saíram de outro leitor de CSV (o módulo csv do Python), independente do csv-parse do código.
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const IPE = path.join(root, '.data/cvm/ipe_cia_aberta_2026.zip');
const FCA = path.join(root, '.data/cvm/fca_cia_aberta_2026.zip');
const present = process.env.REAL_DATA_TESTS === '1' && existsSync(IPE) && existsSync(FCA);
const title = present
  ? 'CVM real: IPE e FCA de 01/11/2026 (arquivos conferidos)'
  : 'CVM real: IPE e FCA de 01/11/2026 [pulado: precisa de REAL_DATA_TESTS=1 e dos dois ZIP em .data/cvm/, ver docs/DEPENDENCIAS.md]';

const PINNED = {
  ipe: {
    bytes: 1_792_802,
    sha256: '73a48c72d224edebbef7adb90e4773f9d46396ef691678a161c3baa978e15011',
  },
  fca: {
    bytes: 362_935,
    sha256: '7cc2ed67a931f1056be04856fb20de2fb5184820bbadb05b82dab5dffb879c2f',
  },
};

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe.skipIf(!present)(title, () => {
  async function load() {
    const ipeZip = await readFile(IPE);
    const fcaZip = await readFile(FCA);
    // se o arquivo for outro (um download mais novo), os números abaixo não valem: avisa em vez de falhar à toa
    expect({ ipe: [ipeZip.length, sha(ipeZip)], fca: [fcaZip.length, sha(fcaZip)] }).toEqual({
      ipe: [PINNED.ipe.bytes, PINNED.ipe.sha256],
      fca: [PINNED.fca.bytes, PINNED.fca.sha256],
    });
    return { ipeZip, fcaZip };
  }

  it('o leitor de CSV acha as mesmas linhas que o csv do Python: 38.317 no IPE e 965 no FCA', async () => {
    const { ipeZip, fcaZip } = await load();
    let ipeRows = 0;
    const categories = new Map<string, number>();
    // as colunas que o código exige (IPE_COLUMNS e FCA_COLUMNS) existem no cabeçalho dos arquivos de verdade
    for await (const record of csvRecords(ipeZip, IPE_ENTRY, {
      label: 'ipe',
      maxInflatedBytes: 128 * 1024 * 1024,
      requiredColumns: IPE_COLUMNS,
    })) {
      ipeRows += 1;
      categories.set(record.Categoria ?? '', (categories.get(record.Categoria ?? '') ?? 0) + 1);
    }
    let fcaRows = 0;
    for await (const record of csvRecords(fcaZip, FCA_ENTRY, {
      label: 'fca',
      maxInflatedBytes: 32 * 1024 * 1024,
      requiredColumns: FCA_COLUMNS,
    })) {
      expect(record.Codigo_Negociacao).toBeDefined();
      fcaRows += 1;
    }
    expect(ipeRows).toBe(38_317);
    expect(categories.get('Fato Relevante')).toBe(2_105);
    expect(categories.get('Comunicado ao Mercado')).toBe(4_789);
    expect(fcaRows).toBe(965);
  });

  it('aceite 3: o fato relevante da Petrobras (28/10/2026) fica em PETR3 e PETR4, o da Dexco em DXCO3', async () => {
    const { ipeZip, fcaZip } = await load();

    const pairs: FcaPair[] = [];
    for await (const record of csvRecords(fcaZip, FCA_ENTRY, {
      label: 'fca',
      maxInflatedBytes: 32 * 1024 * 1024,
    })) {
      const pair = fcaPair(record);
      if (pair) pairs.push(pair);
    }
    expect(pairs).toHaveLength(481);
    expect(new Set(pairs.map((pair) => pair.code)).size).toBe(468);

    // os instrumentos que o banco de dev tem para estas companhias (etapa 4)
    const known = new Set([
      'PETR3',
      'PETR4',
      'VALE3',
      'ITUB4',
      'DXCO3',
      'KLBN3',
      'KLBN4',
      'KLBN11',
      'BPAC11',
      'BPAC3',
      'CSNA3',
      'MBRF3',
      'CMIN3',
      'AXIA3',
      'AXIA5',
    ]);
    const mapping = buildTickerCnpj(pairs, known);
    const tickersOf = (cnpj: string) =>
      [...mapping]
        .filter(([, value]) => value === cnpj)
        .map(([ticker]) => ticker)
        .sort();
    expect(tickersOf('33000167000101')).toEqual(['PETR3', 'PETR4']); // Petrobras
    expect(tickersOf('33592510000154')).toEqual(['VALE3']);
    expect(tickersOf('60872504000123')).toEqual(['ITUB4']);
    expect(tickersOf('97837181000147')).toEqual(['DXCO3']);
    expect(tickersOf('89637490000145')).toEqual(['KLBN11', 'KLBN3', 'KLBN4']); // a unit leva as ações pela raiz
    expect(tickersOf('00001180000126')).toEqual(['AXIA3', 'AXIA5']);
    expect(tickersOf('30306294000145')).toEqual(['BPAC11', 'BPAC3']); // o FCA cita "000000": vale a lacuna curada

    // a janela de 25/10 a 01/11 tem 133 documentos (fato relevante e comunicado) no arquivo
    const window: CvmDocument[] = [];
    for await (const record of csvRecords(ipeZip, IPE_ENTRY, {
      label: 'ipe',
      maxInflatedBytes: 128 * 1024 * 1024,
    })) {
      const doc = cvmDocument(record);
      if (doc && doc.deliveredOn >= '2026-10-25' && doc.deliveredOn <= '2026-11-01')
        window.push(doc);
    }
    expect(window).toHaveLength(133);

    const now = new Date('2026-11-01T17:00:00Z');
    const draftsOf = (cnpj: string) =>
      window
        .filter((doc) => doc.cnpj === cnpj)
        .map((doc) => cvmDraft(doc, tickersOf(cnpj), now))
        .filter((draft) => draft !== null);

    const petrobras = draftsOf('33000167000101');
    expect(petrobras).toHaveLength(4); // 3 comunicados e o fato relevante do relatório de produção e vendas
    expect(petrobras.every((draft) => draft.tickers.join() === 'PETR3,PETR4')).toBe(true);
    const fato = petrobras.find((draft) => draft.title.startsWith('Fato Relevante'));
    expect(fato?.title).toBe(
      'Fato Relevante: PETRÓLEO BRASILEIRO S.A. - PETROBRAS - Relatório de Produção e Vendas 3T26',
    );
    expect(fato?.publishedAt).toEqual(new Date('2026-10-28T03:00:00Z'));
    expect(fato?.url).toMatch(/^https:\/\/www\.rad\.cvm\.gov\.br\/ENET\//);

    const dexco = draftsOf('97837181000147');
    expect(dexco.map((draft) => draft.tickers)).toEqual([['DXCO3'], ['DXCO3']]);
  });

  it('o caractere de controle que a CVM manda no assunto (de assembleia, no arquivo) não chega ao título', async () => {
    const { ipeZip } = await load();
    let doc: CvmDocument | null = null;
    for await (const record of csvRecords(ipeZip, IPE_ENTRY, {
      label: 'ipe',
      maxInflatedBytes: 128 * 1024 * 1024,
    })) {
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x08\x0b-\x1f\x7f]/.test(record.Assunto ?? '')) {
        // as linhas reais com BEL no assunto são de assembleia; o que se confere é a limpeza do texto real
        doc = cvmDocument({ ...record, Categoria: 'Fato Relevante' });
        break;
      }
    }
    expect(doc).not.toBeNull();
    // eslint-disable-next-line no-control-regex
    expect(doc!.subject).toMatch(/[\x00-\x08\x0b-\x1f\x7f]/); // o arquivo traz o controle
    const draft = cvmDraft(doc!, ['PETR4'], new Date('2026-11-01T17:00:00Z'));
    // eslint-disable-next-line no-control-regex
    expect(draft?.title).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
  });
});
