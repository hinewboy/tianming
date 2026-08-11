#!/usr/bin/env node
'use strict';
// T1377(2026-08-11) 守护：记忆注入压缩渲染
// ① hard_state 人物状态合并为 <hard-state> 紧凑列表（属性开销 -80%）；
// ② authority-rank/lane 冗余属性不再输出（lane 由 section 标签表达·authority-rank 由 authority 派生）；
// ③ visibility 仅非 internal 输出；source-refs/basis-refs 每侧 ≤2。
// 信息量守恒：合并列表保留 名字/生死/官职/派系/地点/实体 id。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const sandbox = { window: {}, console, Date, Math, JSON, Object, Array, String, Number, isFinite, parseInt, parseFloat };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

[
  'tm-memory-evidence-registry.js',
  'tm-context-zones.js',
  'tm-memory-context-compiler.js'
].forEach((file) => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file }));

const MCC = sandbox.TM && sandbox.TM.MemoryContextCompiler;
assert(MCC && typeof MCC.compileHits === 'function', 'MemoryContextCompiler.compileHits exported');

function hit(o) { return Object.assign({ turn: 30 }, o); }

// ── 1) hard_state 人物合并渲染 ──
const r1 = MCC.compileHits([
  hit({ id: 'hard-char-曹文诏', source: 'hard_state', type: 'hard_state', authority: 'engine_state', lane: 'L1_world_truth', safeBody: '曹文诏 alive 辽东 蓟辽总督 楚党', sourceRefs: [{ type: 'char', id: 'c11' }] }),
  hit({ id: 'hard-char-韩爌', source: 'hard_state', type: 'hard_state', authority: 'engine_state', lane: 'L1_world_truth', safeBody: '韩爌 alive 京师 兵部尚书 东林', sourceRefs: [{ type: 'char', id: 'c4' }] }),
  hit({ id: 'core-law', source: 'imperialEdict', type: 'active_law', authority: 'player_pin', lane: 'L2_active_law_commitment', safeBody: '开海禁通市舶。', sourceRefs: [{ type: 'edictTracker', id: 'e1' }] })
], { maxTokens: 2000 });

assert(r1.text.includes('<hard-state>'), 'hard_state characters should merge into <hard-state> list');
assert(r1.text.includes('曹文诏 alive 辽东 蓟辽总督 楚党·c11'), 'merged list keeps name/status/office/faction/entity id');
assert(r1.text.includes('、韩爌 alive 京师 兵部尚书 东林·c4'), 'merged list keeps second character, separated by 、');
assert(!/hard-char-曹文诏[\s\S]*?<memory/.test(r1.text), 'hard_state characters should not render as individual <memory>');
assert(r1.text.includes('<memory id="core-law"'), 'non-hard_state coreFacts still render as individual <memory>');
// sections 数据结构不变（smoke 契约依赖）
assert(r1.sections.coreFacts.some((h) => h.id === 'hard-char-曹文诏'), 'sections.coreFacts keeps original hits');

// ── 2) 冗余属性不再输出 ──
const r2 = MCC.compileHits([
  hit({ id: 'mem-a', source: 'court_record', type: 'court_resolution', authority: 'rule_validated', lane: 'L4_dialogue_evidence', safeBody: '廷议准行。', visibility: 'public' })
], {});
assert(!r2.text.includes('authority-rank='), 'redundant authority-rank attribute dropped');
assert(!r2.text.includes(' lane='), 'redundant lane attribute dropped (section tag expresses lane)');
assert(r2.text.includes('authority="rule_validated"'), 'authority attribute kept');
assert(r2.text.includes('visibility="public"'), 'non-internal visibility kept');

// ── 3) internal visibility 省略；source-refs 每侧 ≤2 ──
const r3 = MCC.compileHits([
  hit({ id: 'mem-b', source: 'npc', type: 'character_memory', authority: 'ai_extracted', safeBody: '甲与乙结怨。', visibility: 'internal',
    sourceRefs: [{ type: 'a', id: '1' }, { type: 'b', id: '2' }, { type: 'c', id: '3' }, { type: 'd', id: '4' }],
    basisRefs: [{ type: 'e', id: '5' }, { type: 'f', id: '6' }, { type: 'g', id: '7' }] })
], {});
assert(!r3.text.includes('visibility="internal"'), 'default internal visibility omitted');
assert(/source-refs="[^"]*\|[^"]*"/.test(r3.text) && !/source-refs="[^"]*\|[^"]*\|[^"]*\|/.test(r3.text), 'source-refs capped at 2');
assert(!/basis-refs="[^"]*\|[^"]*\|[^"]*\|/.test(r3.text), 'basis-refs capped at 2');

// ── 4) 合并后 tokenEstimate 显著低于逐条渲染（预算内更密）──
const manyHard = [];
for (let i = 0; i < 45; i++) {
  manyHard.push(hit({ id: 'hard-char-' + i, source: 'hard_state', type: 'hard_state', authority: 'engine_state', lane: 'L1_world_truth', safeBody: '人物' + i + ' alive 某地 某官 某党', sourceRefs: [{ type: 'char', id: 'c' + i }] }));
}
const r4 = MCC.compileHits(manyHard, { maxTokens: 2000 });
assert(r4.text.split('<hard-state>').length === 2, '45 hard_state entries collapse into one list');
assert(r4.text.indexOf('<memory ') < 0, 'no per-entry <memory> for merged hard_state');
assert(r4.tokenEstimate > 0 && r4.text.length < 2500, 'merged render stays compact: ' + r4.text.length);

console.log('smoke-memory-compact-render ok');
