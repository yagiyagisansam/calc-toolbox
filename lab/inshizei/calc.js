/*
 * 印紙税額の判定ロジック
 *
 * 税額の時点: 2026年7月時点(国税庁タックスアンサーの「令和7年4月1日現在法令等」の内容)。
 *
 * 根拠(一次情報):
 * - 国税庁 No.7140「印紙税額の一覧表(その1)第1号文書から第4号文書まで」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7140.htm (2026年7月29日参照)
 * - 国税庁 No.7141「印紙税額の一覧表(その2)第5号文書から第20号文書まで」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7141.htm (2026年7月29日参照)
 * - 国税庁 No.7108「不動産の譲渡に関する契約書等に係る印紙税の軽減措置」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7108.htm (2026年7月29日参照)
 *   軽減措置の適用期間: 平成26年4月1日から令和9年3月31日までの間に作成されるもの
 *
 * 前提:
 * - 扱うのは第1号文書(不動産の譲渡等)、第2号文書(請負)、第7号文書(継続的取引の基本となる契約書)、
 *   第17号の1文書(売上代金に係る受取書)、第17号の2文書(売上代金以外の受取書)のみ。
 * - 軽減措置は「不動産の譲渡に関する契約書(第1号の1文書)」と
 *   「建設工事の請負に関する契約書(第2号文書のうち建設工事に係るもの)」にだけ適用される。
 *   第1号文書でも地上権設定・債権譲渡などは軽減の対象外。
 * - 記載金額は消費税額を区分記載していればその消費税額を含めない額で判定する(本ツールは入力値をそのまま使う)。
 * - どの号の文書に当たるかの判定は本ツールでは行わない。実際の課否判定は税務署にご確認ください。
 */
(function (global) {
  "use strict";

  var MAX_AMOUNT = 1e15; // 記載金額の入力上限(円)

  // 各行は [その区分の上限額(円、この額を含む。null は上限なし), 税額(円)]
  // exemptBelow: この額未満は非課税、noAmount: 記載金額のない場合の税額(null は該当なし)
  var TABLES = {
    // 第1号文書: 不動産の譲渡等に関する契約書
    "1": {
      exemptBelow: 10000,
      noAmount: 200,
      rows: [
        [100000, 200], [500000, 400], [1000000, 1000], [5000000, 2000],
        [10000000, 10000], [50000000, 20000], [100000000, 60000], [500000000, 100000],
        [1000000000, 200000], [5000000000, 400000], [null, 600000]
      ]
    },
    // 第2号文書: 請負に関する契約書
    "2": {
      exemptBelow: 10000,
      noAmount: 200,
      rows: [
        [1000000, 200], [2000000, 400], [3000000, 1000], [5000000, 2000],
        [10000000, 10000], [50000000, 20000], [100000000, 60000], [500000000, 100000],
        [1000000000, 200000], [5000000000, 400000], [null, 600000]
      ]
    },
    // 第7号文書: 継続的取引の基本となる契約書(記載金額にかかわらず定額4千円)
    "7": {
      exemptBelow: 0,
      noAmount: 4000,
      rows: [[null, 4000]]
    },
    // 第17号の1文書: 売上代金に係る金銭又は有価証券の受取書(領収書)
    "17-1": {
      exemptBelow: 50000,
      noAmount: 200,
      rows: [
        [1000000, 200], [2000000, 400], [3000000, 600], [5000000, 1000],
        [10000000, 2000], [20000000, 4000], [30000000, 6000], [50000000, 10000],
        [100000000, 20000], [200000000, 40000], [300000000, 60000], [500000000, 100000],
        [1000000000, 150000], [null, 200000]
      ]
    },
    // 第17号の2文書: 売上代金以外の金銭又は有価証券の受取書(定額200円)
    "17-2": {
      exemptBelow: 50000,
      noAmount: 200,
      rows: [[null, 200]]
    }
  };

  // 軽減措置(平成26年4月1日〜令和9年3月31日に作成されるもの)
  // 第1号の1文書は契約金額10万円超、第2号(建設工事)は契約金額100万円超が対象。
  // それ以下の区分は本則税率のままなので、同じ税額を並べてある。
  var REDUCED = {
    "1": {
      exemptBelow: 10000,
      noAmount: 200,
      rows: [
        [100000, 200], [500000, 200], [1000000, 500], [5000000, 1000],
        [10000000, 5000], [50000000, 10000], [100000000, 30000], [500000000, 60000],
        [1000000000, 160000], [5000000000, 320000], [null, 480000]
      ]
    },
    "2": {
      exemptBelow: 10000,
      noAmount: 200,
      rows: [
        [1000000, 200], [2000000, 200], [3000000, 500], [5000000, 1000],
        [10000000, 5000], [50000000, 10000], [100000000, 30000], [500000000, 60000],
        [1000000000, 160000], [5000000000, 320000], [null, 480000]
      ]
    }
  };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function pickTable(docType, reduced) {
    if (reduced && Object.prototype.hasOwnProperty.call(REDUCED, docType)) return REDUCED[docType];
    if (Object.prototype.hasOwnProperty.call(TABLES, docType)) return TABLES[docType];
    return null;
  }

  /**
   * 文書の種類と記載金額から、必要な収入印紙の額を判定する。
   * @param {string} docType 文書の種類。"1"(第1号)/"2"(第2号)/"7"(第7号)/
   *   "17-1"(第17号の1・売上代金の受取書)/"17-2"(第17号の2・売上代金以外の受取書)
   * @param {number} amount 記載金額(円、0以上)。第7号文書では判定に使わない
   * @param {boolean} [reduced=false] 軽減措置(不動産譲渡・建設工事請負)を適用するか。
   *   第1号・第2号以外では無視される
   * @returns {{ok:true, tax:number, exempt:boolean, reducedApplied:boolean,
   *            normalTax:number, saving:number, bracketMin:number, bracketMax:(number|null)}
   *          |{ok:false, code:"invalid_doc_type"|"invalid_amount"}}
   *   tax: 印紙税額(円、非課税は0)。normalTax: 本則税率での額。saving: 軽減で減る額。
   *   bracketMin/bracketMax: その税額が適用される記載金額の区分(bracketMax が null は上限なし)。
   *   非課税のときは bracketMin=0、bracketMax=非課税の上限額。
   */
  function calculate(docType, amount, reduced) {
    var useReduced = !!reduced;
    var t = pickTable(docType, useReduced);
    if (!t) return { ok: false, code: "invalid_doc_type" };
    if (!isFiniteNumber(amount) || amount < 0 || amount > MAX_AMOUNT) {
      return { ok: false, code: "invalid_amount" };
    }
    var base = TABLES[docType];
    var reducedApplied = useReduced && Object.prototype.hasOwnProperty.call(REDUCED, docType);

    if (amount < t.exemptBelow) {
      return {
        ok: true, tax: 0, exempt: true, reducedApplied: reducedApplied,
        normalTax: 0, saving: 0, bracketMin: 0, bracketMax: t.exemptBelow - 1
      };
    }
    function lookup(table) {
      var min = table.exemptBelow;
      for (var i = 0; i < table.rows.length; i++) {
        var max = table.rows[i][0];
        if (max === null || amount <= max) {
          return { tax: table.rows[i][1], min: min, max: max };
        }
        min = max + 1;
      }
      return null;
    }
    var hit = lookup(t);
    var normal = lookup(base);
    return {
      ok: true,
      tax: hit.tax,
      exempt: false,
      reducedApplied: reducedApplied,
      normalTax: normal.tax,
      saving: normal.tax - hit.tax,
      bracketMin: hit.min,
      bracketMax: hit.max
    };
  }

  /**
   * 記載金額の記載がない文書の印紙税額。
   * @param {string} docType 文書の種類("1"/"2"/"7"/"17-1"/"17-2")
   * @returns {{ok:true, tax:number}|{ok:false, code:"invalid_doc_type"}}
   */
  function taxWithoutAmount(docType) {
    if (!Object.prototype.hasOwnProperty.call(TABLES, docType)) {
      return { ok: false, code: "invalid_doc_type" };
    }
    return { ok: true, tax: TABLES[docType].noAmount };
  }

  /**
   * その文書の種類の区分表を返す(画面の一覧表示用)。
   * @param {string} docType 文書の種類("1"/"2"/"7"/"17-1"/"17-2")
   * @param {boolean} [reduced=false] 軽減措置の表を返すか
   * @returns {{ok:true, exemptBelow:number, noAmount:number,
   *            rows:Array<{min:number, max:(number|null), tax:number}>}
   *          |{ok:false, code:"invalid_doc_type"}}
   */
  function table(docType, reduced) {
    var t = pickTable(docType, !!reduced);
    if (!t) return { ok: false, code: "invalid_doc_type" };
    var out = [];
    var min = t.exemptBelow;
    for (var i = 0; i < t.rows.length; i++) {
      out.push({ min: min, max: t.rows[i][0], tax: t.rows[i][1] });
      if (t.rows[i][0] === null) break;
      min = t.rows[i][0] + 1;
    }
    return { ok: true, exemptBelow: t.exemptBelow, noAmount: t.noAmount, rows: out };
  }

  var api = {
    calculate: calculate,
    taxWithoutAmount: taxWithoutAmount,
    table: table,
    DOC_TYPES: ["1", "2", "7", "17-1", "17-2"]
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.InshizeiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
