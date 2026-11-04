import type { CycleView } from '@alvesting/contracts';
import { formatUsd } from '../domain/cost.js';

const brasiliaTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });

// O ciclo de um pregão em texto, para o comando cycle:show. Só o que o formato público (CycleView) traz: os hashes do prompt e do
// briefing, as decisões e os itens públicos. Nunca o prompt nem o IO bruto, que o formato nem carrega.
export function formatCycle(view: CycleView): string {
  const lines = [
    `Ciclo ${view.id} · temporada ${view.seasonId} · ${view.date} · ${view.status}` +
      (view.skipReason ? ` (pulado: ${view.skipReason})` : ''),
    `  decisão ${brasiliaTime(view.decisionAt)} · prazo ${brasiliaTime(view.deadlineAt)} (Brasília)` +
      (view.closedAt ? ` · fechado às ${brasiliaTime(view.closedAt)}` : ''),
    view.prompt
      ? `  prompt: versão ${view.prompt.version} · SHA-256 ${view.prompt.sha256 ?? 'ainda não registrado'}`
      : '  prompt: nenhum',
    view.briefing ? `  briefing: SHA-256 ${view.briefing.sha256}` : '  briefing: nenhum',
  ];
  if (view.decisions.length === 0) {
    lines.push('  nenhuma decisão');
    return lines.join('\n');
  }
  lines.push(
    '',
    '  competidor        resultado                 visão       ordens                  desc.  custo US$  chamadas',
  );
  for (const decision of view.decisions) {
    const count = (action: string) =>
      decision.items.filter((item) => item.action === action).length;
    const result =
      decision.status === 'FORCED_HOLD' ? `HOLD forçado: ${decision.holdReason}` : decision.status;
    const slug = decision.competitor.slug.padEnd(16);
    if (decision.status === 'FORCED_HOLD') {
      lines.push(`  ${slug}  ${result}`);
      continue;
    }
    lines.push(
      `  ${slug}  ${result.padEnd(24)}  ${(decision.marketView ?? '-').padEnd(10)}  ` +
        `${`BUY ${count('BUY')} · SELL ${count('SELL')} · HOLD ${count('HOLD')}`.padEnd(22)}  ` +
        `${String(decision.dropped.length).padEnd(5)}  ${formatUsd(BigInt(decision.costMicroUsd)).padEnd(9)}  ` +
        `${decision.usage?.calls ?? 0}`,
    );
  }
  return lines.join('\n');
}
