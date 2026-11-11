#!/usr/bin/env node
// README showcase: one article, every kind of output, in one picture.
//   node tests/showcase.mjs <工作目录> [out.jpg] [hints.json]
// hints.json: another content.json of the same article whose per-section `card` hints (full-card variants) are
// copied onto sections with the same heading, e.g. skills/article-rewrite/examples/dan-koe.json.
// The work directory is a finished article2media-out/<slug>/ with content.json and, where available, the outputs
// that need a model or image generation and so cannot be made here: full/ (原文长图), whiteboard/, comic/,
// <theme>-wechat/ and video/<theme>/video.mp4. Cards, covers, lighter forms and the long page are rendered fresh.
// Default output: docs/showcase.jpg
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'skills', 'article2media', 'engine');
const { launchBrowser } = await import(path.join(ENGINE, 'scripts', 'lib', 'chrome.mjs'));
const work = process.argv[2] && path.resolve(process.argv[2]);
if (!work || !fs.existsSync(path.join(work, 'content.json'))) {
  console.error('用法：node tests/showcase.mjs <工作目录（含 content.json）> [out.jpg]');
  process.exit(2);
}
const out = path.resolve(process.argv[3] || path.join(ROOT, 'docs', 'showcase.jpg'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2m-showcase-'));

// Render from a copy so the work directory's own outputs are left alone.
const content = JSON.parse(fs.readFileSync(path.join(work, 'content.json'), 'utf8'));
if (process.argv[4]) {
  const hints = new Map(JSON.parse(fs.readFileSync(path.resolve(process.argv[4]), 'utf8')).pages.flatMap((p) => p.sections).filter((x) => x.card).map((x) => [x.heading, x.card]));
  for (const pg of content.pages) for (const sec of pg.sections) if (!sec.card && hints.has(sec.heading)) sec.card = hints.get(sec.heading);
}
fs.writeFileSync(path.join(tmp, 'content.json'), JSON.stringify(content));
if (fs.existsSync(path.join(work, 'illustrations'))) fs.cpSync(path.join(work, 'illustrations'), path.join(tmp, 'illustrations'), { recursive: true });
const render = (name, args) => {
  const r = spawnSync(process.execPath, [path.join(ENGINE, 'scripts', 'render.mjs'), path.join(tmp, 'content.json'), ...args, '--out', path.join(tmp, name)], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
};
render('cards', ['--ratio', '3:4', '--theme', 'brutal']);
render('covers', ['--ratio', '3:4', '--theme', 'dopamine', '--covers']);
render('onepage', ['--ratio', '3:4', '--theme', 'bento', '--form', 'onepage']);
render('quotes', ['--ratio', '3:4', '--theme', 'guochao', '--form', 'quotes']);
render('long', ['--theme', 'editorial', '--page', '1']);

const first = (dir, re) => {
  const d = path.join(work, dir);
  if (!fs.existsSync(d)) return '';
  const f = fs.readdirSync(d).filter((x) => re.test(x)).sort()[0];
  return f ? path.join(d, f) : '';
};
const sub = (re) => fs.readdirSync(work).find((x) => re.test(x)) || '';
// A full-card variant from the rendered set, if the content has one.
const cardsHtml = fs.readFileSync(path.join(tmp, 'cards', 'cards.html'), 'utf8');
const variant = (cls) => { const m = cardsHtml.match(new RegExp(`class="card acc c-sec c-${cls}" data-card="(\\d+)"`)); return m ? path.join(tmp, 'cards', `card-${m[1].padStart(2, '0')}.png`) : ''; };

// A frame from the explainer video, well past the cover.
let frame = '';
const vdir = sub(/^video$/) && fs.readdirSync(path.join(work, 'video')).find((t) => fs.existsSync(path.join(work, 'video', t, 'video.mp4')));
if (vdir) {
  frame = path.join(tmp, 'frame.jpg');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '14', '-i', path.join(work, 'video', vdir, 'video.mp4'), '-frames:v', '1', frame]);
  if (!fs.existsSync(frame)) frame = '';
}

const covers = fs.readdirSync(path.join(tmp, 'covers')).filter((x) => /^cover-\d+.*\.png$/.test(x)).sort().slice(0, 3).map((x) => path.join(tmp, 'covers', x));
const browser = await launchBrowser();
// 公众号: a phone-width screenshot of the laid-out article body.
let wechat = '';
const wdir = sub(/-wechat$/);
if (wdir && fs.existsSync(path.join(work, wdir, 'source.html'))) {
  const p = await browser.newPage();
  await p.setViewport(375, 760, 2);
  await p.goto(pathToFileURL(path.join(work, wdir, 'source.html')).href);
  await p.settle(15000);
  wechat = path.join(tmp, 'wechat.png');
  fs.writeFileSync(wechat, await p.screenshot({ clip: { x: 0, y: 0, width: 375, height: 760 }, format: 'png' }));
  await p.close();
}

const tiles = [
  ['小红书卡片', 'brutal · 6 种封面 · 附发帖文案', path.join(tmp, 'cards', 'card-01.png')],
  ['手机长图', 'editorial · 1080 宽单栏 · 图表 + 数据面板', path.join(tmp, 'long', 'page-01.png')],
  ['公众号图文', `${wdir.replace(/-wechat$/, '') || 'swiss'} · 样式内联 · 直接粘贴`, wechat],
  ['口播视频', `${vdir || 'midnight'} · 本地配音 · 逐字字幕`, frame],
  ['封面多版本', '同一篇出几版封面，挑一版或比效果', covers[0], 'fan', covers],
  ['整页卡型', '大数字 · 金句 · 整页图，给一组图做节奏', variant('number') || variant('quote') || path.join(tmp, 'cards', 'card-03.png')],
  ['一页看完', 'bento · 一张图讲完全文', path.join(tmp, 'onepage', 'onepage-01.png')],
  ['金句图', 'guochao · 每句一张', path.join(tmp, 'quotes', 'quote-01.png')],
  ['原文全文', '一字不改 · 逐块校验', first('full', /^full(-01)?\.png$/)],
  ['白板论证', '推理主干 · 原文有去向', first('whiteboard', /^whiteboard(-01)?\.png$/)],
  ['漫画', '角色一致 · 文字 HTML', first('comic', /^card-01\.png$/)],
  ['12 套主推主题', '内容不变 · 一键换风格', path.join(ROOT, 'docs', 'themes.jpg'), 'left'],
].filter((t) => t[2] && fs.existsSync(t[2]));

const html = `<!doctype html><meta charset="utf-8"><style>
body { margin: 0; background: #F2F1EC; font-family: 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif; }
main { display: grid; grid-template-columns: repeat(4, 1fr); gap: 40px 30px; padding: 44px; width: 1800px; box-sizing: border-box; }
figure { margin: 0; }
.shot { height: 540px; border-radius: 22px; overflow: hidden; background: #fff; box-shadow: 0 10px 30px rgba(40, 36, 28, .12); }
.shot img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; }
.shot.fan { background: #E4E1D8; position: relative; }
.shot.fan img { position: absolute; width: 62%; height: auto; border-radius: 10px; box-shadow: 0 8px 22px rgba(40, 36, 28, .22); }
.shot.fan img:nth-child(1) { left: 5%; top: 7%; z-index: 3; }
.shot.fan img:nth-child(2) { left: 21%; top: 21%; z-index: 2; }
.shot.fan img:nth-child(3) { left: 35%; top: 35%; z-index: 1; }
.shot.left img { object-position: left top; }
figcaption b { display: block; font-size: 27px; font-weight: 700; color: #1d1d1b; margin: 16px 0 4px; }
figcaption span { font-size: 18.5px; color: #77746c; }
</style><main>${tiles.map(([t, d, img, fit, more]) => `<figure><div class="shot ${fit || ''}">${(more || [img]).map((x) => `<img src="${pathToFileURL(x).href}">`).join('')}</div><figcaption><b>${t}</b><span>${d}</span></figcaption></figure>`).join('')}</main>`;
const page = path.join(tmp, 'showcase.html');
fs.writeFileSync(page, html);
const p = await browser.newPage();
await p.setViewport(1800, 1200, 1);
await p.goto(pathToFileURL(page).href);
await p.settle(20000);
const size = await p.evaluate(() => { const m = document.querySelector('main').getBoundingClientRect(); return { w: Math.ceil(m.width), h: Math.ceil(m.height) }; });
await p.setViewport(size.w, size.h, 1);
fs.writeFileSync(out, await p.screenshot({ clip: { x: 0, y: 0, width: size.w, height: size.h }, format: 'jpeg', quality: 86 }));
await p.close();
await browser.close();
console.log(`${tiles.length} 格 → ${out}`);
process.stdout.write('', () => process.exit(0));
