import { Mutex } from "async-mutex";
import * as vscode from "vscode";
import { Logger } from "../../common/logger";

type TaskEnd = { kind: "process"; exitCode: number | undefined } | { kind: "task" };

export class TaskExecutor {
  private globalMutex: Mutex = new Mutex();
  // The previous task's onDidEndTask event can arrive after its process end already released the
  // mutex; it must not be taken for the end of the next task, which has the same name/source.
  private lastTask: vscode.Task | undefined;
  private lastExecution: vscode.TaskExecution | undefined;

  async ExecuteTask(task: vscode.Task): Promise<void> {
    Logger.info(`TaskExecutor.ExecuteTask: Executing task ${task.name}`);

    // Log task details if available
    if (task.execution instanceof vscode.ShellExecution) {
      const shellExec = task.execution as vscode.ShellExecution;
      const args = typeof shellExec.args === 'string' ? shellExec.args : (shellExec.args || []).map(a => typeof a === 'string' ? a : a.value).join(' ');
      Logger.debug(`TaskExecutor.ExecuteTask: Shell command: ${shellExec.commandLine || shellExec.command} ${args}`);
    } else if (task.execution instanceof vscode.ProcessExecution) {
      const procExec = task.execution as vscode.ProcessExecution;
      Logger.debug(`TaskExecutor.ExecuteTask: Process: ${procExec.process} ${(procExec.args || []).join(' ')}`);
    }

    const releaser = await this.globalMutex.acquire();
    const disposables: vscode.Disposable[] = [];
    let execution: vscode.TaskExecution | undefined;
    try {
      const started: { execution?: vscode.TaskExecution } = {};
      // Tasks are serialized by the global mutex, so an end event for a task with the same
      // name/source that arrives before executeTask() resolves belongs to this execution.
      const isOwnExecution = (e: vscode.TaskExecution) => {
        if (started.execution) {
          return e === started.execution || e.task === started.execution.task;
        }
        if (e === this.lastExecution || (this.lastTask && e.task === this.lastTask)) {
          return false;
        }
        return e.task.name === task.name && e.task.source === task.source;
      };

      // Subscribe before starting the task so fast-finishing tasks are not missed.
      // onDidEndTaskProcess carries the exit code; onDidEndTask is a fallback for tasks
      // whose process never started. The first event to arrive wins.
      const finished = new Promise<TaskEnd>((resolve) => {
        disposables.push(
          vscode.tasks.onDidEndTaskProcess((e) => {
            if (isOwnExecution(e.execution)) resolve({ kind: "process", exitCode: e.exitCode });
          }),
          vscode.tasks.onDidEndTask((e) => {
            if (isOwnExecution(e.execution)) resolve({ kind: "task" });
          })
        );
      });

      execution = await vscode.tasks.executeTask(task);
      started.execution = execution;
      const end = await finished;

      if (end.kind === "task" || end.exitCode === undefined) {
        // The process could not be started (e.g. dotnet is not on PATH) or was terminated
        Logger.error(`TaskExecutor.ExecuteTask: Task ${task.name} did not run to completion`);
        throw new Error("dotnet could not be started or was terminated. See the terminal output for details.");
      }
      if (end.exitCode !== 0) {
        Logger.error(`TaskExecutor.ExecuteTask: Task ${task.name} failed with exit code ${end.exitCode}`);
        throw new Error(`dotnet exited with code ${end.exitCode}. See the terminal output for details.`);
      }
      Logger.info(`TaskExecutor.ExecuteTask: Task ${task.name} completed`);
    } finally {
      disposables.forEach((d) => d.dispose());
      this.lastTask = task;
      this.lastExecution = execution;
      releaser();
    }
  }
}

export default new TaskExecutor();
