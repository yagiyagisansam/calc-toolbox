/*
 * 干支(十干十二支)の計算ロジック
 *
 * 根拠(一次情報):
 * - 国立天文台 暦計算室「暦Wiki/干支」
 *   https://eco.mtk.nao.ac.jp/koyomi/wiki/B4B3BBD9.html (2026年7月29日参照)
 *   ・十干と十二支を組み合わせて周期的に60までの数を数える方法。六十干支とも呼ぶ
 *   ・後漢のころから木星の位置によらず単純に干支を並べるようになり、現在まで続いている
 *   ・壬申の乱(672年)・戊辰戦争(1868年)など、干支を数えれば60年の範囲で年がわかる
 * - 国立天文台 暦計算室「暦Wiki/十干」(甲乙丙丁戊己庚辛壬癸の順とよみ)
 *   https://eco.mtk.nao.ac.jp/koyomi/wiki/BDBDB4B3.html (2026年7月29日参照)
 * - 国立天文台 暦計算室「暦Wiki/十二支」(子丑寅卯辰巳午未申酉戌亥の順とよみ)
 *   https://eco.mtk.nao.ac.jp/koyomi/wiki/BDBDC6F3BBD9.html (2026年7月29日参照)
 *
 * 計算式の検証:
 * - 十二支 =(西暦年 − 4)を12で割った余り、十干 =(西暦年 − 4)を10で割った余り。
 *   2024年 →(2024−4)%10=0(甲)、%12=4(辰)→ 甲辰。
 *   1868年 → %10=4(戊)、%12=4(辰)→ 戊辰(戊辰戦争)。
 *   672年  → %10=8(壬)、%12=8(申)→ 壬申(壬申の乱)。
 *   いずれも出典に挙げられた史実の呼び名と一致する。
 *
 * 前提:
 * - 年の干支は現在の暦(1月1日区切り)の西暦年に対して求める。
 *   旧暦(太陰太陽暦)では年の始まりが異なり、四柱推命など占いの分野では
 *   立春を境にする流儀もあるため、そうした用途とはずれることがある。
 * - 還暦は生まれた年と同じ干支に戻る年(生年 + 60年)として計算する。
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1;
  var YEAR_MAX = 3000;

  // 十干(甲から順)。[名称, よみ(訓), よみ(音)]
  var JIKKAN = [
    ["甲", "きのえ", "コウ"], ["乙", "きのと", "オツ"], ["丙", "ひのえ", "ヘイ"],
    ["丁", "ひのと", "テイ"], ["戊", "つちのえ", "ボ"], ["己", "つちのと", "キ"],
    ["庚", "かのえ", "コウ"], ["辛", "かのと", "シン"], ["壬", "みずのえ", "ジン"],
    ["癸", "みずのと", "キ"]
  ];

  // 十二支(子から順)。[名称, よみ, 動物]
  var JUNISHI = [
    ["子", "ね", "ねずみ"], ["丑", "うし", "うし"], ["寅", "とら", "とら"],
    ["卯", "う", "うさぎ"], ["辰", "たつ", "たつ(竜)"], ["巳", "み", "へび"],
    ["午", "うま", "うま"], ["未", "ひつじ", "ひつじ"], ["申", "さる", "さる"],
    ["酉", "とり", "とり"], ["戌", "いぬ", "いぬ"], ["亥", "い", "いのしし"]
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isYear(v) {
    return isFiniteNumber(v) && v === Math.floor(v) && v >= YEAR_MIN && v <= YEAR_MAX;
  }

  /** 負の値でも0以上の余りを返す剰余 */
  function mod(a, n) {
    return ((a % n) + n) % n;
  }

  /**
   * 西暦年から十干・十二支・六十干支を求める。
   * 十干 =(西暦年 − 4)mod 10、十二支 =(西暦年 − 4)mod 12、六十干支 =(西暦年 − 4)mod 60。
   * @param {number} year 西暦年(1〜3000の整数)
   * @returns {{ok:true, year:number, kanIndex:number, kan:string, kanYomi:string,
   *            shiIndex:number, shi:string, shiYomi:string, animal:string,
   *            kanshiIndex:number, kanshi:string, kanshiYomi:string}
   *          |{ok:false, code:"invalid_year"}}
   *   kanIndex/shiIndex/kanshiIndex は0始まり(甲=0、子=0、甲子=0)。
   *   kanshi は「甲辰」のような2文字、kanshiYomi は「きのえたつ」のような訓のよみ。
   */
  function fromYear(year) {
    if (!isYear(year)) return { ok: false, code: "invalid_year" };
    var base = year - 4;
    var ki = mod(base, 10);
    var si = mod(base, 12);
    var kan = JIKKAN[ki];
    var shi = JUNISHI[si];
    return {
      ok: true,
      year: year,
      kanIndex: ki,
      kan: kan[0],
      kanYomi: kan[1],
      shiIndex: si,
      shi: shi[0],
      shiYomi: shi[1],
      animal: shi[2],
      kanshiIndex: mod(base, 60),
      kanshi: kan[0] + shi[0],
      kanshiYomi: kan[1] + shi[1]
    };
  }

  /**
   * 基準の年に年男・年女かどうかを判定する(十二支が生まれ年と同じか)。
   * @param {number} birthYear 生まれた年(西暦、1〜3000の整数)
   * @param {number} refYear 基準の年(西暦、1〜3000の整数)
   * @returns {{ok:true, isMatch:boolean, shi:string, animal:string, age:number}
   *          |{ok:false, code:"invalid_year"|"invalid_order"}}
   *   age: その年の誕生日を迎えた時点の満年齢(基準年 − 生まれ年)。
   *        誕生日前の時点ではこれより1歳下になる。
   */
  function isToshiotoko(birthYear, refYear) {
    var b = fromYear(birthYear);
    if (!b.ok) return b;
    var r = fromYear(refYear);
    if (!r.ok) return r;
    if (refYear < birthYear) return { ok: false, code: "invalid_order" };
    return {
      ok: true,
      isMatch: b.shiIndex === r.shiIndex,
      shi: b.shi,
      animal: b.animal,
      age: refYear - birthYear
    };
  }

  /**
   * 基準の年より後で、次に年男・年女になる年(十二支が一巡する12年周期)。
   * 基準の年がちょうど年男・年女の年でも、その次の年を返す。
   * @param {number} birthYear 生まれた年(西暦、1〜3000の整数)
   * @param {number} refYear 基準の年(西暦、1〜3000の整数)
   * @returns {{ok:true, year:number, age:number}
   *          |{ok:false, code:"invalid_year"|"invalid_order"|"out_of_range"}}
   */
  function nextToshiotoko(birthYear, refYear) {
    if (!isYear(birthYear) || !isYear(refYear)) return { ok: false, code: "invalid_year" };
    if (refYear < birthYear) return { ok: false, code: "invalid_order" };
    // 生年から12の倍数だけ進んだ年のうち、基準年より大きい最小のもの
    var k = Math.floor((refYear - birthYear) / 12) + 1;
    var y = birthYear + k * 12;
    if (y > YEAR_MAX) return { ok: false, code: "out_of_range" };
    return { ok: true, year: y, age: y - birthYear };
  }

  /**
   * 還暦(生まれた年と同じ干支に戻る年)を求める。六十干支が一巡する60年後。
   * @param {number} birthYear 生まれた年(西暦、1〜3000の整数)
   * @returns {{ok:true, year:number, age:number, kanshi:string}
   *          |{ok:false, code:"invalid_year"|"out_of_range"}}
   *   age は満60歳(数え年では61歳)。
   */
  function kanreki(birthYear) {
    var b = fromYear(birthYear);
    if (!b.ok) return b;
    var y = birthYear + 60;
    if (y > YEAR_MAX) return { ok: false, code: "out_of_range" };
    return { ok: true, year: y, age: 60, kanshi: b.kanshi };
  }

  /**
   * 六十干支の通し番号(0=甲子)から、その番号にあたる干支の名前を返す。
   * @param {number} index 0〜59の整数
   * @returns {{ok:true, kanshi:string, kanshiYomi:string}|{ok:false, code:"invalid_index"}}
   */
  function fromKanshiIndex(index) {
    if (!isFiniteNumber(index) || index !== Math.floor(index) || index < 0 || index > 59) {
      return { ok: false, code: "invalid_index" };
    }
    var kan = JIKKAN[mod(index, 10)];
    var shi = JUNISHI[mod(index, 12)];
    return { ok: true, kanshi: kan[0] + shi[0], kanshiYomi: kan[1] + shi[1] };
  }

  var api = {
    fromYear: fromYear,
    isToshiotoko: isToshiotoko,
    nextToshiotoko: nextToshiotoko,
    kanreki: kanreki,
    fromKanshiIndex: fromKanshiIndex,
    JIKKAN: JIKKAN,
    JUNISHI: JUNISHI,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.EtoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
