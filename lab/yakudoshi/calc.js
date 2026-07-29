/*
 * 厄年(前厄・本厄・後厄)の早見の計算ロジック
 *
 * 根拠(一次情報):
 * - 神社本庁「厄祓い(男性・女性の厄年、本厄等)」
 *   https://www.jinjahoncho.or.jp/omairi/yakubarai/ (2026年7月29日参照)
 *   ・「厄年の年齢は、通常『数え年』で数えます。数え年とは、生まれたときがすでに1歳であり、
 *      元日で1つ歳をとる計算をします。」
 *   ・「地域によって多少異なるところもありますが、厄年の年齢は、男性が25歳・42歳・61歳、
 *      女性が19歳・33歳・37歳(・61歳)とされ、この年の前後を前厄・後厄と言われています。」
 *   ・「この中でも男性・42歳と女性・33歳を大厄として、特に意識されることが多いようです。」
 *   ・同ページの令和8年用の表では、男性は24/25/26・41/42/43・60/61/62歳、
 *     女性は18/19/20・32/33/34・36/37/38・60/61/62歳が示されている
 *
 * 前提:
 * - 数え年 = その年 − 生年 + 1(元日で1つ歳をとるため、誕生日は関係しない)
 * - 神社本庁も「地域によって多少異なる」としており、寺社によって年齢が違うことがある
 * - 厄年の数え方を旧暦(節分まで前年)とする地域・寺社もあるが、本ツールは西暦の年で数える
 */
(function (global) {
  "use strict";

  var MIN_YEAR = 1900;
  var MAX_YEAR = 2200;

  // 本厄の数え年(神社本庁の記載どおり)
  var HONYAKU = { male: [25, 42, 61], female: [19, 33, 37, 61] };
  // 大厄
  var TAIYAKU = { male: 42, female: 33 };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }
  function isYear(v) {
    return isFiniteNumber(v) && v === Math.floor(v) && v >= MIN_YEAR && v <= MAX_YEAR;
  }

  /**
   * 数え年を求める(元日で1つ歳をとる数え方)。
   * @param {number} birthYear 生年(西暦。1900〜2200)
   * @param {number} baseYear 基準となる年(西暦。1900〜2200。生年以上)
   * @returns {{ok:true, kazoedoshi:number}
   *          |{ok:false, code:"invalid_birth_year"|"invalid_base_year"}}
   */
  function kazoedoshi(birthYear, baseYear) {
    if (!isYear(birthYear)) return { ok: false, code: "invalid_birth_year" };
    if (!isYear(baseYear) || baseYear < birthYear) return { ok: false, code: "invalid_base_year" };
    return { ok: true, kazoedoshi: baseYear - birthYear + 1 };
  }

  /**
   * 基準年に厄年(前厄・本厄・後厄)にあたるかを判定する。
   * @param {number} birthYear 生年(西暦)
   * @param {"male"|"female"} sex 性別
   * @param {number} baseYear 基準となる年(西暦)
   * @returns {{ok:true, kazoedoshi:number, status:"maeyaku"|"honyaku"|"atoyaku"|"none",
   *            honyakuAge:number|null, isTaiyaku:boolean}
   *          |{ok:false, code:"invalid_birth_year"|"invalid_sex"|"invalid_base_year"}}
   *   status  : maeyaku=前厄 / honyaku=本厄 / atoyaku=後厄 / none=厄年でない
   *   honyakuAge: 関係する本厄の数え年(厄年でないときは null)
   *   isTaiyaku : 本厄が大厄(男性42歳・女性33歳)にあたるか
   */
  function calculate(birthYear, sex, baseYear) {
    if (!isYear(birthYear)) return { ok: false, code: "invalid_birth_year" };
    if (sex !== "male" && sex !== "female") return { ok: false, code: "invalid_sex" };
    var k = kazoedoshi(birthYear, baseYear);
    if (!k.ok) return k;

    var ages = HONYAKU[sex];
    var status = "none";
    var honyakuAge = null;
    // 本厄を優先し、次に前厄、最後に後厄の順で判定する
    var order = [[0, "honyaku"], [-1, "maeyaku"], [1, "atoyaku"]];
    for (var i = 0; i < order.length && status === "none"; i++) {
      for (var j = 0; j < ages.length; j++) {
        if (k.kazoedoshi === ages[j] + order[i][0]) {
          status = order[i][1];
          honyakuAge = ages[j];
          break;
        }
      }
    }
    return {
      ok: true,
      kazoedoshi: k.kazoedoshi,
      status: status,
      honyakuAge: honyakuAge,
      isTaiyaku: honyakuAge === TAIYAKU[sex]
    };
  }

  /**
   * 生年と性別から、すべての厄年(前厄・本厄・後厄)の西暦年を一覧で返す。
   * @param {number} birthYear 生年(西暦)
   * @param {"male"|"female"} sex 性別
   * @returns {{ok:true, rows:Array<{honyakuAge:number, maeyakuYear:number, honyakuYear:number,
   *            atoyakuYear:number, isTaiyaku:boolean}>}
   *          |{ok:false, code:"invalid_birth_year"|"invalid_sex"}}
   *   西暦年は 生年 + 数え年 − 1 で求める
   */
  function schedule(birthYear, sex) {
    if (!isYear(birthYear)) return { ok: false, code: "invalid_birth_year" };
    if (sex !== "male" && sex !== "female") return { ok: false, code: "invalid_sex" };
    var rows = HONYAKU[sex].map(function (age) {
      return {
        honyakuAge: age,
        maeyakuYear: birthYear + (age - 1) - 1,
        honyakuYear: birthYear + age - 1,
        atoyakuYear: birthYear + (age + 1) - 1,
        isTaiyaku: age === TAIYAKU[sex]
      };
    });
    return { ok: true, rows: rows };
  }

  var api = {
    kazoedoshi: kazoedoshi,
    calculate: calculate,
    schedule: schedule
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.YakudoshiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
