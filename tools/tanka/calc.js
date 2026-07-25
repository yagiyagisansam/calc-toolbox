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

  /**
   * 送料込みの実質単価を比較する(ネット通販向け)。
   * 実質単価 = (価格 + 送料) ÷ 内容量 × 基準量。送料は0円可・省略時は0円扱い。
   * 最安判定は丸め前の値(同額なら先に入力した方)、表示用の単価は小数第2位、
   * 差%は小数第1位で四捨五入(compare() と同じ方針)。
   * @param {Array<{price:number, qty:number, ship:number}>} items 商品リスト(2〜5件)
   *   price: 価格(円) / qty: 内容量 / ship: 送料(円・0以上、省略可)
   * @param {number} per 基準量(100gあたりなら100、1個あたりなら1)
   * @returns {{ok:true, rows:Array<{unitPrice:number, diffPct:number, total:number}>, cheapest:number}
   *          |{ok:false, code:string}}
   *   rows[].total: 送料込みの支払い総額(小数第2位で四捨五入)
   *   code: "invalid_items" | "invalid_item" | "invalid_per"
   */
  function compareWithShipping(items, per) {
    if (!Array.isArray(items) || items.length < 2 || items.length > MAX_ITEMS) {
      return { ok: false, code: "invalid_items" };
    }
    if (!validNum(per, 10000)) {
      return { ok: false, code: "invalid_per" };
    }
    var raws = [];
    var totals = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !validNum(it.price, 10000000) || !validNum(it.qty, 1000000)) {
        return { ok: false, code: "invalid_item" };
      }
      var ship = it.ship === undefined || it.ship === null ? 0 : it.ship;
      if (typeof ship !== "number" || !isFinite(ship) || ship < 0 || ship > 10000000) {
        return { ok: false, code: "invalid_item" };
      }
      totals.push(it.price + ship);
      raws.push((it.price + ship) / it.qty * per);
    }
    var cheapest = 0;
    for (var j = 1; j < raws.length; j++) {
      if (raws[j] < raws[cheapest]) cheapest = j;
    }
    var rows = raws.map(function (raw, k) {
      return {
        unitPrice: round2(raw),
        diffPct: round1((raw - raws[cheapest]) / raws[cheapest] * 100),
        total: round2(totals[k])
      };
    });
    return { ok: true, rows: rows, cheapest: cheapest };
  }

  /**
   * 送料無料ラインの買い足し判定。
   * 不足額 = 送料無料ライン − カート合計(マイナスなら0 = すでに送料無料)。
   * worth: 不足額が送料以下なら true(その額を買い足す方が、送料を払うより持ち出しが少ない
   * 可能性が高い。ただし不要な物を買えば損なので目安)。金額は小数第2位で四捨五入。
   * @param {number} cartYen カート内の合計(円・0より大きい〜1,000万)
   * @param {number} thresholdYen 送料無料ライン(円・1〜1,000万)
   * @param {number} shipYen 送料(円・1〜10万)
   * @returns {{ok:true, shortfall:number, free:boolean, worth:boolean}|{ok:false, code:string}}
   *   code: "invalid_cart" | "invalid_threshold" | "invalid_ship"
   */
  function freeShipCheck(cartYen, thresholdYen, shipYen) {
    if (typeof cartYen !== "number" || !isFinite(cartYen) || cartYen <= 0 || cartYen > 10000000) {
      return { ok: false, code: "invalid_cart" };
    }
    if (typeof thresholdYen !== "number" || !isFinite(thresholdYen) || thresholdYen < 1 || thresholdYen > 10000000) {
      return { ok: false, code: "invalid_threshold" };
    }
    if (typeof shipYen !== "number" || !isFinite(shipYen) || shipYen < 1 || shipYen > 100000) {
      return { ok: false, code: "invalid_ship" };
    }
    var shortfall = Math.max(0, round2(thresholdYen - cartYen));
    return {
      ok: true,
      shortfall: shortfall,
      free: shortfall === 0,
      worth: shortfall > 0 && shortfall <= shipYen
    };
  }

  var api = {
    freeShipCheck: freeShipCheck,
    compareWithShipping: compareWithShipping,
    compare: compare,
    MAX_ITEMS: MAX_ITEMS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TankaCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
