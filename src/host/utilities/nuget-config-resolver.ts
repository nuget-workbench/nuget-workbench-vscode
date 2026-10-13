import fs from "fs";
import * as path from "path";
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import os from "os";
import * as vscode from "vscode";
import PasswordScriptExecutor from "./password-script-executor";
import CredentialsCache from "./credentials-cache";
import { Logger } from "../../common/logger";

export type SourceOrigin = "nuget.config" | "settings";

export type SourceWithCredentials = {
  Name: string;
  Url: string;
  Username?: string;
  Password?: string;
  PasswordScriptPath?: string;
  Origin?: SourceOrigin;
};

type ParsedConfigFile = {
  sources: SourceWithCredentials[];
  credentials: Map<string, { Username?: string; Password?: string }>;
  disabledSources: string[];
  clear: boolean;
};

export type ResolvedConfig = {
  sources: SourceWithCredentials[];
  /** Lowercase names that a nuget.config disables or removes with <clear/>. */
  blockedNames: Set<string>;
};

/** A relative local folder source is relative to the config file that declares it. */
function resolveLocalSource(url: string, configDir: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || path.isAbsolute(url) || /^([a-zA-Z]:[\\/]|\\\\)/.test(url)) {
    return url;
  }
  return path.resolve(configDir, url);
}

/** Normalizes a source URL for comparisons: no trailing slash, case-insensitive. */
export function normalizeSourceUrl(url: string): string {
  return url.trim().replace(/[\\/]+$/, "").toLowerCase();
}

export default class NuGetConfigResolver {
  private static readonly CONFIG_FILENAMES = ["nuget.config", "NuGet.config", "NuGet.Config"];
  // Keyed by the config file paths and their modification stamps
  private static resolvedCache = new Map<string, Promise<ResolvedConfig>>();
  private static workspaceDirs: Promise<Array<string | undefined>> | null = null;

  static async GetSourcesAndDecodePasswords(startDir?: string): Promise<SourceWithCredentials[]> {
    return this.GetSources(startDir, true);
  }

  /**
   * Merges the nuget.config sources that apply to startDir with the extension's "sources"
   * setting. Sources from the setting only add new names (and password scripts for existing
   * ones); a name that a nuget.config disables or clears is not brought back by the setting.
   */
  static async GetSources(startDir: string | undefined, decodePasswords: boolean): Promise<SourceWithCredentials[]> {
    Logger.debug(`NuGetConfigResolver.GetSources: Starting resolution (startDir: ${startDir})`);
    const sources = this.MergeWithSettings(await this.Resolve(startDir));
    if (decodePasswords) {
      await this.DecodePasswords(sources);
    }
    return sources;
  }

  /**
   * Sources for operations that are not tied to one project (search, settings, scans): the
   * union of the sources that apply to every workspace folder and every folder with its own
   * nuget.config, so nested solutions and multi-root workspaces see all their feeds.
   */
  static async GetWorkspaceSources(decodePasswords: boolean): Promise<SourceWithCredentials[]> {
    const merged = new Map<string, SourceWithCredentials>();
    for (const dir of await this.GetWorkspaceDirs()) {
      for (const source of this.MergeWithSettings(await this.Resolve(dir))) {
        const key = `${source.Name.toLowerCase()}|${normalizeSourceUrl(source.Url)}`;
        if (!merged.has(key)) merged.set(key, source);
      }
    }
    const sources = Array.from(merged.values());
    if (decodePasswords) {
      await this.DecodePasswords(sources);
    }
    return sources;
  }

  /**
   * Lowercase names that a nuget.config of the workspace disables or clears and that no other
   * folder of the workspace shows. These setting entries are not in the UI and must be kept.
   */
  static async GetWorkspaceHiddenSourceNames(): Promise<Set<string>> {
    const blocked = new Set<string>();
    for (const dir of await this.GetWorkspaceDirs()) {
      (await this.Resolve(dir)).blockedNames.forEach((name) => blocked.add(name));
    }
    for (const source of await this.GetWorkspaceSources(false)) {
      blocked.delete(source.Name.toLowerCase());
    }
    return blocked;
  }

  static async GetSourcesWithCredentials(startDir?: string): Promise<SourceWithCredentials[]> {
    return (await this.Resolve(startDir)).sources;
  }

  /** Lowercase names of sources that a nuget.config disables or removes with <clear/>. */
  static async GetBlockedSourceNames(startDir?: string): Promise<Set<string>> {
    return (await this.Resolve(startDir)).blockedNames;
  }

  /** Resolves the nuget.config files that apply to startDir. Returns copies callers may change. */
  static async Resolve(startDir?: string): Promise<ResolvedConfig> {
    const configPaths = this.FindAllConfigFiles(startDir);
    const stamps = await Promise.all(
      configPaths.map(async (p) => {
        try {
          const stat = await fs.promises.stat(p);
          return `${p}:${stat.mtimeMs}:${stat.size}`;
        } catch {
          return `${p}:missing`;
        }
      })
    );
    const key = stamps.join("|");

    // The promise is cached, so concurrent calls (several feeds at start-up) parse the files once
    let pending = this.resolvedCache.get(key);
    if (!pending) {
      const created = this.ResolveConfigFiles(configPaths);
      pending = created;
      this.resolvedCache.set(key, created);
      created.catch(() => {
        if (this.resolvedCache.get(key) === created) this.resolvedCache.delete(key);
      });
    }
    const resolved = await pending;
    return {
      sources: resolved.sources.map((s) => ({ ...s })),
      blockedNames: new Set(resolved.blockedNames),
    };
  }

  /** Forgets the folders with a nuget.config, e.g. after one was created or deleted. */
  static InvalidateWorkspaceDirs(): void {
    this.workspaceDirs = null;
  }

  private static GetWorkspaceDirs(): Promise<Array<string | undefined>> {
    if (!this.workspaceDirs) {
      const promise = this.FindWorkspaceDirs();
      this.workspaceDirs = promise;
      promise.catch(() => {
        if (this.workspaceDirs === promise) this.workspaceDirs = null;
      });
    }
    return this.workspaceDirs;
  }

  private static async FindWorkspaceDirs(): Promise<Array<string | undefined>> {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    if (roots.length === 0) {
      // Without a folder only the user and machine configs apply
      return [undefined];
    }

    const dirs = new Map<string, string>();
    for (const root of roots) dirs.set(path.resolve(root).toLowerCase(), root);

    const configFiles = await vscode.workspace.findFiles(
      "**/[Nn][Uu][Gg][Ee][Tt].[Cc][Oo][Nn][Ff][Ii][Gg]",
      "**/{node_modules,bin,obj}/**"
    );
    for (const file of configFiles) {
      let dir = path.dirname(file.fsPath);
      // A legacy .nuget folder belongs to the folder above it
      if (path.basename(dir).toLowerCase() === ".nuget") dir = path.dirname(dir);
      const key = path.resolve(dir).toLowerCase();
      if (!dirs.has(key)) dirs.set(key, dir);
    }
    return Array.from(dirs.values());
  }

  private static MergeWithSettings(resolved: ResolvedConfig): SourceWithCredentials[] {
    const config = vscode.workspace.getConfiguration("NugetWorkbench");
    // NuGet source names are case-insensitive
    const sourcesMap = new Map<string, SourceWithCredentials>();

    resolved.sources.forEach((s) => {
      sourcesMap.set(s.Name.toLowerCase(), {
        Name: s.Name,
        Url: s.Url,
        Username: s.Username,
        Password: s.Password,
        Origin: "nuget.config",
      });
    });

    const vscodeSourcesRaw = config.get<Array<string>>("sources") ?? [];

    vscodeSourcesRaw.forEach((x) => {
      try {
        const parsed = JSON.parse(x) as {
          name?: string;
          url?: string;
          passwordScriptPath?: string;
        };
        Logger.debug(`NuGetConfigResolver.GetSources: Found source from setting: ${parsed.name}`);
        if (parsed.name) {
          const key = parsed.name.toLowerCase();
          const existingSource = sourcesMap.get(key);
          if (existingSource) {
            if (parsed.passwordScriptPath) {
              existingSource.PasswordScriptPath = parsed.passwordScriptPath;
            }
          } else if (parsed.url && !resolved.blockedNames.has(key)) {
            sourcesMap.set(key, {
              Name: parsed.name,
              Url: parsed.url,
              PasswordScriptPath: parsed.passwordScriptPath || undefined,
              Origin: "settings",
            });
          }
        }
      } catch { /* ignore unparseable source entries */ }
    });

    return Array.from(sourcesMap.values());
  }

  private static async DecodePasswords(sources: SourceWithCredentials[]): Promise<void> {
    for (const source of sources) {
      const passwordScriptPath = source.PasswordScriptPath;

      if (passwordScriptPath && source.Password) {
        try {
          Logger.debug(`NuGetConfigResolver.GetSources: Decoding password for ${source.Name}`);
          const decodedPassword = await PasswordScriptExecutor.ExecuteScript(
            passwordScriptPath,
            source.Password
          );
          source.Password = decodedPassword;
          CredentialsCache.set(source.Name, source.Username, decodedPassword);
        } catch (error) {
          Logger.error(`NuGetConfigResolver.GetSources: Failed to decode password for ${source.Name}`, error);
          CredentialsCache.set(source.Name, source.Username, source.Password);
        }
      } else if (source.Username || source.Password) {
        Logger.debug(`NuGetConfigResolver.GetSources: Caching credentials for ${source.Name}`);
        CredentialsCache.set(source.Name, source.Username, source.Password);
      }
    }
  }

  private static async ResolveConfigFiles(configPaths: string[]): Promise<ResolvedConfig> {
    Logger.debug(`NuGetConfigResolver.ResolveConfigFiles: Found config files: ${configPaths.join(", ")}`);

    // Highest priority (closest to the project) first
    const parsedFiles: ParsedConfigFile[] = [];
    for (const configPath of configPaths) {
      try {
        Logger.debug(`NuGetConfigResolver.ResolveConfigFiles: Parsing ${configPath}`);
        parsedFiles.push(await this.ParseConfigFile(configPath));
      } catch (error) {
        Logger.error(`NuGetConfigResolver.ResolveConfigFiles: Failed to parse ${configPath}`, error);
      }
    }

    // NuGet applies config files from the lowest priority (machine, user) to the highest
    // (closest to the project): a closer file overrides a source with the same key, and its
    // <clear/> drops every source inherited from the files further away. Keys are case-insensitive.
    const sources = new Map<string, SourceWithCredentials>();
    const credentials = new Map<string, { Username?: string; Password?: string }>();
    const disabledSources = new Set<string>();
    const clearedNames = new Set<string>();

    for (const result of [...parsedFiles].reverse()) {
      if (result.clear) {
        Logger.debug(`NuGetConfigResolver.ResolveConfigFiles: 'clear' found, dropping inherited sources`);
        sources.forEach((_source, key) => clearedNames.add(key));
        sources.clear();
      }

      result.sources.forEach(source => {
        const key = source.Name.toLowerCase();
        sources.set(key, { ...source });
        clearedNames.delete(key);
      });

      result.credentials.forEach((cred, name) => {
        credentials.set(name.toLowerCase(), cred);
      });

      result.disabledSources.forEach(name => {
        disabledSources.add(name.toLowerCase());
      });
    }

    credentials.forEach((cred, key) => {
      const source = sources.get(key);
      if (source) {
        source.Username = cred.Username;
        source.Password = cred.Password;
      }
    });

    // Keep the order in which the sources appear, starting with the closest config file
    const ordered: SourceWithCredentials[] = [];
    const seen = new Set<string>();
    for (const result of parsedFiles) {
      for (const declared of result.sources) {
        const key = declared.Name.toLowerCase();
        const source = sources.get(key);
        if (source && !seen.has(key) && !disabledSources.has(key)) {
          seen.add(key);
          ordered.push(source);
        }
      }
    }

    return {
      sources: ordered,
      blockedNames: new Set([...disabledSources, ...clearedNames]),
    };
  }

  /**
   * Config files that apply to startDir, highest priority first: like NuGet, every folder from
   * startDir up to the file system root, then the user and the machine config.
   */
  private static FindAllConfigFiles(startDir?: string): string[] {
    const configPaths: string[] = [];
    const add = (candidate: string) => {
      if (fs.existsSync(candidate) && !configPaths.includes(path.resolve(candidate))) {
        configPaths.push(path.resolve(candidate));
        return true;
      }
      return false;
    };

    // 1. The folder and its parents (closest first)
    if (startDir) {
      let currentDir = path.resolve(startDir);
      for (;;) {
        // The legacy .nuget folder ranks above the folder's own file
        for (const filename of this.CONFIG_FILENAMES) {
          if (add(path.join(currentDir, ".nuget", filename))) break;
        }
        for (const filename of this.CONFIG_FILENAMES) {
          if (add(path.join(currentDir, filename))) break;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
      }
    }

    // 2. User config
    const userProfile = os.homedir();
    
    // On Windows, check %APPDATA%\NuGet\NuGet.Config first (Windows 11 standard location)
    if (process.platform === "win32" && process.env.APPDATA) {
      add(path.join(process.env.APPDATA, "NuGet", "NuGet.Config"));
    }
    
    // Fallback to ~/.nuget/NuGet/NuGet.Config (older Windows or Unix systems)
    add(path.join(userProfile, ".nuget", "NuGet", "NuGet.Config"));
    
    // On macOS/Linux, also check ~/.config/NuGet/NuGet.Config
    if (process.platform !== "win32") {
      add(path.join(userProfile, ".config", "NuGet", "NuGet.Config"));
    }

    // 3. Machine config (Windows only, lowest priority)
    if (process.platform === "win32") {
      const programFiles = process.env["ProgramFiles(x86)"] || process.env["ProgramFiles"];
      if (programFiles) {
        // Every .config file there applies, not only the one Visual Studio installs
        const machineDir = path.join(programFiles, "NuGet", "Config");
        let names: string[] = [];
        try {
          names = fs.readdirSync(machineDir).filter((name) => name.toLowerCase().endsWith(".config"));
        } catch {
          // No machine-wide configuration
        }
        names.sort((a, b) => a.localeCompare(b)).forEach((name) => add(path.join(machineDir, name)));
      }
    }

    return configPaths;
  }


  private static async ParseConfigFile(configPath: string): Promise<ParsedConfigFile> {
    const content = await fs.promises.readFile(configPath, "utf8");
    const document = new DOMParser().parseFromString(content);

    const sources: SourceWithCredentials[] = [];
    const credentials = new Map<string, { Username?: string; Password?: string }>();
    const disabledSources: string[] = [];
    let clear = false;

    // Children are read in document order: a <clear/> also drops the <add> entries above it
    const sourceNodes = xpath.select("//packageSources/*[local-name()='add' or local-name()='clear']", document) as Node[];
    sourceNodes.forEach((node: any) => {
      if (node.localName === "clear") {
        clear = true;
        sources.length = 0;
        return;
      }

      const name = node.attributes?.getNamedItem("key")?.value;
      const url = node.attributes?.getNamedItem("value")?.value;

      if (name && url) {
        sources.push({
          Name: name,
          Url: resolveLocalSource(url, path.dirname(configPath)),
        });
      }
    });

    const disabledNodes = xpath.select("//disabledPackageSources/add", document) as Node[];
    disabledNodes.forEach((node: any) => {
      const name = node.attributes?.getNamedItem("key")?.value;
      const disabled = node.attributes?.getNamedItem("value")?.value;

      if (name && disabled?.trim().toLowerCase() === "true") {
        disabledSources.push(name);
      }
    });

    const credentialNodes = xpath.select("//packageSourceCredentials/*", document) as Node[];
    credentialNodes.forEach((sourceNode: any) => {
      const parsed = this.ParseCredentialNode(sourceNode);
      if (parsed) {
        credentials.set(parsed.name, parsed.cred);
      }
    });
    return { sources, credentials, disabledSources, clear };
  }

  private static ParseCredentialNode(sourceNode: Node & { nodeName: string }): {
    name: string;
    cred: { Username?: string; [key: string]: string | undefined };
  } | null {
    // NuGet stores the source name as an XML element name, encoding characters that are not
    // allowed there: "My Feed" becomes <My_x0020_Feed>
    const sourceName = sourceNode.nodeName.replace(/_x([0-9A-Fa-f]{4})_/g, (_match: string, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    const user = xpath.select("string(add[@key='Username']/@value)", sourceNode) as string;

    // NuGet configs use "ClearTextPassword" for plain text and "Password" for encrypted values
    const clearKey = "ClearText" + "Password";
    const encKey = "Pass" + "word";
    let authToken = xpath.select(`string(add[@key='${clearKey}']/@value)`, sourceNode) as string;
    if (!authToken) {
      authToken = xpath.select(`string(add[@key='${encKey}']/@value)`, sourceNode) as string;
    }

    // Resolve environment variable references like %VAR_NAME%
    if (authToken) {
      authToken = authToken.replace(/%([^%]+)%/g, (_match, varName) => process.env[varName] ?? "");
    }

    if (!user && !authToken) return null;

    const cred: { Username?: string; [key: string]: string | undefined } = {};
    if (user) cred.Username = user;
    if (authToken) cred[encKey] = authToken;
    return { name: sourceName, cred };
  }

  static ClearCache(): void {
    CredentialsCache.clear();
    this.resolvedCache.clear();
    this.workspaceDirs = null;
  }
}
