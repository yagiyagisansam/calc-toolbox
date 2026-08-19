/*
 * 閉じられるお知らせ。
 *
 * 予報の不足は隠してはいけないが、地図の上を大きな帯で塞ぎ続ける必要もない。
 * 同じ文言を閉じたことだけ sessionStorage に覚え、内容が変われば再び表示する。
 */
(function (global) {
  "use strict";

  var PREFIX = "stars:dismissed-notice:";

  function read(key) {
    try {
      return global.sessionStorage.getItem(PREFIX + key);
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      global.sessionStorage.setItem(PREFIX + key, value);
    } catch (e) {
      // 保存できない環境でも、その場では閉じられる。
    }
  }

  function show(id, text, storageKey) {
    var box = global.document.getElementById(id);
    if (!box) return;
    var body = box.querySelector("[data-notice-text]");
    var close = box.querySelector("[data-notice-close]");
    var message = text || "";
    var key = storageKey || id;

    if (body) body.textContent = message;
    box.hidden = !message || read(key) === message;

    /*
     * いま出しているお知らせがどの覚え書きに属するかを、要素側に持たせる。
     *
     * 閉じる処理は1度しか結びつけないので、その場の key を関数の中に
     * 閉じ込めると、最初に呼ばれたときの key を永久に使い続けることになる。
     * あとから別の key で出したお知らせを閉じても、覚えるのは古い key の側
     * ── 閉じたのに次も出てくる。押した時点の値を読む形にする。
     */
    box.__starsNoticeKey = key;

    if (close && !close.__starsNoticeBound) {
      close.__starsNoticeBound = true;
      close.addEventListener("click", function () {
        var now = box.querySelector("[data-notice-text]");
        var current = now ? now.textContent : "";
        if (current) write(box.__starsNoticeKey || id, current);
        box.hidden = true;
      });
    }
  }

  global.StarsNotice = { show: show };
})(typeof window !== "undefined" ? window : globalThis);
