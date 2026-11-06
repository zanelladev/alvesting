import { LOGO_HEADERS } from '@alvesting/contracts';
import { readLogoSvg } from '../../../lib/quotes';
import { withViewBox } from '../viewbox';

// O logo de um papel, servido do próprio domínio (ADR 0036, "Como o site mostra"; docs/TELAS.md, "Logos das ações"): GET /logos/<TICKER>.svg,
// que o <LogoDoPapel> põe num <img> com `?v=<versão>`. O navegador nunca fala com a brapi nem com a api: o site lê o SVG guardado pela rota
// interna (lib/quotes.ts, readLogoSvg, com o segredo do servidor) e o repassa só como image/svg+xml dentro do teto, com o viewBox posto quando
// a raiz não o tem (viewbox.ts). A resposta leva os cabeçalhos dos logos do contrato (o SVG é imagem, nunca documento: a CSP com `sandbox`
// deixa o arquivo aberto direto na aba inerte, e o next.config.ts repete a CSP para /logos, porque a regra geral do site venceria a daqui) e o
// cache de um ano, imutável: a versão (o começo do SHA-256 do SVG) está na URL, então logo novo é URL nova. A Front Door não guarda nada daqui
// (a rota /* dela não tem cache): quem guarda é o navegador. O resto (o arquivo fora da forma, o papel sem logo, a api que falha ou responde
// outra coisa) é 404 sem corpo e sem cache.
const FILE = /^([A-Z0-9]{4,12})\.svg$/;
const NOT_FOUND = { status: 404, headers: { 'Cache-Control': 'no-store' } };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ arquivo: string }> },
): Promise<Response> {
  const ticker = FILE.exec((await params).arquivo)?.[1];
  const svg = ticker === undefined ? null : await readLogoSvg(ticker);
  if (svg === null) return new Response(null, NOT_FOUND);
  return new Response(withViewBox(svg), {
    headers: { ...LOGO_HEADERS, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
