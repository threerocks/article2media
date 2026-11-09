// Brand info for page furniture (footer brand, @handle, series, editor name).
// Order: --brand file → brand.json next to the input → ./article2media.brand.json → ~/.config/article2media/brand.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function loadBrand({ file, dir } = {}) {
  const candidates = [
    file,
    dir && path.join(dir, 'brand.json'),
    path.join(process.cwd(), 'article2media.brand.json'),
    path.join(os.homedir(), '.config', 'article2media', 'brand.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try { return { ...JSON.parse(fs.readFileSync(p, 'utf8')), _from: p }; } catch { console.log(`⚠ brand 文件无法解析：${p}`); }
  }
  return {};
}
