import * as vscode from 'vscode';
import * as util from 'util';
import * as os from 'os';
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
    SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
    SEMRESATTRS_DEVICE_ID,
    SEMRESATTRS_OS_TYPE,
    SEMRESATTRS_SERVICE_NAME,
    SEMRESATTRS_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type { Attributes, TimeInput, Tracer } from "@opentelemetry/api";

export class Logger {
    private static _outputChannel: vscode.OutputChannel;
    private static _isEnabled: boolean = false;
    private static _provider: BasicTracerProvider;
    private static _tracer: Tracer;

    public static configure(context: vscode.ExtensionContext): void {
        this._outputChannel = vscode.window.createOutputChannel("NuGet Gallery");
        context.subscriptions.push(this._outputChannel);

        const telemetryAddress = process.env.TELEMETRY_ADDRESS;
        if (telemetryAddress && vscode.env.isTelemetryEnabled) {
            this._isEnabled = true;
            this._provider = new BasicTracerProvider({
                resource: new Resource({
                    [SEMRESATTRS_SERVICE_NAME]: "nuget-gallery",
                    [SEMRESATTRS_SERVICE_VERSION]: context.extension.packageJSON.version,
                    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.ENVIRONMENT,
                    [SEMRESATTRS_DEVICE_ID]: vscode.env.machineId,
                    [SEMRESATTRS_OS_TYPE]: os.platform(),
                    "extension.id": context.extension.id,
                    "session.id": vscode.env.sessionId,
                    language: vscode.env.language,
                    "vscode.edition": vscode.env.appName,
                    "vscode.version": vscode.version,
                    "vscode.host": vscode.env.appHost,
                    "vscode.remoteName": vscode.env.remoteName ?? "",
                    "vscode.shell": vscode.env.shell,
                    "vscode.uiKind": vscode.env.uiKind,
                }) as any,
            });

            const traceExporter = new OTLPTraceExporter({
                url: telemetryAddress,
            });

            this._provider.addSpanProcessor(new SimpleSpanProcessor(traceExporter));
            this._tracer = this._provider.getTracer(context.extension.id);

            context.subscriptions.push(new vscode.Disposable(() => {
                this._provider.shutdown();
            }));
        }
    }

    public static log(level: string, message: string, ...args: any[]): void {
        const formattedMessage = util.format(message, ...args);
        if (this._outputChannel) {
            const timestamp = new Date().toISOString();
            this._outputChannel.appendLine(`[${timestamp}] [${level}] ${formattedMessage}`);
        }
        this.sendEvent('log', { level, message: formattedMessage });
    }

    public static info(message: string, ...args: any[]): void {
        this.log('INFO', message, ...args);
    }

    public static warn(message: string, ...args: any[]): void {
        this.log('WARN', message, ...args);
    }

    public static error(message: string, ...args: any[]): void {
        this.log('ERROR', message, ...args);
    }

    public static debug(message: string, ...args: any[]): void {
        this.log('DEBUG', message, ...args);
    }

    private static sendEvent(name: string, data?: Attributes, startTime?: TimeInput, endTime?: TimeInput): void {
        if (!this._isEnabled || !this._tracer) return;

        const span = this._tracer.startSpan(name, {
            startTime: startTime ?? Date.now(),
        });
        if (data != undefined) {
            span.setAttributes(data);
        }
        span.end(endTime);
    }
}
