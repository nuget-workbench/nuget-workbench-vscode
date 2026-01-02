import { IRequestHandler } from "@/common/messaging/core/types";
import * as vscode from "vscode";
import { Logger } from "../../common/logger";
export default class UpdateConfiguration
  implements IRequestHandler<UpdateConfigurationRequest, UpdateConfigurationResponse>
{
  async HandleAsync(request: UpdateConfigurationRequest): Promise<UpdateConfigurationResponse> {
    Logger.info("UpdateConfiguration: Updating configuration");
    let config = vscode.workspace.getConfiguration("NugetGallery");

    let sources = request.Configuration.Sources.map((x) => 
      JSON.stringify({ 
        name: x.Name, 
        url: x.Url,
        ...(x.PasswordScriptPath && { passwordScriptPath: x.PasswordScriptPath })
      })
    );

    await config.update("skipRestore", request.Configuration.SkipRestore, vscode.ConfigurationTarget.Global);
    await config.update("sources", sources, vscode.ConfigurationTarget.Global);
    Logger.info("UpdateConfiguration: Configuration updated successfully");
    return {};
  }
}
