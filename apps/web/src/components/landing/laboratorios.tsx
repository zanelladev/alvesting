import type { PublicCompetitor } from '@alvesting/contracts';
import { labOf, type Laboratorio } from '../../lib/laboratorio';
import { partesDoNome } from '../competidor';
import { AVISO_DE_MARCA } from '../rodape';
import { SimulatedTag } from '../ui';

// A faixa dos seis laboratórios da landing (ADR 0035), no lugar da faixa de marcas do Rallies: um ladrilho por
// laboratório, sempre na mesma ordem, com o logo (máscara em currentColor, decorativo) e o nome do modelo da temporada. O elenco vem do ranking
// (ou das decisões, antes da primeira liquidação); o laboratório sem modelo na temporada (ou sem temporada nenhuma) mostra o nome do
// laboratório. O "simulado" vai uma vez, no cabeçalho, quando a arena é simulada (docs/DESIGN.md: uma vez por contexto), fora do título: o
// nome da região continua o do título. Embaixo, o aviso de marca inteiro, com a frase da arena simulada só quando ela vale.
const LABORATORIOS: ReadonlyArray<readonly [Laboratorio, string]> = [
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['google', 'Google'],
  ['xai', 'xAI'],
  ['deepseek', 'DeepSeek'],
  ['qwen', 'Alibaba Cloud'],
];

const AVISO_SIMULADO =
  'Nesta temporada as decisões são simuladas: o resultado não diz nada sobre os modelos de verdade.';

export function Laboratorios({
  cast,
  simulated,
}: {
  cast: readonly Pick<PublicCompetitor, 'slug' | 'name' | 'type' | 'provider' | 'modelId'>[];
  simulated: boolean;
}) {
  return (
    <section aria-labelledby="laboratorios-titulo" className="mt-24 space-y-5">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <h2 id="laboratorios-titulo" className="text-center text-15 font-semibold">
          Seis laboratórios, o mesmo prompt
        </h2>
        {simulated ? <SimulatedTag /> : null}
      </div>
      <ul className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        {LABORATORIOS.map(([lab, empresa]) => {
          const model = cast.find((competitor) => labOf(competitor) === lab);
          return (
            <li key={lab} className="ladrilho">
              <span aria-hidden="true" data-lab={lab} className="logo size-8" />
              {/* o ladrilho é lugar apertado (docs/DESIGN.md): o nome curto, sem o sufixo de versão do fim ("DeepSeek V4 Pro (0813)"), que fica
                  na arena e na página do modelo (competidor.tsx, partesDoNome) */}
              <span>{model ? partesDoNome(model.name).curto : empresa}</span>
            </li>
          );
        })}
      </ul>
      <p className="mx-auto max-w-[72ch] text-center text-xs text-pretty text-muted">
        {AVISO_DE_MARCA}
        {simulated ? ` ${AVISO_SIMULADO}` : null}
      </p>
    </section>
  );
}
