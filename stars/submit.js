/*
 * スポット申請フォーム。
 *
 * 方針:
 *   - ログイン不要。氏名・連絡先は一切集めない。
 *   - 都道府県はプルダウンで選んでもらう。座標から自動判定はしない
 *     (静的サイトなので逆ジオコーディングを中継できず、ブラウザから
 *      外部の地名検索を叩き続けるのは先方への負荷として不適切なため)。
 *   - ここでの入力チェックは「親切のため」で、正しさの担保はデータベース側の
 *     トリガが行う(クライアントの検証はいくらでも迂回できる)。
 *   - 送信できるのは未承認(pending)としての登録だけ。掲載は管理者の承認後。
 */
(function (global) {
  "use strict";

  var CONFIG = global.STARS_CONFIG;
  var LP = global.StarsLP;
  var Score = global.StarsScore;
  var Net = global.StarsNet;

  var DEVICE_KEY = "stars:device";
  var SUBMITTED_KEY = "stars:submitted";

  var picked = null; // {lat, lon}
  var frame = null; // 地図を入れている枠(pick.html)
  var frameReady = false;

  function el(id) {
    return document.getElementById(id);
  }

  // ---- 端末ごとの識別子 ---------------------------------------------------

  /**
   * 連投を見分けるためだけのランダムな文字列。
   * 個人を特定する情報は含まない。消されたら別端末として扱われるだけ。
   */
  function deviceId() {
    var v = null;
    try {
      v = localStorage.getItem(DEVICE_KEY);
    } catch (e) {
      v = null;
    }
    if (v && v.length >= 8) return v;

    var bytes = new Uint8Array(16);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    v = Array.prototype.map
      .call(bytes, function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
    try {
      localStorage.setItem(DEVICE_KEY, v);
    } catch (e) {
      // 保存できなくても送信はできる
    }
    return v;
  }

  // ---- 地図で地点を選ぶ ---------------------------------------------------

  /*
   * 地図を枠(pick.html)に読み込む。
   *
   * 地図そのものを別のページに置いているのは、MapLibre が中で DOM への
   * 文字列の書き込みを行うため。同居させるとこの画面で Trusted Types を
   * 強制できない。申請フォームは利用者の入力をそのまま扱う画面なので、
   * 地図の都合で守りを下げたくない。
   *
   * 場所が日本の範囲に入っているかの判断は、これまでどおりこちら側で行う。
   * 枠の中は「タップされた」「印を動かされた」を伝えるだけで、
   * 良し悪しは決めない。
   */
  function setupMap() {
    var slot = el("pick-map");
    if (!slot) return;

    global.addEventListener("message", function (e) {
      if (!frame || e.source !== frame.contentWindow) return;
      if (e.origin !== global.location.origin) return;
      var data = e.data;
      if (!data) return;

      if (data.type === "stars-pick:ready") {
        frameReady = true;
        frame.contentWindow.postMessage(
          {
            type: "stars-pick:init",
            origin: picked,
            zoom: 4.2,
            minZoom: 3,
            maxZoom: 16,
            draggable: true
          },
          global.location.origin
        );
        return;
      }

      if (data.type === "stars-pick:picked") {
        pick(data.lat, data.lon, data.from);
      }
    });

    frame = document.createElement("iframe");
    frame.src = "./pick.html";
    frame.title = "地図で場所を選ぶ";
    frame.className = "stars-pickmap-frame";
    /*
     * 同じサイトの中の枠なので allow-same-origin は要る(地図の worker が
     * 同一生成元でないと動かない)。それ以外は許さない ──
     * 画面の乗っ取り(top への移動)、別窓、フォームの送信を止める。
     */
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("referrerpolicy", "same-origin");
    slot.appendChild(frame);
  }

  /** 枠の中の印を、こちらが決めた場所へ合わせる */
  function syncMarker() {
    if (!frame || !frameReady) return;
    frame.contentWindow.postMessage(
      picked
        ? { type: "stars-pick:mark", lat: picked.lat, lon: picked.lon }
        : { type: "stars-pick:unmark" },
      global.location.origin
    );
  }

  /**
   * 場所を決める。日本の範囲の外なら受け付けない。
   *
   * 範囲外だったときは、枠の中の印を「いま受け付けている場所」へ戻す。
   * 戻さないと、印だけが範囲外に残り、画面と実際の申請内容が食い違う
   * (印をドラッグで海の向こうへ持って行かれた場合がこれにあたる)。
   *
   * @param {number} lat
   * @param {number} lon
   * @param {string} [from] "click" か "drag"。枠の中から来たときだけ入る
   */
  function pick(lat, lon, from) {
    var b = CONFIG.submitBounds;
    if (lat < b.south || lat > b.north || lon < b.west || lon > b.east) {
      showMessage("いまは日本国内のスポットだけを受け付けています。", true);
      if (from) syncMarker();
      return;
    }
    picked = { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };

    // 枠の外(検証や現在地)から呼ばれたときは、枠の中の印も合わせる
    if (!from) syncMarker();

    el("pick-readout").textContent =
      "北緯 " + picked.lat.toFixed(5) + " / 東経 " + picked.lon.toFixed(5);
    showDarkness();
    showMessage("", false);
  }

  /** 選んだ地点の空の暗さを、条件が揃った場合の目安として出す */
  function showDarkness() {
    var box = el("pick-darkness");
    if (!box || !LP.isReady() || !picked) return;
    var index = LP.index(picked.lat, picked.lon);
    if (index === null) {
      box.textContent = "";
      return;
    }
    var best = Score.evaluate({
      lpIndex: index,
      cloudPct: 0,
      precipPct: 0,
      moonBrightness: 0
    });
    box.textContent =
      "この地点の空の暗さ: 快晴・月なしなら「" + best.band.label + "」(" + best.score + "点)";
  }

  // ---- フォーム -----------------------------------------------------------

  function fillPrefectures() {
    return fetch("./data/prefs.json")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var select = el("f-pref");
        data.regions.forEach(function (region) {
          var group = document.createElement("optgroup");
          group.label = region;
          data.prefectures
            .filter(function (p) {
              return p.region === region;
            })
            .forEach(function (p) {
              var opt = document.createElement("option");
              opt.value = p.pref;
              opt.textContent = p.pref;
              group.appendChild(opt);
            });
          select.appendChild(group);
        });
      });
  }

  function showMessage(text, isError) {
    var box = el("submit-message");
    box.hidden = !text;
    box.textContent = text;
    box.classList.toggle("is-error", !!isError);
  }

  function value(id) {
    var v = el(id).value.trim();
    return v === "" ? null : v;
  }

  /** データベース側のトリガと同じ観点を、送る前に親切に伝えるための確認 */
  function validate() {
    if (!picked) return "地図をタップして場所を選んでください。";

    var name = value("f-name");
    if (!name) return "スポット名を入力してください。";
    if (name.length < 2 || name.length > 60) return "スポット名は2〜60文字で入力してください。";

    if (!value("f-pref")) return "都道府県を選んでください。";

    var url = value("f-url");
    if (url && !/^https:\/\/\S+$/.test(url)) return "参考URLは https:// で始まるものを入力してください。";

    var elev = value("f-elev");
    if (elev !== null) {
      var n = Number(elev);
      if (!Number.isFinite(n) || n < -50 || n > 4000) return "標高は -50〜4000 の範囲で入力してください。";
    }
    return null;
  }

  function submit(e) {
    e.preventDefault();
    var problem = validate();
    if (problem) {
      showMessage(problem, true);
      return;
    }
    if (!Net.backendReady()) {
      showMessage("いまは申請を受け付けられません。しばらくしてからお試しください。", true);
      return;
    }

    var button = el("submit-button");
    button.disabled = true;
    showMessage("送信しています…", false);

    var elev = value("f-elev");
    var payload = {
      name: value("f-name"),
      name_kana: value("f-kana"),
      pref: value("f-pref"),
      lat: picked.lat,
      lon: picked.lon,
      elevation_m: elev === null ? null : Number(elev),
      access: value("f-access"),
      facilities: value("f-facilities"),
      note: value("f-note"),
      city: value("f-city"),
      caution: value("f-caution"),
      source_url: value("f-url"),
      submitter_hint: deviceId()
    };

    Net.submitSpot(payload)
      .then(function (result) {
        if (result.ok) {
          rememberSubmitted(payload.name);
          el("submit-form").hidden = true;
          showMessage(
            "申請を受け付けました。管理者が内容を確認したうえで掲載します。ありがとうございました。",
            false
          );
          return;
        }
        button.disabled = false;
        showMessage(explain(result), true);
      })
      .catch(function () {
        button.disabled = false;
        showMessage("送信できませんでした。通信の状態を確かめて、もう一度お試しください。", true);
      });
  }

  /** データベースから返ってきた理由を、そのまま出さずに言い換える */
  function explain(result) {
    if (result.code === "duplicate") {
      return "この場所はすでに申請されています。";
    }
    var m = result.message || "";
    if (/rate limited/.test(m)) {
      return "短い間に多くの申請が届いています。時間をおいてからお試しください。";
    }
    if (/out of range/.test(m)) {
      return "いまは日本国内のスポットだけを受け付けています。";
    }
    if (/unknown prefecture/.test(m)) {
      return "都道府県を選び直してください。";
    }
    if (/invalid url/.test(m)) {
      return "参考URLは https:// で始まるものを入力してください。";
    }
    return "申請を保存できませんでした。入力内容を見直してお試しください。";
  }

  function rememberSubmitted(name) {
    try {
      var list = JSON.parse(localStorage.getItem(SUBMITTED_KEY) || "[]");
      list.push({ name: name, at: new Date().toISOString() });
      localStorage.setItem(SUBMITTED_KEY, JSON.stringify(list.slice(-20)));
    } catch (e) {
      // 保存できなくても支障はない
    }
  }

  // ---- 起動 ---------------------------------------------------------------

  function start() {
    setupMap();
    fillPrefectures().catch(function () {
      showMessage("都道府県の一覧を読み込めませんでした。ページを再読み込みしてください。", true);
    });
    // 暗さの目安を出すために光害データを読む(失敗しても申請はできる)
    LP.load(CONFIG.lightPollution.dataDir).then(showDarkness).catch(function () {});

    el("submit-form").addEventListener("submit", submit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // 検証から状態を覗けるようにしておく
  global.StarsSubmit = {
    pick: pick,
    validate: validate,
    picked: function () {
      return picked;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
