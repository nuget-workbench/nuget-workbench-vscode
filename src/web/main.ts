import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { configuration, router } from "./registrations";

// Import all Lit components (they self-register via @customElement)
import "./components/packages-view";
import "./components/package-row";
import "./components/project-row";
import "./components/settings-view";
import "./components/package-details";
import "./components/expandable-container";
import "./components/search-bar";
import "./components/updates-view";
import "./components/consolidate-view";
import "./components/vulnerabilities-view";
import "./components/project-tree";

import "./main.css";

@customElement("nuget-workbench")
export class NuGetWorkbench extends LitElement {
  @state() private configLoaded = false;
  @state() private currentRoute = router.CurrentRoute;

  connectedCallback() {
    super.connectedCallback();
    configuration.addEventListener("configuration-changed", () => {
      this.configLoaded = configuration.Configuration != null;
    });
    router.addEventListener("route-changed", () => {
      this.currentRoute = router.CurrentRoute;
    });
    configuration.Reload();
  }

  render() {
    if (!this.configLoaded) {
      return html``;
    }
    if (this.currentRoute === "SETTINGS") {
      return html`<settings-view></settings-view>`;
    }
    return html`<packages-view></packages-view>`;
  }
}
