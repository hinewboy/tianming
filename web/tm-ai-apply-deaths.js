// @ts-check
/// <reference path="types.d.ts" />
// ============================================================
// tm-ai-apply-deaths.js — AI 角色死亡应用器（§D 首个真重构抽出）
//
// R100 从 tm-endturn.js _endTurn_aiInfer 内部抽出·原 L7446-7665 (220 行)
// 处理 AI 返回的 character_deaths 字段·涉及：
//   ch.alive/dead/deathTurn/deathReason 标记
//   官制同步 (_offDismissPerson)
//   相关角色记忆 (NpcMemorySystem)
//   家族影响 (updateFamilyRenown + 族人记忆)
//   军队统帅级联 (commander 清空+士气降)
//   丁忧制度 (子女守丧+currentIssues 夺情选项)
//   势力首领级联 (leader 清空+封臣忠诚下降+世袭继承)
//   头衔继承
//   玩家角色死亡特判 (_playerDead 标记)
//
// 关键：是**首次从 tm-endturn.js 内部异步函数抽 helper**·不同于 R88-R99 搬顶级函数
//      调用方从内联 if-block 改为 applyCharacterDeaths(p1) 单句调用
//
// 所有依赖均 window 全局：findCharByName/_fuzzyFindChar/recordCharacterArc/
//   PostTransfer/_offDismissPerson/NpcMemorySystem/addEB/GameEventBus/
//   updateFamilyRenown/getTSText·闭包访问 GM/P
//
// 加载顺序：必须在 tm-endturn.js 之前
// ============================================================

// ★2026-08-12 死亡合理性闸(治「官员压力过大而死泛滥·无官可用」·用户实机反馈):
//   根因:AI 每回合自由判 character_deaths·prompt 无数量/合理性约束·「压力过大」成随手死因。
//   规则(保守·只拦明显不合理):
//   a) 硬性死因(战死/赐死/处决/瘟疫/意外/自尽/谋逆伏诛)直放·不占预算;
//   b) 每回合「自然死亡」预算 cap(默认3)·超出者降级致仕;
//   c) reason 纯「压力/忧愤/郁」类且无 病/老 叠加 → 不判死·降级致仕(记 _stressRetired);
//   d) 现任要员(尚书/侍郎/都御史/巡抚/总督/督师/阁臣等) 非硬性死因 → 不死·降级致仕;
//   e) 青壮(<45)无明确病由(病/疫/战/赐/斩/诛) → 不死·降级致仕(防随手判死新科官员)。
function _deathGuard(cd) {
  var r = String((cd && cd.reason) || '');
  var ch = null;
  try { ch = (typeof _fuzzyFindChar === 'function' ? _fuzzyFindChar(cd.name) : null) || findCharByName(cd.name); } catch (_dG) {}
  if (!ch) return { allow: true };
  // ★玩家(皇帝)死亡策略(2026-08-12 用户定调「皇帝可以死·但游戏要继续」):
  //   明确死因(战败/被弑/赐死/寿终/病故/年高/瘟疫)一律放行 → 走继统裁决器(有嗣继位/无嗣宗室入继·游戏继续);
  //   仅「压力过大/忧愤」等无厘头随手死因拦下(不改任何状态·皇帝压力只影响叙事不致死)。
  if (ch.isPlayer || (typeof P !== 'undefined' && P && P.playerInfo && P.playerInfo.characterName === ch.name)) {
    if (/战|阵亡|阵殁|战殁|殉国|殉城|殉职|赐死|鸩|自尽|自裁|自缢|处决|处死|斩|诛|凌迟|腰斩|弃市|绞|谋逆|伏诛|遇害|遭难|攻破|寿终|年高|老|薨逝|溘逝|病逝|病故|病殁|疾|疫|瘟疫|伤寒|天花|execute|execution|暴毙|暴卒|暴亡|猝死|猝亡/.test(r)) return { allow: true };
    return { allow: false, ignore: true };   // 压力/忧愤等无厘头死因拦下·不改任何状态
  }
  // a) 硬性死因直放(含 onDismissal 映射的 execute·及暴毙/猝死/明正典刑等合理死因)
  if (/战|阵亡|阵殁|战殁|殉国|死事|殉城|殉职|赐死|赐自尽|鸩|自尽|自裁|自缢|服毒|处决|处死|斩|诛|凌迟|腰斩|弃市|绞|瘟疫|天花|伤寒|疫病|溺|坠马|焚|雷击|谋逆|伏诛|遇害|遭难|攻破|炮|箭|execute|execution|暴毙|暴卒|暴亡|猝死|猝亡|明正典刑|正法|典刑/.test(r)) return { allow: true };
  // b) 自然死亡预算
  var _budget = 3;
  var _turn = (typeof GM !== 'undefined' && GM) ? GM.turn : 0;
  if (!GM._natDeathTurn) GM._natDeathTurn = _turn;
  if (GM._natDeathTurn !== _turn) { GM._natDeathTurn = _turn; GM._natDeathBudget = _budget; }
  if (GM._natDeathBudget == null) GM._natDeathBudget = _budget;
  // c) 纯压力/忧愤 无 病/老 → 降级致仕
  if (/压力|忧愤|郁愤|愁|恚|抑郁|心力交瘁|操劳|积劳/.test(r) && !/病|疾|老|年高|寿/.test(r)) return { allow: false, demote: '告病致仕' };
  // d) 现任要员保护(仅拦「无厘头/无明确病由」死因·真实病故/战死/赐死等明确死因放行——杨涟都御史病故照常落死)
  var _high = ch.officialTitle && /尚书|侍郎|都御史|御史大夫|巡抚|总督|督师|经略|阁臣|首辅|大学士|按察使|布政使/.test(ch.officialTitle);
  if (_high && (ch.age || 0) < 60 && !/病|疾|疫|老|战|赐|斩|诛|execute|execution|暴|猝|死事|殉|狱/.test(r)) return { allow: false, demote: '告病致仕' };
  // e) 青壮无明确病由
  if ((ch.age || 0) < 45 && !/病|疾|疫|老/.test(r)) return { allow: false, demote: '告病致仕' };
  // 高龄放行
  if ((ch.age || 0) >= 60) return { allow: true };
  // 默认:预算内放行·超预算降级
  if (GM._natDeathBudget <= 0) return { allow: false, demote: '告病致仕' };
  GM._natDeathBudget--;
  return { allow: true };
}

// 降级:把不合理的死亡转成「告病致仕」·不占死亡数·保官职人事链不断
function _demoteDeath(cd, ch, kind) {
  if (!ch) return;
  var G = (typeof GM !== 'undefined' && GM) ? GM : null;
  var _r = String((cd && cd.reason) || '').slice(0, 36);
  ch._retired = true;
  ch._retiredTurn = G ? G.turn : 0;
  ch._stressRetired = true;
  ch._retireReason = (kind || '告病致仕') + '（' + _r + '）';
  if (!Array.isArray(ch.careerHistory)) ch.careerHistory = [];
  ch.careerHistory.push({ turn: G ? G.turn : 0, event: (kind || '告病致仕') + '：' + _r, action: 'retire' });
  try {
    if (typeof addEB === 'function') addEB('人事', ch.name + (kind || '告病致仕') + '（' + _r + '）·未殁');
  } catch (_dE) {}
  try {
    if (typeof TM !== 'undefined' && TM.Chronicle && TM.Chronicle.record) TM.Chronicle.record({
      turn: G ? G.turn : 0, date: G ? G._gameDate : '', type: '人事', title: ch.name + (kind || '告病致仕'),
      content: ch.name + (kind || '告病致仕') + '：' + _r + '。圣意悯其劳瘁，准予归养。', category: '人事', tags: ['告病', '致仕', '人事']
    });
  } catch (_dE2) {}
  return true;
}

function applyCharacterDeaths(p1) {
        // AI 可以让角色死亡（疾病、战死、暗杀等）
        if (p1.character_deaths && Array.isArray(p1.character_deaths)) {
          p1.character_deaths.forEach(function(cd) {
            // ★2026-08-12 死亡合理性闸(批量入口):不合理死亡(压力/青壮无病由/超预算)降级致仕·玩家自然死因 ignore 拦下
            try {
              var _gd = _deathGuard(cd);
              if (!_gd.allow) {
                if (_gd.ignore) return;   // 玩家自然死因:不改任何状态·直接拦下
                var _chG = (typeof _fuzzyFindChar === 'function' ? _fuzzyFindChar(cd.name) : null) || findCharByName(cd.name);
                _demoteDeath(cd, _chG, _gd.demote || '告病致仕');
                return;
              }
            } catch (_gdE) {}
            applyOneDeath(cd);
          });
        }

}

// N2 nest-flatten: per-death cascade body extracted verbatim from applyCharacterDeaths() forEach(cd) (behavior-identical). the inline gm-write directive on the crownPrince line is carried verbatim within the body below.
function applyOneDeath(cd) {
  if (!cd.name || !cd.reason) return;
  var ch = (typeof _fuzzyFindChar === 'function' ? _fuzzyFindChar(cd.name) : null) || findCharByName(cd.name);
  if (!ch) return;
  // 唯一死亡 sink 必须幂等：同回合多个结构化入口指向同一人时，只执行一次级联/事件/声望结算。
  if (ch.alive === false || ch.dead === true) return;
  // ★2026-08-12 死亡合理性闸(直调入口·与 applyCharacterDeaths 同闸):onDismissal 死亡路由等直调路径同样受保护
  try {
    var _gd1 = _deathGuard(cd);
    if (!_gd1.allow) {
      if (_gd1.ignore) return;   // 玩家自然死因:不改任何状态·直接拦下
      _demoteDeath(cd, ch, _gd1.demote || '告病致仕'); return;
    }
  } catch (_gd1E) {}
  cd.name = ch.name || cd.name;
  ch.alive = false;
  ch.dead = true;
  ch.deathTurn = GM.turn;
  ch.deathReason = cd.reason;
  // ★2026-08-12 死因本地扩写(零 AI):依据 reason 关键词+本地数据拼「死因背景」——
  //   玩家报"官员突然去世·面板无死因"·此处把 AI 一句式死因扩成有背景的墓志式描述。
  //   仅当 reason 非空时生成(applyOneDeath 入口已挡 !reason)·存 deathContext 供面板/编年使用。
  try { ch.deathContext = _composeDeathContext(ch, cd.reason); } catch(_dcE) { try{ ch.deathContext = String(cd.reason||'').slice(0,80); }catch(_){} }
  // ★ 死者不再任职·须清官衔(2026-07-04)：此前只摘 officeTree holder(下方 42-53)却留 ch.officialTitle
  //   → 任何读 officialTitle 又不滤 alive 的 UI/名册把死者显示成"现任陕西巡抚"(玩家报"死人还在任")。
  //   与 onDismissal(tm-ai-change-applier.js:646-651)对齐；殁前官衔存 positionAtDeath 供墓志铭/图志「原任X」。
  if (ch.officialTitle && !ch.positionAtDeath) ch.positionAtDeath = ch.officialTitle;
  ch.officialTitle = null;
  ch.position = '';
  ch.title = '';
  ch.officialTitles = [];
  ch.concurrentTitles = [];
  ch.concurrentTitle = '';
  ch._removedFromOfficeTurn = GM.turn || 0;
  ch._removedReason = '身故';
  if (typeof recordCharacterArc === 'function') recordCharacterArc(cd.name, 'death', cd.reason);
  if (typeof PostTransfer !== 'undefined') PostTransfer.cascadeVacate(cd.name);
  // 官制同步：将死者从所有 actualHolders 中移除（留占位）
  if (GM.officeTree && typeof _offDismissPerson === 'function') {
    (function _clearDead(ns) {
      ns.forEach(function(n) {
        if (n.positions) n.positions.forEach(function(p) {
          if (p.holder === cd.name || (Array.isArray(p.actualHolders) && p.actualHolders.some(function(h){return h && h.name===cd.name;}))) {
            _offDismissPerson(p, cd.name);
          }
        });
        if (n.subs) _clearDead(n.subs);
      });
    })(GM.officeTree);
  }
  // 相关角色记忆此人之死
  if (typeof NpcMemorySystem !== 'undefined') {
    (GM.chars||[]).forEach(function(c2) {
      if (c2.alive === false || c2.name === cd.name) return;
      var _rel = (c2.faction === ch.faction) || (c2.party === ch.party) || (c2.family && c2.family === ch.family);
      if (_rel) NpcMemorySystem.remember(c2.name, cd.name + '离世：' + cd.reason, '忧', 7, cd.name);
    });
  }
  addEB('\u6B7B\u4EA1', cd.name + '\uFF1A' + cd.reason);
  // 2.6: 事件总线广播角色死亡
  if (typeof GameEventBus !== 'undefined') GameEventBus.emit('character:death', { name: cd.name, reason: cd.reason });
  // 家族影响——仅记录记忆和声望，具体情感反应由AI根据每人性格决定
  if (ch.family) {
    if (GM.families && GM.families[ch.family] && typeof updateFamilyRenown === 'function') {
      updateFamilyRenown(ch.family, -2, cd.name + '\u53BB\u4E16');
    }
    // 族人记住此事（AI根据性格决定悲痛/冷漠/窃喜）
    if (GM.chars && typeof NpcMemorySystem !== 'undefined') {
      GM.chars.forEach(function(fm) {
        if (fm.alive !== false && fm.family === ch.family && fm.name !== cd.name) {
          NpcMemorySystem.remember(fm.name, '\u65CF\u4EBA' + cd.name + '\u53BB\u4E16\uFF1A' + cd.reason, '\u5E73', 6, cd.name);
        }
      });
    }
  }
  // 级联清理：军队统帅引用
  if (GM.armies) {
    GM.armies.forEach(function(army) {
      if (army.commander === cd.name) {
        army.commander = '';
        army.commanderTitle = '';
        army.morale = Math.max(0, (army.morale || 50) - 15); // 主帅阵亡士气骤降
        addEB('\u519B\u4E8B', army.name + '\u4E3B\u5E05' + cd.name + '\u9635\u4EA1\uFF0C\u58EB\u6C14\u9AA4\u964D');
      }
    });
  }
  // 丁忧/服丧——死者的子女如果在任官员，应离职守丧
  var _deadName = cd.name;
  (GM.chars||[]).forEach(function(c3) {
    if (c3.alive === false || c3.isPlayer) return;
    // 检查是否是死者子女（通过family/father/mother字段）
    var _isChild = (c3.father === _deadName || c3.mother === _deadName);
    if (!_isChild && ch.children && Array.isArray(ch.children)) _isChild = ch.children.indexOf(c3.name) >= 0;
    if (!_isChild) return;
    // 此NPC是死者子女→标记丁忧
    if (c3.officialTitle) {
      c3._mourning = { since: GM.turn, until: GM.turn + 9, parent: _deadName }; // 9回合守丧
      addEB('丁忧', c3.name + '因' + _deadName + '去世而丁忧离职');
      if (typeof NpcMemorySystem !== 'undefined') {
        NpcMemorySystem.remember(c3.name, '父/母' + _deadName + '去世，丁忧守丧', '悲', 10, _deadName);
      }
      // 生成时局要务——提醒玩家可夺情
      if (GM.currentIssues) {
        GM.currentIssues.push({
          id: 'issue_mourning_' + c3.name,
          title: c3.name + '丁忧——是否夺情？',
          category: '人事',
          description: c3.name + '（' + (c3.officialTitle||'') + '）因' + _deadName + '去世须离职守丧约9回合。可通过诏令"夺情"强令其留任，但恐引起朝臣非议。',
          status: 'pending', raisedTurn: GM.turn,
          raisedDate: typeof getTSText === 'function' ? getTSText(GM.turn) : ''
        });
      }
    }
  });
  // 级联清理：若死者是势力首领，标记势力动荡
  if (GM.facs) {
    GM.facs.forEach(function(fac) {
      if (fac.leader !== cd.name) return;
      fac.leader = '';
      addEB('\u52BF\u529B\u52A8\u6001', fac.name + '\u9996\u9886' + cd.name + '\u6B7B\u4EA1\uFF0C\u52BF\u529B\u52A8\u8361');
      fac.strength = Math.max(0, (fac.strength || 50) - 10);

      // 封臣级联：宗主首领死亡→所有封臣忠诚度下降
      if (fac.vassals && fac.vassals.length > 0) {
        fac.vassals.forEach(function(vn) {
          var vRuler = GM.chars ? GM.chars.find(function(c) { return c.faction === vn && c.alive !== false && (c.position === '\u541B\u4E3B' || c.position === '\u9996\u9886'); }) : null;
          if (vRuler) {
            if (typeof adjustCharacterLoyalty === 'function') adjustCharacterLoyalty(vRuler, -10, '\u5B97\u4E3B\u4E4B\u6B7B', { source:'liege-death-vassal-loyalty' });
            else vRuler.loyalty = Math.max(0, ((typeof vRuler.loyalty === 'number' && isFinite(vRuler.loyalty)) ? vRuler.loyalty : 50) - 10);
            addEB('\u5C01\u81E3\u52A8\u6001', vn + '\u5C01\u81E3' + vRuler.name + '\u56E0\u5B97\u4E3B\u4E4B\u6B7B\u5FE0\u8BDA\u5EA6\u4E0B\u964D');
          }
        });
      }

      // 封臣首领死亡→检查是否世袭
      if (fac.liege) {
        // 查找继承人（子嗣或同族）
        var heir = GM.chars ? GM.chars.find(function(c) {
          return c.alive !== false && c.faction === fac.name && c.name !== cd.name && (c.parentOf === cd.name || c.father === cd.name);
        }) : null;
        if (heir) {
          fac.leader = heir.name;
          heir.position = '\u9996\u9886';
          addEB('\u5C01\u81E3\u7EE7\u627F', fac.name + '\u5C01\u81E3\u7531' + heir.name + '\u7EE7\u627F');
        } else {
          addEB('\u5C01\u81E3\u5371\u673A', fac.name + '\u5C01\u81E3\u9996\u9886' + cd.name + '\u6B7B\u4EA1\u4E14\u65E0\u7EE7\u627F\u4EBA\uFF0C\u5C01\u81E3\u5173\u7CFB\u52A8\u6447');
        }
      }
    });
  }
  // 级联清理：头衔继承
  if (ch.titles && ch.titles.length > 0) {
    ch.titles.forEach(function(t) {
      if (t.hereditary) {
        // 查找继承人
        var _titleHeir = GM.chars ? GM.chars.find(function(c) {
          return c.alive !== false && c.name !== cd.name && (c.father === cd.name || (c.family && c.family === ch.family));
        }) : null;
        if (_titleHeir) {
          if (!_titleHeir.titles) _titleHeir.titles = [];
          _titleHeir.titles.push({
            name: t.name, level: t.level,
            hereditary: t.hereditary, privileges: t.privileges || [],
            _suppressed: t._suppressed || [],
            grantedTurn: GM.turn, grantedBy: cd.name + '(\u7EE7\u627F)'
          });
          addEB('\u7EE7\u627F', _titleHeir.name + '\u7EE7\u627F\u4E86' + cd.name + '\u7684' + t.name + '\u7235\u4F4D');
        } else {
          addEB('\u7235\u4F4D', cd.name + '\u7684' + t.name + '\u7235\u4F4D\u56E0\u65E0\u7EE7\u627F\u4EBA\u800C\u5E9F\u9664');
        }
      } else {
        // 非世袭头衔→朝廷收回
        addEB('\u7235\u4F4D', cd.name + '\u7684' + t.name + '\u5934\u8854(\u6D41\u5B98)\u7531\u671D\u5EF7\u6536\u56DE');
      }
    });
  }
  // 级联清理：行政区划 governor 免职
  if (P.adminHierarchy) {
    var _akDeath = Object.keys(P.adminHierarchy);
    _akDeath.forEach(function(k) {
      var _ahd = P.adminHierarchy[k];
      if (!_ahd || !_ahd.divisions) return;
      function _removeGov(divs) {
        divs.forEach(function(d) {
          if (d.governor === cd.name) {
            d.governor = '';
            addEB('\u884C\u653F', d.name + '\u4E3B\u5B98' + cd.name + '\u53BB\u4E16\uFF0C\u804C\u4F4D\u7A7A\u7F3A');
            // 同步省份
            if (GM.provinceStats && GM.provinceStats[d.name]) {
              GM.provinceStats[d.name].governor = '';
              GM.provinceStats[d.name].corruption = Math.min(100, (GM.provinceStats[d.name].corruption || 20) + 10);
            }
          }
          if (d.children) _removeGov(d.children);
        });
      }
      _removeGov(_ahd.divisions);
    });
  }
  // 级联清理：配偶死亡→后宫更新
  if ((typeof _tmIsPlayerConsort === 'function' ? _tmIsPlayerConsort(ch) : ch.spouse === true) && GM.harem) {
    // 从继承人列表移除该配偶的子嗣（如果子嗣也死了的话由子嗣的死亡事件处理）
    // 从孕期列表移除
    if (GM.harem.pregnancies) {
      GM.harem.pregnancies = GM.harem.pregnancies.filter(function(p) { return p.mother !== cd.name; });
    }
    addEB('\u540E\u5BAB', cd.name + '\u85A8\u901D');
    // 重算继承人（如果有recalculateHeirs函数）
    if (typeof HaremSettlement !== 'undefined' && HaremSettlement.recalculateHeirs) {
      HaremSettlement.recalculateHeirs();
    }
  }
  // 级联清理：继承人死亡→从继承人列表中移除
  if (GM.harem && Array.isArray(GM.harem.heirs) && GM.harem.heirs.some(function(h) { return h === cd.name || (h && h.name === cd.name); })) {
    GM.harem.heirs.forEach(function(h) { if (h && h.name === cd.name) h.alive = false; });
    GM.harem.heirs = GM.harem.heirs.filter(function(h) { return h !== cd.name; });
    addEB('\u7EE7\u627F', cd.name + '\u53BB\u4E16\uFF0C\u5DF2\u4ECE\u7EE7\u627F\u4EBA\u5E8F\u5217\u4E2D\u79FB\u9664');
  }
  if (GM.harem && GM.harem.crownPrince === cd.name) {
    GM.harem.crownPrince = ''; // arch-ok 储君薨级联清理(国本刀2026-07-07·与本文件既有 harem 级联同区)
    var _pcCP = (GM.chars || []).find(function(x) { return x && x.isPlayer; });
    if (_pcCP && _pcCP.designatedHeirId === cd.name) _pcCP.designatedHeirId = '';
    addEB('国本', '皇太子' + cd.name + '薨·东宫虚位，国本动摇');
  }
  _dbg('[AI Death] ' + cd.name + ': ' + cd.reason);
  // 1.4→2.6: 叙事事实已由 GameEventBus character:death 监听器自动添加
// E10: 玩家角色死亡 → 统一走玩家之死裁决器（鼎革R1a·2026-07-07）：
  //   原地内联的世代传承镜像已收拢进 adjudicatePlayerDeath@tm-endturn-helpers
  //   （行为等价：有嗣继统续玩/无嗣 _playerDead 终局/异常回落）。
  if (ch.isPlayer || (P.playerInfo && P.playerInfo.characterName === cd.name)) {
    if (typeof adjudicatePlayerDeath === 'function') {
      adjudicatePlayerDeath(ch, cd.reason, { kind: 'narrative' });
    } else {
      // 沙箱/极端缺位回落：宁终局勿尸政
      GM._playerDead = true;
      GM._playerDeathReason = cd.reason;
    }
  }
}

// ★2026-08-12 死因本地扩写·零 AI:把 AI 一句式 deathReason 扩成带背景的墓志式描述。
//   数据全部来自本地(ch 字段)·关键词分类 + 任上/里居 + 享年 + 身后·供人物面板「去世缘由」展示。
function _composeDeathContext(ch, reason) {
  var r = String(reason || '').trim();
  var part = '';
  // 死因分类(按关键词·宁缺勿错)
  var _rules = [
    [/病|疾|瘵|恙|咯血|沉疴/, '病逝'],
    [/老|寿|年高|寿终|天年/, '寿终正寝'],
    [/战|阵亡|阵殁|殁于阵|战殁|殉国|死事|血战|中箭|中炮|兵败/, '殁于王事'],
    [/赐死|鸩|缢|自尽|自裁|赐帛|白绫/, '赐死/自尽'],
    [/斩|诛|杀|杖毙|处决|凌迟|腰斩/, '伏诛'],
    [/疫|瘟|天花|伤寒/, '染疫而亡'],
    [/坠|溺水|溺|焚|火烧|马惊|坠马|雷击|意外/, '意外身故'],
    [/饿|饥|乏食/, '饥馁而亡'],
    [/忧|郁|愤|恚|愁/, '忧愤而卒'],
    [/伤|创|金疮/, '伤重不治']
  ];
  for (var i = 0; i < _rules.length; i++) {
    if (_rules[i][0].test(r)) { part = _rules[i][1]; break; }
  }
  if (!part) part = '卒';
  var s = part + '（' + r.slice(0, 40) + '）';
  // 任上/里居:有原任官职且死于任地附近 → 任上;否则里居
  var _pos = ch.positionAtDeath || ch._positionAtDismiss || '';
  var _loc = ch.location || '';
  var _capital = (typeof GM !== 'undefined' && GM && GM._capital) || '';
  if (_pos) {
    var _onPost = _loc && _capital && _loc !== _capital ? true : false;
    s += '，殁于' + (_onPost ? _pos + '任上' : '任所') + '。';
  } else if (_loc) {
    s += '，殁于' + _loc + '。';
  } else {
    s += '。';
  }
  // 享年
  if (ch.age) s += '享年' + ch.age + '岁。';
  // 身后
  var _kids = Array.isArray(ch.children) ? ch.children.length : 0;
  if (_kids > 0) s += '有子' + _kids + '人。';
  else if (ch.spouse) s += '遗孀在堂。';
  return s;
}
