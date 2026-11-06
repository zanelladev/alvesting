'use client';

import { useState } from 'react';
// Só o tipo: este módulo vai ao navegador, e o índice do pacote de contratos leva o zod (CLAUDE.md; carteira-layout.spec.ts).
import type { Position } from '@alvesting/contracts';
import { formatBRL, formatBRLSigned, formatBps } from '../lib/format';
import { alocacao, type Fatia } from '../lib/wallet-client';
import { AnimatedCounter } from './arc/animated-counter/animated-counter';
import { Tooltip } from './arc/tooltip/tooltip';
import { DonutChart, DonutChartCenter, DonutChartLegend, DonutChartPlot } from './beui/donut-chart';
import { useHydrated } from './form-kit';
import { LogoDoPapel } from './logo-do-papel';

// As peças vivas da carteira (docs/TELAS.md, seção 9; ADR 0037), que o resumo e a tabela (wallet-panels.tsx, de servidor) põem como ilhas: o
// dinheiro no contador da Arc, a alocação na rosca da beUI e o termo com o tooltip da Arc. Nada anima na abertura da página: o contador só
// rola quando o número muda (o servidor refaz a página depois de lançar, editar ou apagar, e o número novo chega aqui), e a rosca sai do
// servidor já desenhada.

// ponytail: o contador desenha os algarismos de um número em reais (a Arc formata pelo Intl, em ponto flutuante), exato até 2^46 reais (o
// centavo dividido por 100 ainda arredonda certo); acima disso, uns R$ 70 trilhões, longe do teto da carteira, sai o texto parado. O que o
// leitor de tela lê é sempre o formatBRL, sem float. A saída, se um dia passar disso: um contador que receba os algarismos prontos.
const LIMITE_CENTS = 2 ** 46 * 100;

export function Dinheiro({ cents, sinal = false }: { cents: number; sinal?: boolean }) {
  const texto = sinal ? formatBRLSigned(cents) : formatBRL(cents);
  if (Math.abs(cents) >= LIMITE_CENTS) return <>{texto}</>;
  const prefixo = `${cents < 0 ? '-' : sinal && cents > 0 ? '+' : ''}R$\u00a0`;
  return (
    <>
      <span className="sr-only">{texto}</span>
      <span aria-hidden="true" data-contador="">
        <AnimatedCounter value={Math.abs(cents) / 100} decimals={2} prefix={prefixo} />
      </span>
    </>
  );
}

// O termo que pede explicação (o preço médio, o resultado, o valor total pago): o texto é o botão que abre o tooltip da Arc no hover e no
// foco do teclado (o leitor de tela ouve a explicação como a descrição dele). No toque o tooltip da Radix não abre: a mesma explicação está
// em texto na própria tela (o parágrafo das posições, a dica do campo). Nasce desativado, como todo botão da tela, até a hidratação.
export function Termo({ children, explicacao }: { children: string; explicacao: string }) {
  const hydrated = useHydrated();
  return (
    <Tooltip content={explicacao}>
      <button
        type="button"
        className="termo inline-flex min-h-11 items-center text-left"
        disabled={!hydrated}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const parte = (fatia: Fatia) => formatBps(fatia.shareBps, { signed: false });

// o centro da rosca: o valor que cabe no buraco, do maior para o menor tamanho de letra
const tamanhoDoValor = (cents: number) => {
  const length = formatBRL(cents).length;
  return length <= 13 ? 'text-15' : length <= 17 ? 'text-13' : 'text-11';
};

// A alocação (a rosca da beUI; lib/wallet-client.ts, `alocacao`): o valor de cada posição com fechamento, que é do dono (ADR 0033). No centro, o
// valor estimado e o número de ações; com uma fatia em foco (o ponteiro na fatia ou na linha da legenda, ou o foco do teclado na linha), o valor
// dela e a parte, no contador que rola. O clique numa linha fixa a fatia (`aria-pressed`), e outro clique a solta.
export function AlocacaoDaCarteira({
  positions,
  logos,
}: {
  positions: readonly Position[];
  // a versão do logo de cada ticker (lib/logos.ts, no servidor); sem ela, o monograma
  logos: Readonly<Record<string, string>>;
}) {
  const hydrated = useHydrated();
  const [hover, setHover] = useState<string | null>(null);
  const [fixada, setFixada] = useState<string | null>(null);
  const { totalCents, fatias } = alocacao(positions);
  if (fatias.length === 0) return null;
  const porId = new Map(fatias.map((fatia) => [fatia.id, fatia]));
  const acoes = positions.filter((p) => p.valueCents !== null && p.valueCents > 0).length;

  return (
    <section aria-labelledby="alocacao-titulo" className="space-y-3">
      <h3 id="alocacao-titulo" className="text-13 font-medium text-muted">
        Alocação
      </h3>
      <DonutChart
        segments={fatias.map((fatia) => ({
          id: fatia.id,
          name: fatia.nome,
          color: fatia.cor,
          value: fatia.valueCents,
        }))}
        label={`Alocação da carteira pelo valor estimado: ${fatias.map((f) => `${f.nome}, ${parte(f)}`).join('; ')}.`}
        activeId={hover ?? fixada}
        onActiveChange={setHover}
        onSelect={(id) => setFixada((atual) => (atual === id ? null : id))}
        selectedId={fixada}
        disabled={!hydrated}
        className="space-y-4"
      >
        <DonutChartPlot className="max-w-44 lg:max-w-48">
          <DonutChartCenter>
            {(segment) => {
              const fatia = segment ? porId.get(segment.id) : undefined;
              const cents = fatia ? fatia.valueCents : totalCents;
              return (
                <>
                  <p
                    className={`font-semibold whitespace-nowrap text-ink tabular-nums ${tamanhoDoValor(cents)}`}
                  >
                    <AnimatedCounter value={cents / 100} decimals={2} prefix={'R$\u00a0'} />
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {fatia
                      ? `${fatia.nome} · ${parte(fatia)}`
                      : `${acoes} ${acoes === 1 ? 'ação' : 'ações'}`}
                  </p>
                </>
              );
            }}
          </DonutChartCenter>
        </DonutChartPlot>
        <DonutChartLegend
          renderLabel={(segment) => {
            const fatia = porId.get(segment.id)!;
            return (
              <>
                {fatia.id === 'outras' ? (
                  <span
                    aria-hidden="true"
                    className="mr-3 size-4 shrink-0 rounded-full bg-surface-strong"
                  />
                ) : (
                  <LogoDoPapel ticker={fatia.id} versao={logos[fatia.id]} className="mr-3" />
                )}
                <span className="min-w-0 font-medium">{fatia.nome}</span>
              </>
            );
          }}
          renderValue={(segment) => {
            const fatia = porId.get(segment.id)!;
            return (
              <>
                <span className="font-medium">{parte(fatia)}</span>{' '}
                <span className="ml-1 text-muted">{formatBRL(fatia.valueCents)}</span>
              </>
            );
          }}
        />
      </DonutChart>
    </section>
  );
}
