import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../../../config/env.js';
import { ALERT_LOG } from '../../../../telemetry/alert-logs.js';
import { accountConfig } from '../account-config.js';
import { AcsEmailSender } from './acs-email-sender.js';
import { AccountMailer } from './account-mailer.js';
import { createEmailSender } from './email-sender.js';
import { passwordResetEmail, verificationEmail } from './email-templates.js';
import { OutboxEmailSender, readOutbox } from './outbox-email-sender.js';

// O e-mail transacional da conta (etapa 11): verificação e redefinição de senha, em português, com link absoluto pelo PUBLIC_URL e
// validade curta. Em dev e em teste o remetente é falso e grava cada mensagem num diretório; em produção só o Communication Services.
// Nada aqui chama a Azure de verdade: o cliente do ACS é um fake.
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'alvesting-outbox-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const message = {
  to: 'destinatario@example.test',
  subject: 'Assunto de teste',
  plainText: 'Texto simples com https://alvesting.example.test/x',
  html: '<p>Texto</p>',
};

describe('OutboxEmailSender (o remetente falso)', () => {
  it('grava uma mensagem por arquivo JSON, com o destinatário, o assunto e os dois corpos', async () => {
    const outbox = new OutboxEmailSender(path.join(dir, 'sub', 'pasta'));
    await outbox.send(message);
    await outbox.send({ ...message, to: 'outro@example.test' });

    const sent = await readOutbox(path.join(dir, 'sub', 'pasta'));
    expect(sent.map((m) => m.to)).toEqual(['destinatario@example.test', 'outro@example.test']);
    expect(sent[0]).toMatchObject({
      subject: message.subject,
      plainText: message.plainText,
      html: message.html,
    });
    expect(typeof sent[0]!.sentAt).toBe('string');
  });

  it('o nome do arquivo não carrega o endereço (nem o que o destinatário digitou)', async () => {
    await new OutboxEmailSender(dir).send({ ...message, to: '../../etc/passwd@example.test' });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9A-Z]{26}\.json$/);
    const [entry] = await readOutbox(dir);
    expect(entry!.to).toBe('../../etc/passwd@example.test');
  });

  it('uma gravação por vez nunca deixa meio arquivo à vista (grava e renomeia)', async () => {
    const outbox = new OutboxEmailSender(dir);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => outbox.send({ ...message, subject: `n${i}` })),
    );
    const sent = await readOutbox(dir);
    expect(sent).toHaveLength(20);
    expect((await readdir(dir)).every((f) => f.endsWith('.json'))).toBe(true);
    const raw = await readFile(path.join(dir, (await readdir(dir))[0]!), 'utf8');
    expect(typeof (JSON.parse(raw) as { to?: unknown }).to).toBe('string');
  });

  it('readOutbox de uma pasta que não existe devolve vazio', async () => {
    expect(await readOutbox(path.join(dir, 'nao-existe'))).toEqual([]);
  });
});

describe('AcsEmailSender', () => {
  const poller = (status: string) => ({
    pollUntilDone: vi.fn().mockResolvedValue({ id: 'op-1', status }),
  });

  it('monta a mensagem do Communication Services: remetente, assunto, os dois corpos e um destinatário', async () => {
    const beginSend = vi.fn().mockResolvedValue(poller('Succeeded'));
    await new AcsEmailSender({ beginSend }, 'DoNotReply@0123abcd.azurecomm.net').send(message);

    expect(beginSend).toHaveBeenCalledTimes(1);
    expect(beginSend.mock.calls[0]![0]).toEqual({
      senderAddress: 'DoNotReply@0123abcd.azurecomm.net',
      content: { subject: message.subject, plainText: message.plainText, html: message.html },
      recipients: { to: [{ address: message.to }] },
      disableUserEngagementTracking: true,
    });
  });

  it('falha quando o serviço não confirma o envio, e a mensagem de erro não carrega o endereço', async () => {
    const beginSend = vi.fn().mockResolvedValue(poller('Failed'));
    const error = await new AcsEmailSender({ beginSend }, 'DoNotReply@x.azurecomm.net')
      .send(message)
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Failed/);
    expect((error as Error).message).not.toContain(message.to);
  });

  // Uma operação que trava no Communication Services deixaria uma promessa pendente por e-mail, e o desligamento da API
  // (AccountMailer.idle) esperaria por ela até o SIGKILL do Container Apps. Os dois passos (o envio e a espera do resultado) levam o mesmo prazo.
  it('o envio e a espera do resultado levam um prazo: uma operação travada vira erro, não espera eterna', async () => {
    const stuck = {
      pollUntilDone: vi.fn(
        ({ abortSignal }: { abortSignal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            abortSignal.addEventListener('abort', () => reject(new Error('prazo estourado')));
          }),
      ),
    };
    const beginSend = vi.fn().mockResolvedValue(stuck);
    const started = Date.now();
    await expect(
      new AcsEmailSender({ beginSend }, 'a@x.azurecomm.net', 30).send(message),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
    // o mesmo sinal vai ao SDK nos dois passos
    const options = beginSend.mock.calls[0]![1] as { abortSignal: AbortSignal };
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(stuck.pollUntilDone.mock.calls[0]![0].abortSignal).toBe(options.abortSignal);
  });

  it('o erro do SDK sobe como está (o AccountMailer registra só o nome)', async () => {
    const beginSend = vi.fn().mockRejectedValue(new Error('rede caiu'));
    await expect(
      new AcsEmailSender({ beginSend }, 'a@x.azurecomm.net').send(message),
    ).rejects.toThrow('rede caiu');
  });
});

describe('createEmailSender', () => {
  const dev = { DATABASE_URL: 'postgresql://a:a@localhost:25432/a_test' };

  it('com a caixa de saída: o remetente falso', () => {
    const config = accountConfig(parseEnv({ ...dev, EMAIL_OUTBOX_DIR: dir }));
    expect(createEmailSender(config.email)).toBeInstanceOf(OutboxEmailSender);
  });

  it('com o Communication Services: o do ACS, com um cliente criado da connection string (sem rede)', () => {
    const config = accountConfig(
      parseEnv({
        ...dev,
        ACS_CONNECTION_STRING:
          'endpoint=https://acs-teste.communication.azure.com/;accesskey=c2VtLXZhbG9y',
        EMAIL_SENDER_ADDRESS: 'DoNotReply@0123abcd.azurecomm.net',
      }),
    );
    expect(createEmailSender(config.email)).toBeInstanceOf(AcsEmailSender);
  });
});

describe('os textos (português, link absoluto, validade curta)', () => {
  const url = 'https://alvesting.example.test/api/auth/verify-email?token=TOKEN-DE-TESTE';

  it('verificação: assunto, o link inteiro no texto e no HTML, e a validade', () => {
    const m = verificationEmail({ url, validityMinutes: 60 });
    expect(m.subject).toMatch(/Confirme/);
    expect(m.plainText).toContain(url);
    expect(m.plainText).toMatch(/60 minutos/);
    expect(m.plainText).toMatch(/Alvesting/);
    expect(m.html).toContain(
      'href="https://alvesting.example.test/api/auth/verify-email?token=TOKEN-DE-TESTE"',
    );
    expect(m.plainText).toMatch(/ignore/i);
  });

  it('redefinição: assunto, o link e a validade de 30 minutos', () => {
    const resetUrl = 'https://alvesting.example.test/redefinir-senha?token=TOKEN-DE-TESTE';
    const m = passwordResetEmail({ url: resetUrl, validityMinutes: 30 });
    expect(m.subject).toMatch(/senha/i);
    expect(m.plainText).toContain(resetUrl);
    expect(m.plainText).toMatch(/30 minutos/);
    expect(m.html).toContain(`href="${resetUrl}"`);
    expect(m.plainText).toMatch(/não foi você/i);
  });

  it('o HTML escapa o que vem de fora (o link é de terceiro até chegar aqui)', () => {
    const m = verificationEmail({
      url: 'https://alvesting.example.test/?a=1&b="><script>x</script>',
      validityMinutes: 5,
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&amp;b=');
  });

  it('só aceita link http(s): o texto não leva javascript: nem data:', () => {
    expect(() => verificationEmail({ url: 'javascript:alert(1)', validityMinutes: 5 })).toThrow(
      /http/,
    );
    expect(() => passwordResetEmail({ url: 'data:text/html,x', validityMinutes: 5 })).toThrow(
      /http/,
    );
  });
});

describe('AccountMailer', () => {
  const failing = {
    send: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('falhou para destinatario@example.test'), { code: 'X1' }),
      ),
  };

  it('não segura a resposta do cadastro: devolve na hora e entrega em segundo plano (contra tempo de resposta que revela a conta)', async () => {
    let release!: () => void;
    const slow = {
      send: vi.fn((_message: unknown) => new Promise<void>((resolve) => (release = resolve))),
    };
    const mailer = new AccountMailer(slow, vi.fn());
    mailer.sendVerification('a@example.test', 'https://alvesting.example.test/v?token=t');
    expect(slow.send).toHaveBeenCalledTimes(1);
    expect(slow.send.mock.calls[0]![0]).toMatchObject({ to: 'a@example.test' });
    release();
    await mailer.idle();
  });

  // Quem pede o e-mail não prova ser o dono do endereço: sem isto, qualquer um enche a caixa de uma pessoa (e gasta a cota do
  // Communication Services, que no domínio gerenciado da Azure é de 5 por minuto e 10 por hora para todo mundo).
  it('o mesmo destinatário não recebe o mesmo tipo de e-mail duas vezes em 60 s; outro tipo e outro destinatário saem, e depois de 60 s sai de novo', async () => {
    let now = 1_000_000;
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const log = vi.fn();
    const mailer = new AccountMailer(sender, log, () => now);
    const url = 'https://alvesting.example.test/v?token=t';

    mailer.sendVerification('a@example.test', url);
    mailer.sendVerification('A@Example.TEST', url); // o mesmo endereço, com outra caixa
    mailer.sendPasswordReset('a@example.test', url); // outro tipo
    mailer.sendVerification('b@example.test', url); // outro destinatário
    await mailer.idle();
    expect(sender.send).toHaveBeenCalledTimes(3);

    now += 59_000;
    mailer.sendVerification('a@example.test', url);
    await mailer.idle();
    expect(sender.send).toHaveBeenCalledTimes(3);

    now += 2_000;
    mailer.sendVerification('a@example.test', url);
    await mailer.idle();
    expect(sender.send).toHaveBeenCalledTimes(4);

    // o que ficou de fora vai ao log, sem o endereço
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toMatch(/60 s/);
    expect(logged).not.toMatch(/example\.test/i);
    // e não é falha de envio: o alerta de e-mail que falhou (infra/modules/alerts.bicep) não pode contá-lo
    expect(logged).not.toContain(ALERT_LOG.emailFailed);
  });

  it('a falha do envio nunca explode e vai ao log sem e-mail nem mensagem do SDK', async () => {
    const log = vi.fn();
    const mailer = new AccountMailer(failing, log);
    mailer.sendPasswordReset(
      'destinatario@example.test',
      'https://alvesting.example.test/r?token=t',
    );
    await mailer.idle();

    expect(log).toHaveBeenCalledTimes(1);
    // a linha que o alerta procura: o texto da constante e depois o nome do erro e o código
    expect((log.mock.calls[0] as [string])[0]).toMatch(
      new RegExp(`^${ALERT_LOG.emailFailed} \\w+:X1$`),
    );
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('X1');
    expect(logged).not.toContain('destinatario@example.test');
    expect(logged).not.toContain('falhou para');
    expect(logged).not.toContain('token=t');
  });
});
