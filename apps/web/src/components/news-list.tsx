import type { NewsItem } from '@alvesting/contracts';
import { formatDateTime, formatDay } from '../lib/format';
import { LINK, NavLink } from './ui';

// A lista de notícias (plano §3; no desenho do Rallies, docs/redesign-rallies/plano.md, f.1: cada notícia como um item de feed, separado do
// de cima por um fio): título, fonte, hora de Brasília, tickers e o link para o site de origem. Título e link são dado de terceiro (docs/DADOS.md, seção 13): o título entra como texto (o React o escapa), o link
// já passou pelo contrato (só http e https, sem usuário nem senha) e abre noutra aba sem entregar a janela de origem nem a página de onde
// veio (`noopener noreferrer`) e sem passar a nossa reputação a quem o sistema não escolheu (`nofollow`). O trecho (snippet) nunca chega
// aqui: a api não o manda. O documento da CVM chega só com o dia (a api o guarda à meia-noite de Brasília): mostrar "00:00" seria uma hora
// que o dado não tem. Os tickers são filtros em link (`chip`), cada um levando à página da ação.
export function NewsList({ rows }: { rows: readonly NewsItem[] }) {
  return (
    <ul aria-label="Notícias" className="max-w-2xl">
      {rows.map((news) => (
        <li
          key={news.url}
          className="min-w-0 border-t border-hairline py-4 first:border-t-0 first:pt-0"
        >
          {/* o título é de terceiro e pode ter uma palavra sem espaço (hashtag, URL): `anywhere` a deixa quebrar também no cálculo da
              largura mínima do link (o `break-word` do html não encolhe), senão ela alarga a página em 360 px. O respiro de 12 px em
              cima e embaixo dá o alvo de 44 px com uma linha e com duas, e o mesmo ritmo nos dois cartões (a altura mínima centralizada
              deixava 11 px a mais em volta do título curto, e nenhum no comprido) */}
          <a
            href={news.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={`${LINK} max-w-full py-3 text-15 font-semibold no-underline hover:underline [overflow-wrap:anywhere]`}
          >
            {news.title}
            <span className="sr-only"> (abre em outra aba)</span>
          </a>
          <p className="text-xs text-muted">
            {news.sourceName} ·{' '}
            <time dateTime={news.publishedAt}>
              {news.source.startsWith('cvm')
                ? formatDay(news.publishedAt)
                : formatDateTime(news.publishedAt)}
            </time>
          </p>
          {news.tickers.length > 0 ? (
            <p className="flex flex-wrap gap-x-2 pt-1">
              {news.tickers.map((ticker) => (
                <NavLink key={ticker} href={`/acoes/${ticker}`} className="chip font-mono">
                  {ticker}
                </NavLink>
              ))}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
