import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import codicon from "@/web/styles/codicon.css";

const styles = css`
  .expandable {
    display: grid;
    grid-template-columns: fit-content(100%) auto;
    gap: 4px 20px;
    padding: 3px;
    margin: 1px;
    cursor: pointer;

    &.collapsed {
      text-wrap: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .title {
      font-weight: bold;
    }
    span {
      vertical-align: middle;
    }

    .summary {
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .content {
    margin: 3px;
    margin-left: 20px;
  }
`;

@customElement("expandable-container")
export class ExpandableContainer extends LitElement {
  static styles = [styles, codicon];

  @property() title: string = "";
  @property() summary: string = "";
  @property({ type: Boolean }) expanded: boolean = false;
  @state() isExpanded: boolean = false;

  connectedCallback(): void {
    super.connectedCallback();
    this.isExpanded = this.expanded;
  }

  render() {
    return html`
      <div
        class="expandable ${!this.isExpanded ? "collapsed" : ""}"
        @click=${() => (this.isExpanded = !this.isExpanded)}
      >
        <div class="title">
          <span
            class="codicon ${this.isExpanded ? "codicon-chevron-down" : "codicon-chevron-right"}"
          ></span>
          <span>${this.title}</span>
        </div>
        <span class="summary">${this.summary}</span>
      </div>
      <div class="content">
        ${this.isExpanded ? html`<slot></slot>` : nothing}
      </div>
    `;
  }
}
