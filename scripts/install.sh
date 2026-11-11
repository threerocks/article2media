#!/bin/bash
# Check what the article2media skills need. Installs nothing by itself; prints the commands for anything missing.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL="$ROOT/skills/article2media/engine"   # shared engine used by every skill

echo "== 必需"
REPORT="$(node "$SKILL/scripts/doctor.mjs")" || { echo "$REPORT"; exit 1; }
echo "✓ Node 22+ 与 Chrome 可用"
# Fonts are not required (themes fall back to system CJK fonts). Local copies make rendering independent of the
# network; they are downloaded only by the explicit command printed here, never by this script or by a render.
echo "$REPORT" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const cs=JSON.parse(s).checks;for(const n of ["local-fonts","web-fonts"]){const c=cs.find((x)=>x.name===n);if(c)console.log((c.ok?"✓ ":n==="local-fonts"?"— ":"⚠ ")+c.detail)}})'

echo "== AI 出图（可选）"
echo "$REPORT" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const c=JSON.parse(s).checks.find((x)=>x.name==="ai-illustration");console.log((/^出图/.test(c.detail)?"✓ ":"— ")+c.detail)})'

echo "== 视频（可选）"
command -v ffmpeg >/dev/null && echo "✓ ffmpeg" || echo "— 没有 ffmpeg：做视频需要它（macOS: brew install ffmpeg）"
node "$SKILL/scripts/video.mjs" doctor | sed 's/^/  /'
