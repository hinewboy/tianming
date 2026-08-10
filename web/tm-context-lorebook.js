// ============================================================
//  tm-context-lorebook.js — 本地故事速览（README 式快速前后文）
//
//  仿程序开发 README/CLAUDE.md 机制：AI 每回合不必重读全量历史全文，
//  而是读一份由本地维护的「故事速览」——每回合把时政记确定性压缩成
//  一行摘要（不调 AI·零成本），历史速览随回合滚动压缩。
//  注入点：sc05 深度回顾（近端回合全文从 5 回合收窄为 2 回合 +
//  速览补齐中远端）→ 输入 tokens 大降且故事连续性不丢。
//
//  数据：GM._loreBook = { history: [{turn, t, brief}] }（随档自动保存）
//  挂接：史记生成处 appendTurn（每回合一条）
// ============================================================
(function (global) {
  'use strict';
  if (typeof window === 'undefined' && typeof globalThis === 'undefined') return;
  var TM = global.TM = global.TM || {};
  var MAX_TURNS = 30;          // 速览上限 30 条·超出两两合并压缩
  var BRIEF_LEN = 100;         // 单回合摘要长度（字符）

  function ensure(gm) {
    if (!gm) return null;
    if (!gm._loreBook) gm._loreBook = { history: [] };
    return gm._loreBook;
  }

  // 回合结束维护：shizhengji 确定性压缩成摘要追加（不调 AI）
  function appendTurn(gm, sh) {
    var lb = ensure(gm);
    if (!lb || !sh) return;
    var txt = String(sh.shizhengji || '').trim();
    if (!txt) return;
    var brief = txt.length > BRIEF_LEN ? txt.slice(0, BRIEF_LEN) + '…' : txt;
    lb.history.push({ turn: sh.turn, t: sh.time || '', brief: brief });
    if (lb.history.length > MAX_TURNS) {
      var merged = [];
      for (var i = 0; i < lb.history.length; i += 2) {
        var a = lb.history[i], b = lb.history[i + 1];
        merged.push(b
          ? { turn: String(a.turn) + '-' + String(b.turn), t: a.t, brief: a.brief.slice(0, 60) + '；' + b.brief.slice(0, 60) }
          : a);
      }
      lb.history = merged;
      if (lb.history.length > MAX_TURNS) lb.history = lb.history.slice(-MAX_TURNS);
    }
  }

  // 组装注入文本（速览全文·紧凑）
  function renderHistory(gm) {
    var lb = ensure(gm);
    if (!lb || !lb.history.length) return '';
    var out = '\n【故事速览·本地档案（快速前后文·非全文）】\n';
    for (var i = 0; i < lb.history.length; i++) {
      var h = lb.history[i];
      out += '· T' + h.turn + (h.t ? ' ' + h.t : '') + ' ' + h.brief + '\n';
    }
    return out;
  }

  TM.ContextLoreBook = {
    ensure: ensure,
    appendTurn: appendTurn,
    renderHistory: renderHistory,
    MAX_TURNS: MAX_TURNS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = TM.ContextLoreBook;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
