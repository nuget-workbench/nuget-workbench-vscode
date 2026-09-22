import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import codicon from "@/web/styles/codicon.css";
import type { DropdownOption } from "./dropdown";
import "./dropdown";
import { scrollableBase } from "@/web/styles/base.css";
import { sharedStyles } from "@/web/styles/shared.css";
import { hostApi } from "@/web/registrations";
import { InconsistentPackageViewModel } from "../types";

@customElement("consolidate-view")
export class ConsolidateView extends LitElement {
  static styles = [
    codicon,
    scrollableBase,
    sharedStyles,
    css`
      :host {
        display: flex;
        flex: 1;
        width: 100%;
      }

      .consolidate-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        overflow: hidden;

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
              min-width: 0;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              color: var(--vscode-foreground);
            }

            .package-name:hover {
              color: var(--vscode-textLink-activeForeground);
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
                color: var(--vscode-editorWarning-foreground);
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
    `,
  ];

  @state() packages: InconsistentPackageViewModel[] = [];
  @state() isLoading: boolean = false;
  @state() isConsolidating: boolean = false;
  @state() hasError: boolean = false;
  @state() errorText: string = "";
  @state() statusText: string = "";
  @property({ attribute: false }) projectPaths: string[] = [];

  private loaded = false;
  private loadSeq = 0;

  connectedCallback(): void {
    super.connectedCallback();
    if (!this.loaded) {
      this.loaded = true;
      this.LoadInconsistentPackages();
    }
  }

  private get isBusy(): boolean {
    return this.isConsolidating || this.packages.some((p) => p.IsConsolidating);
  }

  private emitCount(count: number | null): void {
    this.dispatchEvent(new CustomEvent<number | null>("count-changed", {
      detail: count,
      bubbles: true,
      composed: true,
    }));
  }

  private updateStatusText(): void {
    const n = this.packages.length;
    this.statusText = n > 0 ? `${n} package${n !== 1 ? "s" : ""} with inconsistent versions` : "";
  }

  async LoadInconsistentPackages(): Promise<void> {
    const seq = ++this.loadSeq;
    this.isLoading = true;
    this.hasError = false;
    this.errorText = "";
    this.statusText = "";
    this.packages = [];

    try {
      const result = await hostApi.getInconsistentPackages({
        ProjectPaths: this.projectPaths.length > 0 ? this.projectPaths : undefined,
      });
      if (seq !== this.loadSeq) return;

      if (!result.ok) {
        this.hasError = true;
        this.errorText = result.error;
        this.emitCount(null);
      } else {
        this.packages = (result.value.Packages ?? []).map(
          (p) => new InconsistentPackageViewModel(p)
        );
        this.emitCount(this.packages.length);
        this.updateStatusText();
      }
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.hasError = true;
      this.errorText = e instanceof Error ? e.message : String(e);
      this.emitCount(null);
    } finally {
      if (seq === this.loadSeq) {
        this.isLoading = false;
      }
    }
  }

  private selectPackage(packageId: string): void {
    this.dispatchEvent(new CustomEvent("package-selected", {
      detail: { packageId },
      bubbles: true,
      composed: true,
    }));
  }

  /** Consolidates one package; returns true on success. Errors are stored on the row. */
  private async runConsolidate(pkg: InconsistentPackageViewModel): Promise<boolean> {
    pkg.IsConsolidating = true;
    pkg.Error = null;
    this.requestUpdate();
    try {
      const allProjects = pkg.Versions.flatMap((v) => v.Projects.map((p) => p.Path));
      const result = await hostApi.consolidatePackages({
        PackageId: pkg.Id,
        TargetVersion: pkg.TargetVersion,
        ProjectPaths: allProjects,
      });
      if (!result.ok) {
        pkg.Error = result.error;
        return false;
      }
      return true;
    } catch (e) {
      pkg.Error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      pkg.IsConsolidating = false;
      this.requestUpdate();
    }
  }

  private finishConsolidation(attempted: number, succeeded: Set<string>): void {
    this.packages = this.packages.filter((p) => !succeeded.has(p.Id));
    this.emitCount(this.packages.length);
    this.updateStatusText();
    const failed = attempted - succeeded.size;
    if (failed > 0) {
      this.statusText = `${failed} of ${attempted} consolidation${attempted !== 1 ? "s" : ""} failed`;
    }
    if (succeeded.size > 0) {
      this.dispatchEvent(new CustomEvent("projects-changed", { bubbles: true, composed: true }));
    }
  }

  private async consolidateSingle(pkg: InconsistentPackageViewModel): Promise<void> {
    if (this.isBusy) return;
    const projectCount = pkg.Versions.reduce((n, v) => n + v.Projects.length, 0);
    const confirm = await hostApi.showConfirmation({
      Message: `Consolidate ${pkg.Id} to ${pkg.TargetVersion}?`,
      Detail: `This will set ${pkg.Id} to version ${pkg.TargetVersion} in ${projectCount} project${projectCount !== 1 ? "s" : ""}.`,
    });
    if (!confirm.ok || !confirm.value.Confirmed) return;

    this.statusText = `Consolidating ${pkg.Id}...`;
    const ok = await this.runConsolidate(pkg);
    this.finishConsolidation(1, ok ? new Set([pkg.Id]) : new Set());
  }

  private async consolidateAll(): Promise<void> {
    if (this.isBusy) return;
    const targets = [...this.packages];
    const confirm = await hostApi.showConfirmation({
      Message: `Consolidate ${targets.length} package${targets.length !== 1 ? "s" : ""}?`,
      Detail: targets.map((p) => `${p.Id} -> ${p.TargetVersion}`).join("\n"),
    });
    if (!confirm.ok || !confirm.value.Confirmed) return;

    this.isConsolidating = true;
    const succeeded = new Set<string>();
    try {
      for (let i = 0; i < targets.length; i++) {
        const pkg = targets[i];
        this.statusText = `Consolidating ${pkg.Id} (${i + 1}/${targets.length})...`;
        // Continue with the remaining packages even if one fails
        if (await this.runConsolidate(pkg)) {
          succeeded.add(pkg.Id);
        }
      }
    } finally {
      this.isConsolidating = false;
      this.finishConsolidation(targets.length, succeeded);
    }
  }

  private renderPackageRow(pkg: InconsistentPackageViewModel): unknown {
    return html`
      <div class="inconsistent-row ${pkg.IsConsolidating ? "consolidating" : ""}" role="listitem">
        <div class="row-header">
          <button class="link-btn package-name" title="Show ${pkg.Id} details" @click=${() => this.selectPackage(pkg.Id)}>${pkg.Id}</button>
          ${pkg.CpmManaged
            ? html`<span class="cpm-badge" title="Managed by Central Package Management (Directory.Packages.props)">CPM</span>`
            : nothing}
          ${pkg.Error
            ? html`<span class="row-error" role="img" aria-label="Consolidation failed: ${pkg.Error}" title=${pkg.Error}>
                <span class="codicon codicon-error"></span>
              </span>`
            : nothing}
          <div class="row-actions">
            ${pkg.IsConsolidating
              ? html`<span class="spinner medium" role="status" aria-label="Consolidating ${pkg.Id}"></span>`
              : html`
                  <custom-dropdown
                    class="version-dropdown"
                    ariaLabel="Target version for ${pkg.Id}"
                    .options=${pkg.Versions.map((v): DropdownOption => ({ value: v.Version, label: v.Version }))}
                    .value=${pkg.TargetVersion}
                    ?disabled=${this.isBusy}
                    @change=${(e: CustomEvent<string>) => {
                      pkg.TargetVersion = e.detail;
                      this.requestUpdate();
                    }}
                  ></custom-dropdown>
                  <button
                    class="icon-btn"
                    aria-label="Consolidate ${pkg.Id} to ${pkg.TargetVersion}"
                    title="Consolidate all projects to ${pkg.TargetVersion}"
                    ?disabled=${this.isBusy}
                    @click=${() => this.consolidateSingle(pkg)}
                  >
                    <span class="codicon codicon-merge"></span>
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
          <button
            class="icon-btn"
            aria-label="Refresh inconsistencies"
            title="Refresh"
            ?disabled=${this.isLoading || this.isBusy}
            @click=${() => this.LoadInconsistentPackages()}
          >
            <span class="codicon codicon-refresh"></span>
          </button>
          <span class="status-text" role="status" aria-live="polite">${this.statusText}</span>
          <div class="toolbar-right">
            ${this.packages.length > 0
              ? html`
                  <button
                    class="primary-btn"
                    ?disabled=${this.isBusy}
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
                <span>Failed to check for inconsistencies${this.errorText ? `: ${this.errorText}` : ""}</span>
                <button class="link-btn" @click=${() => this.LoadInconsistentPackages()}>Retry</button>
              </div>
            `
          : nothing}
        ${!this.isLoading && this.packages.length > 0
          ? html`
              <div class="package-list" role="list" aria-label="Inconsistent packages">
                ${repeat(this.packages, (pkg) => pkg.Id, (pkg) => this.renderPackageRow(pkg))}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
