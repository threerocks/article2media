#!/usr/bin/env python3
"""Regenerate skills/article2media/engine/scripts/lib/media/zh-t2s.mjs from OpenCC's dictionaries.

    python3 tests/gen-t2s.py      (needs `pip install opencc-python-reimplemented`)
"""
import json, os, opencc

D = os.path.join(os.path.dirname(opencc.__file__), 'dictionary')
OUT = os.path.join(os.path.dirname(__file__), '..', 'skills', 'article2media', 'engine', 'scripts', 'lib', 'media', 'zh-t2s.mjs')

def load(name, keep_identity):
    out = {}
    for line in open(os.path.join(D, name), encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#'):
            continue
        k, v = line.split('\t', 1)
        v = v.split(' ')[0]
        if keep_identity or k != v:
            out[k] = v
    return out

chars = load('TSCharacters.txt', False)
phrases = load('TSPhrases.txt', True)          # identity phrases (乾隆→乾隆) protect against per-character conversion
single = {k: v for k, v in chars.items() if len(k) == 1 and len(v) == 1}
phrases.update({k: v for k, v in chars.items() if k not in single})
pairs = ''.join(k + v for k, v in single.items())

js = f"""// Traditional → Simplified Chinese: a character table plus phrases that override it.
// Derived from OpenCC's TSCharacters.txt and TSPhrases.txt (Apache License 2.0, https://github.com/BYVoid/OpenCC),
// taking the first candidate of each entry. Regenerate with `python3 tests/gen-t2s.py`.

const PAIRS = {json.dumps(pairs, ensure_ascii=False)};
const PHRASES = {json.dumps(phrases, ensure_ascii=False)};

const CHAR = new Map();
{{ const cs = [...PAIRS]; for (let i = 0; i < cs.length; i += 2) CHAR.set(cs[i], cs[i + 1]); }}
const PHRASE_RE = new RegExp(Object.keys(PHRASES).sort((a, b) => b.length - a.length).join('|'), 'g');

/** Convert Traditional Chinese to Simplified; everything else passes through unchanged. */
export function t2s(text) {{
  const s = String(text ?? '');
  let out = '', last = 0;
  // Phrases win over characters: copy each phrase's target as-is, convert the text between phrases per character.
  for (const m of s.matchAll(PHRASE_RE)) {{
    for (const ch of s.slice(last, m.index)) out += CHAR.get(ch) ?? ch;
    out += PHRASES[m[0]];
    last = m.index + m[0].length;
  }}
  for (const ch of s.slice(last)) out += CHAR.get(ch) ?? ch;
  return out;
}}
"""
open(OUT, 'w', encoding='utf-8').write(js)
print(f'{len(single)} characters, {len(phrases)} phrases → {os.path.normpath(OUT)}')
