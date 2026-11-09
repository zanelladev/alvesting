import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CorporateEventForm,
  CreateSeasonForm,
  EditSeasonForm,
  RerunCycleForm,
  ResubmitDlqForm,
  StartSeasonForm,
} from './admin-forms';

// Os formulários do painel de admin, renderizados no servidor (o HTML que chega ao navegador antes do JavaScript). O comportamento com
// JavaScript (confirmar, enviar, mostrar o resultado) os e2e conferem no navegador, em pixel-7, iphone-15 e desktop (e2e/admin.spec.ts).
const html = renderToStaticMarkup;

const forms = {
  'reenviar a DLQ': (
    <ResubmitDlqForm
      queue="news"
      messageId="fetch:infomoney:2026-11-05T10:00:00Z"
      labelledBy="dlq-news-0"
    />
  ),
  'reprocessar o ciclo': <RerunCycleForm defaultDate="2026-11-03" labelledBy="ciclo-titulo" />,
  'evento corporativo': <CorporateEventForm labelledBy="evento-titulo" />,
  'criar a temporada': <CreateSeasonForm labelledBy="temporada-nova" />,
  'editar o rascunho': (
    <EditSeasonForm
      id="01JZZZZZZZZZZZZZZZZZZZZZZA"
      initialJson='{"name":"x"}'
      labelledBy="t-editar"
    />
  ),
  'iniciar a temporada': (
    <StartSeasonForm id="01JZZZZZZZZZZZZZZZZZZZZZZA" slug="rascunho-1" labelledBy="t-iniciar" />
  ),
};

describe('todo formulário do painel', () => {
  it.each(Object.entries(forms))(
    '%s: sem JavaScript não se envia (campos desativados), não vai pela URL e tem nome',
    (_nome, form) => {
      const out = html(form);
      expect(out).toContain('<fieldset disabled=""');
      expect(out).toMatch(/<form[^>]*method="post"/);
      expect(out).toMatch(/<form[^>]*noValidate/);
      expect(out).toMatch(/<form[^>]*aria-labelledby="[^"]+"/);
    },
  );

  it.each(Object.entries(forms))(
    '%s: a confirmação é uma caixa de marcar desmarcada, com a frase do que vai acontecer',
    (_nome, form) => {
      const out = html(form);
      const boxes = [...out.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
      expect(boxes).toHaveLength(1);
      expect(boxes[0]).not.toMatch(/checked/);
      expect(boxes[0]).toMatch(/name="confirm"/);
      expect(out).toMatch(/Confirmo:/);
    },
  );

  it.each(Object.entries(forms))('%s: todo campo tem rótulo ligado a ele', (_nome, form) => {
    const out = html(form);
    const fields = [...out.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => !/type="hidden"/.test(tag));
    expect(fields.length).toBeGreaterThan(0);
    for (const tag of fields) {
      const id = /\sid="([^"]+)"/.exec(tag)?.[1];
      expect(id, tag).toBeTruthy();
      expect(out, tag).toContain(`for="${id}"`);
    }
  });
});

describe('cada formulário', () => {
  it('reenviar: diz o MessageId e a fila na frase da confirmação', () => {
    const out = html(forms['reenviar a DLQ']);
    expect(out).toContain(
      'Confirmo: reenviar a mensagem fetch:infomoney:2026-11-05T10:00:00Z para a fila news.',
    );
    expect(out).toContain('Reenviar para a fila');
  });

  // Texto sem espaço no rótulo da caixa (o MessageId `decide:<ULID>:<ULID>`, que é o que mais vai para a DLQ, tem 60 caracteres; o slug de
  // uma temporada, até 64): o item flex do rótulo tem de poder encolher, senão a palavra mais longa alarga a PÁGINA em 360 px
  // (reproduzido nos três projetos: scrollWidth de uns 690 px). O `overflow-wrap` do html não entra na conta do tamanho mínimo.
  it('o texto da confirmação pode encolher: o item flex do rótulo leva min-w-0 (senão a palavra longa alarga a página em 360 px)', () => {
    const decide = `decide:${'0'.repeat(26)}:${'1'.repeat(26)}`;
    const resubmit = html(<ResubmitDlqForm queue="decisions" messageId={decide} labelledBy="x" />);
    expect(resubmit).toMatch(
      new RegExp(`<span class="min-w-0">Confirmo: reenviar a mensagem ${decide} para`),
    );
    const slug = 'a'.repeat(64);
    const start = html(<StartSeasonForm id="x" slug={slug} labelledBy="x" />);
    expect(start).toMatch(
      new RegExp(`<span class="min-w-0">Confirmo: iniciar a temporada ${slug}\\.`),
    );
  });

  it('reprocessar: o pregão é um campo de data com o dia de hoje de Brasília por padrão, e a dica diz as duas regras', () => {
    const out = html(forms['reprocessar o ciclo']);
    expect(out).toMatch(/<input[^>]*type="date"[^>]*value="2026-11-03"/);
    expect(out).toContain('Nunca nos últimos 5 minutos antes do prazo das 09:30 nem depois dele');
    expect(out).toContain('nunca muda uma decisão já gravada');
  });

  it('evento: ticker em caixa alta no teclado, data, tipo (os três) e fator', () => {
    const out = html(forms['evento corporativo']);
    expect(out).toMatch(
      /<input[^>]*name="ticker"[^>]*autoCapitalize="characters"|<input[^>]*autoCapitalize="characters"[^>]*name="ticker"/,
    );
    expect(out).toMatch(
      /<input[^>]*type="date"[^>]*name="exDate"|<input[^>]*name="exDate"[^>]*type="date"/,
    );
    for (const kind of ['split', 'reverse-split', 'bonus'])
      expect(out).toContain(`value="${kind}"`);
    expect(out).toContain('Fator (de:para)');
    expect(out).toContain('muda resultados já publicados');
  });

  it('criar: o JSON do arquivo do season:create, com a recomendação de nunca pôr segredo', () => {
    const out = html(forms['criar a temporada']);
    expect(out).toContain('<textarea');
    expect(out).toContain('season:create');
    expect(out).toContain('Nunca ponha segredo');
  });

  it('editar: o texto vem do rascunho (escapado) e o aviso diz que cada campo substitui o atual', () => {
    const out = html(
      <EditSeasonForm
        id="x"
        initialJson='{"name":"</textarea><script>alert(1)</script>"}'
        labelledBy="t"
      />,
    );
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;/textarea&gt;&lt;script&gt;');
    expect(out).toContain('substitui o atual por inteiro');
  });

  it('iniciar: a confirmação avisa que o início é o próximo pregão e que regras, elenco e prompt passam a ficar fixos', () => {
    const out = html(forms['iniciar a temporada']);
    expect(out).toContain('iniciar a temporada rascunho-1');
    expect(out).toContain('próximo pregão');
    expect(out).toContain('regras, elenco e prompt ficam fixos');
  });
});
