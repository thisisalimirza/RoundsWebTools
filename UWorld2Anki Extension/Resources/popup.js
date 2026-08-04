"use strict";

const api = globalThis.browser ?? globalThis.chrome;

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const resultsEl = el("results");
const emptyEl = el("empty");
const emptyMsgEl = el("empty-msg");
const listEl = el("id-list");
const queryEl = el("query");
const patternEl = el("pattern");
const toastEl = el("toast");
const findBtn = el("find-anki");

let currentIds = [];

function show(which) {
  statusEl.hidden = which !== "status";
  resultsEl.hidden = which !== "results";
  emptyEl.hidden = which !== "empty";
}

function fail(message) {
  emptyMsgEl.textContent = message;
  show("empty");
}

function buildQuery(ids, pattern) {
  if (ids.length === 0) return "";
  return ids.map((id) => pattern.replaceAll("{id}", id)).join(" OR ");
}

function refreshQuery() {
  queryEl.textContent = buildQuery(currentIds, patternEl.value);
}

function toast(message, isError) {
  toastEl.textContent = message;
  toastEl.classList.toggle("bad", !!isError);
  toastEl.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    toastEl.hidden = true;
  }, isError ? 9000 : 2500);
}

async function copy(value, label) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast(`${label} copied`);
  } catch {
    toast("Copy failed — select the text manually", true);
  }
}

function render(data) {
  const { rows, stats, paginatorLabel, skipped } = data;

  el("count-incorrect").textContent = stats.incorrect;
  el("count-correct").textContent = stats.correct;
  el("count-total").textContent = stats.total;

  listEl.replaceChildren();
  for (const row of rows) {
    const li = document.createElement("li");

    const qid = document.createElement("span");
    qid.className = "qid";
    qid.textContent = row.id;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = [row.topic, row.subject].filter(Boolean).join(" · ");
    meta.title = meta.textContent;

    li.append(qid, meta);
    listEl.append(li);
  }

  const notes = [];
  if (paginatorLabel) {
    notes.push(
      `This page shows ${paginatorLabel}. Only rows currently rendered are scanned — page through the table and rescan to capture the rest.`
    );
  }
  if (skipped.length) {
    notes.push(`${skipped.length} incorrect row(s) had an unreadable ID cell.`);
  }

  const noteEl = el("paginator-note");
  noteEl.textContent = notes.join(" ");
  noteEl.hidden = notes.length === 0;

  currentIds = rows.map((r) => r.id);
  refreshQuery();
  show("results");
}

async function scan() {
  show("status");
  statusEl.textContent = "Scanning the results table…";

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });

  if (!tab || !/^https?:\/\/([^/]*\.)?uworld\.com\//i.test(tab.url ?? "")) {
    fail("Open a UWorld test-results page, then run this again.");
    return;
  }

  let injection;
  try {
    // Injected rather than trusting the declared content script: a declared
    // script only runs at page load, so it is absent on a tab that was already
    // open when the extension was enabled or rebuilt. scraper.js guards against
    // double definition, so re-injecting is a no-op when it is already there.
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["scraper.js"] });
    injection = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.__uw2aScrape(),
    });
  } catch (error) {
    fail(`Couldn't read the page: ${error.message}`);
    return;
  }

  const data = injection?.[0]?.result;

  if (!data) {
    fail("The page returned nothing. Reload UWorld and try again.");
    return;
  }

  if (!data.ok) {
    fail(
      "No results table found on this page. Open a completed test block's " +
        "review/results list (the table with ID, Subjects, Systems…) and rescan."
    );
    return;
  }

  if (data.stats.incorrect === 0) {
    fail(
      `Scanned ${data.stats.total} row(s) and found no incorrect answers. ` +
        `Nothing to send to Anki.`
    );
    return;
  }

  render(data);
}

async function findInAnki() {
  if (currentIds.length === 0) return;

  const original = findBtn.textContent;
  findBtn.disabled = true;
  findBtn.textContent = "Opening Anki…";

  try {
    const result = await api.runtime.sendMessage({ type: "findInAnki", ids: currentIds });

    if (result && result.ok) {
      const found = result.cardCount;
      if (found === 0) {
        toast("Anki opened, but no cards matched. Try a different search pattern above.", true);
      } else {
        toast(
          found === null
            ? "Opened Anki Browse."
            : `Opened Anki Browse — ${found} card(s) matched.`
        );
      }
    } else {
      toast(result ? result.message : "No response from the extension background.", true);
    }
  } catch (error) {
    toast(`Couldn't reach the extension background: ${error.message}`, true);
  } finally {
    findBtn.disabled = false;
    findBtn.textContent = original;
  }
}

/* --- wiring --- */

patternEl.addEventListener("change", async () => {
  refreshQuery();
  try {
    await api.storage.local.set({ pattern: patternEl.value });
  } catch {
    /* storage is a convenience only */
  }
});

el("rescan").addEventListener("click", scan);
findBtn.addEventListener("click", findInAnki);
el("copy-ids").addEventListener("click", () => copy(currentIds.join("\n"), "IDs"));
el("copy-query").addEventListener("click", () => copy(queryEl.textContent, "Search"));

(async () => {
  try {
    const saved = await api.storage.local.get("pattern");
    // Only restore a pattern the dropdown still offers; assigning an unknown
    // value would blank the select and leave the popup with no pattern at all.
    const known = [...patternEl.options].some((opt) => opt.value === saved?.pattern);
    if (known) patternEl.value = saved.pattern;
  } catch {
    /* fall back to the default option */
  }
  scan();
})();
