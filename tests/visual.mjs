#!/usr/bin/env node
// Visual regression: render a small fixed set and compare every PNG with its baseline in tests/baseline/.
//
//   node tests/visual.mjs                  # compare; exit 1 when a picture differs by more than the threshold
//   node tests/visual.mjs --update         # (re)write the baselines from the current render
//   node tests/visual.mjs --themes editorial,dopamine --threshold 0.0002 --out DIR
//
// The set: examples/gallery.json as 3:4 cards (cards 1, 3, 6) and as the phone long page 1, per theme, at --scale 1.
// Pixels are compared in Node (PNG decoded with node:zlib, no dependencies): a pixel differs when any channel is off
// by more than TOLERANCE; a picture fails when the differing share exceeds the threshold or its size changed.
// Baselines only mean something with the same fonts, so the test needs the local fonts (fonts.mjs) and skips
// (exit 0, ⚠) without them, without baselines, or on another platform than the one the baselines were made on.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = process.env.ARTICLE2MEDIA_ENGINE || path.join(ROOT, 'skills', 'article2media', 'engine'); // same override as the skill wrappers
const RENDER = path.join(ENGINE, 'scripts', 'render.mjs');
const EXAMPLE = path.join(ROOT, 'skills', 'article-rewrite', 'examples', 'gallery.json');
const BASE = path.join(ROOT, 'tests', 'baseline');
const TOLERANCE = 16; // per channel, 0–255: absorbs antialiasing noise, not a colour or layout change

const { values: opt } = parseArgs({ options: {
  update: { type: 'boolean', default: false },
  themes: { type: 'string' },
  threshold: { type: 'string', default: '0.0002' },
  out: { type: 'string' },
} });
const metaPath = path.join(BASE, 'meta.json');
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;
// --themes, else the themes the baselines were made with, else the default three.
const themes = opt.themes ? opt.themes.split(',').map((s) => s.trim()).filter(Boolean) : (!opt.update && meta?.themes) || ['editorial', 'dopamine', 'midnight'];
const threshold = Number(opt.threshold);
// What is rendered per theme: [name, render args, files to keep → baseline name].
const CASES = [
  ['cards', ['--ratio', '3:4', '--page', '1,3,6'], { 'card-01.png': 'card-01.png', 'card-03.png': 'card-03.png', 'card-06.png': 'card-06.png' }],
  ['long', ['--page', '1'], { 'page-01.png': 'long-01.png' }],
];

// ---------- PNG (8-bit RGB / RGBA, non-interlaced: what Chrome writes) ----------
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let pos = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || ![2, 6].includes(type) || data[12] !== 0) throw new Error(`不支持的 PNG（位深 ${data[8]}，类型 ${type}，隔行 ${data[12]}）`);
    } else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (f === 1) add = a;
      else if (f === 2) add = b;
      else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * bpp;
      px[o] = line[s]; px[o + 1] = line[s + 1]; px[o + 2] = line[s + 2]; px[o + 3] = bpp === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, px };
}

export function encodePng({ width, height, px }) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) px.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const chunk = (name, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(name, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** { ratio, differing, total, sizeChanged, sheet: baseline | actual | differing pixels in red } */
export function comparePng(a, b) {
  const W = Math.max(a.width, b.width), H = Math.max(a.height, b.height), G = 12;
  const sheet = { width: W * 3 + G * 2, height: H, px: Buffer.alloc((W * 3 + G * 2) * H * 4, 255) };
  let differing = 0;
  const at = (img, x, y) => (x < img.width && y < img.height ? (y * img.width + x) * 4 : -1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = at(a, x, y), j = at(b, x, y);
      let diff = i < 0 || j < 0;
      if (!diff) for (let c = 0; c < 4; c++) if (Math.abs(a.px[i + c] - b.px[j + c]) > TOLERANCE) { diff = true; break; }
      if (diff) differing++;
      const row = y * sheet.width * 4;
      if (i >= 0) a.px.copy(sheet.px, row + x * 4, i, i + 4);
      if (j >= 0) b.px.copy(sheet.px, row + (W + G + x) * 4, j, j + 4);
      const o = row + (2 * (W + G) + x) * 4;
      if (diff) { sheet.px[o] = 230; sheet.px[o + 1] = 0; sheet.px[o + 2] = 40; }
      else if (j >= 0) { const g = 255 - Math.round((255 - (b.px[j] * 0.3 + b.px[j + 1] * 0.59 + b.px[j + 2] * 0.11)) * 0.25); sheet.px[o] = sheet.px[o + 1] = sheet.px[o + 2] = g; }
    }
  }
  return { differing, total: W * H, ratio: differing / (W * H), sizeChanged: a.width !== b.width || a.height !== b.height, sheet };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

async function main() {
  // Preconditions: local fonts for the themes under test (remote fonts make the pictures depend on the network).
  const fonts = await import(pathToFileURL(path.join(ENGINE, 'scripts', 'lib', 'fonts.mjs')).href);
  const missing = fonts.collectImports({ themes }).filter((w) => w.usedBy.some((u) => u.startsWith('themes/')) && !fonts.localCssFor(w.url));
  if (missing.length) {
    console.log(`⚠ 视觉回归已跳过：主题 ${[...new Set(missing.flatMap((m) => m.usedBy.filter((u) => u.startsWith('themes/')).map((u) => u.slice(7))))].join('、')} 的字体没有装到本地，联网字体下的截图不稳定。先运行 node skills/article2media/scripts/fonts.mjs --theme ${themes.join(',')}`);
    process.exit(0);
  }
  if (!opt.update) {
    if (!meta) { console.log('⚠ 视觉回归已跳过：tests/baseline/ 里还没有基线。版面确认无误后运行 node tests/visual.mjs --update 生成'); process.exit(0); }
    if (meta.platform !== process.platform) { console.log(`⚠ 视觉回归已跳过：基线是在 ${meta.platform} 上生成的，当前是 ${process.platform}（不同系统的字体渲染不一样）`); process.exit(0); }
  }

  const out = opt.out ? path.resolve(opt.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'a2m-visual-'));
  let failed = 0, n = 0, bytes = 0;
  const written = [];
  for (const theme of themes) {
    for (const [name, args, files] of CASES) {
      const dir = path.join(out, theme, name);
      fs.rmSync(dir, { recursive: true, force: true });
      const r = spawnSync(process.execPath, [RENDER, EXAMPLE, ...args, '--theme', theme, '--scale', '1', '--out', dir], { encoding: 'utf8', timeout: 300000 });
      if (r.status !== 0) { failed++; console.log(`✗ ${theme} · ${name}：渲染失败\n    ${((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-4).join('\n    ')}`); continue; }
      for (const [file, baseName] of Object.entries(files)) {
        const actual = path.join(dir, file), base = path.join(BASE, theme, baseName), label = `${theme} · ${baseName}`;
        n++;
        if (!fs.existsSync(actual)) { failed++; console.log(`✗ ${label}：没有渲染出 ${file}`); continue; }
        if (opt.update) {
          fs.mkdirSync(path.dirname(base), { recursive: true });
          fs.copyFileSync(actual, base);
          bytes += fs.statSync(base).size;
          written.push(`${theme}/${baseName}`);
          console.log(`✓ ${label}：已写入基线（${Math.round(fs.statSync(base).size / 1024)} KB）`);
          continue;
        }
        if (!fs.existsSync(base)) { failed++; console.log(`✗ ${label}：没有基线（node tests/visual.mjs --update）`); continue; }
        const c = comparePng(decodePng(fs.readFileSync(base)), decodePng(fs.readFileSync(actual)));
        const pct = `${(c.ratio * 100).toFixed(3)}%`;
        if (!c.sizeChanged && c.ratio <= threshold) { console.log(`✓ ${label}：差异 ${pct}`); continue; }
        failed++;
        const diffPath = path.join(out, 'diff', `${theme}-${baseName}`);
        fs.mkdirSync(path.dirname(diffPath), { recursive: true });
        fs.writeFileSync(diffPath, encodePng(c.sheet));
        console.log(`✗ ${label}：${c.sizeChanged ? '尺寸变了，' : ''}差异 ${pct}（${c.differing} 像素，阈值 ${(threshold * 100).toFixed(3)}%）\n    对比图（基线 | 现在 | 差异）：${diffPath}`);
      }
    }
  }
  if (opt.update) {
    let chrome = '';
    try { chrome = (await import(pathToFileURL(path.join(ENGINE, 'scripts', 'lib', 'chrome.mjs')).href)).findChrome() || ''; } catch {}
    fs.writeFileSync(metaPath, JSON.stringify({ platform: process.platform, arch: process.arch, chrome, themes, files: written, created: new Date().toISOString() }, null, 2) + '\n');
    console.log(`\n视觉回归：写入 ${written.length} 张基线，共 ${(bytes / 1048576).toFixed(2)} MB → ${BASE}${failed ? `；${failed} 个错误` : ''}`);
  } else {
    console.log(`\n视觉回归：${n} 张，${failed} 个错误（阈值 ${(threshold * 100).toFixed(3)}%）。${failed ? `输出目录：${out}。版面是有意改的就运行 node tests/visual.mjs --update` : ''}`);
    if (!failed && !opt.out) fs.rmSync(out, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}
