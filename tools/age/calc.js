/*
 * 年齢・学年(早生まれ)計算ロジック
 *
 * 根拠(一次情報):
 * - 満年齢の起算: 年齢計算ニ関スル法律(明治35年法律第50号)
 *   https://laws.e-gov.go.jp/law/135AC1000000050
 *   (法律上は誕生日の前日の満了時に加齢する。本ツールは通俗的な
 *    「誕生日当日に1歳加算」で計算し、その旨をページに明記)
 * - 早生まれ(1月1日〜4月1日生まれは前の学年): 学校教育法第17条
 *   https://laws.e-gov.go.jp/law/322AC0000000026
 *   (4月1日生まれが前学年になるのは、前日満了により3月31日に加齢するため)
 *
 * 前提:
 * - 2月29日生まれは、平年では3月1日に加齢する扱い(通俗計算)
 * - 干支(十二支)は生まれ年の西暦から算出
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1868;
  var YEAR_MAX = 2100;
  var ETO = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function daysInMonth(y, m) {
    return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  // "YYYY-MM-DD" を検証つきで {y, m, d} に分解する。不正なら null
  function parseDate(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10);
    var d = parseInt(iso.slice(8, 10), 10);
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > daysInMonth(y, m)) return null;
    return { y: y, m: m, d: d };
  }

  /**
   * 基準日時点の満年齢・早生まれ判定・干支を計算する。
   * @param {string} birthIso 生年月日 "YYYY-MM-DD"
   * @param {string} asOfIso 基準日 "YYYY-MM-DD"
   * @returns {{ok: true, age: number, hayaumare: boolean, eto: string}
   *          |{ok: false, code: string}}
   *   code: "invalid_birth" | "invalid_asof" | "birth_after_asof"
   */
  function calculate(birthIso, asOfIso) {
    var b = parseDate(birthIso);
    if (!b || b.y < YEAR_MIN || b.y > YEAR_MAX) return { ok: false, code: "invalid_birth" };
    var a = parseDate(asOfIso);
    if (!a || a.y < YEAR_MIN || a.y > YEAR_MAX) return { ok: false, code: "invalid_asof" };
    if (a.y < b.y || (a.y === b.y && (a.m < b.m || (a.m === b.m && a.d < b.d)))) {
      return { ok: false, code: "birth_after_asof" };
    }
    var beforeBirthday = a.m < b.m || (a.m === b.m && a.d < b.d);
    var age = a.y - b.y - (beforeBirthday ? 1 : 0);
    var hayaumare = b.m === 1 || b.m === 2 || b.m === 3 || (b.m === 4 && b.d === 1);
    return {
      ok: true,
      age: age,
      hayaumare: hayaumare,
      eto: ETO[((b.y - 4) % 12 + 12) % 12]
    };
  }

  // グレゴリオ暦の通日変換(tools/days/ と同じアルゴリズム)
  function toSerial(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400);
    var yoe = y - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = "0" + s;
    return s;
  }

  // その年の誕生日(2月29日生まれは平年なら3月1日扱い。calculate と同じ前提)
  function birthdayIn(y, bm, bd) {
    if (bm === 2 && bd === 29 && !isLeapYear(y)) return { m: 3, d: 1 };
    return { m: bm, d: bd };
  }

  /**
   * 次の誕生日の日付・あと何日か・何歳になるかを計算する。
   * 基準日が誕生日当日の場合は daysLeft=0、turning=その日に達した満年齢。
   * 2月29日生まれは平年では3月1日を誕生日として扱う(calculate と同じ前提)。
   * あわせて生まれてから基準日までの通算日数(daysOld、生まれた日=0日)も返す。
   * @param {string} birthIso 生年月日 "YYYY-MM-DD"
   * @param {string} asOfIso 基準日 "YYYY-MM-DD"
   * @returns {{ok:true, date:string, daysLeft:number, turning:number, daysOld:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_birth" | "invalid_asof" | "birth_after_asof"
   */
  function nextBirthday(birthIso, asOfIso) {
    var base = calculate(birthIso, asOfIso);
    if (!base.ok) return base;
    var b = parseDate(birthIso);
    var a = parseDate(asOfIso);
    var eff = birthdayIn(a.y, b.m, b.d);
    var y = a.y;
    if (a.m > eff.m || (a.m === eff.m && a.d > eff.d)) {
      y = a.y + 1;
      eff = birthdayIn(y, b.m, b.d);
    }
    var daysLeft = toSerial(y, eff.m, eff.d) - toSerial(a.y, a.m, a.d);
    return {
      ok: true,
      date: pad(y, 4) + "-" + pad(eff.m, 2) + "-" + pad(eff.d, 2),
      daysLeft: daysLeft,
      turning: daysLeft === 0 ? base.age : base.age + 1,
      daysOld: toSerial(a.y, a.m, a.d) - toSerial(b.y, b.m, b.d)
    };
  }

  /**
   * 節目の年齢(成年18歳・還暦60歳・年金の目安65歳・長寿祝いなど)を迎える日付の一覧。
   * 日付は「誕生日当日に加齢」の通俗計算(2月29日生まれは平年3月1日)。
   * 2100年(YEAR_MAX)を超える節目は一覧から除外する。
   * @param {string} birthIso 生年月日 "YYYY-MM-DD"
   * @returns {{ok:true, rows:Array<{age:number, label:string, date:string}>}
   *          |{ok:false, code:string}}  code: "invalid_birth"
   */
  function milestoneAges(birthIso) {
    var b = parseDate(birthIso);
    if (!b || b.y < YEAR_MIN || b.y > YEAR_MAX) return { ok: false, code: "invalid_birth" };
    var defs = [
      { age: 18, label: "成年(成人年齢)" },
      { age: 20, label: "20歳(飲酒・喫煙が可能に)" },
      { age: 60, label: "還暦・定年の目安" },
      { age: 65, label: "年金受給開始の目安" },
      { age: 70, label: "古希" },
      { age: 77, label: "喜寿" },
      { age: 80, label: "傘寿" },
      { age: 88, label: "米寿" },
      { age: 90, label: "卒寿" },
      { age: 100, label: "百寿" }
    ];
    var rows = [];
    for (var i = 0; i < defs.length; i++) {
      var y = b.y + defs[i].age;
      if (y > YEAR_MAX) continue;
      var eff = birthdayIn(y, b.m, b.d);
      rows.push({
        age: defs[i].age,
        label: defs[i].label,
        date: pad(y, 4) + "-" + pad(eff.m, 2) + "-" + pad(eff.d, 2)
      });
    }
    return { ok: true, rows: rows };
  }

  var api = {
    milestoneAges: milestoneAges,
    nextBirthday: nextBirthday,
    calculate: calculate,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.AgeCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
