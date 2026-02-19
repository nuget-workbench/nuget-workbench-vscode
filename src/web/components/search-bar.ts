import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import codicon from "@/web/styles/codicon.css";
import { configuration, hostApi } from "../registrations";
import lodash from "lodash";

const styles = css`
  .search-bar {
    display: flex;
    gap: 10px;
    justify-content: space-between;
    margin-bottom: 10px;

    .search-bar-left {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 6px;

      .search-input {
        flex: 1;
        max-width: 340px;
        min-width: 140px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        padding: 4px 8px;
        font-size: inherit;
        font-family: inherit;
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

      .checkbox-label {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        white-space: nowrap;
      }
    }

    .search-bar-right {
      display: flex;
      gap: 10px;

      select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        padding: 4px;
        font-size: inherit;
        font-family: inherit;
      }
    }
  }
`;

export type SortOption = "relevance" | "downloads" | "recent" | "name-asc";

export type FilterEvent = {
  Query: string;
  Prerelease: boolean;
  SourceUrl: string;
  Sort: SortOption;
};

@customElement("search-bar")
export class SearchBar extends LitElement {
  static styles = [codicon, styles];

  private delayedPackagesLoader = lodash.debounce(() => this.emitFilterChangedEvent(), 500);
  @state() prerelease: boolean = false;
  @state() filterQuery: string = "";
  @state() selectedSourceUrl: string = "";
  @state() sortBy: SortOption = "relevance";

  connectedCallback(): void {
    super.connectedCallback();
    this.selectedSourceUrl = "";
    this.prerelease = configuration.Configuration?.Prerelease ?? false;
    this.emitFilterChangedEvent();
  }

  private async prereleaseChangedEvent(target: EventTarget): Promise<void> {
    this.prerelease = (target as HTMLInputElement).checked;
    await this.savePrereleaseToConfiguration();
    this.emitFilterChangedEvent();
  }

  private async savePrereleaseToConfiguration(): Promise<void> {
    const config = configuration.Configuration;
    if (!config) return;

    await hostApi.updateConfiguration({
      Configuration: {
        SkipRestore: config.SkipRestore,
        EnablePackageVersionInlineInfo: config.EnablePackageVersionInlineInfo,
        Prerelease: this.prerelease,
        Sources: config.Sources,
        StatusBarLoadingIndicator: config.StatusBarLoadingIndicator,
      },
    });
    await configuration.Reload();
  }

  private filterInputEvent(target: EventTarget): void {
    this.filterQuery = (target as HTMLInputElement).value;
    this.delayedPackagesLoader();
  }

  private selectSource(url: string): void {
    this.selectedSourceUrl = url;
    this.emitFilterChangedEvent();
  }

  private sortChanged(value: string): void {
    this.sortBy = value as SortOption;
    this.emitFilterChangedEvent();
  }

  setSearchQuery(query: string): void {
    this.filterQuery = query;
    const input = this.shadowRoot?.querySelector(".search-input") as HTMLInputElement;
    if (input) input.value = query;
    this.emitFilterChangedEvent();
  }

  private reloadClicked(): void {
    const forceReload = true;
    this.dispatchEvent(
      new CustomEvent("reload-invoked", {
        detail: forceReload,
        bubbles: true,
        composed: true,
      })
    );
  }

  private emitFilterChangedEvent(): void {
    const filterEvent: FilterEvent = {
      Query: this.filterQuery,
      Prerelease: this.prerelease,
      SourceUrl: this.selectedSourceUrl,
      Sort: this.sortBy,
    };
    this.dispatchEvent(
      new CustomEvent("filter-changed", {
        detail: filterEvent,
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const sources = configuration.Configuration?.Sources ?? [];

    return html`
      <div class="search-bar">
        <div class="search-bar-left">
          <input
            type="text"
            class="search-input"
            placeholder="Search packages..."
            aria-label="Search packages"
            @input=${(e: Event) => this.filterInputEvent(e.target!)}
          />
          <button class="icon-btn" aria-label="Reload packages" title="Reload" @click=${() => this.reloadClicked()}>
            <span class="codicon codicon-refresh"></span>
          </button>
          <label class="checkbox-label">
            <input
              type="checkbox"
              .checked=${this.prerelease}
              @change=${(e: Event) => this.prereleaseChangedEvent(e.target!)}
            />
            Prerelease
          </label>
        </div>
        <div class="search-bar-right">
          <select
            aria-label="Sort by"
            .value=${this.sortBy}
            @change=${(e: Event) =>
              this.sortChanged((e.target as HTMLSelectElement).value)}
          >
            <option value="relevance">Relevance</option>
            <option value="downloads">Downloads</option>
            <option value="recent">Recently Updated</option>
            <option value="name-asc">Name A-Z</option>
          </select>
          <select
            aria-label="Package source"
            .value=${this.selectedSourceUrl}
            @change=${(e: Event) =>
              this.selectSource((e.target as HTMLSelectElement).value)}
          >
            <option value="">All</option>
            ${sources.map(
              (source) =>
                html`<option value=${source.Url}>${source.Name}</option>`
            )}
          </select>
        </div>
      </div>
    `;
  }
}
