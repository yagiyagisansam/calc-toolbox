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

    if (close && !close.__starsNoticeBound) {
      close.__starsNoticeBound = true;
      close.addEventListener("click", function () {
        var current = body ? body.textContent : "";
        if (current) write(key, current);
        box.hidden = true;
      });
    }
  }

  global.StarsNotice = { show: show };
})(typeof window !== "undefined" ? window : globalThis);
