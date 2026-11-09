#!/usr/bin/env node
// article-fetch · Fetch an article (X, web page, WeChat, local file) as article.md.
// Runs the shared engine (skills/article2media/engine), installed together with the article2media skill.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const engine = process.env.ARTICLE2MEDIA_ENGINE ? pathToFileURL(process.env.ARTICLE2MEDIA_ENGINE.replace(/\/?$/, '/scripts/')) : new URL('../../article2media/engine/scripts/', import.meta.url);
if (!fs.existsSync(new URL('fetch.mjs', engine))) {
  console.error('✗ 找不到共享引擎 article2media/engine：article-fetch 要和 article2media 装在同一个 skills 目录里（插件安装会一起装好）');
  process.exit(2);
}
process.env.A2M_CLI = 'fetch.mjs';
process.argv.splice(2, 0, '--kind', 'article');
await import(new URL('fetch.mjs', engine));
