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
};

type PackageVersion = {
  Version: string;
  Id: string;
};

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
};

type OutdatedPackage = {
  Id: string;
  InstalledVersion: string;
  LatestVersion: string;
  Projects: Array<{ Name: string; Path: string; Version: string }>;
  SourceUrl: string;
  SourceName: string;
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
};

type HttpError = {
  Message: string;
};

type Credentials = {
  Username: string;
  Password: string;
};
