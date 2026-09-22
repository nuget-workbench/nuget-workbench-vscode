import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import codicon from "@/web/styles/codicon.css";

export interface DropdownOption {
  value: string;
  label: string;
}

@customElement("custom-dropdown")
export class CustomDropdown extends LitElement {
  static styles = [
    codicon,
    css`
      :host {
        display: inline-block;
        position: relative;
      }

      .dropdown-trigger {
        display: flex;
        align-items: center;
        gap: 4px;
        background-color: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        padding: 4px 8px;
        font-size: inherit;
        font-family: inherit;
        border-radius: 2px;
        cursor: pointer;
        outline: none;
        white-space: nowrap;
        min-width: 0;
      }

      .dropdown-trigger:focus {
        border-color: var(--vscode-focusBorder);
      }

      .dropdown-trigger:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .dropdown-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: left;
      }

      .dropdown-chevron {
        flex-shrink: 0;
        font-size: 10px;
        opacity: 0.7;
      }

      .dropdown-menu {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        min-width: 100%;
        max-height: 200px;
        overflow-y: auto;
        z-index: 100;
        background-color: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        border-top: none;
        border-radius: 0 0 2px 2px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .dropdown-option {
        padding: 4px 8px;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: inherit;
        color: var(--vscode-dropdown-foreground);
      }

      .dropdown-option:hover,
      .dropdown-option.active {
        background-color: var(--vscode-list-hoverBackground);
      }

      .dropdown-option.active {
        outline: 1px solid var(--vscode-list-focusOutline, var(--vscode-focusBorder));
        outline-offset: -1px;
      }

      .dropdown-option.selected {
        background-color: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
      }
    `,
  ];

  @property({ attribute: false }) options: DropdownOption[] = [];
  @property() value: string = "";
  @property() ariaLabel: string = "";
  @property({ type: Boolean, reflect: true }) disabled: boolean = false;

  @state() private open: boolean = false;
  @state() private activeIndex: number = -1;

  private static nextId = 0;
  private readonly menuId = `dropdown-menu-${CustomDropdown.nextId++}`;

  private get selectedLabel(): string {
    return this.options.find((o) => o.value === this.value)?.label ?? this.value;
  }

  private openMenu(): void {
    if (this.disabled || this.options.length === 0) return;
    this.open = true;
    const selected = this.options.findIndex((o) => o.value === this.value);
    this.activeIndex = selected >= 0 ? selected : 0;
    this.addOutsideClickListener();
  }

  private closeMenu(): void {
    this.open = false;
    this.activeIndex = -1;
    this.removeOutsideClickListener();
  }

  private toggle(): void {
    if (this.open) {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  }

  private select(value: string): void {
    this.closeMenu();
    if (value !== this.value) {
      this.value = value;
      this.dispatchEvent(
        new CustomEvent("change", {
          detail: value,
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  private moveActive(index: number): void {
    if (this.options.length === 0) return;
    this.activeIndex = Math.max(0, Math.min(this.options.length - 1, index));
  }

  private onKeydown(e: KeyboardEvent): void {
    if (this.disabled) return;

    if (!this.open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        this.openMenu();
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        this.closeMenu();
        e.preventDefault();
        e.stopPropagation();
        break;
      case "ArrowDown":
        this.moveActive(this.activeIndex + 1);
        e.preventDefault();
        break;
      case "ArrowUp":
        this.moveActive(this.activeIndex - 1);
        e.preventDefault();
        break;
      case "Home":
        this.moveActive(0);
        e.preventDefault();
        break;
      case "End":
        this.moveActive(this.options.length - 1);
        e.preventDefault();
        break;
      case "Enter":
      case " ": {
        const opt = this.options[this.activeIndex];
        if (opt) {
          this.select(opt.value);
        } else {
          this.closeMenu();
        }
        e.preventDefault();
        break;
      }
      case "Tab":
        this.closeMenu();
        break;
    }
  }

  private onFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (this.open && (!next || !this.shadowRoot?.contains(next))) {
      this.closeMenu();
    }
  }

  protected updated(changed: Map<string, unknown>): void {
    if ((changed.has("activeIndex") || changed.has("open")) && this.open && this.activeIndex >= 0) {
      const el = this.shadowRoot?.getElementById(`${this.menuId}-opt-${this.activeIndex}`);
      el?.scrollIntoView?.({ block: "nearest" });
    }
    if (changed.has("disabled") && this.disabled && this.open) {
      this.closeMenu();
    }
  }

  private outsideClickHandler = (e: MouseEvent) => {
    const path = e.composedPath();
    if (!path.includes(this)) {
      this.closeMenu();
    }
  };

  private addOutsideClickListener(): void {
    document.addEventListener("click", this.outsideClickHandler, true);
  }

  private removeOutsideClickListener(): void {
    document.removeEventListener("click", this.outsideClickHandler, true);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeOutsideClickListener();
  }

  render(): unknown {
    const activeId = this.open && this.activeIndex >= 0 ? `${this.menuId}-opt-${this.activeIndex}` : "";
    return html`
      <button
        class="dropdown-trigger"
        role="combobox"
        aria-expanded=${this.open}
        aria-haspopup="listbox"
        aria-controls=${this.menuId}
        aria-activedescendant=${activeId || nothing}
        aria-label=${this.ariaLabel}
        title=${this.selectedLabel}
        ?disabled=${this.disabled}
        @click=${() => this.toggle()}
        @keydown=${(e: KeyboardEvent) => this.onKeydown(e)}
        @focusout=${(e: FocusEvent) => this.onFocusOut(e)}
      >
        <span class="dropdown-label">${this.selectedLabel}</span>
        <span class="dropdown-chevron codicon codicon-chevron-down"></span>
      </button>
      ${this.open
        ? html`
            <div class="dropdown-menu" role="listbox" id=${this.menuId} aria-label=${this.ariaLabel}>
              ${this.options.map(
                (opt, i) => html`
                  <div
                    id="${this.menuId}-opt-${i}"
                    class="dropdown-option ${opt.value === this.value ? "selected" : ""} ${i === this.activeIndex ? "active" : ""}"
                    role="option"
                    aria-selected=${opt.value === this.value}
                    @mousedown=${(e: MouseEvent) => e.preventDefault()}
                    @mouseenter=${() => (this.activeIndex = i)}
                    @click=${() => this.select(opt.value)}
                  >
                    ${opt.label}
                  </div>
                `
              )}
            </div>
          `
        : nothing}
    `;
  }
}
