/*
 * 登録免許税(不動産登記)の計算ロジック
 *
 * 根拠(一次情報):
 * - 国税庁 タックスアンサー No.7191「登録免許税の税額表」[令和7年4月1日現在法令等]
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7191.htm (2026年7月29日参照)
 * - 国税庁「登録免許税の税率の軽減措置に関するお知らせ」(令和8年4月・税務署)
 *   https://www.nta.go.jp/publication/pamph/sonota/0020003-124_01.pdf (2026年7月29日参照)
 *   令和8年度税制改正により、土地の売買による所有権移転登記の軽減(1.5%)の適用期限が
 *   【令和11年3月31日】まで3年延長された。住宅用家屋の軽減(保存0.15%・移転0.3%)および
 *   住宅取得資金の抵当権設定の軽減(0.1%)の適用期限は【令和9年3月31日】まで。
 * - 登録免許税法(昭和42年法律第35号) 別表第一・第15条・第19条
 *   https://laws.e-gov.go.jp/law/342AC0000000035 (2026年7月29日参照)
 *   第15条: 課税標準の全額が千円に満たないときは千円とする
 *   第19条: 税率を適用して計算した金額が千円に満たない場合は千円とする
 *   別表第一 一(五): 抵当権の設定の登記は「債権金額」に1000分の4
 * - 国税通則法(昭和37年法律第66号) 第118条第1項・第119条第1項
 *   https://laws.e-gov.go.jp/law/337AC0000000066 (2026年7月29日参照)
 *   第118条第1項: 課税標準の千円未満の端数は切り捨てる
 *   第119条第1項: 確定金額の百円未満の端数は切り捨てる
 *
 * 税率の時点:
 * - 本モジュールの税率・軽減措置の期限はすべて【2026年(令和8年)7月29日時点】のもの。
 *
 * 前提:
 * - 課税標準の「不動産の価額」は固定資産課税台帳に登録された価格(固定資産税評価額)。
 *   売買価格や住宅ローンの借入額ではない。
 * - 住宅用家屋の軽減を受けるには市区町村長の証明書の添付、床面積50平方メートル以上、
 *   取得後1年以内の登記などの要件がある。本計算では要件の判定は行わない。
 * - 認定長期優良住宅・認定低炭素住宅などのさらに低い税率(0.1%等)は扱わない。
 * - 司法書士報酬など登録免許税以外の費用は含まない。
 */
(function (global) {
  "use strict";

  var VALUE_MAX = 100000000000; // 課税標準の上限(円、1000億円)
  var MENZEI_LIMIT = 1000000; // 相続による土地の登記の免税上限(円、課税標準100万円以下)

  // 登記の種類ごとの税率(1万分率で保持し、整数計算で端数誤差を避ける)
  // key: [本則, 軽減, 説明]
  var KINDS = {
    hozon: { normal: 40, genmen: 15, land: false }, // 建物 所有権保存(0.4% / 住宅用家屋0.15%)
    baibai_tochi: { normal: 200, genmen: 150, land: true }, // 土地 売買による移転(2.0% / 軽減1.5%)
    baibai_tateya: { normal: 200, genmen: 30, land: false }, // 建物 売買による移転(2.0% / 住宅用家屋0.3%)
    sozoku_tochi: { normal: 40, genmen: null, land: true }, // 土地 相続による移転(0.4%)
    sozoku_tateya: { normal: 40, genmen: null, land: false }, // 建物 相続による移転(0.4%)
    zoyo: { normal: 200, genmen: null, land: false } // 贈与・交換・収用等による移転(2.0%)
  };
  var TEITOKEN_NORMAL = 40; // 抵当権設定 本則(債権金額の0.4%)
  var TEITOKEN_GENMEN = 10; // 住宅取得資金の貸付け等に係る抵当権設定(0.1%)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 課税標準を求める(国税通則法118条1項で千円未満切り捨て、登録免許税法15条で最低千円)。
   * @param {number} value 不動産の価額または債権金額(円)
   * @returns {number} 課税標準(円)
   */
  function taxBase(value) {
    var base = Math.floor(value / 1000) * 1000;
    return base < 1000 ? 1000 : base;
  }

  /**
   * 課税標準と1万分率の税率から税額を求める。
   * 国税通則法119条1項で百円未満切り捨て、登録免許税法19条で最低千円。
   * @param {number} base 課税標準(円、千円単位)
   * @param {number} per10000 税率(1万分率。0.4%なら40)
   * @returns {number} 税額(円)
   */
  function taxAmount(base, per10000) {
    // base は千円の倍数なので (base/1000) * per10000 / 10 で整数計算できる
    var raw = Math.floor((base / 1000) * per10000 / 10);
    var rounded = Math.floor(raw / 100) * 100;
    return rounded < 1000 ? 1000 : rounded;
  }

  /**
   * 不動産の所有権登記にかかる登録免許税を計算する。
   * @param {number} value 固定資産税評価額(不動産の価額。円、0より大きい)
   * @param {string} kind 登記の種類。"hozon"(建物の所有権保存) / "baibai_tochi"(土地の売買移転) /
   *   "baibai_tateya"(建物の売買移転) / "sozoku_tochi"(土地の相続移転) /
   *   "sozoku_tateya"(建物の相続移転) / "zoyo"(贈与・交換・収用等の移転)
   * @param {boolean} [genmen=false] 軽減税率を適用するか
   *   土地の売買移転では租税特別措置法72条(令和11年3月31日まで)、
   *   建物では住宅用家屋の軽減(令和9年3月31日まで)を指す
   * @returns {{ok:true, base:number, ratePct:number, tax:number, genmenApplied:boolean, exempt:boolean}
   *          |{ok:false, code:"invalid_value"|"invalid_kind"|"genmen_not_available"}}
   *   base: 課税標準(円、千円未満切り捨て)
   *   ratePct: 適用した税率(%)
   *   tax: 登録免許税額(円、百円未満切り捨て。最低1,000円)
   *   exempt: 相続による土地の登記で課税標準100万円以下のため免税になった場合 true
   */
  function calculate(value, kind, genmen) {
    if (!isFiniteNumber(value) || value <= 0 || value > VALUE_MAX) {
      return { ok: false, code: "invalid_value" };
    }
    if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(KINDS, kind)) {
      return { ok: false, code: "invalid_kind" };
    }
    var spec = KINDS[kind];
    var useGenmen = genmen === true;
    if (useGenmen && spec.genmen === null) {
      return { ok: false, code: "genmen_not_available" };
    }
    var base = taxBase(value);

    // 相続による土地の所有権移転登記等は、課税標準が100万円以下なら免税(措法84の2の3第2項)
    if (kind === "sozoku_tochi" && base <= MENZEI_LIMIT) {
      return { ok: true, base: base, ratePct: 0.4, tax: 0, genmenApplied: false, exempt: true };
    }

    var per10000 = useGenmen ? spec.genmen : spec.normal;
    return {
      ok: true,
      base: base,
      ratePct: per10000 / 100,
      tax: taxAmount(base, per10000),
      genmenApplied: useGenmen,
      exempt: false
    };
  }

  /**
   * 抵当権設定登記にかかる登録免許税を計算する(課税標準は債権金額＝借入額)。
   * @param {number} loan 債権金額(住宅ローンの借入額。円、0より大きい)
   * @param {boolean} [genmen=false] 住宅取得資金の貸付け等の軽減(0.1%)を適用するか
   * @returns {{ok:true, base:number, ratePct:number, tax:number, genmenApplied:boolean}
   *          |{ok:false, code:"invalid_loan"}}
   */
  function teitoken(loan, genmen) {
    if (!isFiniteNumber(loan) || loan <= 0 || loan > VALUE_MAX) {
      return { ok: false, code: "invalid_loan" };
    }
    var useGenmen = genmen === true;
    var per10000 = useGenmen ? TEITOKEN_GENMEN : TEITOKEN_NORMAL;
    var base = taxBase(loan);
    return {
      ok: true,
      base: base,
      ratePct: per10000 / 100,
      tax: taxAmount(base, per10000),
      genmenApplied: useGenmen
    };
  }

  /**
   * 住宅購入時の登録免許税(土地の移転＋建物の登記＋抵当権設定)を合計する。
   * @param {number} landValue 土地の固定資産税評価額(円)
   * @param {number} buildingValue 建物の固定資産税評価額(円)
   * @param {string} buildingKind 建物の登記の種類("hozon" 新築の保存 / "baibai_tateya" 中古の売買移転)
   * @param {boolean} genmen 軽減税率を適用するか(土地・建物・抵当権すべてに適用)
   * @param {number} loan 住宅ローンの借入額(円。0なら抵当権設定を計算しない)
   * @returns {{ok:true, land:object, building:object, teitoken:(object|null), total:number}
   *          |{ok:false, code:string}}
   *   total: 3つの登記の税額の合計(円)
   */
  function purchaseTotal(landValue, buildingValue, buildingKind, genmen, loan) {
    if (buildingKind !== "hozon" && buildingKind !== "baibai_tateya") {
      return { ok: false, code: "invalid_kind" };
    }
    var land = calculate(landValue, "baibai_tochi", genmen);
    if (!land.ok) return land;
    var building = calculate(buildingValue, buildingKind, genmen);
    if (!building.ok) return building;
    var t = null;
    if (isFiniteNumber(loan) && loan > 0) {
      t = teitoken(loan, genmen);
      if (!t.ok) return t;
    }
    return {
      ok: true,
      land: land,
      building: building,
      teitoken: t,
      total: land.tax + building.tax + (t ? t.tax : 0)
    };
  }

  var api = {
    calculate: calculate,
    teitoken: teitoken,
    purchaseTotal: purchaseTotal
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TorokuzeiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
