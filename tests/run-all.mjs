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
  check('不指定比例 → 长图', r.code === 0 && /版式：长图/.test(r.out), r.out);
  r = run([f, '--out', path.join(OUT, 'd1'), '--page', '1']);
  check('不指定主题且 content 无 theme → editorial（默认）', r.code === 0 && /主题：editorial（默认）/.test(r.out) && fs.existsSync(path.join(OUT, 'd1', 'page-01.png')), r.out);
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
  const hasSay = process.platform === 'darwin';
  if (!hasSay) console.log('（非 macOS：跳过口播视频渲染）');
  else {
    const f = path.join(dir, 'video.json');
    fs.writeFileSync(f, JSON.stringify({
      theme: 'dopamine', voice: { backend: 'say' },
      cover: { kicker: '测试', title: '三个月\n涨到 **1 万**' },
      scenes: [
        { id: 'a', type: 'number', lines: ['只用 3 个月，粉丝从 0 涨到 1 万。'], label: '粉丝数', from: 0, to: 10000, count_cue: '1 万' },
        { id: 'b', type: 'checklist', lines: ['记住两件事：先定位，再坚持。'], title: '两件事', items: [{ text: '先定位', cue: '先定位' }, { text: '再坚持', cue: '再坚持' }] },
      ],
    }));
    r = vrun(['make', f, '--no-images']);
    const od = path.join(dir, 'dopamine');
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
    steps: [{ id: 'step-01', role: 'question', source_refs: [inv.sections[1].id], claim: '问题', support: '支持' }, { id: 'step-02', role: 'conclusion', source_refs: [inv.sections[2].id], claim: '结论', structure: { type: 'chain', items: ['甲', '乙'] } }],
    relations: [{ id: 'rel-01', from: 'step-01', to: 'step-02', kind: 'contrast', visibility: 'visible', bridge: '可是测试并不止于此。' }] };
  const wbOk = path.join(dir, 'whiteboard.json'), wbBad = path.join(dir, 'whiteboard-bad.json');
  fs.writeFileSync(wbOk, JSON.stringify(wb));
  fs.writeFileSync(wbBad, JSON.stringify({ ...wb, source_sections: wb.source_sections.slice(1) }));
  r = run([wbBad, '--layout', 'whiteboard', '--check']);
  check('-w 账本：漏处置的原文段落 → 报错', r.code !== 0 && /没有处置/.test(r.out), r.out);
  r = run([wbOk, '--layout', 'whiteboard']);
  check('-w 渲染：0 错误', r.code === 0 && fs.existsSync(path.join(dir, 'whiteboard', 'whiteboard.png')), r.out);

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
    '1. 有序一', '2. 有序二', '', '| 列 A | 列 B |', '| --- | --- |', '| 甲 | 乙 |', '| 丙 | 丁 |', '', '```', 'const x = 1;', '  indented();', '```', '', '---', '', para(4), '', '### 小节', '', para(5), '', para(6), '', '最后一段：结束。'].join('\n');
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

// ---------- 2. Render matrix ----------
// Every example × (long, 4 card ratios, 公众号总结 = export → rewrite.md → wechat-layout) × theme(s).
console.log('\n== 渲染矩阵');
const layouts = [[], ['--ratio', '3:4'], ['--ratio', '4:5'], ['--ratio', '1:1'], ['--ratio', '9:16'], ['wechat']];
const themeArg = onlyThemes || (quick ? 'editorial' : 'all');
const rows = [];
for (const ex of EXAMPLES) {
  for (const lay of layouts) {
    const isWx = lay[0] === 'wechat';
    const name = `${path.basename(ex, '.json')} · ${isWx ? 'wechat' : lay.length ? lay[1] : 'long'}`;
    const sub = isWx ? 'wechat' : lay[1]?.replace(':', 'x') || 'long';
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
