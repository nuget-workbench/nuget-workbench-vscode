import type { Webview } from "vscode";
import type { HostAPI, RpcRequest, RpcResponse } from "./types";
import type { Result } from "./result";
import { fail } from "./result";
import { Logger } from "../logger";

export class RpcHost {
  private readonly webview: Webview;
  private readonly api: HostAPI;

  constructor(webview: Webview, api: HostAPI) {
    this.webview = webview;
    this.api = api;
    this.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (!this.isRpcRequest(msg)) return;

    const { id, method, params } = msg;
    let result: Result<unknown>;

    try {
      const handler = this.api[method as keyof HostAPI] as
        | ((req: unknown) => Promise<Result<unknown>>)
        | undefined;

      if (!handler) {
        result = fail(`Unknown RPC method: ${method}`);
      } else {
        result = await handler.call(this.api, params);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.error(`RPC handler error for ${method}: ${message}`);
      result = fail(`Internal error in ${method}: ${message}`);
    }

    const response: RpcResponse = { type: "rpc-response", id, result };
    this.webview.postMessage(response);
  }

  private isRpcRequest(msg: unknown): msg is RpcRequest {
    return (
      typeof msg === "object" &&
      msg !== null &&
      (msg as RpcRequest).type === "rpc-request" &&
      typeof (msg as RpcRequest).id === "number" &&
      typeof (msg as RpcRequest).method === "string"
    );
  }

  dispose(): void {
    // Webview disposal is handled by VS Code
  }
}
