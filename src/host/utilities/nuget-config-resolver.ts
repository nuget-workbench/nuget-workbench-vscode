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

type ResolvedConfig = {
  sources: SourceWithCredentials[];
  /** Lowercase names that a nuget.config disables or removes with <clear/>. */
  blockedNames: Set<string>;
};

export default class NuGetConfigResolver {
  private static readonly CONFIG_FILENAMES = ["nuget.config", "NuGet.Config", "NuGet.config"];

  static async GetSourcesAndDecodePasswords(workspaceRoot?: string): Promise<SourceWithCredentials[]> {
    return this.GetSources(workspaceRoot, true);
  }

  /**
   * Merges the nuget.config sources with the extension's "sources" setting. Sources from the
   * setting only add new names (and password scripts for existing ones); a name that a
   * nuget.config disables or clears is not brought back by the setting.
   */
  static async GetSources(workspaceRoot: string | undefined, decodePasswords: boolean): Promise<SourceWithCredentials[]> {
    Logger.debug(`NuGetConfigResolver.GetSources: Starting resolution (workspaceRoot: ${workspaceRoot})`);
    const config = vscode.workspace.getConfiguration("NugetWorkbench");
    // NuGet source names are case-insensitive
    const sourcesMap = new Map<string, SourceWithCredentials>();
    
    const sourcesWithCreds = await this.GetSourcesWithCredentials(workspaceRoot);
    const blockedNames = await this.GetBlockedSourceNames(workspaceRoot);

    sourcesWithCreds.forEach(s => {
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
          } else if (parsed.url && !blockedNames.has(key)) {
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

    const sources = Array.from(sourcesMap.values());
    if (!decodePasswords) {
      return sources;
    }

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

    return sources;
  }

  static async GetSourcesWithCredentials(workspaceRoot?: string): Promise<SourceWithCredentials[]> {
    return (await this.ResolveConfigFiles(workspaceRoot)).sources;
  }

  /** Lowercase names of sources that a nuget.config disables or removes with <clear/>. */
  static async GetBlockedSourceNames(workspaceRoot?: string): Promise<Set<string>> {
    return (await this.ResolveConfigFiles(workspaceRoot)).blockedNames;
  }

  private static async ResolveConfigFiles(workspaceRoot?: string): Promise<ResolvedConfig> {
    Logger.debug(`NuGetConfigResolver.ResolveConfigFiles: Starting resolution (workspaceRoot: ${workspaceRoot})`);
    const configPaths = this.FindAllConfigFiles(workspaceRoot);
    Logger.debug(`NuGetConfigResolver.ResolveConfigFiles: Found config files: ${configPaths.join(", ")}`);

    // Highest priority (closest to the workspace) first
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
    // (workspace): a closer file overrides a source with the same key, and its <clear/>
    // drops every source inherited from the files further away. Keys are case-insensitive.
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

  private static FindAllConfigFiles(workspaceRoot?: string): string[] {
    const configPaths: string[] = [];

    // 1. Workspace config (highest priority)
    if (workspaceRoot) {
      for (const filename of this.CONFIG_FILENAMES) {
        const workspaceConfig = path.join(workspaceRoot, filename);
        if (fs.existsSync(workspaceConfig)) {
          configPaths.unshift(workspaceConfig);
          break;
        }
      }

      for (const filename of this.CONFIG_FILENAMES) {
        const nugetFolderConfig = path.join(workspaceRoot, ".nuget", filename);
        if (fs.existsSync(nugetFolderConfig)) {
          configPaths.unshift(nugetFolderConfig);
          break;
        }
      }
    }

    // 2. User config
    const userProfile = os.homedir();
    
    // On Windows, check %APPDATA%\NuGet\NuGet.Config first (Windows 11 standard location)
    if (process.platform === "win32" && process.env.APPDATA) {
      const appDataConfigPath = path.join(process.env.APPDATA, "NuGet", "NuGet.Config");
      if (fs.existsSync(appDataConfigPath)) {
        configPaths.push(appDataConfigPath);
      }
    }
    
    // Fallback to ~/.nuget/NuGet/NuGet.Config (older Windows or Unix systems)
    const userConfigPath = path.join(userProfile, ".nuget", "NuGet", "NuGet.Config");
    if (fs.existsSync(userConfigPath)) {
      configPaths.push(userConfigPath);
    }
    
    // On macOS/Linux, also check ~/.config/NuGet/NuGet.Config
    if (process.platform !== "win32") {
      const configDirPath = path.join(userProfile, ".config", "NuGet", "NuGet.Config");
      if (fs.existsSync(configDirPath)) {
        configPaths.push(configDirPath);
      }
    }

    // 3. Machine config (Windows only, lowest priority)
    if (process.platform === "win32") {
      const programFiles = process.env["ProgramFiles(x86)"] || process.env["ProgramFiles"];
      if (programFiles) {
        const machineConfigPath = path.join(programFiles, "NuGet", "Config", "Microsoft.VisualStudio.Offline.config");
        if (fs.existsSync(machineConfigPath)) {
          configPaths.push(machineConfigPath);
        }
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
          Url: url,
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
  }
}
