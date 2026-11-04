import type { LegalDocumentId } from '@alvesting/contracts';
import { readLegal } from '../lib/account';
import { formatDate } from '../lib/format';
import { documentOf } from '../lib/legal';
import { LegalText } from './legal-text';
import { Fact, Facts, LINK, NavLink } from './ui';

// Uma das duas páginas de texto legal (etapa 11, parte 2): o título, a versão, a vigência e o SHA-256 acima do texto, que é o que a api
// serve e o que o aceite grava (sem cache: um texto velho em cache faria a pessoa aceitar uma versão que a api já recusa). A política
// de privacidade mostra também o controlador e o contato (LGPD, art. 9), que vêm da configuração da api e não do texto. Nada aqui lê a
// sessão: qualquer pessoa lê os textos antes de criar a conta.
export async function LegalDocumentPage({ id }: { id: LegalDocumentId }) {
  const legal = await readLegal();
  const doc = documentOf(legal, id);
  const other =
    id === 'TERMS'
      ? (['/privacidade', 'Política de privacidade'] as const)
      : (['/termos', 'Termos de uso'] as const);

  return (
    <>
      <header className="space-y-3">
        <h1 className="font-mono text-2xl font-semibold sm:text-3xl">{doc.title}</h1>
        <Facts>
          <Fact term="Versão">{doc.version}</Fact>
          <Fact term="Vigência">{formatDate(doc.effectiveDate)}</Fact>
          <Fact term="SHA-256">
            <span className="break-all">{doc.sha256}</span>
          </Fact>
          {id === 'PRIVACY' ? (
            <>
              <Fact term="Controlador" prose>
                {legal.controller?.name ?? 'ainda não informado (configuração de desenvolvimento)'}
              </Fact>
              <Fact term="Contato" prose>
                {legal.controller ? (
                  <a href={`mailto:${legal.controller.contact}`} className={`${LINK} break-all`}>
                    {legal.controller.contact}
                  </a>
                ) : (
                  'ainda não informado'
                )}
              </Fact>
            </>
          ) : null}
        </Facts>
        <p className="muted max-w-prose">
          O código SHA-256 identifica o texto exato que você aceita: no seu aceite a Alvesting
          guarda o documento, a versão, esse código e a data. Texto novo é versão nova e pede novo
          aceite.
        </p>
      </header>

      <article aria-label={doc.title}>
        <LegalText text={doc.text} />
      </article>

      <ul className="flex flex-wrap gap-x-6">
        <li>
          <NavLink href={other[0]} className={LINK}>
            {other[1]}
          </NavLink>
        </li>
        <li>
          <NavLink href="/cadastro" className={LINK}>
            Criar conta
          </NavLink>
        </li>
      </ul>
    </>
  );
}
