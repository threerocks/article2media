# 视频 → 逐字稿文章：细节

`transcribe.mjs` 把视频链接或视频文件转成逐字稿文章 `article.md`，之后改写、翻译、长图、卡片、公众号、口播视频、白板、漫画都照常使用这份文章。

```bash
node ${CLAUDE_SKILL_DIR}/scripts/transcribe.mjs "https://www.bilibili.com/video/BV…"
node ${CLAUDE_SKILL_DIR}/scripts/transcribe.mjs "7.94 复制打开抖音，看看【…】 https://v.douyin.com/…/"   # 整段分享口令也行
node ${CLAUDE_SKILL_DIR}/scripts/transcribe.mjs ./talk.mp4 --title "标题" --author "作者"
node ${CLAUDE_SKILL_DIR}/scripts/transcribe.mjs ./talk.srt
```

## 支持的来源

| 来源 | 怎么拿到文字 | 需要 |
|---|---|---|
| 抖音（链接、短链、分享口令） | 移动分享页 → 下载视频（优先无水印地址）→ 本地语音识别；分享页不带数据时改用 yt-dlp | ffmpeg、本地 Whisper；yt-dlp 兜底时要浏览器 cookie |
| YouTube | yt-dlp：人工字幕 → 原语言自动字幕 → 下载音频本地识别 | yt-dlp（新版，支持 JS 校验）、ffmpeg |
| B 站 | yt-dlp：人工字幕 / AI 字幕 → 下载音频本地识别 | yt-dlp、ffmpeg |
| 本地视频 / 音频（mp4、mov、mkv、webm、mp3、m4a、wav…） | ffmpeg 转 16 kHz 音频 → 本地语音识别 | ffmpeg、本地 Whisper |
| `.srt` / `.vtt` 字幕 | 直接解析 | 无 |

本地语音识别用 mlx-whisper 和 whisper-large-v3-turbo（Apple Silicon），速度大约是音频时长的 1/10 到 1/30。`node ${CLAUDE_SKILL_DIR}/scripts/doctor.mjs` 会报告 yt-dlp、ffmpeg、Whisper 是否可用。脚本不会自动安装或下载这些依赖。

## 文字怎么处理

- **字幕轨**：人工字幕优先；自动字幕只要视频原语言那一轨，机器翻译的字幕轨不算逐字稿；B 站弹幕不算字幕。
- **YouTube 自动字幕**：每条都重复上一行，还夹着 10 ms 的过渡条，这些会去掉。
- **清理**：
  - 中文统一转简体（内置 OpenCC 字表）；
  - Whisper 在中文里写的半角标点改成全角；
  - 去掉 Whisper 在静音、音乐处编出的固定套话（如「字幕由 Amara.org 社区提供」），连续 3 段以上一模一样的循环只留两段。
- **分段**：
  - 在句末停顿（1.2 秒以上）处分段；没有标点时，停顿 2 秒以上才分；太长时强制分段。
  - 中文识别结果里用空格表示的停顿改成逗号，段尾补句号。只补标点，不改字。
- **专有名词**：
  - `--prompt "人名 术语"`：识别前提示 Whisper；
  - `--terms 词表.txt`：识别后替换，每行 `错词=>正词`，其他行当作备忘，不处理。

## 产出

```
article2media-out/<平台>-<id>/
├── article.md              # 逐字稿文章：front matter 带 platform（抖音视频 / B 站视频 / YouTube 视频 / 本地视频…）、duration、transcript（文字来源）
├── meta.json               # 完整元数据：作者、时长、播放数据、字幕状态、用到的文件
└── transcript/
    ├── segments.md         # 带时间轴的逐句稿，核对用
    ├── segments.json       # 原始分段（重跑时复用，不再识别；--force 重来）
    ├── raw.txt             # 清理前的原文
    ├── audio.mp3 / subtitle.*.vtt
    └── video.mp4           # 只在 --keep-video 时保留，截图用
```

## 写作时注意

- **逐字稿是口语**：改写（article-rewrite）时按写作指南重组，去掉口头禅、重复和自我介绍。原文排版（原文长图、原文卡片、公众号排版）例外，它们保留逐字稿原样。
- **核对识别错误**：人名、作品名、术语最容易错。结合上下文判断，必要时用 `--prompt` / `--terms` 重跑。拿不准的在交付时列出来，不要猜。
- **来源**：写成「内容整理自 <作者> 的<平台>视频《标题》」，加上链接。
- **截图**：用 `--keep-video` 保存的视频截图前，先看有没有平台水印、作者标记、烧录字幕；有的话改用 AI 插画。

## 登录态与边界

- **浏览器 cookie**：有的网络下 YouTube 会要求「登录确认你不是机器人」，抖音分享页有时不带视频数据，这两种情况都需要浏览器 cookie。脚本会给出两个办法：
  - 用户明确同意复用本机浏览器状态后，加 `--cookies-from-browser chrome`；
  - 请用户把视频保存到本地，直接传文件，再用 `--title`、`--author` 补上标题和作者。

  不要自己去读浏览器 cookie，也不要研究平台的私有接口来绕过限制。
- **不能处理的视频**：私密、会员专享、地区限制的视频可能拿不到。
- **使用范围**：逐字稿用于学习、整理和二次创作参考。做成图文或视频发布时要署名、注明来源，不要整段复刻他人作品冒充原创，商用前确认授权。
