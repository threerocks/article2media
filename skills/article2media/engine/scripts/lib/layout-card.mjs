// "card" layout: fixed-ratio cards for carousels (小红书 3:4, Instagram 4:5, 1:1, 9:16), 540 CSS px wide → 1080 px at 2x.
// Same content.json as the long layout; optional `cover`, `xhs` and per-section `card` hints refine it.
import { esc, md, pad2, plain, vlen } from './markup.mjs';
import { renderFigure } from './figures.mjs';
import { LABELS, accVar, panelBlock } from './layout-long.mjs';
import { coverIllustrationSrc, coverIllustrationAspect } from './illustrations.mjs';

export const RATIOS = {
  '3:4': { w: 540, h: 720, limit: 18, name: '小红书 / 3:4' }, // 小红书 allows at most 18 images per note
  '4:5': { w: 540, h: 675, limit: 20, name: 'Instagram / 4:5' },
  '1:1': { w: 540, h: 540, limit: 20, name: '方图 / 1:1' },
  '9:16': { w: 540, h: 960, limit: 20, name: '竖屏 / 9:16' },
};
export function ratioSpec(r = '3:4') {
  const spec = RATIOS[r];
  if (!spec) throw new Error(`不支持的比例 ${r}，可用：${Object.keys(RATIOS).join('、')}`);
  // Usable height of .c-body is the card height minus padding, header and footer (measured: 720 → 613).
  return { ...spec, key: r, slug: r.replace(':', 'x'), budget: spec.h - 124 };
}

// Rough height estimates (CSS px) used to pack checklist stages into cards.
// They mirror card.css; QA still measures the real layout afterwards.
const lines = (text, perLine) => Math.max(1, Math.ceil(vlen(text || '') / perLine));
const headH = (s, first) =>
  36 + // label pill + gap
  (first ? 37 : 28) * Math.max(String(s.heading || '').split('\n').length, lines(String(s.heading || '').replace(/\n/g, ''), first ? 16 : 21)) +
  12 +
  (first ? (s.paragraphs || []).slice(0, 1).reduce((h, p) => h + 29 * lines(p, 28) + 12, 0) : 0);
const stageH = (st) =>
  22 + 26 + (st.items || []).reduce((h, t) => h + 21.7 * lines(t, 29) + 4, 0) + (st.done ? 12 + 19 * lines(st.done, 33) : 0) + 10;
const guardH = (g) => 30 + 32 + (g.items || []).reduce((h, t) => h + 22.5 * lines(t, 27) + 8, 0) + (g.note ? 26 : 0) + 12;

// Split stages into the fewest cards that fit, then pick the most even split
// (the guard block, if any, rides on the last card). At most 6 stages, so brute force is cheap.
function packStages(s, num, k, budget) {
  const stages = s.stages || [];
  const hs = stages.map(stageH);
  const g = s.guard ? guardH(s.guard) : 0;
  const n = stages.length;
  const fill = (from, to, first, last) => headH(s, first) + hs.slice(from, to).reduce((a, b) => a + b, 0) + (last ? g : 0);

  // All ways to cut [0, n) into `parts` contiguous groups; the last group may be empty (guard only).
  function* cuts(parts, start = 0) {
    if (parts === 1) { yield [[start, n]]; return; }
    for (let end = start + 1; end <= n; end++) for (const rest of cuts(parts - 1, end)) yield [[start, end], ...rest];
  }

  for (let parts = 1; parts <= Math.max(1, n + (g ? 1 : 0)); parts++) {
    let best = null;
    for (const groups of cuts(parts)) {
      const used = groups.map(([a, b], i) => fill(a, b, i === 0, i === groups.length - 1));
      if (used.some((u) => u > budget)) continue;
      const spread = Math.max(...used) - Math.min(...used);
      if (!best || spread < best.spread) best = { groups, spread };
    }
    if (best) {
      return best.groups.map(([from, to], i) => ({
        kind: from === to ? 'guard' : 'stages', s, num, k, from, to, first: i === 0,
        guard: !!g && i === best.groups.length - 1 && from !== to,
      }));
    }
  }
  // Nothing fits (a single huge stage): one stage per card and let QA report the overflow.
  const out = stages.map((_, i) => ({ kind: 'stages', s, num, k, from: i, to: i + 1, first: i === 0 }));
  if (g) out.push({ kind: 'guard', s, num, k });
  return out.length ? out : [{ kind: 'stages', s, num, k, from: 0, to: 0, first: true }];
}

const CL = {
  zh: {
    kicker: (n) => `长文拆解 · ${n} 张图读完`,
    toc: '这组图讲了',
    cont: '续',
    recap: '全文要点',
    cta: '收藏这组图，用的时候翻出来',
    credit: (s) => `原文｜${[s.author, s.handle].filter(Boolean).join(' ')}${s.platform ? ` · ${s.platform}` : ''}`,
  },
  en: {
    kicker: (n) => `Long read · ${n} cards`,
    toc: 'Inside',
    cont: 'cont.',
    recap: 'Key takeaways',
    cta: 'Save this for later',
    credit: (s) => `Source: ${[s.author, s.handle].filter(Boolean).join(' ')}${s.platform ? ` · ${s.platform}` : ''}`,
  },
};

/** Decide which cards to make, in order. Shared by the builder and the validator. */
export function planCards(content, ratio = '3:4', budgetAdjust = 0) {
  const budget = ratioSpec(ratio).budget - budgetAdjust;
  const plan = [{ kind: 'cover' }];
  let num = 0;
  for (const pg of content.pages || []) {
    for (const s of pg.sections || []) {
      num += 1;
      const k = num - 1;
      if (s.kind === 'checklist') {
        plan.push(...packStages(s, num, k, budget));
        continue;
      }
      const mode = s.card?.mode || 'single';
      if (mode === 'skip') continue;
      plan.push({ kind: 'sec', s, num, k, part: 1, split: mode === 'split' });
      if (mode === 'split') plan.push({ kind: 'sec', s, num, k, part: 2, split: true });
    }
  }
  plan.push({ kind: 'end' });
  return plan;
}

// data-drop marks optional elements; window.__fit hides them in ascending order when a card overflows.
const drop = (order, name) => ` data-drop="${order}" data-drop-name="${name}"`;

function figBlock(f, id, capOrder = 2) {
  if (!f) return '';
  return (
    `<figure class="c-fig" data-fig="${id}"${drop(9, '图')}><div class="c-fig-card"><div class="c-fig-box"><div class="fig-canvas">${renderFigure(f)}</div></div></div>` +
    (f.caption ? `<figcaption class="c-cap" data-qa-text${drop(capOrder, '图注')}>${md(f.caption)}</figcaption>` : '') +
    `</figure>`
  );
}

function frame(inner, { idx, total, series, foot, cls = '', acc, kind }) {
  return (
    `<section class="card acc ${cls}" data-card="${idx}" data-kind="${kind}" style="--acc:${acc}">` +
    `<header class="c-top"><span>${md(series)}</span><span>${pad2(idx)} / ${pad2(total)}</span></header>` +
    `<div class="c-body">${inner}</div>` +
    `<footer class="c-foot"><span>${md(foot)}</span></footer>` +
    `</section>`
  );
}

function coverCard(c, L, total) {
  const cover = c.cover || {};
  const pages = c.pages || [];
  let points = cover.points;
  if (!points) {
    points = pages.length > 1
      ? pages.map((p) => String(p.part || '').replace(/^[^·]*·\s*/, ''))
      : (pages[0]?.sections || []).map((s) => plain(s.heading).replace(/\n/g, '')).slice(0, 6);
  }
  // With an AI cover illustration the picture takes the TOC's place.
  const ill = coverIllustrationSrc(c);
  return (
    `<div class="cv-kicker">${md(cover.kicker || L.kicker(total))}</div>` +
    `<h1 class="cv-title" data-qa-text>${md(cover.title || c.title)}</h1>` +
    `<div class="cv-rule"></div>` +
    (ill ? `<div class="cv-ill"><img src="${esc(ill)}" style="aspect-ratio:${coverIllustrationAspect(c)}" alt=""></div>` : '') +
    ((cover.subtitle ?? pages[0]?.intro) ? `<p class="cv-sub" data-qa-text${drop(2, '封面副标题')}>${md(cover.subtitle ?? pages[0].intro)}</p>` : '') +
    (ill ? '' : `<div class="cv-toc"${drop(1, '封面目录')}><div class="cv-toc-h">${esc(L.toc)}</div><ol>${points
      .filter(Boolean)
      .map((p, i) => `<li><i>${pad2(i + 1)}</i><span data-qa-text>${md(p)}</span></li>`)
      .join('')}</ol></div>`)
  );
}

function secCard(it, L) {
  const s = it.s;
  const card = s.card || {};
  const figs = s.figures || [];
  const label = `<div class="sec-label">${pad2(it.num)} · ${md(s.label || '')}${it.part === 2 ? ` · ${esc(L.cont)}` : ''}</div>`;
  const heading = `<h2 class="sec-h${it.part === 2 ? ' cont' : ''}" data-qa-text>${md(s.heading)}</h2>`;
  const fi = card.figure === 'none' ? -1 : Number.isInteger(card.figure) ? card.figure : 0;

  if (it.part === 2) {
    const other = figs.findIndex((_, j) => j !== fi);
    return label + heading + (other >= 0 ? figBlock(figs[other], `${it.num}${'AB'[other]}`, 1) : '') + panelBlock(s.panel);
  }
  const text = card.text ?? s.paragraphs?.[0];
  const bullets = card.bullets || [];
  return (
    label +
    heading +
    (text ? `<p class="c-text" data-qa-text${drop(5, '正文')}>${md(text)}</p>` : '') +
    (fi >= 0 && figs[fi] ? figBlock(figs[fi], `${it.num}${'AB'[fi]}`) : '') +
    (bullets.length ? `<ul class="c-bullets"${drop(1, '要点')}>${bullets.map((b) => `<li data-qa-text>${md(b)}</li>`).join('')}</ul>` : '') +
    (card.panel && !it.split && s.panel ? `<div${drop(3, '数据面板')}>${panelBlock(s.panel)}</div>` : '') +
    (s.takeaway ? `<p class="c-take" data-qa-text>${md(s.takeaway)}</p>` : '')
  );
}

function guardBlock(g) {
  return (
    `<div class="c-guard"><div class="c-guard-h">${md(g.title)}</div>` +
    `<ul>${(g.items || []).map((t) => `<li><i class="c-x">✕</i><span data-qa-text>${md(t)}</span></li>`).join('')}</ul>` +
    (g.note ? `<div class="c-guard-note"${drop(1, '护栏说明')}>${md(g.note)}</div>` : '') +
    `</div>`
  );
}

function stagesCard(it, L, nAcc) {
  const s = it.s;
  const label = `<div class="sec-label">${pad2(it.num)} · ${md(s.label || '')}${it.first ? '' : ` · ${esc(L.cont)}`}</div>`;
  const heading = `<h2 class="sec-h${it.first ? '' : ' cont'}" data-qa-text>${md(s.heading)}</h2>`;
  const intro = it.first ? (s.paragraphs || []).slice(0, 1).map((p) => `<p class="c-text" data-qa-text${drop(1, '清单导语')}>${md(p)}</p>`).join('') : '';
  const stages = (s.stages || []).slice(it.from, it.to).map((st, j) =>
    `<div class="c-stage acc" style="--acc:${accVar(it.k + it.from + j, nAcc)}">` +
    `<div class="c-stage-h"><small>${md(st.label || '')}</small><b>${md(st.title)}</b></div>` +
    `<ul>${(st.items || []).map((t) => `<li><i class="c-box"></i><span data-qa-text>${md(t)}</span></li>`).join('')}</ul>` +
    (st.done ? `<div class="c-done" data-qa-text><b>${esc(L.done)}</b>${md(st.done)}</div>` : '') +
    `</div>`).join('');
  return label + heading + intro + `<div class="c-stages">${stages}</div>` + (it.guard && s.guard ? guardBlock(s.guard) : '');
}

function guardCard(it, L) {
  const s = it.s;
  return (
    `<div class="sec-label">${pad2(it.num)} · ${md(s.label || '')} · ${esc(L.cont)}</div>` +
    `<h2 class="sec-h cont" data-qa-text>${md(s.heading)}</h2>` +
    guardBlock(s.guard) +
    (s.note ? `<p class="c-note"${drop(2, '清单说明')}>${md(s.note)}</p>` : '')
  );
}

function endCard(c, L, footnote) {
  const takeaways = (c.pages || []).flatMap((p) => (p.sections || []).map((s) => s.takeaway).filter(Boolean));
  const lastClosing = c.pages?.[c.pages.length - 1]?.closing;
  const summary = c.cover?.summary || lastClosing || '';
  return (
    `<div class="sec-label">${esc(L.recap)}</div>` +
    (summary ? `<h2 class="end-h" data-qa-text>${md(summary)}</h2>` : '') +
    `<ol class="end-list${takeaways.length > 9 ? ' dense' : ''}" data-shrink>${takeaways
      .map((t, i) => `<li><i>${pad2(i + 1)}</i><span data-qa-text>${md(t)}</span></li>`)
      .join('')}</ol>` +
    `<div class="end-src"${drop(1, '来源说明')}>${md(footnote)}</div>` +
    `<div class="end-cta"${drop(2, '收藏提示')}>${esc(c.cover?.cta || L.cta)}</div>`
  );
}

/**
 * Build one HTML document holding every card in a grid (also used as a contact sheet).
 * ctx: { content, brand, themeCss, componentsCss, layoutCss, nAcc, ratio }
 */
export function buildCards(ctx) {
  const { content: c, brand, themeCss, componentsCss, layoutCss, nAcc } = ctx;
  const R = ratioSpec(ctx.ratio || '3:4');
  const lang = c.lang === 'en' ? 'en' : 'zh';
  const L = { ...LABELS[lang], ...CL[lang] };
  const plan = planCards(c, R.key, ctx.budgetAdjust || 0);
  const total = plan.length;
  const series = c.series || brand.series || '';
  const editor = brand.editor || (lang === 'zh' ? '编者' : 'the editor');
  const footnote = c.footnote || (c.source ? L.footnote(c.source, editor) : '');
  const credit = c.source ? L.credit(c.source) : '';
  const brandFoot = [brand.name, brand.handle].filter(Boolean).join(' ');

  const cards = plan.map((it, i) => {
    const idx = i + 1;
    const base = { idx, total, series, foot: credit, kind: it.kind };
    switch (it.kind) {
      case 'cover':
        return frame(coverCard(c, L, total), { ...base, cls: 'c-cover', acc: accVar(0, nAcc), foot: [credit, brandFoot].filter(Boolean).join('　') });
      case 'sec':
        return frame(secCard(it, L), { ...base, cls: `c-sec${it.part === 2 ? ' c-sec-2' : ''}`, acc: accVar(it.k, nAcc) });
      case 'stages':
        return frame(stagesCard(it, L, nAcc), { ...base, cls: 'c-list', acc: accVar(it.k, nAcc) });
      case 'guard':
        return frame(guardCard(it, L), { ...base, cls: 'c-list', acc: accVar(it.k, nAcc) });
      case 'end':
        return frame(endCard(c, L, footnote), { ...base, cls: 'c-end', acc: accVar(0, nAcc), foot: brandFoot || credit });
    }
    return '';
  });

  const html = `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">
<title>${esc(plain(c.title).replace(/\n/g, ' '))} · cards</title>
<style>${componentsCss}</style>
<style>${layoutCss}</style>
<style>${themeCss}</style>
</head><body><main class="sheet r-${R.slug}" style="--card-w:${R.w}px;--card-h:${R.h}px">
${cards.join('\n')}
</main>
<script>
// Fit each card (also runs when this file is opened directly):
// 1) scale every figure canvas to the space its card leaves for it;
// 2) if the card still overflows, or its figure would be too small to read, hide optional
//    elements ([data-drop]) in ascending order and record what was dropped in data-dropped.
window.__fit = function () {
  function scale(root) {
    root.querySelectorAll('.c-fig-box').forEach(function (box) {
      var cv = box.querySelector('.fig-canvas');
      if (!cv) return;
      var bw = box.clientWidth, bh = box.clientHeight, cw = cv.offsetWidth, ch = cv.offsetHeight;
      if (!bw || !bh) { box.dataset.scale = '0'; return; }
      var z = Math.max(0.3, Math.min(1.6, bw / cw, bh / ch));
      cv.style.transform = 'translate(' + ((bw - cw * z) / 2).toFixed(1) + 'px, ' + ((bh - ch * z) / 2).toFixed(1) + 'px) scale(' + z.toFixed(3) + ')';
      box.dataset.scale = z.toFixed(2);
    });
  }
  // Cover titles: as large as possible while keeping the author's line breaks.
  document.querySelectorAll('.cv-title').forEach(function (t) {
    t.style.fontSize = '';
    var want = t.querySelectorAll('br').length + 1;
    var size = parseFloat(getComputedStyle(t).fontSize);
    var lh = function () { return parseFloat(getComputedStyle(t).lineHeight) || size * 1.16; };
    while (size > 36 && t.getBoundingClientRect().height > want * lh() + 2) {
      size -= 2; t.style.fontSize = size + 'px';
    }
  });
  document.querySelectorAll('.card').forEach(function (card) {
    var body = card.querySelector('.c-body');
    var drops = Array.prototype.slice.call(card.querySelectorAll('[data-drop]'));
    drops.forEach(function (e) { e.hidden = false; });
    drops.sort(function (a, b) { return a.dataset.drop - b.dataset.drop; });
    scale(card);
    function bad() {
      if (body.scrollHeight > body.clientHeight + 1) return true;
      var box = card.querySelector('.c-fig-box');
      return !!(box && !box.closest('[hidden]') && Number(box.dataset.scale) < 1);
    }
    // First try compacting ([data-shrink] → .shrink), then start dropping.
    var shr = card.querySelectorAll('[data-shrink]');
    shr.forEach(function (e) { e.classList.remove('shrink'); });
    if (bad()) shr.forEach(function (e) { e.classList.add('shrink'); });
    var dropped = [];
    for (var i = 0; i < drops.length && bad(); i++) {
      drops[i].hidden = true;
      dropped.push(drops[i].dataset.dropName);
      scale(card);
    }
    card.dataset.dropped = dropped.join('、');
  });
};
window.__fit();
document.fonts.ready.then(window.__fit);
</script>
</body></html>`;
  return { html, count: total };
}

// 小红书 titles are capped at 20 characters. Count every character as 1 (letters and spaces too)
// and cut at a natural break rather than mid-word.
export const xhsLen = (t) => [...String(t || '')].length;
function autoTitle(t) {
  const s = plain(t).replace(/\n/g, '').trim();
  if (xhsLen(s) <= 20) return s;
  const ch = [...s].slice(0, 20);
  // Prefer punctuation boundaries, then whitespace.
  for (const re of [/[：:，,、·—|｜]/, /\s/]) {
    for (let i = ch.length - 1; i >= 8; i--) if (re.test(ch[i])) return ch.slice(0, i).join('').trim();
  }
  return ch.slice(0, 19).join('') + '…';
}

/** Text for the 小红书 post itself (title, body, tags). */
export function buildCaption(c, count) {
  const x = c.xhs || {};
  const title = x.title || autoTitle(c.cover?.title || c.title);
  let body = x.caption;
  if (!body) {
    const heads = (c.pages || []).flatMap((p) => (p.sections || []).map((s) => plain(s.heading).replace(/\n/g, '')));
    body = [plain(c.pages?.[0]?.intro || ''), '', ...heads.map((h, i) => `${pad2(i + 1)} ${h}`)].join('\n');
  }
  // 小红书 hashtags end at whitespace, so strip it inside each tag.
  const tags = (x.tags || []).map((t) => '#' + String(t).replace(/^#/, '').replace(/\s+/g, '')).join(' ');
  // Hand-written captions credit the author themselves; only the auto summary gets a source line.
  const src = !x.caption && c.source
    ? `内容整理自 ${[c.source.author, c.source.handle && `（${c.source.handle}）`].filter(Boolean).join('')}${c.source.title ? `《${c.source.title}》` : ''}`
    : '';
  return [
    '# 标题', '', title, '',
    '# 正文', '', body.trim(), '', src, '', tags, '',
    '---', `图片：card-01.png … card-${pad2(count)}.png，按顺序上传。`,
    x.caption ? '' : '（正文为自动生成：建议在 content.json 的 xhs 字段里写一版更适合小红书的文案。）',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
