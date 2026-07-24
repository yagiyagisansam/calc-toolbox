/*
 * 単価比較計算ロジック(どっちが安い?)
 *
 * 計算方法:
 * - 単価 = 価格 ÷ 内容量 × 基準量(例: 100gあたりなら基準量100)
 * - 最安は丸め前の値で判定(同額なら先に入力した方)
 * - 差% = (各単価 − 最安単価) ÷ 最安単価 × 100(最安に対して何%高いか)
 * - 表示は単価が小数第2位、差%が小数第1位で四捨五入
 */
(function (global) {
  "use strict";

  var MAX_ITEMS = 5;

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  function validNum(v, max) {
    return typeof v === "number" && isFinite(v) && v > 0 && v <= max;
  }

  /**
   * 複数商品の単価を比較する。
   * @param {Array<{price: number, qty: number}>} items 商品リスト(2〜5件)
   *   price: 価格(円) / qty: 内容量(g・ml・個数など)
   * @param {number} per 基準量(100gあたりなら100、1個あたりなら1)
   * @returns {{ok: true, rows: Array<{unitPrice: number, diffPct: number}>, cheapest: number}
   *          |{ok: false, code: string}}
   *   rows: 各商品の単価と最安に対する差% / cheapest: 最安商品のインデックス
   *   code: "invalid_items" | "invalid_item" | "invalid_per"
   */
  function compare(items, per) {
    if (!Array.isArray(items) || items.length < 2 || items.length > MAX_ITEMS) {
      return { ok: false, code: "invalid_items" };
    }
    if (!validNum(per, 10000)) {
      return { ok: false, code: "invalid_per" };
    }
    var raws = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !validNum(it.price, 10000000) || !validNum(it.qty, 1000000)) {
        return { ok: false, code: "invalid_item" };
      }
      raws.push(it.price / it.qty * per);
    }
    var cheapest = 0;
    for (var j = 1; j < raws.length; j++) {
      if (raws[j] < raws[cheapest]) cheapest = j;
    }
    var rows = raws.map(function (raw) {
      return {
        unitPrice: round2(raw),
        diffPct: round1((raw - raws[cheapest]) / raws[cheapest] * 100)
      };
    });
    return { ok: true, rows: rows, cheapest: cheapest };
  }

  var api = {
    compare: compare,
    MAX_ITEMS: MAX_ITEMS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TankaCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
