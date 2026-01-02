import { IRequestHandler } from "@/common/messaging/core/types";
import * as vscode from "vscode";
import NuGetConfigResolver from "../utilities/nuget-config-resolver";
import { Logger } from "../../common/logger";

export default class GetConfiguration implements IRequestHandler<GetConfigurationRequest, GetConfigurationResponse> {
  async HandleAsync(request: GetConfigurationRequest): Promise<GetConfigurationResponse> {
    Logger.info("GetConfiguration: Retrieving configuration");
    let config = vscode.workspace.getConfiguration("NugetGallery");
    try {
      await config.update("sources", undefined, vscode.ConfigurationTarget.Workspace);
      await config.update("skipRestore", undefined, vscode.ConfigurationTarget.Workspace);
    } catch {}
    config = vscode.workspace.getConfiguration("NugetGallery");

    // Get sources from NuGet.config and VSCode settings, decode passwords
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath;
    const sourcesWithCreds = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceRoot);

    // Strip credentials before sending to webview (security)
    const sources: Source[] = sourcesWithCreds.map(s => ({
      Name: s.Name,
      Url: s.Url,
    }));

    // Add passwordScriptPath from VSCode settings
    const vscodeSourcesRaw = config.get<Array<string>>("sources") ?? [];
    vscodeSourcesRaw.forEach((rawSourceConfig) => {
      try {
        const parsed = JSON.parse(rawSourceConfig) as {
          name?: string;
          passwordScriptPath?: string;
        };
        if (parsed.name && parsed.passwordScriptPath) {
          const source = sources.find(s => s.Name === parsed.name);
          if (source) {
            source.PasswordScriptPath = parsed.passwordScriptPath;
          }
        }
      } catch (e) {
        Logger.warn(`GetConfiguration: Failed to parse source configuration: ${rawSourceConfig}`, e);
      }
    });

    let result: GetConfigurationResponse = {
      Configuration: {
        SkipRestore: config.get("skipRestore") ?? false,
        Sources: sources,
      },
    };

    return result;
  }
}
