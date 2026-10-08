import AppKit

/// SwiftPM executables get no menu bar for free, so the whole thing is built
/// here. Shortcuts mirror the table in docs/DESIGN.md.
enum Menu {
    static func install() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        appItem.submenu = appMenu()

        let fileItem = NSMenuItem()
        main.addItem(fileItem)
        fileItem.submenu = fileMenu()

        let editItem = NSMenuItem()
        main.addItem(editItem)
        editItem.submenu = editMenu()

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        viewItem.submenu = viewMenu()

        let helpItem = NSMenuItem()
        main.addItem(helpItem)
        let help = NSMenu(title: "Help")
        help.addItem(
            withTitle: "Keyboard Shortcuts",
            action: #selector(AppDelegate.showShortcuts(_:)),
            keyEquivalent: "/"
        )
        helpItem.submenu = help

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let window = NSMenu(title: "Window")
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = window
        NSApp.windowsMenu = window

        NSApp.mainMenu = main
    }

    private static func appMenu() -> NSMenu {
        let menu = NSMenu(title: "Margin")
        menu.addItem(withTitle: "About Margin", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        let updates = menu.addItem(
            withTitle: "Check for Updates…",
            action: #selector(AppDelegate.checkForUpdates(_:)),
            keyEquivalent: ""
        )
        updates.target = NSApp.delegate
        menu.addItem(.separator())
        let settings = menu.addItem(
            withTitle: "Settings…",
            action: #selector(AppDelegate.showSettings(_:)),
            keyEquivalent: ","
        )
        settings.target = NSApp.delegate
        menu.addItem(.separator())
        let makeDefault = menu.addItem(
            withTitle: "Make Margin the Default for .md",
            action: #selector(AppDelegate.makeDefaultHandler(_:)),
            keyEquivalent: ""
        )
        makeDefault.target = NSApp.delegate
        let agents = menu.addItem(
            withTitle: "Set Up for Coding Agents…",
            action: #selector(AppDelegate.setUpAgents(_:)),
            keyEquivalent: ""
        )
        agents.target = NSApp.delegate
        menu.addItem(.separator())
        let hide = menu.addItem(withTitle: "Hide Margin", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        hide.target = NSApp
        menu.addItem(.separator())
        let quit = menu.addItem(withTitle: "Quit Margin", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        return menu
    }

    private static func fileMenu() -> NSMenu {
        let menu = NSMenu(title: "File")
        menu.addItem(withTitle: "New…", action: #selector(AppDelegate.newDocument(_:)), keyEquivalent: "n")
        menu.addItem(withTitle: "Open…", action: #selector(AppDelegate.openDocument(_:)), keyEquivalent: "o")
        let recent = menu.addItem(withTitle: "Open Recent", action: nil, keyEquivalent: "")
        recent.submenu = NSMenu(title: "Open Recent")
        recent.submenu?.delegate = RecentMenu.shared
        menu.addItem(.separator())
        menu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        // Save is the block you are editing; everything else in this app writes
        // itself the moment it is committed, so the item is greyed until a
        // block is open as markdown. Save As is a copy under a new name.
        menu.addItem(withTitle: "Save", action: #selector(DocumentWindowController.saveDocument(_:)), keyEquivalent: "s")
        let saveAs = menu.addItem(withTitle: "Save As…", action: #selector(DocumentWindowController.saveDocumentAs(_:)), keyEquivalent: "s")
        saveAs.keyEquivalentModifierMask = [.command, .shift]
        menu.addItem(.separator())
        let reveal = menu.addItem(withTitle: "Reveal in Finder", action: #selector(DocumentWindowController.revealInFinder(_:)), keyEquivalent: "r")
        reveal.keyEquivalentModifierMask = [.command, .shift]
        menu.addItem(withTitle: "Print…", action: #selector(DocumentWindowController.printDocument(_:)), keyEquivalent: "p")
        menu.addItem(
            withTitle: "Export Comments as Text…",
            action: #selector(DocumentWindowController.exportComments(_:)),
            keyEquivalent: ""
        )
        return menu
    }

    private static func editMenu() -> NSMenu {
        let menu = NSMenu(title: "Edit")
        // The controller's own selector, not `undo:`. `undo:` reads better and
        // is wrong here: NSWindow answers it out of its own undo manager and
        // becomes the target before the chain reaches this app's, so binding
        // Undo to it stopped the document undo running at all. The controller
        // decides instead, and it can, because the page tells it whether a
        // block is open with the keyboard in it.
        menu.addItem(withTitle: "Undo", action: #selector(DocumentWindowController.undoComment(_:)), keyEquivalent: "z")
        let redo = menu.addItem(
            withTitle: "Redo",
            action: #selector(DocumentWindowController.redoInEditor(_:)),
            keyEquivalent: "z"
        )
        redo.keyEquivalentModifierMask = [.command, .shift]
        menu.addItem(.separator())
        // Cut and Paste were missing, and on macOS that is not a cosmetic gap.
        // A key equivalent reaches the responder chain because a menu item
        // carries it, so with no Paste item ⌘V does not arrive anywhere at all
        // — which was fine in an app that only ever read, and stopped being
        // fine the moment it grew a text editor.
        menu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        menu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        // Markdown is plain text and a pasted style would be a lie about what
        // ends up in the file, but the shortcut is muscle memory and lands in
        // the same place either way.
        let plain = menu.addItem(
            withTitle: "Paste and Match Style",
            action: #selector(NSTextView.pasteAsPlainText(_:)),
            keyEquivalent: "v"
        )
        plain.keyEquivalentModifierMask = [.command, .option, .shift]
        menu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Find…", action: #selector(DocumentWindowController.performFind(_:)), keyEquivalent: "f")
        let next = menu.addItem(withTitle: "Find Next", action: #selector(DocumentWindowController.findNext(_:)), keyEquivalent: "g")
        next.keyEquivalentModifierMask = [.command]
        let previous = menu.addItem(withTitle: "Find Previous", action: #selector(DocumentWindowController.findPrevious(_:)), keyEquivalent: "g")
        previous.keyEquivalentModifierMask = [.command, .shift]
        return menu
    }

    private static func viewMenu() -> NSMenu {
        let menu = NSMenu(title: "View")
        menu.addItem(withTitle: "Toggle Sidebar", action: #selector(DocumentWindowController.toggleSidebar(_:)), keyEquivalent: "\\")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Bigger Text", action: #selector(DocumentWindowController.increaseText(_:)), keyEquivalent: "+")
        menu.addItem(withTitle: "Smaller Text", action: #selector(DocumentWindowController.decreaseText(_:)), keyEquivalent: "-")
        menu.addItem(withTitle: "Actual Size", action: #selector(DocumentWindowController.resetText(_:)), keyEquivalent: "0")

        // The column width used to live only inside the toolbar's AA menu, which
        // means it went with it. The menu bar is where macOS expects every
        // command to be findable, and it is what ⌘/ reads to build its list.
        let widths = NSMenu(title: "Column Width")
        for width in Settings.Width.allCases {
            let item = widths.addItem(
                withTitle: width.label,
                action: #selector(DocumentWindowController.chooseWidth(_:)),
                keyEquivalent: ""
            )
            item.representedObject = width.rawValue
        }
        menu.addItem(withTitle: "Column Width", action: nil, keyEquivalent: "").submenu = widths

        menu.addItem(.separator())
        menu.addItem(withTitle: "Back", action: #selector(DocumentWindowController.goBack(_:)), keyEquivalent: "[")
        menu.addItem(withTitle: "Forward", action: #selector(DocumentWindowController.goForward(_:)), keyEquivalent: "]")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Reload", action: #selector(DocumentWindowController.reloadDocument(_:)), keyEquivalent: "r")
        let code = menu.addItem(
            withTitle: "Show Markdown Source",
            action: #selector(DocumentWindowController.toggleCodeView(_:)),
            keyEquivalent: "u"
        )
        code.keyEquivalentModifierMask = [.command, .option]
        menu.addItem(.separator())

        let allComments = menu.addItem(
            withTitle: "Show All Comments",
            action: #selector(DocumentWindowController.toggleAllComments(_:)),
            keyEquivalent: "c"
        )
        allComments.keyEquivalentModifierMask = [.command, .shift]
        menu.addItem(
            withTitle: "Next Comment",
            action: #selector(DocumentWindowController.nextComment(_:)),
            keyEquivalent: "'"
        )
        let previousComment = menu.addItem(
            withTitle: "Previous Comment",
            action: #selector(DocumentWindowController.previousComment(_:)),
            keyEquivalent: "'"
        )
        previousComment.keyEquivalentModifierMask = [.command, .shift]
        return menu
    }
}

/// File › Open Recent, filled each time it opens from the same list the menu
/// bar item and the sidebar read. AppKit fills this menu by itself only for a
/// document-based app or through a private name; built by hand it is a few
/// lines and says exactly what is in it.
private final class RecentMenu: NSObject, NSMenuDelegate {
    static let shared = RecentMenu()

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let recents = MarkdownType.recents.prefix(10)
        // Two READMEs read as one entry twice. The folder tells them apart,
        // the way the Finder's own Open Recent does.
        let names = recents.map(\.lastPathComponent)
        for url in recents {
            let name = url.lastPathComponent
            let title = names.filter { $0 == name }.count > 1
                ? "\(name) — \(url.deletingLastPathComponent().lastPathComponent)"
                : name
            let item = menu.addItem(withTitle: title, action: #selector(openRecent(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = url
            item.toolTip = url.path
            item.image = NSWorkspace.shared.icon(forFile: url.path)
            item.image?.size = NSSize(width: 16, height: 16)
        }
        if !recents.isEmpty { menu.addItem(.separator()) }
        let clear = menu.addItem(
            withTitle: "Clear Menu",
            action: recents.isEmpty ? nil : #selector(NSDocumentController.clearRecentDocuments(_:)),
            keyEquivalent: ""
        )
        clear.target = NSDocumentController.shared
    }

    @objc func openRecent(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        (NSApp.delegate as? AppDelegate)?.open(url)
    }
}
