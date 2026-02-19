import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import codicon from "@/web/styles/codicon.css";
import { hostApi } from "@/web/registrations";

export type LicenseRequest = {
  packageId: string;
  version: string;
  licenseUrl: string;
};

@customElement("nuget-license-dialog")
export class NugetLicenseDialog extends LitElement {
  static styles = [
    codicon,
    css`
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .dialog {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        padding: 16px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      }

      .dialog-title {
        font-size: 14px;
        font-weight: bold;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .dialog-body {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 16px;
        line-height: 1.6;
      }

      .package-list {
        margin: 8px 0;
        max-height: 200px;
        overflow-y: auto;
      }

      .package-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 12px;
        border-bottom: 1px solid var(--vscode-panelSection-border);
      }

      .package-item:last-child {
        border-bottom: none;
      }

      .package-name {
        font-weight: bold;
        color: var(--vscode-foreground);
      }

      .license-link {
        color: var(--vscode-textLink-foreground);
        cursor: pointer;
        text-decoration: none;
        font-size: 11px;
      }

      .license-link:hover {
        text-decoration: underline;
      }

      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      button {
        padding: 6px 14px;
        border: none;
        cursor: pointer;
        font-size: 12px;
      }

      button.primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }

      button.primary:hover {
        background: var(--vscode-button-hoverBackground);
      }

      button.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }

      button.secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
    `,
  ];

  @state() isOpen: boolean = false;
  @state() requests: LicenseRequest[] = [];

  private resolvePromise: ((accepted: boolean) => void) | null = null;

  requestAcceptance(requests: LicenseRequest[]): Promise<boolean> {
    this.requests = requests;
    this.isOpen = true;

    return new Promise<boolean>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  private accept(): void {
    this.isOpen = false;
    this.resolvePromise?.(true);
    this.resolvePromise = null;
  }

  private decline(): void {
    this.isOpen = false;
    this.resolvePromise?.(false);
    this.resolvePromise = null;
  }

  private openLicenseUrl(url: string): void {
    hostApi.openUrl({ Url: url });
  }

  render() {
    if (!this.isOpen) return nothing;

    return html`
      <div class="overlay" @click=${() => this.decline()}>
        <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="dialog-title">
            <span class="codicon codicon-law"></span>
            License Acceptance Required
          </div>
          <div class="dialog-body">
            The following package${this.requests.length > 1 ? "s" : ""} require${this.requests.length === 1 ? "s" : ""}
            license acceptance before installation:
            <div class="package-list">
              ${this.requests.map(
                (req) => html`
                  <div class="package-item">
                    <span class="package-name">${req.packageId} ${req.version}</span>
                    ${req.licenseUrl
                      ? html`
                          <a
                            class="license-link"
                            @click=${(e: Event) => { e.preventDefault(); this.openLicenseUrl(req.licenseUrl); }}
                            href=${req.licenseUrl}
                          >
                            View License
                          </a>
                        `
                      : nothing}
                  </div>
                `
              )}
            </div>
            By clicking "I Accept", you agree to the license terms for the listed packages.
          </div>
          <div class="dialog-actions">
            <button class="secondary" @click=${() => this.decline()}>Decline</button>
            <button class="primary" @click=${() => this.accept()}>I Accept</button>
          </div>
        </div>
      </div>
    `;
  }
}
