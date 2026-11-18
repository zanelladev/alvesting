import type { PublicCompetitor } from '@alvesting/contracts';
import { labOf, type Laboratorio } from '../../lib/laboratorio';
import { formatBps } from '../../lib/format';
import { partesDoNome } from '../competidor';
import { IconeElenco } from '../icones';
import { AVISO_DE_MARCA } from '../rodape';
import { SimulatedTag, direction } from '../ui';
import { CabSecao } from './paineis';

// O elenco da landing (ADR 0041): o cabeçalho de seção ("Seis laboratórios, o mesmo prompt.", com o aviso de marca inteiro ao lado, e a frase
// da arena simulada só quando ela vale) e uma célula por laboratório, sempre na mesma ordem, com o logo (decorativo), o nome do modelo da
// temporada, o laboratório e o retorno dele. O elenco vem do ranking (ou das decisões, antes da primeira liquidação); o laboratório sem modelo
// na temporada (ou sem temporada nenhuma) mostra o nome do laboratório. O "simulado" vai uma vez, no cabeçalho, quando a arena é simulada
// (docs/DESIGN.md: uma vez por contexto), fora do título: o nome da região continua o do título.
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
  returns,
}: {
  cast: readonly Pick<PublicCompetitor, 'slug' | 'name' | 'type' | 'provider' | 'modelId'>[];
  simulated: boolean;
  // o retorno de cada modelo na temporada (o ranking), pelo slug; antes da primeira liquidação, nenhum
  returns: ReadonlyMap<string, number>;
}) {
  return (
    <section aria-labelledby="laboratorios-titulo" className="folha">
      <CabSecao
        id="laboratorios-titulo"
        selo={
          <>
            <IconeElenco />O elenco
          </>
        }
        titulo="Seis laboratórios,"
        tom2="o mesmo prompt."
        texto={
          <>
            {AVISO_DE_MARCA}
            {simulated ? ` ${AVISO_SIMULADO}` : null}
            {simulated ? <SimulatedTag /> : null}
          </>
        }
      />
      <div className="linha">
        <div className="coluna">
          <ul className="elenco">
            {LABORATORIOS.map(([lab, empresa]) => {
              const model = cast.find((competitor) => labOf(competitor) === lab);
              const ret = model ? returns.get(model.slug) : undefined;
              return (
                <li key={lab}>
                  <span aria-hidden="true" data-lab={lab} className="logo size-12" />
                  {/* a célula é lugar apertado (docs/DESIGN.md): o nome curto, sem o sufixo de versão do fim ("DeepSeek V4 Pro (0813)"),
                      que fica na arena e na página do modelo (competidor.tsx, partesDoNome) */}
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[0.9375rem] font-semibold text-ink">
                      {model ? partesDoNome(model.name).curto : empresa}
                    </span>
                    {model ? <span className="text-muted">{empresa}</span> : null}
                  </span>
                  {ret === undefined ? null : (
                    <span data-dir={direction(ret)} className="text-sm text-ink">
                      {formatBps(ret)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
