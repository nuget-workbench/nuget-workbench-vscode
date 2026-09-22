# Changelog

## Unreleased

- fix: Failed `dotnet` operations are reported as errors instead of success; a failing task no longer blocks all later installs
- fix: Use `dotnet add <project> package` / `dotnet remove <project> package`, which work on every .NET SDK (the noun-first form needs .NET 10)
- fix: Version comparison follows SemVer 2 / NuGet rules (stable > prerelease, build metadata ignored)
- fix: Updates tab checks each project's version, so an outdated project is no longer hidden by a newer one elsewhere
- fix: Long-running operations (updates, consolidation, scans) no longer fail after the 30 s RPC timeout
- fix: Updates and Consolidate keep failed packages in the list and show the error instead of silently removing them
- fix: Install/update/uninstall errors are shown on the project row
- fix: Other tabs refresh after installing, updating or consolidating packages
- fix: Selection highlight, stale search/detail results, and project selection resets after reloads
- fix: Workspace `sources`/`skipRestore` settings are no longer erased when the view opens
- fix: `PackageReference Update=` items no longer drop the whole project; CPM lookups are case-insensitive
- fix: Credentials are stripped from logged HTTP errors
- fix: Sort dropdown now sorts results (by downloads or name)
- ux: Updates tab has select-all, "Update Selected (n)", per-row progress and busy states
- ux: Downgrades are labelled as such; consolidation asks for confirmation and continues past failures
- ux: Empty states, Retry buttons, keyboard-accessible dropdowns and links, focus/hover styles, better contrast for severity badges
- ux: Search: Enter searches immediately, Escape clears; tab bar and search bar wrap in narrow panels
- chore(deps): non-breaking `npm audit fix` (axios, form-data, follow-redirects, lodash)

## 1.0.3 (2026-02-20)

- feat: Release script with dry-run mode and changelog automation (`tools/release.mjs`)
- feat: GitHub Actions `workflow_dispatch` trigger for one-click releases via GitHub UI
- fix: Lit component tests failing with `cssText` error (JSDOM require hook for `.css.ts` modules)
- fix: NuGetApiFactory and SearchBar tests aligned with current source code
- test: 313 tests passing (up from 197)
- chore: CI pipeline uses Node LTS, release job publishes directly

## 1.0.1 (2026-02-19)

- fix: Tab sub-views (Updates, Consolidate, Vulnerabilities) now load reliably — `setTab()` was
  calling `querySelector()` synchronously before Lit rendered the new element (microtask timing bug)
- feat: Tab badges showing result counts on Updates, Consolidate, and Vulnerabilities tabs
- fix: Selected package row now uses the active selection highlight color instead of the inactive one
- ux: Search bar is now hidden on the Updates, Consolidate, and Vulnerabilities tabs where it is not relevant
- breaking: Renamed commands `nuget-workbench.openSettings` and `nuget-workbench.reportProblem`
  to `nugetWorkbench.openSettings` and `nugetWorkbench.reportProblem` for consistency with other command IDs
- chore: Moved screenshot tooling from `screenshot-harness/` to `tools/`

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
