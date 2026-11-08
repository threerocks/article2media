#!/usr/bin/env node
// Render content.json into images with one or more themes, then run layout QA.
//
//   node render.mjs <content.json> [--ratio 3:4|4:5|1:1|9:16] [--layout long|xhs] [--theme 名称|a,b|all]
//                   [--out DIR] [--scale 2] [--format png|jpeg] [--quality 90] [--page 1,3]
//                   [--max-height 4400] [--brand brand.json] [--check] [--html-only]
//   node render.mjs --list            # list themes
//
// 版式：
//   默认               一页一张杂志风长图（1200 宽）           → <dir>/<theme>/page-01.png …
//   --ratio 3:4 等     固定比例卡片（1080 宽），--layout xhs = 3:4 → <dir>/<theme>-3x4/card-01.png …, overview.jpg, caption.md
//   --layout wechat    公众号图文：内联样式、图表转图片          → <dir>/<theme>-wechat/article.html、images/、封面、wechat.md
//   --layout full      原文全文排版（-f）：输入 article.md，逐字保真 → <dir>/full/full.png（过长时 full-01.png …）、ledger.json
//   --layout whiteboard 白板论证（-w）：先对 article.md 建来源清单，再渲染 whiteboard.json → <dir>/whiteboard/whiteboard.png
// 主题：--theme 优先；不传时用 content.json 的 "theme"；都没有时用 editorial。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { validate } from './lib/validate.mjs';
import { buildPage } from './lib/layout-long.mjs';
import { buildCards, buildCaption, ratioSpec } from './lib/layout-card.mjs';
import { buildWechatSource, buildWechatCovers, buildWechatPreview, buildWechatNotes, inlineInPage, wechatMeta } from './lib/layout-wechat.mjs';
import { resolveIllustrations } from './lib/illustrations.mjs';
import { qaInPage } from './lib/qa.mjs';
import { launchBrowser } from './lib/chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(ROOT, 'themes');
const readCss = (name) => fs.readFileSync(path.join(ROOT, 'layouts', name), 'utf8');
const COMPONENTS_CSS = readCss('components.css');

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    layout: { type: 'string', short: 'l' },
    ratio: { type: 'string', short: 'r' },
    theme: { type: 'string', short: 't' },
    out: { type: 'string', short: 'o' },
    scale: { type: 'string', default: '2' },
    format: { type: 'string', default: 'png' },
    quality: { type: 'string', default: '90' },
    page: { type: 'string' },
    'max-height': { type: 'string', default: '4400' },
    brand: { type: 'string' },
    check: { type: 'boolean', default: false },
    'html-only': { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});

function listThemes() {
  return fs
    .readdirSync(THEMES_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => {
      const css = fs.readFileSync(path.join(THEMES_DIR, f), 'utf8');
      const desc = css.match(/^\/\*\s*[\w-]+\s*\|\s*([\s\S]*?)\*\//)?.[1]?.trim() || '';
      return { name: f.replace(/\.css$/, ''), desc };
    });
}

if (opt.list) {
  for (const t of listThemes()) console.log(`${t.name.padEnd(12)} ${t.desc}`);
  process.exit(0);
}
if (opt.help || !positionals[0]) {
  console.error('用法：node render.mjs <content.json> [--ratio 3:4|4:5|1:1|9:16] [--theme 名称|a,b|all] [--out 目录] [--check] [--list]');
  process.exit(opt.help ? 0 : 2);
}

// Default is the long page; a ratio (or --layout xhs/card) switches to fixed-ratio cards.
const layout = opt.layout
  ? { long: 'long', xhs: 'card', card: 'card', wechat: 'wechat', mp: 'wechat', gzh: 'wechat', full: 'full', fulltext: 'full', whiteboard: 'whiteboard', wb: 'whiteboard' }[opt.layout]
  : opt.ratio ? 'card' : 'long';
if (!layout) {
  console.error(`[render] 未知版式 "${opt.layout}"，可用：long、xhs、wechat、full、whiteboard（或用 --ratio 指定比例）`);
  process.exit(2);
}
if (['long', 'wechat', 'full', 'whiteboard'].includes(layout) && opt.ratio) {
  console.error(`[render] ${layout === 'long' ? '长图' : '公众号图文'}没有固定比例；要出卡片请去掉 --layout ${opt.layout}`);
  process.exit(2);
}
const ratio = layout === 'card' ? String(opt.ratio || '3:4').replace(/[x×/]/i, ':') : null;
let spec = null;
if (ratio) {
  try { spec = ratioSpec(ratio); } catch (e) { console.error('[render] ' + e.message); process.exit(2); }
}

// ---- full text (-f): its own pipeline, driven by the original article rather than content.json ----
if (layout === 'full' || layout === 'whiteboard') {
  const mod = layout === 'full' ? await import('./lib/render-full.mjs') : await import('./lib/render-whiteboard.mjs');
  const fn = layout === 'full' ? mod.renderFullText : mod.renderWhiteboard;
  const code = await fn(path.resolve(positionals[0]), { opt, THEMES_DIR, readCss, listThemes });
  process.stdout.write('', () => process.exit(code));
  await new Promise(() => {});
}

const contentPath = path.resolve(positionals[0]);
let content;
try {
  content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
} catch (e) {
  console.error(`[render] 无法读取 ${contentPath}：${e.message}`);
  process.exit(1);
}

// ---- validate ----
const { errors, warnings, info } = validate(content, { layout, ratio: ratio || '3:4' });
if (warnings.length) {
  console.log(`⚠ 内容提示（${warnings.length}）：`);
  for (const w of warnings) console.log('  - ' + w);
}
if (errors.length) {
  console.log(`✗ 内容错误（${errors.length}），请修正 content.json：`);
  for (const e of errors) console.log('  - ' + e);
  process.exit(1);
}
const nSec = content.pages.reduce((a, p) => a + p.sections.length, 0);
const layoutDesc = layout === 'card' ? `，将生成 ${info.cards} 张 ${spec.name} 卡片` : layout === 'wechat' ? '，版式：公众号图文' : '，版式：长图';
console.log(`✓ content.json 校验通过：${content.pages.length} 页，${nSec} 节${layoutDesc}`);
if (opt.check) process.exit(0);

// ---- brand ----
function loadBrand() {
  const candidates = [
    opt.brand,
    path.join(path.dirname(contentPath), 'brand.json'),
    path.join(process.cwd(), 'article2media.brand.json'),
    path.join(os.homedir(), '.config', 'article2media', 'brand.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return { ...JSON.parse(fs.readFileSync(p, 'utf8')), _from: p }; } catch { console.log(`⚠ brand 文件无法解析：${p}`); }
    }
  }
  return {};
}
const brand = { ...loadBrand(), ...(content.brand || {}) };

// ---- themes ----
const available = listThemes().map((t) => t.name);
const themeKey = { card: 'cards', long: 'long', wechat: 'wechat' }[layout];
const contentTheme = typeof content.theme === 'object' && content.theme ? content.theme[themeKey] || content.theme.long : content.theme;
const themeArg = opt.theme || contentTheme || 'editorial';
const themeSource = opt.theme ? '' : contentTheme ? '（content.json 指定）' : '（默认）';
const themes = themeArg === 'all' ? available : themeArg.split(',').map((s) => s.trim()).filter(Boolean);
for (const t of themes) {
  if (!available.includes(t)) {
    console.error(`[render] 没有主题 "${t}"。可用：${available.join(', ')}`);
    process.exit(2);
  }
}
if (themeSource) console.log(`主题：${themes.join(', ')}${themeSource}`);

const scale = Math.max(1, Math.min(4, Number(opt.scale) || 2));
const format = opt.format === 'jpeg' || opt.format === 'jpg' ? 'jpeg' : 'png';
const ext = format === 'jpeg' ? 'jpg' : 'png';
const quality = Number(opt.quality);
const maxHeight = Number(opt['max-height']) || 4400;
const pageFilter = opt.page ? new Set(opt.page.split(',').map((n) => Number(n.trim()))) : null;
const baseOut = path.resolve(opt.out || path.dirname(contentPath));
const outDirFor = (theme) => {
  const sub = layout === 'card' ? `${theme}-${spec.slug}` : layout === 'wechat' ? `${theme}-wechat` : theme;
  return themes.length > 1 || !opt.out ? path.join(baseOut, sub) : baseOut;
};

async function renderLong(browser, theme, themeCss, nAcc, outDir, report) {
  const layoutCss = COMPONENTS_CSS + '\n' + readCss('long.css');
  for (let pi = 0; pi < content.pages.length; pi++) {
    if (pageFilter && !pageFilter.has(pi + 1)) continue;
    const name = `page-${String(pi + 1).padStart(2, '0')}`;
    const htmlPath = path.join(outDir, `${name}.html`);
    fs.writeFileSync(htmlPath, buildPage(pi, { content, brand, themeCss, layoutCss, nAcc }));
    const entry = { theme, label: `第 ${pi + 1} 页`, html: htmlPath };
    if (browser) {
      const page = await browser.newPage();
      try {
        await page.setViewport(1200, 1600, scale);
        await page.goto(pathToFileURL(htmlPath).href);
        const fontStatus = await page.settle(25000);
        const qa = await page.evaluate(qaInPage, { maxHeight });
        await page.setViewport(qa.width, qa.height, scale);
        const buf = await page.screenshot({ clip: { x: 0, y: 0, width: qa.width, height: qa.height }, format, quality });
        const imgPath = path.join(outDir, `${name}.${ext}`);
        fs.writeFileSync(imgPath, buf);
        if (fontStatus === 'timeout') qa.issues.push({ level: 'warn', where: '字体', msg: '等待网络字体超时，部分文字可能使用了回退字体' });
        Object.assign(entry, { image: imgPath, size: `${qa.width * scale}×${qa.height * scale}`, kb: Math.round(buf.length / 1024), issues: qa.issues });
      } finally {
        await page.close();
      }
    }
    report.push(entry);
  }
}

async function renderCards(browser, theme, themeCss, nAcc, outDir, report) {
  const htmlPath = path.join(outDir, 'cards.html');
  const build = (budgetAdjust) => {
    const r = buildCards({ content, brand, themeCss, componentsCss: COMPONENTS_CSS, layoutCss: readCss('card.css'), nAcc, ratio, budgetAdjust });
    fs.writeFileSync(htmlPath, r.html);
    return r.count;
  };
  let count = build(0);
  const captionPath = path.join(outDir, 'caption.md');
  const entry = { theme, label: `${count} 张 ${ratio} 卡片`, html: htmlPath, caption: captionPath };
  if (browser) {
    const page = await browser.newPage();
    try {
      await page.setViewport(1800, 1200, scale);
      // Checklist stages are packed into cards by estimated height. If a packed card still overflows,
      // shrink the packing budget by the measured overflow and rebuild (at most 3 passes).
      let qa, fontStatus, adjust = 0;
      for (let pass = 0; pass < 3; pass++) {
        await page.goto(pathToFileURL(htmlPath).href);
        fontStatus = await page.settle(25000);
        qa = await page.evaluate(qaInPage, { maxHeight });
        const over = Math.max(0, ...qa.cards.filter((c) => c.kind === 'stages' || c.kind === 'guard').map((c) => c.over));
        if (over <= 1) break;
        adjust += over + 8;
        count = build(adjust);
      }
      entry.label = `${count} 张 ${ratio} 卡片`;
      await page.setViewport(qa.width, qa.height, scale);
      let kb = 0;
      for (const c of qa.cards) {
        if (pageFilter && !pageFilter.has(c.idx)) continue;
        const buf = await page.screenshot({ clip: { x: c.x, y: c.y, width: c.width, height: c.height }, format, quality });
        fs.writeFileSync(path.join(outDir, `card-${String(c.idx).padStart(2, '0')}.${ext}`), buf);
        kb += buf.length / 1024;
      }
      // Contact sheet: every card in one small image, for a quick visual review.
      const overview = await page.screenshot({ clip: { x: 0, y: 0, width: qa.width, height: qa.height, scale: 0.6 / scale }, format: 'jpeg', quality: 82 });
      const overviewPath = path.join(outDir, 'overview.jpg');
      fs.writeFileSync(overviewPath, overview);
      if (fontStatus === 'timeout') qa.issues.push({ level: 'warn', where: '字体', msg: '等待网络字体超时，部分文字可能使用了回退字体' });
      Object.assign(entry, {
        image: path.join(outDir, `card-01.${ext} … card-${String(count).padStart(2, '0')}.${ext}`),
        overview: overviewPath,
        size: `${spec.w * scale}×${spec.h * scale}`,
        kb: Math.round(kb),
        issues: qa.issues,
      });
    } finally {
      await page.close();
    }
  }
  fs.writeFileSync(captionPath, buildCaption(content, count));
  // Remove stale card images from an earlier run that produced more cards.
  for (const f of fs.readdirSync(outDir)) {
    const m = f.match(/^card-(\d+)\.(png|jpg)$/);
    if (m && Number(m[1]) > count) fs.rmSync(path.join(outDir, f));
  }
  report.push(entry);
}

async function renderWechat(browser, theme, themeCss, nAcc, outDir, report) {
  const srcPath = path.join(outDir, 'source.html');
  const coverPath = path.join(outDir, 'covers.html');
  fs.writeFileSync(srcPath, buildWechatSource({ content, brand, themeCss, componentsCss: COMPONENTS_CSS, wechatCss: readCss('wechat.css'), nAcc }));
  fs.writeFileSync(coverPath, buildWechatCovers({ content, themeCss, componentsCss: COMPONENTS_CSS, cardCss: readCss('card.css'), nAcc }));
  const articlePath = path.join(outDir, 'article.html');
  const entry = { theme, label: '公众号图文', html: srcPath };
  if (!browser) { report.push(entry); return; }

  const imgDir = path.join(outDir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  for (const f of fs.readdirSync(imgDir)) if (/^(fig-.*|hero)\.png$/.test(f)) fs.rmSync(path.join(imgDir, f));
  const issues = [];
  const page = await browser.newPage();
  try {
    // Figures are captured at 3x: the editor shows them at the column width (~340 px) on 3x phone screens.
    await page.setViewport(375, 900, 3);
    await page.goto(pathToFileURL(srcPath).href);
    const fontStatus = await page.settle(25000);
    if (fontStatus === 'timeout') issues.push({ level: 'warn', where: '字体', msg: '等待网络字体超时，图表里的文字可能使用了回退字体' });
    const qa = await page.evaluate(qaInPage, { maxHeight: 1e9 });
    issues.push(...qa.issues.filter((i) => /^图 /.test(i.where)));
    // Capture figure cards (and the cover illustration) with a margin inside the article column,
    // so card shadows fade into the page color.
    const figs = await page.evaluate(() => {
      const col = document.getElementById('wx').getBoundingClientRect();
      return [...document.querySelectorAll('[data-shot]')].map((el) => {
        const r = el.getBoundingClientRect();
        const m = Math.min(10, r.left - col.left, col.right - r.right);
        return { id: el.dataset.shot, x: r.left - m + scrollX, y: r.top - m + scrollY, width: r.width + 2 * m, height: r.height + 2 * m };
      });
    });
    const b64 = {};
    for (const f of figs) {
      const buf = await page.screenshot({ clip: { x: f.x, y: f.y, width: f.width, height: f.height } });
      fs.writeFileSync(path.join(imgDir, `${f.id}.png`), buf);
      b64[f.id] = buf.toString('base64');
    }
    let html = await page.evaluate(inlineInPage);
    html = html.replace(/data-wx-fig="([^"]+)"/g, (m, id) => (b64[id] ? `src="data:image/png;base64,${b64[id]}"` : m));
    // The editor keeps only inline styles: make sure nothing else slipped through.
    if (/\sclass=|<style|<script|data-wx-fig=/.test(html)) issues.push({ level: 'error', where: '公众号正文', msg: '仍有 class / style 标签 / 未替换的图片占位，粘贴后会丢样式' });
    if (/url\(/.test(html.replace(/src="data:[^"]+"/g, ''))) issues.push({ level: 'warn', where: '公众号正文', msg: '样式里有 url()，公众号会过滤掉' });
    const mb = Buffer.byteLength(html) / 1048576;
    if (mb > 8) issues.push({ level: 'warn', where: '公众号正文', msg: `正文连同内嵌图片约 ${mb.toFixed(1)} MB，粘贴可能较慢；图片太多时可以只粘文字再手动插图` });
    fs.writeFileSync(path.join(outDir, 'article-body.html'), html);
    fs.writeFileSync(articlePath, buildWechatPreview({ content, articleHtml: html }));

    // Covers: 2.35:1 头图 + 1:1 thumbnail.
    await page.setViewport(1400, 480, 2);
    await page.goto(pathToFileURL(coverPath).href);
    await page.settle(25000);
    const boxes = await page.evaluate(() => ['cv-wide', 'cv-square'].map((id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const body = el.querySelector('.c-body');
      return { x: r.left, y: r.top, width: r.width, height: r.height, over: body.scrollHeight - body.clientHeight };
    }));
    const files = { wide: path.join(outDir, 'cover-2.35x1.png'), square: path.join(outDir, 'cover-1x1.png') };
    const [wide, square] = boxes;
    fs.writeFileSync(files.wide, await page.screenshot({ clip: { x: wide.x, y: wide.y, width: wide.width, height: wide.height } }));
    fs.writeFileSync(files.square, await page.screenshot({ clip: { x: square.x, y: square.y, width: square.width, height: square.height } }));
    for (const [b, name] of [[wide, '头图'], [square, '1:1 封面']]) {
      if (b.over > 1) issues.push({ level: 'error', where: name, msg: `标题放不下（超出 ${b.over}px），缩短 ${name === '头图' ? 'wechat.coverTitle 或 title' : 'cover.title'}` });
    }
    const notesPath = path.join(outDir, 'wechat.md');
    fs.writeFileSync(notesPath, buildWechatNotes(content, { wide: path.basename(files.wide), square: path.basename(files.square) }));
    const meta = wechatMeta(content);
    if (meta.title.length > 64) issues.push({ level: 'error', where: '公众号标题', msg: `最多 64 字，当前 ${meta.title.length} 字；写 wechat.title` });
    if (meta.digest.length > 120) issues.push({ level: 'warn', where: '公众号摘要', msg: `最多 120 字，当前 ${meta.digest.length} 字；写 wechat.digest` });
    Object.assign(entry, {
      image: articlePath,
      notes: notesPath,
      covers: `${files.wide}、${path.basename(files.square)}`,
      size: `${figs.filter((f) => f.id !== 'hero').length} 张图${figs.some((f) => f.id === 'hero') ? ' + 题图' : ''}`,
      kb: Math.round(Buffer.byteLength(html) / 1024),
      issues,
    });
  } finally {
    await page.close();
  }
  report.push(entry);
}

const report = [];
let browser;
try {
  if (!opt['html-only']) browser = await launchBrowser();
  for (const theme of themes) {
    const themeCss = fs.readFileSync(path.join(THEMES_DIR, `${theme}.css`), 'utf8');
    const nAcc = Math.max(1, new Set(themeCss.match(/--accent-\d+\s*:/g) || []).size);
    const outDir = outDirFor(theme);
    fs.mkdirSync(outDir, { recursive: true });
    // AI illustrations: point each one at this theme's cached image (or another theme's, or a placeholder).
    const ill = resolveIllustrations(content, theme, path.dirname(contentPath));
    const before = report.length;
    if (layout === 'card') await renderCards(browser, theme, themeCss, nAcc, outDir, report);
    else if (layout === 'wechat') await renderWechat(browser, theme, themeCss, nAcc, outDir, report);
    else await renderLong(browser, theme, themeCss, nAcc, outDir, report);
    const illIssues = [
      ...ill.missing.map((m) => ({ level: 'warn', where: m.where, msg: 'AI 插画还没生成，图里是占位框：先运行 illustrate.mjs' })),
      ...ill.borrowed.map((b) => ({ level: 'warn', where: b.where, msg: `借用了 ${b.from} 主题的插画；要画风一致，运行 illustrate.mjs --theme ${theme}` })),
    ];
    if (illIssues.length && report[before]) (report[before].issues ||= []).push(...illIssues);
  }
} catch (e) {
  console.error('[render] 失败：' + e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}

// ---- report ----
let nErr = 0, nWarn = 0;
for (const r of report) {
  const sizeNote = r.size ? `  (${r.size}${/张图/.test(r.size) ? '' : 'px'}, ${r.kb} KB)` : '';
  console.log(`\n[${r.theme}] ${r.label} → ${r.image || r.html}${sizeNote}`);
  if (r.overview) console.log(`  总览：${r.overview}`);
  if (r.covers) console.log(`  封面：${r.covers}`);
  if (r.notes) console.log(`  发布信息：${r.notes}`);
  if (r.caption) console.log(`  文案：${r.caption}`);
  for (const i of r.issues || []) {
    if (i.level === 'error') nErr++; else nWarn++;
    console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.where}：${i.msg}`);
  }
}
if (report.length) {
  const qaPath = path.join(path.dirname(report[0].html), 'qa.json');
  fs.writeFileSync(qaPath, JSON.stringify(report, null, 2));
  console.log(`\n版面检查：${nErr} 个错误，${nWarn} 个提示。${nErr ? '错误必须修复后重新渲染。' : ''}`);
}
// Exit explicitly: a half-closed DevTools socket can otherwise keep the event loop alive after Chrome quits.
// Wait for stdout to drain first (pipes are asynchronous on macOS).
process.stdout.write('', () => process.exit(process.exitCode ?? 0));
