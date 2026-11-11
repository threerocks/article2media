#!/usr/bin/env node
// Offline unit checks for the engine helpers that talk to the network in real use: local fonts (lib/fonts.mjs) and
// image generation (lib/imagegen.mjs: configuration, size mapping, request construction, provider fallback).
// Nothing here downloads or spends quota: fetch is replaced by a recorder.
//
//   node tests/unit.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(process.env.ARTICLE2MEDIA_ENGINE || path.join(ROOT, 'skills', 'article2media', 'engine'), 'scripts', 'lib');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'a2m-unit-'));
// Isolate from the machine: own cache, own config file, no Codex CLI, fake keys. Set before the modules load.
for (const k of Object.keys(process.env)) if (/^ARTICLE2MEDIA_(IMAGE|CODEX|FONT)/.test(k) || /^(OPENAI|GOOGLE_GEMINI)_BASE_URL$/.test(k)) delete process.env[k];
Object.assign(process.env, { ARTICLE2MEDIA_CACHE: path.join(TMP, 'cache'), ARTICLE2MEDIA_CONFIG: path.join(TMP, 'config.json'), CODEX_BIN: path.join(TMP, 'no-codex'), OPENAI_API_KEY: 'sk-test', GEMINI_API_KEY: 'g-test' });
delete process.env.GOOGLE_API_KEY;

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    ${String(detail).slice(0, 600)}`}`); if (!ok) failed++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- fonts ----------
{
  const F = await import(pathToFileURL(path.join(LIB, 'fonts.mjs')).href);
  const G = 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Noto+Sans+SC:wght@400;700&display=block';
  const J = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-bold.css';
  const css = `/* t */\n@import url('${G}');\n@import url("${J}");\n:root{--x:1}`;
  check('没有本地字体时 @import 原样保留', F.localizeFonts(css) === css);
  const dir = F.fontsDir();
  fs.mkdirSync(path.join(dir, 'css'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'css', 'a.css'), "@font-face{font-family:'ZCOOL KuaiLe';src:url('../files/a.woff2')}");
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, imports: { [G]: { css: 'css/a.css', families: ['ZCOOL KuaiLe'] }, [J]: { css: 'css/gone.css' } } }));
  F.readManifest({ fresh: true });
  const out = F.localizeFonts(css);
  const local = pathToFileURL(path.join(dir, 'css', 'a.css')).href;
  check('清单里有的 @import 换成本地 file: 样式表，其余（文件不在）保持远程', out.includes(`@import url('${local}');`) && !out.includes(G) && out.includes(J) && out.endsWith(':root{--x:1}'), out);
  check('字体文件缺失时 importComplete 为假（fonts.mjs 会补下）', F.localCssFor(G) && !F.importComplete(G));
  const html = path.join(TMP, 'p.html');
  fs.writeFileSync(html, `<style>${css}</style><pre>@import url('${G}');</pre>`);
  const n = F.localizeHtmlFile(html);
  const h = fs.readFileSync(html, 'utf8');
  check('页面文件只改 <style> 里的 @import，正文里的同样文字不动', n === 1 && h.includes(`<pre>@import url('${G}');</pre>`) && h.includes(local), h);
  process.env.ARTICLE2MEDIA_FONTS = 'remote';
  check('ARTICLE2MEDIA_FONTS=remote 时不用本地字体', F.localizeFonts(css) === css);
  delete process.env.ARTICLE2MEDIA_FONTS;
  check('--mirror 只换主机，路径和参数不变', F.mirrorUrl(G, { google: 'fonts.example.cn' }) === G.replace('fonts.googleapis.com', 'fonts.example.cn')
    && F.mirrorUrl('https://fonts.gstatic.com/s/a.woff2', { google: 'fonts.example.cn' }) === 'https://fonts.gstatic.com/s/a.woff2'
    && F.mirrorUrl(J, { jsdelivr: 'http://127.0.0.1:8080' }) === J.replace('https://cdn.jsdelivr.net', 'http://127.0.0.1:8080'));
  const imports = F.collectImports();
  check(`引擎里的字体 @import 都能识别（${imports.length} 组）`, imports.length >= 10 && imports.every((w) => /^https:\/\/(fonts\.googleapis\.com|cdn\.jsdelivr\.net)\//.test(w.url)), JSON.stringify(imports.map((w) => w.url)));
}

// ---------- image generation ----------
{
  const I = await import(pathToFileURL(path.join(LIB, 'imagegen.mjs')).href);
  const calls = [];
  let respond = () => ({ status: 500, body: {} });
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = respond(String(url), init);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: 'x', json: async () => r.body, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const ref = path.join(TMP, 'anchor.png');
  fs.writeFileSync(ref, PNG);
  const okOpenai = { status: 200, body: { data: [{ b64_json: PNG.toString('base64') }] } };
  const okGemini = { status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] } };
  const quiet = { log: () => {} };

  // configuration
  let c = I.imageConfig();
  check('默认模型只有一处来源', eq(c.models, I.IMAGE_DEFAULTS.models) && c.provider === null && c.quality === 'medium');
  fs.writeFileSync(process.env.ARTICLE2MEDIA_CONFIG, JSON.stringify({ image: { provider: 'gemini', models: { openai: 'cfg-openai', gemini: 'cfg-gemini' } } }));
  process.env.ARTICLE2MEDIA_IMAGE_MODEL_OPENAI = 'env-openai';
  c = I.imageConfig();
  check('模型：环境变量 > 配置文件 > 默认', c.models.openai === 'env-openai' && c.models.gemini === 'cfg-gemini' && c.models.codex === I.IMAGE_DEFAULTS.models.codex && c.provider === 'gemini');
  check('配置文件指定的服务生效；--provider 参数优先', I.pickImageProvider() === 'gemini' && I.pickImageProvider('openai') === 'openai');
  process.env.ARTICLE2MEDIA_IMAGE_PROVIDER = 'openai';
  check('ARTICLE2MEDIA_IMAGE_PROVIDER 覆盖配置文件', I.pickImageProvider() === 'openai' && I.describeImageSetup().forced);
  process.env.ARTICLE2MEDIA_IMAGE_PROVIDER = 'dalle';
  let threw = ''; try { I.imageConfig(); } catch (e) { threw = e.message; }
  check('无效的服务名给出明确报错', /图像服务设置无效：dalle/.test(threw), threw);
  delete process.env.ARTICLE2MEDIA_IMAGE_PROVIDER; delete process.env.ARTICLE2MEDIA_IMAGE_MODEL_OPENAI;
  fs.rmSync(process.env.ARTICLE2MEDIA_CONFIG);
  process.env.ARTICLE2MEDIA_CODEX_IMAGE_MODEL = 'old-name';
  check('旧环境变量 ARTICLE2MEDIA_CODEX_IMAGE_MODEL 仍然有效', I.imageConfig().models.codex === 'old-name');
  delete process.env.ARTICLE2MEDIA_CODEX_IMAGE_MODEL;
  check('没装 / 没登录的 Codex 不算可用，自动选到 OpenAI', I.codexStatus() === 'missing' && !I.detectImageProviders().codex && I.pickImageProvider() === 'openai');

  // sizes
  const sz = (p, a) => { const s = I.sizeFor(p, a); return [s.size, Math.round(s.crop * 100), s.side]; };
  check('比例映射 OpenAI / Codex：9:16、3:4、4:5 → 1024x1536，16:9、4:3 → 1536x1024，并给出裁切量',
    eq(sz('openai', '9:16'), ['1024x1536', 16, 'width']) && eq(sz('openai', '3:4'), ['1024x1536', 11, 'height']) && eq(sz('codex', '4:5'), ['1024x1536', 17, 'height'])
    && eq(sz('openai', '16:9'), ['1536x1024', 16, 'height']) && eq(sz('codex', '4:3'), ['1536x1024', 11, 'width']) && eq(sz('openai', '1:1'), ['1024x1024', 0, 'height']) && eq(sz('openai', '2:3'), ['1024x1536', 0, 'height']),
    JSON.stringify(['9:16', '3:4', '4:5', '16:9', '4:3', '1:1', '2:3'].map((a) => sz('openai', a))));
  check('比例映射 Gemini：常用比例原生支持，不裁切；没有的取最接近的', ['9:16', '3:4', '4:5', '16:9', '1:1', '2:3'].every((a) => eq(sz('gemini', a).slice(0, 2), [a, 0])) && I.sizeFor('gemini', '5:7').size === '3:4' && /裁掉约/.test(I.sizeFor('openai', '9:16').note));

  // request construction
  let q = I.openaiRequest('a cat', '3:4', {});
  let body = JSON.parse(q.init.body);
  check('OpenAI 无参考图：POST images/generations，JSON，尺寸取最接近的并在 prompt 里说明裁切',
    q.url === 'https://api.openai.com/v1/images/generations' && q.init.headers.authorization === 'Bearer sk-test' && body.model === 'gpt-image-1' && body.size === '1024x1536' && body.quality === 'medium' && body.n === 1
    && body.prompt.startsWith('a cat') && /center-cropped to 3:4/.test(body.prompt), q.init.body);
  q = I.openaiRequest('a cat', '2:3', { refs: [{ path: ref, note: 'the hero' }] });
  const form = q.init.body;
  const img = form instanceof FormData ? form.getAll('image[]') : [];
  check('OpenAI 有参考图：POST images/edits，multipart，image[] 带参考图文件，不手写 content-type',
    q.url === 'https://api.openai.com/v1/images/edits' && form instanceof FormData && img.length === 1 && img[0].size === PNG.length && img[0].type === 'image/png' && img[0].name === 'anchor.png'
    && form.get('model') === 'gpt-image-1' && form.get('size') === '1024x1536' && form.get('quality') === 'medium' && /image 1 = the hero/.test(form.get('prompt')) && /a cat$/.test(form.get('prompt')) && !q.init.headers['content-type'],
    form instanceof FormData ? JSON.stringify([...form.keys()]) : typeof form);
  q = I.openaiRequest('a cat', '16:9', { model: 'dall-e-3' });
  body = JSON.parse(q.init.body);
  check('OpenAI 换成非 gpt-image 模型：不带 quality，要求 b64_json，尺寸表跟着换', body.size === '1792x1024' && body.response_format === 'b64_json' && !('quality' in body), q.init.body);
  process.env.OPENAI_BASE_URL = 'https://gw.example.com/v1/';
  check('OPENAI_BASE_URL 可以换网关', I.openaiRequest('x', '1:1').url === 'https://gw.example.com/v1/images/generations');
  delete process.env.OPENAI_BASE_URL;
  q = I.geminiRequest('a cat', '9:16', { refs: [{ path: ref }] });
  body = JSON.parse(q.init.body);
  const parts = body.contents[0].parts;
  check('Gemini：generateContent，参考图是 inlineData 图片 part，比例走 imageConfig.aspectRatio',
    q.url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent' && q.init.headers['x-goog-api-key'] === 'g-test'
    && parts.length === 2 && /a cat/.test(parts[0].text) && parts[1].inlineData.mimeType === 'image/png' && parts[1].inlineData.data === PNG.toString('base64')
    && eq(body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } }), q.init.body);

  // fallback
  const logs = [];
  const run = async (provider, opts = {}) => { calls.length = 0; try { return await I.generateImage(provider, 'p', '1:1', { log: (s) => logs.push(s), ...opts }); } catch (e) { return e; } };
  I.resetImageState(); I.pickImageProvider();
  respond = (url) => (/openai/.test(url) ? { status: 401, body: { error: { message: 'Incorrect API key provided' } } } : okGemini);
  let r = await run('openai');
  check('OpenAI 401 → 自动改用 Gemini，并说明用了哪个', r.provider === 'gemini' && r.fallbackFrom === 'openai' && r.model === 'gemini-3.1-flash-image' && calls.length === 2 && logs.some((l) => /⚠ 图像服务 openai 用不了.*改用 gemini \/ gemini-3\.1-flash-image/.test(l)), r.message || JSON.stringify(logs));
  logs.length = 0;
  r = await run('openai');
  check('同一次运行里失效的服务不再重试，也不重复提示', r.provider === 'gemini' && calls.length === 1 && !logs.length, JSON.stringify([calls.length, logs]));
  I.resetImageState(); I.pickImageProvider();
  respond = (url) => (/openai/.test(url) ? { status: 400, body: { error: { message: 'Your request was rejected by the safety system.', code: 'moderation_blocked' } } } : okGemini);
  r = await run('openai');
  check('内容被拒绝：不换服务，直接报告', r instanceof Error && r.kind === 'refused' && calls.length === 1, r.message || JSON.stringify(r));
  respond = (url) => (/openai/.test(url) ? { status: 400, body: { error: { message: 'Invalid size' } } } : okGemini);
  r = await run('openai');
  check('请求本身有错（400）：不换服务', r instanceof Error && r.kind === 'request' && calls.length === 1, r.message);
  I.resetImageState(); I.pickImageProvider();
  respond = (url) => (/openai/.test(url) ? { status: 429, body: { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } } } : { status: 429, body: { error: { message: 'Quota exceeded for metric … free_tier … limit: 0' } } });
  r = await run('openai');
  check('所有服务都失败：报错里列出每一个的原因', r instanceof Error && r.kind === 'quota' && /openai：.*备用 gemini：.*免费层/.test(r.message), r.message);
  I.resetImageState(); I.pickImageProvider('openai');
  respond = (url) => (/openai/.test(url) ? { status: 401, body: { error: { message: 'bad key' } } } : okGemini);
  r = await run('openai');
  check('--provider 指定了服务：失败时不自动换', r instanceof Error && r.kind === 'auth' && calls.length === 1, r.message);
  I.resetImageState(); I.pickImageProvider();
  respond = (url) => (/googleapis/.test(url) ? { status: 200, body: { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] } } : okOpenai);
  r = await run('gemini');
  check('Gemini 因安全策略没出图：算拒绝，不换服务', r instanceof Error && r.kind === 'refused' && calls.length === 1, r.message);
  respond = (url) => (/googleapis/.test(url) ? { status: 503, body: { error: { message: 'overloaded' } } } : okOpenai);
  r = await run('gemini', { refs: [{ path: ref }] });
  check('Gemini 503 → 这一张改用 OpenAI，参考图一起带过去（images/edits）', r.provider === 'openai' && /images\/edits$/.test(calls[1].url) && calls[1].init.body instanceof FormData, r.message);
  respond = () => okGemini;
  r = await run('gemini');
  check('临时故障不会把服务标记为失效，下一张照常先用它', r.provider === 'gemini' && calls.length === 1, r.message);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\n✗ 失败 ${failed} 项` : '\n✓ 全部通过');
process.exit(failed ? 1 : 0);
