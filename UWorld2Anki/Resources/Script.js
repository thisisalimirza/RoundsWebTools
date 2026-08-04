"use strict";

/**
 * Setup window behaviour. `show()` is called from ViewController once Safari
 * reports whether the extension is enabled.
 */

const send = (message) => webkit.messageHandlers.controller.postMessage(message);

function show(enabled, useSettingsInsteadOfPreferences) {
    if (!useSettingsInsteadOfPreferences) {
        // macOS 12 and earlier called it "Preferences".
        document.querySelector("button.open-preferences").innerText =
            "Quit and Open Safari Preferences…";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle("state-on", enabled);
        document.body.classList.toggle("state-off", !enabled);
    } else {
        document.body.classList.remove("state-on");
        document.body.classList.remove("state-off");
    }
}

document.querySelector("button.open-preferences")
    .addEventListener("click", () => send("open-preferences"));

// Clipboard access is unreliable for a file:// WKWebView, so the copy is done
// natively — the button just reports what it asked for.
document.querySelectorAll("button.copy").forEach((button) => {
    button.addEventListener("click", () => {
        send(`copy:${button.dataset.copy}`);
        const original = button.textContent;
        button.textContent = "Copied";
        button.classList.add("done");
        setTimeout(() => {
            button.textContent = original;
            button.classList.remove("done");
        }, 1600);
    });
});

// Links must be handed to the default browser; this WKWebView only hosts the
// bundled setup page.
document.querySelectorAll("footer a[href]").forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();
        send(`open-url:${link.href}`);
    });
});
