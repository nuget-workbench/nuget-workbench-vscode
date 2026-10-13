import * as vscode from "vscode";
import TaskExecutor from "./task-executor";
import CpmResolver from "./cpm-resolver";
import NuGetConfigResolver from "./nuget-config-resolver";
import nugetApiFactory from "../nuget/api-factory";
import { Logger } from "../../common/logger";

export type RefreshKind = "projects" | "configuration";

// Settings that change what the view shows; the log level and the inline hints do not
const VIEW_SETTINGS = [
  "sources",
  "prerelease",
  "skipRestore",
  "statusBarLoadingIndicator",
  "pageSize",
  "defaultSource",
  "showOutputOnError",
];

/**
 * Reports edits made outside the view (git checkout, a project file edited by hand, a changed
 * nuget.config or setting), so the view can reload instead of showing stale packages.
 */
export class WorkspaceWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pending = new Set<RefreshKind>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onRefresh: (kinds: RefreshKind[]) => void,
    private readonly delayMs = 1000,
    private readonly graceMs = 2000
  ) {
    this.watch("**/*.{csproj,fsproj,vbproj}", "projects");
    this.watch("**/{Directory.Packages.props,Directory.Build.props}", "projects");
    const configWatcher = this.watch("**/[Nn][Uu][Gg][Ee][Tt].[Cc][Oo][Nn][Ff][Ii][Gg]", "configuration");
    // A new or deleted nuget.config changes which folders contribute sources
    configWatcher.onDidCreate(() => NuGetConfigResolver.InvalidateWorkspaceDirs(), undefined, this.disposables);
    configWatcher.onDidDelete(() => NuGetConfigResolver.InvalidateWorkspaceDirs(), undefined, this.disposables);

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        NuGetConfigResolver.InvalidateWorkspaceDirs();
        this.queue("configuration");
        this.queue("projects");
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (VIEW_SETTINGS.some((key) => e.affectsConfiguration(`NugetWorkbench.${key}`))) {
          this.queue("configuration");
        }
      })
    );
  }

  private watch(glob: string, kind: RefreshKind): vscode.FileSystemWatcher {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    const onEvent = (uri: vscode.Uri) => {
      if (/[\\/](node_modules|bin|obj)[\\/]/i.test(uri.fsPath)) return;
      this.queue(kind);
    };
    watcher.onDidCreate(onEvent, undefined, this.disposables);
    watcher.onDidChange(onEvent, undefined, this.disposables);
    watcher.onDidDelete(onEvent, undefined, this.disposables);
    this.disposables.push(watcher);
    return watcher;
  }

  private queue(kind: RefreshKind): void {
    // The extension's own dotnet runs change project files too; the view reloads after them anyway
    if (kind === "projects" && (TaskExecutor.IsBusy || Date.now() - TaskExecutor.LastFinishedAt < this.graceMs)) {
      return;
    }
    this.pending.add(kind);
    // A checkout touches many files at once; report them together
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  private flush(): void {
    this.timer = undefined;
    const kinds = Array.from(this.pending);
    this.pending.clear();
    if (kinds.length === 0) return;

    Logger.debug(`WorkspaceWatcher: external changes (${kinds.join(", ")}), refreshing the view`);
    if (kinds.includes("projects")) {
      CpmResolver.ClearCache();
    }
    if (kinds.includes("configuration")) {
      nugetApiFactory.ClearCache();
    }
    this.onRefresh(kinds);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
