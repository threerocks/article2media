# CLAUDE.md

Guidance for Claude Code when working on this repository (not when using the skill — that is `skills/article2media/SKILL.md`).

## Overview

A skills repository. Each skill is a self-contained directory under `skills/`, installable on its own into Claude Code (`~/.claude/skills/`) or Codex (`~/.agents/skills/`), and the whole repo is also a Claude Code plugin (`.claude-plugin/`). Today there is one skill, `article2media`: articles → Chinese visual content in 7 layouts with 21 themes.

## Repository structure

```
article2media/
├── .claude-plugin/          # plugin.json ("skills": "./skills"), marketplace.json, icon.png
├── skills/
│   └── article2media/         # the skill — self-contained
│       ├── SKILL.md         # frontmatter: name, description (trigger phrases), argument-hint, allowed-tools, version
│       ├── agents/openai.yaml   # Codex display name + default prompt
│       ├── references/      # read on demand by the model (writing, schema, figures, styles, xhs, wechat, video, mode-*)
│       ├── scripts/         # Node 22 CLIs, zero npm deps: fetch, render, illustrate, video, comic, doctor; lib/
│       ├── layouts/         # structure CSS per layout; themes/ restyle them through CSS variables
│       ├── themes/          # 21 themes, one CSS file each (first-line comment = name | description); illustration-styles.json, caption-styles.json
│       ├── assets/voices/   # VoxCPM2 designed voices (catalog.json)
│       └── examples/        # content.json fixtures used by tests
├── tests/                   # run-all.mjs (self-test matrix), theme-sheet.mjs
├── scripts/install.sh       # dependency check; prints commands, downloads nothing
├── experiments/             # local prototypes, not part of the skill (gitignored)
└── article2media-out/         # generated output (gitignored)
```

## Architecture

- **Content and style are separate.** The model writes `content.json` (structure only); `render.mjs` combines it with a layout CSS and a theme CSS and screenshots headless Chrome via the DevTools protocol (`scripts/lib/chrome.mjs`). Themes are CSS variables plus small structural overrides, loaded last.
- **Layouts:** `long` (default), `card` (`--ratio`), `wechat` (inline-styled paste-ready HTML), `full` (`-f`, verbatim original text — driven by `article.md`, not content.json), `whiteboard` (`-w`, driven by `whiteboard.json` + a source inventory), `comic` (`comic.mjs`, generated panels + HTML lettering), and video (`video.mjs`, its own `video.json`).
- **Every layout has its own verification**, and a render fails (exit 1) on errors: layout QA (overflow, clipping, overlaps), the full-text block ledger (DOM text must equal the source block for block), the whiteboard ledger (every source paragraph rendered or omitted with a reason), comic lettering bounds, video safe areas and timing checks.
- **Optional capabilities are detected, never required:** image generation (`lib/imagegen.mjs`: Codex CLI → OpenAI → Gemini), local voice (VoxCPM2 via mlx-audio), Whisper alignment, edge-tts. Missing ones degrade gracefully or stop with a clear message; nothing is installed or downloaded implicitly.

## Conventions

- User-facing text (CLI output, references, SKILL.md) is Simplified Chinese; code comments are English.
- Scripts print `✓ / ⚠ / ✗` lines and end with a `版面检查：N 个错误，M 个提示` summary; errors exit non-zero.
- Generated images never contain text; all words are HTML. Image prompts name observable properties, never artists.
- Don't put production notes, disclaimers or QA status inside the images beyond the source credit; report them in the delivery reply.
- Version lives in `skills/article2media/SKILL.md` frontmatter, `.claude-plugin/plugin.json` and `marketplace.json` — bump all three, and add a `CHANGELOG.md` entry.

## Testing changes

```bash
node tests/run-all.mjs --quick            # ~3 min: CLI behaviour, wechat/illustration/video/full/whiteboard/comic checks, examples × layouts
node tests/run-all.mjs                    # ~17 min: full matrix, every theme
node tests/run-all.mjs --themes quiet     # only some themes (new theme)
node tests/theme-sheet.mjs                # regenerate docs/themes.jpg
claude plugin validate .
```

Pass = every check ✓ and 0 layout errors per render. Don't run two renders at once while the matrix is running (they share Chrome's font cache). After changing a layout or theme, look at the rendered PNGs (and `review/` slices for long outputs), not just the test result.
