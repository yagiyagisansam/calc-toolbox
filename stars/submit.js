/*
 * スポット申請フォーム。
 * 申請者に座標の確定を求めず、管理者が掲載前に場所を確認する。
 */
(function (global) {
  "use strict";
  var Net = global.StarsNet;
  var DEVICE_KEY = "stars:device";
  var SUBMITTED_KEY = "stars:submitted";

  function el(id) { return document.getElementById(id); }

  function deviceId() {
    var v = null;
    try { v = localStorage.getItem(DEVICE_KEY); } catch (e) { v = null; }
    if (v && v.length >= 8) return v;
    var bytes = new Uint8Array(16);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    v = Array.prototype.map.call(bytes, function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
    try { localStorage.setItem(DEVICE_KEY, v); } catch (e) {}
    return v;
  }

  function fillPrefectures() {
    return fetch("./data/prefs.json").then(function (r) { return r.json(); }).then(function (data) {
      var select = el("f-pref");
      data.regions.forEach(function (region) {
        var group = document.createElement("optgroup");
        group.label = region;
        data.prefectures.filter(function (p) { return p.region === region; }).forEach(function (p) {
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
    var node = el(id);
    if (!node) return null;
    var v = node.value.trim();
    return v === "" ? null : v;
  }

  function validate() {
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

  function payload() {
    var elev = value("f-elev");
    return {
      name: value("f-name"),
      pref: value("f-pref"),
      city: value("f-city"),
      address: value("f-address"),
      lat: null,
      lon: null,
      elevation_m: elev === null ? null : Number(elev),
      access: value("f-access"),
      facilities: value("f-facilities"),
      note: value("f-note"),
      caution: value("f-caution"),
      source_url: value("f-url"),
      submitter_hint: deviceId()
    };
  }

  function explain(result) {
    if (result.code === "duplicate") return "この場所はすでに申請されています。";
    var m = result.message || "";
    if (/rate limited/.test(m)) return "短い間に多くの申請が届いています。時間をおいてからお試しください。";
    if (/unknown prefecture/.test(m)) return "都道府県を選び直してください。";
    if (/invalid url/.test(m)) return "参考URLは https:// で始まるものを入力してください。";
    return "申請を保存できませんでした。入力内容を見直してお試しください。";
  }

  function rememberSubmitted(name) {
    try {
      var list = JSON.parse(localStorage.getItem(SUBMITTED_KEY) || "[]");
      list.push({ name: name, at: new Date().toISOString() });
      localStorage.setItem(SUBMITTED_KEY, JSON.stringify(list.slice(-20)));
    } catch (e) {}
  }

  function submit(event) {
    event.preventDefault();
    var problem = validate();
    if (problem) { showMessage(problem, true); return; }
    if (!Net.backendReady()) {
      showMessage("いまは申請を受け付けられません。しばらくしてからお試しください。", true);
      return;
    }
    var button = el("submit-button");
    var data = payload();
    button.disabled = true;
    showMessage("送信しています…", false);
    Net.submitSpot(data).then(function (result) {
      if (result.ok) {
        rememberSubmitted(data.name);
        el("submit-form").hidden = true;
        showMessage("申請を受け付けました。管理者が場所と利用条件を確認したうえで掲載します。ありがとうございました。", false);
        return;
      }
      button.disabled = false;
      showMessage(explain(result), true);
    }).catch(function () {
      button.disabled = false;
      showMessage("送信できませんでした。通信の状態を確かめて、もう一度お試しください。", true);
    });
  }

  function start() {
    fillPrefectures().catch(function () {
      showMessage("都道府県の一覧を読み込めませんでした。ページを再読み込みしてください。", true);
    });
    el("submit-form").addEventListener("submit", submit);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  global.StarsSubmit = { validate: validate, payload: payload };
})(typeof window !== "undefined" ? window : globalThis);
