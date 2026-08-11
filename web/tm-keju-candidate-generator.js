/* ═══════════════════════════════════════════════════════════════
 * 随机考生生成器（2026-08-12·用户需求）
 * 背景：官职扩张（16 巡抚 + 184 知府）后 700+ 历史人物池不够用
 * 设计：科举殿试录取 ~200 人/科·前 14 名=历史人物池·其余=随机生成考生
 *       生成考生信息/属性参考历史人物池格式(KEJU_HISTORICAL_POOL 条目
 *       n/d/z/h/by/bp/b + 候选对象 name/age/class/origin/shiliao/personality)
 * 输出：完整 GM.chars 角色（可直接任命·选任器候选）+ 科举候选字段
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (typeof window !== 'undefined' && window.TMMingKejuGen) return;
  var api = {};

  // ── 姓氏库（百家姓精选 120） ──
  var _SURNAMES = ('赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜'
    + '戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐'
    + '费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄'
    + '和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁'
    + '杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田胡凌霍虞'
    + '万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程'
    + '嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧'
    + '隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸'
    + '司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘'
    + '党翟谭贡劳逄姬申扶堵冉宰郦雍璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄'
    + '晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文'
    + '寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙').split('');

  // ── 名库（单字名·文雅常用） ──
  var _GIVEN = ('文武功廷玉明德世承光士元仲伯叔季嘉永维思国邦宗崇朝启源泽瀚清澄润'
    + '楷策略经纶纬才学识仁义礼智信忠孝廉节温良恭俭让守敬慎勤勉励志弘毅宽厚端庄'
    + '肃雍熙康宁安泰和顺丰裕祯祥瑞兆兴隆盛茂荣华富贵显达通正刚勇雄杰俊彦英茂'
    + '育化育材登升云鹏程霄汉星斗山河岳川峰峦松柏竹梅兰菊桂芝蕙芳芬馨香济桓'.split(''));

  // ── 双字名前缀（与单字组合：子X/文X/廷X…） ──
  var _GIVEN2 = ['子', '文', '廷', '之', '世', '承', '光', '士', '元', '仲', '伯', '叔', '季',
    '嘉', '永', '维', '思', '国', '邦', '宗', '崇', '朝', '启', '汝', '以', '若', '时', '秉', '用', '克', '景', '彦'];

  // ── 表字库（与名呼应·X公/卿/甫/之…） ──
  var _ZI = ['子明', '子敬', '子正', '子衡', '伯安', '伯玉', '仲和', '仲平', '叔达', '叔远',
    '季常', '季高', '元亮', '元之', '文正', '文远', '廷辅', '廷宪', '世贞', '世昌',
    '承恩', '承德', '光祖', '光庭', '士元', '士弘', '彦博', '彦章', '公瑾', '公度',
    '敬之', '敬舆', '慎之', '慎言', '明远', '明德', '正之', '正卿', '用之', '用中',
    '君实', '君衡', '汝霖', '汝成', '希文', '希孟', '惟庸', '惟恭', '绍祖', '绍庭'];

  // ── 号库（约 30% 概率有号·X+山人居士） ──
  var _HAO = ['东篱', '南山', '西园', '北窗', '竹溪', '梅坞', '松云', '鹤林', '兰亭', '菊庄',
    '石田', '砚山', '耕云', '听雨', '观澜', '枕流', '抱朴', '守拙', '归愚', '养真',
    '清虚', '澹泊', '静远', '乐天', '知非', '慎独', '克己', '存诚', '慕陶', '师古'];

  // ── 籍贯库（明境 16 省·府县样例） ──
  var _BIRTHPLACES = [
    '北直隶·保定府·清苑县', '北直隶·河间府·献县', '北直隶·真定府·赵州',
    '南直隶·苏州府·吴县', '南直隶·松江府·华亭县', '南直隶·常州府·无锡县',
    '南直隶·扬州府·江都县', '南直隶·徽州府·歙县', '南直隶·宁国府·泾县',
    '浙江·杭州府·钱塘县', '浙江·绍兴府·山阴县', '浙江·嘉兴府·秀水县',
    '浙江·宁波府·鄞县', '浙江·金华府·兰溪县', '浙江·温州府·永嘉县',
    '江西·南昌府·新建县', '江西·吉安府·庐陵县', '江西·抚州府·临川县',
    '湖广·武昌府·江夏县', '湖广·长沙府·善化县', '湖广·荆州府·江陵县',
    '福建·福州府·闽县', '福建·泉州府·晋江县', '福建·漳州府·龙溪县',
    '福建·兴化府·莆田县', '山东·济南府·历城县', '山东·兖州府·曲阜县',
    '山东·青州府·益都县', '山西·太原府·阳曲县', '山西·平阳府·临汾县',
    '山西·大同府·大同县', '河南·开封府·祥符县', '河南·河南府·洛阳县',
    '河南·归德府·商丘县', '陕西·西安府·长安县', '陕西·延安府·肤施县',
    '陕西·汉中府·南郑县', '四川·成都府·华阳县', '四川·重庆府·巴县',
    '四川·保宁府·阆中县', '广东·广州府·南海县', '广东·潮州府·海阳县',
    '广东·琼州府·琼山县', '广西·桂林府·临桂县', '广西·柳州府·马平县',
    '云南·云南府·昆明县', '云南·大理府·太和县', '贵州·贵阳府·贵定县',
    '贵州·思南府·安化县', '辽东·宁远卫', '辽东·辽阳城', '辽东·山海关'
  ];

  // ── 出身库（class·影响属性与生平） ──
  var _CLASSES = [
    { cls: '寒门', desc: '家世清贫，父祖务农，节衣缩食供其读书，力学不辍。' },
    { cls: '书香', desc: '累世书香，祖父举人，家藏典籍，幼承庭训。' },
    { cls: '耕读', desc: '乡间耕读传家，半耕半读，知稼穑之艰。' },
    { cls: '商贾', desc: '父祖经商起家，家道殷实，资其游学四方。' },
    { cls: '医户', desc: '家传医术，兼习儒业，明于阴阳五行。' },
    { cls: '讼师', desc: '父为县吏，谙熟刑名钱谷，晓簿书之务。' }
  ];

  // ── 生平模板尾（志向/性格·参考池 b 字段风格） ──
  var _ASPIRATIONS = [
    '志在经世济民，留心钱谷刑名，尝言「吏治即民生」。',
    '性刚直，好论天下事，耻于奔竞钻营。',
    '沉静寡言，博览群书，尤精《春秋》《通鉴》。',
    '通达时务，留心边事，常与人谈九边形势。',
    '为文典雅，诗赋有名于乡，然志不在一艺。',
    '俭朴自守，不事生产，惟以读书课子为乐。',
    '机敏干练，善理繁剧，乡里讼狱多所平反。',
    '笃实践履，耻为空谈，凡所治事必究其本末。'
  ];

  // ── 工具 ──
  function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function _rand(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
  // 正态分布（Box-Muller·均值 μ·标准差 σ·截断 [lo,hi]）
  function _norm(mean, sd, lo, hi) {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    var z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    var val = Math.round(mean + sd * z);
    if (val < lo) val = lo; if (val > hi) val = hi;
    return val;
  }
  function _genName(existingSet) {
    for (var t = 0; t < 40; t++) {
      var sur = _pick(_SURNAMES);
      var given;
      if (Math.random() < 0.45) {
        given = _pick(_GIVEN2) + _pick(_GIVEN);   // 双字名
      } else {
        given = _pick(_GIVEN);                    // 单字名
      }
      var name = sur + given;
      if (name.length >= 2 && name.length <= 3 && !existingSet[name]) return name;
    }
    return null;
  }

  // ── 主入口：生成 count 个随机考生（完整 GM.chars 角色 + 科举候选字段） ──
  function genCandidates(count) {
    count = Math.max(1, Math.floor(count || 1));
    if (typeof GM === 'undefined' || !GM) return [];
    if (!Array.isArray(GM.chars)) GM.chars = [];
    var year = GM.year || (typeof P !== 'undefined' && P.time && P.time.year) || 1627;
    // 去重集合（现有角色名 + 本批已生成）
    var existing = {};
    (GM.chars || []).forEach(function (c) { if (c && c.name) existing[c.name] = true; });
    var out = [];
    for (var i = 0; i < count; i++) {
      var name = _genName(existing);
      if (!name) continue;
      existing[name] = true;
      var cls = _pick(_CLASSES);
      var age = _norm(28, 6, 20, 40);
      var birthYear = year - age;
      var bp = _pick(_BIRTHPLACES);
      // 属性：普通官员水平·少量潜才（5% 双 65+）
      var isTalent = Math.random() < 0.05;
      var administration = isTalent ? _norm(66, 6, 55, 78) : _norm(48, 9, 32, 64);
      var intelligence = isTalent ? _norm(68, 6, 55, 80) : _norm(50, 10, 32, 66);
      var learning = _norm(58, 10, 40, 82);
      var appearance = _norm(50, 12, 30, 75);
      var diction = _norm(52, 12, 30, 78);
      var bio = bp.split('·')[0] + '人。' + cls.desc + _pick(_ASPIRATIONS);
      var c = {
        name: name,
        zi: _pick(_ZI),
        haoName: Math.random() < 0.3 ? (_pick(_HAO) + (Math.random() < 0.5 ? '山人' : '居士')) : '',
        gender: '男',
        alive: true,
        age: age,
        birthYear: birthYear,
        birthplace: bp,
        ethnicity: '汉',
        faith: '儒学',
        culture: '汉',
        learning: learning,
        appearance: appearance,
        diction: diction,
        administration: administration,
        intelligence: intelligence,
        role: '生员',
        officialTitle: '',
        title: '',
        // 科举候选字段（参考历史人物池候选对象）
        _generated: true,          // 随机生成标记
        isHistorical: false,
        source: '科举',
        class: cls.cls,            // 寒门/书香…
        origin: bp,
        party: '',
        shiliao: bio.slice(0, 60),
        personality: _pick(['刚直', '圆滑', '学者', '务实', '清介', '干练']),
        famousFor: bio.slice(0, 40),
        bio: bio,
        _kejuCandidate: true
      };
      GM.chars.push(c);
      out.push(c);
    }
    return out;
  }

  // ── 幂等录取：科举录取名单具象化（生成随机考生补足名额·写入 gradPool） ──
  function ensureEnrollment(exam, topHistoricalCount) {
    try {
      if (!exam || exam._enrollmentDone) return 0;
      var target = 200;                       // 每科录取 ~200 人（明朝实际每科 200-400）
      var histCount = Math.min(topHistoricalCount == null ? 14 : topHistoricalCount, 20);
      var dianshi = exam.dianshiResults || [];
      var need = Math.max(0, target - histCount - Math.max(0, dianshi.length - histCount));
      if (!Array.isArray(exam.gradPool)) exam.gradPool = [];
      // ① 历史候选（殿试前 14 名·来自 700+ 人物池）入进士池
      dianshi.slice(0, histCount).forEach(function (c, i) {
        if (!c || !c.name) return;
        exam.gradPool.push({
          name: c.name, age: c.age || 30, origin: c.origin || '', class: c.class || '寒门',
          party: c.party || '', score: c.score || 60, rank: i + 1, allocatedOffice: '',
          _crystallized: true, _generated: false
        });
      });
      // ② 随机生成考生补足 ~200 人（三甲同进士·充官缺）
      if (need > 0) {
        var gens = genCandidates(need);
        gens.forEach(function (g, i) {
          exam.gradPool.push({
            name: g.name, age: g.age, origin: g.origin, class: g.class,
            party: '', score: g.intelligence, rank: histCount + 1 + i, allocatedOffice: '',
            _crystallized: false, _generated: true
          });
        });
      }
      exam._enrollmentDone = true;
      return need;
    } catch (e) { try { console.warn('[keju-gen] ensureEnrollment', e); } catch (_) {} return 0; }
  }

  api.genCandidates = genCandidates;
  api.ensureEnrollment = ensureEnrollment;
  if (typeof window !== 'undefined') window.TMMingKejuGen = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
