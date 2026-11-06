import type { Metadata } from 'next';
import { AVISO_DO_CHAT, ChatDesligado } from '../../../../components/chat/chat-desligado';
import { Aviso } from '../../../../components/ui';

// O chat (docs/redesign-rallies/plano.md, f.2): o desenho do Chat do Rallies, pronto e DESLIGADO. O chat é a etapa 13 e só começa depois do aval
// do orientador (CLAUDE.md). A saudação é fixa (sem a hora do dia: a página nem precisa do relógio), e a caixa, as abas e as sugestões vêm
// desativadas, com o aviso. Componente de servidor, sem leitura da api nem da sessão: a página não manda nada a lugar nenhum (chat.spec.ts).
export const metadata: Metadata = { title: 'Chat' };

export default function ChatPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 pt-4 pb-6 sm:pt-[10vh]">
      <h1 className="text-center font-display text-26 text-balance sm:text-40">
        O que vamos olhar hoje?
      </h1>
      <ChatDesligado />
      <Aviso>{AVISO_DO_CHAT}</Aviso>
    </div>
  );
}
