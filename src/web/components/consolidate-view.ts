import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import codicon from "@/web/styles/codicon.css";
import { scrollableBase } from "@/web/styles/base.css";
import { hostApi } from "@/web/registrations";
import { InconsistentPackageViewModel } from "../types";

@customElement("consolidate-view")
export class ConsolidateView extends LitElement {
  static styles = [
    codicon,
    scrollableBase,
    css`
      .consolidate-container {
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

        .inconsistent-row {
          padding: 6px;
          border-bottom: 1px solid var(--vscode-panelSection-border);

          &.consolidating {
            opacity: 0.6;
          }

          .row-header {
            display: flex;
            align-items: center;
            gap: 8px;

            .package-name {
              font-weight: bold;
              font-size: 13px;
              flex: 1;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .cpm-badge {
              font-size: 10px;
              padding: 1px 4px;
              border-radius: 3px;
              background-color: var(--vscode-badge-background);
              color: var(--vscode-badge-foreground);
            }

            .row-actions {
              display: flex;
              align-items: center;
              gap: 4px;

              .version-dropdown {
                min-width: 100px;
              }
            }
          }

          .version-details {
            margin-top: 4px;
            padding-left: 4px;

            .version-row {
              display: flex;
              gap: 8px;
              font-size: 11px;
              padding: 2px 0;

              .version {
                min-width: 60px;
                color: var(--vscode-charts-yellow);
                font-family: var(--vscode-editor-font-family);
              }

              .projects {
                color: var(--vscode-descriptionForeground);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              }
            }
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

      select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        padding: 4px;
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
      .spinner.small {
        width: 12px;
        height: 12px;
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

  @state() packages: InconsistentPackageViewModel[] = [];
  @state() isLoading: boolean = false;
  @state() isConsolidating: boolean = false;
  @state() hasError: boolean = false;
  @state() statusText: string = "";
  @state() projectPaths: string[] = [];

  async LoadInconsistentPackages(): Promise<void> {
    this.isLoading = true;
    this.hasError = false;
    this.packages = [];

    try {
      const result = await hostApi.getInconsistentPackages({
        ProjectPaths: this.projectPaths.length > 0 ? this.projectPaths : undefined,
      });

      if (!result.ok) {
        this.hasError = true;
        this.statusText = "Failed to check";
      } else {
        this.packages = (result.value.Packages ?? []).map(
          (p) => new InconsistentPackageViewModel(p)
        );
        this.statusText =
          this.packages.length > 0
            ? `${this.packages.length} package${this.packages.length !== 1 ? "s" : ""} with inconsistent versions`
            : "";
      }
    } catch {
      this.hasError = true;
    } finally {
      this.isLoading = false;
    }
  }

  private async consolidateSingle(pkg: InconsistentPackageViewModel): Promise<void> {
    pkg.IsConsolidating = true;
    this.requestUpdate();
    try {
      const allProjects = pkg.Versions.flatMap((v) => v.Projects.map((p) => p.Path));

      await hostApi.consolidatePackages({
        PackageId: pkg.Id,
        TargetVersion: pkg.TargetVersion,
        ProjectPaths: allProjects,
      });

      this.packages = this.packages.filter((p) => p.Id !== pkg.Id);
      this.statusText =
        this.packages.length > 0
          ? `${this.packages.length} package${this.packages.length !== 1 ? "s" : ""} with inconsistent versions`
          : "All versions are consistent";
    } finally {
      pkg.IsConsolidating = false;
      this.requestUpdate();
    }
  }

  private async consolidateAll(): Promise<void> {
    const confirm = await hostApi.showConfirmation({
      Message: `Consolidate ${this.packages.length} package${this.packages.length !== 1 ? "s" : ""}?`,
      Detail: "This will update all inconsistent packages to their target versions.",
    });
    if (!confirm.ok || !confirm.value.Confirmed) return;

    this.isConsolidating = true;
    try {
      for (const pkg of this.packages) {
        await this.consolidateSingle(pkg);
      }
    } finally {
      this.isConsolidating = false;
      await this.LoadInconsistentPackages();
    }
  }

  private renderPackageRow(pkg: InconsistentPackageViewModel): unknown {
    return html`
      <div class="inconsistent-row ${pkg.IsConsolidating ? "consolidating" : ""}">
        <div class="row-header">
          <span class="package-name">${pkg.Id}</span>
          ${pkg.CpmManaged ? html`<span class="cpm-badge">CPM Override</span>` : nothing}
          <div class="row-actions">
            ${pkg.IsConsolidating
              ? html`<span class="spinner medium"></span>`
              : html`
                  <select
                    class="version-dropdown"
                    aria-label="Target version for ${pkg.Id}"
                    .value=${pkg.TargetVersion}
                    @change=${(e: Event) => {
                      pkg.TargetVersion = (e.target as HTMLSelectElement).value;
                      this.requestUpdate();
                    }}
                  >
                    ${pkg.Versions.map(
                      (v) => html`<option value=${v.Version}>${v.Version}</option>`
                    )}
                  </select>
                  <button class="icon-btn" aria-label="Consolidate ${pkg.Id}" title="Consolidate ${pkg.Id}" @click=${() => this.consolidateSingle(pkg)}>
                    <span class="codicon codicon-arrow-circle-up"></span>
                  </button>
                `}
          </div>
        </div>
        <div class="version-details">
          ${pkg.Versions.map(
            (v) => html`
              <div class="version-row">
                <span class="version">${v.Version}</span>
                <span class="projects">${v.Projects.map((p) => p.Name).join(", ")}</span>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  render(): unknown {
    return html`
      <div class="consolidate-container" aria-busy=${this.isLoading}>
        <div class="toolbar">
          <button class="icon-btn" aria-label="Refresh inconsistencies" title="Refresh" @click=${() => this.LoadInconsistentPackages()}>
            <span class="codicon codicon-refresh"></span>
          </button>
          <span class="status-text" role="status" aria-live="polite">${this.statusText}</span>
          <div class="toolbar-right">
            ${this.packages.length > 0
              ? html`
                  <button
                    ?disabled=${this.isConsolidating}
                    @click=${() => this.consolidateAll()}
                  >
                    Consolidate All
                  </button>
                `
              : nothing}
          </div>
        </div>

        ${this.isLoading
          ? html`
              <div class="loading" role="status" aria-label="Loading">
                <span class="spinner large"></span>
                <span>Checking for inconsistencies...</span>
              </div>
            `
          : nothing}
        ${!this.isLoading && this.packages.length === 0 && !this.hasError
          ? html`
              <div class="empty">
                <span class="codicon codicon-check"></span>
                All package versions are consistent
              </div>
            `
          : nothing}
        ${this.hasError
          ? html`
              <div class="error" role="alert">
                <span class="codicon codicon-error"></span>
                Failed to check for inconsistencies
              </div>
            `
          : nothing}
        ${!this.isLoading && this.packages.length > 0
          ? html`
              <div class="package-list" role="list" aria-label="Inconsistent packages">
                ${this.packages.map((pkg) => this.renderPackageRow(pkg))}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
