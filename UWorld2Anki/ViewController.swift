//
//  ViewController.swift
//  UWorld2Anki
//
//  Created by Ali Mirza on 8/4/26.
//

import Cocoa
import SafariServices
import WebKit

// Derived from the app's own identifier rather than hardcoded: the extension's
// bundle ID is required to be the app's plus a suffix, so this stays correct if
// the app is ever rebranded. A stale literal here fails silently — the setup
// window shows the wrong on/off state and the Safari Settings button does
// nothing, with no error anywhere.
let extensionBundleIdentifier = (Bundle.main.bundleIdentifier ?? "") + ".Extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                // Insert code to inform the user that something went wrong.
                return
            }

            DispatchQueue.main.async {
                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show(\(state.isEnabled), true)")
                } else {
                    webView.evaluateJavaScript("show(\(state.isEnabled), false)")
                }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String else { return }

        if body == "open-preferences" {
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in
                DispatchQueue.main.async {
                    NSApplication.shared.terminate(nil)
                }
            }
            return
        }

        // The setup page can't reach the clipboard reliably from a file:// origin,
        // so it delegates the AnkiConnect add-on code to us.
        if let value = body.dropPrefix("copy:") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(value, forType: .string)
            return
        }

        // Only https links, and only out to the user's default browser — this
        // web view is for the bundled setup page and nothing else.
        if let raw = body.dropPrefix("open-url:"),
           let url = URL(string: raw),
           url.scheme == "https" {
            NSWorkspace.shared.open(url)
        }
    }

}

private extension String {
    /// Returns the remainder after `prefix`, or nil if it doesn't match.
    func dropPrefix(_ prefix: String) -> String? {
        guard hasPrefix(prefix) else { return nil }
        return String(dropFirst(prefix.count))
    }

}
