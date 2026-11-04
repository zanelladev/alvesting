import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../configure-app.js';
import { HealthModule } from './health.module.js';

// Servidor de verdade (porta efêmera): o supertest bufferiza a resposta e esconderia o espaçamento.
let app: INestApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { frontDoorId: 'c0ffee00-1234-4abc-8def-0123456789ab' });
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app.close();
});

type Arrival = { at: number; data: unknown };

// Lê o corpo SSE e devolve cada evento com a hora de chegada do pedaço que o trouxe.
async function readStream(response: Response): Promise<Arrival[]> {
  const arrivals: Arrival[] = [];
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const at = performance.now();
    pending += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = pending.indexOf('\n\n')) !== -1) {
      const block = pending.slice(0, end);
      pending = pending.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (data) arrivals.push({ at, data: JSON.parse(data) as unknown });
    }
  }
  return arrivals;
}

describe('GET /api/v1/health/stream', () => {
  it('manda 5 eventos, um por segundo, sem embrulhar no envelope', async () => {
    const response = await fetch(`${base}/api/v1/health/stream`, {
      headers: { 'X-Azure-FDID': 'c0ffee00-1234-4abc-8def-0123456789ab' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    // O Front Door e qualquer proxy no caminho não podem guardar nem transformar a resposta.
    expect(response.headers.get('cache-control')).toMatch(/no-cache/);
    expect(response.headers.get('cache-control')).toMatch(/no-transform/);

    const events = await readStream(response);

    expect(events).toHaveLength(5);
    expect(events.map((e) => (e.data as { seq: number }).seq)).toEqual([1, 2, 3, 4, 5]);
    for (const event of events) {
      const data = event.data as { seq: number; of: number; at: string };
      expect(Object.keys(data).sort()).toEqual(['at', 'of', 'seq']);
      expect(data.of).toBe(5);
      expect(Number.isNaN(Date.parse(data.at))).toBe(false);
    }

    // Chegaram espaçados (cerca de 1 s entre um e outro), não de uma vez.
    for (let i = 1; i < events.length; i++) {
      const gap = events[i]!.at - events[i - 1]!.at;
      expect(gap, `intervalo ${i}`).toBeGreaterThan(700);
      expect(gap, `intervalo ${i}`).toBeLessThan(1700);
    }
  }, 15_000);

  it('o primeiro evento sai logo, antes de o stream terminar', async () => {
    const started = performance.now();
    const response = await fetch(`${base}/api/v1/health/stream`, {
      headers: { 'X-Azure-FDID': 'c0ffee00-1234-4abc-8def-0123456789ab' },
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    // O Nest abre o stream com uma linha em branco; o evento vem logo em seguida.
    let text = '';
    while (!text.includes('"seq":1')) {
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      text += decoder.decode(chunk.value, { stream: true });
    }
    expect(performance.now() - started).toBeLessThan(800);
    await reader.cancel();
  });

  it('atrás da trava de origem, sem o cabeçalho é 403 (só o /health é isento)', async () => {
    const response = await fetch(`${base}/api/v1/health/stream`);
    expect(response.status).toBe(403);
  });
});
