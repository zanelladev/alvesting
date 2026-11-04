// O universo da arena (plano, seção 2): até 500 ações por volume financeiro médio dos últimos 60 pregões, com
// presença em pelo menos 90% deles. Aqui só a regra, sobre números já somados; a soma sai do banco.
export const UNIVERSE_RULES = { maxMembers: 500, windowDays: 60, minPresencePercent: 90 } as const;

export interface VolumeStat {
  instrumentId: string;
  ticker: string;
  // soma do volume financeiro dos pregões da janela em que o papel negociou, em centavos (estimado: quantidade x fechamento, DADOS.md, seção 4)
  totalVolumeCents: bigint;
  // em quantos pregões da janela o papel negociou
  presenceDays: number;
}

export interface UniverseMemberDraft {
  instrumentId: string;
  ticker: string;
  position: number; // 1 = maior volume médio
  avgVolumeCents: bigint;
  presenceDays: number;
}

export interface UniverseSelection {
  candidates: number; // papéis com algum negócio na janela
  eligible: number; // passaram na presença, antes do corte em 500
  members: UniverseMemberDraft[];
}

export function selectUniverse(
  stats: VolumeStat[],
  windowDays: number,
  rules: typeof UNIVERSE_RULES = UNIVERSE_RULES,
): UniverseSelection {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new RangeError(`janela de ${windowDays} pregões não existe`);
  }
  for (const s of stats) {
    if (s.presenceDays < 1 || s.presenceDays > windowDays) {
      throw new RangeError(
        `${s.ticker}: presença de ${s.presenceDays} dias numa janela de ${windowDays}`,
      );
    }
    if (s.totalVolumeCents < 0n) throw new RangeError(`${s.ticker}: volume negativo`);
  }
  // Inteiros, sem ponto flutuante: 54 de 60 passa, 53 de 60 não.
  const eligible = stats.filter(
    (s) => s.presenceDays * 100 >= windowDays * rules.minPresencePercent,
  );
  const ranked = [...eligible].sort((a, b) => {
    if (a.totalVolumeCents !== b.totalVolumeCents)
      return a.totalVolumeCents > b.totalVolumeCents ? -1 : 1;
    return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0; // desempate fixo
  });
  return {
    candidates: stats.length,
    eligible: eligible.length,
    members: ranked.slice(0, rules.maxMembers).map((s, index) => ({
      instrumentId: s.instrumentId,
      ticker: s.ticker,
      position: index + 1,
      // dia sem negócio conta como zero: a média é sobre todos os pregões da janela
      avgVolumeCents: s.totalVolumeCents / BigInt(windowDays),
      presenceDays: s.presenceDays,
    })),
  };
}
