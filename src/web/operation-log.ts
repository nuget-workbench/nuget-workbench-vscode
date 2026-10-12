import type { LogEntry } from "./components/nuget-output-log";

export type OperationLogDetail = { text: string; level: LogEntry["level"] };

/** Reports an operation to the output log of the packages view. */
export function emitOperationLog(source: HTMLElement, text: string, level: LogEntry["level"] = "info"): void {
  source.dispatchEvent(
    new CustomEvent<OperationLogDetail>("operation-log", {
      detail: { text, level },
      bubbles: true,
      composed: true,
    })
  );
}
