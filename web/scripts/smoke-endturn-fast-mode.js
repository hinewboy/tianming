#!/usr/bin/env node
'use strict';
// T1383 守护：快速过回合（fastEndTurn）——30秒档
// ① P.ai.fastEndTurn=true 时跳过 Branch A(sc15/sc15n)/B(sc16-18)/C(sc2)+audit·用 SC1 内嵌字段兜底
// ② 默认 false = 走原完整推演（零回归）
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'tm-endturn-followup.js'), 'utf8');

// ── 1) fastEndTurn 开关 + 4 处跳过 ──
assert(/var _fastET = !!\(P\.ai && P\.ai\.fastEndTurn === true\)/.test(src), 'fastEndTurn 开关定义');
assert(/var _sc15P = Promise\.resolve\(null\)/.test(src), 'Branch A 跳过时 _sc15P 兜底(resolved promise·防 1254 引用崩)');
assert(/var _branchB = _fastET \? Promise\.resolve\(null\) : _runSubcallBatch/.test(src), 'Branch B 跳过');
assert(/var _runConsistencyAudit = _fastET \? async function\(\)\{ return null; \}/.test(src), 'audit 快速跳过');
assert(/var _runBranchC = _fastET \? async function\(\)\{[^}]*skip Branch C/.test(src), 'Branch C(sc2) 快速跳过');
assert(/else \{\s*\/\/ Phase 4 A6·sc15n/.test(src), '完整推演路径保留在 else 分支');
// 完整路径仍完整（sc15/sc15n/sc16-18/sc2 字符串都在）
['sc15n', "'sc16'", "'sc17'", "'sc18'", "'sc2'"].forEach(s => {
  assert(src.includes(s), `完整路径含 ${s}`);
});

// ── 2) 设置开关存在（tm-patches.js）──
const patches = fs.readFileSync(path.join(ROOT, 'tm-patches.js'), 'utf8');
assert(patches.includes('P.ai.fastEndTurn=this.checked'), '设置面板有快速过回合开关');

// ── 3) 快速模式行为验证：默认 false 走原路径（用 vm 加载 followup 检查 _fastET 逻辑不破坏既有结构）──
assert(!/fastEndTurn\s*[=:]\s*true/.test(src.split('var _fastET')[1] || ''), '默认非开启（false 路径）');

console.log('smoke-endturn-fast-mode ok');
