# 图表组件目录

每节右栏两张图，画布很小（约 280 × 200 像素），所以：**图里只放关键词，句子留给 caption 和正文**。
图内文字：方框里 ≤ 10 字，标签 ≤ 6 字，`header` / `footer` / 点的 `note` ≤ 14 字（字数按视觉宽度算，英文和数字算半个）。颜色自动取本节主色，不要在数据里写颜色。

先看"该用哪种图"，再查字段。

## 该用哪种图

| 原文里出现的东西 | 用 |
|---|---|
| 随时间变化的数字、几个数量对比 | `bar` |
| 两三个数量的比例 / 之前与之后 / 区间（价格、收入范围） | `hbar` |
| "有三种选择 / 三种角色"，突出其中一个 | `stack` |
| 步骤、流程、从 A 到 B 的加工过程 | `flow` |
| 一组并列的概念、问题、分类（6–9 个） | `grid` |
| 多个来源汇成一个结果（影响你的人 → 你的观点） | `converge` |
| 一个结果分发到多处（一篇内容 → 多个平台） | `converge` + `"reverse": true` |
| 层级结构（支柱 → 话题 → 点子） | `tree` |
| 一两个要让人记住的大数字 | `stats` |
| 简单算术关系（10 × 30 = 300） | `equation` |
| 从现在到未来的轨迹、成长路径 | `path` |
| 做 vs 不做、对 vs 错 | `compare` |
| 循环、飞轮、闭环 | `cycle` |
| 一句有力的原话 | `quote` |
| 原文里的配图 | `image` |
| 用户要求加插画，某节需要一个画面（场景、隐喻、情绪）而不是数据 | `illustration`（AI 生成，见下文） |
| 以上都不合适 | `svg`（手写，最后手段） |

两张图尽量用**不同类型**，一张偏"数据/结构"，一张偏"观点/对比"。

## 字段

### bar：竖向柱状图
```json
{ "type": "bar", "caption": "…", "note": "IAB · *预测值",
  "data": [["2021", 13.9, "$13.9B"], ["2024", 29.5, "$29.5B"], ["2026*", 43.9, "$43.9B"]],
  "highlight": "last" }
```
- `data`：`[标签, 数值, 显示文字(可选)]`，2–12 项。超过 8 项时只显示被高亮那根的数值。
- `highlight`：`"last"`（默认）、`"max"`、`"none"` 或下标。
- `annotate`：可选 `{ "index": 3, "text": "100 万播放" }`，在某根柱旁标注。

### hbar：横向条形
```json
{ "type": "hbar", "caption": "…",
  "data": [{ "label": "以前", "value": 12, "display": "12 小时" }, { "label": "现在", "value": 4, "display": "4 小时" }],
  "highlight": 1 }
```
- 区间写法：`{ "label": "创意总监", "sub": "1–3 个客户", "range": [10, 75], "display": "每月 $10–75k" }`，并给 `"max": 75`、`"axis": ["$0", "$75k"]`。区间行不需要 `value`；数值可以是小数。
- `label` ≤ 6 字，`sub` ≤ 8 字，`display` ≤ 10 字。
- 2–5 行。`highlight` 为下标，缺省全部同色。

### stack：竖排选项，突出一个
```json
{ "type": "stack", "caption": "…", "header": "工作保障越来越弱时",
  "items": ["抱怨，什么都不做", "提升技能，找更好的工作", { "title": "打造你想要的事业", "note": "多数人会选" }],
  "highlight": 2, "footer": "“多得离谱的人”会选第三个" }
```
- 2–4 项；项可以是字符串或 `{title, note}`（note 是右侧小字）。

### flow：流程
```json
{ "type": "flow", "caption": "…", "steps": ["录音通话", "文字稿", "品牌文档", "每份 AI 草稿都读它"], "highlight": 2 }
```
- 2–5 步。`highlight` 缺省为最后一步。`"direction": "right"` 横排（只适合 ≤ 3 步、每步 ≤ 4 字）。

### grid：概念网格
```json
{ "type": "grid", "caption": "…", "items": ["你帮谁", "你的故事", "谁塑造了你", "…"], "cols": 3, "highlight": [] , "note": "九组，28 个问题" }
```
- 4–9 项，`cols` 2 或 3。

### converge：多个汇成一个（或一个分发到多个）
```json
{ "type": "converge", "caption": "…", "sources": ["Naval", "Leo Gura", "Mihaly C", "Kotler", "Wilber"], "target": "你的观点，用你的话", "note": "…" }
```
- `sources` 2–6 项，每项 ≤ 8 字；`target` ≤ 10 字。
- `"reverse": true` 时方向变成"一个 → 多个"：字段含义不变，`target` 仍是那"一个"（画在左边），`sources` 仍是那"多个"（画在右边）。

### tree：层级树
```json
{ "type": "tree", "caption": "…", "root": "支柱", "children": ["话题", "话题", "话题"], "leaves": 4, "note": "3–4 个支柱 → 5–7 个话题 → …" }
```
- `children` 2–4 个；`leaves` 每个子节点下画几个小点（0–6），表示"还有更多"。

### stats：大数字
```json
{ "type": "stats", "caption": "…", "items": [{ "label": "点子", "value": "75–280" }, { "label": "角度", "value": "300–1,400" }], "note": "按他的区间相乘" }
```
- 1–3 项；`value` ≤ 10 个字符。

### equation：算式
```json
{ "type": "equation", "caption": "…",
  "terms": [{ "value": "10 条私信", "label": "每天" }, { "value": "30", "label": "天" }, { "value": "300", "label": "次接触" }],
  "ops": ["×", "="], "result": "至少 1 个客户" }
```
- 2–3 个 term；`ops` 比 terms 少 1 个；`result` 可选（画在下方，带箭头）。

### path：轨迹
```json
{ "type": "path", "caption": "…",
  "points": [{ "label": "现在", "note": "糟糕的一天" }, { "label": "你反对什么", "note": "一种习惯" }, { "label": "五年后", "note": "他们怎么称呼自己" }] }
```
- 2–4 个点，从左下到右上；最后一个点高亮。

### compare：对比
```json
{ "type": "compare", "caption": "…",
  "left": { "title": "参考", "items": ["模式", "原理", "结构"] },
  "right": { "title": "照抄", "items": ["同一条帖子", "一字一句", "别人的故事"] } }
```
- 左边打 ✓，右边打 ✗；每边 2–4 项。

### cycle：循环
```json
{ "type": "cycle", "caption": "…", "items": ["花钱", "赚回来"], "center": "金钱" }
```
- 2–5 项，按顺时针排列；`center` 可选。

### quote：引语
```json
{ "type": "quote", "caption": "…", "text": "我现在的全部工作，就是审改草稿。", "by": "一家代理公司的创始人" }
```
- `text` ≤ 40 字。

### image：原文配图
```json
{ "type": "image", "caption": "…", "src": "https://pbs.twimg.com/media/xxx.jpg", "fit": "cover" }
```
- `src` 用 article.md 里的图片地址；`fit`：`cover`（铺满，默认）或 `contain`。

### illustration：AI 插画（可选，用户要求时才用）
```json
{ "type": "illustration", "caption": "…", "prompt": "A lone small figure walking up a long staircase in fog toward a faint glowing doorway", "aspect": "4:3" }
```
- 图片由 `scripts/illustrate.mjs` 生成，按**主题画风**自动加风格、配色和底色描述，缓存在 content.json 同目录的 `illustrations/`。没生成时渲染出虚线占位框并提示。
- `prompt` 写**一个具体画面**：主体 + 动作 + 场景 + 情绪，一两句话，英文更稳。不要写画风和颜色（脚本会按主题加），不要要求画字，不要画真实人物（用"一个年轻创作者"这类泛指）。
- 一篇最多 1–3 张，放在故事性强、缺数据的节里，另一张图仍用结构图或数据图。不要用插画替代原文里的数字。
- `aspect` 默认 `4:3`，可选 1:1、3:2、16:9 等。

```bash
node scripts/illustrate.mjs <content.json>                  # 按 content.json 的主题生成（Gemini 或 OpenAI）
node scripts/illustrate.mjs <content.json> --theme all       # 每个主题各一版
node scripts/illustrate.mjs <content.json> --dry-run         # 只看拼好的提示词
node scripts/illustrate.mjs <content.json> --provider mock   # 离线占位图，只用来检查版式
```
- 服务商：设置了 `GEMINI_API_KEY`（或 `GOOGLE_API_KEY`）就用 Gemini（默认模型 `gemini-3.1-flash-image`，`--model gemini-3-pro-image` 质量更高），否则用 `OPENAI_API_KEY`（`gpt-image-1`）。Gemini 免费层没有图像额度，需要开通付费。
- 换主题渲染时，如果该主题还没有对应插画，会借用其他主题已生成的版本并提示。

### svg：手写 SVG（最后手段）
```json
{ "type": "svg", "caption": "…", "svg": "<svg viewBox=\"0 0 280 180\">…</svg>" }
```
- 必须有 `viewBox`，建议 `0 0 280 180`。
- 颜色只能用这些 class，不要写死色值：
  - 填充：`f-acc`（主色）、`f-soft`（主色浅）、`f-ink`、`f-muted`、`f-bg`、`f-card`
  - 描边：`s-acc`、`s-ink`、`s-muted`
  - 文字：`t-sm`（小字）、`t-val`（加粗数值）、`t-note`（注释）、`t-on`（主色底上的字）
- 不能含 `<script>`、事件属性、外部链接。
