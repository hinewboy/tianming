'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, makeAssert } = require('./smoke-endturn-baseline-helpers');

const passed = { value: 0 };
const assert = makeAssert(passed);

const validityPath = path.join(ROOT, 'tm-endturn-validity.js');
const stepsPath = path.join(ROOT, 'tm-endturn-pipeline-steps.js');
const indexPath = path.join(ROOT, 'index.html');

assert(fs.existsSync(validityPath), 'tm-endturn-validity.js exists');

const validitySrc = fs.readFileSync(validityPath, 'utf8');
const stepsSrc = fs.readFileSync(stepsPath, 'utf8');
const indexSrc = fs.readFileSync(indexPath, 'utf8');

assert(/TM\.Endturn\.Validity/.test(validitySrc), 'TM.Endturn.Validity namespace exists');
assert(/validateBeforeCommit\s*[:=]\s*function/.test(validitySrc), 'validateBeforeCommit exported');
assert(/EndturnInvalidResultError/.test(validitySrc), 'invalid result error type exported or named');
assert(/status\s*:\s*['"]ok['"]/.test(validitySrc) && /status\s*:\s*['"]failed['"]/.test(validitySrc), 'validity returns ok/failed statuses');
assert(/sc1/.test(validitySrc) && /shizhengji/.test(validitySrc) && /zhengwen/.test(validitySrc), 'validity checks critical structured and narrative fields');

const loadValidity = indexSrc.indexOf('tm-endturn-validity.js');
const loadSteps = indexSrc.indexOf('tm-endturn-pipeline-steps.js');
assert(loadValidity >= 0 && loadValidity < loadSteps, 'validity module loads before pipeline steps');

const validateCall = stepsSrc.indexOf('TM.Endturn.Validity.validateBeforeCommit');
const systemsStep = stepsSrc.indexOf("name: 'systems'");
assert(validateCall >= 0, 'pipeline calls validateBeforeCommit');
assert(systemsStep >= 0 && validateCall < systemsStep, 'validity gate runs before systems step');
assert(/\._lastEndturnValidity/.test(stepsSrc), 'pipeline stores last endturn validity diagnostics');
// T1388: validity failed → 不再 abort·自动降级(合成账本)推进回合(治无限轮回第1回合)
assert(/T1388\(2026-08-11\)·不再 abort——自动 emergency 降级/.test(stepsSrc), 'validity failed → 降级推进(不 abort)');
assert(/GM\._endTurnFallbackCount = _fbCount \+ 1/.test(stepsSrc), '降级计数(GM._endTurnFallbackCount)');
assert(/本回合 AI 推演降级/.test(stepsSrc), '降级提示(非失败)');
assert(/如果仍失败·极端场景才 abort/.test(stepsSrc) || /极端场景才 abort/.test(stepsSrc), '极端场景(降级也失败)才 throw');

console.log('[smoke-endturn-validity-gate] pass assertions=' + passed.value);
