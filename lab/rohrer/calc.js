/*
 * ローレル指数(学童)計算ロジック
 *
 * 根拠(一次情報):
 * - 滋賀県「学校保健統計調査 7 ローレル指数」
 *   https://www.pref.shiga.lg.jp/file/attachment/34297.pdf (2026年7月29日参照)
 *   計算式: ローレル指数 = 体重(kg) ÷ 身長(cm)^3 × 10^7
 *   分類: やせすぎ 99以下 / やややせている 100〜114 / 標準 115〜144
 *        / やや太っている 145〜159 / 太りすぎ 160以上
 * - 文部科学省「学校保健統計調査」 https://www.mext.go.jp/b_menu/toukei/chousa05/hoken/1268826.htm
 *   (2026年7月29日参照。児童生徒の身長・体重の全国平均値の出典)
 * - 日本小児内分泌学会「日本人小児の体格の評価」 https://jspe.umin.jp/medical/taikaku.html
 *   (2026年7月29日参照。個人の肥満・やせの評価には性別・年齢別・身長別標準体重を用いた
 *    「肥満度」のほうが優れているとされる点の根拠)
 *
 * 前提:
 * - ローレル指数は学年全体の傾向や年次推移など「集団の傾向」を表すために使われる指数。
 *   個人の肥満・やせの医学的な診断には使わない。
 * - 身長が高いほど指数が小さく出る性質があり、同じ体型でも身長で判定が変わる。
 * - 対象は身長80〜200cm、体重3〜200kgとする(学童の実測値を十分に含む範囲)。
 * - 指数は小数第1位で四捨五入して返す。判定は丸める前の値で行う。
 */
(function (global) {
  "use strict";

  var HEIGHT_MIN = 80;
  var HEIGHT_MAX = 200;
  var WEIGHT_MIN = 3;
  var WEIGHT_MAX = 200;

  // [下限(この値以上), 区分キー]。下限の小さい順に並べる
  var CATEGORIES = [
    [160, "太りすぎ"],
    [145, "やや太っている"],
    [115, "標準"],
    [100, "やややせている"],
    [0, "やせすぎ"]
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function categoryOf(index) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (index >= CATEGORIES[i][0]) return CATEGORIES[i][1];
    }
    return CATEGORIES[CATEGORIES.length - 1][1];
  }

  /**
   * ローレル指数を計算し、5区分の判定を返す。
   * ローレル指数 = 体重(kg) ÷ 身長(cm)^3 × 10,000,000
   * @param {number} heightCm 身長(cm、80以上200以下)
   * @param {number} weightKg 体重(kg、3以上200以下)
   * @returns {{ok:true, index:number, category:string, heightCm:number, weightKg:number}
   *          |{ok:false, code:"invalid_height"|"invalid_weight"}}
   *   index は小数第1位で四捨五入したローレル指数。
   *   category は "やせすぎ"|"やややせている"|"標準"|"やや太っている"|"太りすぎ"。
   */
  function calculate(heightCm, weightKg) {
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN || heightCm > HEIGHT_MAX) {
      return { ok: false, code: "invalid_height" };
    }
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN || weightKg > WEIGHT_MAX) {
      return { ok: false, code: "invalid_weight" };
    }
    var raw = weightKg / (heightCm * heightCm * heightCm) * 1e7;
    return {
      ok: true,
      index: Math.round(raw * 10) / 10,
      category: categoryOf(raw),
      heightCm: heightCm,
      weightKg: weightKg
    };
  }

  /**
   * その身長で「標準」(ローレル指数115以上145未満)に入る体重の範囲を求める。
   * 体重(kg) = ローレル指数 × 身長(cm)^3 ÷ 10,000,000
   * @param {number} heightCm 身長(cm、80以上200以下)
   * @returns {{ok:true, minKg:number, maxKg:number, heightCm:number}
   *          |{ok:false, code:"invalid_height"}}
   *   minKg は指数115ちょうどの体重、maxKg は指数145ちょうどの体重(この値未満が「標準」)。
   *   いずれも小数第1位で四捨五入。
   */
  function standardWeightRange(heightCm) {
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN || heightCm > HEIGHT_MAX) {
      return { ok: false, code: "invalid_height" };
    }
    var cube = heightCm * heightCm * heightCm;
    return {
      ok: true,
      minKg: Math.round(115 * cube / 1e7 * 10) / 10,
      maxKg: Math.round(145 * cube / 1e7 * 10) / 10,
      heightCm: heightCm
    };
  }

  /**
   * 指定した身長で、5区分それぞれの境目にあたる体重の早見表を返す。
   * @param {number} heightCm 身長(cm、80以上200以下)
   * @returns {{ok:true, rows:Array<{index:number, weightKg:number, category:string}>}
   *          |{ok:false, code:"invalid_height"}}
   *   rows は指数100/115/145/160の4点。weightKg は小数第1位で四捨五入。
   */
  function boundaryTable(heightCm) {
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN || heightCm > HEIGHT_MAX) {
      return { ok: false, code: "invalid_height" };
    }
    var cube = heightCm * heightCm * heightCm;
    var rows = [100, 115, 145, 160].map(function (idx) {
      return {
        index: idx,
        weightKg: Math.round(idx * cube / 1e7 * 10) / 10,
        category: categoryOf(idx)
      };
    });
    return { ok: true, rows: rows };
  }

  var api = {
    calculate: calculate,
    standardWeightRange: standardWeightRange,
    boundaryTable: boundaryTable,
    HEIGHT_MIN: HEIGHT_MIN,
    HEIGHT_MAX: HEIGHT_MAX,
    WEIGHT_MIN: WEIGHT_MIN,
    WEIGHT_MAX: WEIGHT_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.RohrerCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
