#!/usr/bin/env node
// Environment check: Node version, Chrome, a real headless launch, and web-font reachability.
import { findChrome, launchBrowser, NO_CHROME_HELP, CACHE_DIR } from './lib/chrome.mjs';

const out = { ok: true, node: process.versions.node, checks: [] };
const add = (name, ok, detail) => { out.checks.push({ name, ok, detail }); if (!ok) out.ok = false; };

const major = Number(process.versions.node.split('.')[0]);
add('node>=22', major >= 22 && typeof WebSocket === 'function', major >= 22 ? `v${process.versions.node}` : `当前 v${process.versions.node}，需要 Node 22+（内置 WebSocket）`);

let exe = null;
try { exe = findChrome(); } catch (e) { add('chrome', false, e.message); }
if (exe !== null || !out.checks.some((c) => c.name === 'chrome')) add('chrome', !!exe, exe || NO_CHROME_HELP);

if (exe) {
  try {
    const b = await launchBrowser();
    const p = await b.newPage();
    await p.goto('about:blank');
    const ua = await p.evaluate(() => navigator.userAgent);
    await b.close();
    add('headless-launch', true, ua.match(/Chrome\/[\d.]+/)?.[0] || 'ok');
  } catch (e) {
    add('headless-launch', false, e.message);
  }
}

try {
  const r = await fetch('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400&display=block', { signal: AbortSignal.timeout(8000) });
  add('web-fonts', r.ok, r.ok ? 'fonts.googleapis.com 可访问' : `HTTP ${r.status}`);
} catch (e) {
  // Not fatal: themes fall back to system CJK fonts.
  out.checks.push({ name: 'web-fonts', ok: false, detail: `无法访问 Google Fonts（${e.message}），将回退到系统中文字体，效果会打折扣` });
}

// Optional: AI illustrations (illustrate.mjs). Not a failure when missing.
const imgKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'Gemini' : process.env.OPENAI_API_KEY ? 'OpenAI' : '';
out.checks.push({ name: 'ai-illustration', ok: true, detail: imgKey ? `可用：${imgKey}（可选功能）` : '未设置 GEMINI_API_KEY / OPENAI_API_KEY：不能生成 AI 插画（可选功能，其余不受影响）' });

out.cache = CACHE_DIR;
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
