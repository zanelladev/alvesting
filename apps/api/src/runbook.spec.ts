import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from './common/audit.js';
import { ALERT_SIGNAL } from './telemetry/alert-logs.js';

// O runbook (docs/RUNBOOK.md) diz o que fazer quando cada alerta da infra chega e o que conferir depois de cada ação de admin que grava a
// trilha. Este teste lê os dois lados: os sinais (ALERT_SIGNAL), as ações (AUDIT_ACTIONS) e os nomes que o Bicep dá aos alertas e ao
// orçamento. Cada um tem de aparecer, entre crases, numa seção de procedimento numerada ("## 3. ..."). O índice do topo não conta: é o mapa,
// e não a resposta. Alerta, sinal ou ação novo sem seção reprova aqui, e a seção entra no mesmo PR.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const runbook = read('../../../docs/RUNBOOK.md');
const sections = runbook
  .split(/^## /m)
  .slice(1)
  .map((text) => ({ title: text.split('\n', 1)[0] ?? '', body: text }));
const procedures = sections.filter((section) => /^\d+\. /.test(section.title));
const covers = (id: string) => procedures.some((section) => section.body.includes(`\`${id}\``));

const namesIn = (rel: string) =>
  [...read(rel).matchAll(/name: '((?:alvesting|budget)-[a-z0-9-]+)'/g)].map((match) => match[1]!);
const alertRules = [
  ...namesIn('../../../infra/modules/alerts.bicep'),
  ...namesIn('../../../infra/modules/budget.bicep'),
];
const actions: readonly string[] = Object.values(AUDIT_ACTIONS);
const signals: readonly string[] = Object.values(ALERT_SIGNAL);

describe('docs/RUNBOOK.md cobre os alertas, os sinais e as ações de auditoria', () => {
  it('tem o índice e as seções de procedimento numeradas', () => {
    expect(sections.some((section) => section.title === 'Índice')).toBe(true);
    expect(procedures.length).toBeGreaterThanOrEqual(10);
  });

  it('leu os alertas do Bicep, os sinais e as ações do código (a leitura não ficou vazia)', () => {
    expect(alertRules.length).toBeGreaterThanOrEqual(8);
    expect(signals).toHaveLength(11);
    expect(actions.length).toBeGreaterThanOrEqual(11);
  });

  it.each(alertRules)('o alerta ou orçamento %s tem seção de procedimento', (rule) => {
    expect(covers(rule)).toBe(true);
  });

  it.each(signals)('o sinal %s da regra de log tem seção de procedimento', (signal) => {
    expect(covers(signal)).toBe(true);
  });

  it.each(actions)('a ação %s do audit_log tem seção de procedimento', (action) => {
    expect(covers(action)).toBe(true);
  });

  it.each(procedures.map((section) => section.title))(
    'a seção "%s" traz a marca de não ensaiado',
    (title) => {
      const section = procedures.find((candidate) => candidate.title === title);
      expect(section?.body).toMatch(/não ensaiado/i);
    },
  );

  // Ação gravada com texto solto escapa do teste acima. Este varre o código da api (sem os specs e o Prisma gerado) e confere que toda
  // ação com prefixo de trilha (admin., account., corporate_event.) está em AUDIT_ACTIONS, e que toda entrada de AUDIT_ACTIONS aparece.
  // ponytail: a varredura é por texto e só enxerga esses três prefixos. Ação com outro prefixo escapa: o teto é este, e o caminho é ler a
  // AST do TypeScript (o compilador já está na dependência) quando a trilha ganhar outro prefixo.
  it('toda ação gravada passa por AUDIT_ACTIONS (e a varredura acha cada uma delas)', () => {
    const src = new URL('.', import.meta.url);
    const literal = /'((?:admin|account|corporate_event)\.[a-z_.]+)'/g;
    const found = new Set<string>();
    const files = readdirSync(src, { recursive: true, withFileTypes: true }).filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.parentPath.includes('generated'),
    );
    for (const entry of files) {
      const text = readFileSync(join(entry.parentPath, entry.name), 'utf8');
      for (const match of text.matchAll(literal)) found.add(match[1]!);
    }
    expect([...found].filter((action) => !actions.includes(action))).toEqual([]);
    expect(actions.filter((action) => !found.has(action))).toEqual([]);
  });
});
