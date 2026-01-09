import { IRequestHandler } from "@/common/messaging/core/types";
import { GetPackageRequest, GetPackageResponse } from "../../common/messaging/get-package";
import nugetApiFactory from "../nuget/api-factory";
import * as vscode from "vscode";
import { Logger } from "../../common/logger";
import NuGetConfigResolver from "../utilities/nuget-config-resolver";

export class GetPackage implements IRequestHandler<GetPackageRequest, GetPackageResponse> {
  async HandleAsync(request: GetPackageRequest): Promise<GetPackageResponse> {
    if (request.Url === "") {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const sources = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceRoot);

      for (const source of sources) {
        try {
          const packageResult = await this.fetchPackage(source.Url, request.Id, request.ForceReload);

          if (!packageResult.isError) {
            Logger.info(`GetPackage.HandleAsync: Successfully fetched package ${request.Id} from ${source.Url}`);
            return {
              IsFailure: false,
              Package: packageResult.data,
              SourceUrl: source.Url,
            };
          }
        } catch (err) {
          Logger.warn(`GetPackage.HandleAsync: Failed to fetch package ${request.Id} from ${source.Url}. Trying next source.`);
        }
      }

      return {
        IsFailure: true,
        Error: {
          Message: "Failed to fetch package from any source",
        },
      };
    }

    try {
      const packageResult = await this.fetchPackage(request.Url, request.Id, request.ForceReload);

      if (packageResult.isError) {
        Logger.error(`GetPackage.HandleAsync: Failed to fetch package ${request.Id} from ${request.Url}`);
        return {
          IsFailure: true,
          Error: {
            Message: "Failed to fetch package",
          },
        };
      }

      Logger.info(`GetPackage.HandleAsync: Successfully fetched package ${request.Id}`);
      let result: GetPackageResponse = {
        IsFailure: false,
        Package: packageResult.data,
        SourceUrl: request.Url,
      };
      return result;
    } catch (err: any) {
      Logger.error(`GetPackage.HandleAsync: Exception while fetching package ${request.Id} from ${request.Url}`, err);
      let result: GetPackageResponse = {
        IsFailure: true,
        Error: {
          Message: "Failed to fetch package",
        },
      };
      return result;
    }
  }

  private async fetchPackage(sourceUrl: string, packageId: string, forceReload: boolean = false) {
    Logger.info(`GetPackage.HandleAsync: Fetching package ${packageId} from ${sourceUrl}`);
    let api = await nugetApiFactory.GetSourceApi(sourceUrl);
    if (forceReload) {
      api.ClearPackageCache(packageId);
    }
    return await api.GetPackageAsync(packageId);
  }
}
