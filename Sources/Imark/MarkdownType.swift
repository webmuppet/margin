import AppKit
import UniformTypeIdentifiers

enum MarkdownType {
    /// Extensions Imark claims in Info.plist. Kept in one place so the open
    /// panel, the sibling-file list and the plist can never drift apart.
    static let extensions = ["md", "markdown", "mdown", "mkd", "mdtext", "mdx", "qmd"]

    static let contentTypes: [UTType] = {
        var types: [UTType] = [.init(filenameExtension: "md") ?? .plainText]
        if let markdown = UTType("net.daringfireball.markdown") { types.append(markdown) }
        return types
    }()

    static func matches(_ url: URL) -> Bool {
        extensions.contains(url.pathExtension.lowercased())
    }

    /// The type a `.md` file actually has on this machine.
    ///
    /// Not a constant, and that is the whole point. `net.daringfireball.markdown`
    /// is the one everybody writes down, and it is not necessarily the one in
    /// force: any app that claims the `md` extension can win it, and iA Writer's
    /// `net.ia.markdown` does on a great many Macs. Asking Launch Services which
    /// type the extension resolves to is the only way to find out.
    ///
    /// Answering the wrong question here is silent. Setting the default for a
    /// type nothing on disk has reports success, changes nothing, and leaves
    /// somebody looking at a menu item that says it worked.
    static var effectiveType: UTType? {
        UTType(filenameExtension: "md")
    }

    /// Whether the system already opens markdown with us. Asked of Launch
    /// Services every time rather than remembered — the user can change the
    /// handler in the Finder behind our back.
    static var imarkIsDefault: Bool {
        guard let markdown = effectiveType,
              let handler = NSWorkspace.shared.urlForApplication(toOpen: markdown)
        else { return false }
        return handler.standardizedFileURL == Bundle.main.bundleURL.standardizedFileURL
    }

    /// Registers Imark as the handler for markdown, so the user does not have
    /// to walk through Get Info → Open with → Change All.
    static func makeImarkDefault(completion: @escaping (Bool) -> Void) {
        // Both: the type in force, which is what a double-click actually
        // consults, and the one the app declares, so the answer is right on a
        // machine where nothing else has claimed the extension. They are
        // usually different and occasionally the same.
        let types = Set(
            [effectiveType, UTType("net.daringfireball.markdown")].compactMap { $0 }
        )
        guard !types.isEmpty else { return completion(false) }

        let group = DispatchGroup()
        var failures = 0
        // Success is the type in force having been set. The declared one
        // failing is not worth reporting to somebody who asked for their
        // double-clicks to land here.
        var effectiveFailed = false

        for type in types {
            group.enter()
            NSWorkspace.shared.setDefaultApplication(
                at: Bundle.main.bundleURL,
                toOpen: type
            ) { error in
                if error != nil {
                    failures += 1
                    if type == effectiveType { effectiveFailed = true }
                }
                group.leave()
            }
        }

        group.notify(queue: .main) {
            completion(!effectiveFailed && failures < types.count)
        }
    }
}
