import type { Metadata } from 'next';
import { LegalDocumentPage } from '../../../components/legal-document';
import { withApiDown } from '../../../lib/with-api-down';

// Termos de uso (plano §12; etapa 11, parte 2): o texto vigente que a api serve, com versão, vigência e SHA-256. Rascunho até a revisão
// do Artur e do orientador (docs/CONTA.md, seção 8): o aviso vem no próprio texto.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Termos de uso' };

export default withApiDown(() => LegalDocumentPage({ id: 'TERMS' }));
