/*
 * ブリンクマン指数(喫煙指数)の計算ロジック
 *
 * 根拠(一次情報):
 * - 厚生労働省「禁煙支援マニュアル・ニコチン依存症管理料について」
 *   (平成18年度たばこ・アルコール対策担当者講習会 資料)
 *   https://www.mhlw.go.jp/topics/tobacco/houkoku/061122f.html (2026年7月29日参照)
 *   「ブリンクマン指数(=1日の喫煙本数×喫煙年数)が200以上の者であること」
 *   がニコチン依存症管理料(禁煙治療の保険適用)の対象患者要件の一つとして挙げられている。
 * - 日本歯周病学会会誌「歯周治療における禁煙支援の実践」(J-STAGE)
 *   https://www.jstage.jst.go.jp/article/perio/65/4/65_125/_html/-char/ja (2026年7月29日参照)
 *   「1日あたりの平均喫煙本数と喫煙年数をかけあわせたものがブリンクマン指数」
 *   「ブリンクマン指数が400を超えると肺がん、1,200を超えると喉頭がんのリスクが高くなる」
 *   医科の禁煙外来では35歳以上の保険適用の基準となっている、と記載。
 *
 * 制度・基準の時点:
 * - 保険適用(ニコチン依存症管理料)の要件は診療報酬改定で変わる。上記の200以上という数値は
 *   厚生労働省の資料(2006年11月)によるもので、2026年7月29日時点でも
 *   35歳以上の患者に対する基準として用いられている。実際に受診できるかは医療機関に確認すること。
 *
 * 前提:
 * - 喫煙本数は1日あたりの「平均」本数。銘柄やタール量は考慮しない。
 * - リスク区分はあくまで目安であり、診断ではない。
 */
(function (global) {
  "use strict";

  var CIGARETTES_PER_PACK = 20;
  var MAX_CIGARETTES = 200;   // 1日の本数の上限
  var MAX_YEARS = 100;        // 喫煙年数の上限

  // 区分の境目。level は英小文字のキーで返し、日本語の説明は画面側で付ける。
  // 3つ目の値が true の区分は「超」(その値ちょうどは含まない)、false は「以上」。
  // 出典の表現に合わせる: 保険適用は「200以上」、がんリスクは「400を超えると」「1,200を超えると」。
  var LEVELS = [
    [1200, "over_1200", true],
    [600, "over_600", true],
    [400, "over_400", true],
    [200, "over_200", false]
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 指数からリスク区分のキーを求める。
   * @param {number} index ブリンクマン指数
   * @returns {"over_1200"|"over_600"|"over_400"|"over_200"|"under_200"}
   *   over_1200=1200超 / over_600=600超 / over_400=400超 /
   *   over_200=200以上(禁煙治療の保険適用の目安) / under_200=200未満
   */
  function levelOf(index) {
    for (var i = 0; i < LEVELS.length; i++) {
      var strict = LEVELS[i][2];
      if (strict ? index > LEVELS[i][0] : index >= LEVELS[i][0]) return LEVELS[i][1];
    }
    return "under_200";
  }

  /**
   * ブリンクマン指数を計算する。
   * @param {number} cigarettesPerDay 1日の平均喫煙本数(本。0以上200以下)
   * @param {number} years 喫煙年数(年。0以上100以下)
   * @returns {{ok:true, index:number, level:string, packYears:number, insuranceEligible:boolean}
   *          |{ok:false, code:"invalid_cigarettes"|"invalid_years"}}
   *   index は小数第1位で四捨五入。
   *   packYears は「1日の箱数 × 年数」(指数 ÷ 20)を小数第1位で四捨五入した参考値。
   *   insuranceEligible は指数が200以上かどうか(35歳以上の場合の保険適用の目安)。
   */
  function calculate(cigarettesPerDay, years) {
    if (!isFiniteNumber(cigarettesPerDay) || cigarettesPerDay < 0 || cigarettesPerDay > MAX_CIGARETTES) {
      return { ok: false, code: "invalid_cigarettes" };
    }
    if (!isFiniteNumber(years) || years < 0 || years > MAX_YEARS) {
      return { ok: false, code: "invalid_years" };
    }
    var raw = cigarettesPerDay * years;
    var index = Math.round(raw * 10) / 10;
    return {
      ok: true,
      index: index,
      level: levelOf(index),
      packYears: Math.round(raw / CIGARETTES_PER_PACK * 10) / 10,
      insuranceEligible: index >= 200
    };
  }

  /**
   * このまま吸い続けた場合、あと何年で目標の指数に達するかを求める。
   * @param {number} cigarettesPerDay 1日の平均喫煙本数(本。0より大きく200以下)
   * @param {number} years 現在までの喫煙年数(年。0以上100以下)
   * @param {number} targetIndex 目標とする指数(0より大きく100000以下。例: 400)
   * @returns {{ok:true, alreadyReached:boolean, moreYears:number}
   *          |{ok:false, code:"invalid_cigarettes"|"invalid_years"|"invalid_target"}}
   *   moreYears は小数第1位で四捨五入。すでに達している場合は 0 で alreadyReached=true。
   *   1日の本数が0本のときは達しないため invalid_cigarettes を返す(0除算を避ける)。
   */
  function yearsToReach(cigarettesPerDay, years, targetIndex) {
    var r = calculate(cigarettesPerDay, years);
    if (!r.ok) return r;
    if (cigarettesPerDay <= 0) return { ok: false, code: "invalid_cigarettes" };
    if (!isFiniteNumber(targetIndex) || targetIndex <= 0 || targetIndex > 100000) {
      return { ok: false, code: "invalid_target" };
    }
    if (r.index >= targetIndex) return { ok: true, alreadyReached: true, moreYears: 0 };
    var more = (targetIndex - r.index) / cigarettesPerDay;
    return { ok: true, alreadyReached: false, moreYears: Math.round(more * 10) / 10 };
  }

  var api = {
    levelOf: levelOf,
    calculate: calculate,
    yearsToReach: yearsToReach
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.BrinkmanCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
