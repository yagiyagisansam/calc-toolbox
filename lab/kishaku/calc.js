/*
 * 希釈倍率(液肥・洗剤・消毒液)の計算ロジック
 *
 * 根拠(一次情報):
 * - 千葉県 印旛保健所「消毒液の作り方(次亜塩素酸ナトリウムの希釈液)」
 *   https://www.pref.chiba.lg.jp/kenzu/hokenshi/saigai/documents/siryou10syoudokuekinotukurikata.pdf
 *   (2026年7月29日参照)
 *   0.02%を作る場合: 原液1%→50倍 / 6%→300倍 / 12%→600倍
 *   0.1% を作る場合: 原液1%→10倍 / 6%→60倍 / 12%→120倍
 *   → 希釈倍率 = 原液濃度 ÷ 目標濃度 であることが確認できる。
 *   同資料の「原液◯mL・水3㍑」という例は「水の量」を基準にした作り方である
 *   (例: 1%から0.1%を作る場合、水3Lに原液330mL ≒ 3000÷(10−1))。
 *
 * 基準の時点:
 * - 2026年7月29日時点の上記資料の記載内容にもとづく。
 *
 * 前提:
 * - 濃度は重量% または ppm。1% = 10,000ppm として換算する。
 * - 「できあがり量基準」は 原液量 + 水の量 = 指定した量 とする。
 *   「水の量基準」は 水の量を指定し、そこに原液を加える(できあがり量は増える)。
 * - 液体どうしを混ぜたときの体積変化・比重の違いは考慮しない(体積は単純に足し合わせる)。
 *
 * 丸め:
 * - 希釈倍率・液量はいずれも小数第2位に四捨五入する(計量カップ・スポイトで測れる精度に合わせる)。
 * - 判定・内部計算は丸める前の値で行う。
 */
(function (global) {
  "use strict";

  var PPM_PER_PERCENT = 10000;

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round2(v) { return Math.round(v * 100) / 100; }

  /**
   * 濃度を%に揃える。
   * @param {number} value 濃度の数値
   * @param {"percent"|"ppm"} unit 単位
   * @returns {number|null} %に換算した値。単位が不正なら null
   */
  function toPercent(value, unit) {
    if (!isNum(value)) return null;
    if (unit === "percent") return value;
    if (unit === "ppm") return value / PPM_PER_PERCENT;
    return null;
  }

  /**
   * 原液濃度と目標濃度から、希釈倍率と必要な原液量・水の量を求める。
   * @param {number} stockValue 原液の濃度
   * @param {"percent"|"ppm"} stockUnit 原液濃度の単位
   * @param {number} targetValue 作りたい濃度
   * @param {"percent"|"ppm"} targetUnit 作りたい濃度の単位
   * @param {number} amountMl 量(mL)。1〜1,000,000
   * @param {"total"|"water"} [basis="total"] amountMl の意味。
   *   total=できあがり量 / water=用意する水の量
   * @returns {{ok:true, ratio:number, stockMl:number, waterMl:number, totalMl:number,
   *            stockPercent:number, targetPercent:number, targetPpm:number}
   *          |{ok:false, code:"invalid_unit"|"invalid_stock"|"invalid_target"|"invalid_amount"|"invalid_basis"|"invalid_ratio"}}
   *   ratio = 原液濃度 ÷ 目標濃度(希釈倍率)。
   */
  function byConcentration(stockValue, stockUnit, targetValue, targetUnit, amountMl, basis) {
    var s = toPercent(stockValue, stockUnit);
    var t = toPercent(targetValue, targetUnit);
    if (s === null || t === null) return { ok: false, code: "invalid_unit" };
    if (s <= 0 || s > 100) return { ok: false, code: "invalid_stock" };
    if (t <= 0 || t > s) return { ok: false, code: "invalid_target" };
    var b = basis === undefined || basis === null || basis === "" ? "total" : basis;
    if (b !== "total" && b !== "water") return { ok: false, code: "invalid_basis" };
    if (!isNum(amountMl) || amountMl <= 0 || amountMl > 1000000) return { ok: false, code: "invalid_amount" };

    var ratio = s / t;
    var r = amounts(ratio, amountMl, b);
    if (!r.ok) return r;
    return {
      ok: true,
      ratio: round2(ratio),
      stockMl: r.stockMl,
      waterMl: r.waterMl,
      totalMl: r.totalMl,
      stockPercent: round2(s),
      targetPercent: t,
      targetPpm: round2(t * PPM_PER_PERCENT)
    };
  }

  /**
   * 希釈倍率を直接指定して、必要な原液量・水の量を求める。
   * @param {number} ratio 希釈倍率(◯倍)。1〜1,000,000
   * @param {number} amountMl 量(mL)。1〜1,000,000
   * @param {"total"|"water"} [basis="total"] amountMl の意味
   * @returns {{ok:true, ratio:number, stockMl:number, waterMl:number, totalMl:number}
   *          |{ok:false, code:"invalid_ratio"|"invalid_amount"|"invalid_basis"}}
   */
  function byRatio(ratio, amountMl, basis) {
    if (!isNum(ratio) || ratio < 1 || ratio > 1000000) return { ok: false, code: "invalid_ratio" };
    var b = basis === undefined || basis === null || basis === "" ? "total" : basis;
    if (b !== "total" && b !== "water") return { ok: false, code: "invalid_basis" };
    if (!isNum(amountMl) || amountMl <= 0 || amountMl > 1000000) return { ok: false, code: "invalid_amount" };
    var r = amounts(ratio, amountMl, b);
    if (!r.ok) return r;
    return { ok: true, ratio: round2(ratio), stockMl: r.stockMl, waterMl: r.waterMl, totalMl: r.totalMl };
  }

  /**
   * 希釈倍率と量から原液量・水の量・できあがり量を求める(内部用)。
   * @param {number} ratio 希釈倍率
   * @param {number} amountMl 量(mL)
   * @param {"total"|"water"} basis 量の意味
   * @returns {{ok:true, stockMl:number, waterMl:number, totalMl:number}|{ok:false, code:"invalid_ratio"}}
   */
  function amounts(ratio, amountMl, basis) {
    var stock;
    var total;
    if (basis === "total") {
      stock = amountMl / ratio;
      total = amountMl;
    } else {
      // 水の量基準。ratio が1(希釈しない)だと水を加えられないため計算できない
      if (ratio <= 1) return { ok: false, code: "invalid_ratio" };
      stock = amountMl / (ratio - 1);
      total = amountMl + stock;
    }
    return {
      ok: true,
      stockMl: round2(stock),
      waterMl: round2(total - stock),
      totalMl: round2(total)
    };
  }

  /**
   * 原液濃度と希釈倍率から、希釈後の濃度を求める。
   * @param {number} stockValue 原液の濃度
   * @param {"percent"|"ppm"} stockUnit 原液濃度の単位
   * @param {number} ratio 希釈倍率(◯倍)。1〜1,000,000
   * @returns {{ok:true, percent:number, ppm:number}
   *          |{ok:false, code:"invalid_unit"|"invalid_stock"|"invalid_ratio"}}
   *   percent は有効数字を保つため小数第6位まで残す。
   */
  function resultConcentration(stockValue, stockUnit, ratio) {
    var s = toPercent(stockValue, stockUnit);
    if (s === null) return { ok: false, code: "invalid_unit" };
    if (s <= 0 || s > 100) return { ok: false, code: "invalid_stock" };
    if (!isNum(ratio) || ratio < 1 || ratio > 1000000) return { ok: false, code: "invalid_ratio" };
    var p = s / ratio;
    return {
      ok: true,
      percent: Math.round(p * 1000000) / 1000000,
      ppm: round2(p * PPM_PER_PERCENT)
    };
  }

  var api = {
    toPercent: toPercent,
    byConcentration: byConcentration,
    byRatio: byRatio,
    resultConcentration: resultConcentration
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KishakuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
