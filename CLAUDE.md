# CLAUDE.md

Guidance for Claude Code when working on this repository (not when using the skills — those are `skills/*/SKILL.md`).

## Overview

A skills repository and Claude Code plugin (`.claude-plugin/`, `"skills": "./skills"`). Since 2.0 it holds **11 skills**: ten independent capabilities and one entry skill that chains them into recommended combos. Articles or videos → Chinese visual content (long images, fixed-ratio cards, 公众号, explainer video, whiteboard, comic) with 21 themes.

| skill | capability | input → output |
|---|---|---|
| `article-fetch` | fetch an article | URL / file → `article.md` |
| `video-transcript` | video → transcript | link / media / .srt → `article.md` + `transcript/` |
| `article-rewrite` | rewrite (summary) | `article.md` → `content.json`; `export.mjs` → `rewrite.md` + figure PNGs |
| `article-translate` | full translation | `article.md` → `article.zh.md` (model writes; `translate.mjs check` verifies) |
| `long-image` | long images | `content.json` → magazine pages; `article.md` → verbatim long image |
| `image-cards` | 3:4 / 4:5 / 1:1 / 9:16 cards | `content.json` → designed cards; `article.md` → verbatim cards |
| `wechat-layout` | 公众号排版 | article (`.md` only) → paste-ready inline-styled HTML + covers |
| `explainer-video` | 9:16 video | article (+ `content.json`) → `video.json` → MP4 |
| `logic-whiteboard` | argument whiteboard | `article.md` → `whiteboard.json` → PNG |
| `article-comic` | comic | `article.md` → `comic.json` → panels + PNG + 3:4 cards |
| `article2media` | entry + shared engine | recommended combos; `engine/` holds all code, layouts, themes, voices |

## Repository structure

```
article2media/
├── .claude-plugin/              # plugin.json, marketplace.json, icon.png
├── .claude/skills/<name>        # symlinks to skills/<name> for local use in this repo
├── skills/
│   ├── article2media/           # entry skill + shared engine
│   │   ├── SKILL.md             # combos and routing
│   │   ├── references/          # shared: pipeline.md (handoff files, 原文 vs 改写 table, calling siblings), verbatim.md, styles.md
│   │   └── engine/
│   │       ├── scripts/         # Node 22 CLIs, zero npm deps: fetch, render, export, translate, illustrate, video, comic, doctor; lib/
│   │       ├── layouts/         # structure CSS per layout (long, card, full, cards-article, wechat, wechat-article, whiteboard, comic, video)
│   │       ├── themes/          # 21 themes (first-line comment = name | description); illustration-styles.json, caption-styles.json
│   │       └── assets/voices/   # VoxCPM2 designed voices (catalog.json)
│   └── <capability>/            # SKILL.md, agents/openai.yaml, references/, scripts/ (thin wrappers into the engine)
│       └── …                    # article-rewrite/examples/: content.json fixtures used by tests and as model examples
├── tests/                       # run-all.mjs (self-test matrix), theme-sheet.mjs
├── scripts/install.sh           # dependency check; prints commands, downloads nothing
├── experiments/                 # local prototypes (gitignored)
└── article2media-out/           # generated output (gitignored)
```

## Architecture

- **Skills share one engine, hand off through files.** Every capability skill's `scripts/*.mjs` is a ~10-line wrapper that locates `../../article2media/engine/scripts/` (or `$ARTICLE2MEDIA_ENGINE`), sets `A2M_CLI` (its own name for usage text) and preset args (`--layout card`, `--kind video` …), then imports the engine script. Skills never import each other; they exchange `article.md`, `article.zh.md`, `content.json`, `rewrite.md` in one working directory (`skills/article2media/references/pipeline.md`). Installing a capability without `article2media` next to it fails with a clear message (tested).
- **The input decides the pipeline** in `render.mjs`: an article (`.md`) is laid out verbatim (`render-full.mjs`, `render-cards-article.mjs`, `render-wechat-article.mjs`); a `content.json` is designed (long pages, cards). `--layout wechat` accepts articles only — a rewrite reaches 公众号 via `export.mjs` → `rewrite.md` (figures captured as PNGs in the exported theme, front matter `kind: rewrite`).
- **Content and style are separate.** Layout CSS + theme CSS (variables plus small structural overrides, loaded last), screenshotted in headless Chrome via the DevTools protocol (`lib/chrome.mjs`).
- **Verbatim pipelines share one ledger** (`lib/layout-full.mjs`): `loadArticle` (front matter, `parseBlocks`, parser-coverage check), `readbackInPage` (DOM text per `data-source-block`, `[data-deco]` ignored, `merge` joins a block split across cards), `compareLedger` (`looseBreaks` for 公众号, where newlines are `<br>`). Original cards flow blocks in the page (`flowInPage`) and split paragraphs / lists / tables at line, item or row boundaries.
- **Input:** `fetch.mjs` (`--kind article|video`) turns every source into `article.md`. Videos go through `lib/media/` (Douyin share page → yt-dlp; YouTube / Bilibili subtitles via yt-dlp; else local Whisper; `.srt` / `.vtt` parsed directly) into a verbatim transcript with timestamps in `transcript/`.
- **Every output has its own verification**, and a run fails (exit 1) on errors: layout QA, the verbatim block ledger, the whiteboard ledger, the translation structure check, comic lettering bounds, video safe areas and timing.
- **Optional capabilities are detected, never required:** image generation (Codex CLI → OpenAI → Gemini), local voice (VoxCPM2), Whisper, edge-tts, yt-dlp. Missing ones degrade gracefully or stop with a clear message; nothing is installed or downloaded implicitly.

## Conventions

- User-facing text (CLI output, references, SKILL.md) is Simplified Chinese; code comments are English.
- Scripts print `✓ / ⚠ / ✗` lines and end with a `版面检查：N 个错误，M 个提示` summary (`翻译检查` for translation); errors exit non-zero.
- Generated images never contain text; all words are HTML. Image prompts name observable properties, never artists.
- Don't put production notes, disclaimers or QA status inside the images beyond the source credit; report them in the delivery reply.
- SKILL.md paths use `${CLAUDE_SKILL_DIR}/…`; references to another skill use `../<skill>/…`. The test suite checks every `${CLAUDE_SKILL_DIR}` path exists.
- New capability = new `skills/<name>/` (SKILL.md, agents/openai.yaml, wrapper scripts), a row in `pipeline.md` and the entry SKILL.md, a symlink in `.claude/skills/`.
- Version lives in every `skills/*/SKILL.md` frontmatter, `.claude-plugin/plugin.json` and `marketplace.json` — bump all (the tests check they match), and add a `CHANGELOG.md` entry.

## Testing changes

```bash
node tests/run-all.mjs --quick            # skills, CLI, 插画/公众号/原文卡片/翻译/视频/全文/白板/漫画 checks, examples × layouts
node tests/run-all.mjs                    # full matrix, every theme
node tests/run-all.mjs --themes quiet     # only some themes (new theme)
node tests/theme-sheet.mjs                # regenerate docs/themes.jpg
claude plugin validate .
```

Pass = every check ✓ and 0 layout errors per render. Don't run two renders at once while the matrix is running (they share Chrome's font cache). After changing a layout or theme, look at the rendered PNGs (and `review/` slices / `overview.jpg`), not just the test result.
