import * as vscode from "vscode";
import { spawn } from "child_process";
import { Logger } from "../../common/logger";

class PasswordScriptTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite = this.writeEmitter.event;
  
  private closeEmitter = new vscode.EventEmitter<number>();
  onDidClose = this.closeEmitter.event;

  private output: string = '';
  private errorOutput: string = '';
  
  constructor(
    private scriptPath: string,
    private encodedPassword: string,
    private spawnFn: typeof spawn = spawn
  ) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    const scriptPath_lower = this.scriptPath.toLowerCase();
    let command: string;
    let args: string[];

    if (scriptPath_lower.endsWith('.ps1')) {
      command = 'powershell.exe';
      args = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.scriptPath,
        this.encodedPassword
      ];
    } else if (scriptPath_lower.endsWith('.bat') || scriptPath_lower.endsWith('.cmd')) {
      command = 'cmd.exe';
      args = ['/c', this.scriptPath, this.encodedPassword];
    } else {
      command = this.scriptPath;
      args = [this.encodedPassword];
    }

    const proc = this.spawnFn(command, args, {
      cwd: process.cwd(),
      env: process.env,
    });

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      this.output += text;
      this.writeEmitter.fire(text);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      this.errorOutput += text;
      this.writeEmitter.fire(`\x1b[31m${text}\x1b[0m`);
    });

    proc.on('error', (error) => {
      this.writeEmitter.fire(`\x1b[31mFailed to start process: ${error.message}\x1b[0m\r\n`);
      this.closeEmitter.fire(1);
    });

    proc.on('close', (code: number | null) => {
      this.closeEmitter.fire(code ?? 0);
    });
  }

  close(): void {
  }

  getOutput(): string {
    return this.output.trim();
  }

  getErrorOutput(): string {
    return this.errorOutput.trim();
  }
}

export default class PasswordScriptExecutor {
  private static cache: Map<string, { password: string; timestamp: number }> = new Map();
  private static pendingExecutions: Map<string, Promise<string>> = new Map();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // START: Test Hook
  // Exposed for testing purposes to mock child_process.spawn
  public static _spawn = spawn;
  // END: Test Hook

  static async ExecuteScript(scriptPath: string, encodedPassword: string): Promise<string> {
    if (!encodedPassword || encodedPassword.trim() === '') {
      throw new Error('Encoded password is empty or undefined');
    }

    const cacheKey = `${scriptPath}:${encodedPassword}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.password;
    }

    // Check if there's already a pending execution for this key
    const pendingExecution = this.pendingExecutions.get(cacheKey);
    if (pendingExecution) {
      return pendingExecution;
    }

    // Create and store the pending execution promise
    const executionPromise = this.executeScriptInternal(scriptPath, encodedPassword, cacheKey);
    this.pendingExecutions.set(cacheKey, executionPromise);

    try {
      return await executionPromise;
    } finally {
      // Clean up the pending execution regardless of success/failure
      this.pendingExecutions.delete(cacheKey);
    }
  }

  private static async executeScriptInternal(scriptPath: string, encodedPassword: string, cacheKey: string): Promise<string> {
    try {
      const pty = new PasswordScriptTerminal(scriptPath, encodedPassword, this._spawn);
      
      const terminal = vscode.window.createTerminal({
        name: 'NuGet Password Script',
        pty,
      });

      const decodedPassword = await new Promise<string>((resolve, reject) => {
        pty.onDidClose((exitCode) => {
          terminal.dispose();
          
          if (exitCode !== 0) {
            const errorMsg = pty.getErrorOutput();
            reject(new Error(`Script exited with code ${exitCode}${errorMsg ? ': ' + errorMsg : ''}`));
            return;
          }

          const output = pty.getOutput();
          if (!output) {
            reject(new Error('Password script returned empty output'));
            return;
          }

          resolve(output);
        });
      });
      
      this.cache.set(cacheKey, {
        password: decodedPassword,
        timestamp: Date.now(),
      });

      return decodedPassword;
    } catch (error: any) {
      Logger.error(`PasswordScriptExecutor.ExecuteScript: Failed to execute password script ${scriptPath}`, error);
      throw new Error(`Password script execution failed: ${error.message || error}`);
    }
  }

  static ClearCache(): void {
    this.cache.clear();
    this.pendingExecutions.clear();
  }

  static ClearExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp >= this.CACHE_TTL_MS) {
        this.cache.delete(key);
      }
    }
  }
}
