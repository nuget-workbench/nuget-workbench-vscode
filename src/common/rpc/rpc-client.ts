import type { HostAPI, RpcRequest, RpcResponse } from "./types";
import type { Result } from "./result";
import { fail } from "./result";

type PendingCall = {
  resolve: (result: Result<unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Methods that run dotnet CLI tasks or scan every package of the workspace.
 * They can legitimately take minutes, so the default timeout would report a
 * failure while the host is still working (and invite a duplicate retry).
 */
const LONG_RUNNING_METHODS: ReadonlySet<string> = new Set<keyof HostAPI>([
  "updateProject",
  "batchUpdatePackages",
  "consolidatePackages",
  "getOutdatedPackages",
  "getInconsistentPackages",
  "getVulnerablePackages",
]);

export const LONG_RUNNING_TIMEOUT_MS = 10 * 60_000;

export function createRpcClient(
  postMessage: (msg: unknown) => void,
  timeoutMs: number = 30_000,
  longRunningTimeoutMs: number = LONG_RUNNING_TIMEOUT_MS
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
      const effectiveTimeout = LONG_RUNNING_METHODS.has(method) ? longRunningTimeoutMs : timeoutMs;

      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(fail(`RPC timeout after ${effectiveTimeout}ms for method: ${method}`));
      }, effectiveTimeout);

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
