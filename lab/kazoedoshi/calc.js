/*
 * 数え年・満年齢の変換ロジック
 *
 * 根拠(一次情報):
 * - 年齢計算ニ関スル法律(明治35年法律第50号)
 *   https://laws.e-gov.go.jp/law/135AC1000000050 (2026年7月29日参照)
 *   1「年齢ハ出生ノ日ヨリ之ヲ起算ス」/ 2「民法第百四十三条ノ規定ハ年齢ノ計算ニ之ヲ準用ス」
 *   → 出生日を起算日とし、誕生日の前日の終了時(＝誕生日の午前0時)に1歳加算される。
 *     したがって「誕生日を迎えた日から新しい年齢」になる。
 * - 年齢のとなえ方に関する法律(昭和24年法律第96号、昭和25年1月1日施行)
 *   https://laws.e-gov.go.jp/law/324AC0100000096 (2026年7月29日参照)
 *   「国民は、年齢を数え年によつて言い表わす従来のならわしを改めて、年齢計算に関する法律…の
 *    規定により算定した年数…によつてこれを言い表わすのを常とするように心がけなければならない」
 * - 神社本庁「厄祓い」 https://www.jinjahoncho.or.jp/omairi/yakubarai/ (2026年7月29日参照)
 *   厄年は数え年。男性25・42・61歳、女性19・33・37(・61)歳。その前後の年が前厄・後厄。
 *   男性42歳と女性33歳が大厄。
 * - 神社本庁「長寿を祝う神事」 https://www.jinjahoncho.or.jp/omairi/choju/ (2026年7月29日参照)
 *   還暦61・古稀70・喜寿77・傘寿80・半寿81・米寿88・卒寿90・白寿99・百寿100・茶寿108・
 *   皇寿111・大還暦121。「年齢は、数え年、満年齢のいずれで数えても差し支えない」とされる。
 * - 神社本庁「七五三」 https://www.jinjahoncho.or.jp/omairi/shichigosan/ (2026年7月29日参照)
 *   3歳の髪置、5歳の袴着、7歳の帯解。数え年・満年齢のいずれで行うかは記載がない。
 *
 * 制度の時点:
 * - 上記の法令・慣習はいずれも【2026年(令和8年)7月29日時点】で有効。
 *
 * 前提:
 * - 満年齢は「基準日が誕生日以後なら 基準年−生年、誕生日より前なら 基準年−生年−1」。
 *   2月29日生まれの人は、平年は3月1日から新しい年齢になる(民法143条2項ただし書により
 *   期間は2月28日の終了時に満了するため)。本計算の月日比較はこの結果と一致する。
 * - 数え年は「生まれた年を1歳とし、元日ごとに1歳加える」＝ 基準年 − 生年 + 1。
 * - 賀寿・厄年・七五三は宗教的な慣習であり、法的な定めはない。地域や社寺により異なる。
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1868;
  var YEAR_MAX = 2200;

  // 賀寿(神社本庁「長寿を祝う神事」)。[年齢, 名称]
  var GAJU = [
    [61, "還暦(かんれき)"], [70, "古稀(こき)"], [77, "喜寿(きじゅ)"], [80, "傘寿(さんじゅ)"],
    [81, "半寿(はんじゅ)"], [88, "米寿(べいじゅ)"], [90, "卒寿(そつじゅ)"], [99, "白寿(はくじゅ)"],
    [100, "百寿・紀寿(ももじゅ・きじゅ)"], [108, "茶寿(ちゃじゅ)"], [111, "皇寿(こうじゅ)"],
    [121, "大還暦(だいかんれき)"]
  ];
  // 厄年の本厄(数え年、神社本庁「厄祓い」)
  var YAKU = { male: [25, 42, 61], female: [19, 33, 37, 61] };
  var TAIYAKU = { male: 42, female: 33 };
  // 七五三(神社本庁「七五三」)。3歳の髪置、5歳の袴着、7歳の帯解
  var SHICHIGOSAN = [[3, "髪置(かみおき)"], [5, "袴着(はかまぎ)"], [7, "帯解(おびとき)"]];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 実在する日付かどうかを判定する(2月30日などを弾く) */
  function isRealDate(y, m, d) {
    if (!isFiniteNumber(y) || !isFiniteNumber(m) || !isFiniteNumber(d)) return false;
    if (Math.floor(y) !== y || Math.floor(m) !== m || Math.floor(d) !== d) return false;
    if (y < YEAR_MIN || y > YEAR_MAX) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(y, m - 1, d);
    dt.setFullYear(y); // 年が2桁でも正しく扱う
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  /** 日付a(配列)が日付b以上かどうか */
  function isOnOrAfter(am, ad, bm, bd) {
    return am > bm || (am === bm && ad >= bd);
  }

  /**
   * 生年月日と基準日から、満年齢と数え年を求める。
   * @param {number} birthYear 生年(西暦、1868〜2200)
   * @param {number} birthMonth 生月(1〜12)
   * @param {number} birthDay 生日(1〜31。実在する日付であること)
   * @param {number} refYear 基準年(西暦)
   * @param {number} refMonth 基準月(1〜12)
   * @param {number} refDay 基準日(1〜31)
   * @returns {{ok:true, mannenrei:number, kazoedoshi:number, hadBirthday:boolean}
   *          |{ok:false, code:"invalid_birth_date"|"invalid_ref_date"|"ref_before_birth"}}
   *   mannenrei: 満年齢(歳)
   *   kazoedoshi: 数え年(歳)
   *   hadBirthday: 基準日の時点でその年の誕生日を迎えているか
   */
  function calculate(birthYear, birthMonth, birthDay, refYear, refMonth, refDay) {
    if (!isRealDate(birthYear, birthMonth, birthDay)) {
      return { ok: false, code: "invalid_birth_date" };
    }
    if (!isRealDate(refYear, refMonth, refDay)) {
      return { ok: false, code: "invalid_ref_date" };
    }
    if (refYear < birthYear ||
      (refYear === birthYear && !isOnOrAfter(refMonth, refDay, birthMonth, birthDay))) {
      return { ok: false, code: "ref_before_birth" };
    }
    var hadBirthday = isOnOrAfter(refMonth, refDay, birthMonth, birthDay);
    return {
      ok: true,
      mannenrei: refYear - birthYear - (hadBirthday ? 0 : 1),
      kazoedoshi: refYear - birthYear + 1,
      hadBirthday: hadBirthday
    };
  }

  /**
   * 数え年から、その年に該当する賀寿(長寿の祝い)の名称を返す。
   * @param {number} kazoedoshi 数え年(1以上200以下)
   * @returns {{ok:true, name:(string|null)}|{ok:false, code:"invalid_age"}}
   *   name: 該当する賀寿の名称。該当しない場合は null
   */
  function gaju(kazoedoshi) {
    if (!isFiniteNumber(kazoedoshi) || kazoedoshi < 1 || kazoedoshi > 200) {
      return { ok: false, code: "invalid_age" };
    }
    for (var i = 0; i < GAJU.length; i++) {
      if (GAJU[i][0] === kazoedoshi) return { ok: true, name: GAJU[i][1] };
    }
    return { ok: true, name: null };
  }

  /**
   * 数え年と性別から厄年かどうかを判定する。
   * @param {number} kazoedoshi 数え年(1以上200以下)
   * @param {string} sex 性別("male" / "female")
   * @returns {{ok:true, kind:(string|null), honyaku:(number|null), taiyaku:boolean}
   *          |{ok:false, code:"invalid_age"|"invalid_sex"}}
   *   kind: "前厄" / "本厄" / "後厄" のいずれか。厄年でなければ null
   *   honyaku: 対応する本厄の数え年。厄年でなければ null
   *   taiyaku: 大厄(男性42歳・女性33歳)の3年間に当たるか
   */
  function yakudoshi(kazoedoshi, sex) {
    if (!isFiniteNumber(kazoedoshi) || kazoedoshi < 1 || kazoedoshi > 200) {
      return { ok: false, code: "invalid_age" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    var list = YAKU[sex];
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      var kind = kazoedoshi === h - 1 ? "前厄" : kazoedoshi === h ? "本厄" : kazoedoshi === h + 1 ? "後厄" : null;
      if (kind) {
        return { ok: true, kind: kind, honyaku: h, taiyaku: h === TAIYAKU[sex] };
      }
    }
    return { ok: true, kind: null, honyaku: null, taiyaku: false };
  }

  /**
   * 生年から、これから迎える節目の年(賀寿・厄年・七五三)を西暦つきで一覧にする。
   * @param {number} birthYear 生年(西暦)
   * @param {string} sex 性別("male" / "female")
   * @param {number} fromYear この西暦年以降のものだけ返す
   * @param {number} [limit=8] 返す件数の上限(1〜50)
   * @returns {{ok:true, items:Array<{year:number, kazoedoshi:number, type:string, name:string}>}
   *          |{ok:false, code:"invalid_birth_year"|"invalid_sex"|"invalid_from_year"|"invalid_limit"}}
   *   type: "賀寿" / "厄年" / "七五三"
   */
  function milestones(birthYear, sex, fromYear, limit) {
    if (!isFiniteNumber(birthYear) || birthYear < YEAR_MIN || birthYear > YEAR_MAX) {
      return { ok: false, code: "invalid_birth_year" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    if (!isFiniteNumber(fromYear) || fromYear < YEAR_MIN || fromYear > YEAR_MAX) {
      return { ok: false, code: "invalid_from_year" };
    }
    var max = limit === undefined ? 8 : limit;
    if (!isFiniteNumber(max) || max < 1 || max > 50) {
      return { ok: false, code: "invalid_limit" };
    }

    var items = [];
    function push(kazoe, type, name) {
      var year = birthYear + kazoe - 1; // 数え年kazoeになる西暦年
      if (year >= fromYear) items.push({ year: year, kazoedoshi: kazoe, type: type, name: name });
    }
    SHICHIGOSAN.forEach(function (s) { push(s[0], "七五三", s[0] + "歳 " + s[1]); });
    YAKU[sex].forEach(function (h) {
      push(h - 1, "厄年", h + "歳の前厄");
      push(h, "厄年", h + "歳の本厄" + (h === TAIYAKU[sex] ? "(大厄)" : ""));
      push(h + 1, "厄年", h + "歳の後厄");
    });
    GAJU.forEach(function (g) { push(g[0], "賀寿", g[1]); });

    items.sort(function (a, b) { return a.year - b.year || a.kazoedoshi - b.kazoedoshi; });
    return { ok: true, items: items.slice(0, max) };
  }

  var api = {
    calculate: calculate,
    gaju: gaju,
    yakudoshi: yakudoshi,
    milestones: milestones
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KazoedoshiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
