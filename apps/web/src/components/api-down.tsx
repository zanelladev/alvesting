import type { ReactNode } from 'react';
import { LINK, NavLink } from './ui';

// A tela de "a arena não respondeu" (plano §3). Duas portas levam a ela: o servidor, quando a leitura da api falha (src/lib/with-api-down.tsx),
// e a página de erro do navegador (src/app/error.tsx), para o que não era previsto. A primeira existe porque o React não renderiza o
// error.tsx no servidor: um erro lançado pela página responde 500 com um corpo sem texto (só scripts), e quem não roda JavaScript, um
// rastreador ou a prévia de um link ficaria sem nada, nem o aviso fixo. Este arquivo não importa nada da api: o error.tsx é um
// Client Component, e o que ele importa vai no JavaScript de toda página.
// O texto é fixo: a mensagem do erro pode trazer detalhe interno (endereço, código, trecho de resposta), e quem lê não precisa dela. O
// `digest` (só no error.tsx) liga esta tela ao log do servidor. `retry` é o que tenta de novo: um botão que refaz a leitura no
// navegador, ou um link que recarrega a página sem JavaScript.
export function ApiDown({ digest, retry }: { digest?: string | undefined; retry: ReactNode }) {
  return (
    <section className="space-y-4">
      {/* a tela de erro não vale como página: sem isto, um rastreador que a pegue durante uma queda a indexaria (a resposta é 200) */}
      <meta name="robots" content="noindex" />
      <h1 className="font-mono text-2xl font-semibold sm:text-3xl">
        Não foi possível carregar os dados
      </h1>
      <p className="max-w-prose">
        A arena não respondeu agora. Tente de novo em alguns minutos; se continuar assim, o problema
        é do site, e não da sua conexão.
      </p>
      {digest ? <p className="font-mono muted">Código do erro: {digest}</p> : null}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {retry}
        <NavLink href="/" className={LINK}>
          Voltar ao início
        </NavLink>
      </div>
    </section>
  );
}
