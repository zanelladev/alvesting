import type { DropReason, HoldReason, LlmApplied, LlmUsage } from '@alvesting/contracts';

// O que a decisão de um modelo grava (tabelas decision e decision_item). Já passou pelo schema, pela validação do domínio e
// pelo filtro de vazamento: nada aqui carrega o texto do prompt.

export interface ItemRecord {
  // posição do item na lista que o modelo devolveu
  position: number;
  action: 'BUY' | 'SELL' | 'HOLD' | null;
  ticker: string | null;
  // BUY: % do patrimônio; SELL: % da posição; HOLD: nulo
  percent: number | null;
  confidence: number | null;
  // nulo no descartado: o texto de um item descartado não é guardado
  rationale: string | null;
  dropped: boolean;
  dropReason: DropReason | null;
  dropDetail: string | null;
}

export type MarketViewValue = 'otimista' | 'pessimista' | 'neutro';

export interface DecisionRecord {
  cycleId: string;
  competitorId: string;
  status: 'DECIDED' | 'FORCED_HOLD';
  holdReason: HoldReason | null;
  marketView: MarketViewValue | null;
  summary: string | null;
  usage: LlmUsage | null;
  // micro-dólares, somando as chamadas (a original e o reparo)
  costMicroUsd: bigint;
  applied: LlmApplied | null;
  inputSha256: string | null;
  outputSha256: string | null;
  metaSha256: string | null;
  ioUris: Record<string, string> | null;
  // os campos de texto público em que o filtro achou trecho do prompt (só o nome do campo)
  leakFields: string[];
  items: ItemRecord[];
}

// O HOLD que o sistema impôs, sem chamada de modelo (prazo, prompt divergente, falha, varredura): sem resumo, sem visão de
// mercado e sem itens. Quando houve chamada e a resposta não serviu (resposta_invalida), quem chama acrescenta o uso e o IO.
export function forcedHold(
  cycleId: string,
  competitorId: string,
  holdReason: HoldReason,
  extra: Partial<DecisionRecord> = {},
): DecisionRecord {
  return {
    cycleId,
    competitorId,
    status: 'FORCED_HOLD',
    holdReason,
    marketView: null,
    summary: null,
    usage: null,
    costMicroUsd: 0n,
    applied: null,
    inputSha256: null,
    outputSha256: null,
    metaSha256: null,
    ioUris: null,
    leakFields: [],
    items: [],
    ...extra,
  };
}
