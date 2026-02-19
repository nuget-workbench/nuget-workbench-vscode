# Changelog

## Unreleased

## 1.0.0 (2026-02-18)

- feat: Rebrand from "NuGet Gallery" to **NuGet Workbench** with new extension ID
- feat: Typed RPC layer with `Result<T>` for host-webview communication
- feat: UI migration from FAST Element to Lit (LitElement)
- feat: Vulnerability scanning view with severity badges and advisory links
- feat: Project tree with checkbox-based multi-project selection
- feat: Confirmation dialogs for destructive actions (uninstall, update all, consolidate)
- feat: Keyboard navigation and ARIA accessibility for all interactive elements
- feat: Central Package Management (CPM) support
- feat: NuGet.config authentication with password script decryption
- feat: Inline package version decorations in project files
- feat: Prerelease version support, pinned versions (`[x.x.x]`)
- feat: Multi-source search with "All" option
- feat: Status bar loading indicator
- refactor: Complete architecture overhaul (typed RPC replacing untyped messages)
- refactor: Resizable 3-pane layout with Split.js
- test: 202 tests (unit + component tests for all handlers and UI components)
- chore: GitHub Actions CI/CD pipeline with automatic Marketplace publish

### Credits

This extension builds upon:
- [pcislo/vscode-nuget-gallery](https://github.com/pcislo/vscode-nuget-gallery) by [Patryk Cislo](https://github.com/pcislo) (original author)
- [shis91/vscode-nuget-gallery](https://github.com/shis91/vscode-nuget-gallery) by [shis91](https://github.com/shis91) (major feature additions, CPM, authentication, test infrastructure)
