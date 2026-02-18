import fs from "fs";
import * as path from "path";
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import os from "os";
import * as vscode from "vscode";
import PasswordScriptExecutor from "./password-script-executor";
import CredentialsCache from "./credentials-cache";
import { Logger } from "../../common/logger";

export type SourceWithCredentials = {
  Name: string;
  Url: string;
  Username?: string;
  Password?: string;
};

export default class NuGetConfigResolver {
  private static configCache: Map<string, SourceWithCredentials[]> = new Map();
  private static readonly CONFIG_FILENAMES = ["nuget.config", "NuGet.Config", "NuGet.config"];

  static async GetSourcesAndDecodePasswords(workspaceRoot?: string): Promise<SourceWithCredentials[]> {
    Logger.debug(`NuGetConfigResolver.GetSourcesAndDecodePasswords: Starting resolution (workspaceRoot: ${workspaceRoot})`);
    const config = vscode.workspace.getConfiguration("NugetWorkbench");
    const sourcesMap = new Map<string, SourceWithCredentials>();
    
    const sourcesWithCreds = await this.GetSourcesWithCredentials(workspaceRoot);

    sourcesWithCreds.forEach(s => {
      sourcesMap.set(s.Name, {
        Name: s.Name,
        Url: s.Url,
        Username: s.Username,
        Password: s.Password,
      });
    });

    const vscodeSourcesRaw = config.get<Array<string>>("sources") ?? [];
    const passwordScriptPaths = new Map<string, string>();
    
    vscodeSourcesRaw.forEach((x) => {
      try {
        const parsed = JSON.parse(x) as { 
          name?: string; 
          url?: string; 
          passwordScriptPath?: string;
        };
        Logger.debug(`NuGetConfigResolver.GetSourcesAndDecodePasswords: Found source from setting: ${parsed.name}`);
        if (parsed.name) {
          const existingSource = sourcesMap.get(parsed.name);
          if (existingSource) {
            if (parsed.passwordScriptPath) {
              passwordScriptPaths.set(parsed.name, parsed.passwordScriptPath);
            }
          } else if (parsed.url) {
            sourcesMap.set(parsed.name, {
              Name: parsed.name,
              Url: parsed.url,
            });
            if (parsed.passwordScriptPath) {
              passwordScriptPaths.set(parsed.name, parsed.passwordScriptPath);
            }
          }
        }
      } catch { /* ignore unparseable source entries */ }
    });

    const sources = Array.from(sourcesMap.values());

    for (const source of sources) {
      const passwordScriptPath = passwordScriptPaths.get(source.Name);
      
      if (passwordScriptPath && source.Password) {
        try {
          Logger.debug(`NuGetConfigResolver.GetSourcesAndDecodePasswords: Decoding password for ${source.Name}`);
          const decodedPassword = await PasswordScriptExecutor.ExecuteScript(
            passwordScriptPath,
            source.Password
          );
          source.Password = decodedPassword;
          CredentialsCache.set(source.Name, source.Username, decodedPassword);
        } catch (error) {
          Logger.error(`NuGetConfigResolver.GetSourcesAndDecodePasswords: Failed to decode password for ${source.Name}`, error);
          CredentialsCache.set(source.Name, source.Username, source.Password);
        }
      } else if (source.Username || source.Password) {
        Logger.debug(`NuGetConfigResolver.GetSourcesAndDecodePasswords: Caching credentials for ${source.Name}`);
        CredentialsCache.set(source.Name, source.Username, source.Password);
      }
    }

    return sources;
  }

  static async GetSourcesWithCredentials(workspaceRoot?: string): Promise<SourceWithCredentials[]> {
    Logger.debug(`NuGetConfigResolver.GetSourcesWithCredentials: Starting resolution (workspaceRoot: ${workspaceRoot})`);
    const sources = new Map<string, SourceWithCredentials>();
    const disabledSources = new Set<string>();
    const credentials = new Map<string, { Username?: string; Password?: string }>();

    const configPaths = this.FindAllConfigFiles(workspaceRoot);
    Logger.debug(`NuGetConfigResolver.GetSourcesWithCredentials: Found config files: ${configPaths.join(", ")}`);

    for (const configPath of configPaths) {
      try {
        Logger.debug(`NuGetConfigResolver.GetSourcesWithCredentials: Parsing ${configPath}`);
        const result = await this.ParseConfigFile(configPath);
        
        if (result.clear) {
          Logger.debug(`NuGetConfigResolver.GetSourcesWithCredentials: 'clear' found in ${configPath}, clearing sources`);
          sources.clear();
          disabledSources.clear();
        }

        result.sources.forEach(source => {
          sources.set(source.Name, source);
        });

        result.credentials.forEach((cred, name) => {
          credentials.set(name, cred);
        });

        result.disabledSources.forEach(name => {
          disabledSources.add(name);
        });
      } catch (error) {
        Logger.error(`NuGetConfigResolver.GetSourcesWithCredentials: Failed to parse ${configPath}`, error);
      }
    }

    credentials.forEach((cred, sourceName) => {
      const source = sources.get(sourceName);
      if (source) {
        source.Username = cred.Username;
        source.Password = cred.Password;
      }
    });

    const enabledSources = Array.from(sources.values()).filter(
      source => !disabledSources.has(source.Name)
    );
    
    return enabledSources;
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


  private static async ParseConfigFile(configPath: string): Promise<{
    sources: SourceWithCredentials[];
    credentials: Map<string, { Username?: string; Password?: string }>;
    disabledSources: string[];
    clear: boolean;
  }> {
    const content = await fs.promises.readFile(configPath, "utf8");
    const document = new DOMParser().parseFromString(content);

    const sources: SourceWithCredentials[] = [];
    const credentials = new Map<string, { Username?: string; Password?: string }>();
    const disabledSources: string[] = [];
    let clear = false;

    const clearNode = xpath.select("//packageSources/clear", document);
    if (clearNode && (clearNode as Node[]).length > 0) {
      clear = true;
    }

    const sourceNodes = xpath.select("//packageSources/add", document) as Node[];
    sourceNodes.forEach((node: any) => {
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

      if (name && disabled === "true") {
        disabledSources.push(name);
      }
    });

    const credentialNodes = xpath.select("//packageSourceCredentials/*", document) as Node[];
    credentialNodes.forEach((sourceNode: any) => {
      const sourceName = sourceNode.nodeName;
      const username = xpath.select("string(add[@key='Username']/@value)", sourceNode) as string;
      const password = xpath.select("string(add[@key='Password']/@value)", sourceNode) as string;

      if (username || password) {
        credentials.set(sourceName, {
          Username: username || undefined,
          Password: password || undefined,
        });
      }
    });
    return { sources, credentials, disabledSources, clear };
  }

  static ClearCache(): void {
    this.configCache.clear();
  }
}
