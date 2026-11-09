import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// O ingress do Container Apps imitado do e2e do perfil econômico (ADR 0039; docs/INFRA.md, 2.7). Na Azure, sem Front Door, o navegador fala com
// o ingress do ca-web: ele termina o TLS, acrescenta o IP do cliente à DIREITA do X-Forwarded-For ("If specified in initial request, it is
// appended to. Only the rightmost IP is provided by Azure Container Apps": Learn, "Ingress in Azure Container Apps") e passa tudo ao site, que
// repassa /api/* à api (src/lib/api-proxy.ts). Aqui o mesmo, em umas 40 linhas de `node:https`, e nada mais: não há trava de origem, não há
// rota para a api (quem a alcança é o site) e o Host segue como veio.
//
// Um desvio de propósito: o IP acrescentado é o que o teste pede no cabeçalho `x-e2e-client-ip` (sem ele, o do soquete, sempre o 127.0.0.1),
// para os seis projetos do Playwright, que rodam juntos, não dividirem o balde do limite de tentativas do Better Auth. O cabeçalho não segue.

// O certificado autoassinado, como o do e2e/front-door.ts (o mesmo código: os servidores que o `node` roda direto, com o strip de tipos, não
// importam nada do repositório, como o e2e/fixture-api.ts). Gerado na subida pelo `openssl`, válido por 1 dia, e a chave só passa pela memória.
function selfSignedCertificate(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(path.join(tmpdir(), 'alvesting-e2e-tls-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        path.join(dir, 'key.pem'),
        '-out',
        path.join(dir, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
      ],
      { stdio: 'pipe' },
    );
    return {
      key: readFileSync(path.join(dir, 'key.pem')),
      cert: readFileSync(path.join(dir, 'cert.pem')),
    };
  } catch (error) {
    throw new Error(
      `o ingress imitado precisa do openssl para gerar o certificado autoassinado do e2e: ${String(error)}`,
      { cause: error },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function integer(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} ausente ou inválida`);
  return value;
}

const PORT = integer('INGRESS_PORT');
const UPSTREAM = integer('INGRESS_UPSTREAM_PORT');

const server = createServer(selfSignedCertificate(), (req, res) => {
  const headers = { ...req.headers };
  // cabeçalhos de salto (hop-by-hop) valem para a conexão do navegador com o ingress, e não se repassam
  delete headers.connection;
  delete headers['keep-alive'];
  const chosen = String(req.headers['x-e2e-client-ip'] ?? '');
  delete headers['x-e2e-client-ip'];
  const ip = isIP(chosen) ? chosen : (req.socket.remoteAddress ?? '127.0.0.1');
  const incoming = req.headers['x-forwarded-for'];
  headers['x-forwarded-for'] = incoming ? `${String(incoming)}, ${ip}` : ip;
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-host'] = req.headers.host;

  // `agent: false`: uma conexão nova por pedido (o mesmo cuidado do e2e/front-door.ts com a conexão ociosa que a origem fecha)
  const upstream = httpRequest(
    { host: '127.0.0.1', port: UPSTREAM, method: req.method, path: req.url, headers, agent: false },
    (answer) => {
      const { connection: _hop, 'keep-alive': _keep, ...reply } = answer.headers;
      res.writeHead(answer.statusCode ?? 502, reply);
      answer.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('site fora do ar');
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});
server.keepAliveTimeout = 30_000;
server.listen(PORT, '127.0.0.1');
