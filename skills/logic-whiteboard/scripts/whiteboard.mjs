#!/usr/bin/env node
// logic-whiteboard · Whiteboard: article.md → source inventory; whiteboard.json → whiteboard.png.
// Runs the shared engine (skills/article2media/engine), installed together with the article2media skill.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const engine = process.env.ARTICLE2MEDIA_ENGINE ? pathToFileURL(process.env.ARTICLE2MEDIA_ENGINE.replace(/\/?$/, '/scripts/')) : new URL('../../article2media/engine/scripts/', import.meta.url);
if (!fs.existsSync(new URL('render.mjs', engine))) {
  console.error('✗ 找不到共享引擎 article2media/engine：logic-whiteboard 要和 article2media 装在同一个 skills 目录里（插件安装会一起装好）');
  process.exit(2);
}
process.env.A2M_CLI = 'whiteboard.mjs';
process.argv.splice(2, 0, '--layout', 'whiteboard');
await import(new URL('render.mjs', engine));
