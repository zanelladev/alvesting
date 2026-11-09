import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { legalDocumentSchema } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { RETENTION_DAYS } from '../../maintenance/application/retention.handler.js';
import { LEGAL_FILES, loadLegalDocuments, parseLegalDocument } from './legal-documents.js';

// Os termos de uso e a política de privacidade (etapa 11, plano §12): arquivos .md versionados no repositório, em português, cada um
// com versão, data de vigência e o SHA-256 do texto. A API serve o texto (GET /api/v1/legal) e grava no aceite o documento, a versão
// e este hash. São RASCUNHO para o Artur e o orientador revisarem (docs/CONTA.md).

const docs = loadLegalDocuments();
const byId = (id: 'TERMS' | 'PRIVACY') => docs.find((d) => d.document === id)!;

// Quem recalcula o hash é o teste, lendo o arquivo por conta própria (não confia no que o carregador devolve).
const sha256OfFile = (file: string) =>
  createHash('sha256')
    .update(
      readFileSync(new URL(`../legal/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
      'utf8',
    )
    .digest('hex');

describe('os documentos carregados', () => {
  it('são os dois, na ordem termos e privacidade, e passam pelo contrato da API', () => {
    expect(docs.map((d) => d.document)).toEqual(['TERMS', 'PRIVACY']);
    for (const doc of docs)
      expect(legalDocumentSchema.safeParse(doc).success, doc.document).toBe(true);
  });

  it('o SHA-256 é o do texto em UTF-8, recalculado por fora', () => {
    for (const [id, file] of Object.entries(LEGAL_FILES)) {
      expect(byId(id as 'TERMS' | 'PRIVACY').sha256).toBe(sha256OfFile(file));
    }
  });

  it('a versão e a vigência estão no próprio texto (e portanto no hash), e batem com os campos', () => {
    for (const doc of docs) {
      expect(doc.text).toContain(`Versão: ${doc.version}`);
      const [y, m, d] = doc.effectiveDate.split('-');
      expect(doc.text).toContain(`Vigência: ${d}/${m}/${y}`);
      expect(doc.text.startsWith(`# ${doc.title}\n`)).toBe(true);
    }
  });

  it('é rascunho, e o texto diz isso na cara', () => {
    for (const doc of docs) expect(doc.text).toMatch(/RASCUNHO para revisão/);
  });

  it('nenhum endereço de e-mail escrito no repositório: o contato vem da configuração', () => {
    for (const doc of docs) {
      expect(doc.text, doc.document).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      // marcador de rascunho esquecido; a palavra comum "todo" (minúscula) é texto, e não o marcador
      expect(doc.text, doc.document).not.toMatch(/\bTODO\b|XXX|[Ll]orem/);
    }
  });
});

// Uma versão que alguém já aceitou não muda. Editar o texto sem subir a versão reprova aqui: o aceite guarda o SHA-256 do que o
// usuário viu, e dois textos diferentes sob o mesmo número de versão desfariam a prova. A 0.1 foi a da conta (etapa 11) e a 0.2 é a da
// carteira (etapa 12): quem aceitou a 0.1 recebe 403 CONSENT_REQUIRED nas rotas da carteira até aceitar a 0.2. A política subiu para a 0.3
// em 04/11/2026 (o item 5 passou a prometer o pior caso da limpeza diária): quem aceitou a 0.2 recebe 403 CONSENT_REQUIRED até aceitar a
// 0.3 (portfolio.integration.spec.ts), e os termos, cujo texto não mudou, seguem na 0.2. Todas ainda são rascunho (ninguém aceitou em
// produção): enquanto a vigente for rascunho, atualize o hash dela abaixo ao editar o texto; depois de publicada, suba a versão e
// acrescente a linha. A linha da versão anterior fica, como registro do que foi aceito. Em 07/11/2026 o item 6
// da 0.3, ainda rascunho, trocou a East US 2 pela Chile Central (ADR 0040), e o hash da 0.3 foi atualizado.
const FROZEN: Record<string, string> = {
  'TERMS@0.1': '8b7dce70705a94a18cde089b1dbc241d0a1fd92b3d954eecb74db828a104b221',
  'PRIVACY@0.1': 'e1568adee4a666bd0bd0c68ab490ba59aeb721124b1b30315d7be9c09ecf93b4',
  'TERMS@0.2': '54c7213262ea7215a922bbb000023240f09527a2f77640bd5f8dc0dd63622133',
  'PRIVACY@0.2': 'cef4099255991531928b40d9ec2afeeb628949f5cb14be31a5db51fdc717ef4c',
  'PRIVACY@0.3': '80b64d8fb737db4e049771619966eda189f5bd55a9f8d89686dcd5c68bc1ad26',
};

describe('versões congeladas', () => {
  it.each(['TERMS', 'PRIVACY'] as const)(
    '%s: o texto da versão vigente é o que está congelado',
    (id) => {
      const { version, sha256 } = byId(id);
      expect(
        FROZEN[`${id}@${version}`],
        `a versão ${version} do ${id} não está em FROZEN: acrescente "${id}@${version}": "${sha256}"`,
      ).toBeDefined();
      expect(
        sha256,
        `o texto do ${id}@${version} mudou sem subir a versão (suba a versão no próprio texto e acrescente a linha nova)`,
      ).toBe(FROZEN[`${id}@${version}`]);
    },
  );
});

describe('o que cada documento precisa dizer (plano §12)', () => {
  const terms = byId('TERMS').text;
  const privacy = byId('PRIVACY').text;

  it('os termos: acadêmico, dinheiro fictício, não é recomendação (CVM 19 e 20) e a responsabilidade é do usuário', () => {
    expect(terms).toMatch(/acadêmic/i);
    expect(terms).toMatch(/dinheiro fictício/i);
    expect(terms).toMatch(/não (é|são|constitui|constituem) recomendação de investimento/i);
    expect(terms).toMatch(/Resolu(ção|ções) CVM (n[ºo] )?19/);
    expect(terms).toMatch(/CVM (n[ºo] )?20/);
    expect(terms).toMatch(/não se responsabiliza(m)? pelas decisões/i);
    expect(terms).toMatch(/Política de privacidade/);
  });

  it('a privacidade: controlador e contato (da configuração), dados mínimos, finalidade, base legal, operadores e retenção', () => {
    expect(privacy).toMatch(/controlador/i);
    expect(privacy).toMatch(/configuração/i);
    expect(privacy).toMatch(/nome/i);
    expect(privacy).toMatch(/e-mail/i);
    expect(privacy).toMatch(/finalidade/i);
    expect(privacy).toMatch(/base legal|bases legais/i);
    expect(privacy).toMatch(/art\. 7/);
    expect(privacy).toMatch(/Microsoft Azure/);
    expect(privacy).toMatch(/Google/);
    expect(privacy).toMatch(/retenção|por quanto tempo/i);
  });

  it('a privacidade: direitos do titular (art. 18) e a transferência internacional para o Chile e os Estados Unidos (art. 33)', () => {
    expect(privacy).toMatch(/art\. 18/);
    expect(privacy).toMatch(/art\. 33/);
    expect(privacy).toMatch(/Estados Unidos/);
    expect(privacy).toMatch(/Chile Central/);
    expect(privacy).toMatch(/consentimento específico e em destaque/i);
    for (const right of ['acesso', 'correção', 'portabilidade', 'eliminação', 'revogação']) {
      expect(privacy, right).toMatch(new RegExp(right, 'i'));
    }
  });

  it('a privacidade: os prazos que existem hoje (sessão, tokens, log do WAF e backup do banco)', () => {
    expect(privacy).toMatch(/90 dias/); // o log do WAF do Front Door, com IP e URL (docs/INFRA.md, 2.5)
    expect(privacy).toMatch(/7 dias/); // a sessão e o ponto de restauração do banco
    expect(privacy).toMatch(/endereço IP/i);
  });

  // Cada documento tem a sua versão (a chave do aceite é usuário, documento e versão): os termos seguem na 0.2, a da carteira (etapa 12), porque o
  // texto deles não mudou; a política foi para a 0.3 porque o item 5 passou a prometer o pior caso da limpeza diária (04/11/2026).
  it('as versões vigentes: os termos na 0.2 (a da carteira, etapa 12) e a política na 0.3 (a da limpeza diária)', () => {
    expect(byId('TERMS').version).toBe('0.2');
    expect(byId('PRIVACY').version).toBe('0.3');
  });

  // A política promete o PIOR CASO de cada item da retenção, em português simples: o corte mais a espera até a próxima limpeza, que roda todo
  // dia (docs/CONTA.md, seção 5; o teste do pior caso está em retention.handler.integration.spec.ts). Ela não fala mais de limpeza semanal.
  it('a privacidade promete o pior caso de cada limpeza: cadastro não confirmado em até 7 dias, sessão guardada até 8, pedido de uso único em até 1 dia depois de vencer', () => {
    const retention = privacy.slice(
      privacy.search(/## 5\. Por quanto tempo/),
      privacy.search(/## 6\./),
    );
    expect(retention).toMatch(
      /\*\*Cadastro não confirmado\*\*[^\n]*apagados em até 7 dias depois de criados/,
    );
    expect(retention).toMatch(
      /\*\*Sessão\*\*: até 7 dias[^\n]*em até 1 dia depois de vencerem[^\n]*no máximo 8 dias/,
    );
    expect(retention).toMatch(
      /\*\*Links por e-mail\*\*[^\n]*60 minutos[^\n]*30 minutos[^\n]*em até 1 dia depois de vencerem/,
    );
    // a promessa de antes (limpeza semanal, 14 dias) não sobra no texto
    expect(privacy).not.toMatch(/semanal|14 dias/i);
  });

  // O "6 dias" do texto é o corte do código: quem muda o corte (retention.handler.ts) sem mudar o texto reprova aqui, em vez de deixar a política
  // prometendo outro número. A conta do "7 dias" (corte mais 1 dia de espera pela limpeza seguinte) está no teste do pior caso.
  it('a privacidade cita o corte do código (RETENTION_DAYS.user) e a ressalva de que a promessa conta com a limpeza rodando', () => {
    const retention = privacy.slice(
      privacy.search(/## 5\. Por quanto tempo/),
      privacy.search(/## 6\./),
    );
    expect(retention).toContain(`cadastros que já passaram de ${RETENTION_DAYS.user} dias`);
    expect(RETENTION_DAYS.user + 1).toBe(7); // o corte mais o dia de espera é o "7 dias" prometido
    expect(retention).toMatch(
      /contam com a limpeza diária rodando\. Se uma limpeza falhar ou não rodar[^\n]*na próxima que rodar[^\n]*pelos dias sem limpeza/,
    );
    // o cadastro apagado ainda existe no ponto de restauração do banco, por até 7 dias
    expect(retention).toMatch(
      /\*\*Cadastro não confirmado\*\*[^\n]*cópias de segurança[^\n]*até 7 dias a mais/,
    );
  });

  // A carteira é dado pessoal novo (etapa 12): a política diz o que se guarda, para quê, por quanto tempo e como sai (exportar e excluir).
  it('a privacidade descreve a carteira: o que se guarda, para quê, por quanto tempo, o backup sem o dado pessoal e a transferência', () => {
    // o que se guarda (item 2)
    expect(privacy).toMatch(/\*\*Carteira\*\*[^\n]*ticker[^\n]*quantidade[^\n]*custo[^\n]*data/i);
    // para quê e a base legal (item 3)
    expect(privacy).toMatch(/preço médio[^\n]*(ganho|perda)[^\n]*\n?[^\n]*art\. 7º, V/i);
    // por quanto tempo (item 5): até apagar o lançamento ou a conta
    expect(privacy).toMatch(
      /\*\*Carteira\*\*[^\n]*até você apagar o lançamento ou excluir a conta/i,
    );
    // o backup mensal sem o dado pessoal e o ponto de restauração de 7 dias
    expect(privacy).toMatch(/não leva nenhum dado das tabelas da conta nem da carteira/i);
    expect(privacy).toMatch(
      /ponto de restauração contínuo por 7 dias, e só ele guarda dado pessoal/i,
    );
    // a transferência internacional vale para a carteira como para os outros dados
    expect(privacy).toMatch(/inclusive a carteira/i);
    // exportar e excluir cobrem a carteira
    expect(privacy).toMatch(/exportar meus dados[^\n]*a carteira com os lançamentos/i);
    expect(privacy).toMatch(/apagamos do banco, no mesmo ato[^\n]*a carteira/i);
  });

  // As rotas da carteira ficam atrás do ConsentGuard (a classe inteira, inclusive apagar um lançamento): sem o aceite da versão vigente a
  // pessoa só exporta os dados e exclui a conta (as rotas dos direitos do titular), e o texto do item 7 não promete outra coisa.
  it('a privacidade diz que, sem o aceite da versão vigente, a correção dos lançamentos espera o aceite e só exportar e excluir a conta seguem abertos', () => {
    expect(privacy).toMatch(
      /lançamentos da carteira você faz na própria tela da carteira[^\n]*ainda não aceitou a versão nova[^\n]*pede o aceite primeiro \(item 9\)[^\n]*exportar os dados e excluir a conta[^\n]*seguem disponíveis/i,
    );
  });

  it('a privacidade descreve só o que existe: o chat ainda não existe e entra depois, com versão nova', () => {
    expect(privacy).toMatch(/chat/i);
    expect(privacy).toMatch(/chat consultivo ainda não existe/i);
    // a carteira já existe: o texto não diz mais que ela não existe
    expect(privacy).not.toMatch(/carteira[^.]*ainda não existe/i);
  });

  // Os termos (etapa 12): a carteira é informativa, os valores são estimados pelo último fechamento disponível e nada ali é recomendação.
  it('os termos dizem que a carteira é informativa, que os valores são estimados pelo último fechamento disponível e que nada ali é recomendação', () => {
    const section = terms.slice(terms.search(/## \d+\. A carteira/));
    expect(terms).toMatch(/## \d+\. A carteira/);
    expect(section).toMatch(/informativa/i);
    expect(section).toMatch(/estimad[oa]s[^.]*último fechamento disponível/i);
    expect(section).toMatch(/Nada na carteira é recomendação/i);
    // a carteira não negocia nada nem confere os números do usuário
    expect(section).toMatch(/não compra nem vende/i);
    // a seção 2 (nada é recomendação) e a 7 (seus dados, onde se exporta) citam a carteira
    expect(terms).toMatch(/Isso vale para[^.]*a carteira/i);
    expect(terms).toMatch(/exportar seus dados[^.]*carteira/i);
  });
});

describe('parseLegalDocument', () => {
  const ok = [
    '# Título de teste',
    '',
    'Versão: 1.0',
    'Vigência: 15/03/2027',
    '',
    'Corpo do texto.',
    '',
  ].join('\n');

  it('lê o título, a versão e a vigência, e hasheia o texto exato (com LF)', () => {
    const doc = parseLegalDocument('TERMS', ok);
    expect(doc).toMatchObject({
      document: 'TERMS',
      title: 'Título de teste',
      version: '1.0',
      effectiveDate: '2027-03-15',
      text: ok,
    });
    expect(doc.sha256).toBe(createHash('sha256').update(ok, 'utf8').digest('hex'));
  });

  it('quebra de linha CRLF vira LF: o hash é o mesmo em qualquer sistema', () => {
    expect(parseLegalDocument('TERMS', ok.replace(/\n/g, '\r\n')).sha256).toBe(
      parseLegalDocument('TERMS', ok).sha256,
    );
  });

  it.each([
    ['sem título', ok.replace('# Título de teste', 'Título de teste')],
    ['sem a linha de versão', ok.replace('Versão: 1.0\n', '')],
    ['versão torta', ok.replace('Versão: 1.0', 'Versão: um')],
    ['versão com três números', ok.replace('Versão: 1.0', 'Versão: 1.0.1')],
    ['sem a vigência', ok.replace('Vigência: 15/03/2027\n', '')],
    ['vigência fora do formato', ok.replace('15/03/2027', '2027-03-15')],
    ['vigência que não existe', ok.replace('15/03/2027', '31/02/2027')],
    ['vazio', ''],
    ['só espaços', '   \n  '],
  ])('recusa o documento %s', (_nome, raw) => {
    expect(() => parseLegalDocument('TERMS', raw)).toThrow(/documento legal/i);
  });
});
