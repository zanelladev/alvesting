// Leitor mínimo do schema.prisma, só para os testes de invariantes da conta (domain/user-data.spec.ts). Não é um parser do Prisma:
// lê o formato que este repositório usa (um campo por linha, @relation numa linha só).
// ponytail: se o schema ganhar relação em várias linhas ou comentário de bloco, o teste que usa isto acusa (acha menos modelos do
// que deveria); a saída seria trocar por getDMMF do @prisma/internals.

export interface SchemaField {
  name: string;
  type: string;
  list: boolean;
  // as colunas locais da relação (@relation(fields: [...])): vazio se o campo não é o lado que guarda a chave
  relationFields: string[];
  onDelete?: string;
}

export interface SchemaModel {
  name: string;
  // a tabela do banco: o @@map("...") do modelo, ou o próprio nome dele sem o mapa (o Prisma faz o mesmo)
  table: string;
  fields: SchemaField[];
}

export function parseSchema(text: string): SchemaModel[] {
  const models: SchemaModel[] = [];
  let current: SchemaModel | undefined;
  let inBlock: 'model' | 'other' | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const open = /^(model|enum|generator|datasource)\s+(\w+)\s*\{$/.exec(line);
    if (open) {
      inBlock = open[1] === 'model' ? 'model' : 'other';
      current = inBlock === 'model' ? { name: open[2]!, table: open[2]!, fields: [] } : undefined;
      continue;
    }
    if (line === '}') {
      if (current) models.push(current);
      current = undefined;
      inBlock = undefined;
      continue;
    }
    const mapped = /^@@map\("([^"]+)"\)/.exec(line)?.[1];
    if (mapped && current) current.table = mapped;
    if (
      inBlock !== 'model' ||
      !current ||
      line === '' ||
      line.startsWith('//') ||
      line.startsWith('@@')
    )
      continue;
    const field = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
    if (!field) continue;
    const attrs = field[5] ?? '';
    const relation = /@relation\(([^)]*)\)/.exec(attrs)?.[1];
    const relationFields =
      relation === undefined
        ? []
        : (/fields:\s*\[([^\]]*)\]/.exec(relation)?.[1] ?? '')
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean);
    current.fields.push({
      name: field[1]!,
      type: field[2]!,
      list: field[3] !== undefined,
      relationFields,
      onDelete: relation === undefined ? undefined : /onDelete:\s*(\w+)/.exec(relation)?.[1],
    });
  }
  return models;
}

// Os modelos que pertencem ao usuário: o próprio User e qualquer um que o referencie, direta ou por outro modelo do usuário (a
// linha da carteira chega ao usuário pela carteira, a mensagem do chat pela conversa).
export function userOwnedModels(models: SchemaModel[], root = 'User'): Set<string> {
  const owned = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const model of models) {
      if (owned.has(model.name)) continue;
      if (model.fields.some((f) => f.relationFields.length > 0 && owned.has(f.type))) {
        owned.add(model.name);
        grew = true;
      }
    }
  }
  return owned;
}

// "Modelo.campo -> Alvo" de toda relação de um modelo do usuário com o dono que não apaga em cascata.
export function cascadeViolations(models: SchemaModel[], owned: Set<string>): string[] {
  return models
    .filter((m) => owned.has(m.name))
    .flatMap((m) =>
      m.fields
        .filter((f) => f.relationFields.length > 0 && owned.has(f.type) && f.onDelete !== 'Cascade')
        .map((f) => `${m.name}.${f.name} -> ${f.type}`),
    );
}

// As colunas de um modelo que são dado (sem as chaves que apontam para o dono nem os lados de relação).
export function dataColumns(models: SchemaModel[], name: string, owned: Set<string>): string[] {
  const model = models.find((m) => m.name === name);
  if (!model) return [];
  const isRelation = (type: string) => models.some((m) => m.name === type);
  const keys = new Set(
    model.fields.filter((f) => owned.has(f.type)).flatMap((f) => f.relationFields),
  );
  return model.fields.filter((f) => !isRelation(f.type) && !keys.has(f.name)).map((f) => f.name);
}

// "Modelo.campo" de todo campo com cara de chave do usuário (`userId`, `user_id`) num modelo que o leitor NÃO considera do usuário: um
// `userId String` sem @relation não é visto por userOwnedModels, então nem a cascata nem o export o pegariam.
export function looseUserKeys(models: SchemaModel[], owned: Set<string>): string[] {
  return models
    .filter((m) => !owned.has(m.name))
    .flatMap((m) =>
      m.fields.filter((f) => /^user_?id$/i.test(f.name)).map((f) => `${m.name}.${f.name}`),
    );
}
