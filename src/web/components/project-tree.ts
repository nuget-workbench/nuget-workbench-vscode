import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import codicon from "@/web/styles/codicon.css";
import { scrollableBase } from "@/web/styles/base.css";
import { ProjectViewModel } from "../types";

const styles = css`
  .tree-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: 12px;

    .tree-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 6px;
      border-bottom: 1px solid var(--vscode-panelSection-border);
      font-weight: bold;

      .header-label {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
      }

      .header-count {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        padding-right: 4px;
      }
    }

    .tree-list {
      overflow-y: auto;
      flex: 1;
    }

    .tree-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px 2px 12px;
      cursor: default;

      &:hover {
        background-color: var(--vscode-list-hoverBackground);
      }

      .codicon {
        font-size: 14px;
        color: var(--vscode-descriptionForeground);
        flex-shrink: 0;
      }

      .item-label {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 11px;
      }
    }
  }
`;

@customElement("project-tree")
export class ProjectTree extends LitElement {
  static styles = [codicon, scrollableBase, styles];

  @property({ type: Array }) projects: ProjectViewModel[] = [];
  /** Controlled by the parent so the selection survives re-renders and reloads. */
  @property({ attribute: false }) selectedPaths: string[] = [];

  private get allChecked(): boolean {
    const total = this.projects.length;
    return total > 0 && this.projects.every((p) => this.selectedPaths.includes(p.Path));
  }

  private get isIndeterminate(): boolean {
    return this.selectedPaths.length > 0 && !this.allChecked;
  }

  OnSelectAllChanged(_checked: boolean): void {
    if (this.allChecked) {
      this.selectedPaths = [];
    } else {
      this.selectedPaths = this.projects.map((p) => p.Path);
    }
    this.emitSelectionChanged();
  }

  OnItemChanged(path: string, checked: boolean): void {
    if (checked) {
      this.selectedPaths = [...this.selectedPaths, path];
    } else {
      this.selectedPaths = this.selectedPaths.filter((p) => p !== path);
    }
    this.emitSelectionChanged();
  }

  private emitSelectionChanged(): void {
    this.dispatchEvent(
      new CustomEvent("selection-changed", {
        detail: this.selectedPaths,
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    return html`
      <div class="tree-container" role="group" aria-label="Project selection">
        <div class="tree-header">
          <input
            type="checkbox"
            aria-label="Select all projects"
            .checked=${this.allChecked}
            .indeterminate=${this.isIndeterminate}
            @change=${(e: Event) =>
              this.OnSelectAllChanged((e.target as HTMLInputElement).checked)}
          />
          <span class="header-label">All Projects</span>
          <span class="header-count">${this.selectedPaths.length}/${this.projects.length}</span>
        </div>
        <div class="tree-list" role="list">
          ${this.projects.map(
            (p) => html`
              <div class="tree-item" role="listitem">
                <input
                  type="checkbox"
                  aria-label="Select ${p.Name}"
                  .checked=${this.selectedPaths.includes(p.Path)}
                  @change=${(e: Event) =>
                    this.OnItemChanged(
                      p.Path,
                      (e.target as HTMLInputElement).checked
                    )}
                />
                <span class="codicon codicon-file-code"></span>
                <span class="item-label" title=${p.Path}>${p.Name}</span>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }
}
