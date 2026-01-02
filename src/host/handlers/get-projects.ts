import * as vscode from "vscode";
import { IRequestHandler } from "../../common/messaging/core/types";
import ProjectParser from "../utilities/project-parser";
import CpmResolver from "../utilities/cpm-resolver";
import { Logger } from "../../common/logger";


export class GetProjects implements IRequestHandler<GetProjectsRequest, GetProjectsResponse> {
  async HandleAsync(request: GetProjectsRequest): Promise<GetProjectsResponse> {
    Logger.info("GetProjects.HandleAsync: Handling request");
    let projectFiles = await vscode.workspace.findFiles(
      "**/*.{csproj,fsproj,vbproj}",
      "**/node_modules/**"
    );

    Logger.info(`GetProjects.HandleAsync: Found ${projectFiles.length} project files`);

    let projects: Array<Project> = Array();
    projectFiles
      .map((x) => x.fsPath)
      .forEach((x) => {
        try {
          const cpmVersions = CpmResolver.GetPackageVersions(x);
          let project = ProjectParser.Parse(x, cpmVersions);
          projects.push(project);
        } catch (e) {
          Logger.error(`GetProjects.HandleAsync: Failed to parse project ${x}`, e);
        }
      });
    let compareName = (nameA: string, nameB: string) => {
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    };
    let sortedProjects = projects.sort((a, b) =>
      compareName(a.Name?.toLowerCase(), b.Name?.toLowerCase())
    );

    let response: GetProjectsResponse = {
      Projects: sortedProjects,
    };
    return response;
  }
}
