import AppKit

private extension NSToolbarItem.Identifier {
    static let find = NSToolbarItem.Identifier("find")
    static let text = NSToolbarItem.Identifier("text")
    static let share = NSToolbarItem.Identifier("share")
    static let print = NSToolbarItem.Identifier("print")
    static let openIn = NSToolbarItem.Identifier("openIn")
    static let theme = NSToolbarItem.Identifier("theme")
    static let comments = NSToolbarItem.Identifier("comments")
    static let code = NSToolbarItem.Identifier("code")
    static let shortcuts = NSToolbarItem.Identifier("shortcuts")
    static let commentFile = NSToolbarItem.Identifier("commentFile")
    static let reviewSendBack = NSToolbarItem.Identifier("reviewSendBack")
    static let reviewApprove = NSToolbarItem.Identifier("reviewApprove")
}

extension DocumentWindowController: NSSharingServicePickerToolbarItemDelegate {
    public func items(for pickerToolbarItem: NSSharingServicePickerToolbarItem) -> [Any] { [url] }
}

extension DocumentWindowController: NSToolbarDelegate {
    func buildToolbar() {
        let toolbar = NSToolbar(identifier: "ImarkDocumentToolbar")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window?.toolbar = toolbar
        window?.toolbarStyle = .unified
    }

    public func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        // Actions you take while reading, and the appearance. Two things left:
        // the AA menu, a second copy of View › Bigger/Smaller/Actual Size, which
        // already have ⌘+, ⌘− and ⌘0; and the shortcuts cheat sheet, which is
        // read once or twice ever and was already sitting in Help under ⌘/.
        // Reading the document, then changing how it looks, then taking it
        // somewhere else. Find sits with the appearance rather than leading the
        // row: it is a thing you do to the page in front of you, not a way out
        // of it.
        //
        // A document under review ends the row with the two buttons that finish
        // it. They go last, past the appearance and the way out, because they
        // are the only items here that end something rather than change how you
        // are looking at it — and because a button that closes a loop somebody
        // else is waiting on should not sit next to Find.
        let reading: [NSToolbarItem.Identifier] =
            [.toggleSidebar, .sidebarTrackingSeparator, .flexibleSpace,
             .commentFile, .comments, .code, .theme, .find, .print, .share, .openIn]
        guard Review.isReview(url) else { return reading }

        // A review keeps only what a reviewer does. Open in, Share and Print are
        // ways of taking a document somewhere else, and this one is a copy that
        // exists to be answered — editing it in Cursor changes nothing anybody
        // will read, and printing it is printing a working file.
        let reviewing = reading.filter { ![.print, .share, .openIn].contains($0) }
        // Once it is decided, only the button that was pressed stays. Hiding the
        // other one leaves its slot behind, and an empty pill in the toolbar
        // looks like something that failed to load.
        if let decision = Review.decision(for: url) {
            return reviewing + [decision == .approve ? .reviewApprove : .reviewSendBack]
        }
        // A gap between them, because the cost of pressing the wrong one is
        // asymmetric: approving by mistake sets work going that nobody checked.
        return reviewing + [.reviewSendBack, .space, .reviewApprove]
    }

    public func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    /// Comments is a switch, and a switch has to look switched. A toolbar item
    /// has no on-state of its own, so it says so the way the rest of the system
    /// does: the glyph fills in and takes the accent colour.
    func refreshCommentsButton() {
        guard let item = window?.toolbar?.items.first(where: { $0.itemIdentifier == .comments })
        else { return }

        let on = reviewingComments
        let symbol = on ? "bubble.left.and.bubble.right.fill" : "bubble.left.and.bubble.right"
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Comments")
        item.image = on ? image?.withSymbolConfiguration(.init(paletteColors: [.imarkAccent])) : image
        item.toolTip = on ? "Hide All Comments (⇧⌘C)" : "Show All Comments (⇧⌘C)"
    }

    /// A switch like Comments, shown the same way: filled and accent-coloured
    /// while the source is showing.
    func refreshCodeButton() {
        guard let item = window?.toolbar?.items.first(where: { $0.itemIdentifier == .code })
        else { return }
        let image = NSImage(systemSymbolName: "chevron.left.forwardslash.chevron.right",
                            accessibilityDescription: "Markdown Source")
        item.image = showingCode ? image?.withSymbolConfiguration(.init(paletteColors: [.imarkAccent])) : image
        item.toolTip = showingCode ? "Show Rendered Document (⌥⌘U)" : "Show Markdown Source (⌥⌘U)"
    }

    func refreshThemeButton() {
        let item = window?.toolbar?.items.first { $0.itemIdentifier == .theme }
        (item?.view as? ThemeButton)?.show(Settings.theme)
    }

    /// Greyed out on a document with nothing to show. A button that only ever
    /// beeps is worse than one that admits there is nothing behind it.
    public func validateToolbarItem(_ item: NSToolbarItem) -> Bool {
        item.itemIdentifier == .comments ? noteCount > 0 : true
    }

    public func toolbar(
        _ toolbar: NSToolbar,
        itemForItemIdentifier identifier: NSToolbarItem.Identifier,
        willBeInsertedIntoToolbar flag: Bool
    ) -> NSToolbarItem? {
        switch identifier {
        case .find:
            return button(identifier, symbol: "magnifyingglass", label: "Find",
                          tip: "Find in Document (⌘F)",
                          action: #selector(performFind(_:)))

        case .code:
            return button(identifier, symbol: "chevron.left.forwardslash.chevron.right",
                          label: "Markdown Source", tip: "Show Markdown Source (⌥⌘U)",
                          action: #selector(toggleCodeView(_:)))

        case .commentFile:
            // Next to Comments, which shows the ones that exist: one names the
            // subject, the other adds to it.
            return button(identifier, symbol: "text.bubble", label: "Comment on Document",
                          tip: "Comment on the whole document",
                          action: #selector(commentOnDocument(_:)))

        case .comments:
            // "Comments" alone names the subject, not the action, and left
            // people pressing it to find out. The tip says what happens.
            return button(identifier, symbol: "bubble.left.and.bubble.right", label: "Comments",
                          tip: "Show All Comments (⇧⌘C)",
                          action: #selector(toggleAllComments(_:)))

        case .shortcuts:
            // Target left nil so it walks the responder chain to the app
            // delegate: the panel belongs to the app, not to one document.
            let item = NSToolbarItem(itemIdentifier: identifier)
            item.image = NSImage(systemSymbolName: "keyboard", accessibilityDescription: "Keyboard Shortcuts")
            item.label = "Shortcuts"
            item.toolTip = "Keyboard Shortcuts (⌘/)"
            item.action = #selector(AppDelegate.showShortcuts(_:))
            return item

        case .print:
            return button(identifier, symbol: "printer", label: "Print",
                          tip: "Print or Save as PDF (⌘P)",
                          action: #selector(printDocument(_:)))

        case .share:
            // The system's own share button: it opens the share menu for the
            // file (AirDrop, Mail, Messages and so on) under the button.
            let item = NSSharingServicePickerToolbarItem(itemIdentifier: identifier)
            item.label = "Share"
            item.toolTip = "Share"
            item.delegate = self
            return item

        case .theme:
            let item = NSToolbarItem(itemIdentifier: identifier)
            item.view = ThemeButton(target: self, action: #selector(cycleTheme(_:)))
            item.label = "Appearance"
            return item

        case .openIn:
            // A button that opens the editors menu under itself. It was a
            // split button — face for the editor used last, chevron for the
            // rest — and the toolbar draws a menu item as a group of its own,
            // apart from the row beside it. A custom view, the way Appearance
            // is, stays in the row. The generic application icon rather than
            // the last editor's: the button opens a list, not one app.
            let image = NSWorkspace.shared.icon(for: .applicationBundle)
            image.size = NSSize(width: 16, height: 16)
            let button = MenuToolbarButton(image: image, tip: "Open in another app") { [weak self] button in
                guard let self else { return }
                self.editorsMenu().popUp(
                    positioning: nil,
                    at: NSPoint(x: 0, y: button.isFlipped ? button.bounds.maxY + 4 : -4),
                    in: button
                )
            }
            let item = NSToolbarItem(itemIdentifier: identifier)
            item.view = button
            item.label = "Open in"
            item.toolTip = "Open in another app"
            return item

        case .reviewSendBack:
            // The palette's own red, the same one you can paint a note with.
            // Borrowing GitHub's would have put a colour in the window that
            // appears nowhere else in the app.
            // "Send Back", not GitHub's "Request Changes": this is a document,
            // not a diff, and the button is not filing a review — it is handing
            // the document back to whoever wrote it, with your notes on it.
            return reviewButton(identifier, title: "Send Back",
                                symbol: "arrow.uturn.backward",
                                tip: "Send your notes back and hold the work",
                                tint: NoteColour.red.colour,
                                action: #selector(sendReviewBack(_:)))

        case .reviewApprove:
            // The only filled button in the app. It is the one place where a
            // button does something outside this window, and the row would
            // otherwise read as five equal ways of looking at a document.
            return reviewButton(identifier, title: "Approve", symbol: "checkmark",
                                tip: "Approve and let the agent continue",
                                tint: .imarkApprove,
                                action: #selector(approveReview(_:)), filled: true)

        default:
            return nil
        }
    }

    /// Wide enough to carry a word, because these two have to be read rather
    /// than recognised: nobody has seen them before, and getting them the wrong
    /// way round sends work back that was meant to go ahead.
    private func reviewButton(
        _ identifier: NSToolbarItem.Identifier,
        title: String,
        symbol: String,
        tip: String,
        tint: NSColor,
        action: Selector,
        filled: Bool = false
    ) -> NSToolbarItem {
        let button = ReviewButton(title: title, symbol: symbol, filled: filled,
                                  tint: tint, target: self, action: action)

        // Decided already: the pair stops offering a choice that has been made
        // and becomes a record of it, so reopening the file tells you what you
        // said instead of inviting you to say it twice.
        if Review.decision(for: url) != nil {
            button.isEnabled = false
            button.title = filled ? "Approved" : "Sent Back"
        }

        let item = NSToolbarItem(itemIdentifier: identifier)
        item.view = button
        item.label = title
        item.toolTip = tip
        return item
    }

    private func button(
        _ identifier: NSToolbarItem.Identifier,
        symbol: String,
        label: String,
        tip: String? = nil,
        action: Selector
    ) -> NSToolbarItem {
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        item.label = label
        item.toolTip = tip ?? label
        item.target = self
        item.action = action
        return item
    }

    private func editorsMenu() -> NSMenu {
        let menu = NSMenu()
        let editors = Editors.installed(for: url)
        if editors.isEmpty {
            let empty = NSMenuItem(title: "No editors found", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            menu.addItem(empty)
        }
        for editor in editors {
            let item = NSMenuItem(title: editor.name, action: #selector(openInEditor(_:)), keyEquivalent: "")
            item.representedObject = editor.url
            item.image = icon(for: editor.url)
            // The one picked last, here or in Settings, ticked the way a menu
            // marks the current choice — the button itself shows no one app.
            item.state = editor.url.path == Settings.preferredEditor?.path ? .on : .off
            item.target = self
            menu.addItem(item)
        }

        // Below a rule, because it is the odd one out: every entry above hands
        // the file to something that will show you its contents, and this one
        // shows you where it lives. Same command as ⇧⌘R — this menu is "where
        // else does this file go", and the Finder is an answer to that.
        menu.addItem(.separator())
        let reveal = menu.addItem(
            withTitle: "Reveal in Finder",
            action: #selector(revealInFinder(_:)),
            keyEquivalent: ""
        )
        reveal.image = icon(for: URL(fileURLWithPath: "/System/Library/CoreServices/Finder.app"))
        reveal.target = self
        return menu
    }

    /// Opens the composer for a note about the document itself. There is no
    /// selection and nothing highlighted, so the popover is anchored to the top
    /// of the page — the note is about all of it.
    @objc func commentOnDocument(_ sender: Any?) {
        beginFileNote()
    }

    // MARK: - Finishing a review

    @objc func approveReview(_ sender: Any?) {
        finishReview(.approve)
    }

    @objc func sendReviewBack(_ sender: Any?) {
        // Sending back an unannotated document tells the agent to try again and
        // nothing about what to change, which is the one outcome nobody wants.
        guard noteCount > 0 else {
            let alert = NSAlert()
            alert.messageText = "Send it back with no notes?"
            alert.informativeText = "You haven't commented on anything. "
                + "The agent will be told to revise without being told what to change."
            alert.addButton(withTitle: "Send Back Anyway")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            return finishReview(.requestChanges)
        }
        finishReview(.requestChanges)
    }

    /// Closing the window is not an answer, and somebody is waiting for one.
    ///
    /// A silent close used to leave the agent on the other end blocked on a
    /// window that was no longer on screen — until the wait timed out, four
    /// hours later. So the window asks on the way out, and closing is not one
    /// of the things it offers: you answer, or you go back to reviewing.
    @objc func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard Review.isReview(url), Review.decision(for: url) == nil else { return true }

        let alert = NSAlert()
        alert.messageText = "Finish this review?"
        alert.informativeText = "Something is waiting for your answer, and closing "
            + "the window doesn't give it one."
        // First is the default and the one Escape lands on: the safe way out of a
        // dialogue nobody asked for is back to the document.
        alert.addButton(withTitle: "Keep Reviewing")
        alert.addButton(withTitle: "Approve")
        alert.addButton(withTitle: "Send Back")

        switch alert.runModal() {
        case .alertSecondButtonReturn: finishReview(.approve)
        // Through the button's own action, so sending back with nothing
        // commented still gets the warning it gets from the toolbar.
        case .alertThirdButtonReturn: sendReviewBack(nil)
        default: break
        }
        // Either way this close does not happen: deciding closes the window
        // itself a moment later, once the button has shown what was pressed.
        return false
    }

    private func finishReview(_ decision: Review.Decision) {
        do {
            try Review.decide(decision, notes: noteCount, for: url)
            // The button says what happened before the window goes, so the press
            // is acknowledged rather than just answered by everything vanishing.
            // The state is kept on disk too: reopening the file later shows it.
            buildToolbar()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.window?.performClose(nil)
            }
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = "Margin couldn't record that decision."
            alert.runModal()
        }
    }

    private func icon(for app: URL) -> NSImage {
        let image = NSWorkspace.shared.icon(forFile: app.path)
        image.size = NSSize(width: 16, height: 16)
        return image
    }

}

/// A toolbar button that opens a menu under itself, sized like ThemeButton so
/// the row reads as one.
private final class MenuToolbarButton: NSButton {
    private let onPress: (NSButton) -> Void

    init(image: NSImage?, tip: String, onPress: @escaping (NSButton) -> Void) {
        self.onPress = onPress
        super.init(frame: .zero)
        bezelStyle = .texturedRounded
        title = ""
        self.image = image
        imagePosition = .imageOnly
        imageScaling = .scaleNone
        toolTip = tip
        setAccessibilityLabel(tip)
        target = self
        action = #selector(pressed)
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: 38),
            heightAnchor.constraint(equalToConstant: 24),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not supported") }

    @objc private func pressed() { onPress(self) }
}
