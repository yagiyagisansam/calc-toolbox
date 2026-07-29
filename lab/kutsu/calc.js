/*
 * 靴のサイズ(JIS表示・足囲記号)と US/UK/EU 換算のロジック
 *
 * 根拠:
 * - JIS S 5037:1998「靴のサイズ」(日本産業規格。対応国際規格 ISO 9407 Mondopoint)
 *   ・サイズは足長と足囲(又は足長と足幅)で表す。0.5cm刻み。
 *   ・付表1 男子用: 足長20.0〜30.0cm、足囲記号 A/B/C/D/E/EE/EEE/EEEE/F/G
 *     足長20.0cmのAが189mm。記号が1つ広くなるごとに+6mm、足長が0.5cm長くなるごとに+3mm
 *     (例: 足長25.0cmのAは219mm、EEは249mm)。
 *   ・付表2 女子用: 足長19.5〜27.0cm、足囲記号 A/B/C/D/E/EE/EEE/EEEE/F
 *     足長19.5cmのAが183mm。以降は男子用と同じ刻み。
 *   規格票(日本規格協会): https://webdesk.jsa.or.jp/books/W11M0090/?bunsyo_id=JIS+S+5037:1998
 *   本文(kikakurui.com による全文): https://kikakurui.com/s/S5037-1998-01.html (2026年7月29日参照)
 * - US/UK/EU の換算表: Calculator.net "Shoe Size Conversion"
 *   https://www.calculator.net/shoe-size-conversion.html (2026年7月29日参照)
 *
 * 基準の時点:
 * - JIS S 5037 は1998年改正版(2019年7月1日の法改正で「日本工業規格」は「日本産業規格」に読替え)。
 * - US/UK/EU の換算は2026年7月29日時点の上記ページの表にもとづく。
 *
 * 前提:
 * - JISは足長と足囲だけを規定しており、US/UK/EU との対応は規定していない。
 *   換算は上記の換算表による目安で、メーカー・木型によって1サイズ程度ずれる。
 * - 換算は「足長以上で最も小さい行」を選ぶ(靴が足より小さくならないようにするため)。
 *
 * 丸め:
 * - JISのサイズ表示は0.5cm刻みなので、足長を最も近い0.5cmに四捨五入する。
 * - 足囲記号は、測定した足囲を6mm刻みの区分に四捨五入して選ぶ(規格の刻みが6mmのため)。
 */
(function (global) {
  "use strict";

  // JIS S 5037:1998 付表1・付表2
  var JIS = {
    men: {
      codes: ["A", "B", "C", "D", "E", "EE", "EEE", "EEEE", "F", "G"],
      minLengthCm: 20.0,
      maxLengthCm: 30.0,
      baseLengthCm: 20.0,
      baseGirthMm: 189, // 足長20.0cm・記号Aの足囲
      label: "男子用"
    },
    women: {
      codes: ["A", "B", "C", "D", "E", "EE", "EEE", "EEEE", "F"],
      minLengthCm: 19.5,
      maxLengthCm: 27.0,
      baseLengthCm: 19.5,
      baseGirthMm: 183, // 足長19.5cm・記号Aの足囲
      label: "女子用"
    }
  };
  var GIRTH_STEP_MM = 6;     // 記号1つあたりの足囲の差
  var GIRTH_PER_CM_MM = 6;   // 足長1cmあたりの足囲の差(0.5cmで3mm)
  var HALF_SIZE_CM = 0.4;    // 換算表のハーフサイズ1段あたりの足長の差(約0.4cm)

  // Calculator.net "Shoe Size Conversion" の換算表
  // [足長cm, US, UK, EU, JP]
  var CONV = {
    men: [
      [23.7, 6, 5, 38, 23.5], [24.1, 6.5, 5.5, 38, 24], [24.6, 7, 6, 39, 24.5],
      [25.0, 7.5, 6.5, 39, 25], [25.4, 8, 7, 40, 25.5], [25.8, 8.5, 7.5, 41, 26],
      [26.2, 9, 8, 41, 26], [26.7, 9.5, 8.5, 42, 26.5], [27.1, 10, 9, 43, 27],
      [27.5, 10.5, 9.5, 43, 27.5], [27.9, 11, 10, 44, 28], [28.4, 11.5, 10.5, 45, 28.5],
      [28.8, 12, 11, 45, 29], [29.2, 12.5, 11.5, 46, 29], [29.6, 13, 12, 46, 29.5],
      [30.1, 13.5, 12.5, 47, 30], [30.5, 14, 13, 48, 30.5]
    ],
    women: [
      [21.2, 4, 2, 34, 21], [21.6, 4.5, 2.5, 34, 21.5], [22.0, 5, 3, 35, 22],
      [22.4, 5.5, 3.5, 36, 22.5], [22.9, 6, 4, 36, 23], [23.3, 6.5, 4.5, 37, 23.5],
      [23.7, 7, 5, 38, 23.5], [24.1, 7.5, 5.5, 38, 24], [24.6, 8, 6, 39, 24.5],
      [25.0, 8.5, 6.5, 39, 25], [25.4, 9, 7, 40, 25.5], [25.8, 9.5, 7.5, 41, 26],
      [26.2, 10, 8, 41, 26], [26.7, 10.5, 8.5, 42, 26.5], [27.1, 11, 9, 43, 27],
      [27.5, 11.5, 9.5, 43, 27.5], [27.9, 12, 10, 44, 28]
    ]
  };

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function roundHalfCm(v) {
    return Math.round(v * 2) / 2;
  }

  /**
   * JIS S 5037 のサイズ表示(足長の0.5cm刻み)と足囲記号を求める。
   * @param {"men"|"women"} sex "men"=男子用(12歳以上の男子) / "women"=女子用(12歳以上の女子)
   * @param {number} footLengthCm 足長(cm)。男子用20.0〜30.0 / 女子用19.5〜27.0
   * @param {number} footGirthMm 足囲(mm)。100〜400。cmで測った場合は10倍して入れる
   * @returns {{ok:true, sizeCm:number, widthCode:string, standardGirthMm:number,
   *            diffMm:number, outOfTable:boolean, label:string}
   *          |{ok:false, code:"invalid_sex"|"invalid_length"|"invalid_girth"}}
   *   sizeCm はJISのサイズ表示(0.5cm刻み)。standardGirthMm は選ばれた記号の規格上の足囲。
   *   diffMm は 測定値 − 規格値。outOfTable は記号が表の範囲(A〜G / A〜F)から外れた場合 true。
   */
  function jisSize(sex, footLengthCm, footGirthMm) {
    var t = JIS[sex];
    if (!t) return { ok: false, code: "invalid_sex" };
    if (!isNum(footLengthCm)) return { ok: false, code: "invalid_length" };
    var size = roundHalfCm(footLengthCm);
    if (size < t.minLengthCm || size > t.maxLengthCm) return { ok: false, code: "invalid_length" };
    if (!isNum(footGirthMm) || footGirthMm < 100 || footGirthMm > 400) {
      return { ok: false, code: "invalid_girth" };
    }

    var base = t.baseGirthMm + (size - t.baseLengthCm) * GIRTH_PER_CM_MM;
    var idx = Math.round((footGirthMm - base) / GIRTH_STEP_MM);
    var last = t.codes.length - 1;
    var outOfTable = idx < 0 || idx > last;
    var code;
    var clamped = Math.min(Math.max(idx, 0), last);
    if (idx < 0) code = t.codes[0] + "未満";
    else if (idx > last) code = t.codes[last] + "超";
    else code = t.codes[idx];

    var std = base + clamped * GIRTH_STEP_MM;
    return {
      ok: true,
      sizeCm: size,
      widthCode: code,
      standardGirthMm: Math.round(std * 10) / 10,
      diffMm: Math.round((footGirthMm - std) * 10) / 10,
      outOfTable: outOfTable,
      label: t.label
    };
  }

  /**
   * 足長から US / UK / EU / JP のサイズに換算する。
   * 足長以上で最も小さい行を選ぶ(靴が足より小さくならないようにするため)。
   * @param {"men"|"women"} sex "men"=メンズ / "women"=ウィメンズ
   * @param {number} footLengthCm 足長(cm)
   * @returns {{ok:true, rowFootLengthCm:number, us:number, uk:number, eu:number, jp:number}
   *          |{ok:false, code:"invalid_sex"|"invalid_length"}}
   */
  function convert(sex, footLengthCm) {
    var rows = CONV[sex];
    if (!rows) return { ok: false, code: "invalid_sex" };
    if (!isNum(footLengthCm)) return { ok: false, code: "invalid_length" };
    // 表の最小行よりハーフサイズ(約0.4cm)以上小さい足長は換算表の範囲外とする
    if (footLengthCm < rows[0][0] - HALF_SIZE_CM) return { ok: false, code: "invalid_length" };
    for (var i = 0; i < rows.length; i++) {
      // 0.05cm の余裕を見て浮動小数の誤差を吸収する
      if (footLengthCm <= rows[i][0] + 1e-9) {
        return {
          ok: true,
          rowFootLengthCm: rows[i][0],
          us: rows[i][1],
          uk: rows[i][2],
          eu: rows[i][3],
          jp: rows[i][4]
        };
      }
    }
    return { ok: false, code: "invalid_length" };
  }

  /**
   * JIS表示と各国サイズをまとめて返す。
   * @param {"men"|"women"} sex 性別区分
   * @param {number} footLengthCm 足長(cm)
   * @param {number} footGirthMm 足囲(mm)
   * @returns {{ok:true, jis:object, conv:(object|null)}|{ok:false, code:string}}
   *   換算表の範囲外の足長のときは conv が null になる(JIS表示は返す)。
   */
  function all(sex, footLengthCm, footGirthMm) {
    var j = jisSize(sex, footLengthCm, footGirthMm);
    if (!j.ok) return j;
    var c = convert(sex, footLengthCm);
    return { ok: true, jis: j, conv: c.ok ? c : null };
  }

  var api = {
    jisSize: jisSize,
    convert: convert,
    all: all
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KutsuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
