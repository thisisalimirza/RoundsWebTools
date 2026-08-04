"use strict";

/**
 * Reads the UWorld results table and returns the question IDs marked incorrect.
 *
 * Runs in the content-script world. It is loaded both as a declared content
 * script (for the in-page button) and on demand by the popup via
 * scripting.executeScript — those share one isolated world, so the guard below
 * makes a second injection a no-op rather than a redefinition.
 */
(() => {
  if (globalThis.__uw2aScrape) return;

  const ROW_SEL = "tr.mat-row, tr[mat-row], tr.cdk-row";
  const FLAG_SEL = "td.flag-column, td.cdk-column-flag, td.mat-column-flag";
  const ID_SEL = "td.cdk-column-id, td.mat-column-id";

  const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");

  // "1 - 14788" / "12 – 4678" -> "14788". The leading number is the question's
  // position in the block; the trailing one is the question ID.
  const extractId = (cell) => {
    const match = text(cell).match(/(\d+)\s*$/);
    return match ? match[1] : null;
  };

  globalThis.__uw2aScrape = function scrapeIncorrectQuestionIds() {
    const rows = Array.from(document.querySelectorAll(ROW_SEL));

    if (rows.length === 0) {
      return { ok: false, reason: "no-table", href: location.href };
    }

    const incorrect = [];
    let correct = 0;
    let other = 0;
    const skipped = [];

    for (const row of rows) {
      const flagCell = row.querySelector(FLAG_SEL);
      if (!flagCell) continue;

      // Scoped to the flag column on purpose: `fa-times` is Font Awesome's
      // generic "x" and also shows up on close/dismiss controls elsewhere.
      const isIncorrect = !!flagCell.querySelector("i.fa-times, .fa-times");
      const isCorrect = !!flagCell.querySelector("i.fa-check, .fa-check");

      if (!isIncorrect) {
        if (isCorrect) correct += 1;
        else other += 1;
        continue;
      }

      const idCell = row.querySelector(ID_SEL);
      const id = extractId(idCell);

      if (!id) {
        skipped.push(text(idCell) || "(empty id cell)");
        continue;
      }

      incorrect.push({
        id,
        subject: text(row.querySelector("td.cdk-column-subject, td.mat-column-subject")),
        topic: text(row.querySelector("td.cdk-column-topic, td.mat-column-topic")),
      });
    }

    const paginator = document.querySelector(
      ".mat-paginator-range-label, .mat-mdc-paginator-range-label"
    );

    return {
      ok: true,
      rows: incorrect,
      stats: { total: rows.length, incorrect: incorrect.length, correct, other },
      skipped,
      paginatorLabel: paginator ? text(paginator) : null,
    };
  };
})();
