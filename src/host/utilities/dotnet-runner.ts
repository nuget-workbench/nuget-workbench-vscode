import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";

export type DotnetResult = { exitCode: number | undefined; output: string; spawnError?: Error };

// The errors are at the end of the output; older lines are dropped beyond this size
const MAX_OUTPUT_LENGTH = 64 * 1024;

/**
 * Runs dotnet for a task: the output still appears in the task's terminal, and the exit code and
 * the output are available to report what went wrong.
 */
export class DotnetPseudoterminal implements vscode.Pseudoterminal {
  // START: Test Hook
  public static _spawn = spawn;
  // END: Test Hook

  private readonly writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;
  private readonly closeEmitter = new vscode.EventEmitter<number>();
  readonly onDidClose = this.closeEmitter.event;

  readonly done: Promise<DotnetResult>;
  private resolveDone!: (result: DotnetResult) => void;
  private output = "";
  private proc: ChildProcess | undefined;
  private finished = false;
  started = false;

  constructor(private readonly args: string[], private readonly cwd?: string) {
    this.done = new Promise((resolve) => (this.resolveDone = resolve));
  }

  open(): void {
    this.started = true;
    this.writeEmitter.fire(`> dotnet ${this.args.join(" ")}\r\n\r\n`);

    // No shell: project paths with "&", "(", "$" or quotes and values from the feed are passed
    // verbatim instead of being interpreted by a shell
    const proc = DotnetPseudoterminal._spawn("dotnet", this.args, { cwd: this.cwd, shell: false, env: process.env });
    this.proc = proc;
    // Nothing answers prompts; dotnet gets EOF instead of waiting forever
    proc.stdin?.end();
    proc.stdout?.on("data", (data: Buffer) => this.append(data.toString()));
    proc.stderr?.on("data", (data: Buffer) => this.append(data.toString()));
    proc.on("error", (error: Error) => {
      this.append(`Failed to start dotnet: ${error.message}\n`);
      this.finish(undefined, error);
    });
    proc.on("close", (code: number | null) => this.finish(code ?? undefined));
  }

  close(): void {
    // The user terminated the task
    if (this.proc && this.proc.exitCode === null && !this.proc.killed) {
      this.proc.kill();
    }
    this.finish(undefined);
  }

  private append(text: string): void {
    this.output = (this.output + text).slice(-MAX_OUTPUT_LENGTH);
    this.writeEmitter.fire(text.replace(/\r?\n/g, "\r\n"));
  }

  private finish(exitCode: number | undefined, spawnError?: Error): void {
    if (this.finished) return;
    this.finished = true;
    this.resolveDone({ exitCode, output: this.output, spawnError });
    this.closeEmitter.fire(exitCode ?? 1);
  }
}

/**
 * The lines of a dotnet output that explain a failure ("error NU1101: Unable to find package..."),
 * without ANSI colors and the project path dotnet puts in front of them.
 */
export function extractDotnetErrors(output: string, maxLength = 600): string {
  const lines = output
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const errors: string[] = [];
  for (const line of lines) {
    const match = /\berror\b(\s+[A-Z]+\d+)?\s*:/i.exec(line);
    if (!match) continue;
    const message = line.slice(match.index).replace(/\s+\[[^\]]+\]$/, "");
    if (!errors.includes(message)) errors.push(message);
  }

  const text = (errors.length > 0 ? errors.slice(0, 5) : lines.slice(-3)).join(" ");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
