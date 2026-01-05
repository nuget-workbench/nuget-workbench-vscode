import { IRequestHandler } from "@/common/messaging/core/types";
import * as vscode from "vscode";
import ProjectParser from "../utilities/project-parser";
import TaskExecutor from "../utilities/task-executor";
import CpmResolver from "../utilities/cpm-resolver";
import nugetApiFactory from "../nuget/api-factory";
import { Logger } from "../../common/logger";

export default class UpdateProject implements IRequestHandler<UpdateProjectRequest, UpdateProjectResponse> {
  async HandleAsync(request: UpdateProjectRequest): Promise<UpdateProjectResponse> {
    Logger.info(`UpdateProject.HandleAsync: Handling ${request.Type} for package ${request.PackageId} in project ${request.ProjectPath}`);
    const skipRestoreConfiguration = vscode.workspace.getConfiguration("NugetGallery").get<string>("skipRestore") ?? "";
    const isCpmEnabled = CpmResolver.GetPackageVersions(request.ProjectPath) !== null;

    // Don't use --no-restore with CPM as it causes version to be added to csproj
    const skipRestore: boolean = !!skipRestoreConfiguration && !isCpmEnabled;
    
    if (request.Type === "UPDATE") {
      await this.RemovePackage(request);
      await this.AddPackage(request, skipRestore);
    } else if (request.Type === "UNINSTALL") {
      await this.RemovePackage(request);
    } else {
      await this.AddPackage(request, skipRestore);
    }

    CpmResolver.ClearCache();
    nugetApiFactory.ClearCache();

    const cpmVersions = CpmResolver.GetPackageVersions(request.ProjectPath);
    let updatedProject = ProjectParser.Parse(request.ProjectPath, cpmVersions);
    let result: UpdateProjectResponse = {
      Project: updatedProject,
      IsCpmEnabled: isCpmEnabled,
    };
    return result;
  }

  // REMOVE: .NET 10 format: dotnet package remove <PACKAGE_ID> --project <PROJECT>
  private async RemovePackage(request: UpdateProjectRequest): Promise<void> {
    Logger.info(`UpdateProject.RemovePackage: Removing package ${request.PackageId}`);
    const args: Array<string> = ["package", "remove", request.PackageId, "--project", request.ProjectPath.replace(/\\/g, "/")];
    Logger.debug(`UpdateProject.RemovePackage: Executing: dotnet ${args.join(" ")}`);
    const task = new vscode.Task(
      { type: "dotnet", task: `dotnet remove package` },
      vscode.TaskScope.Workspace,
      "nuget-gallery",
      "dotnet",
      new vscode.ShellExecution("dotnet", args)
    );
    task.presentationOptions.reveal = vscode.TaskRevealKind.Silent;
    await TaskExecutor.ExecuteTask(task);
  }

  // INSTALL: .NET 10 format: dotnet package add <PACKAGE_ID> --project <PROJECT> --version <VERSION>
  private async AddPackage(request: UpdateProjectRequest, skipRestore: boolean): Promise<void> {
    Logger.info(`UpdateProject.AddPackage: Adding package ${request.PackageId} version ${request.Version || 'latest'}`);
    const args: Array<string> = ["package", "add", request.PackageId, "--project", request.ProjectPath.replace(/\\/g, "/")];
    if (request.Version) {
        args.push("--version");
        args.push(request.Version);
      }
    if (skipRestore) {
      args.push("--no-restore");
    }

    Logger.debug(`UpdateProject.AddPackage: Executing: dotnet ${args.join(" ")}`);

    const task = new vscode.Task(
      { type: "dotnet", task: `dotnet add package` },
      vscode.TaskScope.Workspace,
      "nuget-gallery",
      "dotnet",
      new vscode.ShellExecution("dotnet", args)
    );
    task.presentationOptions.reveal = vscode.TaskRevealKind.Silent;
    await TaskExecutor.ExecuteTask(task);
  }
}
