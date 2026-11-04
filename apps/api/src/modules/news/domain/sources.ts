// As fontes de notícia e dado externo do worker (fila `news`). A lista é fixa no código: nenhuma URL vem de mensagem,
// de banco ou de ambiente (docs/DADOS.md, seção 13). Cada fonte também tem a sua linha em docs/DEPENDENCIAS.md, com
// os termos de uso lidos em 01/11/2026. O id é o `source` da mensagem `fetch` (minúsculas e hífens) e o `source` de
// news_item.

export interface RssSource {
  kind: 'rss';
  id: string;
  name: string;
  url: string;
  // Os termos do site deixam levar o trecho do feed ao provedor da LLM, dentro do briefing? false = só o título e a fonte
  // (docs/DADOS.md, seção 13). Só a Agência Brasil autoriza; os outros vedam ou não têm termos, até haver autorização
  // por escrito. O trecho continua guardado no banco: virar true devolve o trecho ao briefing seguinte, sem rebuscar.
  allowExcerpt: boolean;
}

// Fatos relevantes e comunicados da CVM (IPE), com o cadastro de valores mobiliários do FCA para achar o ticker.
export interface CvmSource {
  kind: 'cvm';
  id: 'cvm-ipe';
  name: string;
}

// Macro do BCB pelo SGS (CDI, Selic, IPCA, dólar PTAX): grava macro_daily, não news_item.
export interface BcbSource {
  kind: 'bcb';
  id: 'bcb-sgs';
  name: string;
}

export type NewsSource = RssSource | CvmSource | BcbSource;

// ponytail: o InfoMoney mostra só os 10 itens mais recentes. Com a busca a cada 30 minutos, a hora de maior movimento
// pode publicar mais que isso e o excedente se perde. Se a conferência mostrar buraco, trocar por um feed de categoria
// ou buscar a segunda página.
export const NEWS_SOURCES: readonly NewsSource[] = [
  {
    kind: 'rss',
    id: 'infomoney',
    name: 'InfoMoney',
    url: 'https://www.infomoney.com.br/feed/',
    allowExcerpt: false,
  },
  {
    kind: 'rss',
    id: 'money-times',
    name: 'Money Times',
    url: 'https://www.moneytimes.com.br/mercados/feed/',
    allowExcerpt: false,
  },
  {
    kind: 'rss',
    id: 'seu-dinheiro',
    name: 'Seu Dinheiro',
    url: 'https://www.seudinheiro.com/feed/',
    allowExcerpt: false,
  },
  {
    kind: 'rss',
    id: 'agencia-brasil',
    name: 'Agência Brasil',
    url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml',
    allowExcerpt: true,
  },
  { kind: 'cvm', id: 'cvm-ipe', name: 'CVM' },
  { kind: 'bcb', id: 'bcb-sgs', name: 'Banco Central' },
];

export const sourceById = (id: string): NewsSource | undefined =>
  NEWS_SOURCES.find((source) => source.id === id);

// O nome para mostrar. Notícia de uma fonte que saiu da lista continua no banco: aparece pelo id.
export const sourceName = (id: string): string => sourceById(id)?.name ?? id;

// O trecho da notícia pode ir para o briefing? RSS: só se os termos do site deixam (allowExcerpt). CVM: sim, é o tipo do
// documento (dados abertos). Fonte que saiu da lista: não, porque ninguém sabe mais o que os termos dela dizem.
export function excerptAllowed(id: string): boolean {
  const source = sourceById(id);
  return source?.kind === 'cvm' || (source?.kind === 'rss' && source.allowExcerpt);
}
