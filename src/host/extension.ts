import * as vscode from "vscode";
import nonce from "@/common/nonce";
import { RpcHost } from "@/common/rpc/rpc-host";
import { createHostAPI } from "./host-api";
import { Logger } from "../common/logger";
import { PackageVersionDecorator } from "./utilities/package-version-decorator";

export function activate(context: vscode.ExtensionContext) {
  Logger.configure(context);
  Logger.info("Extension.activate: Extension activated");
  const provider = new NugetViewProvider(context.extensionUri);

  context.subscriptions.push(new PackageVersionDecorator());

  const previousVersion: string | undefined = context.globalState.get("NugetWorkbench.version");
  context.globalState.update("NugetWorkbench.version", context.extension.packageJSON.version);
  if (previousVersion == undefined) {
    Logger.info("Extension.activate: Extension installed");
  } else if (previousVersion != context.extension.packageJSON.version)
    Logger.info("Extension.activate: Extension upgraded from version %s", previousVersion);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("nugetWorkbench.packageView", provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nugetWorkbench.open", () => {
      vscode.commands.executeCommand("nugetWorkbench.packageView.focus");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nugetWorkbench.install", async () => {
      const packageId = await vscode.window.showInputBox({
        prompt: "Enter the NuGet package ID to install",
        placeHolder: "e.g. Newtonsoft.Json",
      });
      if (!packageId) return;
      vscode.commands.executeCommand("nugetWorkbench.packageView.focus");
      provider.sendSearchQuery(packageId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nugetWorkbench.update", () => {
      vscode.commands.executeCommand("nugetWorkbench.packageView.focus");
      provider.sendNavigateToTab("updates");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nugetWorkbench.remove", () => {
      vscode.commands.executeCommand("nugetWorkbench.packageView.focus");
      provider.sendNavigateToTab("installed");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nugetWorkbench.reportProblem", async () => {
      vscode.env.openExternal(
        vscode.Uri.parse("https://github.com/nuget-workbench/nuget-workbench-vscode/issues/new")
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("nugetWorkbench.openSettings", () => {
      vscode.commands.executeCommand("nugetWorkbench.packageView.focus");
      provider.sendNavigateToRoute("SETTINGS");
    })
  );
}

type ViewCommand =
  | { type: "command"; command: "search"; query: string }
  | { type: "command"; command: "navigate-tab"; tab: string }
  | { type: "command"; command: "navigate-route"; route: string };

class NugetViewProvider implements vscode.WebviewViewProvider {
  private rpcHost: RpcHost | undefined;
  private webviewView: vscode.WebviewView | undefined;
  private webviewReady = false;
  private pendingCommands: ViewCommand[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  sendSearchQuery(query: string): void {
    this.postCommand({ type: "command", command: "search", query });
  }

  sendNavigateToTab(tab: string): void {
    this.postCommand({ type: "command", command: "navigate-tab", tab });
  }

  sendNavigateToRoute(route: string): void {
    this.postCommand({ type: "command", command: "navigate-route", route });
  }

  /**
   * The view is only created when it is first shown, and its UI needs the configuration before
   * it can handle a command. Commands sent earlier are delivered once the webview reports ready.
   */
  private postCommand(command: ViewCommand): void {
    if (this.webviewView && this.webviewReady) {
      this.webviewView.webview.postMessage(command);
    } else {
      this.pendingCommands.push(command);
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    Logger.debug("NugetViewProvider.resolveWebviewView: Resolving webview view");

    this.webviewView = webviewView;
    this.webviewReady = false;

    webviewView.webview.onDidReceiveMessage((msg: unknown) => {
      if ((msg as { type?: string } | null)?.type !== "webview-ready") return;
      this.webviewReady = true;
      for (const command of this.pendingCommands.splice(0)) {
        webviewView.webview.postMessage(command);
      }
    });
    webviewView.onDidDispose(() => {
      if (this.webviewView === webviewView) {
        this.webviewView = undefined;
        this.webviewReady = false;
      }
    });

    // Dispose previous RPC host if webview is re-resolved
    this.rpcHost?.dispose();

    const api = createHostAPI();
    this.rpcHost = new RpcHost(webviewView.webview, api);

    const webJsSrc = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, ...["dist", "web.js"])
    );
    const webCssSrc = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, ...["dist", "web.css"])
    );

    const nonceValue = nonce();
    webviewView.webview.html = /*html*/ `
	  <!DOCTYPE html>
	  <html lang="en">
		<head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonceValue}';">
      <link rel="stylesheet" type="text/css" href="${webCssSrc}"/>
		  <title>NuGet Workbench</title>
		</head>
		<body>
		  <nuget-workbench></nuget-workbench>
		  <script type="module" nonce="${nonceValue}" src="${webJsSrc}"></script>
		</body>
	  </html>
	`;
    webviewView.webview.options = {
      enableScripts: true,
    };
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  Logger.info("Extension.deactivate: Extension deactivated");
}
