// Image generation providers shared by illustrate.mjs (article illustrations) and video.mjs (cover / scene art).
//   codex   Codex CLI's built-in image tool (uses the user's ChatGPT login; no API key)
//   gemini  GEMINI_API_KEY / GOOGLE_API_KEY (image models need a paid tier)
//   openai  OPENAI_API_KEY
//   mock    offline placeholder (layout checks only)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const has = (cmd, args) => { try { return spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000 }).status === 0; } catch { return false; } };

export function detectImageProviders() {
  const codexBin = process.env.CODEX_BIN || 'codex';
  return {
    codex: has(codexBin, ['--version']) ? { bin: codexBin } : null,
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? {} : null,
    openai: process.env.OPENAI_API_KEY ? {} : null,
  };
}

/** Default order: codex (free with a ChatGPT login) → openai → gemini. */
export function pickImageProvider(requested) {
  if (requested) return requested;
  const d = detectImageProviders();
  return d.codex ? 'codex' : d.openai ? 'openai' : d.gemini ? 'gemini' : null;
}

const SHAPES = { landscape: ['1536x1024 landscape (3:2)', '1536x1024'], portrait: ['1024x1536 portrait (2:3)', '1024x1536'], square: ['1024x1024 square', '1024x1024'] };
export const shapeFor = (aspect = '4:3') => {
  const [w, h] = aspect.split(':').map(Number);
  return w > h ? 'landscape' : w < h ? 'portrait' : 'square';
};

async function codex(prompt, aspect, { model, refs = [] } = {}) {
  const shape = shapeFor(aspect);
  const bin = process.env.CODEX_BIN || 'codex';
  const m = model || process.env.ARTICLE2MEDIA_CODEX_IMAGE_MODEL || 'gpt-6-astra';
  // Reference images keep a recurring character / style consistent across a series (comic panels).
  const refNote = refs.length
    ? 'Attached reference image(s), in order: ' + refs.map((r, k) => `image ${k + 1} = ${r.note || 'character and style reference'}`).join('; ') +
      '. Pass them to the image generation tool as reference images so the character design (face, hair, glasses, clothing, proportions) and the line / tone style stay identical. '
    : '';
  const instruction = 'Task: call your built-in image generation tool exactly once to create one new image. ' +
    `Canvas: ${SHAPES[shape][0]}. ${refNote}Use the text between <prompt> tags as the image prompt, verbatim, without adding style words. ` +
    'Do not draw with code, do not edit or post-process, do not generate variants. When the tool returns, reply with the single word DONE.\n\n' +
    `<prompt>\n${prompt}\n</prompt>`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a2i-codex-'));
  // The prompt must come before -i (which takes several values and would swallow it).
  const args = ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-C', cwd, '-m', m, '-c', 'model_reasoning_effort="low"', instruction, ...refs.flatMap((r) => ['-i', r.path])];
  const r = await new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 900000);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  fs.rmSync(cwd, { recursive: true, force: true });
  let thread = null;
  for (const line of (r.stdout || '').split('\n')) { try { const j = JSON.parse(line); thread = j.thread_id || j.thread?.id || thread; } catch {} }
  const dir = thread ? path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'generated_images', thread) : null;
  const files = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs) : [];
  if (!files.length) {
    const err = (r.stdout || '').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((j) => j && /error|failed/.test(j.type || '')).map((j) => j.message || j.error?.message).filter(Boolean).pop();
    throw new Error(`Codex 没有生成图片${err ? `：${String(err).slice(0, 300)}` : `（退出码 ${r.status}）`}。确认已 codex login，或用 ARTICLE2MEDIA_CODEX_IMAGE_MODEL 换一个支持出图的模型`);
  }
  return { buf: fs.readFileSync(files[files.length - 1]), ext: 'png', model: m };
}

async function gemini(prompt, aspect, { model } = {}) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const m = model || 'gemini-3.1-flash-image';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j.error?.message || res.statusText;
    if (res.status === 429 && /free_tier|limit: 0/.test(msg)) throw new Error('Gemini 返回 429：这个 key 在免费层，图像模型额度为 0，需要在 Google AI Studio 开通付费。');
    throw new Error(`Gemini ${res.status}：${msg.split('\n')[0]}`);
  }
  const part = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
  if (!part) throw new Error(`Gemini 没有返回图片（${j.candidates?.[0]?.finishReason || '未知原因'}）`);
  return { buf: Buffer.from(part.inlineData.data, 'base64'), ext: part.inlineData.mimeType.split('/')[1].replace('jpeg', 'jpg'), model: m };
}

async function openai(prompt, aspect, { model } = {}) {
  const m = model || 'gpt-image-1';
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: m, prompt, size: SHAPES[shapeFor(aspect)][1], quality: 'medium', n: 1 }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}：${j.error?.message || res.statusText}`);
  return { buf: Buffer.from(j.data[0].b64_json, 'base64'), ext: 'png', model: m };
}

export const IMAGE_PROVIDERS = { codex, gemini, openai };

export async function generateImage(provider, prompt, aspect, opts = {}) {
  const fn = IMAGE_PROVIDERS[provider];
  if (!fn) throw new Error(`未知图像服务 ${provider}`);
  return fn(prompt, aspect, opts);
}

