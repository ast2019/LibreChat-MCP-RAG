import { injectAppTitleBootstrap } from './appTitle';

const shell = [
  '<html><head>',
  '<meta name="apple-mobile-web-app-title" content="HiveGPT" />',
  '<meta name="application-name" content="HiveGPT" />',
  '<title>HiveGPT</title>',
  '</head><body><div id="root"></div></body></html>',
].join('');

describe('injectAppTitleBootstrap', () => {
  it('names the document and hands the title to the first render', () => {
    const html = injectAppTitleBootstrap(shell, 'HiveLINK');

    expect(html).toContain('<title>HiveLINK</title>');
    expect(html).toContain('<meta name="application-name" content="HiveLINK" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="HiveLINK" />');
    expect(html).toContain('"appTitle":"HiveLINK"');
    expect(html).not.toContain('HiveGPT');
  });

  it('escapes markup in the title', () => {
    const html = injectAppTitleBootstrap(shell, '<b>A&B</b> "$&"');

    expect(html).toContain('<title>&lt;b&gt;A&amp;B&lt;/b&gt; &quot;$&amp;&quot;</title>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('\\u003cb>A&B\\u003c/b>');
  });

  it('leaves the shell as built without a title', () => {
    expect(injectAppTitleBootstrap(shell, '')).toBe(shell);
    expect(injectAppTitleBootstrap(shell, '   ')).toBe(shell);
    expect(injectAppTitleBootstrap(shell, undefined)).toBe(shell);
  });

  it('injects once when applied twice', () => {
    const twice = injectAppTitleBootstrap(injectAppTitleBootstrap(shell, 'HiveLINK'), 'HiveLINK');

    expect(twice.match(/data-librechat-app-title/g)).toHaveLength(1);
  });
});
