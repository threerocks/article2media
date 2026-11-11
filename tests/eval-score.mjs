#!/usr/bin/env node
// Score a finished "改写 → 卡片" work directory, so different models driving the skills can be compared.
//   node tests/eval-score.mjs <工作目录> [<工作目录> …] [--ref <参考工作目录>] [--json]
// A work directory holds article.md, content.json and a rendered card folder (<theme>-3x4/qa.json).
// The score is objective and repeatable (100 points); it does not judge taste. Pair it with a blind
// side-by-side review (tests/model-eval.md) before concluding one model is "as good" as another.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'skills', 'article2media', 'engine', 'scripts', 'lib');
const { validate } = await import(pathToFileURL(path.join(LIB, 'validate.mjs')).href);
const { sourceChecks, sourceImages, coverage } = await import(pathToFileURL(path.join(LIB, 'source-check.mjs')).href);
const { plain } = await import(pathToFileURL(path.join(LIB, 'markup.mjs')).href);

const args = process.argv.slice(2);
const json = args.includes('--json');
const refAt = args.indexOf('--ref');
const ref = refAt >= 0 ? path.resolve(args[refAt + 1]) : null;
const dirs = args.filter((a, i) => !a.startsWith('--') && !(refAt >= 0 && i === refAt + 1)).map((d) => path.resolve(d));
if (!dirs.length) { console.error('用法：node tests/eval-score.mjs <工作目录> … [--ref <参考工作目录>] [--json]'); process.exit(2); }

const clamp = (x) => Math.max(0, Math.min(1, x));
function* texts(o) {
  if (typeof o === 'string') yield o;
  else if (Array.isArray(o)) for (const v of o) yield* texts(v);
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!['src', 'url', 'source', 'footnote', 'theme', 'type', 'style'].includes(k)) yield* texts(v);
}

function score(dir) {
  const out = { dir, name: path.basename(dir), ok: true, notes: [] };
  const cPath = path.join(dir, 'content.json'), aPath = path.join(dir, 'article.md');
  if (!fs.existsSync(cPath) || !fs.existsSync(aPath)) return { ...out, ok: false, total: 0, notes: ['缺 content.json 或 article.md'] };
  const c = JSON.parse(fs.readFileSync(cPath, 'utf8'));
  const art = fs.readFileSync(aPath, 'utf8');

  // The rendered card set (newest <theme>-3x4 folder with a qa.json).
  const cardDirs = fs.readdirSync(dir).filter((d) => /-3x4$/.test(d) && fs.existsSync(path.join(dir, d, 'qa.json')))
    .sort((a, b) => fs.statSync(path.join(dir, b, 'qa.json')).mtimeMs - fs.statSync(path.join(dir, a, 'qa.json')).mtimeMs);
  const qaRaw = cardDirs.length ? JSON.parse(fs.readFileSync(path.join(dir, cardDirs[0], 'qa.json'), 'utf8')) : null;
  const issues = (Array.isArray(qaRaw) ? qaRaw : qaRaw?.report || [qaRaw]).flatMap((r) => r?.issues || []);
  const layoutErr = issues.filter((i) => i.level === 'error').length;
  const layoutWarn = issues.filter((i) => i.level !== 'error').length;
  const nCards = cardDirs.length ? fs.readdirSync(path.join(dir, cardDirs[0])).filter((f) => /^card-\d+\.png$/.test(f)).length : 0;

  const v = validate(c, { layout: 'card', ratio: '3:4' });
  const src = sourceChecks(c, art, {});
  const warns = [...v.warnings, ...src];
  if (!qaRaw) out.notes.push('没有出卡片');
  if (v.errors.length || layoutErr || !qaRaw) out.ok = false;

  // A. 版面 (20): what the renderer had to drop or shrink.
  const A = 20 * clamp(1 - 0.15 * layoutWarn);

  // B. 规则 (25): warnings left unhandled, weighted by how much they mislead a reader.
  const weight = (w) => (/第一人称/.test(w) ? 0.4 : /原文里找不到/.test(w) ? 0.2 : 0.1);
  const panelTitles = (c.pages || []).flatMap((p) => p.sections || []).map((s) => s.panel?.title).filter(Boolean);
  const untagged = panelTitles.filter((t) => !/·/.test(t)).length;
  const bangs = [...texts(c)].filter((t) => /[！!]/.test(plain(t).replace(/「[^」]*」|“[^”]*”|"[^"]*"/g, ''))).length;
  const B = 25 * clamp(1 - warns.reduce((a, w) => a + weight(w), 0) - 0.25 * untagged - 0.1 * bangs);

  // C. 深度 (25): panels, two figures per section, full-card rhythm, the article's own pictures, a checklist, a real cover.
  const std = (c.pages || []).flatMap((p) => p.sections || []).filter((s) => s.kind !== 'checklist');
  const panels = std.filter((s) => s.panel).length, wantPanels = Math.max(1, Math.ceil(std.length / 2));
  const figAvg = std.length ? std.reduce((a, s) => a + Math.min(2, (s.figures || []).length), 0) / std.length : 0;
  const styled = std.filter((s) => s.card?.style).length, wantStyled = Math.max(1, Math.round(std.length / 3.5));
  const imgs = sourceImages(art).length;
  const usedImg = std.some((s) => (s.figures || []).some((f) => f?.type === 'image'));
  const checklist = (c.pages || []).some((p) => (p.sections || []).some((s) => s.kind === 'checklist'));
  const cv = c.cover || {};
  const coverOk = !!(cv.title && (cv.subtitle || cv.number || cv.versus) && (cv.points?.length || cv.number || cv.versus || cv.style === 'quote'));
  const depth = [clamp(panels / wantPanels), clamp(figAvg / 2), clamp(styled / wantStyled), imgs >= 2 ? (usedImg ? 1 : 0) : 1, checklist ? 1 : 0, coverOk ? 1 : 0];
  const C = 25 * depth.reduce((a, b) => a + b, 0) / depth.length;

  // D. 覆盖 (20): how much of the article's specifics made it in — the numbers it states and the names it repeats
  // (same measure as the coverage hint in check.mjs).
  const cov = coverage(c, art);
  const numRecall = cov.numbers.share, termRecall = cov.terms.share;
  const D = 20 * (0.5 * numRecall + 0.5 * termRecall);

  // E. 交付 (10): the post itself.
  const x = c.xhs || {};
  const xLen = [...String(x.title || '')].length;
  const cap = String(x.caption || '').length;
  const tags = (x.tags || []).length;
  const alts = (c.publish?.titles?.xhs || []).length;
  const E = 2 * (x.title && xLen <= 20 ? 1 : 0) + 2 * (cap >= 150 && cap <= 1000 ? 1 : 0) + 2 * (tags >= 5 && tags <= 10 ? 1 : 0) + 2 * (alts >= 2 ? 1 : 0) + 2 * (coverOk ? 1 : 0);

  const total = out.ok ? A + B + C + D + E : 0;
  return {
    ...out, total: +total.toFixed(1),
    parts: { 版面: +A.toFixed(1), 规则: +B.toFixed(1), 深度: +C.toFixed(1), 覆盖: +D.toFixed(1), 交付: +E.toFixed(1) },
    facts: { 卡片: nCards, 版面提示: layoutWarn, 内容提示: warns.length, 面板: `${panels}/${wantPanels}`, 整页卡: `${styled}/${wantStyled}`, 每节图: +figAvg.toFixed(2), 原文配图: imgs >= 2 ? (usedImg ? '用了' : '没用') : '—', 清单: checklist ? '有' : '无', 数字召回: +numRecall.toFixed(2), 术语召回: +termRecall.toFixed(2), 无出处面板: untagged },
    warnings: warns,
  };
}

const rows = dirs.map(score);
const refRow = ref ? score(ref) : null;
if (json) { console.log(JSON.stringify({ rows, ref: refRow }, null, 2)); process.exit(0); }
const show = (r, tag = '') => {
  console.log(`\n${r.ok ? '✓' : '✗'} ${tag}${r.name}：${r.total} / 100${refRow && r !== refRow && refRow.total ? `（参考的 ${(100 * r.total / refRow.total).toFixed(1)}%）` : ''}`);
  if (r.parts) console.log('  ' + Object.entries(r.parts).map(([k, v]) => `${k} ${v}`).join(' · '));
  if (r.facts) console.log('  ' + Object.entries(r.facts).map(([k, v]) => `${k} ${v}`).join(' · '));
  for (const n of r.notes) console.log('  ✗ ' + n);
  for (const w of (r.warnings || []).slice(0, 6)) console.log('  ⚠ ' + w.slice(0, 120));
};
if (refRow) show(refRow, '参考 ');
rows.forEach((r) => show(r));
process.stdout.write('', () => process.exit(rows.every((r) => r.ok) ? 0 : 1));
