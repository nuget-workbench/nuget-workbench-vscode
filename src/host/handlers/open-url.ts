import { IRequestHandler } from "@/common/messaging/core/types";
import * as vscode from "vscode";
import { Logger } from "../../common/logger";

export default class OpenUrl implements IRequestHandler<OpenUrlRequest, OpenUrlResponse> {
  async HandleAsync(request: OpenUrlRequest): Promise<OpenUrlResponse> {
    Logger.info(`OpenUrl.HandleAsync: Opening external URL ${request.Url}`);
    vscode.env.openExternal(vscode.Uri.parse(request.Url));
    return {};
  }
}
