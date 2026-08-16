/* 地図上の予報パネルを移動・折りたたみできるようにする。 */
(function (global) {
  "use strict";

  function start() {
    var panel = document.getElementById("forecast-panel");
    var mapArea = document.querySelector(".stars-main");
    var handle = panel && panel.querySelector("[data-panel-handle]");
    var toggle = panel && panel.querySelector("[data-panel-toggle]");
    var body = panel && panel.querySelector("[data-panel-body]");
    if (!panel || !mapArea || !handle || !toggle || !body) return;

    var drag = null;

    function clamp(left, top) {
      var area = mapArea.getBoundingClientRect();
      var box = panel.getBoundingClientRect();
      return {
        left: Math.max(8, Math.min(left, area.width - box.width - 8)),
        top: Math.max(8, Math.min(top, area.height - box.height - 8))
      };
    }

    function place(left, top) {
      var p = clamp(left, top);
      panel.style.left = p.left + "px";
      panel.style.top = p.top + "px";
      panel.style.right = "auto";
      panel.classList.add("is-moved");
    }

    function currentPosition() {
      var area = mapArea.getBoundingClientRect();
      var box = panel.getBoundingClientRect();
      return { left: box.left - area.left, top: box.top - area.top };
    }

    handle.addEventListener("pointerdown", function (event) {
      if (event.target.closest("button")) return;
      var pos = currentPosition();
      drag = { id: event.pointerId, dx: event.clientX - pos.left, dy: event.clientY - pos.top };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add("is-dragging");
      event.preventDefault();
    });

    handle.addEventListener("pointermove", function (event) {
      if (!drag || drag.id !== event.pointerId) return;
      place(event.clientX - drag.dx, event.clientY - drag.dy);
    });

    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      drag = null;
      panel.classList.remove("is-dragging");
    }
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);

    handle.addEventListener("keydown", function (event) {
      var amount = event.shiftKey ? 40 : 16;
      var pos = currentPosition();
      if (event.key === "ArrowLeft") pos.left -= amount;
      else if (event.key === "ArrowRight") pos.left += amount;
      else if (event.key === "ArrowUp") pos.top -= amount;
      else if (event.key === "ArrowDown") pos.top += amount;
      else if (event.key === "Home") { pos.left = mapArea.clientWidth - panel.offsetWidth - 10; pos.top = 10; }
      else return;
      place(pos.left, pos.top);
      event.preventDefault();
    });

    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      body.hidden = open;
      toggle.setAttribute("aria-expanded", String(!open));
      toggle.textContent = open ? "開く" : "折りたたむ";
      panel.classList.toggle("is-collapsed", open);
      var pos = currentPosition();
      place(pos.left, pos.top);
    });

    global.addEventListener("resize", function () {
      if (!panel.classList.contains("is-moved")) return;
      var pos = currentPosition();
      place(pos.left, pos.top);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);
