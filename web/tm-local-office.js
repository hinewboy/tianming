// @ts-check
// ============================================================
// tm-local-office.js — 地方官系统（省巡抚/布政使/按察使 + 府知府）
//   P1·2026-08-12 新增（用户需求：府有实地块却无知府官职）
//   · §1 注入：运行时把地方官子树幂等注入 GM.officeTree（省→巡抚/布政使/按察使·府→知府）
//   · §2 预填：剧本已有巡抚角色（officialTitle 含巡抚+地名）自动填入对应省巡抚位
//   · §3 考绩：年度地方官考绩（税收完成率+民变+民心 → 优升劣降·写入 _annualReviewHistory）
//   · §4 治理系数：governanceModifier(regionId, kind) 供税收/民变结算接入（holder 政务能力）
//   零剧本改动·零编辑器侵入·任命/罢免/角色同步全复用现有链路（_offAppointPerson/_offDismissPerson）
//   注入幂等标记 GM._localOfficeInjected·重复渲染/读档不重复注入
// ============================================================
(function (global) {
  'use strict';

  // ── §0 工具 ──
  function _map() {
    try {
      if (typeof getMapData === 'function') return getMapData();
    } catch (_) {}
    try {
      if (global.GM && GM.mapData) return GM.mapData;
    } catch (_) {}
    return null;
  }

  // 按省/府 id 或 name 找地图区域（省）或府
  function _findRegion(map, ref) {
    if (!map || !Array.isArray(map.regions)) return null;
    for (var i = 0; i < map.regions.length; i++) {
      var r = map.regions[i];
      if (!r) continue;
      if (String(r.id) === String(ref) || r.name === ref) return r;
    }
    return null;
  }

  function _placeholder() {
    return { name: '', generated: false, placeholderId: 'ph_' + Math.random().toString(36).slice(2, 8) };
  }

  function _mkPos(name, level, ref, kind) {
    // 明制品级：巡抚正二品·布政使从二品·按察使正三品·知府正四品
    var _rank = '正四品';
    if (kind === 'xunfu') _rank = '正二品';
    else if (kind === 'buzhengshi') _rank = '从二品';
    else if (kind === 'anchashi') _rank = '正三品';
    var pos = {
      name: name,
      _localOfficePos: true,
      _localLevel: level,          // 'province' | 'prefecture'
      _localRef: ref,              // 省/府 id 或 name
      _localKind: kind,            // 'xunfu' | 'buzhengshi' | 'anchashi' | 'zhifu'
      establishedCount: 1,
      actualHolders: [_placeholder()],
      vacancyCount: 1,
      actualCount: 0,
      rank: _rank,
      salary: kind === 'zhifu' ? 24 : (kind === 'anchashi' ? 35 : 61)
    };
    return pos;
  }

  // ── §1 注入地方官子树（幂等） ──
  // 树结构：地方官 → [每省子部门：positions=[巡抚/布政使/按察使]·subs=[每府子部门：positions=[知府]]]
  // 参考明代官制（2026-08-12·用户确认）：
  //   · 13 布政使司 → 巡抚 + 左布政使 + 按察使 + 府知府（三司制）
  //   · 北直隶/南直隶 → 仅巡抚（顺天巡抚/应天巡抚·直隶六部不设布政使）+ 府知府
  //   · 辽东 → 仅巡抚（辽东巡抚·都司制无布政使）+ 府知府
  //   · 知府为地方官任命最后一级（不再向下设同知/通判/知县）
  //   · 外藩/敌国/藏区/海外 → 不注入（非明设官之地）
  var _MING_PROVINCES = ['浙江', '福建', '广西', '江西', '湖广', '河南', '山西', '陕西', '四川', '贵州', '云南', '山东', '广东'];   // 13 布政使司
  var _XUNFU_ONLY = ['北直隶', '南直隶', '辽东'];   // 两京+辽东：仅巡抚
  var _XUNFU_NAME = { '北直隶': '顺天巡抚', '南直隶': '应天巡抚', '辽东': '辽东巡抚' };   // 历史专名（匹配剧本已有角色）
  var _SKIP = ['后金', '蒙古', '喀尔喀', '察哈尔', '科尔沁', '土默特', '瓦剌', '叶尔羌', '吐鲁番', '哈萨克', '乌思藏', '朵甘思', '北海道', '九州', '四国', '本州', '吕宋', '朝鲜', '交趾', '澳门', '苦兀', '台湾', '女真', '漠南', '哈密', '亦力', '卫拉特'];

  function _ensure() {
    if (typeof GM === 'undefined' || !GM) return false;
    if (!Array.isArray(GM.officeTree)) return false;
    if (GM._localOfficeInjected) return true;
    var map = _map();
    if (!map || !Array.isArray(map.regions) || !map.regions.length) return false;

    var root = { name: '地方官', _localOfficeRoot: true, subs: [] };
    map.regions.forEach(function (r) {
      if (!r || !r.name) return;
      var nm = String(r.name);
      // ① 外藩/敌国/藏区/海外 → 不设明官
      var skip = _SKIP.some(function (k) { return nm.indexOf(k) >= 0; });
      if (skip) return;
      // ② 只认 13 布政使司 + 两京 + 辽东（其余一律不注入·避免给土司/边镇乱设巡抚）
      var isProv = _MING_PROVINCES.some(function (k) { return nm === k || nm.indexOf(k) >= 0; });   // 兼容「浙江」/「浙江布政使司」两种写法
      var isXunfuOnly = _XUNFU_ONLY.some(function (k) { return nm.indexOf(k) >= 0; });   // 包含匹配：辽东（明·关宁东江）→辽东
      if (!isProv && !isXunfuOnly) return;
      var hasPrefs = (r.data && Array.isArray(r.data.children) && r.data.children.length) || (Array.isArray(r.prefectures) && r.prefectures.length);
      if (!hasPrefs) return;

      var provName = nm.replace(/布政使司$/, '').replace(/府$/, '').replace(/（[^）]*）$/g, '').replace(/\([^)]*\)$/g, '');   // 辽东（明·关宁东江）→辽东·应天府→应天
      var provNode = {
        name: nm,
        _regionRef: r.id || r.name,
        _localOfficeProvince: true,
        positions: [],
        subs: []
      };
      // 省级职位（明制）：巡抚必设·用历史专名（顺天/应天/辽东巡抚·匹配剧本已有角色）
      var xunfuName = _XUNFU_NAME[provName] || _XUNFU_NAME[nm] || (provName + '巡抚');
      provNode.positions.push(_mkPos(xunfuName, 'province', r.id || r.name, 'xunfu'));
      // 布政使/按察使仅 13 布政使司（两京直隶六部·辽东都司制·均不设）
      if (isProv) {
        provNode.positions.push(_mkPos(provName + '左布政使', 'province', r.id || r.name, 'buzhengshi'));
        provNode.positions.push(_mkPos(provName + '按察使', 'province', r.id || r.name, 'anchashi'));
      }
      // 府级：children 即府级数据（数据层级保证从属关系·不会挂错省）
      var prefs = (r.data && Array.isArray(r.data.children)) ? r.data.children : (r.prefectures || []);
      prefs.forEach(function (p) {
        if (!p || !p.name) return;
        provNode.subs.push({
          name: p.name,
          _prefRef: p.id || p.name,
          _localOfficePref: true,
          positions: [_mkPos(p.name + '知府', 'prefecture', p.id || p.name, 'zhifu')]
        });
      });
      root.subs.push(provNode);
    });

    if (!root.subs.length) return false;
    GM.officeTree.push(root);
    GM._localOfficeInjected = true;
    return true;
  }

  // ── §2 预填剧本已有巡抚/布政使角色到对应省职位 ──
  function _seedExisting() {
    if (typeof GM === 'undefined' || !GM || !Array.isArray(GM.chars)) return 0;
    if (GM._localOfficeSeeded) return 0;
    GM._localOfficeSeeded = true;
    var filled = 0;
    if (typeof global._offAppointPerson !== 'function') return 0;
    // 遍历地方官职位·按省名匹配角色 officialTitle（如「应天巡抚」匹配省名含应天 或 官职名 == 职位名）
    (GM.officeTree || []).forEach(function (dept) {
      if (!dept || !dept._localOfficeRoot || !Array.isArray(dept.subs)) return;
      dept.subs.forEach(function (prov) {
        if (!prov) return;
        var allPos = [];
        (prov.positions || []).forEach(function (p) { if (p) allPos.push(p); });
        (prov.subs || []).forEach(function (pref) {
          if (!pref) return;
          (pref.positions || []).forEach(function (p) { if (p) allPos.push(p); });
        });
        allPos.forEach(function (pos) {
          if (!pos || !pos._localOfficePos) return;
          var posName = pos.name || '';
          // 已有人（存档恢复）跳过
          if (Array.isArray(pos.actualHolders) && pos.actualHolders.some(function (h) { return h && h.name && h.generated !== false; })) return;
          var hit = null;
          for (var i = 0; i < GM.chars.length; i++) {
            var c = GM.chars[i];
            if (!c || c.alive === false || c.dead === true) continue;
            var t = String(c.officialTitle || c.title || '');
            // 职位名整体匹配（如 职位"浙江巡抚" == 角色 officialTitle 含"浙江巡抚"）
            if (t.indexOf(posName) >= 0) { hit = c; break; }
            // 兜底：职位名去"巡抚/布政使/按察使"后缀后与角色 title 地名段匹配（防兼衔「应天巡抚·都察院右副都御史」）
            if (posName.length > 2 && t.indexOf(posName.substring(0, posName.length - 2)) >= 0 &&
                /巡抚|布政使|按察使/.test(posName) && /巡抚|布政使|按察使/.test(t)) { hit = c; break; }
          }
          if (hit) {
            try { global._offAppointPerson(pos, hit.name); filled++; } catch (_) {}
          }
        });
      });
    });
    return filled;
  }

  // ── 遍历所有地方官职位（省+府）·回调 (pos, provNode, prefNode|null) ──
  function _walkLocalPositions(fn) {
    if (typeof GM === 'undefined' || !GM || !Array.isArray(GM.officeTree)) return;
    (GM.officeTree || []).forEach(function (dept) {
      if (!dept || !dept._localOfficeRoot || !Array.isArray(dept.subs)) return;
      dept.subs.forEach(function (prov) {
        if (!prov) return;
        (prov.positions || []).forEach(function (pos) { if (pos && pos._localOfficePos) fn(pos, prov, null); });
        (prov.subs || []).forEach(function (pref) {
          if (!pref) return;
          (pref.positions || []).forEach(function (pos) { if (pos && pos._localOfficePos) fn(pos, prov, pref); });
        });
      });
    });
  }

  // ── 辖区数据（省/府）·供考绩与治理系数 ──
  function _jurisdictionData(pos) {
    var map = _map();
    if (!map) return null;
    if (pos._localLevel === 'prefecture') {
      // 府：找所在省 region + 府数据
      for (var i = 0; i < (map.regions || []).length; i++) {
        var r = map.regions[i];
        if (!r) continue;
        var prefs = (r.data && r.data.children) || r.prefectures || [];
        for (var j = 0; j < prefs.length; j++) {
          var p = prefs[j];
          if (p && (String(p.id) === String(pos._localRef) || p.name === pos._localRef)) {
            return { kind: 'prefecture', region: r, pref: p };
          }
        }
      }
      return null;
    }
    var reg = _findRegion(map, pos._localRef);
    return reg ? { kind: 'province', region: reg } : null;
  }

  // ── 辖区治理数据（税收完成率/民变/民心）·缺省给中性值 ──
  function _jurisdictionMetrics(jd) {
    if (!jd) return null;
    var m = { taxCompliance: 0.5, revolts: 0, minxin: 50 };
    try {
      var reg = jd.region || {};
      var data = reg.data || {};
      var fiscal = (reg.vitals && reg.vitals.fiscal) || data.fiscalBase || {};
      if (typeof fiscal.compliance === 'number') m.taxCompliance = fiscal.compliance;
      else if (typeof fiscal.actualRevenue === 'number' && typeof fiscal.theoreticalRevenue === 'number' && fiscal.theoreticalRevenue > 0) {
        m.taxCompliance = Math.max(0, Math.min(1.5, fiscal.actualRevenue / fiscal.theoreticalRevenue));
      }
      if (typeof data.minxinLocal === 'number') m.minxin = data.minxinLocal;
      else if (typeof data.population === 'number') m.minxin = 50;
      // 民变：全局民变表中该辖区命中的起数
      try {
        if (GM && GM.minxin && Array.isArray(GM.minxin.revolts)) {
          GM.minxin.revolts.forEach(function (rv) {
            if (!rv) return;
            if (rv.region && (rv.region === reg.name || rv.region === reg.id)) m.revolts++;
            else if (jd.kind === 'prefecture' && rv.region && rv.region === (jd.pref ? jd.pref.name : '')) m.revolts++;
          });
        }
      } catch (_) {}
    } catch (_) {}
    return m;
  }

  // ── 职位 holder 角色对象（在任者） ──
  function _holderChar(pos) {
    if (typeof GM === 'undefined' || !GM || !Array.isArray(GM.chars)) return null;
    var named = null;
    (pos.actualHolders || []).forEach(function (h) {
      if (h && h.name && h.generated !== false && !named) named = h.name;
    });
    if (!named) return null;
    for (var i = 0; i < GM.chars.length; i++) {
      var c = GM.chars[i];
      if (c && c.name === named) return c;
    }
    return null;
  }

  // 治理能力分（0-100）：administration 为主·辅以 intelligence
  function _govAbility(c) {
    if (!c) return 50;
    var a = Number(c.administration);
    if (!isFinite(a) || a <= 0) a = 50;
    var iq = Number(c.intelligence);
    if (!isFinite(iq) || iq <= 0) iq = 50;
    return Math.max(5, Math.min(100, a * 0.75 + iq * 0.25));
  }

  // ── §3 年度考绩（SettlementPipeline 注册·每年触发） ──
  function _annualReview() {
    if (typeof GM === 'undefined' || !GM) return;
    var yr = (typeof turnsForDuration === 'function') ? (turnsForDuration('year') || 12) : 12;
    if (!GM.turn || GM.turn % yr !== 0) return;
    var excellent = [], poor = [];
    var CE = (typeof CharEconEngine !== 'undefined' && CharEconEngine.adjustVirtueMerit) ? CharEconEngine : null;
    var SCALE = (typeof TMPromotion !== 'undefined' && TMPromotion.SCALE) || 15;
    _walkLocalPositions(function (pos) {
      var c = _holderChar(pos);
      if (!c) return;
      var jd = _jurisdictionData(pos);
      var met = _jurisdictionMetrics(jd);
      var score = 50;
      if (met) {
        // 税收完成率 45% + 无民变 30% + 民心 25%
        var taxPart = Math.max(0, Math.min(1.5, met.taxCompliance)) * 45;
        var revoltPart = met.revolts === 0 ? 30 : Math.max(0, 30 - met.revolts * 12);
        var minxinPart = Math.max(0, Math.min(100, met.minxin)) * 0.25;
        score = Math.round(taxPart + revoltPart + minxinPart);
      }
      // 能力加成（治理表现含个人能力）
      score = Math.round(score * 0.75 + _govAbility(c) * 0.25);
      var grade = score >= 80 ? '优' : (score < 50 ? '劣' : '平');
      var posName = pos.name || '';
      if (grade === '优') {
        c._reviewGoodStreak = (c._reviewGoodStreak || 0) + 1;
        c._reviewPoorStreak = 0;
        excellent.push(posName);
        if (CE && (c._reviewGoodStreak || 0) >= 2) CE.adjustVirtueMerit(c, Math.round(6 * SCALE), '地方考绩优等·擢赏');
      } else if (grade === '劣') {
        c._reviewPoorStreak = (c._reviewPoorStreak || 0) + 1;
        c._reviewGoodStreak = 0;
        poor.push(posName);
        if (CE && (c._reviewPoorStreak || 0) >= 2) CE.adjustVirtueMerit(c, -Math.round(5 * SCALE), '地方考绩劣等·罚俸');
      }
      if (!c._localReviewHistory) c._localReviewHistory = [];
      c._localReviewHistory.push({ turn: GM.turn, pos: posName, score: score, grade: grade });
      if (c._localReviewHistory.length > 12) c._localReviewHistory.shift();
    });
    if (excellent.length || poor.length) {
      if (!GM._annualReviewHistory) GM._annualReviewHistory = [];
      GM._annualReviewHistory.push({
        turn: GM.turn || 0, excellent: excellent.length, poor: poor.length,
        promotions: excellent.slice(0, 5), demotions: poor.slice(0, 5), scope: '地方官'
      });
      if (typeof addEB === 'function') {
        var _seg = [];
        if (excellent.length) _seg.push('优等 ' + excellent.slice(0, 5).join('、'));
        if (poor.length) _seg.push('劣等 ' + poor.slice(0, 5).join('、'));
        addEB('官制', '地方官考绩·' + _seg.join('；'));
      }
    }
  }

  // ── §4 治理系数：税收/民变结算接入（确定性 modifier·不依赖 AI） ──
  // kind: 'tax'（税收完成率 ±） | 'revolt'（民变风险 ↓）
  // 返回 0.85~1.15（tax）/ 0.7~1.0（revolt·低=风险更低）
  function _governanceModifier(ref, kind, level) {
    var map = _map();
    if (!map) return 1;
    var pos = null;
    _walkLocalPositions(function (p) {
      if (pos) return;
      if (String(p._localRef) === String(ref) && (!level || p._localLevel === level)) pos = p;
    });
    if (!pos) return 1;
    var c = _holderChar(pos);
    if (!c) return 1;
    var ab = _govAbility(c);   // 5-100
    if (kind === 'revolt') {
      // 能力高 → 民变风险低：0.7 ~ 1.0
      return Math.max(0.7, Math.min(1.0, 1.0 - (ab - 50) / 170));
    }
    // tax：能力高 → 完成率高：0.85 ~ 1.15
    return Math.max(0.85, Math.min(1.15, 1.0 + (ab - 50) / 340));
  }

  // 兼容：按省名直接找该省巡抚治理系数（AI prompt/面板用）
  function _provinceGovernorInfo(provName) {
    var out = null;
    _walkLocalPositions(function (pos) {
      if (out || pos._localLevel !== 'province' || pos._localKind !== 'xunfu') return;
      var prov = pos.name.replace(/(巡抚|布政使|按察使)$/, '');
      if (provName.indexOf(prov) >= 0 || prov.indexOf(provName) >= 0) {
        var c = _holderChar(pos);
        out = { posName: pos.name, holder: c ? c.name : '', vacant: !c, ability: c ? Math.round(_govAbility(c)) : null };
      }
    });
    return out;
  }

  // 面板/地图兜底：按辖区 ref + 级别找地方官职（省→巡抚·府→知府）·返回 {posName, holder, vacant, ability}
  function _localGovernorFor(ref, level) {
    var hit = null;
    _walkLocalPositions(function (pos) {
      if (hit) return;
      var wantLevel = (level === 'prefecture') ? 'prefecture' : 'province';
      if (pos._localLevel !== wantLevel) return;
      var _ref = String(ref);
      if (_ref.indexOf('pref-') === 0) _ref = _ref.substring(5);   // 府面板 adminBinding 带 pref- 前缀
      if (String(pos._localRef) !== _ref) return;
      // 省取巡抚·府取知府
      if (wantLevel === 'province' && pos._localKind !== 'xunfu') return;
      if (wantLevel === 'prefecture' && pos._localKind !== 'zhifu') return;
      var c = _holderChar(pos);
      hit = { posName: pos.name, holder: c ? c.name : '', vacant: !c, ability: c ? Math.round(_govAbility(c)) : null, kind: pos._localKind };
    });
    return hit;
  }

  var api = {
    ensure: _ensure,
    seedExisting: _seedExisting,
    walkLocalPositions: _walkLocalPositions,
    jurisdictionData: _jurisdictionData,
    jurisdictionMetrics: _jurisdictionMetrics,
    holderChar: _holderChar,
    govAbility: _govAbility,
    governanceModifier: _governanceModifier,
    provinceGovernorInfo: _provinceGovernorInfo,
    localGovernorFor: _localGovernorFor
  };
  if (typeof global !== 'undefined') global.TMLocalOffice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // 结算注册：地方官考绩（perturn·在 office_mourning(45) 前·考绩供京察消费）
  if (global.SettlementPipeline && typeof global.SettlementPipeline.register === 'function') {
    global.SettlementPipeline.register('localOfficeReview', '地方官考绩', function () { _annualReview(); }, 44, 'perturn');
  }

  // ── 触发注入：渲染官职树前 ensure+seed（包装 renderOfficeTree·加载先后都覆盖） ──
  function _wrapRender() {
    if (global.renderOfficeTree && !global.renderOfficeTree._localOfficeWrapped) {
      var _orig = global.renderOfficeTree;
      var _wrapped = function (force) {
        try { _ensure(); _seedExisting(); } catch (_) {}
        return _orig.apply(this, arguments);
      };
      _wrapped._localOfficeWrapped = true;
      global.renderOfficeTree = _wrapped;
    }
  }
  _wrapRender();
  if (global.addEventListener) global.addEventListener('load', _wrapRender);
  // 回合结算早期兜底（新开/读档/恢复都覆盖）
  if (global.SettlementPipeline && typeof global.SettlementPipeline.register === 'function') {
    global.SettlementPipeline.register('localOfficeEnsure', '地方官注入', function () { _ensure(); _seedExisting(); }, 5, 'perturn');
  }
})(typeof window !== 'undefined' ? window : globalThis);
