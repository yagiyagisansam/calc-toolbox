// みんなの投票 投票・結果ページ
// クリックジャッキング対策: iframe内に埋め込まれたら自分自身をトップに出す
if (window.top !== window.self) {
  try { window.top.location.replace(window.location.href); } catch (e) { document.documentElement.hidden = true; }
}

(function () {
  "use strict";
  var qTitle = document.getElementById("q-title");
  var statusEl = document.getElementById("status");
  var form = document.getElementById("vote-form");
  var optsEl = document.getElementById("opts");
  var voteBtn = document.getElementById("vote-btn");
  var resultEl = document.getElementById("result");
  var VOTED_KEY = "pollVoted";
  var VOTER_KEY = "pollVoter";

  function store() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  function votedMap() {
    var s = store();
    if (!s) return {};
    try { return JSON.parse(s.getItem(VOTED_KEY)) || {}; } catch (e) { return {}; }
  }
  function markVoted(id, choice) {
    var s = store();
    if (!s) return;
    var m = votedMap();
    m[id] = choice;
    try { s.setItem(VOTED_KEY, JSON.stringify(m)); } catch (e) { /* 保存不可は無視 */ }
  }
  function voterId() {
    var s = store();
    var v = s && s.getItem(VOTER_KEY);
    if (v) return v;
    if (window.crypto && crypto.randomUUID) {
      v = crypto.randomUUID();
    } else {
      var b = new Uint8Array(16);
      crypto.getRandomValues(b);
      v = [].map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    }
    if (s) { try { s.setItem(VOTER_KEY, v); } catch (e) { /* 保存不可なら毎回変わる */ } }
    return v;
  }

  function showStatus(msg) {
    statusEl.textContent = msg;
    statusEl.hidden = false;
  }

  // 締切の表示(締切なしなら非表示)
  function renderDeadline(poll) {
    var el = document.getElementById("deadline");
    if (!poll.closes_at) { el.hidden = true; return; }
    var d = new Date(poll.closes_at);
    var txt = (d.getMonth() + 1) + "/" + d.getDate() + " " +
      d.getHours() + ":" + ("0" + d.getMinutes()).slice(-2);
    if (poll.closed) {
      el.textContent = "このアンケートは締め切られました(" + txt + ")";
      el.classList.add("closed");
    } else {
      el.textContent = "締切: " + txt + " まで";
      el.classList.remove("closed");
    }
    el.hidden = false;
  }

  function renderShare(question) {
    var row = document.getElementById("share-row");
    row.replaceChildren();
    var url = location.href;
    var text = question + " | みんなに聞いてみた(投票はこちら)";
    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "リンクをコピー";
    copyBtn.addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          copyBtn.textContent = "コピー済み";
          setTimeout(function () { copyBtn.textContent = "リンクをコピー"; }, 1500);
        });
      }
    });
    row.appendChild(copyBtn);
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
    document.getElementById("share-box").hidden = false;
  }

  var VIEW_KEY = "pollView";
  function getView() {
    var s = store();
    var v = s && s.getItem(VIEW_KEY);
    return v === "donut" ? "donut" : "bar";
  }
  function setView(v) {
    var s = store();
    if (s) { try { s.setItem(VIEW_KEY, v); } catch (e) { /* 保存不可は無視 */ } }
  }

  function nameLabel(row, isWin, hasVotes, origIndex) {
    var label = document.createElement("span");
    label.className = "nm";
    var dot = document.createElement("span");
    dot.className = "pb-dot c" + (origIndex % 10);
    label.appendChild(dot);
    label.appendChild(document.createTextNode(row.label));
    if (isWin && hasVotes) {
      var chip = document.createElement("span");
      chip.className = "pb-chip-win";
      chip.textContent = "1位";
      label.appendChild(chip);
    }
    return label;
  }

  // 棒グラフ表示(票数の多い順・順位バッジつき)
  function renderBars(r, order) {
    var frag = document.createDocumentFragment();
    order.forEach(function (origIndex, pos) {
      var row = r.rows[origIndex];
      var isWin = r.top.indexOf(origIndex) !== -1;
      var div = document.createElement("div");
      div.className = "pb-row" + (isWin ? " win" : "");
      var top = document.createElement("div");
      top.className = "pb-rt";
      var label = document.createElement("span");
      label.className = "nm";
      if (r.total > 0 && r.rows.length > 3) {
        var rk = document.createElement("span");
        rk.className = "pb-rank" + (pos === 0 ? " r1" : pos === 1 ? " r2" : pos === 2 ? " r3" : "");
        rk.textContent = pos + 1;
        label.appendChild(rk);
      }
      var inner = nameLabel(row, isWin, r.total > 0, origIndex);
      while (inner.firstChild) label.appendChild(inner.firstChild);
      var num = document.createElement("span");
      num.className = "pc";
      num.textContent = row.pct + "%・" + row.count.toLocaleString() + "票";
      top.appendChild(label);
      top.appendChild(num);
      var bar = document.createElement("div");
      bar.className = "pb-bar";
      var fill = document.createElement("div");
      fill.className = "pb-fill c" + (origIndex % 10);
      fill.style.width = row.pct + "%";
      bar.appendChild(fill);
      div.appendChild(top);
      div.appendChild(bar);
      frag.appendChild(div);
    });
    return frag;
  }

  // 円グラフ(ドーナツ)表示+凡例
  function renderDonut(r, order, counts) {
    var wrap = document.createElement("div");
    wrap.className = "pb-donut-wrap";
    var donut = document.createElement("div");
    donut.className = "pb-donut";
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 200 200");
    var R = 76;
    var C = 2 * Math.PI * R;
    function circle(cls) {
      var el = document.createElementNS(NS, "circle");
      el.setAttribute("cx", "100");
      el.setAttribute("cy", "100");
      el.setAttribute("r", String(R));
      el.setAttribute("fill", "none");
      el.setAttribute("stroke-width", "36");
      if (cls) el.setAttribute("class", cls);
      return el;
    }
    var track = circle("");
    track.setAttribute("stroke", "currentColor");
    track.style.color = "var(--track)";
    svg.appendChild(track);
    var a = PollCalc.arcs(counts);
    var visible = a.ok ? a.arcs.filter(function (x) { return x.to - x.from > 0; }).length : 0;
    var gap = visible > 1 ? 2.5 : 0;
    var COLORS = ["#2f6fed", "#ef5da8", "#eda12f", "#23a55a", "#8b5cf6", "#0ea5b7", "#d94f2f", "#6b7280", "#a16207", "#475569"];
    if (a.ok) {
      a.arcs.forEach(function (arc, i) {
        var seg = (arc.to - arc.from) * C - gap;
        if (seg <= 0) return;
        var el = circle("");
        el.setAttribute("stroke", COLORS[i % 10]);
        el.setAttribute("stroke-linecap", "butt");
        el.setAttribute("stroke-dasharray", seg + " " + (C - seg));
        el.setAttribute("stroke-dashoffset", String(-(arc.from * C + gap / 2)));
        el.setAttribute("transform", "rotate(-90 100 100)");
        svg.appendChild(el);
      });
    }
    donut.appendChild(svg);
    var center = document.createElement("div");
    center.className = "pb-donut-center";
    var cb = document.createElement("b");
    cb.textContent = r.total.toLocaleString();
    var cs = document.createElement("span");
    cs.textContent = "票";
    center.appendChild(cb);
    center.appendChild(cs);
    donut.appendChild(center);
    wrap.appendChild(donut);

    var legend = document.createElement("div");
    legend.className = "pb-legend";
    order.forEach(function (origIndex) {
      var row = r.rows[origIndex];
      var isWin = r.top.indexOf(origIndex) !== -1;
      var lg = document.createElement("div");
      lg.className = "lg" + (isWin ? " win" : "");
      lg.appendChild(nameLabel(row, isWin, r.total > 0, origIndex));
      var pc = document.createElement("span");
      pc.className = "pc";
      pc.textContent = row.pct + "%・" + row.count.toLocaleString() + "票";
      lg.appendChild(pc);
      legend.appendChild(lg);
    });
    wrap.appendChild(legend);
    return wrap;
  }

  function renderResults(poll, note) {
    var counts = (poll.counts || []).map(Number);
    var voters = typeof poll.total === "number" ? poll.total : undefined;
    var r = PollCalc.results(poll.options, counts, poll.multi ? voters : undefined);
    resultEl.replaceChildren();
    form.hidden = true;
    if (!r.ok) { showStatus("集計結果を表示できませんでした。"); return; }
    var ord = PollCalc.displayOrder(counts);
    var order = ord.ok ? ord.order : counts.map(function (_, i) { return i; });

    var total = document.createElement("div");
    total.className = "pb-total";
    var b = document.createElement("b");
    b.textContent = r.total.toLocaleString();
    var sp = document.createElement("span");
    sp.textContent = "票";
    var live = document.createElement("span");
    live.className = "pb-live";
    live.appendChild(document.createElement("i"));
    live.appendChild(document.createTextNode("LIVE集計中"));
    total.appendChild(b);
    total.appendChild(sp);
    total.appendChild(live);
    resultEl.appendChild(total);
    if (note) {
      var p = document.createElement("p");
      p.className = "pb-meta";
      p.textContent = note;
      resultEl.appendChild(p);
    }

    var body = document.createElement("div");
    if (poll.multi) {
      // 複数選択: 割合の分母が回答者数のため合計100%にならない。円グラフは誤解を招くので棒のみ
      var mnote = document.createElement("p");
      mnote.className = "pb-meta";
      mnote.textContent = "複数選択のアンケートです。割合は回答者" + r.total.toLocaleString() + "人に対する割合のため、合計は100%になりません。";
      resultEl.appendChild(mnote);
      resultEl.appendChild(body);
      body.appendChild(renderBars(r, order));
    } else {
      // 表示切替(棒グラフ/円グラフ)
      var seg = document.createElement("div");
      seg.className = "pb-seg";
      seg.setAttribute("role", "tablist");
      function renderBody() {
        body.replaceChildren();
        body.appendChild(getView() === "donut" ? renderDonut(r, order, counts) : renderBars(r, order));
      }
      [["bar", "棒グラフ"], ["donut", "円グラフ"]].forEach(function (v) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = v[1];
        btn.className = getView() === v[0] ? "on" : "";
        btn.addEventListener("click", function () {
          setView(v[0]);
          [].forEach.call(seg.children, function (el, i) { el.classList.toggle("on", ["bar", "donut"][i] === v[0]); });
          renderBody();
        });
        seg.appendChild(btn);
      });
      resultEl.appendChild(seg);
      resultEl.appendChild(body);
      renderBody();
    }

    var refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "pb-btn-sub";
    refresh.textContent = "最新の結果に更新";
    refresh.addEventListener("click", function () { load(true); });
    resultEl.appendChild(refresh);

    // ＋書き出し(CSV・結果画像)
    var exp = document.createElement("details");
    exp.className = "pb-adv";
    var sum = document.createElement("summary");
    var plus = document.createElement("span");
    plus.className = "plus";
    plus.textContent = "＋";
    sum.appendChild(plus);
    sum.appendChild(document.createTextNode("書き出し(CSV・結果画像)"));
    exp.appendChild(sum);
    var inner = document.createElement("div");
    inner.className = "pb-adv-inner";
    var stamp = new Date();
    var ymd = String(stamp.getFullYear()) + ("0" + (stamp.getMonth() + 1)).slice(-2) + ("0" + stamp.getDate()).slice(-2);

    var csvBtn = document.createElement("button");
    csvBtn.type = "button";
    csvBtn.className = "pb-btn-sub";
    csvBtn.style.marginTop = "0";
    csvBtn.textContent = "CSVをダウンロード(Excel等で分析)";
    csvBtn.addEventListener("click", function () {
      var c = PollCalc.toCsv(poll.question, poll.options, counts, poll.multi ? voters : undefined);
      if (!c.ok) return;
      var a = document.createElement("a");
      a.href = "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFF" + c.csv);
      a.download = "anketo_" + ymd + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    inner.appendChild(csvBtn);

    var imgBtn = document.createElement("button");
    imgBtn.type = "button";
    imgBtn.className = "pb-btn-sub";
    imgBtn.style.marginTop = "0";
    imgBtn.textContent = "結果を画像で保存(SNS投稿・スライド用)";
    imgBtn.addEventListener("click", function () {
      var dataUrl = drawResultImage(poll, r, order);
      var a = document.createElement("a");
      a.href = dataUrl;
      a.download = "anketo_" + ymd + ".png";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    inner.appendChild(imgBtn);
    exp.appendChild(inner);
    resultEl.appendChild(exp);
    resultEl.hidden = false;
  }

  // 結果画像(PNG)を描画して data URL を返す
  function drawResultImage(poll, r, order) {
    var COLORS = ["#2f6fed", "#ef5da8", "#eda12f", "#23a55a", "#8b5cf6", "#0ea5b7", "#d94f2f", "#6b7280", "#a16207", "#475569"];
    var W = 1080;
    var PAD = 64;
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    var FONT = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';

    // 質問文の折り返し(実測で分割)
    ctx.font = "bold 46px " + FONT;
    var lines = [];
    var cur = "";
    for (var i = 0; i < poll.question.length; i++) {
      var next = cur + poll.question.charAt(i);
      if (ctx.measureText(next).width > W - PAD * 2 && cur !== "") {
        lines.push(cur);
        cur = poll.question.charAt(i);
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = lines[2].slice(0, -1) + "…"; }

    var rowH = 118;
    var H = PAD + lines.length * 62 + 84 + order.length * rowH + 96;
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext("2d");
    if (!ctx.roundRect) { ctx.roundRect = function (x, yy, w, h) { this.rect(x, yy, w, h); }; }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    var y = PAD + 46;
    ctx.fillStyle = "#1c1e22";
    ctx.font = "bold 46px " + FONT;
    lines.forEach(function (ln) { ctx.fillText(ln, PAD, y); y += 62; });

    ctx.font = "bold 40px " + FONT;
    ctx.fillStyle = "#1c1e22";
    var totalText = r.total.toLocaleString() + "票";
    ctx.fillText(totalText, PAD, y + 24);
    if (poll.multi) {
      ctx.font = "26px " + FONT;
      ctx.fillStyle = "#8a8f96";
      ctx.fillText("(複数選択・割合は回答者に対する割合)", PAD + ctx.measureText(totalText).width + 80, y + 24);
    }
    y += 84;

    order.forEach(function (origIndex, pos) {
      var row = r.rows[origIndex];
      ctx.font = (pos === 0 ? "bold " : "") + "30px " + FONT;
      ctx.fillStyle = "#1c1e22";
      var name = (pos + 1) + ". " + row.label;
      if (ctx.measureText(name).width > W - PAD * 2 - 260) {
        while (name.length > 1 && ctx.measureText(name + "…").width > W - PAD * 2 - 260) name = name.slice(0, -1);
        name += "…";
      }
      ctx.fillText(name, PAD, y + 30);
      var pctText = row.pct + "%(" + row.count.toLocaleString() + "票)";
      ctx.font = (pos === 0 ? "bold " : "") + "28px " + FONT;
      ctx.fillStyle = pos === 0 ? "#1c1e22" : "#8a8f96";
      ctx.fillText(pctText, W - PAD - ctx.measureText(pctText).width, y + 30);
      // 棒
      var barY = y + 48;
      var barW = W - PAD * 2;
      ctx.fillStyle = "#eef0f3";
      ctx.beginPath();
      ctx.roundRect(PAD, barY, barW, 26, 13);
      ctx.fill();
      if (row.pct > 0) {
        ctx.fillStyle = COLORS[origIndex % 10];
        ctx.beginPath();
        ctx.roundRect(PAD, barY, Math.max(26, barW * Math.min(row.pct, 100) / 100), 26, 13);
        ctx.fill();
      }
      y += rowH;
    });

    ctx.font = "26px " + FONT;
    ctx.fillStyle = "#8a8f96";
    ctx.fillText("みんなの投票 | " + location.origin + location.pathname + "?id=" + poll.id, PAD, H - 44);
    return canvas.toDataURL("image/png");
  }

  // 偏りのない一様乱数(暗号乱数+棄却サンプリング)。Fisher–Yatesと組み合わせて
  // すべての並び方が等確率になる
  function randInt(maxExclusive) {
    var limit = Math.floor(4294967296 / maxExclusive) * maxExclusive;
    var buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % maxExclusive;
  }

  function renderVoteForm(poll, id) {
    optsEl.replaceChildren();
    // シャッフル表示(順序バイアス対策)。送信する番号は元の並びのまま
    var order = poll.options.map(function (_, i) { return i; });
    if (poll.shuffle) {
      var sh = PollCalc.shuffleOrder(order.length, randInt);
      if (sh.ok) order = sh.order;
    }
    var limit = (poll.multi && poll.max_choices) ? Math.min(poll.max_choices, poll.options.length) : poll.options.length;
    document.getElementById("vote-note").textContent = poll.multi
      ? (poll.max_choices
        ? "1人1回・あてはまるものを最大" + limit + "個まで選んで投票"
        : "1人1回・あてはまるものを全部選んで投票")
      : "1人1回・タップして投票";
    function updateLimit() {
      var checkedCount = optsEl.querySelectorAll("input:checked").length;
      voteBtn.disabled = checkedCount === 0;
      if (!poll.multi) return;
      var full = checkedCount >= limit;
      [].forEach.call(optsEl.querySelectorAll("input"), function (inp) {
        var off = full && !inp.checked;
        inp.disabled = off;
        inp.parentElement.classList.toggle("off", off);
      });
    }
    order.forEach(function (origIndex) {
      var label = document.createElement("label");
      label.className = "pb-opt";
      var input = document.createElement("input");
      input.type = poll.multi ? "checkbox" : "radio";
      input.name = "choice";
      input.value = String(origIndex);
      input.addEventListener("change", function () {
        if (!poll.multi) {
          [].forEach.call(optsEl.children, function (el) { el.classList.remove("sel"); });
        }
        label.classList.toggle("sel", input.checked);
        updateLimit();
      });
      var rd = document.createElement("span");
      rd.className = "rd";
      var span = document.createElement("span");
      span.textContent = poll.options[origIndex];
      label.appendChild(input);
      label.appendChild(rd);
      label.appendChild(span);
      optsEl.appendChild(label);
    });
    voteBtn.disabled = true;
    voteBtn.textContent = "この選択で投票する";
    // 「結果非表示」のアンケートでは投票前に結果を覗けない
    document.getElementById("peek-link").parentElement.hidden = !!poll.hidden;
    form.hidden = false;

    form.onsubmit = function (e) {
      e.preventDefault();
      var choices = [].map.call(optsEl.querySelectorAll("input:checked"), function (el) {
        return parseInt(el.value, 10);
      });
      if (choices.length === 0) return;
      voteBtn.disabled = true;
      voteBtn.textContent = "送信中…";
      PollNet.vote(id, voterId(), choices).then(function (r) {
        if (r.ok || r.code === "already_voted") {
          markVoted(id, choices);
          statusEl.hidden = true;
          load(true, r.ok ? "投票を受け付けました。" : "この端末からはすでに投票済みです。");
        } else if (r.code === "closed") {
          statusEl.hidden = true;
          load(true, "締め切られたため、この投票は受け付けられませんでした。");
        } else {
          voteBtn.disabled = false;
          voteBtn.textContent = "この選択で投票する";
          showStatus(r.code === "network"
            ? "通信に失敗しました。電波の良い場所でもう一度お試しください。"
            : "投票を受け付けられませんでした。もう一度お試しください。");
        }
      });
    };
    document.getElementById("peek-link").onclick = function (e) {
      e.preventDefault();
      load(true, "投票せずに現在の結果を表示しています(このページを開き直すと投票できます)。");
    };
  }

  var pollId = new URLSearchParams(location.search).get("id") || "";

  function load(resultsOnly, note) {
    PollNet.getResults(pollId, voterId()).then(function (r) {
      if (!r.ok) {
        qTitle.textContent = "アンケートを表示できません";
        showStatus(r.code === "blocked"
          ? "このアンケートは通報を受けて公開を停止しました。"
          : r.code === "not_found"
          ? "このアンケートは見つかりませんでした。削除されたか、URLが間違っている可能性があります。"
          : r.code === "network"
            ? "通信に失敗しました。電波の良い場所で再読み込みしてください。"
            : "読み込みに失敗しました。時間をおいて再読み込みしてください。");
        return;
      }
      var poll = r.poll;
      qTitle.textContent = poll.question;
      document.title = poll.question + " | みんなの投票";
      renderDeadline(poll);
      renderShare(poll.question);
      document.getElementById("report-btn").hidden = false;
      setupOwnerDelete();
      var voted = votedMap()[pollId] !== undefined;
      if (poll.closed) {
        // 締切済み: 投票不可・最終結果のみ
        renderResults(poll, note || "締め切り済みのアンケートです。最終結果を表示しています。");
        return;
      }
      if (poll.hidden) {
        // 結果非表示: サーバー側が「この端末は未投票」と判定。投票フォームのみ表示
        renderVoteForm(poll, pollId);
        showStatus("このアンケートの結果は、投票すると表示されます。");
        return;
      }
      if (resultsOnly || voted) {
        renderResults(poll, note || (voted ? "この端末からは投票済みです。" : ""));
      } else {
        renderVoteForm(poll, pollId);
      }
    });
  }

  // QRコード表示(印刷・掲示用)
  document.getElementById("qr-btn").addEventListener("click", function () {
    var box = document.getElementById("qr-box");
    if (!box.hidden) { box.hidden = true; return; }
    box.replaceChildren();
    var qr = qrcode(0, "M");
    qr.addData(location.origin + location.pathname + "?id=" + pollId);
    qr.make();
    var img = document.createElement("img");
    img.src = qr.createDataURL(6, 0);
    img.alt = "このアンケートのQRコード";
    box.appendChild(img);
    var p = document.createElement("p");
    p.textContent = "画像を長押しで保存できます。ポスターや黒板・スライドの掲示に。";
    box.appendChild(p);
    box.hidden = false;
  });

  // 作成者本人のときだけ削除ボタンを出す
  // 判定は作成時にこの端末へ保存した削除キー。キーが無い端末には出さない
  function myDeleteKey(id) {
    var mine;
    try { mine = JSON.parse(window.localStorage.getItem("pollMine")) || []; } catch (e) { return null; }
    for (var i = 0; i < mine.length; i++) {
      if (mine[i] && mine[i].id === id && mine[i].k) return mine[i].k;
    }
    return null;
  }

  function forgetMine(id) {
    try {
      var mine = JSON.parse(window.localStorage.getItem("pollMine")) || [];
      window.localStorage.setItem("pollMine", JSON.stringify(mine.filter(function (m) { return m && m.id !== id; })));
    } catch (e) { /* 保存不可は無視 */ }
  }

  function setupOwnerDelete() {
    var key = myDeleteKey(pollId);
    if (!key) return;
    var delBtn = document.getElementById("owner-del-btn");
    var delBg = document.getElementById("del-confirm-bg");
    var delError = document.getElementById("del-error");
    delBtn.hidden = false;

    function close() { delBg.hidden = true; delError.hidden = true; }

    delBtn.addEventListener("click", function () {
      delError.hidden = true;
      delBg.hidden = false;
      document.getElementById("del-no").focus();
    });
    document.getElementById("del-no").addEventListener("click", function () { close(); delBtn.focus(); });
    delBg.addEventListener("click", function (e) { if (e.target === delBg) { close(); delBtn.focus(); } });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !delBg.hidden) { close(); delBtn.focus(); }
    });

    document.getElementById("del-yes").addEventListener("click", function () {
      var yes = this;
      yes.disabled = true;
      yes.textContent = "削除中…";
      PollNet.deletePoll(pollId, key).then(function (r) {
        yes.disabled = false;
        yes.textContent = "はい、削除する";
        if (r.ok || r.code === "not_owner") {
          forgetMine(pollId);
          close();
          delBtn.hidden = true;
          document.getElementById("report-btn").hidden = true;
          qTitle.textContent = "このアンケートは削除されました";
          showStatus("削除が完了しました。集まった票も一緒に消えています。");
          document.getElementById("vote-form").hidden = true;
          document.getElementById("result").hidden = true;
          document.getElementById("share-box").hidden = true;
          document.getElementById("deadline").hidden = true;
        } else {
          delError.textContent = "削除できませんでした。通信状況を確認して、もう一度お試しください。";
          delError.hidden = false;
        }
      });
    });
  }

  // 通報は誤タップを防ぐため、サイト内の確認ダイアログを挟んでから送信する
  var reportBtn = document.getElementById("report-btn");
  var reportBg = document.getElementById("report-confirm-bg");

  reportBtn.addEventListener("click", function () {
    reportBg.hidden = false;
    document.getElementById("report-no").focus();
  });

  document.getElementById("report-no").addEventListener("click", function () {
    reportBg.hidden = true;
    reportBtn.focus();
  });

  reportBg.addEventListener("click", function (e) {
    if (e.target === reportBg) { reportBg.hidden = true; reportBtn.focus(); }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !reportBg.hidden) { reportBg.hidden = true; reportBtn.focus(); }
  });

  document.getElementById("report-yes").addEventListener("click", function () {
    reportBg.hidden = true;
    reportBtn.disabled = true;
    PollNet.report(pollId, voterId()).then(function (r) {
      reportBtn.textContent = r.ok ? "報告を受け付けました。ご協力ありがとうございます。" : "報告を送信できませんでした。時間をおいてお試しください。";
      if (!r.ok) reportBtn.disabled = false;
    });
  });

  if (!PollNet.ready()) {
    qTitle.textContent = "アンケート機能は準備中です";
    showStatus("このページはまだ利用できません。もうしばらくお待ちください。");
  } else if (!PollCalc.isValidId(pollId)) {
    qTitle.textContent = "アンケートを表示できません";
    showStatus("URLが正しくありません。共有されたリンクをそのまま開いてください。");
  } else {
    load(false);
  }
})();
