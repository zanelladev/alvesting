import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatedCounter } from './animated-counter/animated-counter';
import { Calendar } from './calendar/calendar';
import { DatePicker } from './date-picker/date-picker';
import { dateKey, fromKey, todayKey } from './lib/use-today';
import { NumberField } from './number-field/number-field';
import { Tooltip } from './tooltip/tooltip';

// As peças da Arc em uso (ADR 0037: o contador e o tooltip; desde 06/11/2026, o campo de número, o calendário e o seletor de data do lançamento
// da carteira), no HTML que o servidor manda: o que o leitor de tela e o teclado encontram antes da hidratação. O movimento (a roda do
// algarismo, o deslize dos meses) é do navegador; aqui fica o contrato, e os textos, que viraram português.
describe('as peças da Arc', () => {
  it('o contador escreve o número em português, inteiro, para o leitor de tela', () => {
    const out = renderToStaticMarkup(<AnimatedCounter value={1234.5} decimals={2} prefix="R$ " />);
    expect(out).toContain('R$ 1.234,50');
    expect(out).toMatch(/aria-hidden="true"/);
  });

  it('o tooltip deixa o gatilho como está (o balão só nasce no navegador, no hover ou no foco)', () => {
    const out = renderToStaticMarkup(
      <Tooltip content="Claro">
        <button type="button">☀</button>
      </Tooltip>,
    );
    expect(out).toMatch(/^<button type="button"[^>]*data-state="closed"[^>]*>☀<\/button>$/);
  });

  it('o campo de número: o milhar com ponto (pt-BR), o − e o + com nome em português, e o limite parado no mínimo', () => {
    const out = renderToStaticMarkup(
      <NumberField label="Quantidade" defaultValue={1000} min={1} max={1_000_000} />,
    );
    expect(out).toContain('value="1.000"');
    expect(out).toContain('aria-valuetext="1.000"');
    expect(out).toContain('aria-label="Diminuir quantidade"');
    expect(out).toContain('aria-label="Aumentar quantidade"');
    // o teclado de números do celular, e o papel que o leitor de tela anuncia
    expect(out).toMatch(/role="spinbutton" inputMode="numeric"/);
    const atMin = renderToStaticMarkup(
      <NumberField label="Quantidade" defaultValue={1} min={1} max={1_000_000} />,
    );
    expect(atMin).toMatch(/aria-label="Diminuir quantidade" aria-disabled="true"/);
    expect(atMin).not.toMatch(/aria-label="Aumentar quantidade" aria-disabled/);
  });

  it('o campo de número liga o erro do formulário (inválido, e a frase pelo aria-describedby)', () => {
    const out = renderToStaticMarkup(
      <NumberField label="Quantidade" defaultValue={5} min={1} invalid describedBy="erro-1" />,
    );
    expect(out).toMatch(/aria-describedby="erro-1" aria-invalid="true"/);
  });

  it('o calendário, em português: o mês e o ano nos <select> do título (o ano do mais novo ao mais velho, o mês fora do limite desativado), "Hoje", as setas e os dias pelo nome inteiro', () => {
    const out = renderToStaticMarkup(
      <Calendar
        month={new Date(2026, 9, 1)}
        value={new Date(2026, 9, 15)}
        minDate={new Date(1900, 0, 1)}
        maxDate={new Date(2026, 9, 20)}
        showToday
        onChange={() => undefined}
      />,
    );
    expect(out).toMatch(/<select aria-label="Mês">/);
    expect(out).toMatch(/<select aria-label="Ano">/);
    expect(out).toContain('<option value="9" selected="">outubro</option>');
    // em 2026 os meses depois do último dia que se pode escolher (20 de outubro) não abrem
    expect(out).toContain('<option value="11" disabled="">dezembro</option>');
    expect(out).toContain('<option value="10" disabled="">novembro</option>');
    expect(out).toContain('<option value="8">setembro</option>');
    const years = [...out.matchAll(/<option value="(\d{4})"/g)].map((m) => Number(m[1]));
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(1900);
    expect(years).toHaveLength(127);
    expect(out).toContain('>Hoje</button>');
    expect(out).toContain('aria-label="Mês anterior"');
    expect(out).toContain('aria-label="Próximo mês"');
    expect(out).toContain('aria-label="quinta-feira, 15 de outubro de 2026"');
    expect(out).toMatch(/aria-label="quinta-feira, 15 de outubro de 2026" aria-selected="true"/);
    // os dias da semana em três letras (as duas primeiras repetiriam "se" e "qu")
    expect(out).toContain('<span>dom</span><span>seg</span><span>ter</span><span>qua</span>');
    // o dia depois do limite fica desativado, e o do limite não
    expect(out).toMatch(/aria-label="quarta-feira, 21 de outubro de 2026"[^>]*disabled=""/);
    expect(out).not.toMatch(/aria-label="terça-feira, 20 de outubro de 2026"[^>]*disabled=""/);
  });

  it('o seletor de data fechado: o rótulo e o marcador dão o nome do gatilho, que abre o calendário', () => {
    const out = renderToStaticMarkup(
      <DatePicker label="Data da compra (opcional)" placeholder="Sem data" />,
    );
    expect(out).toMatch(/>Data da compra \(opcional\)<\/label>/);
    expect(out).toMatch(/aria-haspopup="dialog" aria-expanded="false"/);
    expect(out).toContain('>Sem data</span>');
    const chosen = renderToStaticMarkup(
      <DatePicker label="Data da compra (opcional)" value={new Date(2026, 9, 15)} />,
    );
    expect(chosen).toContain('>15 de out. de 2026</span>');
  });

  // O que só aparece com o calendário aberto ("Limpar", "Escolha um dia", "Escolhida: ...", "Calendário: ...") o e2e lê na tela; aqui, que
  // nenhum texto da interface ficou em inglês nas peças copiadas.
  it('nenhum texto da interface ficou em inglês nas peças copiadas', () => {
    const sources = [
      'number-field/number-field.tsx',
      'calendar/calendar.tsx',
      'date-picker/date-picker.tsx',
    ].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'));
    for (const english of [
      /['"`](Increase|Decrease|Today|Clear|Previous month|Next month|Select a date|Choose a day)['"`]/,
      /`(Selected|Today,) /,
      / calendar`/,
      /'(maximum|minimum)'/,
      /"Max"|"Min"/,
    ])
      for (const source of sources) expect(source).not.toMatch(english);
    expect(sources.join('\n')).toContain('Escolha um dia');
    expect(sources.join('\n')).toContain('`Escolhida: ${');
    expect(sources.join('\n')).toContain('`Calendário: ${label}`');
    expect(sources.join('\n')).toMatch(/>\s*Limpar\s*</);
  });
});

describe('a data do lançamento (lib/use-today.ts)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('vai como AAAA-MM-DD pelas partes locais: 23:30 em Brasília continua no mesmo dia (o toISOString já daria o seguinte)', () => {
    vi.stubEnv('TZ', 'America/Sao_Paulo');
    const late = new Date(2026, 9, 15, 23, 30);
    expect(late.toISOString().slice(0, 10)).toBe('2026-10-16');
    expect(dateKey(late)).toBe('2026-10-15');
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('e volta para a data local, à meia-noite do dia', () => {
    expect(fromKey('2026-10-15')).toEqual(new Date(2026, 9, 15));
    expect(dateKey(fromKey('1900-01-01'))).toBe('1900-01-01');
  });

  it('o hoje é o de Brasília, o limite que o servidor manda: num aparelho à frente do fuso o "Hoje" saía do limite e ficava desativado', () => {
    vi.stubEnv('TZ', 'Asia/Tokyo');
    // 22:30 de 10/11 em Brasília, 10:30 de 11/11 em Tóquio (o CI, em UTC, cai no mesmo caso das 21h às 24h de Brasília)
    const late = new Date('2026-11-11T01:30:00Z');
    expect(dateKey(late)).toBe('2026-11-11');
    expect(todayKey(late)).toBe('2026-11-10');
    expect(todayKey(new Date('2026-11-11T03:00:00Z'))).toBe('2026-11-11');
  });
});
