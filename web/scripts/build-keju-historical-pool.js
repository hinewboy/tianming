#!/usr/bin/env node
'use strict';
// 建内置历史人物库：从官方剧本抽取人物 → web/keju-historical-pool.js（殿试本地检索用·T1391）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');  // 仓库根（scenarios 在根）
const scenariosDir = path.join(ROOT, 'scenarios');
const outFile = path.join(ROOT, 'web', 'keju-historical-pool.js');

const pool = [];
const files = fs.readdirSync(scenariosDir).filter(f => f.includes('官方') && f.endsWith('.json'));
for (const f of files) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), 'utf8')); } catch (e) { console.warn('skip', f, e.message); continue; }
  const chars = d.chars || d.characters || [];
  const era = f.replace('（官方）.json', '');
  for (const c of chars) {
    if (!c || !c.name) continue;
    pool.push({
      n: c.name,
      d: c.displayName || '',
      z: c.zi || '',
      h: c.haoName || '',
      by: c.birthYear != null ? Number(c.birthYear) : 0,
      bp: c.birthplace || '',
      b: String(c.bio || c.summary || '').slice(0, 100),
      s: era
    });
  }
}
// 去重（同名保留第一个）
const seen = {};
const dedup = pool.filter(p => {
  if (seen[p.n]) return false;
  seen[p.n] = true;
  return true;
});

const js = '// 内置历史人物库（T1391·殿试本地检索·从官方剧本抽取·自动生成勿手改）\n'
  + '// 字段: n=name d=displayName z=zi h=haoName by=birthYear bp=birthplace b=bio(100字) s=source剧本\n'
  + 'window.KEJU_HISTORICAL_POOL = ' + JSON.stringify(dedup) + ';\n';
fs.writeFileSync(outFile, js, 'utf8');
console.log('pool written:', outFile, '|', dedup.length, '人 (去重前', pool.length + ')');
