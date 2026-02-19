import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import type { GetPackageDetailsRequest } from "@/common/rpc/types";
import { PackageViewModel } from "../types";
import codicon from "@/web/styles/codicon.css";
import { hostApi } from "../registrations";

type DetailTab = "description" | "dependencies" | "versions";

@customElement("package-details")
export class PackageDetailsComponent extends LitElement {
  static styles = [
    codicon,
    css`
      .loader {
        margin: 0px auto;
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
      .spinner.large {
        width: 20px;
        height: 20px;
      }

      .detail-tabs {
        display: flex;
        border-bottom: 1px solid var(--vscode-panelSection-border);
        margin-bottom: 8px;
      }

      .detail-tab {
        background: transparent;
        border: none;
        color: var(--vscode-foreground);
        padding: 4px 10px;
        font-size: 11px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        opacity: 0.7;
      }

      .detail-tab:hover {
        opacity: 1;
      }

      .detail-tab.active {
        opacity: 1;
        border-bottom-color: var(--vscode-panelTitle-activeBorder);
        color: var(--vscode-panelTitle-activeForeground);
      }

      .tab-content {
        padding: 0 4px;
      }

      .package-meta {
        display: grid;
        gap: 4px 16px;
        grid-template-columns: fit-content(100%) auto;
        font-size: 12px;
        margin-top: 8px;
      }

      .package-meta .label {
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }

      .package-meta .value {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .package-meta a {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
      }

      .package-meta a:hover {
        text-decoration: underline;
      }

      .description-text {
        font-size: 12px;
        line-height: 1.5;
        margin-bottom: 4px;
        color: var(--vscode-foreground);
      }

      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 8px;
      }

      .tag {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }

      .dependencies {
        font-size: 12px;

        ul {
          margin: 4px 0px;
          padding-left: 20px;
        }

        li {
          padding: 1px 0;
        }
      }

      .no-dependencies {
        margin-top: 8px;
        display: flex;
        gap: 4px;
        align-items: center;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;

        span {
          vertical-align: middle;
        }
      }

      .versions-list {
        font-size: 12px;
        max-height: 300px;
        overflow-y: auto;
      }

      .version-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 3px 4px;
        gap: 8px;
      }

      .version-row:hover {
        background-color: var(--vscode-list-hoverBackground);
      }

      .version-row.current {
        background-color: var(--vscode-list-inactiveSelectionBackground);
      }

      .version-number {
        font-family: var(--vscode-editor-font-family);
      }

      .version-badges {
        display: flex;
        gap: 4px;
        align-items: center;
      }

      .prerelease-badge {
        font-size: 9px;
        padding: 0 4px;
        border-radius: 3px;
        background: var(--vscode-editorWarning-foreground);
        color: var(--vscode-editor-background);
      }

      .installed-badge {
        font-size: 9px;
        padding: 0 4px;
        border-radius: 3px;
        background: var(--vscode-charts-green, #10b981);
        color: var(--vscode-editor-background);
      }
    `,
  ];

  @property({ attribute: false }) package: PackageViewModel | null = null;
  @property() packageVersionUrl: string = "";
  @property() source: string = "";
  @property() passwordScriptPath?: string;
  @property() selectedVersion: string = "";

  @state() packageDetailsLoading: boolean = false;
  @state() packageDetails?: PackageDetails;
  @state() activeTab: DetailTab = "description";

  protected updated(changedProps: PropertyValues): void {
    if (changedProps.has("source") || changedProps.has("packageVersionUrl")) {
      this.reloadDependencies();
    }
  }

  private async reloadDependencies(): Promise<void> {
    this.packageDetails = undefined;

    if (!this.source) return;
    if (!this.packageVersionUrl) return;
    this.packageDetailsLoading = true;

    const request: GetPackageDetailsRequest = {
      PackageVersionUrl: this.packageVersionUrl,
      Url: this.source,
      PasswordScriptPath: this.passwordScriptPath,
    };

    const result = await hostApi.getPackageDetails(request);

    if (request.PackageVersionUrl !== this.packageVersionUrl) return;

    if (result.ok) {
      this.packageDetails = result.value.Package;
    }
    this.packageDetailsLoading = false;
  }

  private formatDownloads(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return count.toString();
  }

  private openUrl(url: string): void {
    hostApi.openUrl({ Url: url });
  }

  private renderDescriptionTab(): unknown {
    if (!this.package) return nothing;

    return html`
      ${this.package.Description
        ? html`<div class="description-text">${this.package.Description}</div>`
        : nothing}

      <div class="package-meta">
        ${this.package.Authors
          ? html`
              <span class="label">Authors</span>
              <span class="value">${this.package.Authors}</span>
            `
          : nothing}

        <span class="label">Downloads</span>
        <span class="value">${this.formatDownloads(this.package.TotalDownloads)}</span>

        ${this.package.LicenseUrl
          ? html`
              <span class="label">License</span>
              <a href=${this.package.LicenseUrl} @click=${(e: Event) => { e.preventDefault(); this.openUrl(this.package!.LicenseUrl); }}>View License</a>
            `
          : nothing}

        ${this.package.ProjectUrl
          ? html`
              <span class="label">Project URL</span>
              <a href=${this.package.ProjectUrl} @click=${(e: Event) => { e.preventDefault(); this.openUrl(this.package!.ProjectUrl); }}>View Project</a>
            `
          : nothing}
      </div>

      ${this.package.Tags
        ? html`
            <div class="tags">
              ${this.package.Tags.split(", ")
                .filter((t: string) => t.trim())
                .map((tag: string) => html`<span class="tag">${tag}</span>`)}
            </div>
          `
        : nothing}
    `;
  }

  private renderDependenciesTab(): unknown {
    if (this.packageDetailsLoading) {
      return html`<span class="spinner large loader"></span>`;
    }

    const frameworks = this.packageDetails?.dependencies?.frameworks ?? {};
    const frameworkKeys = Object.keys(frameworks);

    if (frameworkKeys.length > 0) {
      return html`
        <div class="dependencies">
          <ul>
            ${frameworkKeys.map(
              (fw) => html`
                <li>
                  <strong>${fw}</strong>
                  <ul>
                    ${(frameworks[fw] ?? []).map(
                      (dep) => html`<li>${dep.package} ${dep.versionRange}</li>`
                    )}
                  </ul>
                </li>
              `
            )}
          </ul>
        </div>
      `;
    }

    return html`
      <div class="no-dependencies">
        <span class="codicon codicon-info"></span>
        <span>No dependencies</span>
      </div>
    `;
  }

  private renderVersionsTab(): unknown {
    const versions = this.package?.Versions ?? [];
    const installedVersion = this.package?.InstalledVersion;

    return html`
      <div class="versions-list" role="list" aria-label="Package versions">
        ${versions.map((v) => {
          const isPrerelease = v.includes("-");
          const isInstalled = v === installedVersion;
          const isCurrent = v === this.selectedVersion;

          return html`
            <div class="version-row ${isCurrent ? "current" : ""}" role="listitem">
              <span class="version-number">${v}</span>
              <span class="version-badges">
                ${isInstalled ? html`<span class="installed-badge">installed</span>` : nothing}
                ${isPrerelease ? html`<span class="prerelease-badge">pre</span>` : nothing}
              </span>
            </div>
          `;
        })}
      </div>
    `;
  }

  private renderActiveTab(): unknown {
    switch (this.activeTab) {
      case "description":
        return this.renderDescriptionTab();
      case "dependencies":
        return this.renderDependenciesTab();
      case "versions":
        return this.renderVersionsTab();
    }
  }

  render(): unknown {
    return html`
      <div class="detail-tabs" role="tablist">
        <button
          class="detail-tab ${this.activeTab === "description" ? "active" : ""}"
          role="tab"
          aria-selected=${this.activeTab === "description"}
          @click=${() => (this.activeTab = "description")}
        >
          Description
        </button>
        <button
          class="detail-tab ${this.activeTab === "dependencies" ? "active" : ""}"
          role="tab"
          aria-selected=${this.activeTab === "dependencies"}
          @click=${() => (this.activeTab = "dependencies")}
        >
          Dependencies
        </button>
        <button
          class="detail-tab ${this.activeTab === "versions" ? "active" : ""}"
          role="tab"
          aria-selected=${this.activeTab === "versions"}
          @click=${() => (this.activeTab = "versions")}
        >
          Versions (${this.package?.Versions.length ?? 0})
        </button>
      </div>
      <div class="tab-content" role="tabpanel">
        ${this.renderActiveTab()}
      </div>
    `;
  }
}
