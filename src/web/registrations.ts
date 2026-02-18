import { createRpcClient } from "@/common/rpc/rpc-client";
import type { HostAPI } from "@/common/rpc/types";
import RouterType from "./router";
import ConfigurationService from "./configuration";

// Create RPC client (sets up its own window message listener)
const vscode = acquireVsCodeApi();
export const hostApi: HostAPI = createRpcClient((msg) => vscode.postMessage(msg));

// Singletons
export const router = new RouterType();
export const configuration = new ConfigurationService(hostApi);
