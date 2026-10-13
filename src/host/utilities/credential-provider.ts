import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import * as path from "path";
import { Logger } from "../../common/logger";
import { normalizeSourceUrl } from "./nuget-config-resolver";

export type ProviderCredentials = { Username?: string; Password: string };

/** Asks for credentials when a feed rejects a request; the NuGetApi retries once with them. */
export interface CredentialFallback {
  GetCredentials(url: string): Promise<ProviderCredentials | undefined>;
  Invalidate(url: string): void;
}

export function isAzureArtifactsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "pkgs.dev.azure.com" || host.endsWith(".visualstudio.com");
  } catch {
    return false;
  }
}

/**
 * Gets feed credentials the way the dotnet CLI does for feeds without credentials in
 * nuget.config: from VSS_NUGET_EXTERNAL_FEED_ENDPOINTS, or from the Azure Artifacts Credential
 * Provider plugin, run non-interactively (a sign-in must happen in `dotnet restore --interactive`).
 */
export default class CredentialProvider {
  private static cache: Map<string, { credentials: ProviderCredentials; timestamp: number }> = new Map();
  private static pending: Map<string, Promise<ProviderCredentials | undefined>> = new Map();
  private static readonly CACHE_TTL_MS = 30 * 60 * 1000;
  public static TIMEOUT_MS = 60 * 1000;

  // START: Test Hook
  public static _spawn = spawn;
  // END: Test Hook

  static async GetCredentials(url: string): Promise<ProviderCredentials | undefined> {
    const key = normalizeSourceUrl(url);

    const fromEnvironment = this.FromEnvironment(key);
    if (fromEnvironment) return fromEnvironment;

    if (!isAzureArtifactsUrl(url)) return undefined;

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.credentials;
    }

    const pending = this.pending.get(key);
    if (pending) return pending;

    const promise = this.RunPlugin(url).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    const credentials = await promise;
    if (credentials) {
      this.cache.set(key, { credentials, timestamp: Date.now() });
    }
    return credentials;
  }

  static Invalidate(url: string): void {
    this.cache.delete(normalizeSourceUrl(url));
  }

  static ClearCache(): void {
    this.cache.clear();
    this.pending.clear();
  }

  private static FromEnvironment(key: string): ProviderCredentials | undefined {
    const raw = process.env["VSS_NUGET_EXTERNAL_FEED_ENDPOINTS"];
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as {
        endpointCredentials?: Array<{ endpoint?: string; username?: string; password?: string }>;
      };
      const match = parsed.endpointCredentials?.find(
        (e) => e.endpoint && e.password && normalizeSourceUrl(e.endpoint) === key
      );
      return match ? { Username: match.username, Password: match.password! } : undefined;
    } catch {
      Logger.warn("CredentialProvider: VSS_NUGET_EXTERNAL_FEED_ENDPOINTS is not valid JSON");
      return undefined;
    }
  }

  /** The plugin from NUGET_NETCORE_PLUGIN_PATHS / NUGET_PLUGIN_PATHS, or its default install location. */
  static FindPlugin(): string | undefined {
    for (const variable of ["NUGET_NETCORE_PLUGIN_PATHS", "NUGET_PLUGIN_PATHS"]) {
      const entries = (process.env[variable] ?? "").split(/[;]/).flatMap((e) => e.split(path.delimiter));
      const plugin = entries
        .map((e) => e.trim())
        .find((e) => e && path.basename(e).toLowerCase().startsWith("credentialprovider.microsoft") && fs.existsSync(e));
      if (plugin) return plugin;
    }

    const folder = path.join(os.homedir(), ".nuget", "plugins", "netcore", "CredentialProvider.Microsoft");
    for (const name of ["CredentialProvider.Microsoft.dll", "CredentialProvider.Microsoft.exe", "CredentialProvider.Microsoft"]) {
      const candidate = path.join(folder, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  private static RunPlugin(url: string): Promise<ProviderCredentials | undefined> {
    const plugin = this.FindPlugin();
    if (!plugin) {
      Logger.debug("CredentialProvider: Azure Artifacts Credential Provider is not installed");
      return Promise.resolve(undefined);
    }

    const pluginArgs = ["-U", url, "-N", "-F", "Json"];
    const [command, args] = plugin.toLowerCase().endsWith(".dll")
      ? ["dotnet", [plugin, ...pluginArgs]]
      : [plugin, pluginArgs];

    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      const finish = (credentials: ProviderCredentials | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(credentials);
      };

      // No shell: the feed URL comes from configuration files
      const proc = this._spawn(command, args, { shell: false, windowsHide: true });
      proc.stdin?.end();
      const timer = setTimeout(() => {
        Logger.warn(`CredentialProvider: no answer for ${url} within ${this.TIMEOUT_MS / 1000} seconds`);
        proc.kill();
        finish(undefined);
      }, this.TIMEOUT_MS);

      proc.stdout?.on("data", (data: Buffer) => (output += data.toString()));
      proc.on("error", (error) => {
        Logger.warn(`CredentialProvider: failed to start ${command}`, error);
        finish(undefined);
      });
      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          Logger.warn(`CredentialProvider: exited with code ${code} for ${url}`);
          finish(undefined);
          return;
        }
        finish(parseCredentials(output));
      });
    });
  }
}

/** The plugin may log to stdout as well; the credentials are the last JSON line. */
function parseCredentials(output: string): ProviderCredentials | undefined {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line) as { Username?: string; Password?: string };
      if (parsed.Password) return { Username: parsed.Username, Password: parsed.Password };
    } catch {
      // Not the credentials line
    }
  }
  return undefined;
}
