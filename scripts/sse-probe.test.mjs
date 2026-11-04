import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import { classify, main, probe } from './sse-probe.mjs';

// Espaçamento curto para o teste ser rápido; o veredito é relativo ao espaçamento que o servidor informa.
const GAP = 200;

const quiet = { log: () => {}, error: () => {} };

// Eventos no formato do GET /api/v1/health/stream: { seq, of, at } com a hora em que o servidor os gerou.
const event = (seq, generatedAt) =>
  `data: ${JSON.stringify({ seq, of: 5, at: new Date(generatedAt).toISOString() })}\n\n`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Servidor de teste. `schedule(res)` decide quando cada pedaço sai.
async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/stream`;
  try {
    return await run(url);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const sseHeaders = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' };

// 5 eventos, um a cada GAP ms, cada um escrito na hora em que é gerado.
async function streaming(req, res) {
  res.writeHead(200, sseHeaders);
  for (let i = 1; i <= 5; i++) {
    res.write(event(i, Date.now()));
    if (i < 5) await sleep(GAP);
  }
  res.end();
}

// Gera no mesmo ritmo, mas só escreve quando tudo ficou pronto (o que um proxy que bufferiza faz).
async function buffered(req, res) {
  const chunks = [];
  for (let i = 1; i <= 5; i++) {
    chunks.push(event(i, Date.now()));
    if (i < 5) await sleep(GAP);
  }
  res.writeHead(200, sseHeaders);
  res.end(chunks.join(''));
}

// Libera em três levas: eventos 1 e 2, 3 e 4, e o 5.
async function partial(req, res) {
  res.writeHead(200, sseHeaders);
  const pending = [];
  for (let i = 1; i <= 5; i++) {
    pending.push(event(i, Date.now()));
    if (i === 2 || i === 4 || i === 5) {
      res.write(pending.splice(0).join(''));
    }
    if (i < 5) await sleep(GAP);
  }
  res.end();
}

describe('classify', () => {
  const at = (generated, arrived) => ({ generatedMs: generated, arrivedMs: arrived });

  it('espaçados: cada evento chega no ritmo em que foi gerado', () => {
    const events = [0, 1, 2, 3, 4].map((i) => at(i * 1000, 20 + i * 1003));
    assert.equal(classify(events).verdict, 'espacados');
  });

  it('bufferizado: gerados ao longo de 4 s, chegaram todos juntos', () => {
    const events = [0, 1, 2, 3, 4].map((i) => at(i * 1000, 4100 + i));
    const result = classify(events);
    assert.equal(result.verdict, 'bufferizado');
    assert.equal(result.batches, 1);
  });

  it('parcial: chegaram em leves, algumas juntas', () => {
    const arrived = [1000, 1001, 3000, 3002, 5000];
    const events = arrived.map((a, i) => at(i * 1000, a));
    const result = classify(events);
    assert.equal(result.verdict, 'parcial');
    assert.equal(result.batches, 3);
  });

  it('tolera jitter de rede de dezenas de milissegundos', () => {
    const jitter = [0, 40, -30, 55, 10];
    const events = jitter.map((j, i) => at(i * 1000, 300 + i * 1000 + j));
    assert.equal(classify(events).verdict, 'espacados');
  });

  it('inconclusivo com menos de 2 eventos', () => {
    assert.equal(classify([]).verdict, 'inconclusivo');
    assert.equal(classify([at(0, 0)]).verdict, 'inconclusivo');
  });

  it('inconclusivo se o próprio servidor não espaçou os eventos', () => {
    const events = [0, 1, 2].map((i) => at(i, i));
    assert.equal(classify(events).verdict, 'inconclusivo');
  });
});

describe('probe contra um servidor local', () => {
  it('reconhece o stream espaçado e mostra cada evento', async () => {
    await withServer(streaming, async (url) => {
      const lines = [];
      const report = await probe(url, { log: (line) => lines.push(line) });
      assert.equal(report.verdict, 'espacados');
      assert.equal(report.events.length, 5);
      assert.equal(report.status, 200);
      assert.match(report.contentType, /^text\/event-stream/);
      assert.equal(lines.filter((line) => /evento \d/.test(line)).length, 5);
    });
  });

  it('reconhece o stream bufferizado', async () => {
    await withServer(buffered, async (url) => {
      const report = await probe(url, quiet);
      assert.equal(report.verdict, 'bufferizado');
      assert.equal(report.events.length, 5);
    });
  });

  it('reconhece o stream parcial', async () => {
    await withServer(partial, async (url) => {
      const report = await probe(url, quiet);
      assert.equal(report.verdict, 'parcial');
    });
  });

  it('manda os cabeçalhos pedidos (X-Azure-FDID quando a origem tem trava)', async () => {
    const seen = [];
    const guarded = async (req, res) => {
      seen.push(req.headers['x-azure-fdid']);
      if (req.headers['x-azure-fdid'] !== 'abc') {
        res.writeHead(403).end();
        return;
      }
      await streaming(req, res);
    };
    await withServer(guarded, async (url) => {
      await assert.rejects(probe(url, quiet), /403/);
      const report = await probe(url, { ...quiet, headers: { 'X-Azure-FDID': 'abc' } });
      assert.equal(report.verdict, 'espacados');
      assert.deepEqual(seen, [undefined, 'abc']);
    });
  });

  it('falha com status diferente de 200', async () => {
    await withServer(
      (req, res) => res.writeHead(502).end('bad gateway'),
      async (url) => {
        await assert.rejects(probe(url, quiet), /502/);
      },
    );
  });

  it('falha se a resposta não for text/event-stream (HTML de erro, por exemplo)', async () => {
    await withServer(
      (req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>oi</h1>'),
      async (url) => {
        await assert.rejects(probe(url, quiet), /text\/event-stream/);
      },
    );
  });

  it('falha se o stream terminar com menos eventos que o esperado', async () => {
    await withServer(
      (req, res) => {
        res.writeHead(200, sseHeaders);
        res.write(event(1, Date.now()));
        res.end();
      },
      async (url) => {
        await assert.rejects(probe(url, quiet), /1 evento/);
      },
    );
  });

  it('falha no tempo limite se o servidor ficar mudo', async () => {
    await withServer(
      (req, res) => res.writeHead(200, sseHeaders).flushHeaders(),
      async (url) => {
        await assert.rejects(probe(url, { ...quiet, timeoutMs: 300 }), /tempo/);
      },
    );
  });

  it('falha se não conseguir conectar', async () => {
    await assert.rejects(probe('http://127.0.0.1:1/stream', quiet));
  });
});

describe('main (linha de comando)', () => {
  it('sai com 0 quando espaçado, 1 quando bufferizado ou parcial, 2 em erro', async () => {
    await withServer(streaming, async (url) => {
      assert.equal(await main([url], quiet), 0);
    });
    await withServer(buffered, async (url) => {
      assert.equal(await main([url], quiet), 1);
    });
    await withServer(partial, async (url) => {
      assert.equal(await main([url], quiet), 1);
    });
    await withServer(
      (req, res) => res.writeHead(500).end(),
      async (url) => {
        assert.equal(await main([url], quiet), 2);
      },
    );
  });

  it('sem URL, ou com URL que não é http(s), mostra o uso e sai com 2', async () => {
    const lines = [];
    const sink = { log: (l) => lines.push(l), error: (l) => lines.push(l) };
    assert.equal(await main([], sink), 2);
    assert.match(lines.join('\n'), /Uso:/);
    assert.equal(await main(['file:///etc/passwd'], sink), 2);
    assert.equal(await main(['isto-nao-e-url'], sink), 2);
  });

  it('aceita --header "Nome: valor" e recusa cabeçalho mal formado', async () => {
    const seen = [];
    await withServer(
      async (req, res) => {
        seen.push(req.headers['x-teste']);
        await streaming(req, res);
      },
      async (url) => {
        assert.equal(await main([url, '--header', 'X-Teste: oi'], quiet), 0);
        assert.deepEqual(seen, ['oi']);
        assert.equal(await main([url, '--header', 'sem-dois-pontos'], quiet), 2);
      },
    );
  });
});
