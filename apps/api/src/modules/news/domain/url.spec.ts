import { describe, expect, it } from 'vitest';
import { hashOfNormalized, normalizeUrl, urlHash } from './url.js';

// A chave única da notícia (news_item.url_hash) é o SHA-256 da URL normalizada: a mesma matéria buscada de novo, com
// outro parâmetro de rastreio ou fragmento, tem de dar o mesmo hash. A URL guardada vira link na página pública,
// então só http(s) passa.

describe('normalizeUrl', () => {
  it('tira fragmento e parâmetros de rastreio', () => {
    expect(
      normalizeUrl(
        'https://www.infomoney.com.br/mercados/materia/?utm_source=rss&utm_medium=feed&fbclid=abc&gclid=1#comentarios',
      ),
    ).toBe('https://www.infomoney.com.br/mercados/materia');
  });

  it('mantém os parâmetros que identificam o conteúdo, em ordem estável', () => {
    const a = normalizeUrl(
      'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&numVersao=1&numProtocolo=1473614&descTipo=IPE',
    );
    const b = normalizeUrl(
      'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?numProtocolo=1473614&descTipo=IPE&Tela=ext&numVersao=1&utm_campaign=x',
    );
    expect(a).toBe(b);
    expect(a).toContain('numProtocolo=1473614');
    expect(a).toContain('descTipo=IPE');
  });

  it('minúsculas no esquema e no host, porta padrão e barra final fora', () => {
    expect(normalizeUrl('HTTPS://WWW.Seudinheiro.COM:443/2026/mercados/materia/')).toBe(
      'https://www.seudinheiro.com/2026/mercados/materia',
    );
    expect(normalizeUrl('http://exemplo.com.br:80/a')).toBe('http://exemplo.com.br/a');
  });

  it('mantém a porta fora do padrão e o caminho em caixa original', () => {
    expect(normalizeUrl('https://exemplo.com.br:8443/Materia/ABC')).toBe(
      'https://exemplo.com.br:8443/Materia/ABC',
    );
  });

  it('a raiz do site fica com a barra, e "?" vazio some', () => {
    expect(normalizeUrl('https://exemplo.com.br')).toBe('https://exemplo.com.br/');
    expect(normalizeUrl('https://exemplo.com.br/a?')).toBe('https://exemplo.com.br/a');
    expect(normalizeUrl('https://exemplo.com.br/a?utm_source=x')).toBe('https://exemplo.com.br/a');
  });

  it('apara espaços e aceita a URL com acento (percent-encoding estável)', () => {
    expect(normalizeUrl('  https://exemplo.com.br/ação?q=café  ')).toBe(
      normalizeUrl('https://exemplo.com.br/a%C3%A7%C3%A3o?q=caf%C3%A9'),
    );
  });

  it('só http e https: javascript:, data:, file: e relativo são recusados', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///etc/passwd',
      'ftp://exemplo.com/a',
      '//exemplo.com/a',
      '/a/b',
      'exemplo.com/a',
      '',
      '   ',
    ]) {
      expect(normalizeUrl(bad), bad).toBeNull();
    }
  });

  it('recusa usuário e senha na URL e host vazio', () => {
    expect(normalizeUrl('https://usuario:senha@exemplo.com/a')).toBeNull();
    expect(normalizeUrl('https://usuario@exemplo.com/a')).toBeNull();
    expect(normalizeUrl('https://')).toBeNull();
  });

  it('recusa URL com espaço, quebra de linha ou tamanho absurdo', () => {
    expect(normalizeUrl('https://exemplo.com/a b')).not.toContain(' ');
    expect(normalizeUrl('https://exemplo.com/a\nb')).toBe('https://exemplo.com/ab');
    expect(normalizeUrl(`https://exemplo.com/${'a'.repeat(3000)}`)).toBeNull();
  });
});

describe('normalizeUrl é idempotente', () => {
  it('normalizar uma URL já normalizada não muda nada (o hash e o link guardado vêm da mesma string)', () => {
    for (const input of [
      'https://www.infomoney.com.br/mercados/materia/?utm_source=rss&b=2&a=1#x',
      'https://exemplo.com.br/ação?q=café&q=a b',
      'HTTP://EXEMPLO.com.br:80/A/B/',
      'https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&descTipo=IPE&numVersao=1',
      'https://exemplo.com.br/a?x=%20&y=+&z=%2B',
      'https://exemplo.com.br',
    ]) {
      const once = normalizeUrl(input)!;
      expect(normalizeUrl(once), input).toBe(once);
    }
  });
});

describe('urlHash', () => {
  it('é o SHA-256 em hexadecimal da URL normalizada, igual para as variantes da mesma matéria', () => {
    const a = urlHash('https://exemplo.com.br/materia/?utm_source=rss#x');
    const b = urlHash('https://EXEMPLO.com.br/materia');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matérias diferentes têm hash diferente', () => {
    expect(urlHash('https://exemplo.com.br/a')).not.toBe(urlHash('https://exemplo.com.br/b'));
  });

  it('URL recusada não tem hash', () => {
    expect(urlHash('javascript:alert(1)')).toBeNull();
  });

  // O rascunho da notícia já tem a URL normalizada e só calcula o hash dela, sem normalizar de novo nem "!" no resultado.
  it('hashOfNormalized dá o mesmo hash que urlHash para a URL já normalizada, e normalizar duas vezes não muda nada', () => {
    const url = normalizeUrl('https://EXEMPLO.com.br/materia/?utm_source=rss&b=2&a=1#x')!;
    expect(hashOfNormalized(url)).toBe(urlHash(url));
    expect(normalizeUrl(url)).toBe(url);
  });
});
