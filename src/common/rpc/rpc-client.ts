import type { HostAPI, RpcRequest, RpcResponse, RPC_TIMEOUT_MS } from "./types";
import type { Result } from "./result";
import { fail } from "./result";

type PendingCall = {
  resolve: (result: Result<unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function createRpcClient(
  postMessage: (msg: unknown) => void,
  timeoutMs: number = 30_000
): HostAPI {
  let nextId = 1;
  const pending = new Map<number, PendingCall>();

  window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as RpcResponse;
    if (msg?.type !== "rpc-response") return;

    const call = pending.get(msg.id);
    if (!call) return;

    clearTimeout(call.timer);
    pending.delete(msg.id);
    call.resolve(msg.result);
  });

  function call(method: string, params: unknown): Promise<Result<unknown>> {
    return new Promise<Result<unknown>>((resolve) => {
      const id = nextId++;

      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(fail(`RPC timeout after ${timeoutMs}ms for method: ${method}`));
      }, timeoutMs);

      pending.set(id, { resolve, timer });

      const request: RpcRequest = {
        type: "rpc-request",
        id,
        method,
        params,
      };
      postMessage(request);
    });
  }

  return new Proxy({} as HostAPI, {
    get(_target, prop: string) {
      return (params: unknown) => call(prop, params);
    },
  });
}
