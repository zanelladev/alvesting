import { describe, expect, it } from 'vitest';
import { FeedFormatError, MAX_FEED_ITEMS, parseFeedDate, parseRss } from './rss.js';

// Feed sintético no formato dos de verdade (WordPress com CDATA e espaços de nome; Agência Brasil com fuso -0300).
// Nenhum texto aqui vem de matéria real.
const wordpress = (items: string) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Feed de Teste</title>
  <atom:link href="https://exemplo.com.br/feed/" rel="self" type="application/rss+xml" />
  <link>https://exemplo.com.br/</link>
  <description>Notícias de teste</description>
  ${items}
</channel></rss>`;

const item = (
  fields: { title?: string; link?: string; date?: string; description?: string } = {},
) => `
  <item>
    <title>${fields.title ?? 'Título de teste'}</title>
    <link>${fields.link ?? 'https://exemplo.com.br/materia-1/'}</link>
    <dc:creator><![CDATA[Fulana de Tal]]></dc:creator>
    <pubDate>${fields.date ?? 'Sun, 01 Nov 2026 16:45:00 +0000'}</pubDate>
    <category><![CDATA[Mercados]]></category>
    <guid isPermaLink="false">https://exemplo.com.br/?p=1</guid>
    <description><![CDATA[${fields.description ?? '<p>Resumo da matéria.</p>'}]]></description>
    <content:encoded><![CDATA[<p>Corpo inteiro da matéria que não deve virar trecho.</p>]]></content:encoded>
  </item>`;

describe('parseRss', () => {
  it('lê título, link, data e resumo; o corpo (content:encoded) não entra', () => {
    const items = parseRss(wordpress(item()));
    expect(items).toEqual([
      {
        title: 'Título de teste',
        link: 'https://exemplo.com.br/materia-1/',
        summary: '<p>Resumo da matéria.</p>',
        publishedAt: new Date('2026-11-01T16:45:00Z'),
      },
    ]);
  });

  it('um item só não vira objeto solto: continua sendo lista', () => {
    expect(parseRss(wordpress(item()))).toHaveLength(1);
    expect(
      parseRss(wordpress(item() + item({ link: 'https://exemplo.com.br/materia-2/' }))),
    ).toHaveLength(2);
  });

  it('feed sem itens é uma lista vazia', () => {
    expect(parseRss(wordpress(''))).toEqual([]);
  });

  it('decodifica as entidades de XML e deixa as de HTML para a limpeza decodificar', () => {
    const [first] = parseRss(
      wordpress(
        item({
          title: 'Lucro &amp; prejuízo &#8211; 3T26 &nbsp;&hellip;',
          description: 'a &lt;b&gt;x&lt;/b&gt;',
        }),
      ),
    );
    // do XML só &amp;, &lt;, &gt;, &quot; e &apos; saem aqui; as referências numéricas e as entidades de HTML ficam
    expect(first?.title).toBe('Lucro & prejuízo &#8211; 3T26 &nbsp;&hellip;');
    // dentro de CDATA nada é decodificado
    expect(first?.summary).toBe('a &lt;b&gt;x&lt;/b&gt;');
  });

  it('data com fuso -0300 (Agência Brasil) e sem fuso (vira nula, não chute)', () => {
    const [a, b] = parseRss(
      wordpress(
        item({ date: 'Sat, 31 Oct 2026 15:47:00 -0300' }) +
          item({ link: 'https://exemplo.com.br/2', date: '2026-11-01 16:51:17' }),
      ),
    );
    expect(a?.publishedAt).toEqual(new Date('2026-10-31T18:47:00Z'));
    expect(b?.publishedAt).toBeNull();
  });

  it('item sem título, sem link ou com link que não é texto é descartado', () => {
    const feed = wordpress(
      item({ title: '   ' }) +
        item({ link: '' }) +
        item({ link: '<a>x</a>' }) +
        item({ title: 'Bom', link: 'https://exemplo.com.br/bom' }),
    );
    expect(parseRss(feed).map((i) => i.title)).toEqual(['Bom']);
  });

  it('item com dois <link> (um do atom) usa o primeiro que é texto', () => {
    const feed = wordpress(
      `<item><title>T</title><link>https://exemplo.com.br/a</link><atom:link href="https://exemplo.com.br/a" /></item>`,
    );
    expect(parseRss(feed)[0]?.link).toBe('https://exemplo.com.br/a');
  });

  it(`lê no máximo ${MAX_FEED_ITEMS} itens`, () => {
    const many = Array.from({ length: MAX_FEED_ITEMS + 50 }, (_, i) =>
      item({ link: `https://exemplo.com.br/m-${i}` }),
    ).join('');
    expect(parseRss(wordpress(many))).toHaveLength(MAX_FEED_ITEMS);
  });
});

describe('parseRss: o que um feed hostil pode mandar', () => {
  it('recusa DTD e declaração de entidade (XXE e bomba de entidades)', () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss version="2.0"><channel><item><title>&xxe;</title><link>https://exemplo.com.br/a</link></item></channel></rss>`;
    expect(() => parseRss(xxe)).toThrow(FeedFormatError);
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">]><rss version="2.0"><channel><item><title>&lol2;</title><link>https://exemplo.com.br/a</link></item></channel></rss>`;
    expect(() => parseRss(laughs)).toThrow(/DTD/);
    expect(() => parseRss(laughs.replace('DOCTYPE', 'doctype'))).toThrow(FeedFormatError);
    expect(() => parseRss(wordpress('<!ENTITY a "b">'))).toThrow(FeedFormatError);
  });

  // Falha fechada, de propósito (ponytail em rss.ts): o texto de um item com "<!DOCTYPE" dentro de CDATA derruba o feed
  // inteiro até o item sair do feed. A alternativa, poupar o CDATA, deixaria um DOCTYPE de verdade passar escondido.
  it('recusa também o "<!DOCTYPE" que aparece só dentro de CDATA ou de comentário (falha fechada)', () => {
    expect(() =>
      parseRss(wordpress(item({ title: '<![CDATA[Como usar <!DOCTYPE html> em páginas]]>' }))),
    ).toThrow(/DTD/);
    expect(() => parseRss(wordpress('<!-- <!DOCTYPE x> -->'))).toThrow(FeedFormatError);
    // o furo que poupar o CDATA abriria: um CDATA aberto num comentário esconde o DOCTYPE de verdade
    const hidden = `<?xml version="1.0"?><!-- <![CDATA[ --><!DOCTYPE rss [<!ENTITY x "y">]><rss version="2.0"><channel><item><title><![CDATA[ ]]></title><link>https://exemplo.com.br/a</link></item></channel></rss>`;
    expect(() => parseRss(hidden)).toThrow(/DTD/);
  });

  it('recusa o que não é RSS: página HTML, Atom, vazio, texto', () => {
    expect(() => parseRss('<!doctype html><html><body>captcha</body></html>')).toThrow(
      FeedFormatError,
    );
    expect(() => parseRss('<html><head></head><body>erro</body></html>')).toThrow(FeedFormatError);
    expect(() => parseRss('<feed xmlns="http://www.w3.org/2005/Atom"><entry/></feed>')).toThrow(
      FeedFormatError,
    );
    expect(() => parseRss('')).toThrow(FeedFormatError);
    expect(() => parseRss('não é xml')).toThrow(FeedFormatError);
    expect(() => parseRss('<rss version="2.0"></rss>')).toThrow(FeedFormatError);
  });

  it('nome de tag perigoso (__proto__, constructor) é recusado e não contamina o protótipo', () => {
    for (const tag of ['__proto__', 'constructor', 'prototype']) {
      const feed = wordpress(
        `<item><title>T</title><link>https://exemplo.com.br/a</link><${tag}><polluted>1</polluted></${tag}></item>`,
      );
      expect(() => parseRss(feed), tag).toThrow(FeedFormatError);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('aninhamento absurdo falha rápido em vez de travar', () => {
    const deep = '<a>'.repeat(5000) + '</a>'.repeat(5000);
    const started = Date.now();
    expect(() =>
      parseRss(
        wordpress(`<item><title>T</title><link>https://exemplo.com.br/a</link>${deep}</item>`),
      ),
    ).toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('XML mal formado é erro, não resultado parcial', () => {
    expect(() => parseRss(wordpress(item()).replace('</channel>', ''))).toThrow(FeedFormatError);
  });
});

describe('parseFeedDate', () => {
  it('aceita RFC 822 e ISO 8601 com fuso explícito', () => {
    expect(parseFeedDate('Sun, 01 Nov 2026 16:45:00 +0000')).toEqual(
      new Date('2026-11-01T16:45:00Z'),
    );
    expect(parseFeedDate('Sat, 31 Oct 2026 15:47:00 -0300')).toEqual(
      new Date('2026-10-31T18:47:00Z'),
    );
    expect(parseFeedDate('Sun, 01 Nov 2026 15:18:40 -0000')).toEqual(
      new Date('2026-11-01T15:18:40Z'),
    );
    expect(parseFeedDate('Sun, 01 Nov 2026 15:18:40 GMT')).toEqual(
      new Date('2026-11-01T15:18:40Z'),
    );
    expect(parseFeedDate('2026-11-01T13:24:43Z')).toEqual(new Date('2026-11-01T13:24:43Z'));
    expect(parseFeedDate('2026-11-01T13:24:43-03:00')).toEqual(new Date('2026-11-01T16:24:43Z'));
    expect(parseFeedDate('01 Nov 2026 12:42:00 -0300')).toEqual(new Date('2026-11-01T15:42:00Z'));
  });

  it('sem fuso, vazio ou lixo: nulo (o fuso do servidor não pode decidir a hora da matéria)', () => {
    for (const bad of [
      '2026-11-01 16:51:17',
      '2026-11-01T13:24:43',
      '',
      '   ',
      'ontem',
      'Sun, 99 Nov 2026 16:45:00 +0000',
    ]) {
      expect(parseFeedDate(bad), bad).toBeNull();
    }
    expect(parseFeedDate(undefined)).toBeNull();
  });
});
