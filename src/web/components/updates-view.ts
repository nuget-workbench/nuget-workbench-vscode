import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import codicon from "@/web/styles/codicon.css";
import { scrollableBase } from "@/web/styles/base.css";
import { sharedStyles } from "@/web/styles/shared.css";
import { hostApi } from "@/web/registrations";
import { OutdatedPackageViewModel, PackageViewModel } from "../types";
import "./package-row";

@customElement("updates-view")
export class UpdatesView extends LitElement {
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

      .updates-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        overflow: hidden;

        .outdated-row {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0 4px 0 2px;
          border-bottom: 1px solid var(--vscode-panelSection-border);

          &.updating {
            opacity: 0.6;
          }

          .row-checkbox {
            flex-shrink: 0;
          }

          package-row {
            flex: 1;
            min-width: 0;
          }

          .row-actions {
            display: flex;
            align-items: center;
            flex-shrink: 0;
          }
        }
      }
    `,
  ];

  @state() packages: OutdatedPackageViewModel[] = [];
  @state() isLoading: boolean = false;
  @state() isUpdating: boolean = false;
  @state() hasError: boolean = false;
  @state() errorText: string = "";
  @property({ type: Boolean }) prerelease: boolean = false;
  @state() statusText: string = "";
  @state() loadingText: string = "Checking for updates...";
  @property({ attribute: false }) projectPaths: string[] = [];
  @property() sourceUrl: string = "";

  private loaded = false;
  private loadSeq = 0;

  connectedCallback(): void {
    super.connectedCallback();
    if (!this.loaded) {
      this.loaded = true;
      this.LoadOutdatedPackages();
    }
  }

  private get isBusy(): boolean {
    return this.isUpdating || this.packages.some((p) => p.IsUpdating);
  }

  private get selectedCount(): number {
    return this.packages.filter((p) => p.Selected).length;
  }

  private emitCount(count: number | null): void {
    this.dispatchEvent(new CustomEvent<number | null>("count-changed", {
      detail: count,
      bubbles: true,
      composed: true,
    }));
  }

  private emitProjectsChanged(): void {
    this.dispatchEvent(new CustomEvent("projects-changed", { bubbles: true, composed: true }));
  }

  private updateStatusText(): void {
    const n = this.packages.length;
    this.statusText = n > 0 ? `${n} update${n !== 1 ? "s" : ""} available` : "";
  }

  async LoadOutdatedPackages(): Promise<void> {
    const seq = ++this.loadSeq;
    // Keep the user's selection across reloads (new packages default to selected)
    const previousSelection = new Map(this.packages.map((p) => [p.Id, p.Selected]));

    this.isLoading = true;
    this.hasError = false;
    this.errorText = "";
    this.statusText = "";
    this.packages = [];
    this.loadingText = "Checking for updates...";

    try {
      const result = await hostApi.getOutdatedPackages({
        Prerelease: this.prerelease,
        ProjectPaths: this.projectPaths.length > 0 ? this.projectPaths : undefined,
        SourceUrl: this.sourceUrl || undefined,
      });
      if (seq !== this.loadSeq) return;

      if (!result.ok) {
        this.hasError = true;
        this.errorText = result.error;
        this.emitCount(null);
      } else {
        this.packages = (result.value.Packages ?? []).map((p) => {
          const vm = new OutdatedPackageViewModel(p);
          vm.Selected = previousSelection.get(vm.Id) ?? true;
          return vm;
        });
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

  /**
   * Runs the batch update and returns the ids that were updated successfully.
   * Failed packages stay in the list with their error message.
   */
  private async runUpdates(packages: OutdatedPackageViewModel[]): Promise<Set<string>> {
    const succeeded = new Set<string>();
    packages.forEach((p) => {
      p.IsUpdating = true;
      p.Error = null;
    });
    this.requestUpdate();

    try {
      const result = await hostApi.batchUpdatePackages({
        Updates: packages.map((p) => ({
          PackageId: p.Id,
          Version: p.LatestVersion,
          ProjectPaths: p.Projects.map((proj) => proj.Path),
        })),
      });

      for (const pkg of packages) {
        if (!result.ok) {
          pkg.Error = result.error;
          continue;
        }
        const r = result.value.Results.find((x) => x.PackageId === pkg.Id);
        if (r?.Success) {
          succeeded.add(pkg.Id);
        } else {
          pkg.Error = r?.Error ?? "Update failed";
        }
      }
    } finally {
      packages.forEach((p) => (p.IsUpdating = false));
      this.requestUpdate();
    }
    return succeeded;
  }

  private applyResults(attempted: OutdatedPackageViewModel[], succeeded: Set<string>): void {
    this.packages = this.packages.filter((p) => !succeeded.has(p.Id));
    this.emitCount(this.packages.length);
    const failed = attempted.length - succeeded.size;
    this.updateStatusText();
    if (failed > 0) {
      this.statusText = `${failed} of ${attempted.length} update${attempted.length !== 1 ? "s" : ""} failed`;
    }
    if (succeeded.size > 0) {
      this.emitProjectsChanged();
    }
  }

  private async updateSingle(pkg: OutdatedPackageViewModel): Promise<void> {
    if (this.isBusy) return;
    this.statusText = `Updating ${pkg.Id}...`;
    const succeeded = await this.runUpdates([pkg]);
    this.applyResults([pkg], succeeded);
  }

  private async updateAllSelected(): Promise<void> {
    const selected = this.packages.filter((p) => p.Selected);
    if (selected.length === 0 || this.isBusy) return;

    const confirm = await hostApi.showConfirmation({
      Message: `Update ${selected.length} package${selected.length !== 1 ? "s" : ""}?`,
      Detail: selected.map((p) => `${p.Id}: ${p.InstalledVersion} -> ${p.LatestVersion}`).join("\n"),
    });
    if (!confirm.ok || !confirm.value.Confirmed) return;

    this.isUpdating = true;
    this.statusText = `Updating ${selected.length} package${selected.length !== 1 ? "s" : ""}...`;
    try {
      const succeeded = await this.runUpdates(selected);
      this.applyResults(selected, succeeded);
    } finally {
      this.isUpdating = false;
    }
  }

  private toggleSelectAll(checked: boolean): void {
    this.packages.forEach((p) => (p.Selected = checked));
    this.requestUpdate();
  }

  private toPackageViewModel(pkg: OutdatedPackageViewModel): PackageViewModel {
    return new PackageViewModel({
      Id: pkg.Id,
      Name: pkg.Id,
      IconUrl: "",
      Authors: [],
      Description: "",
      LicenseUrl: "",
      ProjectUrl: "",
      TotalDownloads: 0,
      Verified: false,
      Version: pkg.LatestVersion,
      InstalledVersion: pkg.InstalledVersion,
      Versions: [],
      Tags: [],
      Registration: "",
    }, "Detailed");
  }

  private renderPackageRow(pkg: OutdatedPackageViewModel): unknown {
    const projectList = pkg.Projects.map((p) => `${p.Name} (${p.Version})`).join("\n");
    return html`
      <div class="outdated-row ${pkg.IsUpdating ? "updating" : ""}" role="listitem" title=${projectList}>
        <input
          class="row-checkbox"
          type="checkbox"
          aria-label="Select ${pkg.Id} for update"
          .checked=${pkg.Selected}
          ?disabled=${this.isBusy}
          @change=${(e: Event) => {
            pkg.Selected = (e.target as HTMLInputElement).checked;
            this.requestUpdate();
          }}
        />
        <package-row
          .package=${this.toPackageViewModel(pkg)}
          .updateVersion=${pkg.LatestVersion}
          @click=${() => this.dispatchEvent(new CustomEvent("package-selected", {
            detail: { packageId: pkg.Id, sourceUrl: pkg.SourceUrl },
            bubbles: true,
            composed: true,
          }))}
        ></package-row>
        ${pkg.Error
          ? html`<span class="row-error" role="img" aria-label="Update failed: ${pkg.Error}" title=${pkg.Error}>
              <span class="codicon codicon-error"></span>
            </span>`
          : nothing}
        <div class="row-actions">
          ${pkg.IsUpdating
            ? html`<span class="spinner medium" role="status" aria-label="Updating ${pkg.Id}"></span>`
            : html`
                <button
                  class="icon-btn"
                  aria-label="Update ${pkg.Id} to ${pkg.LatestVersion}"
                  title="Update to ${pkg.LatestVersion}"
                  ?disabled=${this.isBusy}
                  @click=${() => this.updateSingle(pkg)}
                >
                  <span class="codicon codicon-arrow-circle-up"></span>
                </button>
              `}
        </div>
      </div>
    `;
  }

  render(): unknown {
    const selectedCount = this.selectedCount;
    const allSelected = this.packages.length > 0 && selectedCount === this.packages.length;
    const someSelected = selectedCount > 0 && !allSelected;

    return html`
      <div class="updates-container" aria-busy=${this.isLoading}>
        <div class="toolbar">
          ${this.packages.length > 0
            ? html`
                <input
                  type="checkbox"
                  class="select-all"
                  aria-label="Select all packages"
                  title=${allSelected ? "Deselect all" : "Select all"}
                  .checked=${allSelected}
                  .indeterminate=${someSelected}
                  ?disabled=${this.isBusy}
                  @change=${(e: Event) => this.toggleSelectAll((e.target as HTMLInputElement).checked)}
                />
              `
            : nothing}
          <button
            class="icon-btn"
            aria-label="Refresh updates"
            title="Refresh"
            ?disabled=${this.isLoading || this.isBusy}
            @click=${() => this.LoadOutdatedPackages()}
          >
            <span class="codicon codicon-refresh"></span>
          </button>
          <span class="status-text" role="status" aria-live="polite">${this.statusText}</span>
          <div class="toolbar-right">
            ${this.packages.length > 0
              ? html`
                  <button
                    class="primary-btn"
                    ?disabled=${this.isBusy || selectedCount === 0}
                    @click=${() => this.updateAllSelected()}
                  >
                    ${allSelected ? `Update All (${selectedCount})` : `Update Selected (${selectedCount})`}
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
                <span>Failed to check for updates${this.errorText ? `: ${this.errorText}` : ""}</span>
                <button class="link-btn" @click=${() => this.LoadOutdatedPackages()}>Retry</button>
              </div>
            `
          : nothing}
        ${!this.isLoading && this.packages.length > 0
          ? html`
              <div class="package-list" role="list" aria-label="Outdated packages">
                ${repeat(this.packages, (pkg) => pkg.Id, (pkg) => this.renderPackageRow(pkg))}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
