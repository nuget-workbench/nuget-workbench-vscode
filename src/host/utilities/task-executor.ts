import { Mutex } from "async-mutex";
import * as vscode from "vscode";
import { Logger } from "../../common/logger";

export class TaskExecutor {
  private globalMutex: Mutex = new Mutex();

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
    try {
      const started: { execution?: vscode.TaskExecution } = {};
      // Tasks are serialized by the global mutex, so an end event for a task with the same
      // name/source that arrives before executeTask() resolves belongs to this execution.
      const isOwnExecution = (e: vscode.TaskExecution) =>
        started.execution
          ? e === started.execution || e.task === started.execution.task
          : e.task.name === task.name && e.task.source === task.source;

      // Subscribe before starting the task so fast-finishing tasks are not missed.
      // onDidEndTaskProcess carries the exit code; onDidEndTask is a fallback for tasks
      // whose process never started. The first event to arrive wins.
      const finished = new Promise<number | undefined>((resolve) => {
        disposables.push(
          vscode.tasks.onDidEndTaskProcess((e) => {
            if (isOwnExecution(e.execution)) resolve(e.exitCode);
          }),
          vscode.tasks.onDidEndTask((e) => {
            if (isOwnExecution(e.execution)) resolve(undefined);
          })
        );
      });

      started.execution = await vscode.tasks.executeTask(task);
      const exitCode = await finished;

      if (exitCode !== undefined && exitCode !== 0) {
        Logger.error(`TaskExecutor.ExecuteTask: Task ${task.name} failed with exit code ${exitCode}`);
        throw new Error(`dotnet exited with code ${exitCode}. See the terminal output for details.`);
      }
      Logger.info(`TaskExecutor.ExecuteTask: Task ${task.name} completed`);
    } finally {
      disposables.forEach((d) => d.dispose());
      releaser();
    }
  }
}

export default new TaskExecutor();
