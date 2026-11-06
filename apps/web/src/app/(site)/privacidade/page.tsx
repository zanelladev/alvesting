import type { Metadata } from 'next';
import { LegalDocumentPage } from '../../../components/legal-document';
import { withApiDown } from '../../../lib/with-api-down';

// Política de privacidade (plano §12; LGPD, art. 9 e 33; etapa 11, parte 2): o texto vigente que a api serve, com versão, vigência, SHA-256,
// o controlador e o contato. Rascunho até a revisão do Artur e do orientador (docs/CONTA.md, seção 8): o aviso vem no próprio texto.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Política de privacidade' };

export default withApiDown(() => LegalDocumentPage({ id: 'PRIVACY' }));
