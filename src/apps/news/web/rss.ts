// Pure RSS 2.0 and Atom parser for the News app. Shared by the PC route and the tests. It never throws:
// broken XML gives fewer stories, and a missing field gives null or an empty string.
import type { NewsItem } from '../api.ts';

export interface FeedSource { id: string; name: string }

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Replace &amp;, &#39;, &#x2019; and the like. Unknown names stay as they are. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] !== '#') return NAMED[name.toLowerCase()] ?? whole;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// Inner text of a block as plain text: CDATA unwrapped, tags removed, entities decoded, spaces collapsed.
function plainText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // some feeds send the summary as escaped HTML ("&lt;p&gt;Ships return&lt;/p&gt;"): the tags show only after decoding, so strip them again
  return decodeEntities(unwrapped.replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// The plain text of the first <tag> in a block. A self-closing tag (<link href="…"/>) does not count.
function tagText(block: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*?)?(?<!/)>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(block);
  return m ? plainText(m[1]) : '';
}

function isHttpUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text);
}

function linkOf(block: string): string | null {
  const text = tagText(block, 'link');   // RSS: <link>https://…</link>
  if (isHttpUrl(text)) return text;
  const href = /<link\b[^>]*?\bhref=["']([^"']+)["']/i.exec(block)?.[1];   // Atom: <link href="…"/>
  const url = href ? decodeEntities(href).trim() : '';
  return isHttpUrl(url) ? url : null;
}

function dateOf(block: string): string | null {
  for (const tag of ['pubDate', 'published', 'updated', 'dc:date']) {
    const ms = Date.parse(tagText(block, tag));
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

function attr(tagHtml: string, name: string): string {
  const value = new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tagHtml)?.[1] ?? '';
  return decodeEntities(value).trim();
}

// An image from media:thumbnail, a media:content that is an image, an image enclosure, or the first <img> in the item.
function imageOf(block: string): string | null {
  for (const m of block.matchAll(/<(media:thumbnail|media:content|enclosure)\b[^>]*>/gi)) {
    const kind = m[1].toLowerCase();
    const url = attr(m[0], 'url');
    const type = attr(m[0], 'type') || attr(m[0], 'medium');
    const isImage = kind === 'media:thumbnail' || /^image\b/i.test(type) || (kind === 'media:content' && !type);
    if (isImage && isHttpUrl(url)) return url;
  }
  const img = /<img\b[^>]*?\bsrc=["']([^"']+)["']/i.exec(block)?.[1];
  const src = img ? decodeEntities(img).trim() : '';
  return isHttpUrl(src) ? src : null;
}

// The raw inside of every <item> (RSS) or <entry> (Atom). A block stops at the next item opener, so an item
// with no closing tag is skipped and does not swallow the items after it.
function itemBlocks(xml: string): string[] {
  return [...xml.matchAll(/<(item|entry)\b[^>]*>((?:(?!<(?:item|entry)\b)[\s\S])*?)<\/\1\s*>/gi)].map(m => m[2]);
}

/** The stories in one feed, in feed order. A story needs a title or a link; the rest may be missing. */
export function parseFeed(xml: string, source: FeedSource): NewsItem[] {
  if (typeof xml !== 'string') return [];
  const items: NewsItem[] = [];
  for (const block of itemBlocks(xml)) {
    const title = tagText(block, 'title');
    const link = linkOf(block);
    if (!title && !link) continue;
    const summary = tagText(block, 'description') || tagText(block, 'summary') || tagText(block, 'content');
    items.push({
      id: link || title,
      title,
      link,
      published: dateOf(block),
      description: summary,   // the feed's own words: never cut or summarised
      image: imageOf(block),
      source: source.name,
      sourceId: source.id,
    });
  }
  return items;
}

/** Newest first. Stories with no date go last, in their original order. Returns a new array. */
export function sortNewest(items: NewsItem[]): NewsItem[] {
  const time = (item: NewsItem) => (item.published ? Date.parse(item.published) : -Infinity);
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => (time(b.item) - time(a.item)) || (a.index - b.index))
    .map(entry => entry.item);
}
