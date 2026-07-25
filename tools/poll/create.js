// みんなの投票 作成ページ
// クリックジャッキング対策: iframe内に埋め込まれたら自分自身をトップに出す
if (window.top !== window.self) {
  try { window.top.location.replace(window.location.href); } catch (e) { document.documentElement.hidden = true; }
}

(function () {
  "use strict";
  var optsBox = document.getElementById("options-box");
  var addBtn = document.getElementById("add-opt");
  var errEl = document.getElementById("form-error");
  var MINE_KEY = "pollMine";
  var MSG = {
    invalid_question: "質問を入力してください。",
    question_too_long: "質問は120文字以内で入力してください。",
    option_too_long: "選択肢は1個60文字以内で入力してください。",
    too_few_options: "選択肢を2個以上入力してください。",
    too_many_options: "選択肢は10個までです。",
    duplicate_options: "同じ内容の選択肢があります。",
    not_configured: "現在準備中のため作成できません。もうしばらくお待ちください。",
    network: "通信に失敗しました。電波の良い場所でもう一度お試しください。",
    rejected: "作成に失敗しました。内容を確認してもう一度お試しください。",
    conflict: "作成に失敗しました。もう一度お試しください。"
  };

  function store() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  function loadMine() {
    var s = store();
    if (!s) return [];
    try { return JSON.parse(s.getItem(MINE_KEY)) || []; } catch (e) { return []; }
  }
  function saveMine(list) {
    var s = store();
    if (!s) return;
    try { s.setItem(MINE_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) { /* 保存不可は無視 */ }
  }

  function addOptionField(focus) {
    var n = optsBox.children.length;
    if (n >= PollCalc.MAX_OPTIONS) return;
    var label = document.createElement("label");
    label.appendChild(document.createTextNode("選択肢" + (n + 1)));
    var input = document.createElement("input");
    input.type = "text";
    input.maxLength = 60;
    input.className = "opt-input";
    input.placeholder = n === 0 ? "例: きのこの山" : n === 1 ? "例: たけのこの里" : "";
    label.appendChild(input);
    optsBox.appendChild(label);
    addBtn.hidden = optsBox.children.length >= PollCalc.MAX_OPTIONS;
    if (focus) input.focus();
  }
  addOptionField(false);
  addOptionField(false);
  addBtn.addEventListener("click", function () { addOptionField(true); });

  function showError(code) {
    errEl.textContent = MSG[code] || MSG.rejected;
    errEl.hidden = false;
  }

  function voteUrl(id) {
    return location.origin + location.pathname.replace(/new\.html$/, "") + "v.html?id=" + id;
  }

  function showCreated(id, question) {
    var url = voteUrl(id);
    document.getElementById("qr-box").hidden = true;
    document.getElementById("qr-box").replaceChildren();
    document.getElementById("done-url").value = url;
    document.getElementById("open-link").href = "./v.html?id=" + id;
    var row = document.getElementById("share-row");
    row.replaceChildren();
    var text = question + " | みんなに聞いてみた(投票はこちら)";
    [
      ["Xでシェア", "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url)],
      ["LINEで送る", "https://line.me/R/share?text=" + encodeURIComponent(text + " " + url)],
      ["Facebookでシェア", "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(url)]
    ].forEach(function (it) {
      var a = document.createElement("a");
      a.href = it[1];
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = it[0];
      row.appendChild(a);
    });
    document.getElementById("done-card").hidden = false;
    document.getElementById("done-card").scrollIntoView({ behavior: "smooth" });
  }

  document.getElementById("copy-btn").addEventListener("click", function () {
    var input = document.getElementById("done-url");
    var btn = this;
    var done = function () { btn.textContent = "コピー済み"; setTimeout(function () { btn.textContent = "コピー"; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
    } else {
      input.select();
      document.execCommand("copy");
      done();
    }
  });

  if (!PollNet.ready()) {
    document.getElementById("setup-note").hidden = false;
  }

  // 「選べる数の上限」は複数選択がオンのときだけ表示
  document.getElementById("opt-multi").addEventListener("change", function () {
    document.getElementById("max-row").hidden = !this.checked;
  });

  // QRコード表示(印刷・掲示用)
  document.getElementById("qr-btn").addEventListener("click", function () {
    var box = document.getElementById("qr-box");
    if (!box.hidden) { box.hidden = true; return; }
    var url = document.getElementById("done-url").value;
    if (!url) return;
    box.replaceChildren();
    var qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    var img = document.createElement("img");
    img.src = qr.createDataURL(6, 0);
    img.alt = "投票ページのQRコード";
    box.appendChild(img);
    var p = document.createElement("p");
    p.textContent = "画像を長押しで保存できます。ポスターや黒板・スライドの掲示に。";
    box.appendChild(p);
    box.hidden = false;
  });

  var creating = false;
  document.getElementById("poll-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (creating) return;
    errEl.hidden = true;
    var options = [].map.call(optsBox.querySelectorAll(".opt-input"), function (el) { return el.value; });
    var v = PollCalc.validatePoll(document.getElementById("question").value, options);
    if (!v.ok) { showError(v.code); return; }
    if (!PollNet.ready()) { showError("not_configured"); return; }

    var btn = document.getElementById("create-btn");
    creating = true;
    btn.disabled = true;
    btn.textContent = "作成中…";
    var hours = parseFloat(document.getElementById("opt-deadline").value);
    var maxSel = parseInt(document.getElementById("opt-max").value, 10);
    var opts = {
      isPublic: document.getElementById("is-public").checked,
      multi: document.getElementById("opt-multi").checked,
      maxChoices: isFinite(maxSel) && maxSel >= 2 ? maxSel : null,
      hideResults: document.getElementById("opt-hide").checked,
      shuffle: document.getElementById("opt-shuffle").checked,
      closesAt: isFinite(hours) && hours > 0 ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : null
    };

    function finish() {
      creating = false;
      btn.disabled = false;
      btn.textContent = "投票ページを作成する";
    }
    function attempt(triesLeft) {
      var bytes = new Uint8Array(10);
      crypto.getRandomValues(bytes);
      var idRes = PollCalc.makeId(bytes);
      PollNet.createPoll(idRes.id, v.question, v.options, opts).then(function (r) {
        if (r.ok) {
          var mine = loadMine();
          mine.unshift({ id: idRes.id, q: v.question, t: new Date().toISOString().slice(0, 10) });
          saveMine(mine);
          showCreated(idRes.id, v.question);
          finish();
        } else if (r.code === "conflict" && triesLeft > 0) {
          attempt(triesLeft - 1);
        } else {
          showError(r.code);
          finish();
        }
      });
    }
    attempt(3);
  });
})();
