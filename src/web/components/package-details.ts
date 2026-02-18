import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import type { GetPackageDetailsRequest } from "@/common/rpc/types";
import { PackageViewModel } from "../types";
import codicon from "@/web/styles/codicon.css";
import { hostApi } from "../registrations";

@customElement("package-details")
export class PackageDetailsComponent extends LitElement {
  static styles = [
    codicon,
    css`
      .title {
      }

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

      .package-details {
        margin-left: 4px;
        display: grid;
        gap: 4px 20px;
        grid-template-columns: fit-content(100%) auto;
      }

      .dependencies {
        ul {
          margin: 4px 0px;
        }
      }

      .no-dependencies {
        margin-left: 20px;
        margin-top: 8px;
        span {
          vertical-align: middle;
        }
      }
    `,
  ];

  @property({ attribute: false }) package: PackageViewModel | null = null;
  @property() packageVersionUrl: string = "";
  @property() source: string = "";
  @property() passwordScriptPath?: string;

  @state() packageDetailsLoading: boolean = false;
  @state() packageDetails?: PackageDetails;

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

  private renderDependencies(): unknown {
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
                  ${fw}
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
        <span> No dependencies</span>
      </div>
    `;
  }

  render(): unknown {
    return html`
      <expandable-container title="Info" summary=${this.package?.Description ?? ""}>
        <div class="package-details">
          <span class="title">Author(s):</span>
          <span>${this.package?.Authors}</span>

          ${this.package?.LicenseUrl
            ? html`
                <span class="title">License:</span>
                <a href=${this.package.LicenseUrl} style="color: var(--vscode-textLink-foreground);"
                  >View License</a
                >
              `
            : nothing}
          ${this.package?.ProjectUrl
            ? html`
                <span class="title">Project Url:</span>
                <a href=${this.package.ProjectUrl} style="color: var(--vscode-textLink-foreground);"
                  >View Project</a
                >
              `
            : nothing}
          ${this.package?.Tags
            ? html`
                <span class="title">Tags:</span>
                <span>${this.package.Tags}</span>
              `
            : nothing}
        </div>
      </expandable-container>

      <expandable-container title="Dependencies" expanded>
        ${this.renderDependencies()}
      </expandable-container>
    `;
  }
}
