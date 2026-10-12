import { Mutex } from "async-mutex";
import * as vscode from "vscode";
import { Logger } from "../../common/logger";
import { DotnetPseudoterminal, extractDotnetErrors } from "./dotnet-runner";

export class TaskExecutor {
  private globalMutex: Mutex = new Mutex();
  /** When the last dotnet run ended; its file changes are not reported as external edits. */
  LastFinishedAt = 0;

  get IsBusy(): boolean {
    return this.globalMutex.isLocked();
  }

  /**
   * Runs dotnet as a task, one at a time: dotnet commands on the same projects must not overlap.
   * Throws with the errors from dotnet's output when it fails.
   */
  async ExecuteDotnet(name: string, args: string[], cwd?: string): Promise<void> {
    Logger.info(`TaskExecutor.ExecuteDotnet: Executing task ${name}`);
    Logger.debug(`TaskExecutor.ExecuteDotnet: dotnet ${args.join(" ")}`);

    const releaser = await this.globalMutex.acquire();
    const disposables: vscode.Disposable[] = [];
    try {
      const pty = new DotnetPseudoterminal(args, cwd);
      const task = new vscode.Task(
        { type: "dotnet", task: name },
        vscode.TaskScope.Workspace,
        "nuget-workbench",
        "dotnet",
        new vscode.CustomExecution(async () => pty)
      );
      task.presentationOptions.reveal = vscode.TaskRevealKind.Silent;

      // The terminal reports the result; the task end event only matters when the terminal
      // was never opened (the task could not be started)
      const started: { execution?: vscode.TaskExecution } = {};
      const endedWithoutStart = new Promise<undefined>((resolve) => {
        disposables.push(
          vscode.tasks.onDidEndTask((e) => {
            if (!pty.started && (e.execution === started.execution || e.execution.task === task)) resolve(undefined);
          })
        );
      });

      started.execution = await vscode.tasks.executeTask(task);
      const result = await Promise.race([pty.done, endedWithoutStart]);

      if (!result) {
        throw new Error("The dotnet task could not be started.");
      }
      if (result.spawnError) {
        Logger.error(`TaskExecutor.ExecuteDotnet: dotnet could not be started`, result.spawnError);
        throw new Error(`dotnet could not be started (${result.spawnError.message}). Is the .NET SDK installed and on PATH?`);
      }
      if (result.exitCode === undefined) {
        throw new Error("dotnet was terminated.");
      }
      if (result.exitCode !== 0) {
        Logger.error(`TaskExecutor.ExecuteDotnet: Task ${name} failed with exit code ${result.exitCode}\n${result.output}`);
        const details = extractDotnetErrors(result.output);
        throw new Error(`dotnet exited with code ${result.exitCode}${details ? `: ${details}` : ""}`);
      }
      Logger.info(`TaskExecutor.ExecuteDotnet: Task ${name} completed`);
    } finally {
      disposables.forEach((d) => d.dispose());
      this.LastFinishedAt = Date.now();
      releaser();
    }
  }
}

export default new TaskExecutor();
