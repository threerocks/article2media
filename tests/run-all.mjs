#!/usr/bin/env node
// End-to-end self test for the article2media skills (10 capabilities + the article2media entry and its shared engine).
//
//   node tests/run-all.mjs            # skills + CLI behaviour + 公众号/插画/原文/翻译 checks + full matrix (every example × layout × theme)
//   node tests/run-all.mjs --quick    # same checks, one theme per layout
//
// Pass = every CLI check behaves as expected and every render reports 0 layout errors.
// Warnings (e.g. auto-dropped captions on 1:1 cards) are counted and listed, not failed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(ROOT, 'skills');
const SKILL = path.join(SKILLS, 'article2media', 'engine'); // shared engine: scripts, layouts, themes, assets
const RENDER = path.join(SKILL, 'scripts', 'render.mjs');
const EXDIR = path.join(SKILLS, 'article-rewrite', 'examples');
const EXAMPLES = fs.readdirSync(EXDIR).filter((f) => f.endsWith('.json')).map((f) => path.join(EXDIR, f));
const wrapper = (skill, name) => path.join(SKILLS, skill, 'scripts', `${name}.mjs`);
const exec = (file, args, timeout = 600000) => {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'a2i-test-'));
const quick = process.argv.includes('--quick');
const onlyThemes = process.argv.includes('--themes') ? process.argv[process.argv.indexOf('--themes') + 1] : null;

const run = (args) => exec(RENDER, args);
// A 1×1 PNG for tests that need a local picture.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    ${detail.split('\n').slice(-6).join('\n    ')}`}`);
  if (!ok) failed++;
};

// ---------- 0. Skills: every capability is its own skill, all on one version, all reaching the shared engine ----------
console.log('== Skills');
{
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const dirs = fs.readdirSync(SKILLS).filter((d) => fs.statSync(path.join(SKILLS, d)).isDirectory());
  const bad = [];
  for (const d of dirs) {
    const f = path.join(SKILLS, d, 'SKILL.md');
    if (!fs.existsSync(f)) { bad.push(`${d}: 没有 SKILL.md`); continue; }
    const fm = fs.readFileSync(f, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
    const get = (k) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.replace(/^"|"$/g, '');
    if (get('name') !== d) bad.push(`${d}: name 是 ${get('name')}`);
    if (get('version') !== plugin.version) bad.push(`${d}: version ${get('version')} ≠ ${plugin.version}`);
    if (!get('description') || get('description').length > 1024) bad.push(`${d}: description 缺失或超过 1024 字符`);
    if (!fs.existsSync(path.join(SKILLS, d, 'agents', 'openai.yaml'))) bad.push(`${d}: 没有 agents/openai.yaml`);
    // Every ${CLAUDE_SKILL_DIR}/… path a SKILL.md or reference mentions must exist.
    for (const doc of [f, ...(fs.existsSync(path.join(SKILLS, d, 'references')) ? fs.readdirSync(path.join(SKILLS, d, 'references')).map((x) => path.join(SKILLS, d, 'references', x)) : [])]) {
      for (const m of fs.readFileSync(doc, 'utf8').matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([\w./-]+\.(?:mjs|md|json))/g)) {
        if (!fs.existsSync(path.join(SKILLS, d, m[1]))) bad.push(`${d}: ${path.basename(doc)} 提到的 ${m[1]} 不存在`);
      }
    }
  }
  check(`${dirs.length} 个 skill：SKILL.md 名字与目录一致、版本都是 ${plugin.version}、描述 ≤ 1024 字符、引用的脚本和文档都存在`, dirs.length >= 11 && !bad.length, bad.join('\n'));
  check('插件与市场版本一致', market.version === plugin.version && market.plugins.every((p) => p.version === plugin.version), JSON.stringify([plugin.version, market.version]));
  const wrappers = dirs.flatMap((d) => fs.existsSync(path.join(SKILLS, d, 'scripts')) ? fs.readdirSync(path.join(SKILLS, d, 'scripts')).filter((x) => x.endsWith('.mjs')).map((x) => path.join(SKILLS, d, 'scripts', x)) : []);
  const broken = wrappers.filter((w) => {
    const src = fs.readFileSync(w, 'utf8');
    const target = src.match(/new URL\('(\w+\.mjs)', engine\)/)?.[1];
    return !target || !fs.existsSync(path.join(SKILL, 'scripts', target));
  });
  check(`${wrappers.length} 个入口脚本都指向共享引擎里存在的脚本`, wrappers.length >= 17 && !broken.length, broken.join('\n'));
  let r = exec(wrapper('image-cards', 'cards'), ['--help']);
  check('入口脚本的用法提示用自己的名字（cards.mjs）', /node cards\.mjs/.test(r.out), r.out);
  r = exec(wrapper('article-fetch', 'fetch'), ['https://www.bilibili.com/video/BV1NprhBPEtR']);
  check('文章抓取不处理视频 → 提示改用 video-transcript', r.code !== 0 && /video-transcript/.test(r.out), r.out);
  r = exec(wrapper('video-transcript', 'transcribe'), ['https://example.com/post']);
  check('视频转文字不处理文章链接 → 提示改用 article-fetch', r.code !== 0 && /article-fetch/.test(r.out), r.out);
  // A copy of one skill without the engine next to it must fail with a clear message, not a stack trace.
  const lone = path.join(OUT, 'lone', 'image-cards');
  fs.mkdirSync(path.join(lone, 'scripts'), { recursive: true });
  fs.copyFileSync(wrapper('image-cards', 'cards'), path.join(lone, 'scripts', 'cards.mjs'));
  r = exec(path.join(lone, 'scripts', 'cards.mjs'), ['--list']);
  check('单独拷走一个 skill、旁边没有 article2media → 明确提示要一起安装', r.code === 2 && /找不到共享引擎/.test(r.out), r.out);

  // X posts whose substance is in attached videos: no network, a FxTwitter-shaped fixture.
  const { postToMarkdown } = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'x-post.mjs')).href);
  const st = {
    text: '標題の行\n\n本文です。',
    raw_text: { text: '標題の行\n\n本文です。 https://t.co/lnk https://t.co/pic', facets: [
      { type: 'url', original: 'https://t.co/lnk', replacement: 'https://example.com/page' },
      { type: 'media', original: 'https://t.co/pic' },
    ] },
    media: {
      photos: [{ type: 'photo', url: 'https://pbs.twimg.com/media/p1.jpg' }],
      all: [{ type: 'photo', url: 'https://pbs.twimg.com/media/p1.jpg' }, { type: 'video', url: 'https://video.twimg.com/v1.mp4', thumbnail_url: 'https://pbs.twimg.com/thumb1.jpg', duration: 6 }],
    },
  };
  const post = postToMarkdown(st, {}, { source: 'x' });
  check('X 帖子：视频写成封面图 + 视频链接（不当图片），图片和视频都在；媒体短链去掉、t.co 展开；标题行不重复',
    post.meta.title === '標題の行' && !post.body.startsWith('標題の行') && !/t\.co/.test(post.body) && post.body.includes('https://example.com/page')
    && post.body.includes('![图](https://pbs.twimg.com/media/p1.jpg)') && post.body.includes('![图](https://pbs.twimg.com/thumb1.jpg)')
    && post.body.includes('[▶ 视频（6 秒）](https://video.twimg.com/v1.mp4)') && !/!\[[^\]]*\]\([^)]*\.mp4/.test(post.body) && post.meta.videos?.length === 1, post.body);
}

// ---------- 1. CLI behaviour ----------
console.log('\n== CLI');
const gallery = EXAMPLES.find((f) => f.endsWith('gallery.json'));
const tmpContent = (patch) => {
  const c = { ...JSON.parse(fs.readFileSync(gallery, 'utf8')), ...patch };
  const f = path.join(OUT, `content-${Object.keys(patch).join('-') || 'plain'}.json`);
  fs.writeFileSync(f, JSON.stringify(c));
  return f;
};
{
  const f = tmpContent({ theme: undefined });
  let r = run([f, '--check']);
  check('不指定比例 → 手机长图（1080 宽）', r.code === 0 && /版式：手机长图/.test(r.out), r.out);
  r = run([f, '--out', path.join(OUT, 'd1'), '--page', '1']);
  check('不指定主题且 content 无 theme → editorial（默认）', r.code === 0 && /主题：editorial（默认）/.test(r.out) && fs.existsSync(path.join(OUT, 'd1', 'page-01.png')), r.out);
  {
    // Phone long image is 1080 px wide; --wide is the 1200 px magazine page (2400 px at 2x).
    const w = (file) => fs.readFileSync(file).readUInt32BE(16);
    const rw = run([f, '--wide', '--out', path.join(OUT, 'd1w'), '--page', '1']);
    check('长图默认 1080 宽，--wide 为 2400 宽', rw.code === 0 && w(path.join(OUT, 'd1', 'page-01.png')) === 1080 && w(path.join(OUT, 'd1w', 'page-01.png')) === 2400, rw.out);
    const rl = run(['--list']);
    check('--list 先列 12 套主推主题，再列经典主题', rl.code === 0 && (rl.out.split('经典主题')[0].match(/^[\w-]+ /gm) || []).length === 12 && /cloud/.test(rl.out.split('经典主题')[1] || ''), rl.out);
    const rc = run([f, '--ratio', '3:4', '--theme', 'cloud', '--out', path.join(OUT, 'd1c'), '--page', '1']);
    check('经典主题仍可按名字渲染', rc.code === 0 && /版面检查：0 个错误/.test(rc.out), rc.out);
    // Cover variants, lighter forms, brand kit — all cut from the same content.json.
    const bd = path.join(OUT, 'brandkit');
    fs.mkdirSync(bd, { recursive: true });
    const g = JSON.parse(fs.readFileSync(f, 'utf8'));
    g.qa = [{ q: '图里的文字能太长吗？', a: '不能。方框里不超过十个字，句子留给图注和正文。' }, { q: '两张图怎么选？', a: '一张讲结构或数据，一张讲观点或对比。' }];
    g.cover = { ...(g.cover || {}), alts: [{ title: '所有图表\n**一次看全**' }] };
    fs.writeFileSync(path.join(bd, 'content.json'), JSON.stringify(g));
    fs.writeFileSync(path.join(bd, 'avatar.png'), PNG);
    fs.writeFileSync(path.join(bd, 'brand.json'), JSON.stringify({ name: '测试号', handle: '@test', avatar: 'avatar.png', tagline: '一行介绍', accent: '#FF5A1F', issue: 12 }));
    const bc = path.join(bd, 'content.json');
    let rb = run([bc, '--ratio', '3:4', '--covers', '--out', path.join(bd, 'covers')]);
    const cv = fs.existsSync(path.join(bd, 'covers')) ? fs.readdirSync(path.join(bd, 'covers')).filter((x) => /^cover-\d+-\w+\.png$/.test(x)) : [];
    check('--covers：cover.alts 每个备选各出一张封面，文件名带版式', rb.code === 0 && cv.length === 2 && /版面检查：0 个错误/.test(rb.out), rb.out + cv.join(','));
    delete g.cover.alts; fs.writeFileSync(bc, JSON.stringify(g));
    rb = run([bc, '--ratio', '3:4', '--covers', '--out', path.join(bd, 'covers2')]);
    check('--covers：没写备选时按可用版式各出一张（hook / quote / toc）', rb.code === 0 && ['hook', 'quote', 'toc'].every((st) => fs.readdirSync(path.join(bd, 'covers2')).some((x) => x.includes(`-${st}.png`))), rb.out);
    for (const [form, stem] of [['onepage', 'onepage'], ['quotes', 'quote'], ['qa', 'qa']]) {
      rb = run([bc, '--ratio', '3:4', '--form', form, '--out', path.join(bd, form)]);
      check(`--form ${form}：出图、0 错误`, rb.code === 0 && /版面检查：0 个错误/.test(rb.out) && fs.existsSync(path.join(bd, form, `${stem}-01.png`)) && !fs.existsSync(path.join(bd, form, 'caption.md')), rb.out);
    }
    rb = run([f, '--ratio', '3:4', '--form', 'qa', '--out', path.join(bd, 'noqa')]);
    check('--form qa 没有 qa 字段 → 报错', rb.code !== 0 && /qa/.test(rb.out), rb.out);
    rb = run([bc, '--ratio', '3:4', '--out', path.join(bd, 'cards'), '--html-only']);
    const bh = fs.existsSync(path.join(bd, 'cards', 'cards.html')) ? fs.readFileSync(path.join(bd, 'cards', 'cards.html'), 'utf8') : '';
    check('品牌包：头像、期号、品牌色、末张品牌栏进入卡片', /class="b-ava"/.test(bh) && /第 12 期/.test(bh) && /--accent-1: #FF5A1F/.test(bh) && /class="end-brand"/.test(bh) && /一行介绍/.test(bh), rb.out);
    rb = run([bc, '--out', path.join(bd, 'long'), '--page', '1', '--issue', '13', '--html-only']);
    const lh = fs.existsSync(path.join(bd, 'long', 'page-01.html')) ? fs.readFileSync(path.join(bd, 'long', 'page-01.html'), 'utf8') : '';
    check('品牌包：长图页眉带期号（--issue 覆盖 brand.json）、页脚带头像', /第 13 期/.test(lh) && /pg-brand-ava/.test(lh), rb.out);
  }
}
{
  // image figures may point at local files, relative to content.json (e.g. frames cut from a source video).
  const dir = path.join(OUT, 'localimg');
  fs.mkdirSync(path.join(dir, 'pics'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pics', 'a.png'), PNG);
  const c = JSON.parse(fs.readFileSync(gallery, 'utf8'));
  c.pages = [c.pages[0]];
  c.pages[0].sections[0].figures[0] = { type: 'image', src: 'pics/a.png', caption: '本地图片' };
  const f = path.join(dir, 'content.json');
  fs.writeFileSync(f, JSON.stringify(c));
  let r = run([f]);
  check('配图用本地文件（路径相对 content.json）：长图正常加载、0 错误', r.code === 0 && /版面检查：0 个错误/.test(r.out), r.out);
  c.pages[0].sections[0].figures[0].src = 'pics/missing.png';
  fs.writeFileSync(f, JSON.stringify(c));
  r = run([f, '--check']);
  check('配图的本地文件不存在 → 报错', r.code !== 0 && /找不到图片文件/.test(r.out), r.out);
}
{
  const f = tmpContent({ theme: 'notebook' });
  const r = run([f, '--out', path.join(OUT, 'd2'), '--page', '1']);
  check('content.json 的 theme 生效', r.code === 0 && /主题：notebook（content.json 指定）/.test(r.out), r.out);
  const f2 = tmpContent({ theme: { long: 'midnight', cards: 'brutal' } });
  const rl = run([f2, '--out', path.join(OUT, 'd5'), '--page', '1']);
  const rc = run([f2, '--ratio', '3:4', '--out', path.join(OUT, 'd6'), '--page', '1']);
  check('theme 按版式区分：长图 midnight / 卡片 brutal', /主题：midnight/.test(rl.out) && /主题：brutal/.test(rc.out), rl.out + rc.out);
  const r2 = run([f, '--theme', 'swiss', '--out', path.join(OUT, 'd3'), '--page', '1']);
  check('--theme 覆盖 content.json', r2.code === 0 && /\[swiss\]/.test(r2.out), r2.out);
}
{
  let r = run([gallery, '--layout', 'xhs', '--check']);
  check('--layout xhs → 3:4 卡片', r.code === 0 && /小红书 \/ 3:4/.test(r.out), r.out);
  r = run([gallery, '--ratio', '4x5', '--check']);
  check('--ratio 4x5 写法也能识别', r.code === 0 && /Instagram \/ 4:5/.test(r.out), r.out);
  r = run([gallery, '--ratio', '2:3', '--check']);
  check('不支持的比例 → 报错退出', r.code !== 0 && /不支持的比例/.test(r.out), r.out);
  r = run([gallery, '--layout', 'long', '--ratio', '3:4', '--check']);
  check('长图 + 比例 → 报错退出', r.code !== 0, r.out);
  r = run([tmpContent({ theme: 'nope' }), '--out', path.join(OUT, 'd4')]);
  check('content.json 里的未知主题 → 报错退出', r.code !== 0 && /没有主题/.test(r.out), r.out);
  r = run([gallery, '--layout', 'wechat', '--check']);
  check('公众号排版只吃文章：给 content.json → 报错并提示先导出 rewrite.md', r.code !== 0 && /只接受文章/.test(r.out) && /export\.mjs/.test(r.out), r.out);
  r = run([gallery, '--layout', 'wechat', '--ratio', '3:4', '--check']);
  check('公众号 + 比例 → 报错退出', r.code !== 0, r.out);
  r = run(['--list']);
  const n = (r.out.match(/^\w[\w-]*\s+/gm) || []).length;
  check(`--list 列出全部主题（${n} 个）`, r.code === 0 && n >= 21, r.out);
}

// ---------- 1b. AI illustrations (offline mock provider) + 改写稿 → rewrite.md → 公众号 ----------
console.log('\n== AI 插画 + 公众号总结');
{
  const dir = path.join(OUT, 'ill');
  fs.mkdirSync(dir, { recursive: true });
  const c = JSON.parse(fs.readFileSync(gallery, 'utf8'));
  c.theme = 'dopamine';
  c.cover = { ...(c.cover || {}), illustration: { prompt: 'a paper plane flying over a city at dawn' } };
  c.pages[0].sections[0].figures[1] = { type: 'illustration', prompt: 'a small seedling growing out of a laptop keyboard', caption: '测试插画。' };
  const f = path.join(dir, 'content.json');
  fs.writeFileSync(f, JSON.stringify(c));
  let r = run([f, '--out', path.join(dir, 'before'), '--page', '1']);
  check('插画未生成 → 占位框 + 提示（不报错）', r.code === 0 && /插画还没生成/.test(r.out), r.out);
  r = exec(wrapper('article-rewrite', 'export'), [f]);
  check('插画未生成时导出文章 → 报错（不交付占位框）', r.code !== 0 && /插画还没生成/.test(r.out), r.out);
  const g = exec(wrapper('article-rewrite', 'illustrate'), [f, '--provider', 'mock']);
  const files = fs.existsSync(path.join(dir, 'illustrations')) ? fs.readdirSync(path.join(dir, 'illustrations')).filter((x) => x.endsWith('.svg')) : [];
  check(`illustrate.mjs --provider mock 生成 2 张（实际 ${files.length}）`, g.code === 0 && files.length === 2, g.out);
  for (const lay of [[], ['--ratio', '3:4']]) {
    r = run([f, ...lay, '--out', path.join(dir, lay[1] || 'long')]);
    const m = r.out.match(/版面检查：(\d+) 个错误/);
    check(`有插画 · ${lay[1] || 'long'}：0 错误、无占位`, r.code === 0 && m && m[1] === '0' && !/插画还没生成/.test(r.out), r.out);
  }
  r = run([f, '--theme', 'brutal', '--out', path.join(dir, 'brutal'), '--page', '1']);
  check('别的主题没有专属插画 → 借用并提示', r.code === 0 && /借用了 dopamine 主题的插画/.test(r.out), r.out);

  // 公众号总结：content.json → export → rewrite.md → wechat-layout
  r = exec(wrapper('article-rewrite', 'export'), [f]);
  const rmd = path.join(dir, 'rewrite.md');
  const md = fs.existsSync(rmd) ? fs.readFileSync(rmd, 'utf8') : '';
  const figs = fs.existsSync(path.join(dir, 'rewrite-assets')) ? fs.readdirSync(path.join(dir, 'rewrite-assets')).filter((x) => /^fig-.*\.png$/.test(x)) : [];
  check(`导出 rewrite.md：front matter 带主题与来源，图表转成图片（${figs.length} 张）+ 题图`, r.code === 0 && /kind: "rewrite"/.test(md) && /theme: "dopamine"/.test(md) && /hero: "rewrite-assets\/hero\.png"/.test(md) && figs.length >= 4 && /!\[图 1A\]\(rewrite-assets\/fig-1A\.png\)/.test(md), r.out + md.slice(0, 400));
  r = exec(wrapper('wechat-layout', 'wechat'), [rmd, '--out', path.join(dir, 'wechat')]);
  check('公众号排版 rewrite.md：主题跟随导出、逐块一致、0 错误', r.code === 0 && /主题：dopamine（文章 front matter 指定）/.test(r.out) && /全文校验：通过/.test(r.out) && /版面检查：0 个错误/.test(r.out), r.out);
  const body = fs.existsSync(path.join(dir, 'wechat', 'article-body.html')) ? fs.readFileSync(path.join(dir, 'wechat', 'article-body.html'), 'utf8') : '';
  const imgs = (body.match(/<img [^>]*src="data:image\/png;base64,/g) || []).length;
  check(`公众号正文只有内联样式，图片内嵌（${imgs} 张），没有残留标记属性`, body && !/\sclass=|<style|<script|data-source-block|data-deco/.test(body) && imgs >= figs.length + 1, body.slice(0, 300));
  check('公众号封面：头图 + 1:1 + 发布信息', ['cover-2.35x1.png', 'cover-1x1.png', 'wechat.md', 'ledger.json'].every((x) => fs.existsSync(path.join(dir, 'wechat', x))));
}

// ---------- 1c. 口播视频 (offline: system voice) ----------
console.log('\n== 口播视频');
{
  const VIDEO = path.join(SKILL, 'scripts', 'video.mjs');
  const vrun = (args) => { const r = spawnSync(process.execPath, [VIDEO, ...args], { encoding: 'utf8', timeout: 900000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const dir = path.join(OUT, 'video');
  fs.mkdirSync(dir, { recursive: true });
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ scenes: [{ id: 'a', type: 'nope', lines: ['大家好，今天给大家分享一个特别特别特别长而且完全没有重点的开场白。'] }] }));
  let r = vrun(['check', bad]);
  check('video check：未知镜头类型 → 报错；寒暄开场 → 提示', r.code !== 0 && /未知类型/.test(r.out) && /寒暄/.test(r.out), r.out);
  // Clips, music, transitions (all optional): validation, timeline and the audio bed — no rendering needed.
  {
    const M = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'video', 'media.mjs')).href);
    const R = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'video', 'render.mjs')).href);
    const mdir = path.join(dir, 'media', 'video');
    fs.mkdirSync(mdir, { recursive: true });
    const ffm = (args) => spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' }).status === 0;
    const haveFf = ffm(['-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=330:d=2', '-shortest', '-pix_fmt', 'yuv420p', path.join(mdir, 'src.mp4')])
      && ffm(['-f', 'lavfi', '-i', 'sine=f=220:d=3', '-ac', '2', path.join(mdir, 'tone.wav')]);
    const url = 'https://video.twimg.com/amplify_video/1/vid/v.mp4?tag=29';
    fs.writeFileSync(path.join(dir, 'media', 'meta.json'), JSON.stringify({ url: 'https://x.com/a/status/1', videos: [{ url, duration: 6 }] }));
    const line = '只用 3 个月，粉丝从 0 涨到 1 万。';
    const sc = (id, extra) => ({ id, type: 'title', lines: [line], title: '标题', ...extra });
    const mf = path.join(mdir, 'video.json');
    fs.writeFileSync(mf, JSON.stringify({ transition: 'wipe', music: { src: 'nope.mp3', volume: 3 }, scenes: [
      sc('a', { clip: { src: 'missing.mp4', place: 'left' } }), sc('b', { transition: 'zoom', clip: { src: 'src.mp4', start: 3, end: 2 } }), sc('c', { clip: { src: url } })] }));
    r = vrun(['check', mf]);
    check('video check：片段 / 配乐 / 转场写错都报错（未知 place、transition，end ≤ start，文件不存在，volume 越界）',
      r.code !== 0 && /transition 未知值 "wipe"/.test(r.out) && /transition 未知值 "zoom"/.test(r.out) && /clip\.place 未知值 "left"/.test(r.out) && /clip 找不到文件 missing\.mp4/.test(r.out)
      && /clip\.end（2）必须大于 clip\.start（3）/.test(r.out) && /music 找不到文件 nope\.mp3/.test(r.out) && /music\.volume/.test(r.out), r.out);
    check('片段写成 meta.json 里的视频地址但没下载 → 报错并给出下载命令，不自动下载',
      /还没有下载到本地/.test(r.out) && /curl -L --create-dirs -o '[^']*videos\/v\.mp4'/.test(r.out) && !fs.existsSync(path.join(dir, 'media', 'videos')), r.out);
    if (!haveFf) console.log('（没有 ffmpeg：跳过片段与配乐的检查）');
    else {
      fs.mkdirSync(path.join(dir, 'media', 'videos'), { recursive: true });
      fs.copyFileSync(path.join(mdir, 'src.mp4'), path.join(dir, 'media', 'videos', 'v.mp4'));
      const good = { music: { src: 'tone.wav' }, scenes: [sc('a', { clip: { src: 'src.mp4', start: 0.5, end: 1.5, place: 'full', audio: true } }), sc('b', { transition: 'push', clip: { src: url, place: 'bottom' } }), sc('c', { transition: 'cut' })] };
      fs.writeFileSync(mf, JSON.stringify(good));
      r = vrun(['check', mf]);
      const media = M.resolveMedia(good, mdir);
      check('片段 / 配乐 / 转场写对 → 通过；已下载的视频地址解析成本地文件', r.code === 0 && media.clips.b.file === path.join(dir, 'media', 'videos', 'v.mp4') && media.clips.a.hasAudio && media.music.hasAudio, r.out + JSON.stringify(media));
      // Timeline: transitions and clips must not move scenes or captions.
      const chars = [...line].map((_, k) => [+(k * 0.15).toFixed(2), +(k * 0.15 + 0.15).toFixed(2)]);
      const align = { duration: 12, scenes: ['a', 'b', 'c'].map((id, k) => ({ id, start: k * 4, end: k * 4 + 3, lines: [{ text: line, start: k * 4, end: k * 4 + 3, chars: chars.map(([s, e]) => [k * 4 + s, k * 4 + e]) }] })) };
      const plain = { scenes: good.scenes.map(({ clip, transition, ...s }) => s) };
      const base = R.buildStage(plain, align, '', {}).data;
      const w = R.sceneWindows(good, align).windows;
      const clips = M.prepareClips(good, media, w, { dir: mdir, fps: 30 });
      const st = R.buildStage(good, align, '', { sceneClips: clips });
      const ev = (d, p) => d.events.filter((e) => e.p === p).map((e) => [e.id, +e.t.toFixed(3), e.tr || '']);
      check('不写新字段：时间轴上没有转场标记，也没有片段', !base.events.some((e) => e.tr) && !base.clips && !/class="[^"]*v-clip/.test(R.buildStage(plain, align, '', {}).html));
      check('转场和片段不改变镜头起点和字幕时间', JSON.stringify(ev(st.data, 'scene-in').map((e) => e.slice(0, 2))) === JSON.stringify(ev(base, 'scene-in').map((e) => e.slice(0, 2))) && JSON.stringify(st.data.captions) === JSON.stringify(base.captions) && st.data.total === base.total);
      const outs = ev(st.data, 'scene-out');
      check('push / cut 在切点同时换镜，默认转场提前 0.26 秒退场', outs[0][2] === 'push' && outs[0][1] === +w[0].out.toFixed(3) && outs[1][2] === 'cut' && ev(base, 'scene-out')[0][1] === +(w[0].out - 0.26).toFixed(3), JSON.stringify(outs));
      check(`片段切成帧（${clips.a.n} 帧 = 1 秒 × 30fps），比镜头短时停在最后一帧；舞台里是图片不是 <video>`,
        clips.a.n === 30 && clips.a.short > 0 && fs.existsSync(path.join(mdir, clips.a.base, '00029.jpg')) && /class="v-scene-illo v-clip full"/.test(st.html) && /v-clip bottom/.test(st.html) && !/<video/.test(st.html) && st.data.clips.length === 2, JSON.stringify(clips));
      // Music: looped to the length, ducked under the narration, back up in a long pause.
      const bed = M.buildBed({ music: { ...media.music, volume: 0.2, duck: true }, speech: [[1, 4]], total: 8 });
      const rms = (a, b) => { let s = 0, n = 0; for (let k = Math.round(a * 48000) * 2; k < Math.round(b * 48000) * 2; k++) { s += bed.pcm[k] ** 2; n++; } return Math.sqrt(s / n); };
      const ratio = rms(2, 3.5) / rms(6, 7);
      check(`配乐循环铺满全片、旁白下压低一半（${ratio.toFixed(2)}）、首尾淡入淡出`, bed.pcm.length === 8 * 48000 * 2 && bed.music.loops >= 3 && Math.abs(ratio - 0.5) < 0.05 && rms(6, 7) > 0.01 && rms(7.95, 8) < rms(6, 7) * 0.2 && rms(0, 0.02) < rms(6, 7) * 0.2, JSON.stringify(bed.music));
    }
  }
  const hasSay = process.platform === 'darwin';
  if (!hasSay) console.log('（非 macOS：跳过口播视频渲染）');
  else {
    const f = path.join(dir, 'video.json');
    fs.writeFileSync(f, JSON.stringify({
      theme: 'dopamine', voice: { backend: 'say' },
      cover: { kicker: '测试', title: '三个月\n涨到 **1 万**' },
      scenes: [
        { id: 'a', type: 'number', lines: ['只用 3 个月，粉丝从 0 涨到 1 万。'], label: '粉丝数', from: 0, to: 10000, count_cue: '1 万', image: { src: 'proof.png', cue: '1 万' } },
        { id: 'b', type: 'checklist', lines: ['记住两件事：先定位，再坚持。'], title: '两件事', items: [{ text: '先定位', cue: '先定位' }, { text: '再坚持', cue: '再坚持' }] },
      ],
    }));
    fs.writeFileSync(path.join(dir, 'proof.png'), PNG);
    r = vrun(['make', f, '--no-images']);
    const od = path.join(dir, 'dopamine');
    const stage = fs.existsSync(path.join(od, 'stage.html')) ? fs.readFileSync(path.join(od, 'stage.html'), 'utf8') : '';
    check('口播视频的本地图片按 video.json 所在目录解析', stage.includes(pathToFileURL(path.join(dir, 'proof.png')).href), stage.slice(0, 200));
    const files = ['video.mp4', 'cover.png', 'cover-3x4.jpg', 'captions.srt', 'post.md', 'contact-sheet.jpg', 'review.json'];
    const missing = files.filter((x) => !fs.existsSync(path.join(od, x)));
    check(`video make：出片 + 封面 + 字幕 + 审片（缺 ${missing.length} 个）`, r.code === 0 && !missing.length, r.out + missing.join(','));
    if (!missing.length) {
      const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', path.join(od, 'video.mp4')], { encoding: 'utf8' });
      const j = JSON.parse(pr.stdout || '{}');
      const v = (j.streams || []).find((x) => x.width);
      const dur = Number(j.format?.duration);
      check(`成片 1080×1920、时长合理（${dur.toFixed(1)}s）`, v?.width === 1080 && v?.height === 1920 && dur > 5 && dur < 30, pr.stdout);
      const rev = JSON.parse(fs.readFileSync(path.join(od, 'review.json'), 'utf8'));
      check('审片检查项齐全且没有版面错误', rev.checks.length >= 5 && !rev.issues.some((i) => i.level === 'error'), JSON.stringify(rev).slice(0, 400));
      const gap = rev.checks.find((c) => c.check.startsWith('字幕闪断'));
      const pace = rev.checks.find((c) => c.check === '旁白语速');
      check(`字幕不闪断（${gap?.value}），旁白语速有检查（${pace?.value}）`, gap?.ok === true && !!pace, JSON.stringify(rev.checks));
      // The timeline can be right and the frames still wrong: the review measures the caption band of the finished video.
      const drop = rev.checks.find((c) => c.check.startsWith('字幕丢帧'));
      check(`成片逐帧检查字幕：没有丢帧（${drop?.value}）`, drop?.ok === true, JSON.stringify(rev.checks));
      const stage = fs.readFileSync(path.join(od, 'stage.html'), 'utf8');
      check('字幕用主题样式（dopamine → sticker），没有弹跳缩放', /class="v-cap cap-sticker"/.test(stage) && !/cap\.style\.transform/.test(stage), stage.match(/<div class="v-cap[^>]*>/)?.[0] || '');
    }
  }
}

// ---------- 1c'. 音色库：版权分层 ----------
console.log('\n== 音色库');
{
  const VIDEO = path.join(SKILL, 'scripts', 'video.mjs');
  const vrun = (args) => { const r = spawnSync(process.execPath, [VIDEO, ...args], { encoding: 'utf8', timeout: 120000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const vdir = path.join(SKILL, 'assets', 'voices');
  const cat = JSON.parse(fs.readFileSync(path.join(vdir, 'catalog.json'), 'utf8'));
  const PUBLIC = ['designed', 'self-public', 'authorized-public'];
  const listed = new Set(['catalog.json', ...cat.voices.flatMap((v) => [v.reference_audio, v.reference_text])]);
  const stray = fs.readdirSync(vdir).filter((f) => !listed.has(f));
  const badRights = cat.voices.filter((v) => !PUBLIC.includes(v.rights) || !fs.existsSync(path.join(vdir, v.reference_audio)));
  check(`公开音色 ${cat.voices.length} 款：全部是可分发的权利类型，目录里没有未登记的音频`, cat.voices.length > 0 && !badRights.length && !stray.length && cat.voices.some((v) => v.id === cat.default), JSON.stringify({ badRights: badRights.map((v) => v.id), stray }));
  const t = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'video', 'text.mjs')).href);
  const st = t.splitStyle('(极度愤怒，东北话)注意看！这个男人叫小壮！');
  check('口播括号指令：拆成语气指令与字幕文字', st.style === '极度愤怒，东北话' && st.text === '注意看！这个男人叫小壮！', JSON.stringify(st));
  let r = vrun(['voice-import', path.join(vdir, cat.voices[0].reference_audio), '--id', 'x-test', '--rights', 'personal', '--public', '--source', '测试']);
  check('个人音色不能公开：voice-import --public --rights personal → 拒绝', r.code !== 0 && /只能进本机音色库/.test(r.out), r.out);
  r = vrun(['voice-design', '--id', 'x-test', '--prompt', '像云希一样的年轻男声']);
  check('公开音色设计不能点名具体的人或平台音色 → 拒绝', r.code !== 0 && /不能指向某个人/.test(r.out), r.out);
  // Pace: VoxCPM2 copies the reference's rhythm, so every public reference must be calm (≤ PACE.refMax 字/秒).
  const { PACE } = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'video', 'voice.mjs')).href);
  const wav = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'video', 'wav.mjs')).href);
  const rates = cat.voices.map((v) => {
    const { data, sr } = wav.readWav(path.join(vdir, v.reference_audio));
    const tr = wav.trimSpeech(data, sr);
    return { id: v.id, rate: +(t.voicedOnly(fs.readFileSync(path.join(vdir, v.reference_text), 'utf8')).length / (tr.data.length / sr)).toFixed(2) };
  });
  const fast = rates.filter((x) => x.rate > PACE.refMax);
  check(`公开音色参考语速都不急（≤ ${PACE.refMax} 字/秒；最快 ${Math.max(...rates.map((x) => x.rate))}）`, !fast.length, JSON.stringify(fast));
}

// ---------- 1c''. 字幕：主题样式 + 合并短语 ----------
console.log('\n== 字幕');
{
  const t = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'video', 'text.mjs')).href);
  const ph = t.captionPhrases('他说自己没特长，文笔也一般，做法归纳起来就三件事。真的吗？');
  check('同一句里的短语合并成一行（≤ 13 字），不跨句', ph.length === 3 && ph[0].text === '他说自己没特长 文笔也一般' && ph.every((p) => t.capWidth(p.text) <= 13) && ph[2].text === '真的吗？', JSON.stringify(ph));
  const { validate } = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'validate.mjs')).href);
  const ex = JSON.parse(fs.readFileSync(path.join(EXDIR, fs.readdirSync(EXDIR).find((f) => f.endsWith('.json'))), 'utf8'));
  const thErr = (theme) => validate({ ...ex, theme }).errors.filter((e) => /theme/.test(e)).length;
  check('content.json 的 theme 可以分别指定 long / cards / wechat（和文档一致），其他键报错', thErr({ long: 'editorial', cards: 'bento', wechat: 'quiet' }) === 0 && thErr({ video: 'quiet' }) > 0);
  // A long phrase is cut by width, never inside an English word or a number.
  const cut = ['Anthropic 最新的研究把代理的记忆拆成了四层结构来讲清楚', '用 Claude Code 只加载 MEMORY.md 前 200 行就够了真的', '第 1,935 步的时候它回到月见山洞口附近的华蓝市'].flatMap((l) => t.captionPhrases(l).map((p) => ({ l, ...p })));
  const midWord = cut.filter((p) => /[A-Za-z0-9]/.test(p.l[p.to - 1] || '') && /[A-Za-z0-9]/.test(p.l[p.to] || ''));
  check('字幕断行不切英文单词和数字（1,935 保持完整）', cut.length >= 6 && !midWord.length && cut.some((p) => p.text.includes('1,935')) && cut.every((p) => t.capWidth(p.text) <= 13), JSON.stringify(cut.map((p) => p.text)));
  // Pace counts 字: an English word by its syllables (≈ 3 letters each), an acronym by its letters — not every letter.
  const su = [t.speechUnits('Anthropic'), t.speechUnits('GPT'), t.speechUnits('只用 3 个月')];
  check(`语速按字计：Anthropic ≈ ${su[0]} 字、GPT = ${su[1]} 字、中文逐字`, su[0] === 3 && su[1] === 3 && su[2] === 5 && t.speechUnits('用 Anthropic 的 harness') < t.voicedOnly('用 Anthropic 的 harness').length / 2, JSON.stringify(su));
  const caps = JSON.parse(fs.readFileSync(path.join(SKILL, 'themes', 'caption-styles.json'), 'utf8'));
  const css = fs.readFileSync(path.join(SKILL, 'layouts', 'video.css'), 'utf8');
  const themes = fs.readdirSync(path.join(SKILL, 'themes')).filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4));
  const missing = themes.filter((th) => !caps[th]);
  const badStyle = Object.entries(caps).filter(([k, v]) => !k.startsWith('_') && !css.includes(`.v-cap.cap-${v.style} `));
  check(`每个主题都有字幕样式（${themes.length} 个），预设都在 video.css 里`, !missing.length && !badStyle.length, JSON.stringify({ missing, badStyle: badStyle.map(([k]) => k) }));
}

// ---------- 1d. -f 全文 / -w 白板 / -c 漫画 ----------
console.log('\n== 全文 · 白板 · 漫画');
{
  const lib = (f) => import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', f)).href);
  const full = await lib('layout-full.mjs');
  const dir = path.join(OUT, 'modes');
  fs.mkdirSync(dir, { recursive: true });
  const md = ['---', 'title: "测试原文"', 'author: "作者"', 'platform: "博客"', '---', '', '# 测试原文', '', '第一段，**加粗**和*斜体*，还有`代码`与[链接](https://x.com)。', '第一段的第二行，*斜体 -* ***粗斜体****。*', '',
    '**一个粗体小标题**', '', '> 一段引用。', '', '- 列表一', '- 列表二', '', '1. 有序一', '2. 有序二', '', '| 列 A | 列 B |', '| --- | --- |', '| 甲 | 乙 |', '', '```', 'const x = 1;', '```', '', '---', '', '最后一段：结束。'].join('\n');
  const art = path.join(dir, 'article.md');
  fs.writeFileSync(art, md);
  const { meta, body } = full.frontMatter(md);
  const blocks = full.parseBlocks(body, { title: meta.title });
  const ledger = full.ledgerOf(blocks);
  check(`-f 解析：${ledger.length} 个原文块，覆盖全部文字`, full.squash(full.sourcePlain(body)) === full.squash(ledger.map((b) => b.text).join('')) && ledger.length >= 12, JSON.stringify(ledger.map((b) => b.text)));
  const rb = (blocks) => ({ blocks, nested: [], stray: 0, backwards: 0 });
  const same = full.compareLedger(ledger, rb(ledger.map((b) => ({ ...b }))));
  const oneChar = ledger.map((b, i) => (i === 1 ? { ...b, text: b.text.replace('第一段', '第二段') } : b));
  const swapped = [ledger[1], ledger[0], ...ledger.slice(2)];
  const dropped = ledger.filter((_, i) => i !== 2);
  const dup = [...ledger, ledger[3]];
  const fails = [oneChar, swapped, dropped, dup].map((x) => full.compareLedger(ledger, rb(x)).length > 0);
  check('-f 校验：原样通过；改一字 / 调序 / 漏块 / 重复块全部失败', same.length === 0 && fails.every(Boolean), JSON.stringify({ same, fails }));
  const page = (src) => full.buildFullPage({ blocks: full.parseBlocks(src, {}), meta: {}, fullCss: '', images: {} });
  const enPage = page('It’s the most lucrative skill: *capturing attention -* ***good content****.*'), zhPage = page('最赚钱的技能，是抓住注意力（attention）。');
  check('-f 英文原文：lang="en"、拉丁衬线优先、不两端对齐；中文原文不变', /lang="en"/.test(enPage) && /full-page full-latin/.test(enPage) && /lang="zh-CN"/.test(zhPage) && !/full-latin/.test(zhPage));
  let r = run([art, '--layout', 'full', '--out', path.join(dir, 'full')]);
  check('-f 渲染：逐字一致、0 错误', r.code === 0 && /逐字一致/.test(r.out) && fs.existsSync(path.join(dir, 'full', 'full.png')), r.out);

  r = run([art, '--layout', 'whiteboard']);
  const inv = JSON.parse(fs.readFileSync(path.join(dir, 'whiteboard-source.json'), 'utf8'));
  check(`-w 来源清单：${inv.sections.length} 段`, r.code === 0 && inv.sections.length >= 10, r.out);
  const wb = { inventory: 'whiteboard-source.json', source_sha256: inv.source_sha256, title: '测试白板', question: '这段测试想说明什么？',
    source_sections: inv.sections.map((x, i) => (i % 3 === 0 ? { id: x.id, disposition: 'omitted', omission_reason: '测试用：格式示例，不参与论证' } : { id: x.id, disposition: 'rendered', step_ids: [i % 2 ? 'step-01' : 'step-02'] })),
    steps: [{ id: 'step-01', role: 'question', source_refs: [inv.sections[1].id], claim: '问题', support: '支持', image: { src: 'wb-pic.png' } }, { id: 'step-02', role: 'conclusion', source_refs: [inv.sections[2].id], claim: '结论', structure: { type: 'chain', items: ['甲', '乙'] } }],
    relations: [{ id: 'rel-01', from: 'step-01', to: 'step-02', kind: 'contrast', visibility: 'visible', bridge: '可是测试并不止于此。' }] };
  const wbOk = path.join(dir, 'whiteboard.json'), wbBad = path.join(dir, 'whiteboard-bad.json');
  fs.writeFileSync(wbOk, JSON.stringify(wb));
  fs.writeFileSync(wbBad, JSON.stringify({ ...wb, source_sections: wb.source_sections.slice(1) }));
  r = run([wbBad, '--layout', 'whiteboard', '--check']);
  check('-w 账本：漏处置的原文段落 → 报错', r.code !== 0 && /没有处置/.test(r.out), r.out);
  fs.writeFileSync(path.join(dir, 'wb-pic.png'), PNG);
  r = run([wbOk, '--layout', 'whiteboard']);
  check('-w 渲染（步骤配图用相对路径）：0 错误', r.code === 0 && fs.existsSync(path.join(dir, 'whiteboard', 'whiteboard.png')), r.out);
  // Themed whiteboards: a single-accent theme (quiet), a dark one (midnight). The theme's ink must reach the board
  // (a self-referential --ink blanks the spine and dots) and the three role colors must stay distinct.
  const wbl = await lib('layout-whiteboard.mjs');
  const themeCssOf = (t) => fs.readFileSync(path.join(SKILL, 'themes', `${t}.css`), 'utf8');
  const bridge = wbl.themeBridge(themeCssOf('quiet'));
  check('-w 主题：墨色继承主题、不自引用；单强调色主题（quiet）的三种角色色不重合', !/--(ink|muted):\s*var\(--\1\)/.test(bridge) && /--ink:inherit/.test(bridge) && !/--blue:var\(--accent-2\)/.test(bridge) && !/--green:var\(--accent-3\)/.test(bridge) && /--blue:var\(--accent-2\)/.test(wbl.themeBridge(themeCssOf('midnight'))), bridge);
  for (const t of ['quiet', 'midnight']) {
    r = run([wbOk, '--layout', 'whiteboard', '--theme', t, '--out', path.join(dir, `whiteboard-${t}`)]);
    check(`-w 渲染（${t} 主题）：0 错误`, r.code === 0 && fs.existsSync(path.join(dir, `whiteboard-${t}`, 'whiteboard.png')), r.out);
  }
  r = run([art, '--layout', 'full', '--theme', 'midnight', '--out', path.join(dir, 'full-midnight')]);
  check('-f 渲染（midnight 主题）：逐字一致、0 错误', r.code === 0 && /逐字一致/.test(r.out) && fs.existsSync(path.join(dir, 'full-midnight', 'full.png')), r.out);

  const COMIC = path.join(SKILL, 'scripts', 'comic.mjs');
  const crun = (args) => { const x = spawnSync(process.execPath, [COMIC, ...args], { encoding: 'utf8', timeout: 300000 }); return { code: x.status, out: (x.stdout || '') + (x.stderr || '') }; };
  const comic = { title: '测试漫画', bible: { character: 'a young man with glasses' }, recap: ['一', '二'], closing: '结束。',
    panels: [{ id: 'p01', role: '最小案例', size: 'wide', scene: 'a man looks at his phone', narration: '旁白一', bubbles: [{ text: '你好', x: 60, y: 50 }] }, { id: 'p02', role: '缺口', size: 'half', scene: 'he sighs' }, { id: 'p03', role: '重跑', size: 'half', scene: 'he smiles', sfx: '叮' }] };
  fs.writeFileSync(path.join(dir, 'comic-bad.json'), JSON.stringify({ ...comic, bible: {} }));
  r = crun(['check', path.join(dir, 'comic-bad.json')]);
  check('-c 检查：缺少角色设定 → 报错', r.code !== 0 && /bible\.character/.test(r.out), r.out);
  fs.writeFileSync(path.join(dir, 'comic.json'), JSON.stringify(comic));
  fs.mkdirSync(path.join(dir, 'comic-panels'), { recursive: true });
  for (const p of comic.panels) spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=${p.size === 'wide' ? '600x400' : '400x400'}`, '-frames:v', '1', path.join(dir, 'comic-panels', `${p.id}.png`)]);
  r = crun(['render', path.join(dir, 'comic.json')]);
  check('-c 排版（占位分格）：长漫画 + 3:4 卡片、0 错误', r.code === 0 && fs.existsSync(path.join(dir, 'comic', 'comic.png')) && fs.existsSync(path.join(dir, 'comic', 'card-05.png')), r.out);
}

// ---------- 1d'. 原文路径：原文卡片、公众号排版（原文）、全文翻译 ----------
console.log('\n== 原文卡片 · 公众号排版 · 翻译');
{
  const dir = path.join(OUT, 'original');
  fs.mkdirSync(dir, { recursive: true });
  // A long article with every block type: long paragraphs must split across cards.
  const para = (i) => `第 ${i} 段：注意力是最稀缺的资源，**没有人知道你**，再好的产品也卖不出去。` + '一个人把内容、产品和分发连成一条线，比一个团队各管一段更快。'.repeat(7) + `这是第 ${i} 段的结尾。`;
  const md = ['---', 'title: "原文卡片测试：一篇很长的文章"', 'author: "作者"', 'platform: "博客"', 'date: "2026-11-09"', 'url: "https://example.com/post"', '---', '',
    '# 原文卡片测试：一篇很长的文章', '', para(1), '', para(2), '', '## 第一部分', '', para(3), '', '> 一段引用：' + '引用里的话也要一字不差。'.repeat(4), '', '- 列表一：' + '每一项都要保留。'.repeat(3), '- 列表二', '- 列表三：' + '长列表项可以在行间断开。'.repeat(5), '',
    '1. 有序一', '2. 有序二', '', '| 列 A | 列 B |', '| --- | --- |', '| 甲 | 乙 |', '| 丙 | 丁 |', '', '```', 'const x = 1;', '  indented();', '```', '', '---', '', para(4), '', '### 小节', '', para(5), '', para(6), '', '[▶ 视频（6 秒）](https://video.twimg.com/amplify_video/1/vid/v.mp4?tag=29)', '', '最后一段：结束。'].join('\n');
  const art = path.join(dir, 'article.md');
  fs.writeFileSync(art, md);
  let r = exec(wrapper('image-cards', 'cards'), [art, '--ratio', '3:4']);
  const cdir = path.join(dir, 'full-3x4');
  const cards = fs.existsSync(cdir) ? fs.readdirSync(cdir).filter((x) => /^card-\d+\.png$/.test(x)) : [];
  const qa = fs.existsSync(path.join(cdir, 'qa.json')) ? JSON.parse(fs.readFileSync(path.join(cdir, 'qa.json'), 'utf8')) : {};
  check(`原文卡片 3:4：${cards.length} 张，逐块一致（段落跨卡拼接）、0 错误`, r.code === 0 && cards.length >= 4 && qa.verify === 'pass' && /版面检查：0 个错误/.test(r.out) && fs.existsSync(path.join(cdir, 'overview.jpg')) && fs.existsSync(path.join(cdir, 'caption.md')), r.out);
  const html = fs.existsSync(path.join(cdir, 'cards.html')) ? fs.readFileSync(path.join(cdir, 'cards.html'), 'utf8') : '';
  check('原文卡片：确实有段落在行间断开并在下一张接上', /class="[^"]*ac-cut/.test(html) && /class="[^"]*ac-cont/.test(html));
  r = exec(wrapper('image-cards', 'cards'), [art, '--ratio', '1:1', '--theme', 'midnight']);
  check('原文卡片 1:1 + 深色主题：0 错误（含正文对比度）', r.code === 0 && /版面检查：0 个错误/.test(r.out) && fs.existsSync(path.join(dir, 'midnight-full-1x1', 'card-01.png')), r.out);
  r = exec(wrapper('long-image', 'long'), [art, '--theme', 'midnight']);
  check('原文长图 + 深色主题：正文对比度够、0 错误', r.code === 0 && /版面检查：0 个错误/.test(r.out) && !/对比度/.test(r.out), r.out);
  r = exec(wrapper('long-image', 'long'), [art]);
  check('长图 skill 给文章 → 原文长图，逐字一致', r.code === 0 && /逐字一致/.test(r.out) && fs.existsSync(path.join(dir, 'full', 'full.png')), r.out);

  r = exec(wrapper('wechat-layout', 'wechat'), [art, '--theme', 'editorial', '--cover-title', '原文卡片测试\\n一篇很长的文章']);
  const wdir = path.join(dir, 'editorial-wechat');
  const body = fs.existsSync(path.join(wdir, 'article-body.html')) ? fs.readFileSync(path.join(wdir, 'article-body.html'), 'utf8') : '';
  check('公众号排版（原文）：逐块一致、0 错误；标题进标题栏不进正文', r.code === 0 && /全文校验：通过/.test(r.out) && /版面检查：0 个错误/.test(r.out) && !body.includes('原文卡片测试：一篇很长的文章') && body.includes('最后一段：结束。'), r.out);
  const wnotes = fs.existsSync(path.join(wdir, 'wechat.md')) ? fs.readFileSync(path.join(wdir, 'wechat.md'), 'utf8') : '';
  check('公众号排版：正文里的视频链接点不开 → 提示，发布步骤列出视频地址', /⚠ 视频：正文有 1 处视频链接/.test(r.out) && wnotes.includes('https://video.twimg.com/amplify_video/1/vid/v.mp4?tag=29'), r.out + wnotes.slice(-300));
  check('公众号排版（原文）：列表写成段落、换行写成 <br>、代码缩进保留', body && !/<ul|<li/.test(body) && /&nbsp;&nbsp;indented\(\);/.test(body) && !/\sclass=|data-source-block/.test(body), body.slice(0, 300));
  // Tamper: a page whose text differs from the ledger must fail the read-back.
  const full = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'layout-full.mjs')).href);
  const led = [{ id: 'b001', text: '第一行\n第二行' }];
  check('公众号比对：换行写成 <br> 时仍逐字比对，改一个字照样失败', full.compareLedger(led, { blocks: [{ id: 'b001', text: '第一行第二行' }], nested: [], stray: 0, backwards: 0 }, { looseBreaks: true }).length === 0
    && full.compareLedger(led, { blocks: [{ id: 'b001', text: '第一行第三行' }], nested: [], stray: 0, backwards: 0 }, { looseBreaks: true }).length > 0);

  // Translation checks.
  const en = ['---', 'title: "Attention Is the Asset"', 'author: "Dan Koe"', 'platform: "X 文章"', 'url: "https://x.com/thedankoe/status/1"', '---', '', '# Attention Is the Asset', '',
    'The most lucrative skill has always been capturing attention. If nobody knows who you are, nobody pays you.', '', '## Why it matters', '', '- Brands spent $13.9B on creators in 2021.', '- That number may reach $43.9B by 2026.', '',
    '```', 'prompt: write 3 hooks', '```', '', 'That is why a one-person creative team can charge $5,000 a month for this work.'].join('\n');
  const zh = ['---', 'title: "注意力就是资产"', 'author: "Dan Koe"', 'platform: "X 文章"', 'url: "https://x.com/thedankoe/status/1"', 'lang: "zh"', 'translated_from: "article.md"', 'source_title: "Attention Is the Asset"', '---', '', '# 注意力就是资产', '',
    '最赚钱的技能一直是抓住注意力。如果没人知道你是谁，就没人会付钱给你。', '', '## 为什么重要', '', '- 2021 年，品牌在创作者身上花了 $13.9B。', '- 到 2026 年，这个数字可能达到 $43.9B。', '',
    '```', 'prompt: write 3 hooks', '```', '', '这就是为什么一人创意团队做这件事每月能收 $5,000。'].join('\n');
  const tdir = path.join(OUT, 'translate');
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, 'article.md'), en);
  fs.writeFileSync(path.join(tdir, 'article.zh.md'), zh);
  const T = wrapper('article-translate', 'translate');
  r = exec(T, ['check', path.join(tdir, 'article.md'), path.join(tdir, 'article.zh.md')]);
  check('翻译检查：结构逐块对应 → 通过', r.code === 0 && /翻译检查：0 个错误，0 个提示/.test(r.out), r.out);
  fs.writeFileSync(path.join(tdir, 'dropped.md'), zh.replace('- 到 2026 年，这个数字可能达到 $43.9B。\n', ''));
  r = exec(T, ['check', path.join(tdir, 'article.md'), path.join(tdir, 'dropped.md')]);
  check('翻译检查：漏一个列表项 → 报错', r.code !== 0 && /块数不一致/.test(r.out), r.out);
  fs.writeFileSync(path.join(tdir, 'lazy.md'), zh.replace('这就是为什么一人创意团队做这件事每月能收 $5,000。', 'That is why a one-person creative team can charge a lot for this work.').replace('prompt: write 3 hooks', 'prompt: 写 3 个开头'));
  r = exec(T, ['check', path.join(tdir, 'article.md'), path.join(tdir, 'lazy.md')]);
  check('翻译检查：代码被翻译 → 报错；有段没翻译、丢了数字 → 提示', r.code !== 0 && /代码块要原样保留/.test(r.out) && /像是没翻译/.test(r.out) && /数字 5000/.test(r.out), r.out);
  r = exec(wrapper('wechat-layout', 'wechat'), [path.join(tdir, 'article.zh.md'), '--theme', 'quiet']);
  const tb = fs.existsSync(path.join(tdir, 'quiet-wechat', 'article-body.html')) ? fs.readFileSync(path.join(tdir, 'quiet-wechat', 'article-body.html'), 'utf8') : '';
  check('外文搬运：译文排公众号，页首注明「中文译文」，逐块一致', r.code === 0 && /全文校验：通过/.test(r.out) && tb.includes('中文译文'), r.out);
}

// ---------- 1e. 视频输入：视频 → 逐字稿文章 ----------
console.log('\n== 视频输入');
{
  const T = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'media', 'transcript.mjs')).href);
  const kinds = [
    ['https://www.youtube.com/watch?v=abc123', 'youtube'], ['https://youtu.be/abc123', 'youtube'],
    ['https://www.bilibili.com/video/BV1NprhBPEtR', 'bilibili'], ['https://b23.tv/xYz12', 'bilibili'], ['BV1NprhBPEtR', 'bilibili'],
    ['https://www.douyin.com/video/7588659303955877139', 'douyin'], ['7588659303955877139', 'douyin'],
    ['7.94 复制打开抖音，看看【房东说漫的作品】剑来第三集 https://v.douyin.com/iAbCdEf/ R@k.Ja 02/18', 'douyin'],
    ['https://x.com/thedankoe/status/2117664712532123680', null], ['https://example.com/post', null],
  ];
  const got = kinds.map(([u]) => T.detectVideoInput(u)?.kind ?? null);
  check('识别视频链接：YouTube / B 站 / 抖音（含短链分享口令），文章链接不误判', got.every((k, i) => k === kinds[i][1]), JSON.stringify(got));
  const files = [['talk.mp4', 'media'], ['podcast.m4a', 'media'], ['talk.srt', 'subtitle'], ['talk.vtt', 'subtitle'], ['notes.md', null]];
  check('识别本地文件：视频 / 音频 / 字幕走逐字稿，Markdown 仍是文章', files.every(([f, k]) => (T.detectVideoInput(f, { isFile: true })?.kind ?? null) === k));
  check('抖音视频 id：/video/、modal_id、短链要先跳转', T.douyinId('https://www.douyin.com/user/self?modal_id=7592994740174458118&showTab=record') === '7592994740174458118'
    && T.douyinId('https://www.iesdouyin.com/share/video/7588659303955877139/?region=CN') === '7588659303955877139' && T.douyinId('https://v.douyin.com/iAbCdEf/') === null);
  const router = { loaderData: { 'video_(id)/page': { videoInfoRes: { item_list: [{ desc: '【剑来第三集】莫向外求 #剑来 #动画', author: { nickname: '房东说漫' }, video: { duration: 866000, play_addr: { url_list: ['https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v03'] } } }] } } } };
  const item = T.douyinItem(`<html><script>window._ROUTER_DATA = ${JSON.stringify(router)}</script></html>`);
  check('抖音分享页：解析出作品信息，无水印地址优先', item.author.nickname === '房东说漫' && T.titleFromDesc(item.desc) === '【剑来第三集】莫向外求'
    && T.playUrlCandidates(item.video.play_addr.url_list[0])[0].includes('/play/?'));
  const vtt = ['WEBVTT', '', '00:00:00.000 --> 00:00:02.000', 'so today we are', '', '00:00:02.000 --> 00:00:02.010', 'so today we are', '',
    '00:00:02.010 --> 00:00:04.000', 'so today we are', 'going to <c>talk</c> about', '', '00:00:04.000 --> 00:00:06.000', 'going to talk about', 'attention'].join('\n');
  const segs = T.parseVtt(vtt);
  check('YouTube 自动字幕：去掉滚动重复和 10 ms 过渡条', segs.map((s) => s.text).join(' | ') === 'so today we are | going to talk about | attention', JSON.stringify(segs));
  const srt = T.parseSrt('1\n00:00:01,000 --> 00:00:03,500\n第一句话\n\n2\n00:00:03,500 --> 00:00:06,000\n第二句话\n');
  check('SRT 解析：时间与文字', srt.length === 2 && srt[1].start === 3.5 && srt[1].text === '第二句话');
  const tracks = [
    T.pickSubtitleTrack({ subtitles: { en: [], 'zh-Hans': [] }, automatic_captions: { 'en-orig': [] } }),
    T.pickSubtitleTrack({ subtitles: {}, automatic_captions: { 'en-orig': [], 'zh-Hans': [], fr: [] } }),
    T.pickSubtitleTrack({ subtitles: { danmaku: [] } }),
  ];
  check('字幕轨：人工字幕优先；自动字幕只要原语言，不要机翻；B 站弹幕不算字幕', tracks[0]?.lang === 'zh-Hans' && !tracks[0].auto && tracks[1]?.lang === 'en-orig' && tracks[1].auto && tracks[2] === null, JSON.stringify(tracks));
  const cleaned = T.cleanSegments([{ start: 0, end: 2, text: '陳平安 對這個世界失望' }, { start: 2, end: 3, text: '軟秀來了,大家好' }, { start: 3, end: 4, text: '字幕由Amara.org社区提供' },
    { start: 4, end: 5, text: '好' }, { start: 5, end: 6, text: '好' }, { start: 6, end: 7, text: '好' }, { start: 7, end: 8, text: '好' }], { terms: T.parseTerms('# 术语\n软秀=>阮秀\n陈平安') });
  check('清理：繁转简、半角标点转全角、术语替换、去掉幻觉句和重复循环', cleaned.map((s) => s.text).join('|') === '陈平安 对这个世界失望|阮秀来了，大家好|好|好', JSON.stringify(cleaned));
  const paras = T.toParagraphs([{ start: 0, end: 3, text: '剑来第三集 五千字解析 来了' }, { start: 3, end: 6, text: '这集我们讲莫向外求 潜心成圣的含义和它背后的典故出处' }, { start: 6, end: 9, text: '先从陈平安的选择说起 这一段很关键 值得反复看几遍' }, { start: 11, end: 13, text: '下面进入第二部分' }]);
  check('分段：中文停顿变逗号、段尾补句号、长停顿另起一段（只补标点，不改字）', paras.length === 2 && paras[0].startsWith('剑来第三集，五千字解析，来了，这集') && paras[0].endsWith('几遍。') && paras[1] === '下面进入第二部分。', JSON.stringify(paras));

  // End to end, offline: a subtitle file becomes article.md + transcript/.
  const FETCH = wrapper('video-transcript', 'transcribe');
  const vdir = path.join(OUT, 'video-input');
  fs.mkdirSync(vdir, { recursive: true });
  const srtFile = path.join(vdir, 'talk-sample.srt');
  fs.writeFileSync(srtFile, '1\n00:00:00,500 --> 00:00:03,000\n最赚钱的技能 一直是抓住注意力\n\n2\n00:00:03,000 --> 00:00:06,000\n没人知道你 再好的东西也卖不出去\n');
  const rs = spawnSync(process.execPath, [FETCH, srtFile, '--out', path.join(vdir, 'srt')], { encoding: 'utf8', timeout: 120000 });
  const art = fs.existsSync(path.join(vdir, 'srt', 'article.md')) ? fs.readFileSync(path.join(vdir, 'srt', 'article.md'), 'utf8') : '';
  check('字幕文件 → 逐字稿文章：front matter 标明来源，正文成段，时间轴另存', rs.status === 0 && /platform: "字幕文件"/.test(art) && /transcript: "字幕文件"/.test(art)
    && /最赚钱的技能，一直是抓住注意力，没人知道你，再好的东西也卖不出去。/.test(art) && fs.existsSync(path.join(vdir, 'srt', 'transcript', 'segments.md')), (rs.stderr || '') + art);

  // End to end with local Whisper, when this machine has it: synthesized speech → transcript.
  const { detectVoice } = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'video', 'voice.mjs')).href);
  const say = spawnSync('say', ['-v', '?'], { encoding: 'utf8' });
  if (detectVoice().whisper && say.status === 0 && /zh_CN/.test(say.stdout)) {
    const aiff = path.join(vdir, 'speech.aiff'), m4a = path.join(vdir, 'speech-sample.m4a');
    spawnSync('say', ['-v', /^Tingting\s/m.test(say.stdout) ? 'Tingting' : say.stdout.match(/^(.+?)\s{2,}zh_CN/m)[1].trim(), '-o', aiff, '注意力是最稀缺的资源。没有人知道你，再好的产品也卖不出去。'], { timeout: 60000 });
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, m4a], { timeout: 60000 });
    const rm = spawnSync(process.execPath, [FETCH, m4a, '--lang', 'zh', '--out', path.join(vdir, 'media')], { encoding: 'utf8', timeout: 600000 });
    const am = fs.existsSync(path.join(vdir, 'media', 'article.md')) ? fs.readFileSync(path.join(vdir, 'media', 'article.md'), 'utf8') : '';
    check('本地音频 → 本地语音识别 → 逐字稿文章', rm.status === 0 && /platform: "本地音频"/.test(am) && /transcript: "本地语音识别"/.test(am) && /注意力/.test(am) && /产品/.test(am), (rm.stderr || '') + am);
  } else console.log('⚠ 跳过本地语音识别端到端检查：本机没有 mlx-whisper 模型或中文系统语音');
}

// ---------- 1f. 批量队列、发布清单、发布记录 (offline: no Chrome, no network) ----------
console.log('\n== 批量 · 发布清单 · 发布记录');
{
  const STATS = wrapper('article2media', 'stats');
  const BATCH = wrapper('article2media', 'batch');
  const root = path.join(OUT, 'loop', 'out');
  const src = path.join(OUT, 'loop', 'src');
  fs.mkdirSync(src, { recursive: true });
  const para = '把选题、改写、出图、发布拆成固定的步骤，每一步只做一件事，流水线才跑得起来。';
  // A work directory as the renderers leave it: article, content.json, one card output with its QA file.
  const fakeDir = (slug, theme, cover = {}) => {
    const dir = path.join(root, slug);
    const o = path.join(dir, `${theme}-3x4`);
    fs.mkdirSync(o, { recursive: true });
    fs.writeFileSync(path.join(dir, 'article.md'), `---\ntitle: "流水线 ${slug}"\nauthor: "测试"\nurl: "https://example.com/${slug}"\n---\n\n# 流水线 ${slug}\n\n${Array(12).fill(para).join('\n\n')}\n`);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ title: `流水线 ${slug}`, url: `https://example.com/${slug}` }));
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ title: '内容\n**流水线**', theme, cover: { title: '流水线', ...cover }, xhs: { title: '一个人的内容流水线', caption: '正文。', tags: ['内容创作'] }, pages: [{ sections: [] }] }));
    for (const n of ['01', '02', '03']) fs.writeFileSync(path.join(o, `card-${n}.png`), PNG);
    fs.writeFileSync(path.join(o, 'qa.json'), JSON.stringify([{ theme, label: '3 张 3:4 卡片', issues: [] }]));
    return dir;
  };
  const dirs = ['a1', 'a2', 'a3', 'a4', 'a5'].map((s) => fakeDir(s, 'brutal', { number: { value: '7', unit: '步', label: '成片' } }));
  const others = ['b1', 'b2'].map((s) => fakeDir(s, 'bento'));

  let r = exec(STATS, ['add', dirs[0], '--platform', '小红书', '--url', 'https://xhs.example/1', '--published', '2026-11-01', '--date', '2026-11-02', '--views', '1000', '--likes', '50', '--saves', '100']);
  let rec = JSON.parse(fs.readFileSync(path.join(dirs[0], 'publish.json'), 'utf8'));
  let p0 = rec.posts[0];
  check('发布记录：第一次 add 新建记录，形式、主题、封面版式、张数、标题都从产物里读出来',
    r.code === 0 && rec.posts.length === 1 && p0.platform === 'xhs' && p0.form === 'cards' && p0.theme === 'brutal' && p0.cover === 'number' && p0.count === 3 && p0.ratio === '3:4'
    && p0.title === '一个人的内容流水线' && p0.snapshots.length === 1 && p0.snapshots[0].saves === 100, r.out + JSON.stringify(p0));
  exec(STATS, ['add', dirs[0], '--platform', 'xhs', '--date', '2026-11-05', '--views', '1.2万', '--likes', '300', '--saves', '600', '--comments', '20', '--shares', '40', '--follows', '9']);
  r = exec(STATS, ['add', dirs[0], '--platform', 'xhs', '--date', '2026-11-05', '--views', '2万']);
  p0 = JSON.parse(fs.readFileSync(path.join(dirs[0], 'publish.json'), 'utf8')).posts[0];
  check('发布记录：再 add 追加快照（不新建记录）；同一天覆盖；1.2万 / 2万 能读', r.code === 0 && p0.snapshots.length === 2 && p0.snapshots[1].views === 20000 && p0.snapshots[1].saves === 600 && p0.url === 'https://xhs.example/1', JSON.stringify(p0));
  r = exec(STATS, ['add', dirs[0], '--platform', 'myspace', '--views', '1']);
  const r2 = exec(STATS, ['add', dirs[0], '--platform', 'xhs', '--views', '很多']);
  check('发布记录：未知平台、不是数字的数据 → 拒绝，不写文件', r.code === 2 && r2.code === 2 && /✗/.test(r.out) && /✗/.test(r2.out), r.out + r2.out);
  r = exec(STATS, ['list', dirs[0]]);
  check('发布记录：list 列出快照、增量和收藏率', r.code === 0 && /xhs-1/.test(r.out) && /2026-11-05/.test(r.out) && /收藏率 3\.0%/.test(r.out), r.out);

  dirs.slice(1).forEach((d, i) => exec(STATS, ['add', d, '--platform', 'xhs', '--published', '2026-11-01', '--date', '2026-11-08', '--views', String(1000 * (i + 1)), '--likes', '10', '--saves', String(100 * (i + 1))]));
  others.forEach((d) => exec(STATS, ['add', d, '--platform', 'xhs', '--published', '2026-11-01', '--date', '2026-11-08', '--views', '500', '--likes', '5', '--saves', '5']));
  exec(STATS, ['add', others[0], '--platform', 'x']); // registered, no numbers yet
  r = exec(STATS, ['report', root, '--json']);
  let rep = null;
  try { rep = JSON.parse(r.out); } catch {}
  const brutal = rep?.by_platform?.xhs?.theme.find((g) => g.value === 'brutal');
  const bento = rep?.by_platform?.xhs?.theme.find((g) => g.value === 'bento');
  check('效果报告：按平台 × 主题 / 封面汇总，取最新快照的中位数和最高值，收藏率 = 收藏 ÷ 阅读；n<5 标样本不足并排在后面；没数据的记录不计入',
    r.code === 0 && rep.posts === 8 && rep.measured === 7 && brutal?.n === 5 && brutal.small === false && brutal.metrics.views.median === 3000 && brutal.metrics.views.best === 20000
    && Math.abs(brutal.rates.save_rate.median - 0.1) < 1e-9 && bento?.n === 2 && bento.small === true && rep.by_platform.xhs.theme[0].value === 'brutal'
    && rep.by_platform.xhs.cover.find((g) => g.value === 'number')?.n === 5 && !rep.by_platform.x, r.out.slice(0, 600));
  const md = fs.existsSync(path.join(root, 'stats-report.md')) ? fs.readFileSync(path.join(root, 'stats-report.md'), 'utf8') : '';
  check('效果报告：写出 stats-report.md，样本不足的行有明确标注，够样本的行没有', /\| bento \| 2 \|.*样本不足（n<5），仅供参考/.test(md) && /\| brutal \| 5 \|[^\n]*\|  \|/.test(md), md.slice(0, 800));

  // Publish checklist: platform limits and publish.titles.
  const setContent = (dir, patch) => { const f = path.join(dir, 'content.json'); fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...patch })); };
  setContent(dirs[1], { publish: { titles: { xhs: ['七步搭好内容流水线', '流水线不是多发，是少想'], x: ['把内容做成流水线的 7 步'] } } });
  r = exec(BATCH, ['checklist', dirs[1]]);
  const kit = fs.existsSync(path.join(dirs[1], 'publish.md')) ? fs.readFileSync(path.join(dirs[1], 'publish.md'), 'utf8') : '';
  check('发布清单：写 publish.md，列出上传顺序、当前标题和备选标题，小红书三项限制都 ✓', r.code === 0 && /发布检查：0 个错误/.test(r.out) && /1\. 一个人的内容流水线（9 \/ 20 字 ✓）〔当前〕/.test(kit) && /2\. 七步搭好内容流水线/.test(kit)
    && /✓ 标题 9 \/ 20/.test(kit) && /✓ 正文 3 \/ 1000/.test(kit) && /✓ 图片 3 \/ 18/.test(kit) && /card-01\.png/.test(kit) && /stats\.mjs/.test(kit), r.out + kit);
  setContent(dirs[1], { xhs: { title: '这个小红书标题故意写得很长很长超过二十个字符', caption: '正'.repeat(1001), tags: [] }, publish: { titles: { xhs: ['这个备选标题同样故意写得很长很长超过二十个字符', '短的'], wechat: 'oops' } } });
  r = exec(BATCH, ['checklist', dirs[1]]);
  check('发布清单：标题 > 20、正文 > 1000、publish.titles 超长或类型不对 → ✗，退出码非零', r.code === 1 && /✗ 小红书：标题 22 \/ 20/.test(r.out) && /正文 1001 \/ 1000/.test(r.out) && /publish\.titles\.xhs\[0\]/.test(r.out) && /publish\.titles\.wechat 必须是非空字符串数组/.test(r.out), r.out);

  // Batch: local files as links, a video link (recorded, not fetched), a link that cannot be fetched, a stub article.
  fs.writeFileSync(path.join(src, 'pipeline.md'), `# Content Pipeline Notes\n\n${Array(20).fill(para).join('\n\n')}\n`);
  fs.writeFileSync(path.join(src, 'stub.md'), '# 预告\n\n完整内容请开通会员后查看。\n');
  fs.writeFileSync(path.join(src, 'links.txt'), '# 本周\npipeline.md\nstub.md\nhttps://www.bilibili.com/video/BV1NprhBPEtR\n');
  const bargs = ['--name', 't1', '--root', root, '--no-proxy'];
  r = exec(BATCH, ['init', path.join(src, 'links.txt'), path.join(src, 'missing.md'), '--spec', 'cards:3:4,long', ...bargs]);
  const queue = () => JSON.parse(fs.readFileSync(path.join(root, 'batches', 't1', 'queue.json'), 'utf8'));
  let qd = fs.existsSync(path.join(root, 'batches', 't1', 'queue.json')) ? queue() : { items: [] };
  const [i1, i2, i3, i4] = qd.items;
  check('批量 init：本地文件抓成工作目录；视频记为待转写而不是失败；抓不到的记下原因；正文偏短 / 疑似付费墙的等确认；有失败时退出码非零',
    r.code === 1 && qd.items.length === 4 && i1.state === 'todo' && i1.slug === 'content-pipeline-notes' && fs.existsSync(path.join(root, i1.slug, 'article.md')) && i1.step.stage === '改写'
    && i2.state === 'confirm' && i2.problems.length === 2 && i3.kind === 'video' && i3.state === 'todo' && /transcribe\.mjs/.test(i3.step.cmd) && i4.state === 'failed' && /抓取失败/.test(i4.problems[0])
    && fs.existsSync(path.join(root, 'batches', 't1', 'queue.md')) && !fs.readdirSync(root).some((f) => f.startsWith('.fetch-')), r.out);
  r = exec(BATCH, ['init', path.join(src, 'links.txt'), ...bargs]);
  check('批量 init：再跑一次不重复抓、不重复排队', r.code === 0 && queue().items.length === 4 && /已抓过，跳过/.test(r.out) && !/→ content-pipeline-notes/.test(r.out), r.out);
  // The model's work, simulated: a rewrite and both outputs appear on disk; one output carries a QA error.
  const d1 = path.join(root, i1.slug);
  fs.copyFileSync(path.join(dirs[0], 'content.json'), path.join(d1, 'content.json'));
  r = exec(BATCH, ['next', 't1', '--root', root]);
  check('批量 next：改写稿有了 → 下一步给出能直接运行的卡片命令；等确认的条目单独列出', /#1 /.test(r.out) && /cards\.mjs" ".*content\.json" --ratio 3:4/.test(r.out) && /2 条等用户确认/.test(r.out), r.out);
  fs.cpSync(path.join(dirs[0], 'brutal-3x4'), path.join(d1, 'brutal-3x4'), { recursive: true });
  fs.mkdirSync(path.join(d1, 'brutal'));
  fs.writeFileSync(path.join(d1, 'brutal', 'page-01.png'), PNG);
  fs.writeFileSync(path.join(d1, 'brutal', 'qa.json'), JSON.stringify([{ theme: 'brutal', issues: [{ level: 'error', where: '图', msg: '文字被截断' }] }]));
  exec(BATCH, ['status', 't1', '--root', root]);
  let it = queue().items[0];
  const stale = it.state === 'todo' && it.stages.rendered['cards:3:4'] === 'done' && it.stages.rendered.long === 'errors' && it.stages.checked === false && /1 个错误/.test(it.step.text);
  fs.writeFileSync(path.join(d1, 'brutal', 'qa.json'), JSON.stringify([{ theme: 'brutal', issues: [] }]));
  exec(BATCH, ['skip', 't1', '2', '3', '4', '--reason', '测试', '--root', root]);
  r = exec(BATCH, ['checklist', 't1', '--root', root]);
  exec(STATS, ['add', d1, '--platform', 'xhs']);
  const r3 = exec(BATCH, ['status', 't1', '--root', root]);
  it = queue().items[0];
  check('批量 status：状态从磁盘重新计算——有错误的产物不算检查通过，修好后变待发布，写了清单、记了发布后变已发布',
    stale && r.code === 0 && fs.existsSync(path.join(d1, 'publish.md')) && it.state === 'published' && it.stages.checked && it.stages.kit && it.stages.published && /已发布 1，已跳过 3/.test(r3.out), r.out + r3.out + JSON.stringify(it.stages));
  // batch.mjs carries a copy of fetch.mjs's slug rule (fetch.mjs is a script, not a module): the two must not drift.
  const fn = (f) => fs.readFileSync(path.join(SKILL, 'scripts', f), 'utf8').match(/function slugify\(meta\) \{[\s\S]*?\n\}/)?.[0];
  check('批量：batch.mjs 的目录命名规则和 fetch.mjs 一致', !!fn('fetch.mjs') && fn('fetch.mjs') === fn('batch.mjs'));
}

// ---------- 1g. Rewrite measured against its article (numbers, voice, pictures) + model-eval scoring ----------
console.log('\n== 改写稿与原文比对');
{
  const S = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'source-check.mjs')).href);
  const art = '# T\n\nShe shipped 2,000+ PRs in December and managed 15 agents, now 200. About 977,930 characters, roughly 420M tokens. 三十五个人。\n\n![a](https://x/1.png)\n\n![b](https://x/2.png)\n';
  const sec = (extra = {}) => ({ heading: 'h', figures: [{ type: 'quote', text: 'x' }, { type: 'quote', text: 'y' }], ...extra });
  const base = { title: '他的团队', source: { author: 'Lingxi Li' }, pages: [{ sections: [sec()] }] };
  const nums = (c) => S.unsourcedNumbers(c, art).map((x) => x.value);
  check('数字来源：原文写过的、四舍五入的、换单位的、英文月份和中文数字都算有出处',
    nums({ ...base, pages: [{ sections: [sec({ paragraphs: ['2,000+ 个 PR，12 月，15 → 200，约 97.8 万字符，4.2 亿 token，35 人，这组 12 张图'] })] }] }).length === 0);
  check('数字来源：原文没有的数字被点名，note 写了"编者换算"的放过',
    JSON.stringify(nums({ ...base, pages: [{ sections: [sec({ paragraphs: ['效率提高 13 倍'], figures: [{ type: 'stats', items: [{ label: 'x', value: '88%' }], note: '编者换算' }, { type: 'quote', text: 'y' }] })] }] })) === '["13"]');
  const voice = (c, brand) => S.sourceChecks(c, art, { brand }).filter((w) => /第一人称/.test(w)).length;
  check('人称：别人的文章标题里写"我"会提示；引号里的原话、voice: self、作者就是品牌本人时不提示',
    voice({ ...base, cover: { title: '我的团队全是 bot' } }) === 1 && voice({ ...base, cover: { title: '他说「我整天都这么做」' } }) === 0 &&
    voice({ ...base, voice: 'self', cover: { title: '我的团队' } }) === 0 && voice({ ...base, cover: { title: '我的团队' } }, { name: 'Lingxi Li' }) === 0);
  check('原文配图：有 2 张以上而一张没用时提示，用了就不提示',
    S.sourceChecks(base, art).some((w) => /原文有 2 张配图/.test(w)) &&
    !S.sourceChecks({ ...base, pages: [{ sections: [sec({ figures: [{ type: 'image', src: 'https://x/1.png' }, { type: 'quote', text: 'y' }] })] }] }, art).some((w) => /配图/.test(w)));
  const { validate } = await import(pathToFileURL(path.join(SKILL, 'scripts', 'lib', 'validate.mjs')).href);
  const six = Array.from({ length: 7 }, (_, i) => sec({ heading: `第 ${i} 节` }));
  const vw = validate({ title: 't', pages: [{ sections: six }] }, { layout: 'card' }).warnings.join('\n');
  check('深度提示：数据面板偏少、整页卡偏少会提示', /数据面板/.test(vw) && /整页卡/.test(vw), vw);
  const mism = validate({ title: 't', pages: [{ sections: [sec({ heading: '每 30 分钟巡检', card: { style: 'number', number: { value: '200+' } } })] }] }, { layout: 'card' }).warnings.join('\n');
  check('大数字卡：标题里的数字和大数字对不上会提示', /标题说的是 30/.test(mism), mism);
  // eval-score runs on a finished work directory and reports a total.
  const wd = path.join(OUT, 'evalscore');
  fs.mkdirSync(wd, { recursive: true });
  fs.writeFileSync(path.join(wd, 'article.md'), art);
  fs.copyFileSync(path.join(EXDIR, 'dan-koe.json'), path.join(wd, 'content.json'));
  run([path.join(wd, 'content.json'), '--ratio', '3:4', '--out', path.join(wd, 'editorial-3x4'), '--page', '1']);
  const es = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'eval-score.mjs'), wd, '--json'], { encoding: 'utf8' });
  let ej = null; try { ej = JSON.parse(es.stdout); } catch {}
  check('eval-score：给出 0–100 的总分和五项分数', !!ej && ej.rows[0].total > 0 && Object.keys(ej.rows[0].parts).length === 5, es.stdout + es.stderr);
}

// ---------- 1f. Offline unit checks (local fonts, image providers) + visual regression ----------
console.log('\n== 单元检查与视觉回归');
{
  let r = exec(path.join(ROOT, 'tests', 'unit.mjs'), []);
  check('本地字体与出图服务：离线单元检查', r.code === 0, r.out);
  r = exec(wrapper('article2media', 'fonts'), ['--list']);
  check('fonts.mjs --list 列出已安装 / 缺少的字体（不下载）', r.code === 0 && /本地字体：\d+ \/ \d+ 组已安装/.test(r.out), r.out);
  // Skips by itself (exit 0, ⚠) without local fonts or baselines; fails only on a real difference.
  r = exec(path.join(ROOT, 'tests', 'visual.mjs'), []);
  check(`视觉回归${/已跳过/.test(r.out) ? `（${r.out.trim().split('\n').pop().replace(/^⚠ 视觉回归/, '').slice(0, 60)}）` : ''}`, r.code === 0, r.out);
}

// Every example × (phone long, wide long, 4 card ratios, 公众号总结 = export → rewrite.md → wechat-layout) × theme(s).
console.log('\n== 渲染矩阵');
const layouts = [[], ['--wide'], ['--ratio', '3:4'], ['--ratio', '4:5'], ['--ratio', '1:1'], ['--ratio', '9:16'], ['wechat']];
const themeArg = onlyThemes || (quick ? 'editorial' : 'all');
const rows = [];
for (const ex of EXAMPLES) {
  for (const lay of layouts) {
    const isWx = lay[0] === 'wechat';
    const isWide = lay[0] === '--wide';
    const name = `${path.basename(ex, '.json')} · ${isWx ? 'wechat' : isWide ? 'long-wide' : lay.length ? lay[1] : 'long'}`;
    const sub = isWx ? 'wechat' : isWide ? 'long-wide' : lay[1]?.replace(':', 'x') || 'long';
    const t0 = Date.now();
    let r;
    if (isWx) {
      // The exported figures carry one theme; the 公众号 pass then restyles the text with every theme under test.
      const wd = path.join(OUT, 'm', path.basename(ex, '.json'), 'wechat');
      fs.mkdirSync(wd, { recursive: true });
      fs.copyFileSync(ex, path.join(wd, 'content.json'));
      const e = exec(wrapper('article-rewrite', 'export'), [path.join(wd, 'content.json'), '--theme', themeArg === 'all' ? 'editorial' : themeArg.split(',')[0]]);
      r = e.code === 0 ? exec(wrapper('wechat-layout', 'wechat'), [path.join(wd, 'rewrite.md'), '--theme', themeArg]) : e;
    } else r = run([ex, ...lay, '--theme', themeArg, '--out', path.join(OUT, 'm', path.basename(ex, '.json'), sub)]);
    const m = r.out.match(/版面检查：(\d+) 个错误，(\d+) 个提示/);
    const errs = m ? Number(m[1]) : -1;
    const warns = m ? Number(m[2]) : -1;
    const ok = r.code === 0 && errs === 0 && (!isWx || !/全文校验：未通过/.test(r.out));
    rows.push({ name, ok, errs, warns, secs: Math.round((Date.now() - t0) / 1000), warnLines: r.out.split('\n').filter((l) => /^\s+⚠/.test(l)) });
    check(`${name}（${themeArg === 'all' ? '全部主题' : themeArg}）：${errs} 错误，${warns} 提示，${rows.at(-1).secs}s`, ok, r.out);
  }
}

const totalWarn = rows.reduce((a, r) => a + Math.max(0, r.warns), 0);
if (totalWarn) {
  console.log(`\n== 提示汇总（${totalWarn} 条，不算失败）`);
  for (const r of rows) for (const w of r.warnLines) console.log(`  [${r.name}] ${w.trim()}`);
}
console.log(`\n输出目录：${OUT}`);
console.log(failed ? `\n✗ 失败 ${failed} 项` : '\n✓ 全部通过');
process.exit(failed ? 1 : 0);
