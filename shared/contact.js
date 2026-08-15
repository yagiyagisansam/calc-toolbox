// お問い合わせフォーム(contact.html)
// 送信先はアンケートツールと同じデータベース。接続設定は tools/poll/config.js を共用する。
// anonキーは公開前提のキーで、このページからできるのは問い合わせのINSERTだけ(RLSと列権限で制限)。
// CSPで require-trusted-types-for 'script' を指定しているため、DOMの組み立てに innerHTML は使わない。
(function () {
  "use strict";

  var form = document.getElementById("contact-form");
  var catSel = document.getElementById("category");
  var toolRow = document.getElementById("tool-row");
  var toolSel = document.getElementById("tool");
  var msg = document.getElementById("message");
  var btn = document.getElementById("send-btn");
  var box = document.getElementById("contact-result");
  var confirmBg = document.getElementById("confirm-bg");
  var confirmList = document.getElementById("confirm-list");
  if (!form || !catSel || !toolRow || !toolSel || !msg || !btn || !box || !confirmBg) return;

  var CAT_LABEL = { calc: "計算ツールについて", poll: "みんなの投票(アンケート)について", site: "サイト全体・その他" };

  // ---- 表示 ----
  function show(text, isError) {
    box.textContent = "";
    var p = document.createElement("p");
    if (isError) p.className = "result-error";
    p.textContent = text;
    box.appendChild(p);
    box.hidden = false;
  }

  // ---- 端末識別子(連投の抑制にだけ使う。個人を特定する情報は含まない) ----
  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function senderId() {
    var s = storage();
    var key = "contactSender";
    var id = s ? s.getItem(key) : null;
    if (typeof id === "string" && id.length >= 8 && id.length <= 64) return id;
    var buf = new Uint8Array(16);
    window.crypto.getRandomValues(buf);
    id = Array.prototype.map.call(buf, function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
    if (s) { try { s.setItem(key, id); } catch (e) { /* 保存できなくても送信はできる */ } }
    return id;
  }

  // ---- 2段目の選択肢を1段目に合わせて組み立てる ----
  function groupsFor(cat) {
    var d = window.CONTACT_TOOLS || {};
    if (cat === "calc") return d.calc || [];
    if (cat === "poll") return d.poll || [];
    if (cat === "stars") return d.stars || [];
    return [];
  }

  function buildToolOptions(cat, keep) {
    var groups = groupsFor(cat);
    toolSel.replaceChildren();
    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "選ばない";
    toolSel.appendChild(blank);
    groups.forEach(function (g) {
      var og = document.createElement("optgroup");
      og.label = g.label;
      g.items.forEach(function (it) {
        var o = document.createElement("option");
        o.value = it.v;
        o.textContent = it.n;
        og.appendChild(o);
      });
      toolSel.appendChild(og);
    });
    toolRow.hidden = groups.length === 0;
    if (keep) toolSel.value = keep;
  }

  catSel.addEventListener("change", function () {
    buildToolOptions(catSel.value, null);
  });

  // ---- URLの ?tool= から初期選択する(各ツールのフッタから来たとき) ----
  function preselect() {
    var m = /[?&]tool=([a-z0-9-]{1,40})(&|$)/.exec(window.location.search);
    if (!m) return;
    var slug = m[1];
    var cat = slug.indexOf("poll") === 0 ? "poll" : slug.indexOf("stars") === 0 ? "stars" : "calc";
    var found = groupsFor(cat).some(function (g) {
      return g.items.some(function (it) { return it.v === slug; });
    });
    if (!found) return;
    catSel.value = cat;
    buildToolOptions(cat, slug);
  }

  // ---- 確認ダイアログ ----
  function addRow(term, desc) {
    var dt = document.createElement("dt");
    dt.textContent = term;
    var dd = document.createElement("dd");
    dd.textContent = desc;
    confirmList.appendChild(dt);
    confirmList.appendChild(dd);
  }

  function openConfirm() {
    confirmList.replaceChildren();
    if (catSel.value) addRow("お問い合わせ内容", CAT_LABEL[catSel.value] || catSel.value);
    if (!toolRow.hidden && toolSel.value) {
      addRow("対象", toolSel.options[toolSel.selectedIndex].textContent);
    }
    addRow("詳しい内容", msg.value.trim());
    confirmBg.hidden = false;
    document.getElementById("confirm-no").focus();
  }

  function closeConfirm() {
    confirmBg.hidden = true;
    btn.focus();
  }

  document.getElementById("confirm-no").addEventListener("click", closeConfirm);
  confirmBg.addEventListener("click", function (e) { if (e.target === confirmBg) closeConfirm(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !confirmBg.hidden) closeConfirm();
  });

  // ---- 送信 ----
  function conf() {
    var c = window.POLL_CONFIG;
    return (c && typeof c.url === "string" && c.url && typeof c.anonKey === "string" && c.anonKey) ? c : null;
  }

  // 保存する種別。2段目 > 1段目 > 未選択 の順に、細かいほうを優先する
  function toolValue() {
    if (!toolRow.hidden && toolSel.value) return toolSel.value;
    if (catSel.value === "calc") return "calc";
    if (catSel.value === "poll") return "poll";
    if (catSel.value === "site") return "site";
    return "other";
  }

  function send(tool, message) {
    var c = conf();
    return fetch(c.url.replace(/\/+$/, "") + "/rest/v1/bug_reports", {
      method: "POST",
      headers: {
        "apikey": c.anonKey,
        "Authorization": "Bearer " + c.anonKey,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ tool: tool, message: message, reporter: senderId() })
    }).then(function (r) {
      if (r.ok) return { ok: true };
      if (r.status === 429) return { ok: false, code: "rate" };
      return { ok: false, code: "rejected" };
    }).catch(function () { return { ok: false, code: "network" }; });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = msg.value.trim();
    if (text.length < 5) { show("詳しい内容を5文字以上で書いてください。", true); return; }
    if (text.length > 1000) { show("詳しい内容は1000文字までです。", true); return; }
    if (!conf()) { show("ただいまお問い合わせを受け付けられません。時間をおいて試してください。", true); return; }
    box.hidden = true;
    openConfirm();
  });

  document.getElementById("confirm-yes").addEventListener("click", function () {
    var yes = this;
    yes.disabled = true;
    yes.textContent = "送信中…";
    send(toolValue(), msg.value.trim()).then(function (r) {
      yes.disabled = false;
      yes.textContent = "はい、送信する";
      confirmBg.hidden = true;
      if (r.ok) {
        form.hidden = true;
        show("送信しました。ありがとうございます。内容は運営者が確認します。", false);
        return;
      }
      if (r.code === "network") {
        show("通信に失敗しました。電波の良い場所で試してください。", true);
      } else if (r.code === "rate") {
        show("短時間に多く送信されています。しばらく待ってから試してください。", true);
      } else {
        show("送信できませんでした。しばらく待ってから試してください。", true);
      }
    });
  });

  buildToolOptions("", null);
  preselect();
})();
