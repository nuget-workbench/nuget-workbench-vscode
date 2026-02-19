import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { configuration, router } from "./registrations";
import type { PackagesView } from "./components/packages-view";

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
import "./components/nuget-output-log";
import "./components/nuget-license-dialog";

import "./main.css";

type HostCommand =
  | { type: "command"; command: "search"; query: string }
  | { type: "command"; command: "navigate-tab"; tab: string }
  | { type: "command"; command: "navigate-route"; route: string };

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

    window.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as HostCommand;
      if (data?.type !== "command") return;
      this.handleHostCommand(data);
    });
  }

  private handleHostCommand(cmd: HostCommand): void {
    switch (cmd.command) {
      case "search": {
        router.Navigate("BROWSE");
        this.updateComplete.then(() => {
          const packagesView = this.shadowRoot?.querySelector("packages-view") as PackagesView | null;
          packagesView?.setSearchQuery(cmd.query);
        });
        break;
      }
      case "navigate-tab": {
        router.Navigate("BROWSE");
        this.updateComplete.then(() => {
          const packagesView = this.shadowRoot?.querySelector("packages-view") as PackagesView | null;
          packagesView?.setTab(cmd.tab as "browse" | "installed" | "updates" | "consolidate" | "vulnerabilities");
        });
        break;
      }
      case "navigate-route": {
        router.Navigate(cmd.route as "BROWSE" | "SETTINGS");
        break;
      }
    }
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
