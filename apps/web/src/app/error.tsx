'use client';

import { ApiDown } from '../components/api-down';
import { BUTTON } from '../components/ui';

// A página de erro do navegador (plano §3): o que não era previsto (um bug de renderização, o API_INTERNAL_URL ausente). A leitura da
// api que falha não chega aqui: o servidor a trata e monta a tela dele mesmo (src/lib/with-api-down.tsx), para ela existir sem JavaScript.
// O texto é o mesmo (components/api-down.tsx), e "Tentar de novo" é a pílula branca, como na tela do servidor. O `digest` liga esta tela ao
// log do servidor.
// Next 16.4: a propriedade para tentar de novo, buscando os dados outra vez, é `retry` (node_modules/next/dist/docs, error.md).
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest =
    error instanceof Error && 'digest' in error && typeof error.digest === 'string'
      ? error.digest
      : undefined;
  return (
    <ApiDown
      digest={digest}
      retry={
        <button type="button" onClick={() => retry()} className={`${BUTTON} btn-primary`}>
          Tentar de novo
        </button>
      }
    />
  );
}
