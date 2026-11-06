import type { ReactNode } from 'react';
import { ApiDown } from '../components/api-down';
import { BUTTON } from '../components/ui';
import { ApiError } from './api';

// Envolve a página que lê a api: se a leitura não deu certo (a api fora do ar, lenta ou fora do contrato: todo ApiError), a página
// responde com a tela de "a arena não respondeu" montada no servidor, com o cabeçalho e o rodapé (o aviso fixo inclusive), em vez de
// relançar o erro. Relançado, o React não renderiza o error.tsx no servidor: a resposta seria 500 com um corpo só de scripts, em branco
// para quem não roda JavaScript, rastreador ou prévia de link (docs/TELAS.md, seção 2).
//
// O preço: a resposta é 200, e não 500, porque o Next não deixa um Server Component escolher o status (só o 404, pelo notFound()). Por
// isso a tela leva `noindex`, e o erro vai inteiro para o log do servidor (é daí que o alerta de falha da api vem). O 404 (e o 400
// que o site provoca com um cursor forjado) já virou notFound() em orNotFound, que não é ApiError e passa; o que não é ApiError (um
// bug, ou o API_INTERNAL_URL ausente) também passa, para o error.tsx: não é "a arena não respondeu".
export function withApiDown<P>(page: (props: P) => Promise<ReactNode>) {
  return async function Page(props: P): Promise<ReactNode> {
    try {
      return await page(props);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      console.error('[web] a api não atendeu a página:', error);
      return (
        <ApiDown
          retry={
            // recarrega a mesma URL (com a query): funciona sem JavaScript, e a leitura que falhou não ficou no cache de dados
            <a href="" className={`${BUTTON} btn-primary`}>
              Tentar de novo
            </a>
          }
        />
      );
    }
  };
}
