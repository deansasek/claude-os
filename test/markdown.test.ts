// The Markdown renderer for Claude's replies (src/core/web/markdown.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
// dom.ts reads the page's location when it loads (the renderer only uses its esc helper), so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { markdown } = await import('../src/core/web/markdown.ts');

test('raw HTML in a reply is escaped, not made into markup', () => {
  const html = markdown('<img src=x onerror=alert(1)> and <script>alert(2)</script>');
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<script'), false);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('text and code spans are escaped', () => {
  assert.ok(markdown('Tom & Jerry < 3 > 2').includes('Tom &amp; Jerry &lt; 3 &gt; 2'));
  assert.equal(markdown('`<b>x</b>`'), '<p><code>&lt;b&gt;x&lt;/b&gt;</code></p>');
  assert.ok(markdown('```\n<i>raw</i>\n```').includes('&lt;i&gt;raw&lt;/i&gt;'));
});

test('a javascript: link is not made into a link', () => {
  const html = markdown('[click me](javascript:alert(1))');
  assert.equal(html.includes('data-href'), false);
  assert.equal(html.includes('md-link'), false);
  assert.ok(html.includes('click me'));
});

test('a data: link is not made into a link', () => {
  const html = markdown('[open](data:text/html;base64,PHNjcmlwdD4=)');
  assert.equal(html.includes('data-href'), false);
  assert.equal(html.includes('data:'), false);
  assert.ok(html.includes('open'));
});

test('a mailto: link and a bare javascript: address are not links', () => {
  assert.equal(markdown('[mail](mailto:a@example.com)').includes('data-href'), false);
  assert.equal(markdown('javascript:alert(1)').includes('data-href'), false);
});

test('an https link is a button with its href, and an attribute cannot break out of it', () => {
  const html = markdown('[docs](https://example.com/a?b=1)');
  assert.ok(html.includes('<button class="md-link" type="button" data-href="https://example.com/a?b=1">docs</button>'));
  const quoted = markdown('[x](https://example.com/"onmouseover="alert(1))');
  assert.equal(quoted.includes('onmouseover="'), false);
});
