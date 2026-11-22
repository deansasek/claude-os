// A small, safe Markdown renderer for showing Claude's replies. Every piece of text is escaped before it
// becomes HTML, then paragraphs, headings, nested lists, quotes, rules, tables and code blocks are formatted,
// with inline code, bold and italics. Links become <button class="md-link" data-href> (only http and https; other
// schemes and mailto: show as text), so a tap never navigates: the screen that shows them opens the Browser (reply.ts).
// Code blocks come with a Copy button; the click is handled in the screen that shows them (reply.ts).
import { esc } from './dom.ts';

const LIST = /^(\s*)([-*•+]|\d+[.)])\s+(.*)$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** The URL as a link target, or '' when it is not a plain web address (javascript:, data:, mailto:, relative...). */
function webHref(url: string): string {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}

/** Bold and italics, on text that is already escaped. */
function marks(h: string): string {
  return h
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
}

/** Formats one piece of text. Code spans and links are held aside as placeholders first, so the marks never
 *  touch a URL or a link's markup; everything else is escaped, then the marks run, then the held pieces go back. */
function fmt(s: string): string {
  const held: string[] = [];
  const hold = (html: string): string => `\u0001${held.push(html) - 1}\u0001`;
  const restore = (h: string): string => h.replace(/\u0001(\d+)\u0001/g, (_, i: string) => restore(held[Number(i)]));
  const link = (inner: string, href: string): string =>
    `<button class="md-link" type="button" data-href="${esc(href)}">${inner}</button>`;

  const t = s.replace(/\u0001/g, '')
    .replace(/`([^`]+)`/g, (_m, c: string) => hold(`<code>${esc(c)}</code>`))
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_m, text: string, url: string) => {
      const href = webHref(url);
      return href ? hold(link(marks(esc(text)), href)) : text;   // not a web link: the text alone
    })
    .replace(/https?:\/\/[^\s<>"'`\u0001]+/g, (m: string) => {
      const url = m.replace(/[.,;:!?*_)\]]+$/, '');   // a sentence's punctuation or emphasis is not part of the link
      const href = webHref(url);
      return href ? hold(link(esc(url), href)) + m.slice(url.length) : m;
    });
  return restore(marks(esc(t)));
}

interface Li { indent: number; ordered: boolean; text: string }

/** A list, with the items indented under a parent item nested inside it. */
function listHtml(items: Li[]): string {
  const tag = items[0].ordered ? 'ol' : 'ul';
  const base = items[0].indent;
  let html = `<${tag}>`;
  for (let i = 0; i < items.length;) {
    let j = i + 1;
    while (j < items.length && items[j].indent > base) j++;
    const sub = items.slice(i + 1, j);
    html += `<li>${fmt(items[i].text)}${sub.length ? listHtml(sub) : ''}</li>`;
    i = j;
  }
  return html + `</${tag}>`;
}

function tableHtml(head: string[], rows: string[][]): string {
  const th = head.map(c => `<th>${fmt(c)}</th>`).join('');
  const tb = rows.map(r => `<tr>${r.map(c => `<td>${fmt(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="md-tbl"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

/** Does a table start at line i (a row with | and a separator row under it)? */
const tableAt = (R: string[], i: number): boolean =>
  R[i].includes('|') && i + 1 < R.length && R[i + 1].includes('|') && SEP.test(R[i + 1]);

/** Does a block start at line i? (a paragraph ends there) */
const startsBlock = (R: string[], i: number): boolean =>
  HR.test(R[i]) || HEAD.test(R[i]) || QUOTE.test(R[i]) || LIST.test(R[i]) || tableAt(R, i);

function block(text: string): string {
  const R = text.split('\n').map(l => l.replace(/\s+$/, ''));
  const out: string[] = [];
  let i = 0;
  while (i < R.length) {
    const line = R[i];
    if (!line.trim()) { i++; continue; }

    if (HR.test(line)) { out.push('<hr>'); i++; continue; }

    const h = line.match(HEAD);
    if (h) {
      const lv = h[1].length <= 2 ? 4 : 5;
      out.push(`<h${lv}>${fmt(h[2])}</h${lv}>`);
      i++; continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < R.length && QUOTE.test(R[i])) { inner.push(R[i].replace(QUOTE, '$1')); i++; }
      out.push(`<blockquote>${block(inner.join('\n'))}</blockquote>`);
      continue;
    }

    if (tableAt(R, i)) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < R.length && R[i].trim() && R[i].includes('|')) { rows.push(cells(R[i])); i++; }
      out.push(tableHtml(head, rows));
      continue;
    }

    if (LIST.test(line)) {
      const items: Li[] = [];
      while (i < R.length) {
        const m = R[i].match(LIST);
        if (m) { items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] }); i++; continue; }
        if (items.length && /^\s{2,}\S/.test(R[i])) { items[items.length - 1].text += ' ' + R[i].trim(); i++; continue; }
        break;
      }
      out.push(listHtml(items));
      continue;
    }

    const para = [line.trim()];
    i++;
    while (i < R.length && R[i].trim() && !startsBlock(R, i)) { para.push(R[i].trim()); i++; }
    out.push(`<p>${fmt(para.join(' '))}</p>`);
  }
  return out.join('');
}

/** A fenced code block: a soft card with the language and a Copy button; the code scrolls sideways. */
function codeHtml(part: string): string {
  const m = part.match(/^([\w+#.-]{0,24})\n/);
  const lang = m ? m[1] : '';
  const body = (m ? part.slice(m[0].length) : part).replace(/\n$/, '');
  return `<div class="md-code"><div class="md-code-hd"><span>${esc(lang)}</span>`
    + `<button class="md-copy" type="button" data-copy-code aria-label="Copy code">Copy</button></div>`
    + `<pre><code>${esc(body)}</code></pre></div>`;
}

export function markdown(src: string): string {
  // split out fenced code first so nothing inside it gets formatted
  return src.split(/```/).map((part, i) => (i % 2 === 1 ? codeHtml(part) : block(part))).join('');
}
