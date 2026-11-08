#!/usr/bin/env node
// End-to-end self test for the article2media skill.
//
//   node tests/run-all.mjs            # CLI behaviour + 公众号/插画 checks + full matrix (every example × layout × theme)
//   node tests/run-all.mjs --quick    # CLI behaviour + one theme per layout
//
// Pass = every CLI check behaves as expected and every render reports 0 layout errors.
// Warnings (e.g. auto-dropped captions on 1:1 cards) are counted and listed, not failed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, 'skills', 'article2media');
const RENDER = path.join(SKILL, 'scripts', 'render.mjs');
const EXAMPLES = fs.readdirSync(path.join(SKILL, 'examples')).filter((f) => f.endsWith('.json')).map((f) => path.join(SKILL, 'examples', f));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'a2i-test-'));
const quick = process.argv.includes('--quick');
const onlyThemes = process.argv.includes('--themes') ? process.argv[process.argv.indexOf('--themes') + 1] : null;

const run = (args) => {
  const r = spawnSync(process.execPath, [RENDER, ...args], { encoding: 'utf8', timeout: 600000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    ${detail.split('\n').slice(-6).join('\n    ')}`}`);
  if (!ok) failed++;
};

// ---------- 1. CLI behaviour ----------
console.log('== CLI');
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
  check('--layout wechat → 公众号图文', r.code === 0 && /版式：公众号图文/.test(r.out), r.out);
  r = run([gallery, '--layout', 'wechat', '--ratio', '3:4', '--check']);
  check('公众号 + 比例 → 报错退出', r.code !== 0, r.out);
  r = run(['--list']);
  const n = (r.out.match(/^\w[\w-]*\s+/gm) || []).length;
  check(`--list 列出全部主题（${n} 个）`, r.code === 0 && n >= 21, r.out);
}

// ---------- 1b. 公众号 output + AI illustrations (offline mock provider) ----------
console.log('\n== 公众号 + AI 插画');
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
  const ILL = path.join(SKILL, 'scripts', 'illustrate.mjs');
  const g = spawnSync(process.execPath, [ILL, f, '--provider', 'mock'], { encoding: 'utf8' });
  const files = fs.existsSync(path.join(dir, 'illustrations')) ? fs.readdirSync(path.join(dir, 'illustrations')).filter((x) => x.endsWith('.svg')) : [];
  check(`illustrate.mjs --provider mock 生成 2 张（实际 ${files.length}）`, g.status === 0 && files.length === 2, (g.stdout || '') + (g.stderr || ''));
  for (const lay of [[], ['--ratio', '3:4'], ['--layout', 'wechat']]) {
    r = run([f, ...lay, '--out', path.join(dir, lay[1] || 'long')]);
    const m = r.out.match(/版面检查：(\d+) 个错误/);
    check(`有插画 · ${lay[1] || 'long'}：0 错误、无占位`, r.code === 0 && m && m[1] === '0' && !/插画还没生成/.test(r.out), r.out);
  }
  r = run([f, '--theme', 'brutal', '--out', path.join(dir, 'brutal'), '--page', '1']);
  check('别的主题没有专属插画 → 借用并提示', r.code === 0 && /借用了 dopamine 主题的插画/.test(r.out), r.out);
  const body = fs.readFileSync(path.join(dir, 'wechat', 'article-body.html'), 'utf8');
  const imgs = (body.match(/<img [^>]*src="data:image\/png;base64,/g) || []).length;
  check(`公众号正文只有内联样式，图片内嵌（${imgs} 张）`, !/\sclass=|<style|<script/.test(body) && imgs >= 3, body.slice(0, 300));
  check('公众号封面：头图 + 1:1', ['cover-2.35x1.png', 'cover-1x1.png'].every((x) => fs.existsSync(path.join(dir, 'wechat', x))));
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

// ---------- 2. Render matrix ----------
console.log('\n== 渲染矩阵');
const layouts = [[], ['--ratio', '3:4'], ['--ratio', '4:5'], ['--ratio', '1:1'], ['--ratio', '9:16'], ['--layout', 'wechat']];
const themeArg = onlyThemes || (quick ? 'editorial' : 'all');
const rows = [];
for (const ex of EXAMPLES) {
  for (const lay of layouts) {
    const name = `${path.basename(ex, '.json')} · ${lay.length ? lay[1] : 'long'}`;
    const sub = lay[1]?.replace(':', 'x') || 'long';
    const t0 = Date.now();
    const r = run([ex, ...lay, '--theme', themeArg, '--out', path.join(OUT, 'm', path.basename(ex, '.json'), sub)]);
    const m = r.out.match(/版面检查：(\d+) 个错误，(\d+) 个提示/);
    const errs = m ? Number(m[1]) : -1;
    const warns = m ? Number(m[2]) : -1;
    const ok = r.code === 0 && errs === 0;
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
