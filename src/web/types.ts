import nonce from "@/common/nonce";

type PackageViewModelStatus = "Detailed" | "MissingDetails" | "Error";

export class PackageViewModel {
  Id: string;
  Name: string;
  Model: Package;
  private _authors: Array<string>;
  private _tags: Array<string>;
  Description: string;
  IconUrl: string;
  LicenseUrl: string;
  ProjectUrl: string;
  TotalDownloads: number;
  Verified: boolean;
  InstalledVersion: string;
  Version: string;
  Versions: Array<string>;
  Status: PackageViewModelStatus;
  Selected: boolean = false;
  SourceUrl: string = "";
  AllowsUpdate: boolean = true;

  constructor(model: Package, status: PackageViewModelStatus = "Detailed") {
    this._authors = model.Authors;
    this.Id = model.Id;
    this.Name = model.Name;
    this.Description = model.Description;
    this.IconUrl = model.IconUrl;
    this.LicenseUrl = model.LicenseUrl;
    this.ProjectUrl = model.ProjectUrl;
    this.TotalDownloads = model.TotalDownloads;
    this.Verified = model.Verified;
    this.Version = model.Version;
    this.InstalledVersion = model.InstalledVersion;
    this.Versions = model.Versions?.map((x) => x.Version).reverse() ?? [];
    this._tags = model.Tags;
    this.Model = model;
    this.Status = status;
  }

  UpdatePackage(model: Package, sourceUrl?: string) {
    this._authors = model.Authors;
    this.Id = model.Id;
    this.Name = model.Name;
    this.Description = model.Description;
    this.IconUrl = model.IconUrl;
    this.LicenseUrl = model.LicenseUrl;
    this.ProjectUrl = model.ProjectUrl;
    this.TotalDownloads = model.TotalDownloads;
    this.Verified = model.Verified;
    if (model.Version != "") this.Version = model.Version;
    this.Versions = model.Versions?.map((x) => x.Version).reverse() ?? [];
    this._tags = model.Tags;
    this.Model = model;
    if (sourceUrl) this.SourceUrl = sourceUrl;
  }

  get Authors() {
    if (Array.isArray(this._authors)) {
      return this._authors.length ? this._authors.join(", ") : "";
    } else if (typeof this._authors === "string") {
      return this._authors;
    } else {
      console.log("Invalid type for _authors:", this._authors);
    }
    return "";
  }

  get Tags() {
    if (Array.isArray(this._tags)) {
      return this._tags.length ? this._tags.join(", ") : "";
    } else if (typeof this._tags === "string") {
      return this._tags;
    } else {
      console.log("Invalid type for _tags:", this._tags);
    }
    return "";
  }
}

export class ProjectViewModel {
  Name: string;
  Path: string;
  CpmEnabled: boolean;
  Packages: ProjectPackageViewModel[];

  constructor(model: Project) {
    this.Name = model.Name;
    this.Path = model.Path;
    this.CpmEnabled = model.CpmEnabled;
    this.Packages = model.Packages.map((x) => new ProjectPackageViewModel(x));
  }
}

export class ProjectPackageViewModel {
  Id: string;
  Version: string;
  IsPinned: boolean;
  VersionSource: VersionSource;

  constructor(model: ProjectPackage) {
    this.Id = model.Id;
    this.Version = model.Version;
    this.IsPinned = model.IsPinned;
    this.VersionSource = model.VersionSource;
  }
}

export class OutdatedPackageViewModel {
  Id: string;
  InstalledVersion: string;
  LatestVersion: string;
  Projects: Array<{ Name: string; Path: string; Version: string }>;
  SourceUrl: string;
  SourceName: string;
  IsUpdating: boolean = false;
  Selected: boolean = false;

  constructor(model: OutdatedPackage) {
    this.Id = model.Id;
    this.InstalledVersion = model.InstalledVersion;
    this.LatestVersion = model.LatestVersion;
    this.Projects = model.Projects;
    this.SourceUrl = model.SourceUrl;
    this.SourceName = model.SourceName;
  }
}

export class InconsistentPackageViewModel {
  Id: string;
  Versions: Array<{ Version: string; Projects: Array<{ Name: string; Path: string }> }>;
  LatestInstalledVersion: string;
  CpmManaged: boolean;
  TargetVersion: string;
  IsConsolidating: boolean = false;

  constructor(model: InconsistentPackage) {
    this.Id = model.Id;
    this.Versions = model.Versions;
    this.LatestInstalledVersion = model.LatestInstalledVersion;
    this.CpmManaged = model.CpmManaged;
    this.TargetVersion = model.LatestInstalledVersion;
  }
}

export class VulnerablePackageViewModel {
  Id: string;
  InstalledVersion: string;
  Severity: VulnerableSeverity;
  SeverityLabel: string;
  AdvisoryUrl: string;
  AffectedVersionRange: string;
  Projects: Array<{ Name: string; Path: string }>;

  constructor(model: VulnerablePackage) {
    this.Id = model.Id;
    this.InstalledVersion = model.InstalledVersion;
    this.Severity = model.Severity;
    this.SeverityLabel = severityLabels[model.Severity];
    this.AdvisoryUrl = model.AdvisoryUrl;
    this.AffectedVersionRange = model.AffectedVersionRange;
    this.Projects = model.Projects;
  }
}

const severityLabels: Record<VulnerableSeverity, string> = {
  0: "Low",
  1: "Medium",
  2: "High",
  3: "Critical",
};

export class SourceViewModel {
  Id: number = 0;
  Name: string = "";
  Url: string = "";
  PasswordScriptPath: string = "";
  DraftName: string = "";
  DraftUrl: string = "";
  DraftPasswordScriptPath: string = "";
  EditMode: boolean = false;
  Editable: boolean = true;

  constructor(model: Source | null = null) {
    this.Id = nonce();
    this.Name = model?.Name ?? "";
    this.Url = model?.Url ?? "";
    this.PasswordScriptPath = model?.PasswordScriptPath ?? "";
  }

  Edit() {
    this.DraftName = this.Name;
    this.DraftUrl = this.Url;
    this.DraftPasswordScriptPath = this.PasswordScriptPath;
    this.EditMode = true;
  }
  Cancel() {
    this.EditMode = false;
  }
  Save() {
    this.Name = this.DraftName;
    this.Url = this.DraftUrl;
    this.PasswordScriptPath = this.DraftPasswordScriptPath;
    this.EditMode = false;
  }
  GetModel(): Source {
    const model: Source = {
      Name: this.Name,
      Url: this.Url,
    };
    if (this.PasswordScriptPath) {
      model.PasswordScriptPath = this.PasswordScriptPath;
    }
    return model;
  }
}
