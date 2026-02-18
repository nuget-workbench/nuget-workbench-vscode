import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PackageViewModel } from "../types";
import codicon from "@/web/styles/codicon.css";

const DEFAULT_ICON_URL = "https://nuget.org/Content/gallery/img/default-package-icon.svg";

const styles = css`
  .package-row {
    margin: 2px;
    padding: 3px;
    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: space-between;
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

    .package-title {
      display: flex;
      gap: 4px;
      align-items: center;
      flex: 1;
      overflow: hidden;
      .title {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .icon {
        width: 18px;
        height: 18px;
      }
      .name {
        font-weight: bold;
      }
    }

    .package-version {
      font-weight: bold;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 3px;

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
        <div class="package-title">
          <img
            class="icon"
            alt=""
            src=${this.resolvedIconUrl}
            @error=${() => this.onIconError()}
          />
          <div class="title">
            <span class="name">${this.package.Name}</span>
            ${this.package.Authors
              ? html`<span class="authors">@${this.package.Authors}</span>`
              : nothing}
          </div>
        </div>
        <div class="package-version">${this.renderVersionContent()}</div>
      </div>
    `;
  }
}
