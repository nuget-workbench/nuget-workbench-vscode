import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import Split from "split.js";
import hash from "object-hash";
import lodash from "lodash";
import { hostApi, configuration } from "@/web/registrations";
import codicon from "@/web/styles/codicon.css";
import { scrollableBase } from "@/web/styles/base.css";
import { PackageViewModel, ProjectViewModel } from "../types";
import type { FilterEvent } from "./search-bar";
import type { UpdatesView } from "./updates-view";
import type { ConsolidateView } from "./consolidate-view";
import type { VulnerabilitiesView } from "./vulnerabilities-view";

type TabId = "browse" | "installed" | "updates" | "consolidate" | "vulnerabilities";

const PACKAGE_FETCH_TAKE = 50;
const PACKAGE_CONTAINER_SCROLL_MARGIN = 196;
const NUGET_ORG_PREFIX = "https://api.nuget.org";

@customElement("packages-view")
export class PackagesView extends LitElement {
  static styles = [
    codicon,
    scrollableBase,
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
            flex: 1;
          }

          .tab-bar {
            display: flex;
            border-bottom: 1px solid var(--vscode-panelSection-border);
          }

          .tab {
            background: transparent;
            border: none;
            color: var(--vscode-foreground);
            padding: 4px 12px;
            font-size: 11px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            opacity: 0.7;
          }

          .tab:hover {
            opacity: 1;
          }

          .tab.active {
            opacity: 1;
            border-bottom-color: var(--vscode-panelTitle-activeBorder);
            color: var(--vscode-panelTitle-activeForeground);
          }

          .tab-content {
            flex: 1;
            overflow: hidden;
            display: flex;
            margin-top: 6px;
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

            .loader {
              margin: 10px 0px;
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

          .package-info {
            padding: 3px;
            margin-left: 2px;
            margin-right: 3px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;

            .package-title {
              font-size: 14px;
              font-weight: bold;
              overflow: hidden;
              text-overflow: ellipsis;
              text-wrap: nowrap;

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

            .version-selector {
              text-wrap: nowrap;
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

      select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        padding: 4px;
      }

      button.icon-btn {
        background: transparent;
        border: none;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        padding: 2px;
      }

      .spinner {
        display: inline-block;
        border: 2px solid var(--vscode-progressBar-background);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      .spinner.medium {
        width: 16px;
        height: 16px;
      }
    `,
  ];

  private splitter: Split.Instance | null = null;
  packagesPage: number = 0;
  packagesLoadingInProgress: boolean = false;
  private currentLoadPackageHash: string = "";
  private updatesLoaded: boolean = false;
  private consolidateLoaded: boolean = false;
  private vulnerabilitiesLoaded: boolean = false;

  @state() activeTab: TabId = "browse";
  @state() projects: Array<ProjectViewModel> = [];
  @state() selectedVersion: string = "";
  @state() selectedPackage: PackageViewModel | null = null;
  @state() packages: Array<PackageViewModel> = [];
  @state() projectsPackages: Array<PackageViewModel> = [];
  @state() filters: FilterEvent = {
    Prerelease: true,
    Query: "",
    SourceUrl: "",
  };
  @state() noMorePackages: boolean = false;
  @state() packagesLoadingError: boolean = false;
  @state() selectedProjectPaths: string[] = [];

  connectedCallback(): void {
    super.connectedCallback();
    this.filters.SourceUrl = "";
    this.LoadPackages();
    this.LoadProjects();
  }

  firstUpdated(): void {
    const projectTree = this.shadowRoot!.getElementById("project-tree")!;
    const packages = this.shadowRoot!.getElementById("packages")!;
    const projects = this.shadowRoot!.getElementById("projects")!;

    this.splitter = Split([projectTree, packages, projects], {
      sizes: [20, 45, 35],
      minSize: [120, 200, 150],
      gutterSize: 4,
      gutter: (_index: number, direction) => {
        const gutter = document.createElement("div");
        const gutterNested = document.createElement("div");
        gutter.className = `gutter gutter-${direction}`;
        gutterNested.className = "gutter-nested";
        gutter.appendChild(gutterNested);
        return gutter;
      },
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.splitter?.destroy();
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

  private get filteredProjects(): Array<ProjectViewModel> {
    if (this.selectedProjectPaths.length === 0) return this.projects;
    return this.projects.filter((p) =>
      this.selectedProjectPaths.includes(p.Path)
    );
  }

  private handleTabKeydown(e: KeyboardEvent): void {
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

  private setTab(tab: TabId): void {
    this.activeTab = tab;

    if (tab === "updates") {
      const updatesView = this.shadowRoot?.querySelector(
        "updates-view"
      ) as UpdatesView | null;
      if (updatesView && !this.updatesLoaded) {
        this.updatesLoaded = true;
        updatesView.LoadOutdatedPackages();
      }
    } else if (tab === "consolidate") {
      const consolidateView = this.shadowRoot?.querySelector(
        "consolidate-view"
      ) as ConsolidateView | null;
      if (consolidateView && !this.consolidateLoaded) {
        this.consolidateLoaded = true;
        consolidateView.LoadInconsistentPackages();
      }
    } else if (tab === "vulnerabilities") {
      const vulnView = this.shadowRoot?.querySelector(
        "vulnerabilities-view"
      ) as VulnerabilitiesView | null;
      if (vulnView && !this.vulnerabilitiesLoaded) {
        this.vulnerabilitiesLoaded = true;
        vulnView.LoadVulnerablePackages();
      }
    }
  }

  private OnProjectSelectionChanged(paths: string[]): void {
    this.selectedProjectPaths = paths;
    this.updatesLoaded = false;
    this.consolidateLoaded = false;
    this.vulnerabilitiesLoaded = false;
    this.debouncedLoadProjectsPackages();
  }

  private debouncedLoadProjectsPackages = lodash.debounce(() => {
    this.LoadProjectsPackages();
  }, 300);

  async LoadProjectsPackages(forceReload: boolean = false): Promise<void> {
    const projectsToUse =
      this.selectedProjectPaths.length > 0
        ? this.projects.filter((p) =>
            this.selectedProjectPaths.includes(p.Path)
          )
        : this.projects;

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
        completed++;
        hostApi.updateStatusBar({
          Percentage: (completed / total) * 100,
          Message: "Loading installed packages...",
        });
      });
      await Promise.allSettled(promises);
    } finally {
      this.requestUpdate();
      if (total > 0) {
        hostApi.updateStatusBar({ Percentage: null });
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
    const forceReload = this.filters.Prerelease !== filters.Prerelease;
    this.filters = filters;
    await this.LoadPackages(false, forceReload);
    await this.LoadProjectsPackages(forceReload);
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

    if (this.selectedPackage.Status === "MissingDetails") {
      const packageToUpdate = this.selectedPackage;
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
    }

    this.selectedVersion = this.selectedPackage.Version;
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
    await this.LoadPackages(false, forceReload);
    await this.LoadProjects(forceReload);
    this.updatesLoaded = false;
    this.consolidateLoaded = false;
    this.vulnerabilitiesLoaded = false;
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
      this.selectedPackage = null;
      this.packages = [];
    }
    this.noMorePackages = false;

    const requestObject = buildRequest();
    this.currentLoadPackageHash = hash(requestObject);

    const result = await hostApi.getPackages(requestObject);

    if (this.currentLoadPackageHash !== hash(buildRequest())) return;

    if (!result.ok) {
      this.packagesLoadingError = true;
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

  async LoadProjects(forceReload: boolean = false): Promise<void> {
    this.projects = [];
    const result = await hostApi.getProjects({ ForceReload: forceReload });

    if (result.ok) {
      this.projects = result.value.Projects.map(
        (x) => new ProjectViewModel(x)
      );
      this.selectedProjectPaths = this.projects.map((p) => p.Path);
      await this.LoadProjectsPackages(forceReload);
    }
  }

  // -- Render helpers --

  private renderBrowseTab(): unknown {
    return html`
      <div
        class="packages-container"
        @scroll=${async (e: Event) =>
          await this.PackagesScrollEvent(e.target as HTMLElement)}
      >
        ${this.packagesLoadingError
          ? html`<div class="error">
              <span class="codicon codicon-error"></span> Failed to fetch
              packages. See 'Webview Developer Tools' for more details
            </div>`
          : html`
              ${this.packages.map(
                (pkg) => html`
                  <package-row
                    .package=${pkg}
                    @click=${() => this.SelectPackage(pkg)}
                  ></package-row>
                `
              )}
              ${!this.noMorePackages
                ? html`<span class="spinner medium loader"></span>`
                : nothing}
            `}
      </div>
    `;
  }

  private renderInstalledTab(): unknown {
    return html`
      <div class="packages-container installed-packages">
        ${this.projectsPackages.map(
          (pkg) => html`
            <package-row
              .showInstalledVersion=${true}
              .package=${pkg}
              @click=${() => this.SelectPackage(pkg)}
            ></package-row>
          `
        )}
      </div>
    `;
  }

  private renderUpdatesTab(): unknown {
    return html`
      <updates-view
        .prerelease=${this.filters.Prerelease}
        .projectPaths=${this.selectedProjectPaths}
      ></updates-view>
    `;
  }

  private renderConsolidateTab(): unknown {
    return html`
      <consolidate-view
        .projectPaths=${this.selectedProjectPaths}
      ></consolidate-view>
    `;
  }

  private renderVulnerabilitiesTab(): unknown {
    return html`
      <vulnerabilities-view
        .projectPaths=${this.selectedProjectPaths}
      ></vulnerabilities-view>
    `;
  }

  private renderActiveTab(): unknown {
    switch (this.activeTab) {
      case "browse":
        return this.renderBrowseTab();
      case "installed":
        return this.renderInstalledTab();
      case "updates":
        return this.renderUpdatesTab();
      case "consolidate":
        return this.renderConsolidateTab();
      case "vulnerabilities":
        return this.renderVulnerabilitiesTab();
    }
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

  private renderDetailedPackage(): unknown {
    return html`
      <div class="package-info">
        <span class="package-title"> ${this.renderPackageTitle()} </span>
        <div class="version-selector">
          <select
            .value=${this.selectedVersion}
            @change=${(e: Event) => {
              this.selectedVersion = (e.target as HTMLSelectElement).value;
            }}
          >
            ${(this.selectedPackage?.Versions || []).map(
              (v) => html`<option value=${v}>${v}</option>`
            )}
          </select>
          <button class="icon-btn" @click=${() => this.LoadProjects()}>
            <span class="codicon codicon-refresh"></span>
          </button>
        </div>
      </div>
      <div class="projects-panel-container">
        <package-details
          .package=${this.selectedPackage}
          .packageVersionUrl=${this.PackageVersionUrl}
          .source=${this.selectedPackage?.SourceUrl || this.filters.SourceUrl}
          .passwordScriptPath=${this.CurrentSource?.PasswordScriptPath}
        ></package-details>
        <div class="separator"></div>
        ${this.projects.length > 0
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
              <span class="codicon codicon-info"></span> No projects found
            </div>`}
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
        <div class="col" id="project-tree">
          <project-tree
            .projects=${this.projects}
            @selection-changed=${(e: CustomEvent<string[]>) =>
              this.OnProjectSelectionChanged(e.detail)}
          ></project-tree>
        </div>

        <div class="col" id="packages">
          <search-bar
            @reload-invoked=${async (e: CustomEvent<boolean>) =>
              await this.ReloadInvoked(e.detail)}
            @filter-changed=${async (e: CustomEvent<FilterEvent>) =>
              await this.UpdatePackagesFilters(e.detail)}
          ></search-bar>
          <div class="tab-bar" role="tablist" @keydown=${(e: KeyboardEvent) => this.handleTabKeydown(e)}>
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
              UPDATES
            </button>
            <button
              class="tab ${this.activeTab === "consolidate" ? "active" : ""}"
              role="tab"
              aria-selected=${this.activeTab === "consolidate"}
              tabindex=${this.activeTab === "consolidate" ? 0 : -1}
              @click=${() => this.setTab("consolidate")}
            >
              CONSOLIDATE
            </button>
            <button
              class="tab ${this.activeTab === "vulnerabilities" ? "active" : ""}"
              role="tab"
              aria-selected=${this.activeTab === "vulnerabilities"}
              tabindex=${this.activeTab === "vulnerabilities" ? 0 : -1}
              @click=${() => this.setTab("vulnerabilities")}
            >
              VULNERABILITIES
            </button>
          </div>
          <div class="tab-content" role="tabpanel" aria-label="${this.activeTab} tab">${this.renderActiveTab()}</div>
        </div>

        <div class="col" id="projects">
          ${this.renderSelectedPackagePanel()}
        </div>
      </div>
    `;
  }
}
