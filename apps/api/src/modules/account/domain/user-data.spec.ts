import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cascadeViolations,
  dataColumns,
  looseUserKeys,
  parseSchema,
  userOwnedModels,
} from '../testing/prisma-schema.fixture.js';
import { EXPORTED_MODELS, NEVER_EXPORTED, USER_EXPORT_COLUMNS } from './user-data.js';

// Os invariantes que protegem a carteira (etapa 12, já dentro) e as conversas (etapa 13) desde já. Quem adicionar um modelo ligado ao
// usuário sem `onDelete: Cascade`, ou sem colocá-lo no JSON de exportação, reprova aqui: "excluir a conta apaga tudo" e "exportar leva
// tudo" deixam de depender de alguém lembrar. O leitor do schema (testing/prisma-schema.fixture.ts) segue as relações até o User, então
// a linha da carteira (que chega ao usuário pela carteira) e a mensagem do chat (pela conversa) entram na conta.
const schema = readFileSync(new URL('../../../../prisma/schema.prisma', import.meta.url), 'utf8');
const models = parseSchema(schema);
const owned = userOwnedModels(models);
const columnsOf = (name: string) => dataColumns(models, name, owned);

describe('o schema do Prisma de verdade', () => {
  it('o leitor acha os modelos da conta (se achasse menos, os testes abaixo passariam à toa)', () => {
    expect([...owned].sort()).toEqual([
      'Account',
      'Consent',
      'Portfolio',
      'PortfolioLot',
      'Session',
      'User',
    ]);
    // o mesmo número de blocos `model X {` que o arquivo tem, contados por fora do leitor
    expect(models.length).toBe((schema.match(/^model \w+ \{$/gm) ?? []).length);
    expect(models.length).toBeGreaterThan(25);
  });

  it('todo modelo ligado ao usuário apaga junto com ele (onDelete: Cascade)', () => {
    expect(cascadeViolations(models, owned)).toEqual([]);
  });

  it('nenhum modelo fora do usuário guarda um "userId" solto (sem relação, não apagaria nem exportaria)', () => {
    expect(looseUserKeys(models, owned)).toEqual([]);
  });

  it('todo modelo ligado ao usuário está no JSON de exportação, e só os que existem', () => {
    const exported = Object.keys(EXPORTED_MODELS).sort();
    expect(exported).toEqual([...owned].filter((m) => m !== 'User').sort());
    for (const name of exported) expect(models.map((m) => m.name)).toContain(name);
  });

  it.each(['User', ...Object.keys(EXPORTED_MODELS)])(
    '%s: cada coluna sai no export ou está declarada como segredo que nunca sai, e as duas listas não se cruzam',
    (name) => {
      const selected = Object.keys(
        name === 'User' ? USER_EXPORT_COLUMNS : EXPORTED_MODELS[name]!.select,
      );
      const secret = Object.keys(NEVER_EXPORTED[name] ?? {});
      const columns = columnsOf(name);

      expect(selected.filter((c) => secret.includes(c))).toEqual([]);
      expect([...selected, ...secret].sort()).toEqual([...columns].sort());
    },
  );

  it('os segredos conhecidos estão do lado de fora do export, cada um com o motivo', () => {
    for (const [model, column] of [
      ['Session', 'token'],
      ['Account', 'password'],
      ['Account', 'accessToken'],
      ['Account', 'refreshToken'],
      ['Account', 'idToken'],
    ] as const) {
      expect(NEVER_EXPORTED[model]?.[column], `${model}.${column}`).toMatch(/\S{10}/);
      expect(Object.keys(EXPORTED_MODELS[model]!.select)).not.toContain(column);
    }
  });

  it('o aceite é um histórico que não se reescreve: nada nele muda depois de gravado', () => {
    expect(columnsOf('Consent')).toEqual(
      expect.arrayContaining(['id', 'document', 'version', 'sha256', 'acceptedAt']),
    );
    expect(columnsOf('Consent')).not.toContain('updatedAt');
  });
});

describe('as regras pegam os modelos que a etapa 13 vai trazer (schema sintético)', () => {
  const future = parseSchema(`
model User {
  id String @id
  threads ChatThread[]
}
model ChatThread {
  id     String @id
  userId String
  user   User   @relation(fields: [userId], references: [id])
  messages ChatMessage[]
}
model ChatMessage {
  id       String     @id
  threadId String
  thread   ChatThread @relation(fields: [threadId], references: [id], onDelete: Restrict)
  body     String
}
model Note {
  id       String @id
  threadId String
  thread   ChatThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
}
model NewsItem {
  id String @id
}
`);
  const futureOwned = userOwnedModels(future);

  it('segue as relações até o usuário, direto ou por outro modelo do usuário, e ignora o resto', () => {
    expect([...futureOwned].sort()).toEqual(['ChatMessage', 'ChatThread', 'Note', 'User']);
  });

  it('reprova a relação sem onDelete: Cascade, também a que chega ao usuário por outro modelo', () => {
    expect(cascadeViolations(future, futureOwned)).toEqual([
      'ChatThread.user -> User',
      'ChatMessage.thread -> ChatThread',
    ]);
  });

  it('reprova o modelo do usuário que fica fora do export', () => {
    const missing = [...futureOwned].filter((m) => m !== 'User' && !(m in EXPORTED_MODELS)).sort();
    expect(missing).toEqual(['ChatMessage', 'ChatThread', 'Note']);
  });

  it('reprova o campo userId solto, sem @relation, que o leitor de relações não enxerga', () => {
    const loose = parseSchema(`
model User {
  id String @id
}
model Note {
  id     String @id
  userId String
}
model Other {
  id      String @id
  user_id String
}
`);
    expect([...userOwnedModels(loose)]).toEqual(['User']);
    expect(looseUserKeys(loose, userOwnedModels(loose))).toEqual(['Note.userId', 'Other.user_id']);
  });

  it('a coluna nova de um modelo do usuário também precisa de decisão (sai ou é segredo)', () => {
    expect(dataColumns(future, 'ChatMessage', futureOwned)).toEqual(['id', 'body']);
  });
});
