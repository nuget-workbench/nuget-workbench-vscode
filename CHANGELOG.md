# Change Log

All notable changes to the "vscode-nuget-gallery" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1]

### Fixed

- Fixed password script executing multiple times when fetching packages from sources with password script authentication. The script now executes only once and concurrent requests share the result.

## [2.0.0]

### Added

- Decorator for file editor that shows which packages are available to update (configurable via `NugetGallery.enablePackageVersionInlineInfo`)
- 'All' option in source dropdown to search and fetch packages from all configured sources simultaneously
- Support for Central Package Management (CPM)
  - Automatically detects and resolves package versions from `Directory.Packages.props`
  - Respects individual project opt-out via `<ManagePackageVersionsCentrally>false</ManagePackageVersionsCentrally>`
  - Prevents `--no-restore` bug that causes versions to be added to project files when CPM is enabled
  - Automatically refreshes all projects when updating packages in CPM-enabled solutions
- Package update functionality (remove and re-add with new version)
- NuGet.config authentication support
  - Automatic detection and parsing of NuGet.config files from workspace, user, and machine locations
  - Support for encrypted passwords in NuGet.config via custom password decryption scripts
  - Password script support for PowerShell (.ps1), batch (.bat/.cmd), and executable files
  - Cached credentials to minimize script executions (5-minute TTL)
  - Source-level password script configuration through VS Code settings
- Status bar loading indicator (configurable via `NugetGallery.statusBarLoadingIndicator`)
- Package update status shown in status bar
- Configurable logging level (configurable via `NugetGallery.logLevel`)
- Visual indication of failed package fetches in the package list
- Display "Multiple" text for packages with mixed versions across projects

### Changed

- Forked from [pcislo/vscode-nuget-gallery](https://github.com/pcislo/vscode-nuget-gallery)
- Updated repository information and author details
- Replaced credential provider authentication with NuGet.config-based authentication
- Refactored NuGet API factory to use Basic Authentication with credentials from NuGet.config
- Improved error handling and logging for package fetch operations
- Fixed dotnet CLI command argument order for package add/remove operations

### Fixed

- Fixed project reload issue
- Fixed installed packages not loading for projects with XML namespaces
- Fixed cache not clearing when toggling Prerelease option

### Removed

- Azure Pipelines CI/CD configuration
- Telemetry (temporarily disabled, pending new configuration)
- Sponsor functionality
- Credential provider (CredentialProvider.Microsoft) support

**Note:** This fork is maintained by [@shis91](https://github.com/shis91). Special thanks to [Patryk Cisło](https://github.com/pcislo) for creating the original extension.

## [1.2.4]

### Fix

- Fix `Installed` tab error for Windows
- Fixed parsing of `Version` attribute in project files
- Fixed integration test runner configuration (CommonJS compatibility) and added unit tests for ProjectParser

## [1.2.3]

### Fix

- Respect proxy settings when making requests to repository endpoints
- Changed error handling to correctly log AxiosErrors
- Missing package versions

### Added

- Package info and dependencies
- Option to skip restore when adding package

## [1.1.0]

### Added

- Package info and dependencies

## [1.0.0]

- Initial release
