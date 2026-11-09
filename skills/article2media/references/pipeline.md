# 能力怎么拼起来（所有 skill 共用）

article2media 由 10 个能力组成，每个都是独立的 skill，装在同一个 skills 目录里，共用 `article2media/engine/`（脚本、主题、版式）。能力之间不互相调用代码，**只通过同一个工作目录里的文件交接**。

## 1. 工作目录与交接文件

一篇原文一个目录，默认 `./article2media-out/<slug>/`：

```
article2media-out/<slug>/
├── article.md            原文：article-fetch 抓的、video-transcript 转的逐字稿、或用户粘贴后你写的
├── meta.json             抓取信息
├── transcript/           视频才有：时间轴 segments.md
├── article.zh.md         译文（article-translate）：结构与原文逐块对应
├── content.json          改写稿（article-rewrite）：结构化，给长图、卡片
├── rewrite.md            改写稿的文章形态（article-rewrite 导出），图表在 rewrite-assets/
├── illustrations/        AI 插画缓存
└── <主题>/  <主题>-3x4/  full/  full-3x4/  <主题>-wechat/  video/  whiteboard/  comic/   各产物
```

| 文件 | 谁产出 | 谁使用 |
|---|---|---|
| `article.md`（及 `article.zh.md`、`rewrite.md`） | 抓取、视频转文字、翻译、改写导出 | 改写、长图（原文）、卡片（原文）、公众号排版、口播视频、白板、漫画 |
| `content.json` | 改写 | 长图（杂志）、卡片（总结）、口播视频（参考事实和结构） |

文章文件开头都有 front matter（`title`、`author`、`platform`、`date`、`url`…）。用户直接粘贴正文时，你自己写 `article.md`：front matter 加 `title`、`author`、`platform`、`date`，正文第一行 `# 标题`。

## 2. 原文还是改写：默认怎么判

无论从哪个 skill 进来，都按这张表判断，结果一致：

| 用户说了 | 走 |
|---|---|
| 排版、原文、全文、一字不改、原样、`-f` | **原文**：直接把文章交给呈现能力 |
| 总结、提炼、改写、重点、干货、整理成… | **改写**：先 article-rewrite，再呈现 |
| 翻译、译成中文、搬运外文 | **翻译**：先 article-translate（全文，不删减），再按原文路径呈现 |
| 都没说，要长图或卡片 | **改写**（和以前一样） |
| 都没说，要公众号 | **原文排版** |
| 走原文路径，但原文语言和要的输出语言不同（例如英文原文、中文读者） | **先翻译**，再原文排版 |
| 口播视频、白板、漫画 | 这三个能力自己写脚本（视频.json / 白板账本 / 分镜），不走上面的判断 |

拿不准且两种结果差别很大时（例如一篇别人的长文说"发公众号"），问一句"原文排版还是总结后再排"；其余情况按表直接做，不用确认。

## 3. 调用别的能力

用到其他能力时：
- 能用 Skill 工具就直接调用它。插件安装时名字带前缀，例如 `article2media:article-rewrite`；单独安装时就是 `article-rewrite`。
- 不能时，读 `<skills 目录>/<名字>/SKILL.md`（与当前 skill 同级的目录）并照做；那份文档里的 `${CLAUDE_SKILL_DIR}` 指那个 skill 自己的目录。

| 名字 | 能力 |
|---|---|
| `article-fetch` | 文章抓取 |
| `video-transcript` | 视频转文字 |
| `article-rewrite` | 改写（总结） |
| `article-translate` | 全文翻译 |
| `long-image` | 长图 |
| `image-cards` | 卡片 |
| `wechat-layout` | 公众号排版 |
| `explainer-video` | 口播视频 |
| `logic-whiteboard` | 白板论证 |
| `article-comic` | 漫画 |

已经有的交接文件不要重做：目录里已有 `article.md` 就不重新抓；已有 `content.json` 换版式时只补该版式需要的字段，不重写。

## 4. 主题与品牌

- **主题**：用户指定了就用指定的；没指定时按 `styles.md`（与本文同目录）的选择指南挑一个，交付时一句话说明理由。改写稿把主题写进 `content.json` 的 `theme`；文章（`rewrite.md`）的 front matter 也可以带 `theme`。原文长图、原文卡片不传主题时用白底阅读面。
- **品牌**：页脚的品牌名、@handle、栏目名依次读 `content.json` 的 `brand` → `--brand <文件>` → 与输入同目录的 `brand.json` → 当前目录的 `article2media.brand.json` → `~/.config/article2media/brand.json`。格式：`{"name": "Founder Notes", "handle": "@you", "series": "实战手册", "editor": "编者"}`，字段都可选。用户第一次提到想要自己的品牌时，帮他创建最后一个文件。

## 5. 通用约定

- 第一次使用时运行一次环境检查（各 skill 的 `doctor.mjs`）：需要 Node 22+ 和任意 Chrome / Chromium。失败就把修复建议转告用户，然后停下。
- 脚本输出 `✓ / ⚠ / ✗`，最后一行是「版面检查：N 个错误，M 个提示」（翻译是「翻译检查」）。✗ 必须修完；有 ✗ 时退出码非零。
- 图里不写制作说明、免责声明和检查结果（来源署名除外），这些写在交付回复里。
- 交付时给出每个产物的绝对路径。
