// Adaptado do Native select da ReUI (https://reui.io/components/native-select), que é o componente "native-select" do shadcn/ui (registro
// https://ui.shadcn.com/r/styles/new-york-v4/native-select.json, lido em 05/11/2026; o mesmo que `shadcn add native-select` instala). Copyright (c)
// 2023 shadcn, licença MIT (o texto inteiro em components/reui/LICENSE, com o da ReUI).
// O que veio de lá: o `<select>` do navegador com o desenho do campo por cima (`appearance-none`) e a seta à parte, que não recebe o toque; as
// opções com o fundo e a tinta (lá, as cores do sistema, `Canvas` e `CanvasText`; aqui, o canvas e a tinta dos tokens, que seguem o tema).
// O que mudou (ADR 0037; docs/DEPENDENCIAS.md): o desenho é o do nosso campo (o `.field`: 44 px, raio 8, o cinza do painel, o fio de controle e
// os 16 px que impedem o zoom do Safari do iPhone; o anel de foco e a borda do erro, `aria-invalid`, são os do site), a seta é o nosso ícone (sem
// lucide-react), e saíram o `cn` e o tamanho pequeno. Sem JavaScript: é um componente de servidor e de cliente.
import type { ComponentProps } from 'react';
import { Icone } from '../icones';

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <div className={`relative min-w-0${className ? ` ${className}` : ''}`}>
      <select data-slot="native-select" className="field w-full appearance-none pr-10" {...props} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted"
      >
        <Icone size={16}>
          <path d="M6 8l4 4 4-4" />
        </Icone>
      </span>
    </div>
  );
}

export const NativeSelectOption = ({ className, ...props }: ComponentProps<'option'>) => (
  <option className={`bg-canvas text-ink${className ? ` ${className}` : ''}`} {...props} />
);
