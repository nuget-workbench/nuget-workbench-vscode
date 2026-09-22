import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import codicon from "@/web/styles/codicon.css";
import { sharedStyles } from "@/web/styles/shared.css";
import { hostApi } from "../registrations";
import { ProjectPackageViewModel, ProjectViewModel } from "../types";
import type { UpdateProjectRequest } from "@/common/rpc/types";
import { compareVersions } from "@/common/version";

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
      white-space: nowrap;
      min-width: 0;
      .name {
        font-weight: bold;
      }
    }

    .project-actions {
      display: flex;
      gap: 3px;
      align-items: center;

      .spinner {
        margin: 3px;
      }

      .version {
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
      }

      .row-error {
        cursor: help;
      }
    }
  }
`;

@customElement("project-row")
export class ProjectRow extends LitElement {
  static styles = [codicon, sharedStyles, styles];

  @property({ type: Object }) project!: ProjectViewModel;
  @property() packageId!: string;
  @property() packageVersion!: string;
  @property() sourceUrl!: string;
  @state() private loaders = new Map<string, boolean>();
  @state() private errors = new Map<string, string>();

  get projectPackage() {
    const id = this.packageId?.toLowerCase();
    return this.project.Packages.find((x) => x.Id.toLowerCase() === id);
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
    this.errors.delete(request.PackageId);
    this.requestUpdate();

    const result = await hostApi.updateProject(request);
    if (!result.ok) {
      this.errors.set(request.PackageId, result.error);
    } else {
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
      return html`<span class="spinner medium" role="status" aria-label="Working on ${this.packageId}"></span>`;
    }

    const error = this.errors.get(this.packageId);
    const errorIcon = error
      ? html`<span class="row-error" role="img" aria-label="Operation failed: ${error}" title=${error}>
          <span class="codicon codicon-error"></span>
        </span>`
      : nothing;

    const pkg = this.projectPackage;
    const version = pkg?.Version;
    const target = this.packageVersion;

    if (pkg === undefined) {
      return html`
        ${errorIcon}
        <button
          class="icon-btn"
          aria-label="Install ${this.packageId}${target ? ` ${target}` : ""} in ${this.project.Name}"
          title=${target ? `Install ${target}` : "Install"}
          @click=${() => this.update_("INSTALL")}
        >
          <span class="codicon codicon-diff-added"></span>
        </button>
      `;
    }

    const canChange = !!version && !!target && version !== target && !pkg.IsPinned;
    const isDowngrade = canChange && compareVersions(target, version!) < 0;

    return html`
      ${errorIcon}
      <span class="version" title=${pkg.IsPinned ? "Pinned version" : ""}>${version}</span>
      ${canChange
        ? html`
            <button
              class="icon-btn"
              aria-label="${isDowngrade ? "Downgrade" : "Update"} ${this.packageId} to ${target} in ${this.project.Name}"
              title="${isDowngrade ? "Downgrade" : "Update"} to ${target}"
              @click=${() => this.update_("UPDATE")}
            >
              <span class="codicon ${isDowngrade ? "codicon-arrow-circle-down" : "codicon-arrow-circle-up"}"></span>
            </button>
          `
        : nothing}
      <button
        class="icon-btn"
        aria-label="Uninstall ${this.packageId} from ${this.project.Name}"
        title="Uninstall"
        @click=${() => this.update_("UNINSTALL")}
      >
        <span class="codicon codicon-diff-removed"></span>
      </button>
    `;
  }

  render() {
    return html`
      <div class="project-row">
        <div class="project-title" title=${this.project.Path}>
          <span class="name">${this.project.Name}</span>
        </div>
        <div class="project-actions">${this.renderActions()}</div>
      </div>
    `;
  }
}
