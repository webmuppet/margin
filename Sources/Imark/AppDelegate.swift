import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    // Keyed by nothing on purpose: a window's document changes as you follow
    // links, so identity has to be asked for rather than remembered.
    private var controllers: [DocumentWindowController] = []

    /// The Open panel shown when Margin starts with nothing to show. Kept so a
    /// document that arrives some other way — a Finder double-click while it
    /// is up — can put it away.
    private var launchPanel: NSOpenPanel?
    private var cascadePoint = NSPoint.zero

    func applicationDidFinishLaunching(_ notification: Notification) {
        Menu.install()
        Settings.applyThemeToApp()
        MenuBarItem.shared.sync()
        NSApp.activate(ignoringOtherApps: true)
        // Launch Services delivers documents just after this callback, so give
        // it a beat before deciding the app was opened empty — otherwise the
        // Open panel flashes on every double-click.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.showOpenPanelIfEmpty()
        }
        // Well after launch: an update dialog that beats the document to the
        // screen makes the update feel more important than the reading.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            Updates.checkQuietly()
        }
    }

    @objc func checkForUpdates(_ sender: Any?) { Updates.checkNow() }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showOpenPanelIfEmpty() }
        return true
    }

    func applicationOpenUntitledFile(_ sender: NSApplication) -> Bool {
        showOpenPanelIfEmpty()
        return true
    }

    /// Started with nothing to show, Margin asks for something to show. Not
    /// modal, so ⌘N, Settings and the menu still work while it is up.
    private func showOpenPanelIfEmpty() {
        guard controllers.isEmpty else { return }
        if let launchPanel { return launchPanel.makeKeyAndOrderFront(nil) }
        let panel = Self.markdownPanel()
        // Where you were last reading, since that is the likeliest place to be
        // going back to. ⌘O keeps the panel's own memory of the last folder.
        panel.directoryURL = MarkdownType.recents.first?.deletingLastPathComponent()
        launchPanel = panel
        panel.begin { [weak self] response in
            self?.launchPanel = nil
            guard response == .OK else { return }
            for url in panel.urls { self?.open(url) }
        }
    }

    private static func markdownPanel() -> NSOpenPanel {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = MarkdownType.contentTypes
        return panel
    }

    /// Launch Services hands us documents here — Finder double-click, drag onto
    /// the Dock icon, and `open -a Imark file.md` all land in this method.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { open(url) }
    }

    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { true }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: - Windows

    /// `host` asks for the document to land as a tab beside that window rather
    /// than wherever the window server would have put it. Said outright instead
    /// of left to `tabbingMode`, which answers to a system-wide preference we
    /// do not get to see and should not be second-guessing.
    func open(_ url: URL, asTabIn host: NSWindow? = nil) {
        let key = url.resolvingSymlinksInPath().standardizedFileURL
        launchPanel?.cancel(nil)

        // Opening the same file twice brings the existing window forward
        // instead of stacking duplicates (F2).
        if let existing = controllers.first(where: { $0.url == key }) {
            existing.showWindow(nil)
            existing.window?.makeKeyAndOrderFront(nil)
            return
        }

        let controller = DocumentWindowController(url: key)
        controller.onClose = { [weak self] in
            self?.controllers.removeAll { $0 === controller }
        }
        controllers.append(controller)

        // Added to the group before it is shown: ordering it front first makes
        // it a window for an instant, and it keeps that window's shadow and
        // frame after joining.
        if let host, let window = controller.window {
            host.addTabbedWindow(window, ordered: .above)
            window.makeKeyAndOrderFront(nil)
        } else {
            controller.showWindow(nil)
            controller.window?.makeKeyAndOrderFront(nil)

            // Every document window restores the same autosaved frame, so
            // without this a second document lands exactly on top of the first
            // and looks like nothing happened. A window that joined a tab group
            // has no frame of its own to move, so cascading it would fight the
            // tab bar.
            if controllers.count > 1, let window = controller.window, window.tabGroup == nil {
                cascadePoint = window.cascadeTopLeft(from: cascadePoint)
            }
        }
        NSDocumentController.shared.noteNewRecentDocumentURL(key)
    }

    /// Greys out the menu item once Imark already owns .md — offering to do
    /// something that is already done is just noise.
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(makeDefaultHandler(_:)) {
            return !MarkdownType.imarkIsDefault
        }
        if item.action == #selector(setUpAgents(_:)) {
            // Only where there is an agent to set up, and only until it is.
            item.isHidden = AgentSetup.found.isEmpty
            return !AgentSetup.isInstalled
        }
        return true
    }

    @objc func makeDefaultHandler(_ sender: Any?) {
        MarkdownType.makeImarkDefault { ok in
            let alert = NSAlert()
            alert.messageText = ok
                ? "Margin is now the default for .md"
                : "Couldn't change the default app"
            alert.informativeText = ok
                ? "Double-clicking a markdown file in the Finder opens it here."
                : "Use Get Info on a .md file → Open with → Change All."
            alert.alertStyle = ok ? .informational : .warning
            alert.runModal()
        }
    }

    /// Says what it will write before it writes it, path by path. This is the
    /// one thing Margin does outside its own files and somebody's documents,
    /// and it lands in folders other programs own.
    @objc func setUpAgents(_ sender: Any?) {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let paths = AgentSetup.plannedFiles
            .map { $0.path.replacingOccurrences(of: home, with: "~") }
            .joined(separator: "\n")

        let skipped = AgentSetup.unsupportedFound
        let alert = NSAlert()
        alert.messageText = "Set Margin up for your coding agents?"
        alert.informativeText = [
            "This writes:",
            "",
            paths,
            "",
            "Your agent can then open a document here for you to comment on, and "
                + "read your notes back out of the file. Nothing else is touched, "
                + "and undoing it is deleting exactly these.",
            skipped.isEmpty ? "" : "\nAlso found, and left alone: "
                + skipped.map(\.name).joined(separator: ", ")
                + ". Margin doesn't know where those keep their skills.",
        ].joined(separator: "\n")
        alert.addButton(withTitle: "Set Up")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        do {
            try AgentSetup.install()
        } catch {
            let failure = NSAlert()
            failure.messageText = "Margin couldn't set that up."
            failure.informativeText = (error as? LocalizedError)?.errorDescription ?? "\(error)"
            failure.runModal()
        }
    }

    @objc func showShortcuts(_ sender: Any?) { ShortcutsPanel.toggle() }

    @objc func showSettings(_ sender: Any?) { PreferencesWindowController.show() }

    /// A new file starts with the panel, not with an untitled window: the file
    /// on disk is the document here, and every edit writes straight into it,
    /// so there is nothing for a window to hold before the file exists.
    @objc func newDocument(_ sender: Any?) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = MarkdownType.contentTypes
        panel.nameFieldStringValue = "Untitled.md"
        panel.directoryURL = (NSApp.keyWindow?.windowController as? DocumentWindowController)?
            .url.deletingLastPathComponent()
        guard panel.runModal() == .OK, let target = panel.url else { return }
        do {
            try Self.createDocument(at: target)
            open(target)
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = "Couldn't create that file"
            alert.runModal()
        }
    }

    /// One heading, named after the file. An empty document renders as a
    /// notice with no blocks in it, and the only way to edit is through a
    /// block's margin control — so an empty new file would be one with no way
    /// to type into it.
    static func createDocument(at url: URL) throws {
        try "# \(url.deletingPathExtension().lastPathComponent)\n"
            .write(to: url, atomically: true, encoding: .utf8)
    }

    @objc func openDocument(_ sender: Any?) {
        let panel = Self.markdownPanel()
        guard panel.runModal() == .OK else { return }
        for url in panel.urls { open(url) }
    }
}
