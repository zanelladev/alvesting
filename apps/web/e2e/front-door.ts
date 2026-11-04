import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { createServer } from 'node:https';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// O Front Door imitado do e2e das telas da conta (docs/CONTA.md, seção 9; docs/INFRA.md, 2.5). Na Azure o navegador fala com uma origem só:
// o Front Door manda `/api/*` para a api e `/*` para o site, escreve o `X-Azure-FDID` do perfil em toda requisição à origem e a
// api e o site (com `FRONT_DOOR_ID`) recusam quem chega sem ele. Aqui o mesmo desenho, em umas 80 linhas de `node:https`, para o cookie, o
// `Origin` e o link do e-mail do e2e se comportarem como em produção. Nada disto existe fora do e2e: o site não tem rota de proxy para a
// api (em dev, é o `rewrites` do next.config.ts, só na fase de desenvolvimento).
//
// O que imita, do que a documentação do Front Door diz (Learn, "Protocol support for HTTP headers in Azure Front Door"):
//   - serve https (o Front Door termina o TLS e fala com as origens por http ou https; aqui por http, na máquina), e é por isso que a api
//     da conta emite o cookie de produção (`Secure`, com o prefixo `__Secure-`): o navegador do e2e só o guarda, e o WebKit só o aceita, em https;
//   - /api/* vai para a api, o resto para o site (as rotas do infra/modules/frontdoor.bicep);
//   - o X-Azure-FDID e o X-Azure-SocketIP são escritos por ele: o que o cliente mandar nesses dois cabeçalhos é descartado;
//   - o Host da origem é o da origem (originHostHeader), e o Host que o navegador usou vai em X-Forwarded-Host, com o X-Forwarded-Proto.
// Onde ele se afasta de propósito: o X-Azure-SocketIP de verdade é o IP do soquete que o Front Door vê, e aqui seria sempre o 127.0.0.1,
// então os três projetos do Playwright, que rodam juntos, dividiriam o balde do limite de tentativas do Better Auth (por IP). O teste
// escolhe o IP mandando um X-Forwarded-For, e este servidor o repassa como X-Azure-SocketIP (e-mail/IP de teste, sempre sintéticos).
// E o certificado é autoassinado: os contextos do Playwright abrem com `ignoreHTTPSErrors` (a cadeia de confiança de verdade é coisa do
// smoke pós-deploy, que roda contra o Front Door publicado, sem essa opção).

// O certificado: gerado na subida pelo `openssl` (o LibreSSL do macOS, o OpenSSL do runner do CI), válido por 1 dia, e a chave só passa
// pela memória deste processo: ela vive num diretório temporário por uns milissegundos e não vai ao repositório (um certificado fixo no
// repositório seria uma chave privada versionada). Sem `openssl` o e2e da conta não sobe, e o erro diz por quê.
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
      `o Front Door imitado precisa do openssl para gerar o certificado autoassinado do e2e: ${String(error)}`,
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
const PORT = integer('FRONT_DOOR_PORT');
const API_PORT = integer('FRONT_DOOR_API_PORT');
const WEB_PORT = integer('FRONT_DOOR_WEB_PORT');
const FRONT_DOOR_ID = process.env.FRONT_DOOR_ID;
if (!FRONT_DOOR_ID) throw new Error('FRONT_DOOR_ID ausente');

const isApi = (url: string) => url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');

// O IP "do cliente" deste teste: o primeiro endereço válido do X-Forwarded-For, senão o do soquete.
function clientIp(req: IncomingMessage): string {
  const first = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    ?.trim();
  return first && isIP(first) ? first : (req.socket.remoteAddress ?? '127.0.0.1');
}

const server = createServer(selfSignedCertificate(), (req, res) => {
  const url = req.url ?? '/';
  const port = isApi(url) ? API_PORT : WEB_PORT;
  const ip = clientIp(req);

  const headers = { ...req.headers };
  for (const name of Object.keys(headers)) if (name.startsWith('x-azure-')) delete headers[name];
  // cabeçalhos de salto (hop-by-hop) valem para a conexão do navegador com o Front Door, e não se repassam à origem
  delete headers.connection;
  delete headers['keep-alive'];
  headers.host = `127.0.0.1:${port}`;
  headers['x-forwarded-host'] = req.headers.host;
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-for'] = ip;
  headers['x-azure-fdid'] = FRONT_DOOR_ID;
  headers['x-azure-socketip'] = ip;

  // `agent: false`: uma conexão nova por pedido, sem reaproveitar. O agente global do Node mantém as conexões abertas (keep-alive), e a api
  // e o site fecham a conexão ociosa depois de 5 s: um pedido que cai numa conexão que a origem está fechando volta como ECONNRESET, e
  // o teste veria um 502 sem relação com o que ele prova. No loopback uma conexão a mais não custa nada.
  const upstream = httpRequest(
    { host: '127.0.0.1', port, method: req.method, path: url, headers, agent: false },
    (answer) => {
      // o `Connection: close` da origem (sem keep-alive, acima) vale para o trecho dela, e não para o do navegador
      const { connection: _hop, 'keep-alive': _keep, ...reply } = answer.headers;
      res.writeHead(answer.statusCode ?? 502, reply);
      answer.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('origem fora do ar');
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});
// O navegador reaproveita a conexão com o Front Door: o padrão do Node (5 s) a fecha sob o pedido que chega nesse instante, que é a mesma
// corrida do outro lado. O Front Door de verdade segura a conexão ociosa por muito mais tempo.
server.keepAliveTimeout = 30_000;
server.listen(PORT, '127.0.0.1');
