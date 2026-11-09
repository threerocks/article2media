#!/usr/bin/env node
// Environment check: Node version, Chrome, a real headless launch, web-font reachability, and optional capabilities
// (AI illustrations, video → transcript input).
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

// Optional: AI illustrations (illustrations, video covers, comics). Not a failure when missing.
{
  const { detectImageProviders } = await import('./lib/imagegen.mjs');
  const d = detectImageProviders();
  const have = [d.codex && 'Codex CLI', d.openai && 'OpenAI', d.gemini && 'Gemini'].filter(Boolean);
  out.checks.push({ name: 'ai-illustration', ok: true, detail: have.length ? `可用：${have.join('、')}（AI 插画、视频封面插画、漫画）` : '没有出图能力：不能生成 AI 插画和漫画（登录 Codex CLI，或设置 OPENAI_API_KEY / GEMINI_API_KEY；其余功能不受影响）' });
}

// Optional: video input (fetch.mjs turns Douyin / YouTube / Bilibili / local media into a transcript article).
{
  const { detectYtdlp, ffmpegOk } = await import('./lib/media/source.mjs');
  const { detectVoice } = await import('./lib/video/voice.mjs');
  const yt = detectYtdlp(), ff = ffmpegOk(), asr = detectVoice().whisper;
  const parts = [
    yt ? `yt-dlp ${yt.version}${yt.jsRuntimes ? '' : '（版本偏旧，YouTube 可能过不了 JS 校验：brew upgrade yt-dlp）'}` : '没有 yt-dlp：YouTube、B 站链接用不了（brew install yt-dlp）',
    ff ? 'ffmpeg ✓' : '没有 ffmpeg：视频转音频用不了（brew install ffmpeg）',
    asr ? `本地语音识别 ✓（${asr.model.split('/').pop()}）` : '没有本地语音识别：只能用平台字幕或 .srt / .vtt（Apple Silicon 上装 mlx-whisper 和 whisper-large-v3-turbo 模型）',
  ];
  out.checks.push({ name: 'video-input', ok: true, detail: `视频转逐字稿（可选功能）：${parts.join('；')}` });
}

out.cache = CACHE_DIR;
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
