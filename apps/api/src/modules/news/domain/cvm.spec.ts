import { describe, expect, it } from 'vitest';
import {
  FCA_GAPS,
  IPE_WINDOW_DAYS,
  buildTickerCnpj,
  cvmDocument,
  fcaPair,
  ipeUrl,
  fcaUrl,
  ipeWindowStart,
  ipeYears,
  mayBeMissing,
} from './cvm.js';

// Linhas sintéticas no formato do IPE e do FCA da CVM (docs/DADOS.md, seção 14). As empresas e os CNPJ são os
// públicos de companhias abertas, que aparecem no cadastro; o conteúdo dos documentos é inventado.
const ipeRow = (overrides: Record<string, string> = {}): Record<string, string> => ({
  CNPJ_Companhia: '33.000.167/0001-01',
  Nome_Companhia: 'PETRÓLEO BRASILEIRO S.A. - PETROBRAS',
  Codigo_CVM: '9512',
  Data_Referencia: '2026-10-28',
  Categoria: 'Fato Relevante',
  Tipo: '',
  Especie: '',
  Assunto: 'Assunto de teste',
  Data_Entrega: '2026-10-28',
  Tipo_Apresentacao: 'AP - Apresentação',
  Protocolo_Entrega: '009512IPE281020260000000000-00',
  Versao: '1',
  Link_Download:
    'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&descTipo=IPE&CodigoInstituicao=1&numProtocolo=1&numSequencia=2&numVersao=1',
  ...overrides,
});

describe('cvmDocument', () => {
  it('lê um fato relevante: CNPJ só com dígitos e os campos que a notícia usa', () => {
    const row = ipeRow();
    expect(cvmDocument(row)).toEqual({
      cnpj: '33000167000101',
      company: 'PETRÓLEO BRASILEIRO S.A. - PETROBRAS',
      category: 'Fato Relevante',
      type: '',
      subject: 'Assunto de teste',
      deliveredOn: '2026-10-28',
      link: row.Link_Download,
    });
  });

  it('lê comunicado ao mercado, com o tipo', () => {
    const doc = cvmDocument(
      ipeRow({
        Categoria: 'Comunicado ao Mercado',
        Tipo: 'Esclarecimentos sobre questionamentos da CVM/B3',
      }),
    );
    expect(doc?.category).toBe('Comunicado ao Mercado');
    expect(doc?.type).toBe('Esclarecimentos sobre questionamentos da CVM/B3');
  });

  it('só fato relevante e comunicado ao mercado: assembleia, demonstração e o resto não entram', () => {
    for (const category of [
      'Assembleia',
      'Dados Econômico-Financeiros',
      'Reunião da Administração',
      'Aviso aos Acionistas',
      '',
      'fato relevante',
    ]) {
      expect(cvmDocument(ipeRow({ Categoria: category })), category).toBeNull();
    }
  });

  it('linha torta é descartada: CNPJ, data ou link inválidos', () => {
    expect(cvmDocument(ipeRow({ CNPJ_Companhia: '33.000.167/0001' }))).toBeNull();
    expect(cvmDocument(ipeRow({ CNPJ_Companhia: '' }))).toBeNull();
    expect(cvmDocument(ipeRow({ Data_Entrega: '2026-02-30' }))).toBeNull();
    expect(cvmDocument(ipeRow({ Data_Entrega: '28/10/2026' }))).toBeNull();
    expect(cvmDocument(ipeRow({ Link_Download: '' }))).toBeNull();
    expect(cvmDocument(ipeRow({ Nome_Companhia: '' }))).toBeNull();
    expect(cvmDocument({})).toBeNull();
  });

  it('campo opcional ausente na linha vira texto vazio, não exceção', () => {
    const { Assunto: _assunto, ...withoutSubject } = ipeRow();
    expect(cvmDocument(withoutSubject)?.subject).toBe('');
  });
});

describe('fcaPair', () => {
  const fcaRow = (code: string, cnpj = '33.000.167/0001-01'): Record<string, string> => ({
    CNPJ_Companhia: cnpj,
    Valor_Mobiliario: 'Ações Preferenciais',
    Codigo_Negociacao: code,
  });

  it('código de negociação válido, em maiúsculas', () => {
    expect(fcaPair(fcaRow('PETR4'))).toEqual({ code: 'PETR4', cnpj: '33000167000101' });
    expect(fcaPair(fcaRow(' b3sa3 '))).toEqual({ code: 'B3SA3', cnpj: '33000167000101' });
    expect(fcaPair(fcaRow('tgma3'))).toEqual({ code: 'TGMA3', cnpj: '33000167000101' });
  });

  it('o que o cadastro traz no lugar do código não conta', () => {
    for (const code of [
      '',
      'NÃO HÁ',
      'N/A',
      '000000',
      '0',
      'LTEL3B',
      'ADR',
      'PNC',
      '1545-8',
      'PETR3, PETR4',
    ]) {
      expect(fcaPair(fcaRow(code)), code).toBeNull();
    }
  });

  it('CNPJ inválido descarta', () => {
    expect(fcaPair(fcaRow('PETR4', 'sem cnpj'))).toBeNull();
    expect(fcaPair({})).toBeNull();
  });
});

describe('buildTickerCnpj: do CNPJ ao ticker, cruzando com os instrumentos conhecidos', () => {
  const PETROBRAS = '33000167000101';
  const KLABIN = '89637490000145';
  const VALE = '33592510000154';
  const known = (...tickers: string[]) => new Set(tickers);

  it('o código que o FCA cita e que existe como instrumento vai para o CNPJ', () => {
    const map = buildTickerCnpj(
      [
        { code: 'PETR3', cnpj: PETROBRAS },
        { code: 'PETR4', cnpj: PETROBRAS },
        { code: 'VALE3', cnpj: VALE },
      ],
      known('PETR3', 'PETR4', 'VALE3'),
    );
    expect(map.get('PETR3')).toBe(PETROBRAS);
    expect(map.get('PETR4')).toBe(PETROBRAS);
    expect(map.get('VALE3')).toBe(VALE);
  });

  it('código do FCA que não é instrumento (não negociou, BDR, outra classe) fica de fora', () => {
    const map = buildTickerCnpj([{ code: 'PETR4', cnpj: PETROBRAS }], known('VALE3'));
    expect(map.size).toBe(0);
  });

  it('as ações de uma unit (KLBN11) herdam o CNPJ pela raiz de quatro letras', () => {
    const map = buildTickerCnpj(
      [{ code: 'KLBN11', cnpj: KLABIN }],
      known('KLBN11', 'KLBN3', 'KLBN4'),
    );
    expect(map.get('KLBN11')).toBe(KLABIN);
    expect(map.get('KLBN3')).toBe(KLABIN);
    expect(map.get('KLBN4')).toBe(KLABIN);
  });

  it('raiz que o FCA atribui a dois CNPJ não herda nada (ambígua)', () => {
    const map = buildTickerCnpj(
      [
        { code: 'ABCD3', cnpj: PETROBRAS },
        { code: 'ABCD4', cnpj: VALE },
      ],
      known('ABCD3', 'ABCD4', 'ABCD11'),
    );
    expect(map.get('ABCD3')).toBe(PETROBRAS);
    expect(map.get('ABCD4')).toBe(VALE);
    expect(map.has('ABCD11')).toBe(false);
  });

  it('código que o FCA atribui a dois CNPJ não é mapeado (ambíguo)', () => {
    const map = buildTickerCnpj(
      [
        { code: 'ABCD3', cnpj: PETROBRAS },
        { code: 'ABCD3', cnpj: VALE },
      ],
      known('ABCD3'),
    );
    expect(map.has('ABCD3')).toBe(false);
  });

  it('o mesmo código repetido para o mesmo CNPJ (versões do FCA) não é ambiguidade', () => {
    const map = buildTickerCnpj(
      [
        { code: 'PETR4', cnpj: PETROBRAS },
        { code: 'PETR4', cnpj: PETROBRAS },
      ],
      known('PETR4'),
    );
    expect(map.get('PETR4')).toBe(PETROBRAS);
  });

  it('o código do FCA vale mais que a raiz', () => {
    const map = buildTickerCnpj(
      [
        { code: 'ABCD3', cnpj: PETROBRAS },
        { code: 'ABCD11', cnpj: VALE },
      ],
      known('ABCD3', 'ABCD11'),
    );
    expect(map.get('ABCD3')).toBe(PETROBRAS);
    expect(map.get('ABCD11')).toBe(VALE);
  });

  it('as lacunas conhecidas do cadastro (BTG, CSN, MBRF...) entram pela lista curada, sem desfazer o que o FCA diz', () => {
    const map = buildTickerCnpj([], known('BPAC11', 'BPAC3', 'BPAC5', 'CSNA3', 'MBRF3', 'CMIN3'));
    expect(map.get('BPAC11')).toBe('30306294000145'); // Banco BTG Pactual S/A
    expect(map.get('BPAC3')).toBe('30306294000145');
    expect(map.get('BPAC5')).toBe('30306294000145');
    expect(map.get('CSNA3')).toBe('33042730000104'); // Companhia Siderúrgica Nacional
    expect(map.get('MBRF3')).toBe('03853896000140'); // Marfrig Global Foods (MBRF)
    expect(map.get('CMIN3')).toBe('08902291000115'); // CSN Mineração

    const fixed = buildTickerCnpj([{ code: 'BPAC11', cnpj: PETROBRAS }], known('BPAC11'));
    expect(fixed.get('BPAC11')).toBe(PETROBRAS); // se o FCA passar a citar o código, vale o FCA
  });

  it('a lista curada só tem CNPJ de 14 dígitos e raiz de 4 letras', () => {
    for (const [prefix, cnpj] of Object.entries(FCA_GAPS)) {
      expect(prefix).toMatch(/^[A-Z][A-Z0-9]{3}$/);
      expect(cnpj).toMatch(/^[0-9]{14}$/);
    }
  });

  it('ETF de referência (BOVA11) não ganha CNPJ', () => {
    expect(buildTickerCnpj([{ code: 'PETR4', cnpj: PETROBRAS }], known('BOVA11')).size).toBe(0);
  });
});

describe('janela e endereços do IPE', () => {
  it('a janela são os últimos 7 dias, no calendário de Brasília', () => {
    expect(IPE_WINDOW_DAYS).toBe(7);
    expect(ipeWindowStart(new Date('2026-11-01T16:00:00Z'))).toBe('2026-10-25');
    // 02:00 UTC de 01/11 ainda é 31/10 em Brasília
    expect(ipeWindowStart(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10-24');
  });

  it('no meio do ano, só o arquivo do ano; na virada, também o do ano anterior', () => {
    expect(ipeYears(new Date('2026-11-01T16:00:00Z'))).toEqual([2026]);
    expect(ipeYears(new Date('2026-12-31T20:00:00Z'))).toEqual([2026]);
    expect(ipeYears(new Date('2027-01-03T15:00:00Z'))).toEqual([2026, 2027]);
    expect(ipeYears(new Date('2027-01-08T15:00:00Z'))).toEqual([2027]);
    // 01/01 às 02:00 UTC ainda é 31/12 em Brasília
    expect(ipeYears(new Date('2027-01-01T02:00:00Z'))).toEqual([2026]);
  });

  it('o arquivo do ano novo pode faltar só nas duas primeiras semanas de janeiro', () => {
    expect(mayBeMissing(2027, new Date('2027-01-02T15:00:00Z'))).toBe(true);
    expect(mayBeMissing(2027, new Date('2027-01-14T15:00:00Z'))).toBe(true);
    expect(mayBeMissing(2027, new Date('2027-01-16T15:00:00Z'))).toBe(false);
    expect(mayBeMissing(2027, new Date('2027-06-01T15:00:00Z'))).toBe(false);
    expect(mayBeMissing(2026, new Date('2027-01-03T15:00:00Z'))).toBe(false); // o do ano anterior tem de existir
  });

  it('os endereços são da CVM, por ano, e só de dígitos', () => {
    expect(ipeUrl(2026)).toBe(
      'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/ipe_cia_aberta_2026.zip',
    );
    expect(fcaUrl(2026)).toBe(
      'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_2026.zip',
    );
    expect(() => ipeUrl(26)).toThrow(RangeError);
    expect(() => fcaUrl(Number.NaN)).toThrow(RangeError);
  });
});
