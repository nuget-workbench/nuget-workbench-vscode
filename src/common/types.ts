type Package = {
  Id: string;
  Name: string;
  Authors: Array<string>;
  Description: string;
  IconUrl: string;
  LicenseUrl: string;
  ProjectUrl: string;
  Registration: string;
  TotalDownloads: number;
  Verified: boolean;
  InstalledVersion: string;
  Version: string;
  Versions: Array<PackageVersion>;
  Tags: Array<string>;
  /** Feed the package was found in (set for search results). */
  SourceUrl?: string;
  /** Deprecated versions, keyed by normalizeVersion(); includes unlisted and filtered versions. */
  Deprecations?: Record<string, PackageDeprecation>;
};

type PackageVersion = {
  Version: string;
  Id: string;
  Vulnerabilities?: Array<{ AdvisoryUrl: string; Severity: VulnerableSeverity }>;
};

type PackageDeprecation = {
  /** "Legacy", "CriticalBugs" and/or "Other". */
  Reasons: string[];
  Message?: string;
  AlternatePackage?: { Id: string; Range: string };
};

/** A package that a project gets through its direct references (from obj/project.assets.json). */
type TransitivePackage = {
  Id: string;
  Version: string;
  Frameworks: string[];
  /** The direct package or project references that pull it in. */
  ViaIds: string[];
};

/** "notRestored": obj/project.assets.json is missing, so transitive packages are unknown. */
type AssetsStatus = "ok" | "notRestored";

type PackageDetails = {
  dependencies: PackageDependencyGroup;
};

type PackageDependencyGroup = {
  frameworks: { [id: string]: Array<PackageDependency> };
};

type PackageDependency = {
  package: string;
  versionRange: string;
};

type VersionSource = "project" | "central" | "override";

type ProjectPackage = {
  Id: string;
  Version: string;
  IsPinned: boolean;
  VersionSource: VersionSource;
};

type Project = {
  Name: string;
  Path: string;
  Packages: Array<ProjectPackage>;
  CpmEnabled: boolean;
  TransitivePackages?: Array<TransitivePackage>;
  AssetsStatus?: AssetsStatus;
};

type Source = {
  Name: string;
  Url: string;
  PasswordScriptPath?: string;
  /** "nuget.config": name and URL come from a nuget.config file and cannot be changed in the extension. */
  Origin?: "nuget.config" | "settings";
};

type Configuration = {
  SkipRestore: boolean;
  EnablePackageVersionInlineInfo: boolean;
  Prerelease: boolean;
  Sources: Array<Source>;
  StatusBarLoadingIndicator: boolean;
  /** Search results per page. Read-only in the UI. */
  PageSize?: number;
  /** Source URL or name preselected in the source dropdown; empty means all sources. Read-only in the UI. */
  DefaultSource?: string;
  /** Expand the output log when an operation fails. Read-only in the UI. */
  ShowOutputOnError?: boolean;
};

type OutdatedPackage = {
  Id: string;
  InstalledVersion: string;
  LatestVersion: string;
  Projects: Array<{ Name: string; Path: string; Version: string }>;
  SourceUrl: string;
  SourceName: string;
  /** Set when the installed (lowest outdated) version is deprecated. */
  InstalledDeprecation?: PackageDeprecation;
};

type InconsistentPackage = {
  Id: string;
  Versions: Array<{
    Version: string;
    Projects: Array<{ Name: string; Path: string }>;
  }>;
  LatestInstalledVersion: string;
  CpmManaged: boolean;
};

type VulnerableSeverity = 0 | 1 | 2 | 3; // Low | Medium | High | Critical

type VulnerabilityEntry = {
  url: string;
  severity: VulnerableSeverity;
  versions: string;
};

type VulnerablePackage = {
  Id: string;
  InstalledVersion: string;
  Severity: VulnerableSeverity;
  AdvisoryUrl: string;
  AffectedVersionRange: string;
  Projects: Array<{ Name: string; Path: string }>;
  /** A transitive package: not referenced directly, pulled in by ViaIds. */
  IsTransitive?: boolean;
  ViaIds?: string[];
};

type HttpError = {
  Message: string;
};

type Credentials = {
  Username: string;
  Password: string;
};
