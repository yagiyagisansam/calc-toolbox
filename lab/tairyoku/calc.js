/*
 * 新体力テストの得点・総合評価・体力年齢の計算ロジック
 *
 * 基準の時点: 2026年7月時点でスポーツ庁が公開している「新体力テスト実施要項」の
 * 項目別得点表・総合評価基準表・体力年齢判定基準表。
 *
 * 根拠(一次情報):
 * - スポーツ庁「新体力テスト実施要項」
 *   https://www.mext.go.jp/sports/b_menu/sports/mcatetop03/list/detail/1408001.htm (2026年7月29日参照)
 *   ・6歳〜11歳対象  https://www.mext.go.jp/sports/content/20220517-spt-kensport01-300000771_1.pdf
 *   ・12歳〜19歳対象 https://www.mext.go.jp/sports/content/20220517-spt-kensport01-300000771_2.pdf
 *   ・20歳〜64歳対象 https://www.mext.go.jp/sports/content/20220517-spt-kensport01-300000771_3.pdf
 *   各PDFの「Ⅲ テストの得点表および総合評価」に載っている項目別得点表・総合評価基準表・
 *   体力年齢判定基準表の数値をそのまま表にしている。
 *
 * 前提:
 * - 対応するのは6歳〜64歳。65歳〜79歳対象の要項(テスト項目が異なる)は扱わない。
 * - 年齢は「調査実施年度の4月1日現在の満年齢」で数える(実施要項の記録用紙の注意書きによる)。
 * - 持久走・急歩の記録は秒で受け取る(例: 5分16秒 → 316)。
 * - 握力は左右2回ずつ測った平均値(kg)を入れる。長座体前屈・反復横とび・立ち幅とび・
 *   ボール投げは2回のうちのよい記録を入れる。
 * - 持久走(または急歩)と20mシャトルランはどちらか一方を選ぶ。両方入れた場合は
 *   持久走・急歩を優先する。
 * - 体力年齢の判定は20歳〜64歳対象の要項にのみある。
 */
(function (global) {
  "use strict";

  // 得点表のしきい値。高いほうがよい項目は「この値以上なら10点、次の値以上なら9点…」、
  // 低いほうがよい項目(50m走・持久走・急歩)は「この値以下なら10点、次の値以下なら9点…」。
  // 配列は10点→2点の順に9個。どれにも当てはまらなければ1点。
  var TABLES = {
    "6-11": {
      ageMin: 6, ageMax: 11,
      events: ["grip", "situp", "sitreach", "sidestep", "shuttle", "run50", "standjump", "ballthrow"],
      endurance: ["shuttle"],
      lower: ["run50"],
      male: {
        grip:      [26, 23, 20, 17, 14, 11, 9, 7, 5],
        situp:     [26, 23, 20, 18, 15, 12, 9, 6, 3],
        sitreach:  [49, 43, 38, 34, 30, 27, 23, 19, 15],
        sidestep:  [50, 46, 42, 38, 34, 30, 26, 22, 18],
        shuttle:   [80, 69, 57, 45, 33, 23, 15, 10, 8],
        run50:     [8.0, 8.4, 8.8, 9.3, 9.9, 10.6, 11.4, 12.2, 13.0],
        standjump: [192, 180, 168, 156, 143, 130, 117, 105, 93],
        ballthrow: [40, 35, 30, 24, 18, 13, 10, 7, 5]
      },
      female: {
        grip:      [25, 22, 19, 16, 13, 11, 9, 7, 4],
        situp:     [23, 20, 18, 16, 14, 12, 9, 6, 3],
        sitreach:  [52, 46, 41, 37, 33, 29, 25, 21, 18],
        sidestep:  [47, 43, 40, 36, 32, 28, 25, 21, 17],
        shuttle:   [64, 54, 44, 35, 26, 19, 14, 10, 8],
        run50:     [8.3, 8.7, 9.1, 9.6, 10.2, 10.9, 11.6, 12.4, 13.2],
        standjump: [181, 170, 160, 147, 134, 121, 109, 98, 85],
        ballthrow: [25, 21, 17, 14, 11, 8, 6, 5, 4]
      },
      // 総合評価基準表(男女共通)。年齢 → [A以上, B以上, C以上, D以上]。それ未満はE
      rank: {
        6:  [39, 33, 27, 22],
        7:  [47, 41, 34, 27],
        8:  [53, 46, 39, 32],
        9:  [59, 52, 45, 38],
        10: [65, 58, 50, 42],
        11: [71, 63, 55, 46]
      }
    },
    "12-19": {
      ageMin: 12, ageMax: 19,
      events: ["grip", "situp", "sitreach", "sidestep", "endurance", "run50", "standjump", "handball"],
      endurance: ["endurance", "shuttle"],
      lower: ["run50", "endurance"],
      male: {
        grip:      [56, 51, 47, 43, 38, 33, 28, 23, 18],
        situp:     [35, 33, 30, 27, 25, 22, 19, 16, 13],
        sitreach:  [64, 58, 53, 49, 44, 39, 33, 28, 21],
        sidestep:  [63, 60, 56, 53, 49, 45, 41, 37, 30],
        endurance: [299, 316, 333, 355, 382, 410, 450, 499, 560],
        shuttle:   [125, 113, 102, 90, 76, 63, 51, 37, 26],
        run50:     [6.6, 6.8, 7.0, 7.2, 7.5, 7.9, 8.4, 9.0, 9.7],
        standjump: [265, 254, 242, 230, 218, 203, 188, 170, 150],
        handball:  [37, 34, 31, 28, 25, 22, 19, 16, 13]
      },
      female: {
        grip:      [36, 33, 30, 28, 25, 23, 20, 17, 14],
        situp:     [29, 26, 23, 20, 18, 15, 13, 11, 8],
        sitreach:  [63, 58, 54, 50, 45, 40, 35, 30, 23],
        sidestep:  [53, 50, 48, 45, 42, 39, 36, 32, 27],
        endurance: [229, 242, 259, 277, 296, 318, 342, 374, 417],
        shuttle:   [88, 76, 64, 54, 44, 35, 27, 21, 15],
        run50:     [7.7, 8.0, 8.3, 8.6, 8.9, 9.3, 9.8, 10.3, 11.2],
        standjump: [210, 200, 190, 179, 168, 157, 145, 132, 118],
        handball:  [23, 20, 18, 16, 14, 12, 11, 10, 8]
      },
      rank: {
        12: [51, 41, 32, 22],
        13: [57, 47, 37, 27],
        14: [60, 51, 41, 31],
        15: [61, 52, 41, 31],
        16: [63, 53, 42, 31],
        17: [65, 54, 43, 31],
        18: [65, 54, 43, 31],
        19: [65, 54, 43, 31]
      }
    },
    "20-64": {
      ageMin: 20, ageMax: 64,
      events: ["grip", "situp", "sitreach", "sidestep", "walk", "standjump"],
      endurance: ["walk", "shuttle"],
      lower: ["walk"],
      male: {
        grip:      [62, 58, 54, 50, 47, 44, 41, 37, 32],
        situp:     [33, 30, 27, 24, 21, 18, 15, 12, 9],
        sitreach:  [61, 56, 51, 47, 43, 38, 33, 27, 21],
        sidestep:  [60, 57, 53, 49, 45, 41, 36, 31, 24],
        walk:      [527, 581, 633, 683, 731, 776, 820, 869, 927],
        shuttle:   [95, 81, 67, 54, 43, 32, 24, 18, 12],
        standjump: [260, 248, 236, 223, 210, 195, 180, 162, 143]
      },
      female: {
        grip:      [39, 36, 34, 31, 29, 26, 24, 21, 19],
        situp:     [25, 23, 20, 18, 15, 12, 9, 5, 1],
        sitreach:  [60, 56, 52, 48, 44, 40, 36, 31, 25],
        sidestep:  [52, 49, 46, 43, 40, 36, 32, 27, 20],
        walk:      [434, 460, 486, 512, 539, 567, 599, 633, 697],
        shuttle:   [62, 50, 41, 32, 25, 19, 14, 10, 8],
        standjump: [202, 191, 180, 170, 158, 143, 128, 113, 98]
      },
      // 総合評価基準表は5歳きざみ(60〜64歳のみ5年幅)。年齢の下限 → [A,B,C,D]
      rankBands: [
        [20, 24, [50, 44, 37, 30]],
        [25, 29, [49, 43, 36, 29]],
        [30, 34, [49, 42, 35, 28]],
        [35, 39, [48, 41, 35, 28]],
        [40, 44, [46, 39, 33, 26]],
        [45, 49, [43, 37, 30, 23]],
        [50, 54, [40, 33, 27, 21]],
        [55, 59, [37, 30, 24, 18]],
        [60, 64, [33, 26, 20, 15]]
      ]
    }
  };

  // 体力年齢判定基準表(20歳〜64歳対象の要項)。[この得点以上, 体力年齢の下限, 上限]
  var FITNESS_AGE = [
    [46, 20, 24], [43, 25, 29], [40, 30, 34], [38, 35, 39], [36, 40, 44], [33, 45, 49],
    [30, 50, 54], [27, 55, 59], [25, 60, 64], [22, 65, 69], [20, 70, 74], [0, 75, 79]
  ];

  var RANK_LABELS = ["A", "B", "C", "D", "E"];
  var GENDERS = ["male", "female"];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isIntIn(v, min, max) {
    return isFiniteNumber(v) && v === Math.floor(v) && v >= min && v <= max;
  }

  /**
   * 年齢から、使う実施要項(年齢区分)を決める。
   * @param {number} age 年齢(6〜64の整数。調査実施年度の4月1日現在の満年齢)
   * @returns {{ok:true, group:"6-11"|"12-19"|"20-64"}|{ok:false, code:"invalid_age"}}
   */
  function groupForAge(age) {
    if (!isIntIn(age, 6, 64)) return { ok: false, code: "invalid_age" };
    if (age <= 11) return { ok: true, group: "6-11" };
    if (age <= 19) return { ok: true, group: "12-19" };
    return { ok: true, group: "20-64" };
  }

  /**
   * 1種目の記録を1〜10点に換算する。
   * 高いほうがよい項目はしきい値以上、低いほうがよい項目(50m走・持久走・急歩)は
   * しきい値以下で、その得点になる。
   * @param {string} group 年齢区分("6-11"|"12-19"|"20-64")
   * @param {string} gender 性別("male"|"female")
   * @param {string} event 種目。grip(握力kg)/situp(上体起こし回)/sitreach(長座体前屈cm)/
   *   sidestep(反復横とび点)/shuttle(20mシャトルラン回)/run50(50m走 秒)/
   *   standjump(立ち幅とび cm)/ballthrow(ソフトボール投げ m)/handball(ハンドボール投げ m)/
   *   endurance(持久走 秒)/walk(急歩 秒)
   * @param {number} value その種目の記録(単位は種目ごと。時間は秒)
   * @returns {{ok:true, score:number}
   *          |{ok:false, code:"invalid_group"|"invalid_gender"|"invalid_event"|"invalid_value"}}
   */
  function scoreEvent(group, gender, event, value) {
    var g = TABLES[group];
    if (!g) return { ok: false, code: "invalid_group" };
    if (GENDERS.indexOf(gender) === -1) return { ok: false, code: "invalid_gender" };
    var table = g[gender][event];
    if (!table) return { ok: false, code: "invalid_event" };
    if (!isFiniteNumber(value) || value < 0 || value > 100000) {
      return { ok: false, code: "invalid_value" };
    }
    var lower = g.lower.indexOf(event) !== -1;
    for (var i = 0; i < table.length; i++) {
      if (lower ? value <= table[i] : value >= table[i]) return { ok: true, score: 10 - i };
    }
    return { ok: true, score: 1 };
  }

  /**
   * 得点の合計から総合評価(A〜E)を求める。
   * @param {string} group 年齢区分("6-11"|"12-19"|"20-64")
   * @param {number} age 年齢(その区分の範囲内の整数)
   * @param {number} total 得点の合計(0以上)
   * @returns {{ok:true, rank:"A"|"B"|"C"|"D"|"E"}
   *          |{ok:false, code:"invalid_group"|"invalid_age"|"invalid_total"}}
   */
  function rankOf(group, age, total) {
    var g = TABLES[group];
    if (!g) return { ok: false, code: "invalid_group" };
    if (!isIntIn(age, g.ageMin, g.ageMax)) return { ok: false, code: "invalid_age" };
    if (!isFiniteNumber(total) || total < 0 || total > 100) return { ok: false, code: "invalid_total" };
    var th = null;
    if (g.rank) {
      th = g.rank[age];
    } else {
      for (var i = 0; i < g.rankBands.length; i++) {
        if (age >= g.rankBands[i][0] && age <= g.rankBands[i][1]) { th = g.rankBands[i][2]; break; }
      }
    }
    if (!th) return { ok: false, code: "invalid_age" };
    for (var j = 0; j < th.length; j++) {
      if (total >= th[j]) return { ok: true, rank: RANK_LABELS[j] };
    }
    return { ok: true, rank: "E" };
  }

  /**
   * 得点の合計から体力年齢を判定する(20歳〜64歳対象の要項の基準)。
   * @param {number} total 得点の合計(0〜60)
   * @returns {{ok:true, minAge:number, maxAge:number}|{ok:false, code:"invalid_total"}}
   *   minAge〜maxAge が体力年齢の範囲(例: 46点以上なら20歳〜24歳)
   */
  function fitnessAge(total) {
    if (!isFiniteNumber(total) || total < 0 || total > 60) return { ok: false, code: "invalid_total" };
    for (var i = 0; i < FITNESS_AGE.length; i++) {
      if (total >= FITNESS_AGE[i][0]) {
        return { ok: true, minAge: FITNESS_AGE[i][1], maxAge: FITNESS_AGE[i][2] };
      }
    }
    return { ok: true, minAge: 75, maxAge: 79 };
  }

  /**
   * 全種目の記録から、種目別得点・合計・総合評価・(20歳以上は)体力年齢をまとめて求める。
   * 持久走(または急歩)と20mシャトルランはどちらか一方でよい。両方あれば持久走・急歩を使う。
   * @param {number} age 年齢(6〜64の整数)
   * @param {string} gender 性別("male"|"female")
   * @param {Object} records 種目名をキー、記録を値とするオブジェクト(時間は秒)
   * @returns {{ok:true, group:string, scores:Object, total:number, maxTotal:number,
   *            complete:boolean, missing:string[], usedEndurance:(string|null),
   *            rank:(string|null), fitnessAgeMin:(number|null), fitnessAgeMax:(number|null)}
   *          |{ok:false, code:string}}
   *   code: "invalid_age"|"invalid_gender"|"invalid_records"|"invalid_value"|"invalid_event"
   *   complete が false のときは rank と体力年齢は null(全種目そろってから判定する)。
   */
  function evaluate(age, gender, records) {
    var gr = groupForAge(age);
    if (!gr.ok) return gr;
    if (GENDERS.indexOf(gender) === -1) return { ok: false, code: "invalid_gender" };
    if (records === null || typeof records !== "object") return { ok: false, code: "invalid_records" };
    var g = TABLES[gr.group];

    var scores = {};
    var missing = [];
    var total = 0;
    var usedEndurance = null;

    for (var i = 0; i < g.events.length; i++) {
      var ev = g.events[i];
      var keys = ev === g.endurance[0] ? g.endurance : [ev];
      var picked = null;
      for (var k = 0; k < keys.length; k++) {
        if (records[keys[k]] !== undefined && records[keys[k]] !== null && records[keys[k]] !== "") {
          picked = keys[k];
          break;
        }
      }
      if (picked === null) { missing.push(ev); continue; }
      var s = scoreEvent(gr.group, gender, picked, records[picked]);
      if (!s.ok) return s;
      scores[picked] = s.score;
      total += s.score;
      if (keys.length > 1) usedEndurance = picked;
    }

    var complete = missing.length === 0;
    var out = {
      ok: true,
      group: gr.group,
      scores: scores,
      total: total,
      maxTotal: g.events.length * 10,
      complete: complete,
      missing: missing,
      usedEndurance: usedEndurance,
      rank: null,
      fitnessAgeMin: null,
      fitnessAgeMax: null
    };
    if (complete) {
      var r = rankOf(gr.group, age, total);
      if (r.ok) out.rank = r.rank;
      if (gr.group === "20-64") {
        var f = fitnessAge(total);
        if (f.ok) { out.fitnessAgeMin = f.minAge; out.fitnessAgeMax = f.maxAge; }
      }
    }
    return out;
  }

  var api = {
    groupForAge: groupForAge,
    scoreEvent: scoreEvent,
    rankOf: rankOf,
    fitnessAge: fitnessAge,
    evaluate: evaluate,
    TABLES: TABLES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TairyokuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
