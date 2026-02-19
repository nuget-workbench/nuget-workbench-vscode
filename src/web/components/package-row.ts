import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PackageViewModel } from "../types";
import codicon from "@/web/styles/codicon.css";

const DEFAULT_ICON_URL = "https://nuget.org/Content/gallery/img/default-package-icon.svg";

const styles = css`
  .package-row {
    margin: 2px;
    padding: 4px 3px;
    display: flex;
    gap: 6px;
    align-items: flex-start;
    cursor: default;

    &.package-row-selected {
      background-color: var(--vscode-list-inactiveSelectionBackground);
    }

    &.package-row-error {
      .name,
      .package-version {
        color: var(--vscode-errorForeground);
      }
    }

    &:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    &:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .icon {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .package-content {
      flex: 1;
      overflow: hidden;
      min-width: 0;
    }

    .package-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
    }

    .name-line {
      display: flex;
      align-items: center;
      gap: 4px;
      overflow: hidden;
      flex: 1;
      min-width: 0;
    }

    .name {
      font-weight: bold;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .authors {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .package-version {
      font-weight: bold;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;

      .spinner {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid var(--vscode-progressBar-background);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
    }

    .description {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 1px;
    }

    .meta-line {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }

    .downloads {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .verified-badge {
      color: var(--vscode-charts-blue, #3794ff);
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

@customElement("package-row")
export class PackageRow extends LitElement {
  static styles = [codicon, styles];

  @property({ type: Boolean }) showInstalledVersion!: boolean;
  @property({ type: Object }) package!: PackageViewModel;
  @state() iconUrl: string | null = null;

  get resolvedIconUrl(): string {
    if (!this.package?.IconUrl) {
      return DEFAULT_ICON_URL;
    }
    return this.iconUrl ?? this.package.IconUrl;
  }

  private onIconError(): void {
    this.iconUrl = DEFAULT_ICON_URL;
  }

  private formatDownloads(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return count.toString();
  }

  private renderVersionContent() {
    if (!this.showInstalledVersion) {
      return html`${this.package.Version}`;
    }

    const hasUpdate =
      this.package.Status === "Detailed" &&
      this.package.Version !== this.package.InstalledVersion &&
      this.package.AllowsUpdate;

    return html`
      ${this.package.InstalledVersion}
      ${this.package.Status === "MissingDetails"
        ? html`<span class="spinner"></span>`
        : nothing}
      ${this.package.Status === "Error"
        ? html`<span
            class="codicon codicon-error"
            title="Failed to fetch package information"
          ></span>`
        : nothing}
      ${hasUpdate
        ? html`<span class="codicon codicon-arrow-circle-up"></span>`
        : nothing}
    `;
  }

  render() {
    if (!this.package) {
      return nothing;
    }

    return html`
      <div
        class="package-row ${this.package.Selected ? "package-row-selected" : ""} ${this.package.Status === "Error" ? "package-row-error" : ""}"
        role="option"
        tabindex="0"
        aria-selected=${this.package.Selected ? "true" : "false"}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
          }
        }}
      >
        <img
          class="icon"
          alt=""
          src=${this.resolvedIconUrl}
          @error=${() => this.onIconError()}
        />
        <div class="package-content">
          <div class="package-header">
            <div class="name-line">
              <span class="name">${this.package.Name}</span>
              ${this.package.Verified
                ? html`<span class="codicon codicon-verified-filled verified-badge" title="Verified owner"></span>`
                : nothing}
              ${this.package.Authors
                ? html`<span class="authors">by ${this.package.Authors}</span>`
                : nothing}
            </div>
            <div class="package-version">${this.renderVersionContent()}</div>
          </div>
          ${this.package.Description
            ? html`<div class="description">${this.package.Description}</div>`
            : nothing}
          ${this.package.TotalDownloads > 0
            ? html`
                <div class="meta-line">
                  <span class="downloads">
                    <span class="codicon codicon-cloud-download"></span>
                    ${this.formatDownloads(this.package.TotalDownloads)}
                  </span>
                </div>
              `
            : nothing}
        </div>
      </div>
    `;
  }
}
