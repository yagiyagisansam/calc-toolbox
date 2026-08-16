/* 星見サイト共通のサイドメニュー。 */
(function (global) {
  "use strict";

  function start() {
    var button = document.querySelector("[data-stars-menu-button]");
    var drawer = document.querySelector("[data-stars-sidebar]");
    var backdrop = document.querySelector("[data-stars-sidebar-backdrop]");
    var close = document.querySelector("[data-stars-menu-close]");
    if (!button || !drawer || !backdrop) return;

    var lastFocus = null;
    drawer.inert = true;

    function setOpen(open) {
      drawer.classList.toggle("is-open", open);
      backdrop.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
      drawer.setAttribute("aria-hidden", String(!open));
      drawer.inert = !open;
      document.body.classList.toggle("stars-menu-open", open);
      if (open) {
        lastFocus = document.activeElement;
        var first = close || drawer.querySelector("a");
        if (first) first.focus();
      } else if (lastFocus && typeof lastFocus.focus === "function") {
        lastFocus.focus();
      }
    }

    button.addEventListener("click", function () {
      setOpen(button.getAttribute("aria-expanded") !== "true");
    });
    if (close) close.addEventListener("click", function () { setOpen(false); });
    backdrop.addEventListener("click", function () { setOpen(false); });
    drawer.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") setOpen(false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);
