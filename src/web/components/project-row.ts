import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import codicon from "@/web/styles/codicon.css";
import { hostApi } from "../registrations";
import { ProjectPackageViewModel, ProjectViewModel } from "../types";
import type { UpdateProjectRequest } from "@/common/rpc/types";

const styles = css`
  .project-row {
    margin: 2px;
    padding: 3px;
    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: space-between;
    cursor: default;

    &:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .project-title {
      overflow: hidden;
      text-overflow: ellipsis;
      .name {
        font-weight: bold;
      }
    }

    .project-actions {
      display: flex;
      gap: 3px;
      align-items: center;

      .spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        margin: 3px;
        border: 2px solid var(--vscode-progressBar-background);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      .icon-btn {
        background: transparent;
        border: none;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        padding: 2px;
        display: flex;
        align-items: center;
      }
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

@customElement("project-row")
export class ProjectRow extends LitElement {
  static styles = [codicon, styles];

  @property({ type: Object }) project!: ProjectViewModel;
  @property() packageId!: string;
  @property() packageVersion!: string;
  @property() sourceUrl!: string;
  @state() private loaders = new Map<string, boolean>();

  get projectPackage() {
    return this.project.Packages.find((x) => x.Id === this.packageId);
  }

  private async update_(type: "INSTALL" | "UNINSTALL" | "UPDATE"): Promise<void> {
    if (type === "UNINSTALL") {
      const confirm = await hostApi.showConfirmation({
        Message: `Uninstall ${this.packageId}?`,
        Detail: `This will remove ${this.packageId} from ${this.project.Name}.`,
      });
      if (!confirm.ok || !confirm.value.Confirmed) return;
    }

    const request: UpdateProjectRequest = {
      Type: type,
      ProjectPath: this.project.Path,
      PackageId: this.packageId,
      Version: this.packageVersion,
      SourceUrl: this.sourceUrl,
    };

    this.loaders.set(request.PackageId, true);
    this.requestUpdate();

    const result = await hostApi.updateProject(request);
    if (result.ok) {
      this.project.Packages = result.value.Project.Packages.map(
        (x) => new ProjectPackageViewModel(x)
      );
      this.dispatchEvent(
        new CustomEvent("project-updated", {
          detail: { isCpmEnabled: result.value.IsCpmEnabled },
          bubbles: true,
          composed: true,
        })
      );
    }

    this.loaders.delete(request.PackageId);
    this.requestUpdate();
  }

  private renderActions() {
    if (this.loaders.get(this.packageId) === true) {
      return html`<span class="spinner" role="status" aria-label="Loading"></span>`;
    }

    const pkg = this.projectPackage;
    const version = pkg?.Version;

    if (pkg === undefined) {
      return html`
        <button class="icon-btn" aria-label="Install package" title="Install" @click=${() => this.update_("INSTALL")}>
          <span class="codicon codicon-diff-added"></span>
        </button>
      `;
    }

    const showUpdate =
      version !== this.packageVersion &&
      version !== undefined &&
      !pkg.IsPinned;

    return html`
      <span class="version">${version}</span>
      ${showUpdate
        ? html`
            <button class="icon-btn" aria-label="Update package" title="Update" @click=${() => this.update_("UPDATE")}>
              <span class="codicon codicon-arrow-circle-up"></span>
            </button>
          `
        : nothing}
      <button class="icon-btn" aria-label="Uninstall package" title="Uninstall" @click=${() => this.update_("UNINSTALL")}>
        <span class="codicon codicon-diff-removed"></span>
      </button>
    `;
  }

  render() {
    return html`
      <div class="project-row">
        <div class="project-title">
          <span class="name">${this.project.Name}</span>
        </div>
        <div class="project-actions">${this.renderActions()}</div>
      </div>
    `;
  }
}
