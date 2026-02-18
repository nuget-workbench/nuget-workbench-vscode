# Change Log

All notable changes to the "nuget-workbench" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Rebranded from "NuGet Gallery" to **NuGet Workbench** with new extension ID `nuget-workbench`
- Typed RPC layer with `Result<T>` discriminated union for host-webview communication
- Migrated UI from FAST Element to **Lit** (LitElement) web components
- Vulnerability scanning view with severity badges and advisory links
- Project tree with checkbox-based multi-project selection
- Tab-based navigation (Packages, Updates, Consolidate, Vulnerabilities, Settings)
- Confirmation dialogs for destructive actions (uninstall, update all, consolidate all, remove source)
- Keyboard navigation and ARIA accessibility for package rows and interactive elements
- Central Package Management (CPM) support with `Directory.Packages.props` detection
- NuGet.config authentication support with password script decryption
- Inline package version decorations in project files (configurable via `NugetWorkbench.enablePackageVersionInlineInfo`)
- Prerelease version support (configurable via `NugetWorkbench.prerelease`)
- Status bar loading indicator (configurable via `NugetWorkbench.statusBarLoadingIndicator`)
- Configurable logging level (configurable via `NugetWorkbench.logLevel`)
- Support for pinned package versions using NuGet's exact version notation `[x.x.x]`
- Multi-source search with "All" option in source dropdown
- OpenTelemetry tracing support

### Changed

- Complete architecture rewrite with typed RPC replacing untyped message passing
- Resizable 3-pane layout using Split.js (project tree / package list / details)
- Improved error handling with `Result<T>` pattern throughout
- Configuration namespace changed from `NugetGallery.*` to `NugetWorkbench.*`

### Credits

This extension builds upon [vscode-nuget-gallery](https://github.com/pcislo/vscode-nuget-gallery) by [Patryk Cislo](https://github.com/pcislo).
