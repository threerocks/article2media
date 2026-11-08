---
name: article2media
description: 把任意文章或视频改写成中文视觉内容。文章：X/Twitter 长文、帖子与线程，网页，微信公众号，本地 Markdown/文本；视频：抖音、YouTube、B 站链接，本地视频/音频，.srt/.vtt 字幕，先转成逐字稿文章（平台字幕优先，没有字幕时本地 Whisper 识别）。产出：默认是杂志风格的多页长图（每节配图表和数据面板，附执行清单）；指定比例或平台（小红书 3:4、Instagram 4:5、方图 1:1、竖屏 9:16）时输出固定比例卡片组（封面 + 每节一卡 + 要点总结，附发帖文案）；说"公众号"时输出可直接粘贴进公众号编辑器的图文排版（含头图）；说"做成视频/口播/视频号"时输出 1080×1920 竖屏讲解视频（配音、逐字同步的动画、字幕、封面）；另有三种模式：-f 原文一字不改的全文排版（逐块校验）、-w 白板论证（把推理过程摊成一条纵向主干）、-c 黑白漫画（生成分镜 + HTML 对白，附 3:4 卡片）。21 种视觉风格（杂志、极简、深色科技、国潮、新中式、备忘录、像素、Y2K、电影感等），不指定时按内容自动选择；可选 AI 插画（封面和配图，按主题画风生成）。Use when the user wants to turn an article, URL or long post into summary images, infographic pages, 总结图, 长图, 知识卡片, 小红书图文/轮播卡片, 公众号排版, 口播视频/短视频, 原文排版/全文卡片, 白板/论证图, 漫画, or gives a video link (抖音 / B 站 / YouTube) or a video/audio file to turn into 图文 or a transcript (视频转图文、视频转文字、逐字稿), or says "把这篇文章做成图/视频" / "把这个视频做成小红书".
argument-hint: <url|视频链接|文件|粘贴的正文> [-l 长图|-f 全文|-w 白板|-c 漫画] [--ratio 3:4|4:5|1:1|9:16 或 小红书/IG] [公众号] [视频] [--style 主题名|all] [--illustrate] [--pages N] [--lang zh|en] [--verify]
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)
version: "1.6.0"
---

# article2media：文章 → 图文与口播视频

把一篇文章**重组**成 1–4 张杂志风格的长图（默认），或一组固定比例的卡片。原文也可以是一条视频：先转成逐字稿文章，后面的流程完全一样。分工如下：
- **你（Claude）**：读懂文章、规划结构、改写、选图、核对数字，产出 `content.json`。
- **脚本**：抓取、校验、排版、截图、版面检查。

内容和风格完全分离：`content.json` 只写内容；换风格只需要用另一个主题重新渲染，不用重写。

参数：`$ARGUMENTS`

## 参数与默认值

| 参数 | 默认 | 说明 |
|---|---|---|
| 第一个参数 | 必填 | 文章或视频的 URL（抖音分享口令也行）、本地文件路径（文章、视频、音频、.srt/.vtt 字幕），或用户直接粘贴的正文 |
| 模式 | `-l` | `-l` 杂志长图（默认）、`-f` 原文全文排版、`-w` 白板论证、`-c` 漫画；见下方「其他模式」 |
| `--ratio` | 不传 = 长图 | 传了才出固定比例卡片：`3:4`、`4:5`、`1:1`、`9:16`。也可以直接写平台名，见下方对照表 |
| `--style` | 不传 = 由你按内容选 | 主题名，多个用逗号分隔，或 `all`。可用主题见 `node ${CLAUDE_SKILL_DIR}/scripts/render.mjs --list` |
| `--pages` | 自动 | 强制页数（1–4） |
| `--lang` | `zh` | 输出语言，`zh` 或 `en` |
| `--verify` | 关 | 联网核对文中的关键数字，并在面板里注明核对结果 |
| `--illustrate` | 关 | 加 AI 插画：封面插画 + 1–3 张配图，按主题画风生成（需要出图能力：Codex CLI 登录，或 OpenAI / Gemini 付费 key；见第 5b 步） |

用户用自然语言说的偏好（"做成深色的""两页就够""发小红书用"）同样有效。

**版式怎么定：** 用户没提比例、也没提平台，就出**长图**。只有提到以下词，才出固定比例卡片：

| 用户说了 | 用 |
|---|---|
| 小红书、RED、xhs、抖音图文、3:4 | `--ratio 3:4`（1080×1440，最多 18 张） |
| Instagram、IG、ins、4:5 | `--ratio 4:5`（1080×1350） |
| 方图、正方形、朋友圈、1:1 | `--ratio 1:1`（1080×1080） |
| 竖屏、Stories、快拍、9:16 | `--ratio 9:16`（1080×1920） |
| 公众号、微信文章、gzh、推文排版 | `--layout wechat`（可粘贴的图文 + 头图，见 `references/wechat-guide.md`） |
| 做成视频、口播、短视频、视频号 | `scripts/video.mjs`（竖屏讲解视频，见下方「口播视频」和 `references/video-guide.md`） |
| `-f`、原文排版、全文卡片、一字不改、原文长图 | `--layout full`（见 `references/mode-full.md`） |
| `-w`、白板、论证图、推理过程、思路图 | `--layout whiteboard`（见 `references/mode-whiteboard.md`） |
| `-c`、漫画、连环画、四格、分镜 | `scripts/comic.mjs`（见 `references/mode-comic.md`；需要出图能力） |
| "长图和小红书都要" | 两种都渲染，内容只写一份 |

**输入和输出分开判断：** 给的是视频链接或视频文件，只说明**原文**是视频（先转逐字稿）；产出仍按上表定，没提就出长图。「把这个抖音视频做成小红书」是视频进、卡片出；「把这篇文章做成抖音视频」是文章进、口播视频出。

**主题怎么定：** 用户指定了就用指定的。没指定时，**由你根据内容来选**：读 `references/styles.md` 的选择指南，挑一个最合适的主题，写进 content.json 的 `"theme"` 字段（render 不传 `--theme` 时会用它），交付时用一句话说明为什么选它。

如果同一篇文章已经有 `content.json`（比如之前出过长图），换版式时**不要重写**：只补上该版式需要的字段，然后重新渲染。

## 工作流程

### 1. 环境检查（本会话第一次使用时）
```bash
node ${CLAUDE_SKILL_DIR}/scripts/doctor.mjs
```
需要 Node 22+ 和任意 Chrome/Chromium。失败时，把输出里的修复建议转告用户，然后停下。

### 2. 抓取原文
```bash
node ${CLAUDE_SKILL_DIR}/scripts/fetch.mjs "<url 或文件>"            # 默认输出到 ./article2media-out/<slug>/
node ${CLAUDE_SKILL_DIR}/scripts/fetch.mjs "<url>" --out <目录>      # 指定目录
```
- X / Twitter：通过 FxTwitter 公开 API 获取，长文、帖子、线程都支持，不需要登录。
- 普通网页：依次尝试 r.jina.ai、defuddle.md，最后用本地 Chrome 提取。加 `--no-proxy` 可以不经过第三方服务。
- 微信公众号：直接用本地 Chrome 提取。
- 用户直接粘贴正文时：不用抓取，自己在 `./article2media-out/<简短英文 slug>/article.md` 写入正文（开头加 front matter：title、author、platform、date）。
- **视频**（抖音、YouTube、B 站链接，本地视频 / 音频，.srt / .vtt 字幕）：同一条命令，自动转成**逐字稿文章** `article.md`，时间轴在 `transcript/segments.md`。
  - **文字来源**：人工字幕优先，其次平台的原语言自动字幕（不用机器翻译的字幕轨），都没有时用本地 Whisper 识别。
  - **识别不准的专有名词**：先用 `--prompt "人名 术语"` 提示，再用 `--terms 词表.txt`（每行 `错词=>正词`）替换。
  - **平台要求浏览器 cookie 时**（YouTube 的机器人校验、抖音）：先问用户能不能复用本机浏览器状态，同意后才加 `--cookies-from-browser chrome`；不同意就请用户把视频保存到本地，直接传文件，本地文件可用 `--title`、`--author` 补上标题和作者。

  细节见 `references/video-input.md`。

然后**完整读一遍** `article.md`。抓取失败或正文明显不全（比如只有一段摘要）时，告诉用户，并请对方粘贴正文。

逐字稿是**口语**：重组时去掉口头禅和重复，事实、数字、人名以视频为准；识别可能出错的人名、术语，对照 `transcript/segments.md` 的上下文判断，拿不准的在交付时说明。来源写成「内容整理自 <作者> 的<平台>视频《标题》」。

### 3. 规划
读 `references/writing-guide.md`，然后确定：
- 核心主张（一句话）；
- 页数和每页的 `part`，按 `content-schema.md` 末尾的密度表来定；
- 每节的标题、两张图的类型、面板类型；
- 主题：用户没指定时，按 `references/styles.md` 的选择指南选一个。

不需要先把大纲给用户确认，除非用户要求先看大纲。

### 4. 核对数字（只在 `--verify` 时）
- 对文中 3–8 个关键数字或事实，用 WebSearch / WebFetch 查原始出处。
- 在对应面板里写明结论，例如"与 IAB 一致；2026 年为预测值""未找到出处"，面板标题写"· 编者核对"。
- 没开 `--verify` 时，任何地方都不能出现"核对"字样。

### 5. 写 content.json
写之前**必须**读 `references/content-schema.md` 和 `references/figures.md`。写到抓取目录下的 `content.json`，然后校验：
```bash
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs <目录>/content.json --check                # 长图
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs <目录>/content.json --ratio 3:4 --check    # 卡片
```
要出卡片时，还要读 `references/xhs-guide.md`，并写上 `cover`、`xhs` 两个字段；需要时再给个别节加 `card` 提示。
要出公众号时，读 `references/wechat-guide.md`，写上 `wechat.title`、`wechat.digest`。
有 ✗ 错误必须修完；⚠ 长度提示尽量处理（缩短文字）。

### 5b. AI 插画（只在用户要插画、或传了 `--illustrate` 时）
1. 按 `figures.md` 的 illustration 一节写：`cover.illustration.prompt`（封面），再挑 1–2 个故事性强、缺数据的节，把其中一张图换成 `{"type": "illustration", "prompt": "…"}`。
2. 生成：
   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/illustrate.mjs <目录>/content.json
   ```
   脚本按 content.json 的主题选画风；之后换主题要画风一致，就加 `--theme 新主题` 再生成一次。
3. 生成失败（没有出图能力、免费层没有图像额度等）时，把报错原话告诉用户，然后**去掉插画字段**照常出图。不要交付带"插画待生成"占位框的图。
4. 打开生成的图看一眼：有没有画出文字、主体是否清楚、和主题搭不搭。不满意就改 prompt，加 `--force` 重新生成。

### 6. 渲染
```bash
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs <目录>/content.json                    # 长图，主题取 content.json 的 theme
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs <目录>/content.json --ratio 3:4        # 卡片
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs <目录>/content.json --theme midnight   # 用户指定主题时
node ${CLAUDE_SKILL_DIR}/scripts/render.mjs <目录>/content.json --layout wechat    # 公众号
```
- 长图输出 `<目录>/<主题>/page-01.png …`，以及同名的 `.html` 和 `qa.json`。一页大约 4 秒。
- 卡片输出 `<目录>/<主题>-<比例>/card-01.png …`（比如 `notebook-3x4/`），以及 `overview.jpg`（所有卡片的总览）、`caption.md`（发帖文案）和 `cards.html`。一组大约 5 秒。
- 公众号输出 `<目录>/<主题>-wechat/article.html`（预览 + 一键复制）、`images/`、`cover-2.35x1.png`、`cover-1x1.png`、`wechat.md`。

### 7. 检查与修正（最多 2 轮）
1. **版面检查结果**：render 末尾会列出问题。
   - ✗（图内溢出、文字截断、元素重叠、图片加载失败）：必须修。办法是缩短图内文字、减少项目，或者换一种图。
   - ⚠「末行只剩一个字」：给那句话增减两三个字。
   - ⚠「页面过高」：删减内容，或者拆成两页。
2. **亲眼看图**：用 Read 打开每张 PNG，检查：图能不能一眼看懂、图和图注说的是不是一回事、有没有哪节明显太空或太挤。小红书卡片先看 `overview.jpg`，有问题再打开单张卡。公众号看两张封面和 `images/` 里的图。
   - 卡片报「内容超出」「已自动省略」或「图只放大到 x 倍」：按 xhs-guide.md 第 2 节的顺序处理。
3. 只改 `content.json`，然后重新渲染。不要手改 HTML。

### 8. 交付
告诉用户：
- 每张图的绝对路径；
- 一行大纲（每页的 part）；
- 有哪些地方需要用户留意，例如未核对的数字、抓取不全的段落；
- 用了哪个主题；如果是你选的，用一句话说明理由；
- 怎么换风格：`--theme 名称`、`--theme all` 都不需要重写内容；怎么换版式：`--ratio 3:4` 等。
- 卡片：把 `caption.md` 里的标题、正文和标签直接贴在回复里，方便用户复制。
- 公众号：给出 `article.html` 路径，告诉用户"浏览器打开 → 点复制到公众号 → 在编辑器正文里粘贴"，并贴出标题、摘要和两张封面的路径。
- 用了 AI 插画：说明用的服务商和模型、生成了几张。

## 口播视频（用户要视频时）

先按第 2–3 步抓取、读懂原文（已有 `content.json` 就直接用它的事实和结构），然后：
1. `node ${CLAUDE_SKILL_DIR}/scripts/video.mjs doctor` 看本机能力，按 `references/video-guide.md` 第 1 节决定要不要问用户（通常不用问）。
2. 读 `references/video-guide.md`，当导演写 `<目录>/video/video.json`：定调（受众、核心、开场策略）→ 封面 → 每镜口播和画面 → 选音色。首句 ≤ 19 字、5 秒内说完；解说最忌急，说不完就删字，不加快语速。
3. `video.mjs check` 修完提示，再 `video.mjs make`（配音、可选插画、渲染、混音、审片一步完成；配音按句缓存，改口播只重配改动的句子）。
4. 按指南第 4 节审片：看 `contact-sheet.jpg` 和检查项，改 `video.json` 重渲，最多 2 轮。
5. 按指南第 5 节交付：视频、封面、镜头大纲、音色（公开 / 本机个人）、缺了哪些能力、发布前的 AI 声明提醒。克隆自他人或平台的音色只能进本机个人音色库，不能放进 skill 的公开音色目录。

## 其他模式（-f / -w / -c）

三种模式都先按第 2 步抓取原文；它们不经过 content.json。

- **-f 原文全文排版**：不改写，直接 `render.mjs <目录>/article.md --layout full`。全文校验未通过（改字、调序、漏块、重复）就是错误，按提示修，不能靠目测放行。读 `references/mode-full.md`。
- **-w 白板论证**：先 `render.mjs <目录>/article.md --layout whiteboard` 生成来源清单，再读 `references/mode-whiteboard.md` 写 `whiteboard.json`（论证账本：每段原文必须进入某一步或写明省略理由），`--check` 通过后渲染。
- **-c 漫画**：先确认有出图能力（`video.mjs doctor` 的"插画"一行）；没有就告诉用户并建议长图或白板。读 `references/mode-comic.md` 写 `comic.json`（认知因果拍点 + 固定角色），`comic.mjs make`。

讲概念、机制的内容（不论哪种模式），按 `references/writing-guide.md` 第 6 节把具体情形、判别依据、关系和结果接起来。

审片：三种模式都会在 `review/` 里输出覆盖全部高度的重叠切片，逐张看完再交付。

交付时报告：PNG 路径与像素尺寸、来源、模式、生成图张数，以及该模式的校验结果（-f：原文块数与逐字校验；-w：步骤数、可见转折数、来源段落的去向；-c：格数与因果链）。制作范围、未补齐的材料、是否核对过，写在交付回复里，不写进图里。

## 品牌信息

页脚右侧的品牌名、@handle，以及页眉栏目名，按以下顺序读取（越靠前优先级越高）：
1. `content.json` 里的 `brand` 字段；
2. `--brand <文件>` 参数；
3. 与 content.json 同目录的 `brand.json`；
4. 当前目录的 `article2media.brand.json`；
5. `~/.config/article2media/brand.json`。

格式：`{"name": "Founder Notes", "handle": "@you", "series": "实战手册", "editor": "编者"}`，所有字段都可选。`editor` 是面板标题里"编者归纳"中"编者"的署名。用户第一次使用、又提到想要自己的品牌时，帮他创建第 5 个文件。

## 参考文件（按需读取）

| 文件 | 什么时候读 |
|---|---|
| `references/writing-guide.md` | 第 3 步，每次都要读 |
| `references/content-schema.md` | 第 5 步，每次都要读 |
| `references/figures.md` | 第 5 步，每次都要读 |
| `references/styles.md` | 第 3 步需要选主题时（每次没指定主题都要读）；用户想要新风格时 |
| `references/xhs-guide.md` | 出卡片时（任何比例）：封面、卡片提示、发帖文案的写法 |
| `references/wechat-guide.md` | 出公众号图文时：输出文件、标题摘要写法、粘贴原理 |
| `references/video-guide.md` | 做口播视频时：能力检查与交互、导演流程（黄金 5 秒、结构、口播写法）、镜头类型、审片与交付 |
| `references/mode-full.md` | `-f` 原文全文排版：允许与禁止、逐块校验、阅读面规格 |
| `references/mode-whiteboard.md` | `-w` 白板：来源清单、论证账本格式、静默与可见转折的规则 |
| `references/mode-comic.md` | `-c` 漫画：认知因果拍点、comic.json、画面纪律 |
| `examples/gallery.json` | 想看每种图表、面板的完整写法时 |
| `examples/dan-koe.json` | 想看一篇 3,700 词长文的完整示例时（3 页 11 节） |
