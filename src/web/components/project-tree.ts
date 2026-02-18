import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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
  @state() selectedPaths: string[] = [];
  @state() allChecked: boolean = true;
  @state() isIndeterminate: boolean = false;

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has("projects")) {
      this.selectedPaths = this.projects.map((p) => p.Path);
      this.syncCheckboxState();
    }
    if (changedProperties.has("selectedPaths")) {
      this.syncCheckboxState();
    }
  }

  private syncCheckboxState(): void {
    const total = this.projects.length;
    const selected = this.selectedPaths.length;
    this.allChecked = total > 0 && selected === total;
    this.isIndeterminate = selected > 0 && selected < total;
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
