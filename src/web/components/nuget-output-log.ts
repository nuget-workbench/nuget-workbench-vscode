import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import codicon from "@/web/styles/codicon.css";

export type LogEntry = {
  text: string;
  level: "info" | "warning" | "error" | "success";
  timestamp: number;
};

@customElement("nuget-output-log")
export class NugetOutputLog extends LitElement {
  static styles = [
    codicon,
    css`
      :host {
        display: block;
      }

      .log-container {
        border-top: 1px solid var(--vscode-panelSection-border);
        display: flex;
        flex-direction: column;
        max-height: 200px;
        overflow: hidden;
      }

      .log-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2px 6px;
        cursor: pointer;
        user-select: none;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .log-header:hover {
        background-color: var(--vscode-list-hoverBackground);
      }

      .log-header-left {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .log-header-right {
        display: flex;
        align-items: center;
        gap: 4px;
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

      .log-content {
        overflow-y: auto;
        max-height: 160px;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        padding: 4px 8px;
      }

      .log-entry {
        padding: 1px 0;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .log-entry.info {
        color: var(--vscode-foreground);
      }

      .log-entry.warning {
        color: var(--vscode-editorWarning-foreground);
      }

      .log-entry.error {
        color: var(--vscode-errorForeground);
      }

      .log-entry.success {
        color: var(--vscode-charts-green, #10b981);
      }

      .badge {
        font-size: 10px;
        padding: 0 4px;
        border-radius: 8px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        min-width: 14px;
        text-align: center;
      }

      .progress-bar {
        height: 2px;
        background: var(--vscode-progressBar-background);
        transition: width 0.3s ease;
      }
    `,
  ];

  @state() entries: LogEntry[] = [];
  @state() isExpanded: boolean = false;
  @state() isRunning: boolean = false;
  @state() progress: number = 0;

  addEntry(text: string, level: LogEntry["level"] = "info"): void {
    this.entries = [
      ...this.entries,
      { text, level, timestamp: Date.now() },
    ];
    if (level === "error") {
      this.isExpanded = true;
    }
    this.updateComplete.then(() => {
      const content = this.shadowRoot?.querySelector(".log-content");
      if (content) {
        content.scrollTop = content.scrollHeight;
      }
    });
  }

  setProgress(percent: number): void {
    this.progress = Math.max(0, Math.min(100, percent));
    this.isRunning = percent > 0 && percent < 100;
  }

  clear(): void {
    this.entries = [];
    this.progress = 0;
    this.isRunning = false;
  }

  private toggle(): void {
    this.isExpanded = !this.isExpanded;
  }

  render() {
    if (this.entries.length === 0 && !this.isRunning) {
      return nothing;
    }

    const errorCount = this.entries.filter((e) => e.level === "error").length;

    return html`
      <div class="log-container">
        ${this.isRunning
          ? html`<div class="progress-bar" style="width: ${this.progress}%"></div>`
          : nothing}
        <div class="log-header" @click=${() => this.toggle()}>
          <div class="log-header-left">
            <span
              class="codicon ${this.isExpanded ? "codicon-chevron-down" : "codicon-chevron-right"}"
            ></span>
            <span>Output</span>
            ${errorCount > 0
              ? html`<span class="badge">${errorCount}</span>`
              : nothing}
          </div>
          <div class="log-header-right">
            <button
              class="icon-btn"
              aria-label="Clear output"
              title="Clear"
              @click=${(e: Event) => { e.stopPropagation(); this.clear(); }}
            >
              <span class="codicon codicon-clear-all"></span>
            </button>
          </div>
        </div>
        ${this.isExpanded
          ? html`
              <div class="log-content" role="log" aria-live="polite">
                ${this.entries.map(
                  (entry) => html`
                    <div class="log-entry ${entry.level}">${entry.text}</div>
                  `
                )}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
