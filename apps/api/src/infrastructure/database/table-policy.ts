// A classificação, escrita à mão, de TODA tabela do banco (o schema.prisma): (1) o que o login da api pode fazer nela e (2) se ela guarda
// dado pessoal. É a fonte única das duas decisões:
//
//  - o papel mínimo do Postgres para a api (onda 3d, ADR 0028): a migration `20261103100000_api_role` dá ao papel de grupo exatamente o
//    que está em `api`, tabela por tabela, e o `api-role.integration.spec.ts` compara o catálogo do banco com esta matriz (migration que
//    divergir daqui reprova). Sem ALTER DEFAULT PRIVILEGES: tabela nova nasce sem nenhum privilégio para a api e sem decisão aqui, e o
//    `table-policy.spec.ts` reprova até alguém classificá-la. O privilégio diz o que a api toca; o ESTADO em que ela escreve (só o rascunho da
//    temporada, só reabrir a liquidação...) é de um gatilho que vale só para o login dela (migration `20261103120000_api_role_guards`),
//    e a coluna `guard` diz qual;
//  - o backup-verify (`modules/maintenance`): o dump fica até 12 meses e a política de privacidade promete cópia com dado pessoal só pelo
//    ponto de restauração de 7 dias. Então o dump leva o esquema de todas as tabelas, mas NÃO os dados das `personal` (`personalTables`).
//
// A carteira (etapa 12, migration `20261103130000_portfolio`) já está aqui; o chat (etapa 13) entra com a migration dele: o teste reprova o
// modelo ligado ao usuário que não estiver como pessoal. Workers, decisões e agendadores seguem com o login administrador nesta onda (não
// são expostos à internet).
// ponytail: o login administrador deles é dono das tabelas e poderia mudar o desenho do banco. Teto: um RCE no worker ou nas decisões
// (código com dependências de terceiros, mas sem entrada da internet). Próximo passo: um segundo papel de grupo, de escrita sem DDL,
// com a mesma matriz (uma coluna `worker` ao lado de `api`) e a database-url deles trocada; as migrations seguem com o administrador.

// O papel de grupo (sem login) que recebe os privilégios, e o login da api que é membro dele. Os nomes moram aqui, na migration e no
// comando de provisionamento (api-login.ts); o teste de catálogo prova que os três falam do mesmo papel.
export const API_GROUP_ROLE = 'alvesting_api_group';
export const API_LOGIN = 'alvesting_api';

export type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export interface TablePolicy {
  // guarda dado pessoal (LGPD): o dump do backup-verify leva o esquema e não os dados
  personal: boolean;
  // o que o login da api faz na tabela INTEIRA; vazio = nada (a tabela nem é lida pela api)
  api: readonly Privilege[];
  // privilégio só em COLUNAS (GRANT INSERT (a, b) ON t): a tabela inteira não o tem, e a api só nomeia estas colunas no comando. Quem não
  // está aqui nem em `api` não o tem em coluna nenhuma
  apiColumns?: Readonly<Partial<Record<'INSERT' | 'UPDATE', readonly string[]>>>;
  // o gatilho `BEFORE` (só para o login da api) que restringe o ESTADO em que ela escreve na tabela: o privilégio sozinho deixaria a api mudar
  // o que as rotas de admin recusam em código. Cada gatilho `*_api_guard` do banco tem de estar aqui, e vice-versa
  guard?: string;
  // o porquê, para quem revisa: de onde no código vem cada privilégio
  why: string;
}

const none = [] as const;

export const TABLE_POLICY: Readonly<Record<string, TablePolicy>> = {
  // --- Conta (etapa 11): o Better Auth e a exclusão da conta rodam na api ---------------------------------------------------------
  user: {
    personal: true,
    api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    why: 'Better Auth (cadastro, login, verificação) e a exclusão da conta pelo dono (DELETE /me)',
  },
  session: {
    personal: true,
    api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    why: 'Better Auth (a sessão é criada, renovada e encerrada); a cascata do usuário também apaga',
  },
  account: {
    personal: true,
    api: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    why: 'Better Auth (senha, Google); o account:promote e a redefinição de senha mexem na linha',
  },
  verification: {
    personal: true,
    api: ['SELECT', 'INSERT', 'DELETE'],
    why: 'Better Auth (pedidos de uso único: redefinição de senha, estado do Google): cria, procura e consome (DELETE); o UPDATE é só dos plugins email-otp e siwe, que não estão ligados. A exclusão da conta também apaga',
  },
  consent: {
    personal: true,
    api: ['SELECT', 'INSERT'],
    why: 'histórico de aceite que não se reescreve: sem UPDATE nem DELETE direto (o DELETE vem da cascata do usuário, que roda como dono da tabela)',
  },
  audit_log: {
    personal: false,
    api: ['INSERT'],
    why: 'trilha só de acréscimo: a api grava (admin, exclusão de conta) e nunca lê, muda nem apaga. Só ULID, sem nome nem e-mail, e a política mantém a linha depois da exclusão',
  },

  // --- Carteira (etapa 12): as rotas /me/portfolio rodam na api ---------------------------------------------------------------------
  portfolio: {
    personal: true,
    api: ['SELECT', 'INSERT'],
    why: 'a carteira de cada usuário: o POST /me/portfolio/lots cria a linha no primeiro lançamento (INSERT) e as rotas a leem (SELECT). A linha nunca muda e não sai por DELETE direto: some junto com a conta, pela cascata do usuário (que o Postgres executa como dono da tabela, como em consent)',
  },
  portfolio_lot: {
    personal: true,
    api: ['SELECT', 'INSERT', 'DELETE'],
    apiColumns: { UPDATE: ['ticker', 'quantity', 'cost_cents', 'bought_on', 'updated_at'] },
    guard: 'portfolio_lot_api_guard',
    why: 'GET, POST e DELETE de /me/portfolio/lots; o PATCH troca o lançamento inteiro, então o UPDATE é só destas colunas (a carteira dona e a data de criação nunca mudam). O gatilho limita a carteira a 200 lançamentos, sob trava: dois POST juntos não passam do teto',
  },

  // --- Operação ------------------------------------------------------------------------------------------------------------------
  job_run: {
    personal: false,
    api: ['SELECT', 'UPDATE'],
    guard: 'job_run_api_guard',
    why: 'o painel /admin lê; o evento corporativo reabre o settle (UPDATE para FAILED). O gatilho limita o UPDATE da api a isso: só a linha `settle`, só para FAILED, só status, erro e hora. Quem cria e apaga linha são os workers',
  },
  fetch_state: {
    personal: false,
    api: ['SELECT'],
    why: 'o painel /admin mostra a última conferência de cada arquivo da CVM',
  },

  // --- Temporada e elenco: o admin cria, edita o rascunho e inicia ---------------------------------------------------------------
  season: {
    personal: false,
    api: ['SELECT', 'INSERT', 'UPDATE'],
    guard: 'season_api_guard',
    why: 'POST e PATCH /admin/seasons (criar, editar o rascunho, iniciar); a API pública lê. O gatilho só deixa a api criar em rascunho (sem o prompt fixado, prompt_sha256, que é do arena:retroativo) e editar (nome, parâmetros) e iniciar o RASCUNHO: temporada em andamento ou encerrada não muda, como o 409 SEASON_LOCKED',
  },
  competitor: {
    personal: false,
    api: ['SELECT', 'INSERT', 'DELETE'],
    guard: 'competitor_api_guard',
    why: 'editar o rascunho troca o elenco inteiro (apaga e recria); a API pública lê. O gatilho só deixa a api mexer no elenco enquanto a temporada é rascunho',
  },
  prompt_version: {
    personal: false,
    api: ['SELECT'],
    apiColumns: { INSERT: ['id', 'version', 'created_at'] },
    why: 'o reprocesso do ciclo fixa a versão do prompt (só a versão, nunca o texto): o INSERT é só de id, version e created_at. O SHA-256 e a hora do registro são gravados pelo job de decisões (registerPromptSha256): com a tabela inteira a api forjava o compromisso',
  },
  cycle: {
    personal: false,
    api: ['SELECT', 'INSERT'],
    apiColumns: { UPDATE: ['status', 'skip_reason', 'briefing_id', 'prompt_version_id'] },
    guard: 'cycle_api_guard',
    why: 'o reprocesso do ciclo cria o ciclo e reavalia o pulado; a API pública lê (o modo e a hora real inclusive). O UPDATE é só das quatro colunas que o reprocesso reavalia; o INSERT é da tabela inteira porque o Prisma 7 nomeia toda coluna com padrão (migration 20261106120000_retroactive_cycles). O gatilho só deixa a api criar ciclo aberto ou pulado, AO_VIVO, de temporada em andamento, com a hora real do banco, e reavaliar o PULADO: data, temporada, prazo, modo e hora real nunca mudam',
  },
  corporate_event: {
    personal: false,
    api: ['SELECT', 'INSERT', 'UPDATE'],
    why: 'POST /admin/corporate-events registra e corrige o fator; a reliquidação é do worker (a api só enfileira)',
  },

  // --- Resultado da arena: só leitura para a api (quem decide é o job de decisões, quem liquida é o worker) ----------------------
  decision: {
    personal: false,
    api: ['SELECT'],
    why: 'o feed e o ciclo públicos leem; a decisão é gravada pelo job de decisões',
  },
  decision_item: {
    personal: false,
    api: ['SELECT'],
    why: 'o feed, o ciclo e a página da ação leem; gravado pelo job de decisões',
  },
  order: {
    personal: false,
    api: none,
    why: 'nenhuma rota da api lê ordem; a liquidação do worker a refaz',
  },
  fill: {
    personal: false,
    api: none,
    why: 'nenhuma rota da api lê execução; a liquidação do worker a refaz',
  },
  position: {
    personal: false,
    api: ['SELECT'],
    why: 'a carteira do competidor e "quem tem a ação" leem; a liquidação do worker a refaz',
  },
  equity_snapshot: {
    personal: false,
    api: ['SELECT'],
    why: 'o ranking e a série de patrimônio leem; a liquidação do worker a refaz',
  },
  season_stat: {
    personal: false,
    api: ['SELECT'],
    why: 'o ranking lê; a liquidação do worker a refaz',
  },
  random_baseline: {
    personal: false,
    api: ['SELECT'],
    why: 'a faixa do Monte Carlo lê; a liquidação do worker a refaz',
  },

  // --- Mercado, notícias e briefing: dado público que os workers gravam -----------------------------------------------------------
  instrument: {
    personal: false,
    api: ['SELECT'],
    why: 'a busca e a página da ação leem; o eod do worker grava',
  },
  daily_bar: {
    personal: false,
    api: ['SELECT'],
    why: 'a página da ação e o macro (BOVA11) leem; o eod do worker grava',
  },
  instrument_logo: {
    personal: false,
    api: ['SELECT'],
    why: 'a rota interna dos logos (GET /interno/logos/:ticker) lê o SVG guardado; a atualização semanal do worker e o market:logos gravam (migration 20261105120000_instrument_logo, ADR 0036)',
  },
  trading_day: {
    personal: false,
    api: none,
    why: 'a api consulta o calendário de feriados do código, não esta tabela',
  },
  universe_snapshot: {
    personal: false,
    api: ['SELECT'],
    why: 'a fita da home (GET /interno/fita) acha o universo da semana do último ciclo; o worker o congela (migration 20261104120000_api_role_universe_read)',
  },
  universe_member: {
    personal: false,
    api: ['SELECT'],
    why: 'a fita da home (GET /interno/fita) lê os papéis do universo, na ordem dele; o worker os congela (migration 20261104120000_api_role_universe_read)',
  },
  news_item: {
    personal: false,
    api: ['SELECT'],
    why: 'a lista de notícias e a página da ação leem (título, fonte, hora e link; nunca o trecho); o fetch do worker grava',
  },
  macro_daily: {
    personal: false,
    api: ['SELECT'],
    why: 'a home lê o macro (CDI, Selic, IPCA, dólar); o fetch do worker grava',
  },
  briefing: {
    personal: false,
    api: ['SELECT'],
    why: 'o ciclo público mostra o SHA-256 do briefing e o reprocesso confere que ele existe; o freeze do worker grava',
  },
};

export const POLICY_TABLES: readonly string[] = Object.keys(TABLE_POLICY);

// As tabelas cujo dado o dump do backup-verify não leva (só o esquema), em ordem estável.
export const personalTables = (): string[] =>
  POLICY_TABLES.filter((table) => TABLE_POLICY[table]!.personal).sort();

// O que a matriz e o schema não combinam: tabela do schema sem decisão (`missing`) e decisão de uma tabela que não existe mais (`extra`).
export function policyGaps(
  tables: readonly string[],
  policy: Readonly<Record<string, TablePolicy>> = TABLE_POLICY,
): { missing: string[]; extra: string[] } {
  const known = new Set(Object.keys(policy));
  const present = new Set(tables);
  return {
    missing: tables.filter((table) => !known.has(table)),
    extra: [...known].filter((table) => !present.has(table)),
  };
}
