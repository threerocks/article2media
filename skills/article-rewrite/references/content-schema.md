# content.json 格式（v1）

`content.json` 只描述**内容和结构**，不含任何颜色、字体、尺寸。同一份文件可以用任意主题渲染。
写完后运行 `node ${CLAUDE_SKILL_DIR}/scripts/check.mjs content.json` 校验，不出图。

## 字数怎么算

本文档和 `figures.md` 里所有"≤ N 字"都按**视觉宽度**计：一个汉字或全角标点算 1，一个英文字母、数字或半角符号算 0.5。
例如 "YouTube 植入" 约等于 6 字。render 会按同样的规则给出超长提示。

## 行内标记

所有文本字段支持：
- `**加粗**`：页面上最关键的一句话加粗。每段最多 1–2 处。
- `\n`：强制换行，只在 `title`、`heading` 里用来控制断行。
- 其他 Markdown 和 HTML 都会按原样转义显示，不要用。

## 顶层

```jsonc
{
  "lang": "zh",                       // zh | en，影响"第 1 / 3 页""图 1A"等界面文字
  "theme": "editorial",               // 主题名，或 {"long": "…", "cards": "…", "wechat": "…"} 分别指定。用户没指定时由你按 styles.md 来选；--theme 会覆盖它
  "title": "DAN KOE：2027 年\n最赚钱的 AI 生意",  // 每页顶部大标题，建议 2 行，每行 ≤ 12 个汉字
  "series": "实战手册 · 创作者经济",      // 页眉左侧的栏目名（可选）
  "source": {                          // 原文信息，用于页脚来源行
    "author": "Dan Koe", "handle": "@thedankoe",
    "title": "2027 年最值得做的 AI 生意",   // 原文标题（可翻译）
    "platform": "X 文章", "date": "2026-11-03",
    "url": "https://x.com/…"
  },
  "footnote": "…",                     // 可选。页脚小字；缺省会根据 source 自动生成
  "brand": { "name": "…", "handle": "@…" },  // 可选。页脚右侧的品牌名；缺省读 brand.json
  "pages": [ Page, … ]                 // 1–4 页
}
```

## Page

```jsonc
{
  "part": "第一部分 · 技能、市场与团队",  // 标题下方的彩色副标题
  "intro": "Dan Koe 是…第一页讲…第二页讲…",  // 2–3 句导语，可加粗；≤ 120 字
  "sections": [ Section, … ],          // 每页 3–4 节（checklist 节算 2 节）；放不下时加一页（最多 4 页），不要删原文的节
  "closing": "**注意力是技能，品牌是留住它的东西。**第二页：访谈、挖掘、规划。"  // 页尾收束句 + 下一页预告；≤ 60 字
}
```

## Section（kind: "standard"，默认）

左栏是文字，右栏是两张图加一个数据面板。

```jsonc
{
  "label": "技能",                     // 显示为 "01 / 技能"，编号自动生成、跨页连续
  "heading": "注意力\n决定一切",          // ≤ 16 字，可用 \n 控制断行
  "paragraphs": ["…", "…"],            // 1–3 段，每段 60–90 字，合计不少于 100 字
  "bullets": ["…", "…"],               // 0–3 条，每条 ≤ 30 字
  "takeaway": "无论你做什么，能不能卖出去都由注意力决定。",  // 一句收束金句，≤ 26 字
  "figures": [ Figure, Figure ],       // 0–2 张，推荐正好 2 张；类型见 figures.md
  "panel": Panel                       // 可选，图下方的彩色底面板
}
```

## Section（kind: "checklist"）

整页宽度的阶段清单，适合"行动清单 / 执行步骤"，通常放在最后一页的最后一节。

```jsonc
{
  "kind": "checklist",
  "label": "执行",
  "heading": "创始人执行清单",
  "paragraphs": ["按实际执行顺序排列。**从上往下做；事情真做完了才打勾。**"],
  "stages": [                          // 2–6 个阶段，两列排布
    { "label": "第 1 阶段", "title": "定下打法",
      "items": ["选一个：做你自己的品牌，或做别人的创意团队。", "…"],   // 每个阶段 2–5 条，每条 ≤ 30 字
      "done": "你能用两句话说清它为谁而做、为什么是你。" }               // "做完的标准"，≤ 30 字
  ],
  "guard": {                           // 可选：深色"护栏"卡片，列出要避开的坑
    "title": "该避开什么",
    "items": ["别把它当一夜暴富。", "…"],
    "note": "每一条都是他文中点名的失败模式。"
  },
  "note": "步骤和数字是他的；阶段划分和顺序出自编者。"   // 可选，清单下方的小字说明
}
```

## Panel

三种类型，统一放在图的下方。标题写法：`<这是什么> · <出处>`，例如"他的数字 · 编者核对""可以试的提示词 · 他的原话""两种账号 · 编者归纳"，让读者分清原文和编者加工。

```jsonc
// 1. 表格：2–5 行，左列是短标签（≤ 10 字），右列是解释（≤ 50 字）
{ "type": "table", "title": "谁在为注意力买单 · 他的看法",
  "rows": [["你自己的生意", "发内容现在几乎是吸引付费受众的标配"], ["…", "…"]] }

// 2. 卡片：2–9 张，自动排成 2 或 3 列；text 可以是引语
{ "type": "cards", "title": "两种账号 · 编者归纳",
  "items": [{ "title": "内容还行，没有品牌", "text": "一条爆了，之后每条一千播放。" }, { "title": "…", "text": "…" }] }

// 3. 引用：一大段原话（提示词、关键引文），≤ 160 字
{ "type": "quote", "title": "可以试的提示词 · 他的原话",
  "text": "“从 [@handles] 抓取最好的内容……”", "note": "注：他用自家工具 Eden 来跑；只要你能把帖子喂给模型，用什么都行。" }
```

## Figure（通用字段）

```jsonc
{ "type": "bar", "caption": "美国品牌在创作者上的投入：五年约涨 3 倍。", "note": "IAB · *预测值", … }
```

- `type`：图表类型，见 `figures.md`。
- `caption`：图下方的说明，≤ 24 字，说出"这张图想让读者看到什么"，而不是复述图名。
- `note`：图内底部的小字（数据来源、单位、"示意图"等），≤ 20 字，可选。
- 其余字段按类型而定。

## 卡片专用字段（可选）

只影响卡片（image-cards，`--ratio 3:4 / 4:5 / 1:1 / 9:16`），长图会忽略它们。写法和取舍见 `../../image-cards/references/xhs-guide.md`。

```jsonc
{
  "cover": { "style": "hook|number|versus|quote|image|toc", "title": "…", "kicker": "…", "subtitle": "…", "points": ["…"],
             "number": { "value": "413", "unit": "个文件", "label": "…" },             // style: number
             "versus": { "left": { "label": "…", "value": "…", "note": "…" }, "right": { "…": "…" } },   // style: versus
             "by": "…", "summary": "…", "cta": "…" },
  "xhs": { "title": "≤ 20 字", "caption": "≤ 1000 字", "tags": ["…"] },
  "pages": [{ "sections": [{
    "…": "…",
    "card": { "mode": "single|split|skip", "text": "…", "bullets": ["…"], "figure": 0, "panel": false,
              "style": "quote|number|image", "quote": "…", "number": { "value": "…", "unit": "…", "label": "…" } }   // 整页卡型，给一组图做节奏
  }] }]
}
```

封面备选、轻量形态和期号（都可选，写法见 xhs-guide 第 2.5 节）：

```jsonc
"issue": 12,                                             // 期号，页眉和封面显示"第 12 期"
"cover": { "…": "…", "alts": [{ "title": "…" }, { "style": "number", "number": { "…": "…" } }] },   // --covers 时逐个出图
"quotes": ["一句话", { "text": "一句话", "by": "谁说的" }],   // --form quotes；缺省用每节的 takeaway
"onepage": { "title": "…", "subtitle": "…", "points": [{ "title": "…", "text": "…" }] },             // --form onepage；缺省自动取
"qa": [{ "q": "问题 ≤ 24 字", "a": "回答 ≤ 70 字" }]       // --form qa，必须写
```

## 公众号专用字段（可选）

只影响导出的文章 `rewrite.md`（`export.mjs`），也就是公众号总结用的标题、摘要和头图。写法见 `../../wechat-layout/references/wechat-guide.md`。

```jsonc
"wechat": {
  "title": "≤ 64 字",          // 公众号标题；缺省用 title
  "digest": "≤ 120 字",        // 摘要（分享卡片上那行字）；缺省用第一页导语
  "coverTitle": "…",           // 可选：头图上的标题，缺省用 title（保留 \n 断行）
  "kicker": "…"                // 可选：头图上方小字，缺省用 series
}
```

## 发布用的备选标题（可选）

`publish.titles`：每个平台 3 个**角度不同**的备选标题（给结果、给数字、点反常识…），供发布清单 `publish.md` 列出来让用户挑；不影响任何渲染。`xhs.title` / `wechat.title` 仍是默认用的那个，备选里不用重复它。要出卡片或公众号时就写。

```jsonc
"publish": {
  "titles": {
    "xhs":    ["≤ 20 个字符", "…", "…"],     // 和 xhs.title 同一个上限（字母、空格也算）
    "wechat": ["≤ 64 字", "…", "…"],
    "x":      ["一句话帖子文案", "…", "…"]     // 也可以写 douyin、channels、weibo
  }
}
```

每个平台 1–5 个、不能重复、不能换行；写法同各平台标题的要求（不夸大，不写"保姆级""全网最全"）。

## AI 插画（可选）

用户要插画时才写，生成方法见 `figures.md` 的 illustration 一节。

```jsonc
"cover": { "…": "…", "illustration": { "prompt": "画面描述（英文更稳）", "aspect": "4:3" } },  // 封面插画：长图第一页标题旁、小红书封面、rewrite.md 的题图（公众号题图和头图）
"illustration": { "style": "…" }   // 可选：统一指定画风，覆盖主题自带的画风
```

## 页数与密度建议

| 原文长度 | 页数 | 每页节数 |
|---|---|---|
| < 1,500 英文词 / 3,000 汉字 | 1 页 | 3–4 |
| 1,500–3,000 英文词 / 3,000–6,000 汉字 | 2 页 | 4 |
| > 3,000 英文词 / 6,000 汉字 | 3 页（最多 4 页） | 3–4 |

长度按整篇正文算，提示词、代码块也算（它们常是这类文章最有用的部分）；文末的个人介绍、推广链接不算。

每页渲染出来高度应在 2,600–4,200 px（CSS 像素，宽 1,200）之间；render 会在超出时提示。
