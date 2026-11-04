import { queueMessageSchema } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { NEWS_SOURCES, excerptAllowed, sourceById, sourceName } from './sources.js';

// A lista fixa de fontes é o único lugar de onde sai URL para o worker buscar: nenhuma URL vem de mensagem, de
// banco ou de variável de ambiente.

describe('NEWS_SOURCES', () => {
  it('tem de 3 a 5 feeds RSS, a CVM e o BCB', () => {
    const rss = NEWS_SOURCES.filter((s) => s.kind === 'rss');
    expect(rss.length).toBeGreaterThanOrEqual(3);
    expect(rss.length).toBeLessThanOrEqual(5);
    expect(NEWS_SOURCES.filter((s) => s.kind === 'cvm').map((s) => s.id)).toEqual(['cvm-ipe']);
    expect(NEWS_SOURCES.filter((s) => s.kind === 'bcb').map((s) => s.id)).toEqual(['bcb-sgs']);
  });

  it('os ids são únicos e valem como fonte na mensagem fetch da fila', () => {
    expect(new Set(NEWS_SOURCES.map((s) => s.id)).size).toBe(NEWS_SOURCES.length);
    for (const source of NEWS_SOURCES) {
      const parsed = queueMessageSchema.safeParse({
        type: 'fetch',
        source: source.id,
        slot: '2026-11-01T12:00:00Z',
      });
      expect(parsed.success, source.id).toBe(true);
    }
  });

  it('todo feed é https, sem usuário, sem fragmento e com o host na própria URL', () => {
    for (const source of NEWS_SOURCES) {
      if (source.kind !== 'rss') continue;
      const url = new URL(source.url);
      expect(url.protocol, source.id).toBe('https:');
      expect(url.username + url.password + url.hash, source.id).toBe('');
      expect(url.hostname, source.id).not.toBe('');
    }
  });

  it('todo item tem nome para mostrar', () => {
    for (const source of NEWS_SOURCES) expect(source.name.trim(), source.id).not.toBe('');
  });
});

// Termos de uso lidos em 01/11/2026 (DADOS.md, seção 13): só a Agência Brasil autoriza reproduzir com a fonte. Mudar um
// destes valores é decisão com autorização por escrito, não ajuste de código.
describe('excerptAllowed: o trecho só vai ao provedor da LLM se os termos da fonte deixam', () => {
  it('RSS: só a Agência Brasil', () => {
    const allowed = NEWS_SOURCES.filter((s) => s.kind === 'rss' && excerptAllowed(s.id)).map(
      (s) => s.id,
    );
    expect(allowed).toEqual(['agencia-brasil']);
    for (const id of ['infomoney', 'money-times', 'seu-dinheiro']) {
      expect(excerptAllowed(id), id).toBe(false);
    }
  });

  it('CVM: sim (é o tipo do documento, dado aberto)', () => {
    expect(excerptAllowed('cvm-ipe')).toBe(true);
  });

  it('o que não está na lista não leva: nem fonte que saiu, nem o BCB, nem nome de protótipo', () => {
    for (const id of ['fonte-antiga', 'bcb-sgs', 'constructor', '__proto__', '']) {
      expect(excerptAllowed(id), id).toBe(false);
    }
  });
});

describe('sourceById e sourceName', () => {
  it('acha pelo id e devolve nada para o que não está na lista', () => {
    expect(sourceById('cvm-ipe')?.kind).toBe('cvm');
    expect(sourceById('desconhecida')).toBeUndefined();
    expect(sourceById('constructor')).toBeUndefined();
    expect(sourceById('__proto__')).toBeUndefined();
  });

  it('o nome é o da lista, e a fonte que saiu da lista aparece pelo id', () => {
    expect(sourceName('cvm-ipe')).toBe(sourceById('cvm-ipe')?.name);
    expect(sourceName('fonte-antiga')).toBe('fonte-antiga');
  });
});
