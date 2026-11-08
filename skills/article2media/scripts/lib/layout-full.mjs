// "full" layout (-f): the original article, verbatim, as a long reading image.
// The design acts on typography only — every visible sentence of the source appears exactly once, in order.
//
//   article.md ─ parseBlocks ─▶ ledger [{id, kind, text, html}] ─▶ HTML (data-source-block on every leaf block)
//                                         └─ verifyInPage(): DOM textContent must equal the ledger, block for block
// A second check guards the parser itself: the concatenated ledger text must equal the source's plain text.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { esc } from './markup.mjs';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Split YAML-ish front matter (fetch.mjs output) from the body. */
export function frontMatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');
  }
  return { meta, body: src.slice(m[0].length) };
}

// ---------- inline markdown → { text, html } (text = what the reader sees) ----------
function inline(s) {
  let text = '', html = '';
  let i = 0;
  const push = (t, h) => { text += t; html += h ?? esc(t); };
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    // ***bold italic*** (X articles export it next to plain italics, e.g. "-* ***good content****.*")
    if ((m = rest.match(/^\*\*\*([^*]+?)\*\*\*/)) || (m = rest.match(/^___([^_]+?)___/))) { const r = inline(m[1]); text += r.text; html += `<strong><em>${r.html}</em></strong>`; i += m[0].length; continue; }
    if ((m = rest.match(/^\*\*([^*]+?)\*\*/)) || (m = rest.match(/^__([^_]+?)__/))) { const r = inline(m[1]); text += r.text; html += `<strong>${r.html}</strong>`; i += m[0].length; continue; }
    if ((m = rest.match(/^\*([^*\s][^*]*?)\*/)) || (m = rest.match(/^_([^_\s][^_]*?)_(?![A-Za-z0-9])/))) { const r = inline(m[1]); text += r.text; html += `<em>${r.html}</em>`; i += m[0].length; continue; }
    if ((m = rest.match(/^`([^`]+)`/))) { push(m[1], `<code>${esc(m[1])}</code>`); i += m[0].length; continue; }
    if ((m = rest.match(/^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/))) { const r = inline(m[1]); text += r.text; html += `<span class="link">${r.html}</span>`; i += m[0].length; continue; }
    if ((m = rest.match(/^\\([\\`*_{}\[\]()#+\-.!>])/))) { push(m[1]); i += 2; continue; }
    push(s[i]); i += 1;
  }
  return { text, html };
}

/**
 * Markdown body → ordered blocks. kinds: h1 h2 h3 p quote li code th td figure caption break.
 * A paragraph that is entirely bold (common in X articles: "**自我介绍**") becomes an h2 with the same text.
 */
export function parseBlocks(body, { title } = {}) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let n = 0;
  const add = (kind, text, html, extra = {}) => { blocks.push({ id: `b${String(++n).padStart(3, '0')}`, kind, text, html, ...extra }); };
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    const raw = para.join('\n');
    para = [];
    const bold = raw.match(/^\*\*([^*]+)\*\*$/);
    const r = inline(raw);
    if (bold && r.text.length <= 40) add('h2', r.text, inline(bold[1]).html, { fromBold: true });
    else add('p', r.text, r.html); // in-paragraph line breaks stay as text; CSS white-space: pre-line shows them
  };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (/^\s*$/.test(line)) { flushPara(); i++; continue; }
    if ((m = line.match(/^```(\w*)\s*$/))) {
      flushPara();
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      const t = code.join('\n');
      add('code', t, esc(t), { lang: m[1] });
      continue;
    }
    if ((m = line.match(/^(#{1,3})\s+(.*?)\s*#*\s*$/))) {
      flushPara();
      const r = inline(m[2]);
      add(`h${m[1].length}`, r.text, r.html);
      i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); add('break', '', ''); i++; continue; }
    if ((m = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/))) {
      flushPara();
      add('figure', '', '', { src: m[2], alt: m[1] });
      // Markdown has no caption syntax; an *italic* line right after an image is treated as its caption.
      const nx = lines[i + 1] || '';
      const cap = nx.match(/^\s*[*_]([^*_].*?)[*_]\s*$/);
      if (cap) { const r = inline(cap[1]); add('caption', r.text, r.html); i += 2; } else i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      for (const part of q.join('\n').split(/\n\s*\n/)) { const r = inline(part.trim()); if (r.text) add('quote', r.text, r.html); }
      continue;
    }
    if ((m = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
      flushPara();
      const ordered = /\d/.test(m[1]);
      const items = [];
      while (i < lines.length) {
        const mm = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (mm) { items.push({ marker: mm[1], text: mm[2] }); i++; continue; }
        if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1].text += '\n' + lines[i].trim(); i++; continue; }
        break;
      }
      items.forEach((it, k) => { const r = inline(it.text); add('li', r.text, r.html, { ordered, marker: ordered ? it.marker : '', first: k === 0, last: k === items.length - 1 }); });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      flushPara();
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
      const tableId = `t${n}`;
      head.forEach((c, k) => { const r = inline(c); add('th', r.text, r.html, { table: tableId, col: k, rowIndex: -1, cols: head.length }); });
      rows.forEach((rw, ri) => rw.forEach((c, k) => { const r = inline(c); add('td', r.text, r.html, { table: tableId, col: k, rowIndex: ri, cols: head.length }); }));
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  // The front-matter title usually repeats as the first "# …" line; the article title appears once.
  if (title && blocks[0]?.kind === 'h1' && blocks[0].text.trim() === title.trim()) blocks[0].isTitle = true;
  return blocks.filter((b) => b.kind === 'figure' || b.kind === 'break' || b.text.length);
}

/** Plain text of the source as a reader sees it (markdown syntax removed), for the parser coverage check. */
export function sourcePlain(body) {
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/^```.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{2,}[-:|\s]*$/gm, '')
    .replace(/\|/g, '')
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*/g, '$1$2')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1');
}
export const squash = (s) => String(s).replace(/\s+/g, '');

/** Ledger blocks → document HTML (leaf blocks carry data-source-block; figures and breaks carry no text). */
export function blocksHtml(blocks, { images = {} } = {}) {
  let out = '';
  let k = 0;
  const firstP = blocks.findIndex((b) => b.kind === 'p');
  while (k < blocks.length) {
    const b = blocks[k];
    const attr = `data-source-block="${b.id}"`;
    if (b.kind === 'li') {
      const tag = b.ordered ? 'ol' : 'ul';
      out += `<${tag}>`;
      while (k < blocks.length && blocks[k].kind === 'li' && blocks[k].ordered === b.ordered) {
        const it = blocks[k];
        out += `<li${it.ordered && it.marker ? ` value="${parseInt(it.marker, 10) || ''}"` : ''}><span data-source-block="${it.id}">${it.html}</span></li>`;
        k++;
        if (blocks[k - 1].last) break;
      }
      out += `</${tag}>`;
      continue;
    }
    if (b.kind === 'th' || b.kind === 'td') {
      const t = b.table;
      const cells = [];
      while (k < blocks.length && blocks[k].table === t) cells.push(blocks[k++]);
      const head = cells.filter((c) => c.kind === 'th');
      const rows = [];
      for (const c of cells.filter((c) => c.kind === 'td')) (rows[c.rowIndex] ||= []).push(c);
      out += `<div class="full-table"><table><thead><tr>${head.map((c) => `<th data-source-block="${c.id}">${c.html}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td data-source-block="${c.id}">${c.html}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    switch (b.kind) {
      case 'h1': out += `<h1 ${attr}${b.isTitle ? ' class="full-title"' : ''}>${b.html}</h1>`; break;
      case 'h2': out += `<h2 ${attr}>${b.html}</h2>`; break;
      case 'h3': out += `<h3 ${attr}>${b.html}</h3>`; break;
      case 'p': out += `<p ${attr}${k === firstP ? ' class="opening"' : ''}>${b.html}</p>`; break;
      case 'quote': out += `<blockquote ${attr}>${b.html}</blockquote>`; break;
      case 'code': out += `<pre ${attr}>${b.html}</pre>`; break;
      case 'break': out += `<hr class="section-break">`; break;
      case 'figure': {
        const cap = blocks[k + 1]?.kind === 'caption' ? blocks[k + 1] : null;
        out += `<figure class="source-figure"><img src="${esc(images[b.src] || b.src)}" alt="${esc(b.alt || '原文配图')}">${cap ? `<figcaption data-source-block="${cap.id}">${cap.html}</figcaption>` : ''}</figure>`;
        if (cap) k++;
        break;
      }
      case 'caption': out += `<p class="caption" ${attr}>${b.html}</p>`; break;
    }
    k++;
  }
  return out;
}

/** The ledger as the verifier expects it (text blocks only). */
export const ledgerOf = (blocks) => blocks.filter((b) => b.kind !== 'figure' && b.kind !== 'break').map((b) => ({ id: b.id, text: b.text }));

/** Runs in the page: read back every source block, nested ids and stray text inside .full-document. */
export function readbackInPage() {
  const doc = document.querySelector('.full-document');
  const els = [...doc.querySelectorAll('[data-source-block]')];
  const nested = els.filter((e) => e.parentElement.closest('[data-source-block]')).map((e) => e.dataset.sourceBlock);
  let stray = 0;
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = walker.nextNode())) {
    if (!t.textContent.trim()) continue;
    if (!t.parentElement.closest('[data-source-block]')) stray += t.textContent.trim().length;
  }
  // Visual order must follow DOM order: block tops should never go backwards.
  let backwards = 0, last = -1;
  for (const e of els) { const y = e.getBoundingClientRect().top; if (y + 1 < last) backwards++; last = Math.max(last, y); }
  return { blocks: els.map((e) => ({ id: e.dataset.sourceBlock, text: e.textContent })), nested, stray, backwards };
}

/** Compare the ledger with the DOM readback. Returns a list of failures (empty = pass). */
export function compareLedger(expected, rb) {
  const f = [];
  const actual = rb.blocks;
  if (expected.length !== actual.length) f.push(`块数不一致：原文 ${expected.length}，页面 ${actual.length}`);
  const n = Math.min(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i].id !== actual[i].id) { f.push(`第 ${i + 1} 块顺序或编号不对：应为 ${expected[i].id}，实为 ${actual[i].id}`); continue; }
    if (expected[i].text !== actual[i].text) {
      const a = expected[i].text, b = actual[i].text;
      let p = 0; while (p < a.length && a[p] === b[p]) p++;
      f.push(`${expected[i].id} 文字不一致（第 ${p + 1} 个字起）：原文「${a.slice(Math.max(0, p - 6), p + 10)}」，页面「${b.slice(Math.max(0, p - 6), p + 10)}」`);
    }
  }
  const seen = new Set();
  for (const b of actual) { if (seen.has(b.id)) f.push(`${b.id} 在页面中重复`); seen.add(b.id); }
  if (rb.nested.length) f.push(`嵌套的原文块：${rb.nested.join(', ')}`);
  if (rb.stray) f.push(`正文区有 ${rb.stray} 个字不属于任何原文块`);
  if (rb.backwards) f.push(`${rb.backwards} 处视觉顺序与原文顺序不一致`);
  return f;
}

export function buildFullPage({ blocks, meta, themeCss, fullCss, images, brand, useTheme }) {
  const source = [meta.author && `${meta.author}${meta.handle ? `（${meta.handle}）` : ''}`, meta.platform, meta.date].filter(Boolean).join(' · ');
  const brandLine = [brand?.name, brand?.handle].filter(Boolean).join(' ');
  // Mostly-Latin sources (an English article) get a Latin serif first and ragged-right text:
  // CJK fonts draw ’ “ ” full-width ("It’ s") and justified English opens wide gaps.
  const all = blocks.map((b) => b.text || '').join('');
  const cjk = (all.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length, latin = (all.match(/[A-Za-z]/g) || []).length;
  const isLatin = latin > 0 && cjk < latin * 0.1;
  return `<!doctype html>
<html lang="${isLatin ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><title>${esc(meta.title || '全文')} · 全文</title>
<style>${fullCss}</style>
${useTheme ? `<style>${themeCss}</style><style>.full-page{--paper:var(--bg);--ink:var(--ink);--muted:var(--muted);--accent:var(--accent-1);--display:var(--font-head);--body:var(--font-body);}</style>` : ''}
</head><body>
<div class="full-page${isLatin ? ' full-latin' : ''}">
<main class="full-document">${blocksHtml(blocks, { images })}</main>
<footer class="full-foot"><span class="full-src">${esc(source)}${meta.url ? `<br>${esc(meta.url)}` : ''}</span>${brandLine ? `<span class="full-brand">${esc(brandLine)}</span>` : ''}</footer>
</div>
</body></html>`;
}

/** Download remote source images next to the article, so the capture never depends on the network. */
export async function localizeImages(blocks, dir) {
  const map = {};
  for (const b of blocks.filter((x) => x.kind === 'figure' && /^https?:/.test(x.src))) {
    try {
      const name = sha256(b.src).slice(0, 12) + (b.src.match(/\.(png|jpe?g|webp|gif)(\?|$)/i)?.[0].replace(/\?$/, '') || '.img');
      const file = `${dir}/${name}`;
      if (!fs.existsSync(file)) {
        const res = await fetch(b.src, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(String(res.status));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
      map[b.src] = `file://${file}`;
    } catch { /* keep the remote URL; the capture's image check will report a failure */ }
  }
  return map;
}
