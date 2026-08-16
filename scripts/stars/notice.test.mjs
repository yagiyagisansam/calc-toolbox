#!/usr/bin/env node
/* 閉じられる予報通知の小さなDOMなし回帰テスト。 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const saved = new Map();
let closeHandler = null;

const body = { textContent: "" };
const close = {
  __starsNoticeBound: false,
  addEventListener(type, handler) {
    if (type === "click") closeHandler = handler;
  }
};
const box = {
  hidden: true,
  querySelector(selector) {
    if (selector === "[data-notice-text]") return body;
    if (selector === "[data-notice-close]") return close;
    return null;
  }
};

globalThis.document = {
  getElementById(id) {
    return id === "weather-note" ? box : null;
  }
};
globalThis.sessionStorage = {
  getItem(key) {
    return saved.has(key) ? saved.get(key) : null;
  },
  setItem(key, value) {
    saved.set(key, value);
  }
};

require(path.join(ROOT, "stars", "notice.js"));

let failed = 0;
function ok(condition, label) {
  if (condition) return;
  failed++;
  console.log(`❌ ${label}`);
}

StarsNotice.show("weather-note", "予報A", "weather-coverage");
ok(!box.hidden && body.textContent === "予報A", "新しい通知を表示する");
ok(typeof closeHandler === "function", "閉じる操作を結び付ける");

closeHandler();
ok(box.hidden, "閉じると非表示になる");

StarsNotice.show("weather-note", "予報A", "weather-coverage");
ok(box.hidden, "同じ通知はセッション中に再表示しない");

StarsNotice.show("weather-note", "予報B", "weather-coverage");
ok(!box.hidden && body.textContent === "予報B", "内容が変われば再表示する");

StarsNotice.show("weather-note", "", "weather-coverage");
ok(box.hidden && body.textContent === "", "通知が無ければ隠す");

console.log(`\n${4 - failed} / 4 件通過${failed ? "(失敗あり)" : "(全通過)"}`);
process.exit(failed ? 1 : 0);
