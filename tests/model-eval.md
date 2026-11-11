# 换模型回归测试

驱动这些 skill 的模型换了（Claude 的不同档位、Codex / GPT，或同一模型的新版本），或者改了 SKILL.md、references 之后，用这套流程确认产出质量没有掉下来。

目标：**较小的模型（Haiku）在同样的提示下，达到参考模型（Opus）98% 以上的效果。**

## 1. 准备

- 3 篇类型不同、有完整正文的文章，各自已经抓取好（`article.md` + `meta.json`）：一篇英文技术文、一篇中文教程、一篇中文观点或经验文。带原文配图的至少一篇。
- 每篇、每个模型一个干净的工作目录，只放 `article.md` 和 `meta.json`。
- 本地字体已安装（`fonts.mjs`），几组可以同时跑。

## 2. 跑

每个工作目录交给一个独立会话，模型分别是参考模型和被测模型，提示完全一样，不加任何额外提示：

```text
You are the model driving the article2media skills in a real user session. The user typed:
`/article2media 做成小红书` for an article that has already been fetched.
Work directory: <目录> (it already contains article.md and meta.json — do not fetch again,
and write outputs only inside this directory).
Start by reading <仓库>/skills/article2media/SKILL.md and follow it, and every skill/reference it
routes you to, exactly as written. Do not modify any file in the repository. Do not generate AI images.
Do not ask the user questions; make the decisions the docs tell you to make.
When finished, write the delivery reply you would give the user. Then add a section titled `自评` with:
(1) each run of check.mjs and of the card render — error and warning counts per run, and what you changed;
(2) any instruction you found unclear, contradictory, or decided to skip, quoting the file and line;
(3) the theme you picked and which rule in styles.md led you there.
```

`自评` 里的第 (2) 项是改文档最有用的线索：模型说哪里不清楚，通常就是下一个会出错的地方。

## 3. 评分

**客观分**（可重复，满分 100）：

```bash
node tests/eval-score.mjs <被测目录> --ref <参考目录>
```

| 项 | 分 | 看什么 |
|---|---|---|
| 版面 | 20 | 渲染后还剩几条提示（自动省略、图太小、单字成行） |
| 规则 | 25 | 没处理的内容提示（第一人称、原文找不到的数字权重最高）、面板标题没写出处、感叹号 |
| 深度 | 25 | 数据面板、每节两张图、整页卡节奏、原文配图、执行清单、封面信息 |
| 覆盖 | 20 | 原文的数字和专有名词有多少进了改写稿 |
| 交付 | 10 | 小红书标题、正文长度、标签、备选标题、封面 |

没有出图、或有任何错误时，总分为 0。

**盲评**（判断客观分量不到的东西）：把两组的 `overview.jpg` 和 `content.json` 随机标成 A / B，交给第三个会话（参考模型档位），只给原文和下面的标准，按 1–10 分打：

1. 封面：缩略图大小下一眼能不能看懂、想不想点开；
2. 准确：和原文对照，有没有说错、夸大、漏掉关键条件；
3. 信息量：读完能带走多少原文里的具体做法、数字、例子；
4. 结构与节奏：一组卡片读下来顺不顺、有没有重复或空洞的卡；
5. 中文表达：像不像一个好编辑写的，有没有翻译腔、网络腔。

**效果比** = 被测模型 ÷ 参考模型，客观分和盲评各算一次，两个都要 ≥ 98%。

## 4. 没达标时

- 先看 `自评` 和失分项：是文档没写清楚、写了但脚本不查、还是引擎行为让模型两难。
- 优先把要求做成**脚本提示**：实测里 Haiku 会把每一条 ⚠ 都处理到 0，只写在文档里的要求它可能漏。
- 改完重跑被测模型（参考结果可以复用），直到达标。
- 每次结论记一行到 `CHANGELOG.md`：哪个模型、哪几篇、两个效果比。
