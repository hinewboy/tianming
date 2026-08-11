#!/usr/bin/env node
'use strict';
// T1379 守护：朝会议政发言收敛（群臣啰嗦修复）
// ① cy 字数额默认 [60,120]（原 [120,250]·concise 档实际 [36,72]）——奏对短句犀利
// ② 发言硬截断 150 字（流式 onChunk + 最终 line + salvage 三处）——AI 不遵守字数时的保险丝
// ③ 流式发言 15s 超时兜底——AI 卡住不再无限等 '…' 空泡
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── 1) cy 字数额默认收敛 ──
const detect = fs.readFileSync(path.join(ROOT, 'tm-ai-infra-model-detect.js'), 'utf8');
const m = detect.match(/cy:\s*\[(\d+),\s*(\d+)\]/);
assert(m, 'cy char-range entry exists');
assert(Number(m[2]) <= 120, `cy 档上限收敛到 ≤120 (实际 ${m[2]})——防群臣长篇大论`);
assert(Number(m[1]) >= 30, `cy 档下限合理 (实际 ${m[1]})——防发言过短无内容`);

// ── 2) 发言硬截断 150（流式 + 最终 + salvage 三处）──
const adapter = fs.readFileSync(path.join(ROOT, 'tm-chaoyi-changchao-adapter.js'), 'utf8');
const capCount = (adapter.match(/slice\(0, 150\)/g) || []).length;
assert(capCount >= 3, `发言硬截断 150 字至少 3 处 (流式/最终/salvage·实际 ${capCount})`);
assert(adapter.includes('onChunk(lineSoFar.slice(0, 150))'), '流式 onChunk 截断 150');
assert(adapter.includes('line: obj.line.trim().slice(0, 150)'), '最终 line 截断 150');
assert(adapter.includes('line: ln.slice(0, 150)'), 'salvage 截断 150');

// ── 3) 15s 超时兜底 ──
assert(adapter.includes('Promise.race'), '流式发言走 Promise.race 超时竞速');
assert(adapter.includes('15000'), '超时阈值 15s');

console.log('smoke-chaoyi-speech-concision ok');
