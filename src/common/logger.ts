import * as vscode from 'vscode';

export class Logger {
    private static _outputChannel: vscode.OutputChannel;

    public static configure(context: vscode.ExtensionContext): void {
        this._outputChannel = vscode.window.createOutputChannel("NuGet Gallery");
        context.subscriptions.push(this._outputChannel);
    }

    public static log(message: string, level: string = 'INFO'): void {
        if (this._outputChannel) {
            const timestamp = new Date().toISOString();
            this._outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
        }
    }

    public static info(message: string): void {
        this.log(message, 'INFO');
    }

    public static warn(message: string): void {
        this.log(message, 'WARN');
    }

    public static error(message: string): void {
        this.log(message, 'ERROR');
    }
}
