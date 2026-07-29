/*
 * オモリ号数⇔g⇔oz 換算ロジック
 *
 * 根拠(一次情報):
 * - 計量単位令(平成4年政令第357号) 別表第六
 *   https://laws.e-gov.go.jp/law/404CO0000000357 (2026年7月29日参照)
 *   真珠の質量の計量に用いる「もんめ」は「キログラムの0.003750倍」= 3.75 g と定められている。
 *   釣りのオモリの「号」はこの尺貫法の1匁(もんめ)=3.75gを引き継いだ呼び方。
 * - NIST「Guide to the SI, Appendix B.8(換算係数)」
 *   https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8
 *   (2026年7月29日参照)
 *   ounce (avoirdupois) → kilogram は 2.834952 E-02。
 *   国際ヤード・ポンド協定(1959年)で 1 lb = 0.45359237 kg 、1 oz = 1/16 lb と定義されており、
 *   1 oz = 28.349523125 g(厳密値)。
 * - TSURI HACK「オモリの号数換算表｜1号は何グラム？」 https://tsurihack.com/2696
 *   (2026年7月29日参照。釣具の慣行として1号=3.75gが使われていることの確認)
 *
 * 前提:
 * - 1号 = 1匁 = 3.75 g(厳密値)。1 oz = 28.349523125 g(厳密値)。
 *   したがって 1 oz = 28.349523125 / 3.75 = 約7.5599号。
 * - ガン玉・ジンタン・カミツブシ・板オモリなど、号数の意味が異なる規格には当てはまらない。
 * - 釣具メーカーの oz 表記は 1/8oz=3.5g のように丸めた値で書かれることが多く、
 *   本ツールの厳密換算(1/8oz=3.5437g)とは少しずれる。
 * - 返す数値は小数第4位で四捨五入する(0.1号=0.375gのような小さな値でも桁が残るようにするため)。
 */
(function (global) {
  "use strict";

  var GRAM_PER_GO = 3.75;              // 1号 = 1匁 = 3.75 g(計量単位令)
  var GRAM_PER_OZ = 28.349523125;      // 1 oz(常衡) = 28.349523125 g(国際ヤード・ポンド協定)
  var VALUE_MAX = 1000000;             // 入力値の上限

  var UNITS = ["go", "g", "oz"];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round4(v) {
    return Math.round(v * 1e4) / 1e4;
  }

  function toGram(value, unit) {
    if (unit === "g") return value;
    if (unit === "go") return value * GRAM_PER_GO;
    return value * GRAM_PER_OZ; // oz
  }

  function fromGram(gram, unit) {
    if (unit === "g") return gram;
    if (unit === "go") return gram / GRAM_PER_GO;
    return gram / GRAM_PER_OZ; // oz
  }

  /**
   * オモリの重さを号・グラム・オンスの間で換算する。
   * @param {number} value 換算したい数値(0超1000000以下)
   * @param {string} from 元の単位 "go"(号) | "g"(グラム) | "oz"(オンス)
   * @param {string} to 変換先の単位 "go" | "g" | "oz"
   * @returns {{ok:true, value:number, gram:number, go:number, oz:number}
   *          |{ok:false, code:"invalid_value"|"invalid_unit"}}
   *   value は to の単位に換算した値。gram/go/oz は同じ重さを3単位で表したもの。
   *   いずれも小数第4位で四捨五入。
   */
  function convert(value, from, to) {
    if (!isFiniteNumber(value) || value <= 0 || value > VALUE_MAX) {
      return { ok: false, code: "invalid_value" };
    }
    if (UNITS.indexOf(from) === -1 || UNITS.indexOf(to) === -1) {
      return { ok: false, code: "invalid_unit" };
    }
    var gram = toGram(value, from);
    return {
      ok: true,
      value: round4(fromGram(gram, to)),
      gram: round4(gram),
      go: round4(gram / GRAM_PER_GO),
      oz: round4(gram / GRAM_PER_OZ)
    };
  }

  /**
   * オンスの分数表記(1/8oz など)をグラム・号に換算する。
   * @param {number} numerator 分子(0超)
   * @param {number} denominator 分母(0超)
   * @returns {{ok:true, oz:number, gram:number, go:number}
   *          |{ok:false, code:"invalid_numerator"|"invalid_denominator"}}
   */
  function fromOunceFraction(numerator, denominator) {
    if (!isFiniteNumber(numerator) || numerator <= 0 || numerator > VALUE_MAX) {
      return { ok: false, code: "invalid_numerator" };
    }
    if (!isFiniteNumber(denominator) || denominator <= 0 || denominator > VALUE_MAX) {
      return { ok: false, code: "invalid_denominator" };
    }
    var oz = numerator / denominator;
    var gram = oz * GRAM_PER_OZ;
    return { ok: true, oz: round4(oz), gram: round4(gram), go: round4(gram / GRAM_PER_GO) };
  }

  // 釣具でよく使われるオンス表記(分子/分母)
  var COMMON_OZ = [
    [1, 32], [1, 16], [3, 32], [1, 8], [3, 16], [1, 4],
    [3, 8], [1, 2], [5, 8], [3, 4], [1, 1], [3, 2], [2, 1]
  ];

  /**
   * 釣具でよく使うオンス表記の換算表を返す。
   * @returns {Array<{label:string, oz:number, gram:number, go:number}>}
   *   label は "1/8" のような分数表記
   */
  function ounceTable() {
    return COMMON_OZ.map(function (f) {
      var oz = f[0] / f[1];
      var gram = oz * GRAM_PER_OZ;
      return {
        label: f[1] === 1 ? String(f[0]) : f[0] + "/" + f[1],
        oz: round4(oz),
        gram: round4(gram),
        go: round4(gram / GRAM_PER_GO)
      };
    });
  }

  // 船釣り・投げ釣りでよく使われる号数
  var COMMON_GO = [0.5, 0.8, 1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 80, 100];

  /**
   * よく使う号数の換算表を返す。
   * @returns {Array<{go:number, gram:number, oz:number}>}
   */
  function goTable() {
    return COMMON_GO.map(function (go) {
      var gram = go * GRAM_PER_GO;
      return { go: go, gram: round4(gram), oz: round4(gram / GRAM_PER_OZ) };
    });
  }

  var api = {
    convert: convert,
    fromOunceFraction: fromOunceFraction,
    ounceTable: ounceTable,
    goTable: goTable,
    GRAM_PER_GO: GRAM_PER_GO,
    GRAM_PER_OZ: GRAM_PER_OZ,
    UNITS: UNITS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.OmoriCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
