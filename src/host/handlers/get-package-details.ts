import { IRequestHandler } from "@/common/messaging/core/types";
import nugetApiFactory from "../nuget/api-factory";
import * as vscode from "vscode";
import { Logger } from "../../common/logger";

export class GetPackageDetails
  implements IRequestHandler<GetPackageDetailsRequest, GetPackageDetailsResponse>
{
  async HandleAsync(request: GetPackageDetailsRequest): Promise<GetPackageDetailsResponse> {
    Logger.info(`GetPackageDetails.HandleAsync: Fetching details from ${request.PackageVersionUrl}`);
    if (!request.SourceUrl) return this.GetError("SourceUrl is empty");
    if (!request.PackageVersionUrl) return this.GetError("PackageVersionUrl is empty");

    let api = await nugetApiFactory.GetSourceApi(request.SourceUrl);
    try {
      let packageDetails = await api.GetPackageDetailsAsync(request.PackageVersionUrl);
      let result: GetPackageDetailsResponse = {
        IsFailure: false,
        Package: packageDetails.data,
      };
      return result;
    } catch (err: any) {
      Logger.error(`GetPackageDetails.HandleAsync: Failed to fetch package details from ${request.PackageVersionUrl}`, err);
      return this.GetError('Failed to fetch package details');
    }
  }

  private GetError(error: string): GetPackageDetailsResponse {
    let result: GetPackageDetailsResponse = {
      IsFailure: true,
      Error: {
        Message: error,
      },
    };
    return result;
  }
}
