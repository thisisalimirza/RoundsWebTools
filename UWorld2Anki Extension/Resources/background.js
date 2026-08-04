"use strict";

/**
 * Talks to AnkiConnect on behalf of the popup and the in-page button.
 *
 * This has to live in the background worker. A fetch issued from a content
 * script is attributed to the page's origin (apps.uworld.com), so AnkiConnect
 * would see it as cross-origin and refuse; only an extension-privileged
 * context covered by host_permissions can reach 127.0.0.1.
 */

const api = globalThis.browser ?? globalThis.chrome;

const ANKI_URL = "http://127.0.0.1:8765";
const ANKI_VERSION = 6;
// Anchored to the end of a tag on purpose. The looser `tag:*{id}*` also matches
// IDs that merely contain this one — on a real collection, QID 2524 pulled 48
// cards that way versus 8 correct ones.
const DEFAULT_PATTERN = "tag:*::{id}";
const TIMEOUT_MS = 8000;

/** Turns a list of IDs into an Anki search string. */
function buildQuery(ids, pattern) {
  return ids.map((id) => pattern.replaceAll("{id}", id)).join(" OR ");
}

/**
 * One AnkiConnect call.
 *
 * Content-Type is deliberately not set: adding application/json would promote
 * this to a preflighted request, whereas leaving it off keeps it a CORS simple
 * request. This is the conventional AnkiConnect client idiom.
 */
async function invoke(action, params = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(ANKI_URL, {
      method: "POST",
      body: JSON.stringify({ action, version: ANKI_VERSION, params }),
      signal: controller.signal,
    });
  } catch (error) {
    const unreachable = error.name === "AbortError" ? "timed out" : "refused the connection";
    throw Object.assign(
      new Error(
        `Anki ${unreachable}. Make sure the Anki desktop app is running and ` +
          `that the AnkiConnect add-on (code 2055492159) is installed.`
      ),
      { kind: "unreachable" }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw Object.assign(new Error(`AnkiConnect returned HTTP ${response.status}.`), {
      kind: "http",
    });
  }

  const payload = await response.json();

  if (payload && payload.error) {
    throw Object.assign(new Error(`AnkiConnect: ${payload.error}`), { kind: "anki" });
  }

  return payload ? payload.result : null;
}

/**
 * AnkiConnect gates unknown origins behind a prompt shown inside Anki. This
 * action is answerable from any origin by design; approving it writes our
 * origin into the add-on's webCorsOriginList so later calls go straight
 * through. Without this step every other action fails for a fresh install.
 */
async function ensurePermission() {
  const result = await invoke("requestPermission");

  if (!result || result.permission !== "granted") {
    throw Object.assign(
      new Error(
        "Anki denied the connection. Switch to Anki, then click this button " +
          "again and choose Yes on the permission prompt."
      ),
      { kind: "permission" }
    );
  }
}

async function findCardsInAnki(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, message: "No question IDs to look up." };
  }

  let pattern = DEFAULT_PATTERN;
  try {
    const saved = await api.storage.local.get("pattern");
    if (saved && saved.pattern) pattern = saved.pattern;
  } catch {
    /* fall back to the default */
  }

  const query = buildQuery(ids, pattern);

  try {
    await ensurePermission();
    // Opens (or raises) Anki's Browse window with the search already applied.
    const found = await invoke("guiBrowse", { query });

    return {
      ok: true,
      query,
      cardCount: Array.isArray(found) ? found.length : null,
      searched: ids.length,
    };
  } catch (error) {
    return { ok: false, message: error.message, kind: error.kind ?? "unknown", query };
  }
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "findInAnki") return false;

  findCardsInAnki(message.ids).then(sendResponse);
  return true; // keep the channel open for the async reply
});
