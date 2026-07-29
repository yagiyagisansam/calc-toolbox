/*
 * 不動産取得税 計算ロジック
 *
 * 根拠(一次情報):
 * - 東京都主税局「不動産取得税」(税率・免税点・課税標準の特例・軽減制度の計算式)
 *   https://www.tax.metro.tokyo.lg.jp/shisan/fudosan.html (2026年7月29日参照)
 * - 総務省「地方税制度 不動産取得税」
 *   https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/150790_17.html (2026年7月29日参照)
 * - 国土交通省「住宅:不動産取得税に係る特例措置」(税率3%・控除1,200万円・適用期限)
 *   https://www.mlit.go.jp/jutakukentiku/house/jutakukentiku_house_tk2_000020.html (2026年7月29日参照)
 *
 * 前提:
 * - 不動産取得税は都道府県税。税率・特例は令和8年(2026年)7月時点の東京都の記載に基づく。
 *   税率3%(土地・住宅)と宅地の課税標準1/2は令和9年3月31日までの特例。
 * - 「不動産の価格」は固定資産税評価額であり、購入価格や建築工事費ではない。
 * - 併用住宅・共有・長期優良住宅・買取再販などの個別の取扱いは含まない。
 * - 免税点は令和8年4月1日以降の取得の額(土地16万円・新築等の家屋66万円・その他の家屋34万円)。
 * - 軽減を受けるには床面積などの要件と申告が必要。ここでの計算は要件を満たす前提の目安。
 */
(function (global) {
  "use strict";

  var RATE_LAND = 0.03; // 土地(令和9年3月31日まで)
  var RATE_HOUSE = 0.03; // 家屋(住宅)(令和9年3月31日まで)
  var RATE_NON_HOUSE = 0.04; // 家屋(非住宅)
  var NEW_HOUSE_DEDUCTION = 12000000; // 新築住宅の控除額(円)
  var LAND_REDUCTION_FLAT = 45000; // 土地の減額額(ア)
  var LAND_AREA_CAP = 200; // 住宅の床面積の2倍の上限(㎡)
  var MAX_VALUE = 1e12; // 評価額の上限(円)。これを超える入力は誤入力とみなす

  // 中古住宅の控除額(新築された日の区分ごと。円)
  var USED_DEDUCTIONS = [
    { from: [1981, 7, 1], to: [1985, 6, 30], amount: 4200000 }, // 昭和56年7月1日〜昭和60年6月30日
    { from: [1985, 7, 1], to: [1989, 3, 31], amount: 4500000 }, // 昭和60年7月1日〜平成元年3月31日
    { from: [1989, 4, 1], to: [1997, 3, 31], amount: 10000000 }, // 平成元年4月1日〜平成9年3月31日
    { from: [1997, 4, 1], to: null, amount: 12000000 } // 平成9年4月1日以後
  ];

  // 免税点(課税標準となるべき額がこの額未満なら課税されない。円)
  var EXEMPTION_BEFORE_2026_04 = { land: 100000, newBuilding: 230000, otherBuilding: 120000 };
  var EXEMPTION_FROM_2026_04 = { land: 160000, newBuilding: 660000, otherBuilding: 340000 };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function ymdNumber(y, m, d) {
    return y * 10000 + m * 100 + d;
  }

  function validValue(v) {
    return isFiniteNumber(v) && v >= 0 && v <= MAX_VALUE;
  }

  /**
   * 住宅(家屋)の不動産取得税額を求める
   * @param {number} value 家屋の固定資産税評価額(円)
   * @param {number} deduction 控除額(円)。新築住宅は12000000、中古住宅は usedHouseDeduction の値
   * @returns {{ok:true, taxableBase:number, rate:number, tax:number}
   *          |{ok:false, code:"invalid_value"|"invalid_deduction"}}
   *   taxableBase: 控除後の課税標準(円。マイナスにはならず0で止まる)
   *   tax: 税額(円、1円未満切り捨て)
   */
  function houseTax(value, deduction) {
    if (!validValue(value)) return { ok: false, code: "invalid_value" };
    if (!isFiniteNumber(deduction) || deduction < 0 || deduction > MAX_VALUE) {
      return { ok: false, code: "invalid_deduction" };
    }
    var base = Math.max(0, value - deduction);
    return { ok: true, taxableBase: base, rate: RATE_HOUSE, tax: Math.floor(base * RATE_HOUSE) };
  }

  /**
   * 住宅以外の家屋(店舗・事務所など)の不動産取得税額を求める
   * @param {number} value 家屋の固定資産税評価額(円)
   * @returns {{ok:true, taxableBase:number, rate:number, tax:number}|{ok:false, code:"invalid_value"}}
   */
  function nonHouseTax(value) {
    if (!validValue(value)) return { ok: false, code: "invalid_value" };
    return { ok: true, taxableBase: value, rate: RATE_NON_HOUSE, tax: Math.floor(value * RATE_NON_HOUSE) };
  }

  /**
   * 中古住宅の控除額を新築された日から求める
   * @param {number} builtYear 新築された年(西暦)
   * @param {number} builtMonth 新築された月(1〜12)
   * @returns {{ok:true, deduction:number, fromYmd:string, toYmd:(string|null)}
   *          |{ok:false, code:"invalid_built_date"|"built_before_1981_07"}}
   *   昭和56年6月30日以前の新築は控除額が個別に定まるため built_before_1981_07 を返す
   */
  function usedHouseDeduction(builtYear, builtMonth) {
    if (!isFiniteNumber(builtYear) || !isFiniteNumber(builtMonth)) {
      return { ok: false, code: "invalid_built_date" };
    }
    if (builtYear < 1900 || builtYear > 2200 || builtMonth < 1 || builtMonth > 12) {
      return { ok: false, code: "invalid_built_date" };
    }
    // 月単位の入力なので、その月の1日を基準に判定する
    var v = ymdNumber(Math.floor(builtYear), Math.floor(builtMonth), 1);
    if (v < ymdNumber(1981, 7, 1)) return { ok: false, code: "built_before_1981_07" };
    for (var i = 0; i < USED_DEDUCTIONS.length; i++) {
      var r = USED_DEDUCTIONS[i];
      var lo = ymdNumber(r.from[0], r.from[1], r.from[2]);
      var hi = r.to === null ? Infinity : ymdNumber(r.to[0], r.to[1], r.to[2]);
      if (v >= lo && v <= hi) {
        return {
          ok: true,
          deduction: r.amount,
          fromYmd: r.from.join("-"),
          toYmd: r.to === null ? null : r.to.join("-")
        };
      }
    }
    return { ok: false, code: "invalid_built_date" };
  }

  /**
   * 住宅の敷地(土地)の不動産取得税額を、軽減を当てはめて求める
   * 東京都主税局の計算式:
   *   当初税額 = 価格 × 1/2 × 3%
   *   減額額   = ア 45,000円 と イ (価格×1/2÷地積)×住宅の床面積の2倍(上限200㎡)×持分×3% の大きい方
   *   納付税額 = 当初税額 − 減額額
   * @param {number} landValue 土地の固定資産税評価額(円)
   * @param {number} landAreaM2 土地の地積(㎡)。0より大きいこと
   * @param {number} floorAreaM2 住宅の床面積(㎡)。0より大きいこと
   * @param {number} share 住宅の持分(0より大きく1以下。単独所有なら1)
   * @returns {{ok:true, baseTax:number, reductionA:number, reductionB:number,
   *            reduction:number, tax:number, cappedArea:number, unitPrice:number}
   *          |{ok:false, code:"invalid_value"|"invalid_land_area"|"invalid_floor_area"|"invalid_share"}}
   *   baseTax: 当初税額(円、1円未満切り捨て)
   *   reduction: 実際に減額される額(円、1円未満切り捨て)
   *   tax: 納付税額(円。マイナスにはならず0で止まる)
   *   cappedArea: 計算に使った「住宅の床面積の2倍(上限200㎡)」(㎡)
   */
  function landTax(landValue, landAreaM2, floorAreaM2, share) {
    if (!validValue(landValue)) return { ok: false, code: "invalid_value" };
    if (!isFiniteNumber(landAreaM2) || landAreaM2 <= 0 || landAreaM2 > 1e7) {
      return { ok: false, code: "invalid_land_area" };
    }
    if (!isFiniteNumber(floorAreaM2) || floorAreaM2 <= 0 || floorAreaM2 > 1e5) {
      return { ok: false, code: "invalid_floor_area" };
    }
    if (!isFiniteNumber(share) || share <= 0 || share > 1) {
      return { ok: false, code: "invalid_share" };
    }
    var halfValue = landValue / 2;
    var baseTax = Math.floor(halfValue * RATE_LAND);
    var unitPrice = halfValue / landAreaM2;
    var cappedArea = Math.min(floorAreaM2 * 2, LAND_AREA_CAP);
    var reductionB = Math.floor(unitPrice * cappedArea * share * RATE_LAND);
    var reduction = Math.max(LAND_REDUCTION_FLAT, reductionB);
    return {
      ok: true,
      baseTax: baseTax,
      reductionA: LAND_REDUCTION_FLAT,
      reductionB: reductionB,
      reduction: reduction,
      tax: Math.max(0, baseTax - reduction),
      cappedArea: cappedArea,
      unitPrice: Math.round(unitPrice)
    };
  }

  /**
   * 住宅の軽減を受けない土地(宅地)の不動産取得税額を求める
   * 宅地等は令和9年3月31日までの取得なら課税標準が価格の1/2になる
   * @param {number} landValue 土地の固定資産税評価額(円)
   * @param {boolean} isResidentialLand 宅地等(宅地及び宅地評価された土地)なら true
   * @returns {{ok:true, taxableBase:number, rate:number, tax:number}|{ok:false, code:"invalid_value"}}
   */
  function plainLandTax(landValue, isResidentialLand) {
    if (!validValue(landValue)) return { ok: false, code: "invalid_value" };
    var base = isResidentialLand ? landValue / 2 : landValue;
    return { ok: true, taxableBase: base, rate: RATE_LAND, tax: Math.floor(base * RATE_LAND) };
  }

  /**
   * 免税点(この額未満なら課税されない課税標準の額)を返す
   * @param {string} kind "land"=土地 / "newBuilding"=新築・増築・改築した家屋 / "otherBuilding"=売買などその他の家屋
   * @param {number} acquiredYear 取得した年(西暦)
   * @param {number} acquiredMonth 取得した月(1〜12)
   * @returns {{ok:true, limit:number}|{ok:false, code:"invalid_kind"|"invalid_date"}}
   *   令和8年(2026年)4月1日以降の取得は引き上げ後の額を返す
   */
  function exemptionLimit(kind, acquiredYear, acquiredMonth) {
    if (kind !== "land" && kind !== "newBuilding" && kind !== "otherBuilding") {
      return { ok: false, code: "invalid_kind" };
    }
    if (!isFiniteNumber(acquiredYear) || !isFiniteNumber(acquiredMonth) ||
      acquiredYear < 1900 || acquiredYear > 2200 || acquiredMonth < 1 || acquiredMonth > 12) {
      return { ok: false, code: "invalid_date" };
    }
    var v = ymdNumber(Math.floor(acquiredYear), Math.floor(acquiredMonth), 1);
    var t = v >= ymdNumber(2026, 4, 1) ? EXEMPTION_FROM_2026_04 : EXEMPTION_BEFORE_2026_04;
    return { ok: true, limit: t[kind] };
  }

  /**
   * 新築住宅とその敷地をまとめて計算する
   * @param {number} houseValue 家屋の固定資産税評価額(円)
   * @param {number} landValue 土地の固定資産税評価額(円)
   * @param {number} landAreaM2 土地の地積(㎡)
   * @param {number} floorAreaM2 住宅の床面積(㎡)
   * @returns {{ok:true, houseTax:number, landTax:number, total:number,
   *            houseBefore:number, landBefore:number, totalBefore:number, saved:number}
   *          |{ok:false, code:string}}
   *   houseBefore/landBefore: 軽減を使わなかった場合の税額(円)
   *   saved: 軽減で減る額(円)
   */
  function newHouseTotal(houseValue, landValue, landAreaM2, floorAreaM2) {
    var h = houseTax(houseValue, NEW_HOUSE_DEDUCTION);
    if (!h.ok) return h;
    var l = landTax(landValue, landAreaM2, floorAreaM2, 1);
    if (!l.ok) return l;
    var hBefore = Math.floor(houseValue * RATE_HOUSE);
    var lBefore = l.baseTax;
    return {
      ok: true,
      houseTax: h.tax,
      landTax: l.tax,
      total: h.tax + l.tax,
      houseBefore: hBefore,
      landBefore: lBefore,
      totalBefore: hBefore + lBefore,
      saved: (hBefore + lBefore) - (h.tax + l.tax)
    };
  }

  var api = {
    houseTax: houseTax,
    nonHouseTax: nonHouseTax,
    usedHouseDeduction: usedHouseDeduction,
    landTax: landTax,
    plainLandTax: plainLandTax,
    exemptionLimit: exemptionLimit,
    newHouseTotal: newHouseTotal,
    NEW_HOUSE_DEDUCTION: NEW_HOUSE_DEDUCTION
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ShutokuzeiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
