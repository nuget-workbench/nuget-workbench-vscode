import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import Split from "split.js";
import hash from "object-hash";
import lodash from "lodash";
import { hostApi, configuration } from "@/web/registrations";
import codicon from "@/web/styles/codicon.css";
import { scrollableBase } from "@/web/styles/base.css";
import { sharedStyles } from "@/web/styles/shared.css";
import { PackageViewModel, ProjectViewModel } from "../types";
import type { FilterEvent } from "./search-bar";
import type { SearchBar } from "./search-bar";
import type { UpdatesView } from "./updates-view";
import type { ConsolidateView } from "./consolidate-view";
import type { VulnerabilitiesView } from "./vulnerabilities-view";
import type { DropdownOption } from "./dropdown";
import "./dropdown";

type TabId = "browse" | "installed" | "updates" | "consolidate" | "vulnerabilities";

const PACKAGE_FETCH_TAKE = 50;
const PACKAGE_CONTAINER_SCROLL_MARGIN = 196;
const NUGET_ORG_PREFIX = "https://api.nuget.org";

@customElement("packages-view")
export class PackagesView extends LitElement {
  static styles = [
    codicon,
    scrollableBase,
    sharedStyles,
    css`
      .container {
        display: flex;
        height: 100%;

        .error {
          display: flex;
          gap: 4px;
          justify-content: center;
          flex: 1;
          margin-top: 32px;
          color: var(--vscode-errorForeground);
        }

        &:focus-visible {
          outline: unset;
        }

        .col {
          overflow: hidden;
        }

        .gutter {
          display: flex;
          margin: 0 6px;
          justify-content: center;
          transition: background-color 0.1s ease-out;

          &:hover {
            cursor: col-resize;
            background-color: var(--vscode-sash-hoverBorder);
          }
        }

        .gutter-nested {
          width: 1px;
          background-color: var(--vscode-panelSection-border);
        }

        #project-tree {
          display: flex;
          flex-direction: column;
        }

        #packages {
          display: flex;
          flex-direction: column;

          .loader {
            align-self: center;
            margin: 10px 0;
          }

          .tab-bar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 2px;
            padding: 4px 4px 0;
            margin-bottom: 6px;
          }

          .tab-tree-toggle {
            margin-right: 2px;

            &.active {
              color: var(--vscode-panelTitle-activeForeground);
            }
          }

          .tab {
            background: transparent;
            border: 1px solid transparent;
            color: var(--vscode-foreground);
            padding: 3px 10px;
            font-size: 11px;
            cursor: pointer;
            border-radius: 3px;
            opacity: 0.7;
          }

          .tab:hover {
            opacity: 1;
            background-color: var(--vscode-toolbar-hoverBackground);
          }

          .tab.active {
            opacity: 1;
            background-color: var(--vscode-toolbar-activeBackground, var(--vscode-list-activeSelectionBackground));
            color: var(--vscode-panelTitle-activeForeground);
            border-color: var(--vscode-focusBorder);
          }

          .tab-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 16px;
            height: 16px;
            padding: 0 4px;
            margin-left: 4px;
            font-size: 10px;
            font-weight: bold;
            border-radius: 8px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            line-height: 1;
          }

          .tab-content {
            flex: 1;
            overflow: hidden;
            display: flex;
            margin-top: 6px;
          }

          .tab-content.hidden,
          .tab-content > .hidden {
            display: none;
          }

          .tab-content > .empty {
            flex: 1;
          }

          .installed-packages {
            flex-direction: column;
          }

          .packages-container {
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            flex: 1;

            .package {
              margin-bottom: 3px;
            }

          }
        }

        #projects {
          display: flex;
          flex-direction: column;

          .packages-details-loader {
            align-self: center;
            margin-top: 20px;
          }

          .package-header-panel {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 8px 6px;
            border-bottom: 1px solid var(--vscode-panelSection-border);

            .package-icon-large {
              width: 32px;
              height: 32px;
              flex-shrink: 0;
            }

            .package-header-info {
              flex: 1;
              min-width: 0;
              display: flex;
              flex-direction: column;
              gap: 2px;

              .package-title-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;

                .package-title {
                  font-size: 14px;
                  font-weight: bold;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;

                  a {
                    text-decoration: none;
                    color: var(--vscode-editor-foreground);
                  }

                  .package-link-icon {
                    vertical-align: middle;
                    font-size: 12px;
                    margin-right: 3px;
                  }
                }

                .source-badge {
                  display: flex;
                  align-items: center;
                  gap: 4px;
                  font-size: 11px;
                  color: var(--vscode-descriptionForeground);
                  white-space: nowrap;
                  flex-shrink: 0;

                  .codicon {
                    font-size: 12px;
                  }
                }
              }

              .package-authors-row {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              }
            }
          }

          .package-actions-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px;

            .version-selector {
              display: flex;
              align-items: center;
              gap: 4px;
              white-space: nowrap;
              min-width: 128px;
            }
          }

          .projects-panel-container {
            overflow-y: auto;
            overflow-x: hidden;

            .no-projects {
              display: flex;
              gap: 4px;
              margin-left: 6px;
            }

            .separator {
              margin: 10px 0px;
              height: 1px;
              background-color: var(--vscode-panelSection-border);
            }
          }
        }
      }
    `,
  ];

  private splitter: Split.Instance | null = null;
  packagesPage: number = 0;
  @state() packagesLoadingInProgress: boolean = false;
  private currentLoadPackageHash: string = "";

  @state() activeTab: TabId = "browse";
  @state() projects: Array<ProjectViewModel> = [];
  @state() selectedVersion: string = "";
  @state() selectedPackage: PackageViewModel | null = null;
  @state() packages: Array<PackageViewModel> = [];
  @state() projectsPackages: Array<PackageViewModel> = [];
  @state() updatesCount: number | null = null;
  @state() consolidateCount: number | null = null;
  @state() vulnerabilitiesCount: number | null = null;
  @state() filters: FilterEvent = {
    Prerelease: true,
    Query: "",
    SourceUrl: "",
    Sort: "relevance",
  };
  @state() noMorePackages: boolean = false;
  @state() packagesLoadingError: boolean = false;
  @state() packagesLoadingErrorMessage: string = "";
  @state() selectedProjectPaths: string[] = [];
  @state() showProjectTree: boolean = false;

  connectedCallback(): void {
    super.connectedCallback();
    this.filters = {
      ...this.filters,
      SourceUrl: "",
      Prerelease: configuration.Configuration?.Prerelease ?? false,
    };
    // LoadPackages is triggered by search-bar's connectedCallback emitting filter-changed
    this.LoadProjects();
  }

  firstUpdated(): void {
    this.initSplitter();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.splitter?.destroy();
    this.debouncedLoadProjectsPackages.cancel();
    this.debouncedReloadChildViews.cancel();
  }

  private initSplitter(): void {
    this.splitter?.destroy();
    this.splitter = null;

    const packages = this.shadowRoot!.getElementById("packages")!;
    const projects = this.shadowRoot!.getElementById("projects")!;

    if (this.showProjectTree) {
      const projectTree = this.shadowRoot!.getElementById("project-tree")!;
      this.splitter = Split([projectTree, packages, projects], {
        sizes: [20, 45, 35],
        minSize: [120, 200, 150],
        gutterSize: 4,
        gutter: this.makeGutter,
      });
    } else {
      this.splitter = Split([packages, projects], {
        sizes: [55, 45],
        minSize: [200, 150],
        gutterSize: 4,
        gutter: this.makeGutter,
      });
    }
  }

  private makeGutter(_index: number, direction: string): HTMLElement {
    const gutter = document.createElement("div");
    const gutterNested = document.createElement("div");
    gutter.className = `gutter gutter-${direction}`;
    gutterNested.className = "gutter-nested";
    gutter.appendChild(gutterNested);
    return gutter;
  }

  private toggleProjectTree(): void {
    this.showProjectTree = !this.showProjectTree;
    this.resetChildCounts();
    this.updateComplete.then(() => {
      this.initSplitter();
      this.reloadChildViews();
      // The installed list depends on whether the project filter is active
      this.LoadProjectsPackages();
    });
  }

  get CurrentSource(): Source | undefined {
    return configuration.Configuration?.Sources.find(
      (s) => s.Url === this.filters.SourceUrl
    );
  }

  get NugetOrgPackageUrl(): string | null {
    const sourceUrl =
      this.selectedPackage?.SourceUrl || this.filters.SourceUrl;
    if (sourceUrl.startsWith(NUGET_ORG_PREFIX)) {
      return `https://www.nuget.org/packages/${this.selectedPackage?.Name}/${this.selectedVersion}`;
    }
    return null;
  }

  get PackageVersionUrl(): string {
    if (
      this.selectedPackage?.Status !== "Detailed" ||
      this.selectedPackage?.Model.Versions == undefined ||
      this.selectedPackage?.Model.Versions.length < 1 ||
      !this.selectedPackage?.Model.Version
    ) {
      return "";
    }

    return (
      this.selectedPackage?.Model.Versions.filter(
        (x) => x.Version == this.selectedVersion
      )[0]?.Id ?? ""
    );
  }

  private get effectiveProjectPaths(): string[] {
    return this.showProjectTree ? this.selectedProjectPaths : [];
  }

  /** True when the project tree is visible and the user unchecked every project. */
  private get noProjectsSelected(): boolean {
    return this.showProjectTree && this.projects.length > 0 && this.selectedProjectPaths.length === 0;
  }

  private get filteredProjects(): Array<ProjectViewModel> {
    if (!this.showProjectTree) return this.projects;
    return this.projects.filter((p) =>
      this.selectedProjectPaths.includes(p.Path)
    );
  }

  /** Browse results sorted client-side (the NuGet search API has no sort parameter). */
  private get sortedPackages(): Array<PackageViewModel> {
    switch (this.filters.Sort) {
      case "downloads":
        return [...this.packages].sort((a, b) => b.TotalDownloads - a.TotalDownloads);
      case "name-asc":
        return [...this.packages].sort((a, b) =>
          a.Name.localeCompare(b.Name, undefined, { sensitivity: "base" })
        );
      default:
        return this.packages;
    }
  }

  private handleTabKeydown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement | null)?.getAttribute("role") !== "tab") return;
    const tabs: TabId[] = ["browse", "installed", "updates", "consolidate", "vulnerabilities"];
    const currentIdx = tabs.indexOf(this.activeTab);
    let newIdx = currentIdx;

    switch (e.key) {
      case "ArrowRight":
        newIdx = (currentIdx + 1) % tabs.length;
        break;
      case "ArrowLeft":
        newIdx = (currentIdx - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        newIdx = 0;
        break;
      case "End":
        newIdx = tabs.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    this.setTab(tabs[newIdx]);
    const tabButtons = this.shadowRoot?.querySelectorAll('[role="tab"]');
    (tabButtons?.[newIdx] as HTMLElement)?.focus();
  }

  setTab(tab: TabId): void {
    this.activeTab = tab;
  }

  private async onChildPackageSelected(e: CustomEvent<{ packageId: string; sourceUrl?: string }>): Promise<void> {
    const { packageId, sourceUrl } = e.detail;

    // Check if we already have this package in projectsPackages (installed)
    const lowerId = packageId.toLowerCase();
    const existing = this.projectsPackages.find((p) => p.Id.toLowerCase() === lowerId);
    if (existing) {
      await this.SelectPackage(existing);
      return;
    }

    // Check if we have it in browse packages
    const browsePkg = this.packages.find((p) => p.Id.toLowerCase() === lowerId);
    if (browsePkg) {
      await this.SelectPackage(browsePkg);
      return;
    }

    // Create a new PackageViewModel with MissingDetails — SelectPackage will fetch details
    const pkg = new PackageViewModel(
      {
        Id: packageId,
        Name: packageId,
        IconUrl: "",
        Authors: [],
        Description: "",
        LicenseUrl: "",
        ProjectUrl: "",
        TotalDownloads: 0,
        Verified: false,
        Version: "",
        InstalledVersion: "",
        Versions: [],
        Tags: [],
        Registration: "",
      },
      "MissingDetails"
    );
    if (sourceUrl) pkg.SourceUrl = sourceUrl;
    await this.SelectPackage(pkg);
  }

  setSearchQuery(query: string): void {
    this.setTab("browse");
    this.updateComplete.then(() => {
      const searchBar = this.shadowRoot?.querySelector("search-bar") as SearchBar | null;
      searchBar?.setSearchQuery(query);
    });
  }

  private OnProjectSelectionChanged(paths: string[]): void {
    this.selectedProjectPaths = paths;
    this.resetChildCounts();
    this.debouncedReloadChildViews();
    this.debouncedLoadProjectsPackages();
  }

  private resetChildCounts(): void {
    this.updatesCount = null;
    this.consolidateCount = null;
    this.vulnerabilitiesCount = null;
  }

  // Coalesce bursts (e.g. clicking several project checkboxes) into one reload
  private debouncedReloadChildViews = lodash.debounce(() => this.reloadChildViews(), 300);

  private reloadChildViews(): void {
    this.debouncedReloadChildViews.cancel();
    this.updateComplete.then(() => {
      // Nothing to scan when every project is unchecked; the tabs show an empty state instead
      if (this.noProjectsSelected) return;
      const updates = this.shadowRoot?.querySelector("updates-view") as UpdatesView | null;
      const consolidate = this.shadowRoot?.querySelector("consolidate-view") as ConsolidateView | null;
      const vulnerabilities = this.shadowRoot?.querySelector("vulnerabilities-view") as VulnerabilitiesView | null;
      updates?.LoadOutdatedPackages();
      consolidate?.LoadInconsistentPackages();
      vulnerabilities?.LoadVulnerablePackages();
    });
  }

  private debouncedLoadProjectsPackages = lodash.debounce(() => {
    this.LoadProjectsPackages();
  }, 300);

  private loadProjectsPackagesSeq = 0;

  async LoadProjectsPackages(forceReload: boolean = false): Promise<void> {
    const seq = ++this.loadProjectsPackagesSeq;
    const projectsToUse = this.filteredProjects;

    const packages = projectsToUse
      ?.flatMap((p) => p.Packages)
      .filter((x) =>
        x.Id.toLowerCase().includes(this.filters.Query?.toLowerCase())
      );

    const grouped = packages.reduce(
      (
        acc: {
          [key: string]: { versions: string[]; allowsUpdate: boolean };
        },
        item
      ) => {
        const { Id, Version, IsPinned } = item;

        if (!acc[Id]) {
          acc[Id] = { versions: [], allowsUpdate: false };
        }

        if (acc[Id].versions.indexOf(Version) < 0) {
          acc[Id].versions.push(Version);
        }

        if (!IsPinned) {
          acc[Id].allowsUpdate = true;
        }

        return acc;
      },
      {}
    );

    this.projectsPackages = Object.entries(grouped).map(([Id, data]) => {
      const pkg = new PackageViewModel(
        {
          Id: Id,
          Name: Id,
          IconUrl: "",
          Versions: data.versions.map((x) => ({
            Id: "",
            Version: x,
          })),
          InstalledVersion:
            data.versions.length > 1
              ? "Multiple"
              : (data.versions[0] ?? ""),
          Version: "",
          Description: "",
          LicenseUrl: "",
          ProjectUrl: "",
          Verified: false,
          TotalDownloads: 0,
          Tags: [],
          Registration: "",
          Authors: [],
        },
        "MissingDetails"
      );
      pkg.AllowsUpdate = data.allowsUpdate;
      return pkg;
    });

    const total = this.projectsPackages.length;
    let completed = 0;

    if (total > 0) {
      hostApi.updateStatusBar({
        Percentage: 0,
        Message: "Loading installed packages...",
      });
    }

    try {
      const promises = this.projectsPackages.map(async (pkg) => {
        await this.UpdatePackage(pkg, forceReload);
        // A newer load replaced the list; do not touch the status bar or re-render for it
        if (seq !== this.loadProjectsPackagesSeq) return;
        completed++;
        this.projectsPackages = [...this.projectsPackages];
        hostApi.updateStatusBar({
          Percentage: (completed / total) * 100,
          Message: "Loading installed packages...",
        });
      });
      await Promise.allSettled(promises);
    } finally {
      if (seq === this.loadProjectsPackagesSeq) {
        this.projectsPackages = [...this.projectsPackages];
        if (total > 0) {
          hostApi.updateStatusBar({ Percentage: null });
        }
      }
    }
  }

  async OnProjectUpdated(event: CustomEvent): Promise<void> {
    const isCpmEnabled = event.detail?.isCpmEnabled ?? false;
    if (isCpmEnabled) {
      await this.LoadProjects();
    } else {
      await this.LoadProjectsPackages();
    }
    // Installed versions changed: the Updates/Consolidate/Vulnerabilities tabs are stale now
    this.resetChildCounts();
    this.reloadChildViews();
  }

  /** Called when the Updates or Consolidate tab changed project files. */
  private async OnChildViewChangedProjects(source: Element): Promise<void> {
    await this.LoadProjects(true);
    this.updateComplete.then(() => {
      if (this.noProjectsSelected) return;
      const updates = this.shadowRoot?.querySelector("updates-view") as UpdatesView | null;
      const consolidate = this.shadowRoot?.querySelector("consolidate-view") as ConsolidateView | null;
      const vulnerabilities = this.shadowRoot?.querySelector("vulnerabilities-view") as VulnerabilitiesView | null;
      // The originating view already updated its own list
      if (updates && updates !== source) updates.LoadOutdatedPackages();
      if (consolidate && consolidate !== source) consolidate.LoadInconsistentPackages();
      vulnerabilities?.LoadVulnerablePackages();
    });
  }

  private async UpdatePackage(
    projectPackage: PackageViewModel,
    forceReload: boolean = false
  ): Promise<void> {
    const result = await hostApi.getPackage({
      Id: projectPackage.Id,
      Url: this.filters.SourceUrl,
      SourceName: this.CurrentSource?.Name,
      Prerelease: this.filters.Prerelease,
      PasswordScriptPath: this.CurrentSource?.PasswordScriptPath,
      ForceReload: forceReload,
    });

    if (!result.ok || !result.value.Package) {
      projectPackage.Status = "Error";
    } else {
      if (projectPackage.Version !== "") result.value.Package.Version = "";
      projectPackage.UpdatePackage(
        result.value.Package,
        result.value.SourceUrl
      );
      projectPackage.Status = "Detailed";
    }
  }

  async UpdatePackagesFilters(filters: FilterEvent): Promise<void> {
    const prereleaseChanged = this.filters.Prerelease !== filters.Prerelease;
    const sourceChanged = this.filters.SourceUrl !== filters.SourceUrl;
    const queryChanged = this.filters.Query !== filters.Query;
    const onlySortChanged =
      !prereleaseChanged && !sourceChanged && !queryChanged && this.filters.Sort !== filters.Sort;
    this.filters = filters;

    // Sorting is applied client-side, no need to hit the feed again
    if (onlySortChanged) return;

    const forceReload = prereleaseChanged || sourceChanged;
    await Promise.all([
      this.LoadPackages(false, forceReload),
      this.LoadProjectsPackages(forceReload),
    ]);

    // The Updates tab depends on the prerelease flag and the source
    if (prereleaseChanged || sourceChanged) {
      this.resetChildCounts();
      this.reloadChildViews();
    }
  }

  async SelectPackage(
    selectedPackage: PackageViewModel
  ): Promise<void> {
    this.packages
      .filter((x) => x.Selected)
      .forEach((x) => (x.Selected = false));
    this.projectsPackages
      .filter((x) => x.Selected)
      .forEach((x) => (x.Selected = false));
    selectedPackage.Selected = true;
    this.selectedPackage = selectedPackage;
    this.selectedVersion = selectedPackage.Version;

    if (this.selectedPackage.Status === "MissingDetails") {
      const packageToUpdate = this.selectedPackage;
      const versionBeforeLoad = this.selectedVersion;
      const result = await hostApi.getPackage({
        Id: packageToUpdate.Id,
        Url: this.filters.SourceUrl,
        SourceName: this.CurrentSource?.Name,
        Prerelease: this.filters.Prerelease,
        PasswordScriptPath: this.CurrentSource?.PasswordScriptPath,
      });

      if (!result.ok || !result.value.Package) {
        packageToUpdate.Status = "Error";
      } else {
        if (packageToUpdate.Version !== "") {
          result.value.Package.Version = "";
        }
        packageToUpdate.UpdatePackage(
          result.value.Package,
          result.value.SourceUrl
        );
        packageToUpdate.Status = "Detailed";
      }

      // The user selected another package (or picked a version) while this was loading
      if (this.selectedPackage !== packageToUpdate) {
        this.requestUpdate();
        return;
      }
      // Only fill in the default if the user has not picked a version in the meantime
      if (this.selectedVersion === versionBeforeLoad || !this.selectedVersion) {
        this.selectedVersion = packageToUpdate.Version;
      }
    }

    this.requestUpdate();
  }

  async PackagesScrollEvent(target: HTMLElement): Promise<void> {
    if (this.packagesLoadingInProgress || this.noMorePackages) return;
    if (
      target.scrollTop + target.getBoundingClientRect().height >
      target.scrollHeight - PACKAGE_CONTAINER_SCROLL_MARGIN
    ) {
      await this.LoadPackages(true);
    }
  }

  async ReloadInvoked(
    forceReload: boolean = false
  ): Promise<void> {
    await Promise.all([
      this.LoadPackages(false, forceReload),
      this.LoadProjects(forceReload),
    ]);
    this.resetChildCounts();
    this.reloadChildViews();
  }

  async LoadPackages(
    append: boolean = false,
    forceReload: boolean = false
  ): Promise<void> {
    const buildRequest = () => ({
      Url: this.filters.SourceUrl,
      SourceName: this.CurrentSource?.Name,
      Filter: this.filters.Query,
      Prerelease: this.filters.Prerelease,
      Skip: this.packagesPage * PACKAGE_FETCH_TAKE,
      Take: PACKAGE_FETCH_TAKE,
      PasswordScriptPath: this.CurrentSource?.PasswordScriptPath,
      ForceReload: forceReload,
    });

    this.packagesLoadingError = false;
    this.packagesLoadingInProgress = true;

    if (!append) {
      this.packagesPage = 0;
      // Only drop the details pane when it shows a browse result that is about to disappear
      if (this.selectedPackage && this.packages.includes(this.selectedPackage)) {
        this.selectedPackage = null;
      }
      this.packages = [];
    }
    this.noMorePackages = false;

    const requestObject = buildRequest();
    this.currentLoadPackageHash = hash(requestObject);

    const result = await hostApi.getPackages(requestObject);

    if (this.currentLoadPackageHash !== hash(buildRequest())) {
      // A newer request was started, discard this result
      return;
    }

    if (!result.ok) {
      this.packagesLoadingError = true;
      this.packagesLoadingErrorMessage = result.error;
      this.packagesLoadingInProgress = false;
      // Stop infinite scroll from re-triggering the failing request; the Retry button resumes it
      this.noMorePackages = true;
    } else {
      const packagesViewModels = result.value.Packages.map(
        (x) => new PackageViewModel(x)
      );
      if (packagesViewModels.length < requestObject.Take) {
        this.noMorePackages = true;
      }
      this.packages = [...this.packages, ...packagesViewModels];
      this.packagesPage++;
      this.packagesLoadingInProgress = false;
    }
  }

  @state() projectsLoading: boolean = false;
  @state() projectsLoadingError: string = "";

  async LoadProjects(forceReload: boolean = false): Promise<void> {
    this.projectsLoading = true;
    this.projectsLoadingError = "";
    const result = await hostApi.getProjects({ ForceReload: forceReload });
    this.projectsLoading = false;

    if (!result.ok) {
      this.projectsLoadingError = result.error;
      return;
    }

    const previousPaths = this.projects.map((p) => p.Path);
    const hadAllSelected =
      previousPaths.length === 0 ||
      previousPaths.every((p) => this.selectedProjectPaths.includes(p));

    this.projects = result.value.Projects.map(
      (x) => new ProjectViewModel(x)
    );
    const newPaths = this.projects.map((p) => p.Path);
    // Keep the user's project selection across reloads
    this.selectedProjectPaths = hadAllSelected
      ? newPaths
      : newPaths.filter((p) => this.selectedProjectPaths.includes(p));
    await this.LoadProjectsPackages(forceReload);
  }

  private retryLoadPackages(): void {
    this.LoadPackages(this.packages.length > 0);
  }

  // -- Render helpers --

  private renderBrowseTab(): unknown {
    return html`
      <div
        class="packages-container"
        @scroll=${async (e: Event) =>
          await this.PackagesScrollEvent(e.target as HTMLElement)}
      >
        <div role="listbox" aria-label="Search results">
          ${repeat(
            this.sortedPackages,
            (pkg) => pkg.Id,
            (pkg) => html`
              <package-row
                .package=${pkg}
                .selected=${pkg === this.selectedPackage}
                @click=${() => this.SelectPackage(pkg)}
              ></package-row>
            `
          )}
        </div>
        ${this.packagesLoadingError
          ? html`<div class="error" role="alert">
              <span class="codicon codicon-error"></span>
              <span>${this.packagesLoadingErrorMessage || "Failed to fetch packages"}</span>
              <button class="link-btn" @click=${() => this.retryLoadPackages()}>Retry</button>
            </div>`
          : nothing}
        ${this.packagesLoadingInProgress || (!this.noMorePackages && !this.packagesLoadingError)
          ? html`<span class="spinner medium loader" role="status" aria-label="Loading packages"></span>`
          : nothing}
        ${!this.packagesLoadingInProgress && !this.packagesLoadingError && this.packages.length === 0 && this.noMorePackages
          ? html`<div class="empty">
              <span class="codicon codicon-search"></span>
              ${this.filters.Query
                ? `No packages found for "${this.filters.Query}"`
                : "No packages found"}
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderInstalledTab(): unknown {
    return html`
      <div class="packages-container installed-packages">
        ${this.noProjectsSelected
          ? this.renderNoProjectsSelected()
          : this.projectsPackages.length === 0 && !this.projectsLoading
            ? html`<div class="empty">
                <span class="codicon codicon-package"></span>
                ${this.projectsLoadingError
                  ? this.projectsLoadingError
                  : this.filters.Query
                    ? `No installed packages match "${this.filters.Query}"`
                    : "No packages installed in the selected projects"}
              </div>`
            : html`<div role="listbox" aria-label="Installed packages">
                ${repeat(
                  this.projectsPackages,
                  (pkg) => pkg.Id,
                  (pkg) => html`
                    <package-row
                      .showInstalledVersion=${true}
                      .package=${pkg}
                      .revision=${pkg.Revision}
                      .selected=${pkg === this.selectedPackage}
                      @click=${() => this.SelectPackage(pkg)}
                    ></package-row>
                  `
                )}
              </div>`}
      </div>
    `;
  }


  private renderNoProjectsSelected(): unknown {
    return html`<div class="empty">
      <span class="codicon codicon-info"></span>
      No projects selected. Check at least one project in the project tree.
    </div>`;
  }

  private renderPackageTitle(): unknown {
    const nugetUrl = this.NugetOrgPackageUrl;
    if (nugetUrl != null) {
      return html`<a target="_blank" href=${nugetUrl}>
        <span class="package-link-icon codicon codicon-link-external"></span
        >${this.selectedPackage?.Name}</a
      >`;
    }
    return html`${this.selectedPackage?.Name}`;
  }

  private get selectedSourceName(): string {
    const sourceUrl = this.selectedPackage?.SourceUrl || this.filters.SourceUrl;
    if (!sourceUrl) return "";
    if (sourceUrl.startsWith(NUGET_ORG_PREFIX)) return "nuget.org";
    const source = configuration.Configuration?.Sources.find((s) => s.Url === sourceUrl);
    return source?.Name ?? "";
  }

  private get selectedPackageIconUrl(): string {
    const url = this.selectedPackage?.IconUrl;
    if (!url) return "https://nuget.org/Content/gallery/img/default-package-icon.svg";
    return url;
  }

  private renderDetailedPackage(): unknown {
    const sourceName = this.selectedSourceName;

    return html`
      <div class="package-header-panel">
        <img
          class="package-icon-large"
          alt=""
          src=${this.selectedPackageIconUrl}
          @error=${(e: Event) => {
            (e.target as HTMLImageElement).src = "https://nuget.org/Content/gallery/img/default-package-icon.svg";
          }}
        />
        <div class="package-header-info">
          <div class="package-title-row">
            <span class="package-title">${this.renderPackageTitle()}</span>
            ${sourceName
              ? html`<span class="source-badge">
                  <span class="codicon codicon-globe"></span>
                  ${sourceName}
                </span>`
              : nothing}
          </div>
          ${this.selectedPackage?.Authors
            ? html`<span class="package-authors-row">by ${this.selectedPackage.Authors}</span>`
            : nothing}
        </div>
      </div>
      <div class="package-actions-row">
        <div class="version-selector">
          <custom-dropdown
            .options=${(this.selectedPackage?.Versions || []).map((v): DropdownOption => ({ value: v, label: v }))}
            .value=${this.selectedVersion}
            ariaLabel="Package version"
            @change=${(e: CustomEvent<string>) => { this.selectedVersion = e.detail; }}
          ></custom-dropdown>
          <button
            class="icon-btn"
            aria-label="Reload projects"
            title="Reload projects"
            ?disabled=${this.projectsLoading}
            @click=${() => this.LoadProjects(true)}
          >
            <span class="codicon codicon-refresh"></span>
          </button>
        </div>
      </div>
      <div class="projects-panel-container">
        ${this.filteredProjects.length > 0
          ? this.filteredProjects.map(
              (project) => html`
                <project-row
                  @project-updated=${(e: CustomEvent) =>
                    this.OnProjectUpdated(e)}
                  .project=${project}
                  .packageId=${this.selectedPackage?.Name}
                  .packageVersion=${this.selectedVersion}
                  .sourceUrl=${this.selectedPackage?.SourceUrl}
                ></project-row>
              `
            )
          : html`<div class="no-projects">
              <span class="codicon codicon-info"></span>
              ${this.projectsLoading
                ? "Loading projects..."
                : this.projectsLoadingError
                  ? `Failed to load projects: ${this.projectsLoadingError}`
                  : this.noProjectsSelected
                    ? "No projects selected"
                    : "No projects found"}
            </div>`}
        <div class="separator"></div>
        <package-details
          .package=${this.selectedPackage}
          .packageVersionUrl=${this.PackageVersionUrl}
          .source=${this.selectedPackage?.SourceUrl || this.filters.SourceUrl}
          .passwordScriptPath=${this.CurrentSource?.PasswordScriptPath}
          .selectedVersion=${this.selectedVersion}
        ></package-details>
      </div>
    `;
  }

  private renderMissingDetailsPackage(): unknown {
    if (this.selectedPackage?.Status === "MissingDetails") {
      return html`<span
        class="spinner medium packages-details-loader"
      ></span>`;
    }
    return html`<div class="error">
      <span class="codicon codicon-error"></span> Failed to fetch the
      package from the selected registry.
    </div>`;
  }

  private renderSelectedPackagePanel(): unknown {
    if (this.selectedPackage == null) return nothing;

    if (this.selectedPackage.Status === "Detailed") {
      return this.renderDetailedPackage();
    }
    return this.renderMissingDetailsPackage();
  }

  render(): unknown {
    return html`
      <div class="container">
        ${this.showProjectTree
          ? html`<div class="col" id="project-tree">
              <project-tree
                .projects=${this.projects}
                .selectedPaths=${this.selectedProjectPaths}
                @selection-changed=${(e: CustomEvent<string[]>) =>
                  this.OnProjectSelectionChanged(e.detail)}
              ></project-tree>
            </div>`
          : nothing}

        <div class="col" id="packages">
          <div class="tab-bar" role="tablist" @keydown=${(e: KeyboardEvent) => this.handleTabKeydown(e)}>
            <button
              class="icon-btn tab-tree-toggle ${this.showProjectTree ? "active" : ""}"
              title="${this.showProjectTree ? "Hide project tree" : "Show project tree"}"
              aria-label="${this.showProjectTree ? "Hide project tree" : "Show project tree"}"
              aria-pressed="${this.showProjectTree}"
              @click=${() => this.toggleProjectTree()}
            >
              <span class="codicon codicon-list-tree"></span>
            </button>
            <button
              class="tab ${this.activeTab === "browse" ? "active" : ""}"
              role="tab"
              aria-selected=${this.activeTab === "browse"}
              tabindex=${this.activeTab === "browse" ? 0 : -1}
              @click=${() => this.setTab("browse")}
            >
              BROWSE
            </button>
            <button
              class="tab ${this.activeTab === "installed" ? "active" : ""}"
              role="tab"
              aria-selected=${this.activeTab === "installed"}
              tabindex=${this.activeTab === "installed" ? 0 : -1}
              @click=${() => this.setTab("installed")}
            >
              INSTALLED
            </button>
            <button
              class="tab ${this.activeTab === "updates" ? "active" : ""}"
              role="tab"
              aria-selected=${this.activeTab === "updates"}
              tabindex=${this.activeTab === "updates" ? 0 : -1}
              @click=${() => this.setTab("updates")}
            >
              UPDATES${this.updatesCount !== null
                ? html`<span class="tab-badge">${this.updatesCount}</span>`
                : nothing}
            </button>
            <button
              class="tab ${this.activeTab === "consolidate" ? "active" : ""}"
              role="tab"
              aria-selected=${this.activeTab === "consolidate"}
              tabindex=${this.activeTab === "consolidate" ? 0 : -1}
              @click=${() => this.setTab("consolidate")}
            >
              CONSOLIDATE${this.consolidateCount !== null
                ? html`<span class="tab-badge">${this.consolidateCount}</span>`
                : nothing}
            </button>
            <button
              class="tab ${this.activeTab === "vulnerabilities" ? "active" : ""}"
              role="tab"
              aria-selected=${this.activeTab === "vulnerabilities"}
              tabindex=${this.activeTab === "vulnerabilities" ? 0 : -1}
              @click=${() => this.setTab("vulnerabilities")}
            >
              VULNERABILITIES${this.vulnerabilitiesCount !== null
                ? html`<span class="tab-badge">${this.vulnerabilitiesCount}</span>`
                : nothing}
            </button>
          </div>
          <search-bar
            @reload-invoked=${async (e: CustomEvent<boolean>) =>
              await this.ReloadInvoked(e.detail)}
            @filter-changed=${async (e: CustomEvent<FilterEvent>) =>
              await this.UpdatePackagesFilters(e.detail)}
          ></search-bar>
          <div class="tab-content ${this.activeTab === "browse" ? "" : "hidden"}" role="tabpanel" aria-label="browse tab">
            ${this.renderBrowseTab()}
          </div>
          <div class="tab-content ${this.activeTab === "installed" ? "" : "hidden"}" role="tabpanel" aria-label="installed tab">
            ${this.renderInstalledTab()}
          </div>
          <div class="tab-content ${this.activeTab === "updates" ? "" : "hidden"}" role="tabpanel" aria-label="updates tab">
            ${this.noProjectsSelected ? this.renderNoProjectsSelected() : nothing}
            <updates-view
              class=${this.noProjectsSelected ? "hidden" : ""}
              .prerelease=${this.filters.Prerelease}
              .projectPaths=${this.effectiveProjectPaths}
              .sourceUrl=${this.filters.SourceUrl}
              @count-changed=${(e: CustomEvent<number | null>) => { this.updatesCount = e.detail; }}
              @package-selected=${(e: CustomEvent) => this.onChildPackageSelected(e)}
              @projects-changed=${(e: Event) => this.OnChildViewChangedProjects(e.currentTarget as Element)}
            ></updates-view>
          </div>
          <div class="tab-content ${this.activeTab === "consolidate" ? "" : "hidden"}" role="tabpanel" aria-label="consolidate tab">
            ${this.noProjectsSelected ? this.renderNoProjectsSelected() : nothing}
            <consolidate-view
              class=${this.noProjectsSelected ? "hidden" : ""}
              .projectPaths=${this.effectiveProjectPaths}
              @count-changed=${(e: CustomEvent<number | null>) => { this.consolidateCount = e.detail; }}
              @package-selected=${(e: CustomEvent) => this.onChildPackageSelected(e)}
              @projects-changed=${(e: Event) => this.OnChildViewChangedProjects(e.currentTarget as Element)}
            ></consolidate-view>
          </div>
          <div class="tab-content ${this.activeTab === "vulnerabilities" ? "" : "hidden"}" role="tabpanel" aria-label="vulnerabilities tab">
            ${this.noProjectsSelected ? this.renderNoProjectsSelected() : nothing}
            <vulnerabilities-view
              class=${this.noProjectsSelected ? "hidden" : ""}
              .projectPaths=${this.effectiveProjectPaths}
              @count-changed=${(e: CustomEvent<number | null>) => { this.vulnerabilitiesCount = e.detail; }}
              @package-selected=${(e: CustomEvent) => this.onChildPackageSelected(e)}
            ></vulnerabilities-view>
          </div>
        </div>

        <div class="col" id="projects">
          ${this.renderSelectedPackagePanel()}
        </div>
      </div>
      <nuget-output-log></nuget-output-log>
      <nuget-license-dialog></nuget-license-dialog>
    `;
  }
}
