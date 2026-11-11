#!/usr/bin/env node
// Contact sheet of every theme: cover card + first section card, 3:4.
//   node tests/theme-sheet.mjs [content.json] [out.jpg]
// Defaults: skills/article-rewrite/examples/gallery.json → docs/themes.jpg
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, 'skills', 'article2media', 'engine'); // shared engine
const { launchBrowser } = await import(path.join(SKILL, 'scripts', 'lib', 'chrome.mjs'));
const content = path.resolve(process.argv[2] || path.join(ROOT, 'skills', 'article-rewrite', 'examples', 'gallery.json'));
const out = path.resolve(process.argv[3] || path.join(ROOT, 'docs', 'themes.jpg'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2i-sheet-'));

// The main themes, in catalog order (`--legacy` draws the legacy ones instead).
const catalog = JSON.parse(fs.readFileSync(path.join(SKILL, 'themes', 'catalog.json'), 'utf8'));
const themes = process.argv.includes('--legacy') ? Object.keys(catalog.legacy) : catalog.main;
const desc = Object.fromEntries(themes.map((t) => {
  const line = fs.readFileSync(path.join(SKILL, 'themes', `${t}.css`), 'utf8').split('\n')[0];
  return [t, (line.match(/\|\s*([^：:；]+)/) || [])[1]?.trim() || ''];
}));
const r = spawnSync(process.execPath, [path.join(SKILL, 'scripts', 'render.mjs'), content, '--ratio', '3:4', '--theme', themes.join(','), '--out', tmp, '--scale', '1'], { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }

const cell = (t) => {
  const d = path.join(tmp, `${t}-3x4`);
  const img = (n) => `<img src="file://${path.join(d, `card-0${n}.png`)}">`;
  return `<figure><figcaption><b>${t}</b> ${desc[t]}</figcaption><div>${img(1)}${img(2)}</div></figure>`;
};
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#2b2b2b;font:15px/1.4 -apple-system,'PingFang SC',sans-serif;color:#eee;width:max-content}
main{display:grid;grid-template-columns:repeat(5,auto);gap:28px 22px;padding:28px}
figure{margin:0} figcaption{margin-bottom:8px} figcaption b{font-size:18px;margin-right:6px;color:#fff}
figure div{display:flex;gap:8px} img{width:230px;display:block;border-radius:4px}
</style><main>${themes.map(cell).join('')}</main>`;
const f = path.join(tmp, 'sheet.html');
fs.writeFileSync(f, html);
const b = await launchBrowser();
const p = await b.newPage();
await p.setViewport(1200, 800, 1);
await p.goto('file://' + f);
await p.settle(15000);
const s = await p.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
await p.setViewport(s.w, s.h, 1);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, await p.screenshot({ clip: { x: 0, y: 0, width: s.w, height: s.h }, format: 'jpeg', quality: 82 }));
await b.close();
console.log(`${themes.length} 个主题 → ${out}`);
