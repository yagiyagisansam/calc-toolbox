/*
 * 高額療養費 自己負担限度額の計算ロジック
 *
 * 根拠(一次情報):
 * - 厚生労働省保険局「高額療養費制度を利用される皆さまへ(平成30年8月診療分から)」
 *   https://www.mhlw.go.jp/content/000333280.pdf (2026年7月29日参照)
 *   → period "current"(平成30年8月診療分〜令和8年7月診療分)の限度額・多数回該当の額
 * - 厚生労働省「高額療養費制度の見直しについて(令和8年8月診療分から)」
 *   https://www.mhlw.go.jp/content/001726232.pdf (2026年7月29日参照)
 *   → period "r8"(令和8年8月診療分〜令和9年7月診療分)の限度額・多数回該当の額・年間上限
 * - 厚生労働省 高額療養費制度のページ
 *   https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/juuyou/kougakuiryou/index.html
 *   (2026年7月29日参照)
 *
 * 前提:
 * - ひと月(月の初めから終わりまで)・1つの医療機関等での自己負担を対象にした概算
 * - 世帯合算(同じ医療保険の家族分の合算)、高額介護合算療養費は含まない
 * - 入院時の食費・居住費、差額ベッド代、先進医療にかかる費用は対象外(総医療費に含めないこと)
 * - 健康保険組合の付加給付、自治体の医療費助成、人工透析等の特例(月1万円)は反映しない
 * - 窓口負担額は「総医療費 × 負担割合」を1円未満四捨五入して求める概算
 *   (実際は医療機関ごとに端数処理が入るため数十円ずれることがある)
 * - 令和9年8月診療分からは所得区分がさらに細分化されるが、本ツールは未対応
 */
(function (global) {
  "use strict";

  // 限度額の定義
  //   base   : 定額の限度額(円)。formula がある場合は使わない
  //   formula: [基準額(円), 医療費の控除額(円)] → 基準額 + (総医療費 − 控除額) × 1%
  //   multi  : 多数回該当の限度額(円)。null は多数回該当の適用なし
  //   out    : 70歳以上の外来(個人ごと)の限度額(円)。null は世帯の限度額と同じ
  //   year   : 年単位の上限額(円)。null は制度なし
  var TABLE = {
    current: {
      u70_a: { formula: [252600, 842000], multi: 140100, out: null, year: null },
      u70_i: { formula: [167400, 558000], multi: 93000, out: null, year: null },
      u70_u: { formula: [80100, 267000], multi: 44400, out: null, year: null },
      u70_e: { base: 57600, multi: 44400, out: null, year: null },
      u70_o: { base: 35400, multi: 24600, out: null, year: null },
      o70_g3: { formula: [252600, 842000], multi: 140100, out: null, year: null },
      o70_g2: { formula: [167400, 558000], multi: 93000, out: null, year: null },
      o70_g1: { formula: [80100, 267000], multi: 44400, out: null, year: null },
      o70_ippan: { base: 57600, multi: 44400, out: 18000, year: null },
      o70_low2: { base: 24600, multi: null, out: 8000, year: null },
      o70_low1: { base: 15000, multi: null, out: 8000, year: null }
    },
    r8: {
      u70_a: { formula: [270300, 901000], multi: 140100, out: null, year: 1680000 },
      u70_i: { formula: [179100, 597000], multi: 93000, out: null, year: 1110000 },
      u70_u: { formula: [85800, 286000], multi: 44400, out: null, year: 530000 },
      u70_e: { base: 61500, multi: 44400, out: null, year: 530000 },
      u70_o: { base: 36900, multi: 24600, out: null, year: 290000 },
      o70_g3: { formula: [270300, 901000], multi: 140100, out: null, year: 1680000 },
      o70_g2: { formula: [179100, 597000], multi: 93000, out: null, year: 1110000 },
      o70_g1: { formula: [85800, 286000], multi: 44400, out: null, year: 530000 },
      o70_ippan: { base: 61500, multi: 44400, out: 22000, year: 530000 },
      o70_low2: { base: 25700, multi: 24600, out: 11000, year: 290000 },
      o70_low1: { base: 15700, multi: null, out: 8000, year: 180000 }
    }
  };

  var MAX_TOTAL = 100000000; // 総医療費の上限: 1億円
  var RATES = [10, 20, 30];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 所得区分と適用時期から、ひと月の自己負担限度額を求める。
   * @param {number} totalYen 1か月の総医療費(10割。保険適用分のみ)
   * @param {string} category 所得区分。70歳未満: "u70_a"|"u70_i"|"u70_u"|"u70_e"|"u70_o"
   *   70歳以上: "o70_g3"|"o70_g2"|"o70_g1"(現役並みIII/II/I)|"o70_ippan"(一般)|"o70_low2"|"o70_low1"(住民税非課税II/I)
   * @param {boolean} multiple 多数回該当(過去12か月で4回目以降)かどうか
   * @param {string} period "current"(令和8年7月診療分まで)|"r8"(令和8年8月〜令和9年7月診療分)
   * @param {boolean} outpatientOnly 70歳以上で外来(個人ごと)の限度額を使うかどうか
   * @returns {{ok:true, limitYen:number, kind:"formula"|"base"|"multiple"|"outpatient",
   *            multipleApplied:boolean, yearLimitYen:number|null}
   *          |{ok:false, code:"invalid_total"|"invalid_category"|"invalid_period"|"invalid_multiple"|"invalid_outpatient"}}
   *   limitYen は1円未満を切り捨てた金額。
   */
  function limit(totalYen, category, multiple, period, outpatientOnly) {
    if (!isFiniteNumber(totalYen) || totalYen < 0 || totalYen > MAX_TOTAL) {
      return { ok: false, code: "invalid_total" };
    }
    if (period === undefined) period = "current";
    if (!TABLE[period]) return { ok: false, code: "invalid_period" };
    var row = TABLE[period][category];
    if (!row) return { ok: false, code: "invalid_category" };
    if (multiple === undefined) multiple = false;
    if (typeof multiple !== "boolean") return { ok: false, code: "invalid_multiple" };
    if (outpatientOnly === undefined) outpatientOnly = false;
    if (typeof outpatientOnly !== "boolean") return { ok: false, code: "invalid_outpatient" };

    var kind, value;
    if (outpatientOnly && row.out !== null && !multiple) {
      kind = "outpatient";
      value = row.out;
    } else if (multiple && row.multi !== null) {
      kind = "multiple";
      value = row.multi;
    } else if (row.formula) {
      kind = "formula";
      value = row.formula[0] + (totalYen - row.formula[1]) * 0.01;
    } else {
      kind = "base";
      value = row.base;
    }

    return {
      ok: true,
      limitYen: Math.floor(value),
      kind: kind,
      multipleApplied: kind === "multiple",
      yearLimitYen: row.year
    };
  }

  /**
   * 窓口負担額・自己負担限度額・払い戻し額をまとめて求める。
   * @param {number} totalYen 1か月の総医療費(10割。保険適用分のみ)
   * @param {number} ratePercent 窓口負担割合(10・20・30 のいずれか。%)
   * @param {string} category 所得区分(limit() と同じ)
   * @param {boolean} multiple 多数回該当かどうか
   * @param {string} period "current"|"r8"
   * @param {boolean} outpatientOnly 70歳以上で外来(個人ごと)の限度額を使うかどうか
   * @returns {{ok:true, windowYen:number, limitYen:number, refundYen:number, finalYen:number,
   *            kind:string, multipleApplied:boolean, yearLimitYen:number|null, applied:boolean}
   *          |{ok:false, code:string}}
   *   windowYen は高額療養費を使わなかった場合の窓口負担(1円未満四捨五入)。
   *   refundYen は払い戻される額(窓口負担が限度額以下なら0)。finalYen は最終的な自己負担。
   *   applied は高額療養費の対象になるか(refundYen > 0)。
   */
  function calculate(totalYen, ratePercent, category, multiple, period, outpatientOnly) {
    var l = limit(totalYen, category, multiple, period, outpatientOnly);
    if (!l.ok) return l;
    if (!isFiniteNumber(ratePercent) || RATES.indexOf(ratePercent) === -1) {
      return { ok: false, code: "invalid_rate" };
    }
    var windowYen = Math.round(totalYen * ratePercent / 100);
    var refundYen = Math.max(0, windowYen - l.limitYen);
    return {
      ok: true,
      windowYen: windowYen,
      limitYen: l.limitYen,
      refundYen: refundYen,
      finalYen: windowYen - refundYen,
      kind: l.kind,
      multipleApplied: l.multipleApplied,
      yearLimitYen: l.yearLimitYen,
      applied: refundYen > 0
    };
  }

  /**
   * 高額療養費の対象になる総医療費の下限(窓口負担がちょうど限度額に達する総医療費)を求める。
   * 定額の区分でのみ意味を持つ。1%加算のある区分では加算後の限度額に達する額を返す。
   * @param {number} ratePercent 窓口負担割合(10・20・30。%)
   * @param {string} category 所得区分
   * @param {boolean} multiple 多数回該当かどうか
   * @param {string} period "current"|"r8"
   * @returns {{ok:true, thresholdYen:number}|{ok:false, code:string}}
   *   thresholdYen はこの総医療費を超えると払い戻しが発生する金額(1円未満切り上げ)。
   */
  function threshold(ratePercent, category, multiple, period) {
    if (!isFiniteNumber(ratePercent) || RATES.indexOf(ratePercent) === -1) {
      return { ok: false, code: "invalid_rate" };
    }
    if (period === undefined) period = "current";
    if (!TABLE[period]) return { ok: false, code: "invalid_period" };
    var row = TABLE[period][category];
    if (!row) return { ok: false, code: "invalid_category" };
    if (multiple === undefined) multiple = false;
    if (typeof multiple !== "boolean") return { ok: false, code: "invalid_multiple" };

    var r = ratePercent / 100;
    if (multiple && row.multi !== null) {
      return { ok: true, thresholdYen: Math.ceil(row.multi / r) };
    }
    if (row.formula) {
      // 総医療費 T について T×r = base + (T − sub)×0.01 を解く
      var base = row.formula[0];
      var sub = row.formula[1];
      return { ok: true, thresholdYen: Math.ceil((base - sub * 0.01) / (r - 0.01)) };
    }
    return { ok: true, thresholdYen: Math.ceil(row.base / r) };
  }

  var api = {
    limit: limit,
    calculate: calculate,
    threshold: threshold
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KogakuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
