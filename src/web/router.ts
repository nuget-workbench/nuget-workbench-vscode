type Routes = "BROWSE" | "SETTINGS";

export default class Router extends EventTarget {
  private route: Routes = "BROWSE";

  get CurrentRoute(): Routes {
    return this.route;
  }

  Navigate(route: Routes) {
    this.route = route;
    this.dispatchEvent(new Event("route-changed"));
  }
}
