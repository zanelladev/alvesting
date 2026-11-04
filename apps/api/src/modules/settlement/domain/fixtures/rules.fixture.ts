// As regras de ações do plano (§2) para os testes: 0,03% por operação (3 pontos-base) e até 10 posições. Na liquidação de
// verdade os dois valores vêm dos parâmetros da temporada (season.params: tradeCostBps e maxPositions), e o domínio os
// recebe sem valor padrão. Só os testes importam este arquivo (fica fora do build, ver tsconfig.build.json).
import type { SettlementRules } from '../portfolio.js';

export const PLAN_RULES: SettlementRules = { tradeCostBps: 3n, maxPositions: 10 };
