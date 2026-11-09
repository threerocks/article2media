#!/bin/bash
# Check what the article2media skills need. Installs nothing by itself; prints the commands for anything missing.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL="$ROOT/skills/article2media/engine"   # shared engine used by every skill

echo "== 必需"
node "$SKILL/scripts/doctor.mjs" >/dev/null && echo "✓ Node 22+ 与 Chrome 可用" || { node "$SKILL/scripts/doctor.mjs"; exit 1; }

echo "== 视频（可选）"
command -v ffmpeg >/dev/null && echo "✓ ffmpeg" || echo "— 没有 ffmpeg：做视频需要它（macOS: brew install ffmpeg）"
node "$SKILL/scripts/video.mjs" doctor | sed 's/^/  /'
