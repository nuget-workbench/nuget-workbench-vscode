import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import codicon from "@/web/styles/codicon.css";
import { scrollableBase } from "@/web/styles/base.css";
import { hostApi } from "@/web/registrations";
import { OutdatedPackageViewModel } from "../types";

@customElement("updates-view")
export class UpdatesView extends LitElement {
  static styles = [
    codicon,
    scrollableBase,
    css`
      .updates-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;

        .toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px;
          margin-bottom: 6px;

          .status-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            flex: 1;
          }

          .toolbar-right {
            display: flex;
            align-items: center;
            gap: 8px;
          }
        }

        .loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          margin-top: 32px;
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
        }

        .empty {
          display: flex;
          gap: 6px;
          justify-content: center;
          margin-top: 32px;
          color: var(--vscode-descriptionForeground);
        }

        .error {
          display: flex;
          gap: 4px;
          justify-content: center;
          margin-top: 32px;
          color: var(--vscode-errorForeground);
        }

        .package-list {
          overflow-y: auto;
          flex: 1;
        }

        .outdated-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 6px;
          gap: 8px;
          cursor: default;

          &:hover {
            background-color: var(--vscode-list-hoverBackground);
          }

          &.updating {
            opacity: 0.6;
          }

          .row-left {
            display: flex;
            align-items: center;
            gap: 8px;
            overflow: hidden;
            flex: 1;
          }

          .package-info {
            display: flex;
            flex-direction: column;
            overflow: hidden;

            .package-name {
              font-weight: bold;
              font-size: 13px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .version-info {
              display: flex;
              align-items: center;
              gap: 4px;
              font-size: 11px;

              .old-version {
                color: var(--vscode-descriptionForeground);
              }

              .codicon {
                font-size: 10px;
                color: var(--vscode-descriptionForeground);
              }

              .new-version {
                color: var(--vscode-charts-green);
              }
            }

            .project-count {
              font-size: 11px;
              color: var(--vscode-descriptionForeground);
            }
          }

          .row-right {
            display: flex;
            align-items: center;
          }
        }
      }

      button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 4px 12px;
        cursor: pointer;
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
      .spinner.large {
        width: 20px;
        height: 20px;
      }
    `,
  ];

  @state() packages: OutdatedPackageViewModel[] = [];
  @state() isLoading: boolean = false;
  @state() isUpdating: boolean = false;
  @state() hasError: boolean = false;
  @state() prerelease: boolean = false;
  @state() statusText: string = "";
  @state() loadingText: string = "Checking for updates...";
  @state() projectPaths: string[] = [];

  async LoadOutdatedPackages(): Promise<void> {
    this.isLoading = true;
    this.hasError = false;
    this.packages = [];
    this.loadingText = "Checking for updates...";

    try {
      const result = await hostApi.getOutdatedPackages({
        Prerelease: this.prerelease,
        ProjectPaths: this.projectPaths.length > 0 ? this.projectPaths : undefined,
      });

      if (!result.ok) {
        this.hasError = true;
        this.statusText = "Failed to check for updates";
      } else {
        this.packages = (result.value.Packages ?? []).map(
          (p) => new OutdatedPackageViewModel(p)
        );
        this.packages.forEach((p) => (p.Selected = true));
        this.statusText =
          this.packages.length > 0
            ? `${this.packages.length} update${this.packages.length !== 1 ? "s" : ""} available`
            : "";
      }
    } catch {
      this.hasError = true;
    } finally {
      this.isLoading = false;
    }
  }

  private async updateSingle(pkg: OutdatedPackageViewModel): Promise<void> {
    pkg.IsUpdating = true;
    this.requestUpdate();
    try {
      await hostApi.batchUpdatePackages({
        Updates: [
          {
            PackageId: pkg.Id,
            Version: pkg.LatestVersion,
            ProjectPaths: pkg.Projects.map((p) => p.Path),
          },
        ],
      });
      this.packages = this.packages.filter((p) => p.Id !== pkg.Id);
      this.statusText =
        this.packages.length > 0
          ? `${this.packages.length} update${this.packages.length !== 1 ? "s" : ""} available`
          : "All packages are up to date";
    } finally {
      pkg.IsUpdating = false;
      this.requestUpdate();
    }
  }

  private async updateAllSelected(): Promise<void> {
    const selected = this.packages.filter((p) => p.Selected);
    if (selected.length === 0) return;

    const confirm = await hostApi.showConfirmation({
      Message: `Update ${selected.length} package${selected.length !== 1 ? "s" : ""}?`,
      Detail: selected.map((p) => `${p.Id}: ${p.InstalledVersion} -> ${p.LatestVersion}`).join("\n"),
    });
    if (!confirm.ok || !confirm.value.Confirmed) return;

    this.isUpdating = true;
    try {
      await hostApi.batchUpdatePackages({
        Updates: selected.map((p) => ({
          PackageId: p.Id,
          Version: p.LatestVersion,
          ProjectPaths: p.Projects.map((proj) => proj.Path),
        })),
      });
      await this.LoadOutdatedPackages();
    } finally {
      this.isUpdating = false;
    }
  }

  private renderPackageRow(pkg: OutdatedPackageViewModel): unknown {
    return html`
      <div class="outdated-row ${pkg.IsUpdating ? "updating" : ""}">
        <div class="row-left">
          <input
            type="checkbox"
            aria-label="Select ${pkg.Id} for update"
            .checked=${pkg.Selected}
            ?disabled=${pkg.IsUpdating}
            @change=${(e: Event) => {
              pkg.Selected = (e.target as HTMLInputElement).checked;
              this.requestUpdate();
            }}
          />
          <div class="package-info">
            <span class="package-name">${pkg.Id}</span>
            <span class="version-info">
              <span class="old-version">${pkg.InstalledVersion}</span>
              <span class="codicon codicon-arrow-right"></span>
              <span class="new-version">${pkg.LatestVersion}</span>
            </span>
            <span class="project-count"
              >${pkg.Projects.length} project${pkg.Projects.length !== 1 ? "s" : ""}</span
            >
          </div>
        </div>
        <div class="row-right">
          ${pkg.IsUpdating
            ? html`<span class="spinner medium" role="status" aria-label="Loading"></span>`
            : html`
                <button class="icon-btn" aria-label="Update ${pkg.Id}" title="Update ${pkg.Id}" @click=${() => this.updateSingle(pkg)}>
                  <span class="codicon codicon-arrow-circle-up"></span>
                </button>
              `}
        </div>
      </div>
    `;
  }

  render(): unknown {
    return html`
      <div class="updates-container" aria-busy=${this.isLoading}>
        <div class="toolbar">
          <button class="icon-btn" aria-label="Refresh updates" title="Refresh" @click=${() => this.LoadOutdatedPackages()}>
            <span class="codicon codicon-refresh"></span>
          </button>
          <span class="status-text" role="status" aria-live="polite">${this.statusText}</span>
          <div class="toolbar-right">
            ${this.packages.length > 0
              ? html`
                  <button ?disabled=${this.isUpdating} @click=${() => this.updateAllSelected()}>
                    Update All
                  </button>
                `
              : nothing}
          </div>
        </div>

        ${this.isLoading
          ? html`
              <div class="loading" role="status" aria-label="Loading">
                <span class="spinner large"></span>
                <span>${this.loadingText}</span>
              </div>
            `
          : nothing}
        ${!this.isLoading && this.packages.length === 0 && !this.hasError
          ? html`
              <div class="empty">
                <span class="codicon codicon-check"></span>
                All packages are up to date
              </div>
            `
          : nothing}
        ${this.hasError
          ? html`
              <div class="error" role="alert">
                <span class="codicon codicon-error"></span>
                Failed to check for updates
              </div>
            `
          : nothing}
        ${!this.isLoading && this.packages.length > 0
          ? html`
              <div class="package-list" role="list" aria-label="Outdated packages">
                ${this.packages.map((pkg) => this.renderPackageRow(pkg))}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
