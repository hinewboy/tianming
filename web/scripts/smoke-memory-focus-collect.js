#!/usr/bin/env node
'use strict';
// T1378 守护：焦点驱动收集（战争迷雾 + RimWorld 有界记忆槽 + 两级注意力）
// ① 传 focusTerms 时收集显著减少；hard_state/active_law 全量保留；近1回合+每type保底1 防滤空
// ② rollup(historiography_summary) 提取到 <global-attention> 顶部层（零新增计算·数据已增量维护）
// ③ 每条 <memory> 带显式注意力权重 weight（soft attention 提示）
// ④ focusTerms 空 = 全量（零回归）
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
  'tm-memory-envelope.js',
  'tm-memory-governance.js',
  'tm-memory-retrieval.js',
  'tm-memory-context-compiler.js'
].forEach((file) => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file }));

const ME = sandbox.TM.MemoryEnvelope;
const MCC = sandbox.TM.MemoryContextCompiler;
assert(ME && typeof ME.collect === 'function', 'MemoryEnvelope.collect exported');
assert(MCC && typeof MCC.compileFromGM === 'function', 'compileFromGM exported');

// ── 构造 GM：20 人物硬状态 + 聚焦"袁崇焕"的诏令 + 大量背景记忆 ──
const NAMES = ['魏忠贤', '杨涟', '袁崇焕', '孙承宗', '韩爌', '高攀龙', '左光斗', '熊廷弼', '洪承畴', '卢象升'];
const GM = {
  turn: 30, worldId: 'w', saveId: 's',
  chars: NAMES.map((n, i) => ({ id: 'c' + i, name: n, alive: true, officialTitle: '某官', faction: '某党', location: '某地' })),
  activeEdicts: [
    { id: 'e-focus', turn: 28, status: 'active', name: '命袁崇焕督师', category: '军务', content: '敕袁崇焕督理辽东军务，便宜行事。', assignee: '袁崇焕' }
  ],
  jishiRecords: Array.from({ length: 30 }, (_, i) => ({
    id: 'j' + i, turn: Math.floor(i / 2) + 1,
    text: (i % 5 === 0 ? '袁崇焕在辽东' : (NAMES[i % NAMES.length] + '于' + ['陕西', '河南', '山东'][i % 3])) + '事：' + ['募兵', '赈灾', '议饷', '筑城', '审案'][i % 5] + '。'
  })),
  _courtRecords: Array.from({ length: 20 }, (_, i) => ({
    id: 'crt' + i, turn: Math.floor(i / 2) + 1, topic: '边饷', decision: '廷议：' + (i % 4 === 0 ? '袁崇焕' : NAMES[i % NAMES.length]) + '所请' + (i % 4 === 0 ? '辽东' : '某省') + '钱粮事。', sourceType: 'jishiRecords', sourceId: 'j' + i
  })),
  _npcRelationEvents: Array.from({ length: 20 }, (_, i) => ({
    id: 'rel' + i, turn: Math.floor(i / 2) + 1, actor: NAMES[i % NAMES.length], target: NAMES[(i + 3) % NAMES.length], kind: 'trust', text: NAMES[i % NAMES.length] + '与' + NAMES[(i + 3) % NAMES.length] + '交好。'
  })),
  _memoryAccepted: Array.from({ length: 15 }, (_, i) => ({
    id: 'mem' + i, type: 'relationship_fact', body: (i % 3 === 0 ? '袁崇焕' : NAMES[i % NAMES.length]) + '私下结盟。', safeBody: (i % 3 === 0 ? '袁崇焕' : NAMES[i % NAMES.length]) + '私下结盟。', authority: 'ai_extracted', visibility: 'player_known', readScope: 'player', turn: Math.floor(i / 2) + 1
  }))
};

// ── ① 焦点收集：全量 vs 焦点 ──
const full = ME.collect(GM, { turn: 30 }).length;
const focused = ME.collect(GM, { turn: 30, focusTerms: ['袁崇焕'] }).length;
assert(full > focused, `焦点收集应减少: 全量 ${full} vs 焦点 ${focused}`);
assert(focused < full * 0.8, `焦点收集至少砍 20%: ${full} → ${focused}`);

// ── ② hard_state 全量保留 ──
const focusedEnvs = ME.collect(GM, { turn: 30, focusTerms: ['袁崇焕'] });
const hardN = focusedEnvs.filter((e) => e.type === 'hard_state').length;
assert(hardN === NAMES.length, `hard_state 全量保留: ${hardN}/${NAMES.length}`);

// ── ③ 零回归：focusTerms 空/缺省 = 全量 ──
assert(ME.collect(GM, { turn: 30, focusTerms: [] }).length === full, 'focusTerms 空数组 = 全量');
assert(ME.collect(GM, { turn: 30 }).length === full, '不传 focusTerms = 全量');

// ── ④ compileFromGM：global-attention + weight ──
const compiled = MCC.compileFromGM(GM, { turn: 30, audience: 'system', actorScope: 'system', intent: 'turn_inference', maxTokens: 1800 });
assert(compiled.text.includes('weight="'), '每条 memory 带显式注意力权重 weight');
assert(/<memory [^>]*weight="\d+"/.test(compiled.text), 'weight 是数字');
assert(compiled.text.includes('袁崇焕'), '焦点实体记忆注入');
assert(compiled.hits.length < full, `compileFromGM 注入量小于全量: ${compiled.hits.length} < ${full}`);

// ── ⑤ 有 rollup 时进 global-attention 顶部层 ──
const GM2 = JSON.parse(JSON.stringify(GM));
GM2._memoryEraRollups = [{
  id: 'era-1', type: 'historiography_summary', body: '编年大略 天启元年–天启四年：辽东军情告急。', authority: 'structured_chronicle',
  factStatus: 'historiography_summary', turn: 20, visibility: 'internal', lane: 'L7_chronicle_context',
  sourceRefs: [{ type: 'memoryEraRollup', id: 'era-1' }]
}];
const c2 = MCC.compileFromGM(GM2, { turn: 30, audience: 'system', actorScope: 'system', intent: 'turn_inference', maxTokens: 1800 });
const gaIdx = c2.text.indexOf('<global-attention');
const coreIdx = c2.text.indexOf('<core-facts');
assert(gaIdx >= 0, 'global-attention 层存在');
assert(coreIdx < 0 || gaIdx < coreIdx, 'global-attention 先于 core-facts（顶部层）');

console.log('smoke-memory-focus-collect ok');
