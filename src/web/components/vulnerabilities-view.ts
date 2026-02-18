import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import codicon from "@/web/styles/codicon.css";
import { scrollableBase } from "@/web/styles/base.css";
import { hostApi } from "@/web/registrations";
import { VulnerablePackageViewModel } from "../types";

const severityColors: Record<number, string> = {
  3: "var(--vscode-charts-red, #f14c4c)",
  2: "var(--vscode-charts-orange, #cca700)",
  1: "var(--vscode-charts-yellow, #cca700)",
  0: "var(--vscode-descriptionForeground)",
};

@customElement("vulnerabilities-view")
export class VulnerabilitiesView extends LitElement {
  static styles = [
    codicon,
    scrollableBase,
    css`
      .vuln-container {
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

        .vuln-row {
          padding: 6px;
          border-bottom: 1px solid var(--vscode-panelSection-border);

          .row-header {
            display: flex;
            align-items: center;
            gap: 8px;

            .severity-badge {
              font-size: 10px;
              font-weight: bold;
              padding: 1px 6px;
              border-radius: 3px;
              text-transform: uppercase;
              white-space: nowrap;
            }

            .package-name {
              font-weight: bold;
              font-size: 13px;
              flex: 1;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .advisory-link {
              font-size: 11px;
              color: var(--vscode-textLink-foreground);
              cursor: pointer;
              text-decoration: none;
              white-space: nowrap;
            }

            .advisory-link:hover {
              text-decoration: underline;
            }
          }

          .vuln-details {
            margin-top: 4px;
            padding-left: 4px;
            font-size: 11px;

            .detail-row {
              display: flex;
              gap: 8px;
              padding: 1px 0;

              .label {
                color: var(--vscode-descriptionForeground);
                min-width: 100px;
              }

              .value {
                font-family: var(--vscode-editor-font-family);
              }
            }

            .project-list {
              color: var(--vscode-descriptionForeground);
              margin-top: 2px;
            }
          }
        }
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
      .spinner.large {
        width: 20px;
        height: 20px;
      }
    `,
  ];

  @state() packages: VulnerablePackageViewModel[] = [];
  @state() isLoading: boolean = false;
  @state() hasError: boolean = false;
  @state() statusText: string = "";
  @state() projectPaths: string[] = [];

  async LoadVulnerablePackages(): Promise<void> {
    this.isLoading = true;
    this.hasError = false;
    this.packages = [];

    try {
      const result = await hostApi.getVulnerablePackages({
        ProjectPaths: this.projectPaths.length > 0 ? this.projectPaths : undefined,
      });

      if (!result.ok) {
        this.hasError = true;
        this.statusText = "Failed to scan for vulnerabilities";
      } else {
        this.packages = (result.value.Packages ?? []).map(
          (p) => new VulnerablePackageViewModel(p)
        );
        this.statusText =
          this.packages.length > 0
            ? `${this.packages.length} vulnerabilit${this.packages.length !== 1 ? "ies" : "y"} found`
            : "";
      }
    } catch {
      this.hasError = true;
    } finally {
      this.isLoading = false;
    }
  }

  private getSeverityColor(severity: number): string {
    return severityColors[severity] ?? severityColors[0];
  }

  private openAdvisory(url: string): void {
    hostApi.openUrl({ Url: url });
  }

  private renderPackageRow(pkg: VulnerablePackageViewModel): unknown {
    const color = this.getSeverityColor(pkg.Severity);
    return html`
      <div class="vuln-row">
        <div class="row-header">
          <span
            class="severity-badge"
            role="img"
            aria-label="${pkg.SeverityLabel} severity"
            style="background-color: ${color}; color: var(--vscode-editor-background);"
          >
            ${pkg.SeverityLabel}
          </span>
          <span class="package-name">${pkg.Id}</span>
          <a
            class="advisory-link"
            href=${pkg.AdvisoryUrl}
            role="link"
            tabindex="0"
            aria-label="View advisory for ${pkg.Id}"
            @click=${(e: Event) => { e.preventDefault(); this.openAdvisory(pkg.AdvisoryUrl); }}
          >
            <span class="codicon codicon-link-external"></span> Advisory
          </a>
        </div>
        <div class="vuln-details">
          <div class="detail-row">
            <span class="label">Installed:</span>
            <span class="value">${pkg.InstalledVersion}</span>
          </div>
          <div class="detail-row">
            <span class="label">Affected:</span>
            <span class="value">${pkg.AffectedVersionRange}</span>
          </div>
          <div class="project-list">
            ${pkg.Projects.map((p) => p.Name).join(", ")}
          </div>
        </div>
      </div>
    `;
  }

  render(): unknown {
    return html`
      <div class="vuln-container" aria-busy=${this.isLoading}>
        <div class="toolbar">
          <button class="icon-btn" aria-label="Refresh vulnerabilities" title="Refresh" @click=${() => this.LoadVulnerablePackages()}>
            <span class="codicon codicon-refresh"></span>
          </button>
          <span class="status-text" role="status" aria-live="polite">${this.statusText}</span>
        </div>

        ${this.isLoading
          ? html`
              <div class="loading" role="status" aria-label="Loading">
                <span class="spinner large"></span>
                <span>Scanning for vulnerabilities...</span>
              </div>
            `
          : nothing}
        ${!this.isLoading && this.packages.length === 0 && !this.hasError
          ? html`
              <div class="empty">
                <span class="codicon codicon-shield"></span>
                No known vulnerabilities found
              </div>
            `
          : nothing}
        ${this.hasError
          ? html`
              <div class="error" role="alert">
                <span class="codicon codicon-error"></span>
                Failed to scan for vulnerabilities
              </div>
            `
          : nothing}
        ${!this.isLoading && this.packages.length > 0
          ? html`
              <div class="package-list" role="list" aria-label="Vulnerable packages">
                ${this.packages.map((pkg) => this.renderPackageRow(pkg))}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
