"use strict";

/**
 * Adds a "Find in Anki" button to UWorld's results page.
 *
 * The UI lives in a shadow root so UWorld's Angular Material stylesheet can't
 * reach into it and our styles can't leak out onto their table. The button
 * shows itself only while a results table with at least one incorrect answer
 * is on screen, and re-evaluates on DOM changes because UWorld is a SPA that
 * swaps the table in and out without a page load.
 */
(() => {
  if (globalThis.__uw2aButtonInstalled) return;
  globalThis.__uw2aButtonInstalled = true;

  const api = globalThis.browser ?? globalThis.chrome;

  const RESCAN_DELAY_MS = 400;

  const STYLE = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      gap: 6px;
      font: 500 13px/1.3 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    }
    .wrap[hidden] { display: none; }
    button {
      font: inherit;
      border: 0;
      cursor: pointer;
      border-radius: 999px;
      color: #fff;
      background: linear-gradient(135deg, #4A90E2, #9B59B6);
      box-shadow: 0 3px 14px rgba(0, 0, 0, .3);
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: background .12s ease, opacity .12s ease;
    }
    button:hover { filter: brightness(1.08); }
    button:disabled { opacity: .65; cursor: default; }
    .count {
      background: #d92d20;
      border-radius: 999px;
      padding: 1px 7px;
      font-weight: 650;
      font-size: 12px;
    }
    .dismiss { padding: 8px 10px; background: #1A1A2E; font-size: 14px; line-height: 1; }
    .msg {
      position: fixed;
      right: 20px;
      bottom: 68px;
      z-index: 2147483000;
      max-width: 320px;
      padding: 10px 13px;
      border-radius: 9px;
      background: #1A1A2E;
      color: #fff;
      box-shadow: 0 3px 14px rgba(0, 0, 0, .3);
      font: 400 12px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      white-space: pre-wrap;
    }
    .msg[hidden] { display: none; }
    .msg.bad { background: #7a1d16; }
  `;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const host = make("div", "uworld2anki-host");
  const root = host.attachShadow({ mode: "open" });

  const style = make("style", null, STYLE);
  const msgEl = make("div", "msg");
  msgEl.hidden = true;

  const labelEl = make("span", "label", "Find in Anki");
  const countEl = make("span", "count", "0");

  const goBtn = make("button", "go");
  goBtn.type = "button";
  goBtn.append(labelEl, countEl);

  const dismissBtn = make("button", "dismiss", "×");
  dismissBtn.type = "button";
  dismissBtn.title = "Hide until reload";

  const wrap = make("div", "wrap");
  wrap.hidden = true;
  wrap.append(goBtn, dismissBtn);

  root.append(style, msgEl, wrap);

  let dismissed = false;
  let busy = false;
  let currentIds = [];
  let msgTimer = null;

  function say(text, isError) {
    msgEl.textContent = text;
    msgEl.classList.toggle("bad", !!isError);
    msgEl.hidden = false;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => {
      msgEl.hidden = true;
    }, isError ? 9000 : 5000);
  }

  function refresh() {
    if (dismissed || busy) return;

    const data = globalThis.__uw2aScrape ? globalThis.__uw2aScrape() : null;

    if (!data || !data.ok || data.stats.incorrect === 0) {
      wrap.hidden = true;
      currentIds = [];
      return;
    }

    currentIds = data.rows.map((row) => row.id);
    countEl.textContent = String(currentIds.length);
    wrap.hidden = false;
  }

  goBtn.addEventListener("click", async () => {
    if (busy || currentIds.length === 0) return;

    busy = true;
    goBtn.disabled = true;
    labelEl.textContent = "Opening Anki…";

    try {
      const result = await api.runtime.sendMessage({ type: "findInAnki", ids: currentIds });

      if (result && result.ok) {
        const found = result.cardCount;
        let text =
          found === null
            ? `Opened Anki Browse for ${result.searched} question ID(s).`
            : `Opened Anki Browse — ${found} card(s) matched ${result.searched} question ID(s).`;
        if (found === 0) {
          text +=
            "\n\nNo matches. Your cards may use a different tag format — " +
            "change the search pattern in the extension popup.";
        }
        say(text, found === 0);
      } else {
        say(result ? result.message : "No response from the extension background.", true);
      }
    } catch (error) {
      say(`Couldn't reach the extension background: ${error.message}`, true);
    } finally {
      busy = false;
      goBtn.disabled = false;
      labelEl.textContent = "Find in Anki";
      refresh();
    }
  });

  dismissBtn.addEventListener("click", () => {
    dismissed = true;
    wrap.hidden = true;
    msgEl.hidden = true;
  });

  function mount() {
    if (!document.body.contains(host)) document.body.append(host);
    refresh();
  }

  // UWorld is an Angular SPA: the results table appears, paginates, and is torn
  // down without any navigation event. Debounced so a table re-render doesn't
  // trigger one scrape per mutation.
  let rescanTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(mount, RESCAN_DELAY_MS);
  });

  const start = () => {
    mount();
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
