/*
 * 英語住所変換ロジック(日本の住所 → 英語表記の並び替え・整形)
 *
 * 根拠(一次情報):
 * - 日本郵便「国際郵便 宛名の記入方法」: 英語表記は 建物・部屋 → 番地 町域 → 市区町村 → 都道府県 郵便番号 → 国名 の順
 *   https://www.post.japanpost.jp/int/use/writing/normal.html
 * - 郵便番号・住所・カナ読みのデータは日本郵便「郵便番号データ」(shared/postal/、ページ側で取得)
 *
 * 前提:
 * - ローマ字はカナからの機械変換(生成器: scripts/build/gen_postal_data.py)。ページ側で手修正できる
 * - 京都の通り名(「〜通上ル」等)・大口事業所の個別郵便番号は町域データに無いことがある(手入力で補える)
 */
(function (global) {
  "use strict";

  var ZEN_NUM = "０１２３４５６７８９";

  function toHalf(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var idx = ZEN_NUM.indexOf(s[i]);
      if (idx >= 0) out += String(idx);
      else if (s[i] === "−" || s[i] === "ー" || s[i] === "‐" || s[i] === "―" || s[i] === "-") out += "-";
      else out += s[i];
    }
    return out;
  }

  /**
   * 郵便番号の正規化。「〒100-0014」「1000014」「100 0014」等を受け付ける。
   * @returns {{ok:true, zip3:string, zip4:string, zip:string}|{ok:false, code:"invalid_zip"}}
   */
  function normalizeZip(input) {
    if (typeof input !== "string") return { ok: false, code: "invalid_zip" };
    var digits = toHalf(input).replace(/[^0-9]/g, "");
    if (digits.length !== 7) return { ok: false, code: "invalid_zip" };
    return { ok: true, zip3: digits.slice(0, 3), zip4: digits.slice(3), zip: digits.slice(0, 3) + "-" + digits.slice(3) };
  }

  /**
   * 丁目・番地・号を英語住所用の「1-2-3」形式へ。
   * 「1丁目2番3号」「1丁目2-3」「一丁目」の漢数字は対象外(数字のみ対応)。
   * @returns {{ok:true, banchi:string}|{ok:false, code:"invalid_banchi"}}
   */
  function normalizeBanchi(input) {
    if (typeof input !== "string") return { ok: false, code: "invalid_banchi" };
    var s = toHalf(input).trim();
    if (s === "") return { ok: true, banchi: "" };
    s = s.replace(/丁目|番地|番/g, "-").replace(/号/g, "");
    s = s.replace(/[\s]+/g, "");
    s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!/^[0-9][0-9-]*$/.test(s)) return { ok: false, code: "invalid_banchi" };
    return { ok: true, banchi: s };
  }

  /**
   * 英語表記の住所を組み立てる。
   * @param {{zip:string, pref:string, city:string, neighborhood:string, banchi:string, building:string}} p
   *   pref/city/neighborhood はローマ字。banchi は normalizeBanchi 済みの値。building は任意
   * @returns {{ok:true, lines:string[], single:string}|{ok:false, code:"missing_area"}}
   */
  function englishAddress(p) {
    if (!p || !p.pref || !p.city) return { ok: false, code: "missing_area" };
    var street = [];
    if (p.banchi) street.push(p.banchi);
    if (p.neighborhood) street.push(p.neighborhood);
    var lines = [];
    if (p.building) lines.push(p.building);
    if (street.length) lines.push(street.join(" "));
    lines.push(p.city);
    lines.push(p.pref + (p.zip ? " " + p.zip : ""));
    lines.push("JAPAN");
    return { ok: true, lines: lines, single: lines.join(", ") };
  }

  /* ============================================================
   * 逆方向: 母国の書き方で書かれた日本の住所 → 日本語表記
   * ============================================================
   * 対応国は在留外国人が多い上位10か国・地域
   * (出入国在留管理庁「令和7年末現在における在留外国人数について」)
   *
   * 解析は「並び順に依存しない」方式にしている。国によって住所を書く順番が
   * 大きい順・小さい順と分かれるため、位置ではなく次のパターンで拾う:
   *   郵便番号 = 7桁の数字 / 番地 = 数字とハイフンだけの塊 / 残り = 建物名・部屋
   * これにより、どの国の並びで書かれていても同じ結果になる。
   * 国の選択は「部屋番号の書き方(Apt/Sala/#など)」の判定と、
   * その国の書き方の例を出すために使う。
   */

  // order: "small-first" = 番地から書く / "large-first" = 都道府県から書く
  // room: その国で部屋番号の前に付く語(小文字で比較する)
  var COUNTRIES = [
    { code: "cn", order: "large-first", room: ["room", "rm", "apt", "apartment", "no", "unit"] },
    { code: "vn", order: "small-first", room: ["phong", "so", "room", "apt", "apartment"] },
    { code: "kr", order: "small-first", room: ["ho", "room", "apt", "apartment", "unit"] },
    { code: "ph", order: "small-first", room: ["unit", "rm", "room", "apt", "apartment", "blk", "block"] },
    { code: "np", order: "small-first", room: ["room", "apt", "apartment", "flat"] },
    { code: "id", order: "small-first", room: ["kamar", "no", "room", "apt", "apartment", "unit"] },
    { code: "br", order: "small-first", room: ["apto", "apt", "ap", "sala", "casa", "room", "apartment"] },
    { code: "mm", order: "small-first", room: ["room", "apt", "apartment", "no"] },
    { code: "lk", order: "small-first", room: ["no", "room", "apt", "apartment", "flat"] },
    { code: "tw", order: "large-first", room: ["room", "rm", "apt", "apartment", "no", "unit", "f"] },
    { code: "other", order: "small-first", room: ["room", "rm", "apt", "apartment", "unit", "flat", "no"] }
  ];

  function countryOf(code) {
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (COUNTRIES[i].code === code) return COUNTRIES[i];
    }
    return COUNTRIES[COUNTRIES.length - 1]; // other
  }

  /**
   * 逆引き用の照合キー。大文字小文字・空白・ハイフン・アポストロフィの差を吸収する。
   * scripts/build/gen_postal_data.py の rev_key と同じ規則にすること。
   */
  function revKey(s) {
    return typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  }

  /**
   * 母国式に書かれた日本の住所を、部品に分解する。
   * @param {string} input 住所の文字列(1行でも複数行でもよい)
   * @param {string} countryCode 国コード(COUNTRIESのcode。未知の値は "other" 扱い)
   * @returns {{ok:true, zip:string, zipDigits:string, banchi:string, building:string, words:string[]}
   *          |{ok:false, code:"empty"}}
   *   zip: "100-0014" 形式(見つからなければ空) / banchi: "1-2-3" 形式(見つからなければ空)
   *   building: 郵便番号・番地・地名以外に残った文字列 / words: 地名候補の語(逆引きに使う)
   */
  function parseForeignAddress(input, countryCode) {
    if (typeof input !== "string" || input.trim() === "") return { ok: false, code: "empty" };
    var country = countryOf(countryCode);
    // 全角→半角、区切り記号を空白に寄せる。JAPAN/日本の国名は落とす
    var s = toHalf(input).replace(/[〒]/g, " ").replace(/[,、\n\r\t/]+/g, " ");
    s = s.replace(/\b(japan|nippon|nihon)\b/gi, " ").replace(/日本国?/g, " ");
    // 「1丁目2番3号」形式は先に「1-2-3」へ寄せる
    s = s.replace(/([0-9])\s*丁目\s*/g, "$1-").replace(/([0-9])\s*番地?\s*/g, "$1-")
         .replace(/([0-9])\s*号(?!室|館)/g, "$1").replace(/-+/g, "-");
    // 漢字・かなの住所は分かち書きしないため、CJKと数字の境目に空白を入れて語に分ける
    // (ただし「201号室」「2階」のように数字に付く接尾辞は切り離さない)
    var CJK = "\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff";
    s = s.replace(new RegExp("([" + CJK + "])(?=[0-9])", "g"), "$1 ")
         .replace(new RegExp("([0-9])(?=[" + CJK + "])", "g"), "$1 ")
         .replace(/([0-9])\s+(号室|号館|階|F)/g, "$1$2");
    var tokens = s.split(/\s+/).filter(function (t) { return t !== ""; });

    function isNumericToken(t) { return /^[0-9][0-9-]*$/.test(t); }

    // 第1段階: 部屋を示す語(Apt / Room / Sala / #201 / 201号室 / 2F)と、その直後の数字を建物側に確定させる。
    // 先に確定させないと「Apt 201, 3-2-1 …」の201を番地と取り違える。
    var taken = new Array(tokens.length);
    var roomParts = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var bare = t.toLowerCase().replace(/[^a-z]/g, "");
      if (country.room.indexOf(bare) >= 0 && !/[0-9]/.test(t)) {
        taken[i] = true;
        roomParts.push(t);
        if (i + 1 < tokens.length && /[0-9]/.test(tokens[i + 1])) {
          taken[i + 1] = true;
          roomParts.push(tokens[i + 1]);
          i++;
        }
      } else if (/^#/.test(t) || /号室|号館|階$/.test(t) || /^[0-9]+f$/i.test(t)) {
        taken[i] = true;
        roomParts.push(t);
      }
    }

    // 第2段階: 郵便番号(数字7桁だけの塊)
    var zip = "";
    for (var k = 0; k < tokens.length; k++) {
      if (taken[k]) continue;
      if (isNumericToken(tokens[k]) && tokens[k].replace(/[^0-9]/g, "").length === 7) {
        zip = tokens[k].replace(/[^0-9]/g, "");
        zip = zip.slice(0, 3) + "-" + zip.slice(3);
        taken[k] = true;
        break;
      }
    }

    // 第3段階: 番地。ハイフンでつながった数字(3-2-1)を優先し、無ければ単独の数字を使う
    var banchi = "";
    var banchiIdx = -1;
    for (var m = 0; m < tokens.length; m++) {
      if (taken[m] || !isNumericToken(tokens[m])) continue;
      if (tokens[m].indexOf("-") >= 0) { banchiIdx = m; break; }
      if (banchiIdx < 0) banchiIdx = m;
    }
    if (banchiIdx >= 0) {
      banchi = tokens[banchiIdx].replace(/-+/g, "-").replace(/^-|-$/g, "");
      taken[banchiIdx] = true;
    }

    // 第4段階: 残りを地名候補と建物名に振り分ける。数字を含む語は建物側
    var words = [];
    var building = roomParts.slice();
    for (var n = 0; n < tokens.length; n++) {
      if (taken[n]) continue;
      if (/[0-9]/.test(tokens[n])) building.push(tokens[n]);
      else words.push(tokens[n]);
    }

    return {
      ok: true,
      zip: zip,
      zipDigits: zip.replace("-", ""),
      banchi: banchi,
      building: building.join(" "),
      words: words
    };
  }

  /**
   * 郵便番号から地名が確定したあと、地名にあたる語を建物名から取り除く。
   * 解析の時点では「Sakura Heights」と「Chiyoda-ku」を区別できないため、
   * 確定した都道府県・市区町村・町域(漢字とローマ字の両方)と一致する語だけを落とす。
   * @param {{building:string, words:string[]}} parsed parseForeignAddress の結果
   * @param {string[]} known 確定した地名(漢字・ローマ字を混ぜてよい)
   * @returns {{building:string, unknownWords:string[]}}
   */
  function refineBuilding(parsed, known) {
    if (!parsed || !parsed.ok) return { building: "", unknownWords: [] };
    var knownKeys = {};
    for (var i = 0; i < (known || []).length; i++) {
      var parts = String(known[i]).split(/[\s,]+/);
      for (var p = 0; p < parts.length; p++) {
        var k = revKey(parts[p]);
        if (k) knownKeys[k] = true;
        // 「Chiyoda-ku」と「Chiyoda」、「千代田区」と「千代田」のどちらでも一致させる
        var trimmed = parts[p].replace(/-(shi|ku|cho|machi|mura|son|gun)$/i, "").replace(/[都道府県市区町村郡]$/, "");
        var k2 = revKey(trimmed);
        if (k2) knownKeys[k2] = true;
      }
      var whole = revKey(String(known[i]));
      if (whole) knownKeys[whole] = true;
    }
    // 漢字・かなの住所は分かち書きされないので、既知の地名を語の中から取り除いて判定する
    var cjkNames = [];
    for (var c = 0; c < (known || []).length; c++) {
      if (/[぀-ヿ㐀-䶿一-鿿]/.test(String(known[c]))) cjkNames.push(String(known[c]));
    }
    cjkNames.sort(function (a, b) { return b.length - a.length; });

    var leftover = [];
    for (var j = 0; j < parsed.words.length; j++) {
      var w = parsed.words[j];
      if (/[぀-ヿ㐀-䶿一-鿿]/.test(w)) {
        var stripped = w;
        for (var q = 0; q < cjkNames.length; q++) stripped = stripped.split(cjkNames[q]).join("");
        if (stripped === "") continue;
        leftover.push(stripped);
        continue;
      }
      var wk = revKey(w);
      var wk2 = revKey(w.replace(/-(shi|ku|cho|machi|mura|son|gun)$/i, "").replace(/[都道府県市区町村郡]$/, ""));
      if (knownKeys[wk] || knownKeys[wk2]) continue;
      leftover.push(w);
    }
    var building = [];
    if (leftover.length) building.push(leftover.join(" "));
    if (parsed.building) building.push(parsed.building);
    return { building: building.join(" ").trim(), unknownWords: leftover };
  }

  /**
   * 日本語表記の住所を組み立てる。
   * @param {{zip:string, pref:string, city:string, town:string, banchi:string, building:string}} p
   *   pref/city/town は漢字。建物名は固有名詞のため受け取った表記のまま使う
   * @returns {{ok:true, lines:string[], single:string}|{ok:false, code:"missing_area"}}
   */
  function japaneseAddress(p) {
    if (!p || !p.pref || !p.city) return { ok: false, code: "missing_area" };
    var lines = [];
    if (p.zip) lines.push("〒" + p.zip);
    lines.push(p.pref + p.city + (p.town || "") + (p.banchi || ""));
    if (p.building) lines.push(p.building);
    return { ok: true, lines: lines, single: lines.join(" ") };
  }

  /**
   * 「1-2-3」を「1丁目2番3号」形式にする(書類で丁目表記を求められたとき用)。
   * 数字が3つでない場合は変換できないため空文字を返す。
   * @returns {string}
   */
  function banchiToChome(banchi) {
    if (typeof banchi !== "string") return "";
    var parts = banchi.split("-");
    if (parts.length !== 3 || !parts.every(function (x) { return /^[0-9]+$/.test(x); })) return "";
    return parts[0] + "丁目" + parts[1] + "番" + parts[2] + "号";
  }

  var api = {
    normalizeZip: normalizeZip,
    normalizeBanchi: normalizeBanchi,
    englishAddress: englishAddress,
    parseForeignAddress: parseForeignAddress,
    japaneseAddress: japaneseAddress,
    banchiToChome: banchiToChome,
    refineBuilding: refineBuilding,
    revKey: revKey,
    countryOf: countryOf,
    COUNTRIES: COUNTRIES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JushoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
