/*
 * VO2max(最大酸素摂取量)推定の計算ロジック
 *
 * 根拠(出典):
 * - Omni Calculator「VO2 Max Calculator」 https://www.omnicalculator.com/sports/vo2-max
 *   (2026年7月29日参照)
 *   安静時心拍法: VO2max = 15.3 × (最大心拍数 ÷ 安静時心拍数)
 *   最大心拍数の推定: 最大心拍数 = 208 − 0.7 × 年齢
 *   引用文献: Hawkins MN, et al. "Maximal oxygen uptake as a parametric measure of
 *   cardiorespiratory capacity." Med Sci Sports Exerc, 2007 / McArdle WD, Katch FI,
 *   Katch VL. "Essentials of Exercise Physiology, 3rd ed." 2006
 * - Topend Sports「Cooper 12 Minute Run Test」 https://www.topendsports.com/testing/tests/cooper.htm
 *   (2026年7月29日参照)
 *   Cooperテスト: VO2max = (12分間走の距離m − 504.9) ÷ 44.73
 *   (同ページの VO2max = 22.351 × 距離km − 11.288 と同じ式。1÷44.73 = 0.022356)
 *   年代・性別ごとの走行距離の評価表もこのページによる。
 *
 * 前提:
 * - 推定値であり、実験室での実測値(呼気ガス分析)とは異なる。Cooperテストの原著(1968年)は
 *   米空軍の隊員115名を対象とした回帰式で、相関係数は約0.90。
 * - 安静時心拍法は安静時心拍数を正しく測れているかに強く依存する
 *   (起床直後に安静のまま測るのが望ましい)。
 * - VO2maxの評価は、Cooperテストの走行距離の評価表を上の式でVO2maxに換算したもの。
 *   したがって2つの推定方法で同じ評価基準を使える。
 */
(function (global) {
  "use strict";

  // 12分間走の距離の範囲。Cooperの回帰式は距離504.9m以下でVO2maxが0以下になり意味を失うため、
  // 歩行相当の下限(800m ≒ 時速4km)から、世界記録を大きく上回る5800mまでに限定する
  var DIST_MIN = 800;
  var DIST_MAX = 5800;
  var AGE_MIN = 13; // 評価表が対象とする年齢の下限
  var AGE_MAX = 99;
  var HR_MIN = 25; // 心拍数の下限(拍/分)
  var HR_MAX = 250; // 心拍数の上限(拍/分)

  // Cooperテストの評価表(Topend Sports)。距離の下限値(m)を
  // [非常に優れている, 優れている, 平均的, やや低い] の順で持つ。これ未満は「低い」
  var NORMS = {
    male: [
      [19, [2800, 2400, 2000, 1600]], // 13〜19歳
      [29, [2800, 2400, 2000, 1600]],
      [39, [2600, 2200, 1800, 1500]],
      [49, [2500, 2100, 1700, 1400]],
      [999, [2400, 2000, 1600, 1300]] // 50歳以上
    ],
    female: [
      [19, [2300, 2000, 1700, 1400]],
      [29, [2400, 2000, 1700, 1400]],
      [39, [2300, 1900, 1600, 1300]],
      [49, [2200, 1800, 1500, 1200]],
      [999, [2100, 1700, 1400, 1100]]
    ]
  };
  var LABELS = ["非常に優れている", "優れている", "平均的", "やや低い", "低い"];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 小数第n位で四捨五入する */
  function round(v, n) {
    var f = Math.pow(10, n);
    return Math.round(v * f) / f;
  }

  /** 12分間走の距離(m)をVO2max(ml/kg/分)に換算する内部関数 */
  function distanceToVo2(meters) {
    return (meters - 504.9) / 44.73;
  }

  /**
   * Cooperテスト(12分間走)からVO2maxを推定する。
   * @param {number} meters 12分間で走った距離(m、DIST_MIN〜DIST_MAX)
   * @returns {{ok:true, vo2max:number}|{ok:false, code:"invalid_distance"}}
   *   vo2max: 最大酸素摂取量(ml/kg/分、小数第1位で四捨五入)
   */
  function cooper(meters) {
    if (!isFiniteNumber(meters) || meters < DIST_MIN || meters > DIST_MAX) {
      return { ok: false, code: "invalid_distance" };
    }
    return { ok: true, vo2max: round(distanceToVo2(meters), 1) };
  }

  /**
   * 年齢から最大心拍数を推定する(208 − 0.7 × 年齢)。
   * @param {number} age 年齢(歳、AGE_MIN〜AGE_MAX)
   * @returns {{ok:true, maxHr:number}|{ok:false, code:"invalid_age"}}
   *   maxHr: 推定最大心拍数(拍/分、小数第1位で四捨五入)
   */
  function maxHrFromAge(age) {
    if (!isFiniteNumber(age) || age < AGE_MIN || age > AGE_MAX) {
      return { ok: false, code: "invalid_age" };
    }
    return { ok: true, maxHr: round(208 - 0.7 * age, 1) };
  }

  /**
   * 安静時心拍数と最大心拍数からVO2maxを推定する。
   * @param {number} maxHr 最大心拍数(拍/分、HR_MIN〜HR_MAX)
   * @param {number} restHr 安静時心拍数(拍/分、HR_MIN〜HR_MAX)
   * @returns {{ok:true, vo2max:number, ratio:number}
   *          |{ok:false, code:"invalid_max_hr"|"invalid_rest_hr"|"invalid_hr_order"}}
   *   vo2max: 最大酸素摂取量(ml/kg/分、小数第1位で四捨五入)
   *   ratio: 最大心拍数 ÷ 安静時心拍数(小数第2位で四捨五入)
   */
  function byHeartRate(maxHr, restHr) {
    if (!isFiniteNumber(maxHr) || maxHr < HR_MIN || maxHr > HR_MAX) {
      return { ok: false, code: "invalid_max_hr" };
    }
    if (!isFiniteNumber(restHr) || restHr < HR_MIN || restHr > HR_MAX) {
      return { ok: false, code: "invalid_rest_hr" };
    }
    if (restHr >= maxHr) {
      return { ok: false, code: "invalid_hr_order" };
    }
    return {
      ok: true,
      vo2max: round(15.3 * (maxHr / restHr), 1),
      ratio: round(maxHr / restHr, 2)
    };
  }

  /** 年齢と性別から評価表の行(距離の下限値の配列)を取り出す内部関数 */
  function normRow(age, sex) {
    var rows = NORMS[sex];
    for (var i = 0; i < rows.length; i++) {
      if (age <= rows[i][0]) return rows[i][1];
    }
    return null;
  }

  /**
   * VO2maxを年代・性別で評価する。
   * 評価の境界は、Cooperテストの走行距離の評価表を (距離−504.9)÷44.73 でVO2maxに換算した値。
   * @param {number} vo2max 最大酸素摂取量(ml/kg/分、0より大きく120以下)
   * @param {number} age 年齢(歳、AGE_MIN〜AGE_MAX)
   * @param {string} sex 性別("male" / "female")
   * @returns {{ok:true, label:string, thresholds:number[]}
   *          |{ok:false, code:"invalid_vo2max"|"invalid_age"|"invalid_sex"}}
   *   label: 「非常に優れている」「優れている」「平均的」「やや低い」「低い」のいずれか
   *   thresholds: 評価の境界となるVO2maxの値(小数第1位で四捨五入、高い順に4つ)
   */
  function rating(vo2max, age, sex) {
    if (!isFiniteNumber(vo2max) || vo2max <= 0 || vo2max > 120) {
      return { ok: false, code: "invalid_vo2max" };
    }
    if (!isFiniteNumber(age) || age < AGE_MIN || age > AGE_MAX) {
      return { ok: false, code: "invalid_age" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    var row = normRow(age, sex);
    var thresholds = row.map(function (m) { return round(distanceToVo2(m), 1); });
    var label = LABELS[LABELS.length - 1];
    for (var i = 0; i < thresholds.length; i++) {
      if (vo2max >= thresholds[i]) { label = LABELS[i]; break; }
    }
    return { ok: true, label: label, thresholds: thresholds };
  }

  /**
   * Cooperテストの距離から、VO2maxと年代別評価をまとめて求める。
   * @param {number} meters 12分間で走った距離(m)
   * @param {number} age 年齢(歳)
   * @param {string} sex 性別("male" / "female")
   * @returns {{ok:true, vo2max:number, label:string, thresholds:number[]}|{ok:false, code:string}}
   */
  function cooperWithRating(meters, age, sex) {
    var c = cooper(meters);
    if (!c.ok) return c;
    var r = rating(c.vo2max, age, sex);
    if (!r.ok) return r;
    return { ok: true, vo2max: c.vo2max, label: r.label, thresholds: r.thresholds };
  }

  /**
   * 年齢と安静時心拍数から、VO2maxと年代別評価をまとめて求める。
   * 最大心拍数を省略した場合は 208 − 0.7 × 年齢 で推定する。
   * @param {number} restHr 安静時心拍数(拍/分)
   * @param {number} age 年齢(歳)
   * @param {string} sex 性別("male" / "female")
   * @param {number} [maxHr] 実測の最大心拍数(拍/分)。省略時は年齢から推定
   * @returns {{ok:true, vo2max:number, maxHr:number, estimatedMaxHr:boolean,
   *            label:string, thresholds:number[]}|{ok:false, code:string}}
   */
  function heartRateWithRating(restHr, age, sex, maxHr) {
    var hr = maxHr;
    var estimated = false;
    if (hr === undefined || hr === null) {
      var m = maxHrFromAge(age);
      if (!m.ok) return m;
      hr = m.maxHr;
      estimated = true;
    }
    var v = byHeartRate(hr, restHr);
    if (!v.ok) return v;
    var r = rating(v.vo2max, age, sex);
    if (!r.ok) return r;
    return {
      ok: true,
      vo2max: v.vo2max,
      maxHr: hr,
      estimatedMaxHr: estimated,
      label: r.label,
      thresholds: r.thresholds
    };
  }

  var api = {
    cooper: cooper,
    maxHrFromAge: maxHrFromAge,
    byHeartRate: byHeartRate,
    rating: rating,
    cooperWithRating: cooperWithRating,
    heartRateWithRating: heartRateWithRating
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.Vo2maxCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
