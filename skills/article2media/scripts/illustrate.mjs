#!/usr/bin/env node
// Generate the AI illustrations a content.json asks for (cover.illustration and "illustration" figures),
// in the picture style of each theme, and cache them next to content.json in illustrations/.
//
//   node illustrate.mjs <content.json> [--theme 名称|a,b|all] [--provider gemini|openai|mock]
//                       [--model 模型] [--force] [--dry-run]
//
// 服务商：codex（Codex CLI 内置出图，用 ChatGPT 登录，不需要 key；默认模型 gpt-6-astra）
//         gemini（GEMINI_API_KEY 或 GOOGLE_API_KEY，默认模型 gemini-3.1-flash-image）
//         openai（OPENAI_API_KEY，默认模型 gpt-image-1）
//         mock（本地生成占位图，不联网，用于测试版式）
// 不传 --provider 时：有 Codex CLI 用 codex，否则 OpenAI，否则 Gemini，都没有就报错。
// 主题：默认用 content.json 的 theme（长图和卡片主题不同时两个都生成）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateImage, pickImageProvider } from './lib/imagegen.mjs';
import { buildPrompt, collectIllustrations, fileForKey, keyFor, readIndex, styleFor, themePalette, writeIndex } from './lib/illustrations.mjs';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    theme: { type: 'string', short: 't' },
    provider: { type: 'string', short: 'p' },
    model: { type: 'string', short: 'm' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});
if (opt.help || !positionals[0]) {
  console.error('用法：node illustrate.mjs <content.json> [--theme 名称|all] [--provider gemini|openai|mock] [--model 模型] [--force] [--dry-run]');
  process.exit(opt.help ? 0 : 2);
}

const contentPath = path.resolve(positionals[0]);
const dir = path.dirname(contentPath);
const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
const items = collectIllustrations(content);
if (!items.length) {
  console.log('content.json 里没有要生成的插画（cover.illustration 或 type 为 illustration 的图）。');
  process.exit(0);
}

const THEMES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');
const available = fs.readdirSync(THEMES_DIR).filter((f) => f.endsWith('.css')).map((f) => f.replace(/\.css$/, ''));
const fromContent = typeof content.theme === 'object' && content.theme ? Object.values(content.theme) : [content.theme || 'editorial'];
const themes = [...new Set(opt.theme === 'all' ? available : opt.theme ? opt.theme.split(',').map((s) => s.trim()) : fromContent)];
for (const t of themes) if (!available.includes(t)) { console.error(`[illustrate] 没有主题 "${t}"`); process.exit(2); }

const provider = pickImageProvider(opt.provider);
if (!provider) {
  console.error('[illustrate] 没有可用的图像服务：安装并登录 Codex CLI（codex login），或设置 OPENAI_API_KEY / GEMINI_API_KEY，或用 --provider mock 生成占位图。');
  process.exit(2);
}
const model = opt.model || { codex: process.env.ARTICLE2MEDIA_CODEX_IMAGE_MODEL || 'gpt-6-astra', gemini: 'gemini-3.1-flash-image', openai: 'gpt-image-1', mock: 'mock' }[provider];
if (!model) { console.error(`[illustrate] 未知服务商 ${provider}，可用：codex、gemini、openai、mock`); process.exit(2); }

// ---------- providers: (prompt, aspect) → { buf, ext } ----------
// Offline placeholder: soft shapes in the theme palette, so layouts can be checked without an API.
async function mock(prompt, aspect, it, theme) {
  const [w, h] = aspect.split(':').map(Number);
  const W = 800, H = Math.round((800 * h) / w);
  const pal = themePalette(theme);
  const bg = it.kind === 'cover' ? pal.bg : pal.figBg;
  const a = pal.accents.length ? pal.accents : [pal.ink];
  let seed = [...prompt].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let shapes = '';
  for (let i = 0; i < 7; i++) {
    const r = 40 + rnd() * 120;
    shapes += `<circle cx="${(W * (0.2 + rnd() * 0.6)).toFixed(0)}" cy="${(H * (0.2 + rnd() * 0.6)).toFixed(0)}" r="${r.toFixed(0)}" fill="${a[i % a.length]}" opacity="${(0.35 + rnd() * 0.4).toFixed(2)}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${bg}"/>${shapes}` +
    `<text x="${W / 2}" y="${H - 28}" text-anchor="middle" font-family="sans-serif" font-size="22" fill="${pal.ink}" opacity=".55">AI 插画占位 · ${theme}</text></svg>`;
  return { buf: Buffer.from(svg), ext: 'svg' };
}

const PROVIDERS = {
  codex: (p, a) => generateImage('codex', p, a, { model }),
  gemini: (p, a) => generateImage('gemini', p, a, { model }),
  openai: (p, a) => generateImage('openai', p, a, { model }),
  mock,
};

// ---------- jobs ----------
const idx = readIndex(dir);
const jobs = [];
for (const theme of themes) {
  const style = styleFor(content, theme);
  for (const it of items) {
    if (!it.prompt.trim()) { console.error(`✗ ${it.where}：缺少 prompt`); process.exitCode = 1; continue; }
    const key = keyFor(it, style);
    const have = fileForKey(dir, key);
    if (have && !opt.force) continue;
    jobs.push({ it, theme, key, style, have });
  }
}
console.log(`插画：${items.length} 张 × ${themes.length} 个主题（${themes.join(', ')}），需要生成 ${jobs.length} 张；服务商 ${provider} / ${model}`);
if (opt['dry-run']) {
  for (const j of jobs) console.log(`\n[${j.theme}] ${j.it.where}（${j.it.aspect}）\n${buildPrompt(j.it, j.theme, content)}`);
  process.exit(0);
}

const outDir = path.join(dir, 'illustrations');
fs.mkdirSync(outDir, { recursive: true });
let ok = 0;
for (const j of jobs) {
  const t0 = Date.now();
  try {
    const { buf, ext } = await PROVIDERS[provider](buildPrompt(j.it, j.theme, content), j.it.aspect, j.it, j.theme);
    if (j.have && opt.force) fs.rmSync(j.have);
    const file = path.join(outDir, `${j.key}.${ext}`);
    fs.writeFileSync(file, buf);
    idx[j.key] = { prompt: j.it.prompt, kind: j.it.kind, aspect: j.it.aspect, theme: j.theme, style: j.style, provider, model, file: path.basename(file), created: new Date().toISOString() };
    writeIndex(dir, idx);
    ok++;
    console.log(`✓ [${j.theme}] ${j.it.where} → illustrations/${path.basename(file)}（${((Date.now() - t0) / 1000).toFixed(1)}s，${Math.round(buf.length / 1024)} KB）`);
  } catch (e) {
    console.error(`✗ [${j.theme}] ${j.it.where}：${e.message}`);
    process.exitCode = 1;
    if (/额度是 0|401|403/.test(e.message)) break; // the next calls would fail the same way
  }
}
console.log(`\n完成 ${ok} / ${jobs.length} 张。${ok ? '重新运行 render.mjs 即可用上。' : ''}`);
