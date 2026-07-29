/*
 * 紙の連量⇔坪量 換算ロジック
 *
 * 根拠(一次情報):
 * - 日本紙パルプ商事「紙の単位(坪量、連、連量)」
 *   https://www.kamipa.co.jp/media/1521/ (2026年7月29日参照)
 *   ・坪量: 1平方メートルあたりの紙1枚の重量(g/m²)
 *   ・連: 一定寸法に仕上げられた紙1,000枚(板紙は100枚)を表す取引上の枚数単位
 *   ・連量: 1連あたりの重量(kg)
 *   ・換算式(洋紙): 連量(kg) = 坪量(g/m²) × 横(m) × 縦(m) × 1000 × 1連の枚数 ÷ 1000
 *     (板紙の場合は1連の枚数に100を用いる)
 * - JIS P 0202:1998「紙の原紙寸法」(A列本判625×880 / B列本判765×1085 / 四六判788×1091 /
 *   菊判636×939 / ハトロン判900×1200 mm)
 *   https://webdesk.jsa.or.jp/books/W11M0090/index/?bunsyo_id=JIS+P+0202:1998 (2026年7月29日参照)
 *   寸法一覧の確認: https://jis.jts-tokyo.com/kami-size-genshi/ (2026年7月29日参照)
 *
 * 前提:
 * - 連量は「原紙(裁断前の大きな紙)1連=1,000枚あたりの重さ」。仕上がりサイズの重さではない
 * - 印刷物の重さは「坪量 × 仕上がり面積 × 枚数」で求める概算。インキ・加工・製本の重さは含まない
 * - 丸め: 坪量は小数第1位、連量は小数第1位、1枚・1部の重さは小数第2位で四捨五入
 */
(function (global) {
  "use strict";

  // 原紙寸法(JIS P 0202:1998)。[短辺mm, 長辺mm]
  var SIZES = {
    shiroku: [788, 1091], // 四六判
    kiku: [636, 939], // 菊判
    a: [625, 880], // A列本判
    b: [765, 1085], // B列本判
    hatron: [900, 1200] // ハトロン判
  };

  var DEFAULT_SHEETS = 1000; // 洋紙の1連の枚数

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }

  function sizeAreaM2(sizeKey) {
    var s = SIZES[sizeKey];
    if (!s) return null;
    return (s[0] / 1000) * (s[1] / 1000);
  }

  function checkSheets(sheetsPerRen) {
    var n = sheetsPerRen === undefined ? DEFAULT_SHEETS : sheetsPerRen;
    if (!isFiniteNumber(n) || n < 1 || n > 100000) return null;
    return n;
  }

  /**
   * 連量(kg)から坪量(g/m²)を求める。
   * @param {"shiroku"|"kiku"|"a"|"b"|"hatron"} sizeKey 原紙の判型
   * @param {number} renryoKg 連量(kg)。0超〜10000
   * @param {number} [sheetsPerRen=1000] 1連の枚数(洋紙1000枚/板紙100枚)。1〜100000
   * @returns {{ok:true, basisWeightGsm:number, areaM2:number, sheetsPerRen:number}
   *          |{ok:false, code:"invalid_size"|"invalid_renryo"|"invalid_sheets"}}
   *   basisWeightGsm は小数第1位で四捨五入した坪量(g/m²)。
   */
  function toBasisWeight(sizeKey, renryoKg, sheetsPerRen) {
    var area = sizeAreaM2(sizeKey);
    if (area === null) return { ok: false, code: "invalid_size" };
    if (!isFiniteNumber(renryoKg) || renryoKg <= 0 || renryoKg > 10000) {
      return { ok: false, code: "invalid_renryo" };
    }
    var sheets = checkSheets(sheetsPerRen);
    if (sheets === null) return { ok: false, code: "invalid_sheets" };
    var gsm = (renryoKg * 1000) / (area * sheets);
    return { ok: true, basisWeightGsm: round1(gsm), areaM2: Math.round(area * 1e6) / 1e6, sheetsPerRen: sheets };
  }

  /**
   * 坪量(g/m²)から連量(kg)を求める。
   * @param {"shiroku"|"kiku"|"a"|"b"|"hatron"} sizeKey 原紙の判型
   * @param {number} basisWeightGsm 坪量(g/m²)。0超〜3000
   * @param {number} [sheetsPerRen=1000] 1連の枚数。1〜100000
   * @returns {{ok:true, renryoKg:number, areaM2:number, sheetsPerRen:number}
   *          |{ok:false, code:"invalid_size"|"invalid_basis_weight"|"invalid_sheets"}}
   *   renryoKg は小数第1位で四捨五入した連量(kg)。
   */
  function toRenryo(sizeKey, basisWeightGsm, sheetsPerRen) {
    var area = sizeAreaM2(sizeKey);
    if (area === null) return { ok: false, code: "invalid_size" };
    if (!isFiniteNumber(basisWeightGsm) || basisWeightGsm <= 0 || basisWeightGsm > 3000) {
      return { ok: false, code: "invalid_basis_weight" };
    }
    var sheets = checkSheets(sheetsPerRen);
    if (sheets === null) return { ok: false, code: "invalid_sheets" };
    return {
      ok: true,
      renryoKg: round1((basisWeightGsm * area * sheets) / 1000),
      areaM2: Math.round(area * 1e6) / 1e6,
      sheetsPerRen: sheets
    };
  }

  /**
   * ある判型の連量を、別の判型の「同じ厚さ(坪量)にあたる連量」に換算する。
   * @param {"shiroku"|"kiku"|"a"|"b"|"hatron"} fromKey 元の判型
   * @param {number} renryoKg 元の連量(kg)。0超〜10000
   * @param {"shiroku"|"kiku"|"a"|"b"|"hatron"} toKey 換算先の判型
   * @param {number} [sheetsPerRen=1000] 1連の枚数。1〜100000
   * @returns {{ok:true, basisWeightGsm:number, renryoKg:number}
   *          |{ok:false, code:"invalid_size"|"invalid_renryo"|"invalid_sheets"}}
   */
  function convert(fromKey, renryoKg, toKey, sheetsPerRen) {
    var fromArea = sizeAreaM2(fromKey);
    var toArea = sizeAreaM2(toKey);
    if (fromArea === null || toArea === null) return { ok: false, code: "invalid_size" };
    if (!isFiniteNumber(renryoKg) || renryoKg <= 0 || renryoKg > 10000) {
      return { ok: false, code: "invalid_renryo" };
    }
    var sheets = checkSheets(sheetsPerRen);
    if (sheets === null) return { ok: false, code: "invalid_sheets" };
    var gsm = (renryoKg * 1000) / (fromArea * sheets);
    return { ok: true, basisWeightGsm: round1(gsm), renryoKg: round1((gsm * toArea * sheets) / 1000) };
  }

  /**
   * 坪量と仕上がりサイズから、紙1枚の重さを求める。
   * @param {number} basisWeightGsm 坪量(g/m²)。0超〜3000
   * @param {number} widthMm 仕上がりの幅(mm)。1〜3000
   * @param {number} heightMm 仕上がりの高さ(mm)。1〜3000
   * @returns {{ok:true, gram:number, areaM2:number}
   *          |{ok:false, code:"invalid_basis_weight"|"invalid_width"|"invalid_height"}}
   *   gram は小数第2位で四捨五入した1枚の重さ(g)。
   */
  function sheetWeight(basisWeightGsm, widthMm, heightMm) {
    if (!isFiniteNumber(basisWeightGsm) || basisWeightGsm <= 0 || basisWeightGsm > 3000) {
      return { ok: false, code: "invalid_basis_weight" };
    }
    if (!isFiniteNumber(widthMm) || widthMm <= 0 || widthMm > 3000) return { ok: false, code: "invalid_width" };
    if (!isFiniteNumber(heightMm) || heightMm <= 0 || heightMm > 3000) return { ok: false, code: "invalid_height" };
    var area = (widthMm / 1000) * (heightMm / 1000);
    return { ok: true, gram: round2(basisWeightGsm * area), areaM2: Math.round(area * 1e6) / 1e6 };
  }

  /**
   * 冊子1部の重さを求める(本文＋表紙)。
   * @param {number} bodyGsm 本文の坪量(g/m²)。0超〜3000
   * @param {number} widthMm 仕上がりの幅(mm)。1〜3000
   * @param {number} heightMm 仕上がりの高さ(mm)。1〜3000
   * @param {number} bodyPages 本文のページ数(表裏で2ページ)。1〜10000
   * @param {number} [coverGsm=0] 表紙の坪量(g/m²)。0なら表紙なし。0〜3000
   * @param {number} [coverPages=4] 表紙のページ数(表1〜表4で4ページ)。0〜100
   * @returns {{ok:true, bodySheets:number, coverSheets:number, bodyGram:number,
   *            coverGram:number, totalGram:number}
   *          |{ok:false, code:string}}
   *   重さはいずれも小数第2位で四捨五入(g)。
   */
  function bookletWeight(bodyGsm, widthMm, heightMm, bodyPages, coverGsm, coverPages) {
    var cg = coverGsm === undefined ? 0 : coverGsm;
    var cp = coverPages === undefined ? 4 : coverPages;
    var body = sheetWeight(bodyGsm, widthMm, heightMm);
    if (!body.ok) return body;
    if (!isFiniteNumber(bodyPages) || bodyPages < 1 || bodyPages > 10000) {
      return { ok: false, code: "invalid_pages" };
    }
    if (!isFiniteNumber(cg) || cg < 0 || cg > 3000) return { ok: false, code: "invalid_cover_weight" };
    if (!isFiniteNumber(cp) || cp < 0 || cp > 100) return { ok: false, code: "invalid_cover_pages" };
    var areaM2 = (widthMm / 1000) * (heightMm / 1000);
    var bodySheets = Math.ceil(bodyPages / 2);
    var coverSheets = cg > 0 ? Math.ceil(cp / 2) : 0;
    var bodyGram = bodySheets * bodyGsm * areaM2;
    var coverGram = coverSheets * cg * areaM2;
    return {
      ok: true,
      bodySheets: bodySheets,
      coverSheets: coverSheets,
      bodyGram: round2(bodyGram),
      coverGram: round2(coverGram),
      totalGram: round2(bodyGram + coverGram)
    };
  }

  var api = {
    SIZES: SIZES,
    toBasisWeight: toBasisWeight,
    toRenryo: toRenryo,
    convert: convert,
    sheetWeight: sheetWeight,
    bookletWeight: bookletWeight
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.RenryoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
