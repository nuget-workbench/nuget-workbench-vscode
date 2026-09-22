import * as vscode from "vscode";
import type {
  HostAPI,
  GetProjectsRequest,
  GetProjectsResponse,
  GetPackagesRequest,
  GetPackagesResponse,
  GetPackageRequest,
  GetPackageResponse,
  GetPackageDetailsRequest,
  GetPackageDetailsResponse,
  UpdateProjectRequest,
  UpdateProjectResponse,
  GetConfigurationResponse,
  UpdateConfigurationRequest,
  OpenUrlRequest,
  UpdateStatusBarRequest,
  GetOutdatedPackagesRequest,
  GetOutdatedPackagesResponse,
  BatchUpdateRequest,
  BatchUpdateResponse,
  GetInconsistentPackagesRequest,
  GetInconsistentPackagesResponse,
  ConsolidateRequest,
  GetVulnerablePackagesRequest,
  GetVulnerablePackagesResponse,
  ShowConfirmationRequest,
  ShowConfirmationResponse,
} from "@/common/rpc/types";
import type { Result } from "@/common/rpc/result";
import { ok, fail } from "@/common/rpc/result";
import ProjectParser from "./utilities/project-parser";
import CpmResolver from "./utilities/cpm-resolver";
import nugetApiFactory from "./nuget/api-factory";
import NuGetConfigResolver from "./utilities/nuget-config-resolver";
import TaskExecutor from "./utilities/task-executor";
import StatusBarUtils from "./utilities/status-bar-utils";
import { Logger } from "../common/logger";
import { AxiosError } from "axios";
import { compareVersions, isNonConcreteVersion, isVersionInRange } from "../common/version";

function extractResponseDetail(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    // GitLab: { error: "invalid_token", error_description: "Token is expired..." }
    if (obj.error_description) return String(obj.error_description);
    if (obj.error && typeof obj.error === "string") return String(obj.error);
    if (obj.message) return String(obj.message);
  }
  return "";
}

function formatApiError(err: unknown): string {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    const url = err.config?.url ?? "unknown URL";
    const detail = extractResponseDetail(err.response?.data);
    const suffix = detail ? ` (${detail})` : "";
    if (status === 401) {
      return `Authentication failed (401) for ${url}.${suffix || " Check your credentials or access token."}`;
    }
    if (status === 403) {
      return `Access denied (403) for ${url}.${suffix || " Your token may lack the required permissions."}`;
    }
    if (status === 404) {
      return `Source not found (404): ${url}${suffix}`;
    }
    if (status) {
      return `HTTP ${status} from ${url}: ${err.message}${suffix}`;
    }
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
      return `Cannot connect to ${url} (${err.code}). Check your network or source URL.`;
    }
    return `Network error for ${url}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export function createHostAPI(): HostAPI {
  return {
    async getProjects(request: GetProjectsRequest): Promise<Result<GetProjectsResponse>> {
      Logger.info("getProjects: Handling request");
      if (request.ForceReload) {
        CpmResolver.ClearCache();
      }

      const projectFiles = await vscode.workspace.findFiles(
        "**/*.{csproj,fsproj,vbproj}",
        "**/node_modules/**"
      );

      Logger.info(`getProjects: Found ${projectFiles.length} project files`);

      const projects: Project[] = [];
      for (const file of projectFiles) {
        try {
          const cpmVersions = await CpmResolver.GetPackageVersions(file.fsPath);
          const project = await ProjectParser.Parse(file.fsPath, cpmVersions);
          project.CpmEnabled = cpmVersions !== null;
          projects.push(project);
        } catch (e) {
          Logger.error(`getProjects: Failed to parse project ${file.fsPath}`, e);
        }
      }

      const sorted = projects.sort((a, b) =>
        a.Name?.toLowerCase().localeCompare(b.Name?.toLowerCase())
      );

      return ok({ Projects: sorted });
    },

    async getPackages(request: GetPackagesRequest): Promise<Result<GetPackagesResponse>> {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      StatusBarUtils.show(0, "Loading packages...");

      try {
        if (request.ForceReload) {
          nugetApiFactory.ClearCache();
        }

        if (request.Url === "") {
          const sources = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceRoot);

          if (!request.Filter) {
            if (sources.length > 0) {
              request.Url = sources[0].Url;
            } else {
              return ok({ Packages: [] });
            }
          } else {
            let completed = 0;
            const promises = sources.map(async (source) => {
              try {
                const api = await nugetApiFactory.GetSourceApi(source.Url);
                return await api.GetPackagesAsync(
                  request.Filter,
                  request.Prerelease,
                  request.Skip,
                  request.Take
                );
              } catch (error) {
                Logger.error(`getPackages: Failed to fetch from ${source.Url}`, error);
                return { data: [] };
              } finally {
                completed++;
                StatusBarUtils.show((completed / sources.length) * 100, "Loading packages...");
              }
            });

            const results = await Promise.all(promises);
            const allPackages: Package[] = [];
            const seenIds = new Set<string>();

            for (const result of results) {
              for (const pkg of result.data) {
                if (!seenIds.has(pkg.Id)) {
                  seenIds.add(pkg.Id);
                  allPackages.push(pkg);
                }
              }
            }

            return ok({ Packages: allPackages });
          }
        }

        Logger.info(`getPackages: Fetching from ${request.Url} with filter '${request.Filter}'`);
        const api = await nugetApiFactory.GetSourceApi(request.Url);
        const packages = await api.GetPackagesAsync(
          request.Filter,
          request.Prerelease,
          request.Skip,
          request.Take
        );
        Logger.info(`getPackages: Successfully fetched ${packages.data.length} packages`);
        return ok({ Packages: packages.data });
      } catch (err: unknown) {
        Logger.error(`getPackages: Failed`, err);
        const detail = formatApiError(err);
        return fail(detail);
      } finally {
        StatusBarUtils.hide();
      }
    },

    async getPackage(request: GetPackageRequest): Promise<Result<GetPackageResponse>> {
      if (request.Url === "") {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const sources = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceRoot);

        for (const source of sources) {
          try {
            const api = await nugetApiFactory.GetSourceApi(source.Url);
            if (request.ForceReload) {
              api.ClearPackageCache(request.Id);
            }
            const packageResult = await api.GetPackageAsync(request.Id, request.Prerelease);

            if (!packageResult.isError && packageResult.data) {
              Logger.info(`getPackage: Found ${request.Id} in ${source.Url}`);
              return ok({ Package: packageResult.data, SourceUrl: source.Url });
            }
          } catch {
            Logger.warn(`getPackage: ${request.Id} not in ${source.Url}, trying next`);
          }
        }

        return fail("Failed to fetch package from any source");
      }

      try {
        const api = await nugetApiFactory.GetSourceApi(request.Url);
        if (request.ForceReload) {
          api.ClearPackageCache(request.Id);
        }
        const packageResult = await api.GetPackageAsync(request.Id, request.Prerelease);

        if (packageResult.isError || !packageResult.data) {
          return fail("Failed to fetch package");
        }

        Logger.info(`getPackage: Successfully fetched ${request.Id}`);
        return ok({ Package: packageResult.data, SourceUrl: request.Url });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error(`getPackage: Exception for ${request.Id}`, err);
        return fail(`Failed to fetch package: ${message}`);
      }
    },

    async getPackageDetails(request: GetPackageDetailsRequest): Promise<Result<GetPackageDetailsResponse>> {
      if (!request.Url) return fail("SourceUrl is empty");
      if (!request.PackageVersionUrl) return fail("PackageVersionUrl is empty");

      try {
        const api = await nugetApiFactory.GetSourceApi(request.Url);
        const details = await api.GetPackageDetailsAsync(request.PackageVersionUrl);
        return ok({ Package: details.data });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error(`getPackageDetails: Failed for ${request.PackageVersionUrl}`, err);
        return fail(`Failed to fetch package details: ${message}`);
      }
    },

    async updateProject(request: UpdateProjectRequest): Promise<Result<UpdateProjectResponse>> {
      Logger.info(`updateProject: ${request.Type} ${request.PackageId} in ${request.ProjectPath}`);
      const skipRestoreConfig = vscode.workspace.getConfiguration("NugetWorkbench").get<string>("skipRestore") ?? "";
      const isCpmEnabled = await CpmResolver.GetPackageVersions(request.ProjectPath) !== null;
      const skipRestore = !!skipRestoreConfig && !isCpmEnabled;

      try {
        if (request.Type === "UPDATE") {
          await executeAddPackage(request.PackageId, request.ProjectPath, request.Version, skipRestore, request.SourceUrl);
        } else if (request.Type === "UNINSTALL") {
          await executeRemovePackage(request.PackageId, request.ProjectPath);
        } else {
          await executeAddPackage(request.PackageId, request.ProjectPath, request.Version, skipRestore, request.SourceUrl);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(`Failed to ${request.Type.toLowerCase()} package: ${message}`);
      } finally {
        StatusBarUtils.hide();
      }

      CpmResolver.ClearCache();
      nugetApiFactory.ClearCache();

      const cpmVersions = await CpmResolver.GetPackageVersions(request.ProjectPath);
      const updatedProject = await ProjectParser.Parse(request.ProjectPath, cpmVersions);

      return ok({ Project: updatedProject, IsCpmEnabled: isCpmEnabled });
    },

    async getConfiguration(): Promise<Result<GetConfigurationResponse>> {
      Logger.info("getConfiguration: Retrieving configuration");
      const config = vscode.workspace.getConfiguration("NugetWorkbench");

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const sourcesWithCreds = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceRoot);

      const sources: Source[] = sourcesWithCreds.map((s) => ({
        Name: s.Name,
        Url: s.Url,
      }));

      const vscodeSourcesRaw = config.get<string[]>("sources") ?? [];
      for (const rawSourceConfig of vscodeSourcesRaw) {
        try {
          const parsed = JSON.parse(rawSourceConfig) as {
            name?: string;
            passwordScriptPath?: string;
          };
          if (parsed.name && parsed.passwordScriptPath) {
            const source = sources.find((s) => s.Name === parsed.name);
            if (source) {
              source.PasswordScriptPath = parsed.passwordScriptPath;
            }
          }
        } catch (e) {
          Logger.warn(`getConfiguration: Failed to parse source config: ${rawSourceConfig}`, e);
        }
      }

      return ok({
        Configuration: {
          SkipRestore: config.get("skipRestore") ?? false,
          EnablePackageVersionInlineInfo: config.get("enablePackageVersionInlineInfo") ?? false,
          Prerelease: config.get("prerelease") ?? false,
          Sources: sources,
          StatusBarLoadingIndicator: config.get("statusBarLoadingIndicator") ?? false,
        },
      });
    },

    async updateConfiguration(request: UpdateConfigurationRequest): Promise<Result<void>> {
      Logger.info("updateConfiguration: Updating configuration");
      const config = vscode.workspace.getConfiguration("NugetWorkbench");

      const sources = request.Configuration.Sources.map((x) =>
        JSON.stringify({
          name: x.Name,
          url: x.Url,
          ...(x.PasswordScriptPath && { passwordScriptPath: x.PasswordScriptPath }),
        })
      );

      await config.update("skipRestore", request.Configuration.SkipRestore, vscode.ConfigurationTarget.Global);
      await config.update("enablePackageVersionInlineInfo", request.Configuration.EnablePackageVersionInlineInfo, vscode.ConfigurationTarget.Global);
      await config.update("prerelease", request.Configuration.Prerelease, vscode.ConfigurationTarget.Global);
      await config.update("statusBarLoadingIndicator", request.Configuration.StatusBarLoadingIndicator, vscode.ConfigurationTarget.Global);
      await config.update("sources", sources, vscode.ConfigurationTarget.Global);
      Logger.info("updateConfiguration: Configuration updated successfully");
      return ok(undefined as void);
    },

    async openUrl(request: OpenUrlRequest): Promise<Result<void>> {
      Logger.info(`openUrl: Opening ${request.Url}`);
      vscode.env.openExternal(vscode.Uri.parse(request.Url));
      return ok(undefined as void);
    },

    async updateStatusBar(request: UpdateStatusBarRequest): Promise<Result<void>> {
      if (request.Percentage === null) {
        StatusBarUtils.hide();
      } else {
        StatusBarUtils.show(request.Percentage, request.Message);
      }
      return ok(undefined as void);
    },

    async getOutdatedPackages(request: GetOutdatedPackagesRequest): Promise<Result<GetOutdatedPackagesResponse>> {
      Logger.info("getOutdatedPackages: Checking for outdated packages");
      StatusBarUtils.show(0, "Checking for updates...");

      try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        let sources = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceRoot);

        if (request.SourceUrl) {
          sources = sources.filter((s) => s.Url === request.SourceUrl);
        }

        if (sources.length === 0) {
          return ok({ Packages: [] });
        }

        let projectFiles = await vscode.workspace.findFiles(
          "**/*.{csproj,fsproj,vbproj}",
          "**/node_modules/**"
        );

        if (request.ProjectPaths && request.ProjectPaths.length > 0) {
          projectFiles = projectFiles.filter((f) => request.ProjectPaths!.includes(f.fsPath));
        }

        const projects: Project[] = [];
        for (const file of projectFiles) {
          try {
            const cpmVersions = await CpmResolver.GetPackageVersions(file.fsPath);
            const project = await ProjectParser.Parse(file.fsPath, cpmVersions);
            project.CpmEnabled = cpmVersions !== null;
            projects.push(project);
          } catch (e) {
            Logger.error(`getOutdatedPackages: Failed to parse ${file.fsPath}`, e);
          }
        }

        // Keyed by lowercase package id; each project keeps its own installed version
        const installedMap = new Map<
          string,
          { id: string; projects: Array<{ Name: string; Path: string; Version: string }> }
        >();

        for (const project of projects) {
          for (const pkg of project.Packages) {
            if (!pkg.Version || pkg.IsPinned || isNonConcreteVersion(pkg.Version)) continue;

            const key = pkg.Id.toLowerCase();
            const projectInfo = { Name: project.Name, Path: project.Path, Version: pkg.Version };
            const existing = installedMap.get(key);

            if (existing) {
              existing.projects.push(projectInfo);
            } else {
              installedMap.set(key, { id: pkg.Id, projects: [projectInfo] });
            }
          }
        }

        Logger.info(`getOutdatedPackages: ${installedMap.size} unique packages to check`);

        const outdated: OutdatedPackage[] = [];
        const packageIds = Array.from(installedMap.keys());
        const batchSize = 5;

        for (let i = 0; i < packageIds.length; i += batchSize) {
          const batch = packageIds.slice(i, i + batchSize);
          const progress = Math.round(((i + batch.length) / packageIds.length) * 100);
          StatusBarUtils.show(progress, `Checking updates (${i + batch.length}/${packageIds.length})...`);

          const promises = batch.map(async (key) => {
            const installed = installedMap.get(key)!;
            const latest = await getLatestVersion(installed.id, request.Prerelease, sources);
            if (!latest) return;

            // Only projects that are actually behind the latest version are outdated
            const outdatedProjects = installed.projects.filter(
              (p) => compareVersions(latest.version, p.Version) > 0
            );
            if (outdatedProjects.length === 0) return;

            const lowestVersion = outdatedProjects
              .map((p) => p.Version)
              .reduce((min, v) => (compareVersions(v, min) < 0 ? v : min));

            outdated.push({
              Id: installed.id,
              InstalledVersion: lowestVersion,
              LatestVersion: latest.version,
              Projects: outdatedProjects,
              SourceUrl: latest.sourceUrl,
              SourceName: latest.sourceName,
            });
          });

          await Promise.allSettled(promises);
        }

        outdated.sort((a, b) => a.Id.localeCompare(b.Id));
        Logger.info(`getOutdatedPackages: Found ${outdated.length} outdated packages`);
        return ok({ Packages: outdated });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error("getOutdatedPackages: Failed", err);
        return fail(`Failed to check for outdated packages: ${message}`);
      } finally {
        StatusBarUtils.hide();
      }
    },

    async batchUpdatePackages(request: BatchUpdateRequest): Promise<Result<BatchUpdateResponse>> {
      Logger.info(`batchUpdatePackages: Updating ${request.Updates.length} packages`);

      const results: Array<{ PackageId: string; Success: boolean; Error?: string }> = [];

      for (let i = 0; i < request.Updates.length; i++) {
        const update = request.Updates[i];
        StatusBarUtils.ShowText(
          `Updating ${update.PackageId} to ${update.Version} (${i + 1}/${request.Updates.length})...`
        );

        try {
          for (const projectPath of update.ProjectPaths) {
            const isCpm = await CpmResolver.GetPackageVersions(projectPath) !== null;
            const skipRestore =
              !!vscode.workspace.getConfiguration("NugetWorkbench").get<string>("skipRestore") && !isCpm;

            await executeAddPackage(update.PackageId, projectPath, update.Version, skipRestore);
          }

          results.push({ PackageId: update.PackageId, Success: true });
          Logger.info(`batchUpdatePackages: Updated ${update.PackageId} to ${update.Version}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          Logger.error(`batchUpdatePackages: Failed to update ${update.PackageId}`, err);
          results.push({ PackageId: update.PackageId, Success: false, Error: message });
        }
      }

      CpmResolver.ClearCache();
      StatusBarUtils.hide();
      return ok({ Results: results });
    },

    async getInconsistentPackages(request: GetInconsistentPackagesRequest): Promise<Result<GetInconsistentPackagesResponse>> {
      Logger.info("getInconsistentPackages: Checking for version inconsistencies");

      try {
        let projectFiles = await vscode.workspace.findFiles(
          "**/*.{csproj,fsproj,vbproj}",
          "**/node_modules/**"
        );

        if (request.ProjectPaths && request.ProjectPaths.length > 0) {
          projectFiles = projectFiles.filter((f) => request.ProjectPaths!.includes(f.fsPath));
        }

        const projects: Project[] = [];

        for (const file of projectFiles) {
          try {
            const cpmVersions = await CpmResolver.GetPackageVersions(file.fsPath);
            const project = await ProjectParser.Parse(file.fsPath, cpmVersions);
            project.CpmEnabled = cpmVersions !== null;
            projects.push(project);
          } catch (e) {
            Logger.error(`getInconsistentPackages: Failed to parse ${file.fsPath}`, e);
          }
        }

        const packageMap = new Map<string, Map<string, Array<{ Name: string; Path: string }>>>();
        const packageNames = new Map<string, string>();
        const cpmPackages = new Set<string>();

        for (const project of projects) {
          for (const pkg of project.Packages) {
            if (!pkg.Version || isNonConcreteVersion(pkg.Version)) continue;

            const key = pkg.Id.toLowerCase();
            if (!packageMap.has(key)) {
              packageMap.set(key, new Map());
              packageNames.set(key, pkg.Id);
            }
            // A CPM project can still contain plain Version= references; only count centrally managed ones
            if (pkg.VersionSource !== "project") cpmPackages.add(key);
            const versionMap = packageMap.get(key)!;
            if (!versionMap.has(pkg.Version)) {
              versionMap.set(pkg.Version, []);
            }
            versionMap.get(pkg.Version)!.push({ Name: project.Name, Path: project.Path });
          }
        }

        const inconsistent: InconsistentPackage[] = [];

        for (const [key, versionMap] of packageMap) {
          if (versionMap.size <= 1) continue;
          const packageId = packageNames.get(key) ?? key;

          const versions = Array.from(versionMap.entries())
            .map(([version, projects]) => ({ Version: version, Projects: projects }))
            .sort((a, b) => compareVersions(b.Version, a.Version));

          inconsistent.push({
            Id: packageId,
            Versions: versions,
            LatestInstalledVersion: versions[0].Version,
            CpmManaged: cpmPackages.has(key),
          });
        }

        inconsistent.sort((a, b) => a.Id.localeCompare(b.Id));
        Logger.info(`getInconsistentPackages: Found ${inconsistent.length} inconsistent packages`);
        return ok({ Packages: inconsistent });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error("getInconsistentPackages: Failed", err);
        return fail(`Failed to check for inconsistent packages: ${message}`);
      }
    },

    async getVulnerablePackages(request: GetVulnerablePackagesRequest): Promise<Result<GetVulnerablePackagesResponse>> {
      Logger.info("getVulnerablePackages: Scanning for vulnerable packages");
      StatusBarUtils.show(0, "Scanning for vulnerabilities...");

      try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const sources = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceRoot);

        if (sources.length === 0) {
          return ok({ Packages: [] });
        }

        let projectFiles = await vscode.workspace.findFiles(
          "**/*.{csproj,fsproj,vbproj}",
          "**/node_modules/**"
        );

        if (request.ProjectPaths && request.ProjectPaths.length > 0) {
          projectFiles = projectFiles.filter((f) => request.ProjectPaths!.includes(f.fsPath));
        }

        const projects: Project[] = [];
        for (const file of projectFiles) {
          try {
            const cpmVersions = await CpmResolver.GetPackageVersions(file.fsPath);
            const project = await ProjectParser.Parse(file.fsPath, cpmVersions);
            projects.push(project);
          } catch (e) {
            Logger.error(`getVulnerablePackages: Failed to parse ${file.fsPath}`, e);
          }
        }

        // Collect all installed packages with their projects
        const installedMap = new Map<
          string,
          { version: string; projects: Array<{ Name: string; Path: string }> }
        >();

        for (const project of projects) {
          for (const pkg of project.Packages) {
            if (!pkg.Version) continue;
            const key = `${pkg.Id.toLowerCase()}::${pkg.Version}`;
            const existing = installedMap.get(key);
            if (existing) {
              existing.projects.push({ Name: project.Name, Path: project.Path });
            } else {
              installedMap.set(key, {
                version: pkg.Version,
                projects: [{ Name: project.Name, Path: project.Path }],
              });
            }
          }
        }

        StatusBarUtils.show(30, "Fetching vulnerability data...");

        // Fetch vulnerability data from all sources
        const allVulnerabilities = new Map<string, VulnerabilityEntry[]>();
        const fetchErrors: string[] = [];
        for (const source of sources) {
          try {
            const api = await nugetApiFactory.GetSourceApi(source.Url);
            const vulns = await api.GetVulnerabilitiesAsync();
            for (const [packageId, entries] of vulns) {
              const existing = allVulnerabilities.get(packageId) ?? [];
              existing.push(...entries);
              allVulnerabilities.set(packageId, existing);
            }
          } catch (e) {
            Logger.warn(`getVulnerablePackages: Failed to fetch vulns from ${source.Url}`, e);
            fetchErrors.push(formatApiError(e));
          }
        }

        if (fetchErrors.length === sources.length) {
          return fail(`Failed to fetch vulnerability data: ${fetchErrors[0]}`);
        }

        StatusBarUtils.show(60, "Matching vulnerabilities...");

        const vulnerable: VulnerablePackage[] = [];

        for (const [key, installed] of installedMap) {
          const packageId = key.split("::")[0];
          const vulnEntries = allVulnerabilities.get(packageId);
          if (!vulnEntries) continue;

          // Find the highest-severity matching vulnerability
          let worstMatch: { severity: VulnerableSeverity; url: string; versions: string } | null = null;

          for (const entry of vulnEntries) {
            if (isVersionInRange(installed.version, entry.versions)) {
              if (!worstMatch || entry.severity > worstMatch.severity) {
                worstMatch = entry;
              }
            }
          }

          if (worstMatch) {
            vulnerable.push({
              Id: packageId,
              InstalledVersion: installed.version,
              Severity: worstMatch.severity,
              AdvisoryUrl: worstMatch.url,
              AffectedVersionRange: worstMatch.versions,
              Projects: installed.projects,
            });
          }
        }

        // Sort by severity (critical first), then by name
        vulnerable.sort((a, b) => b.Severity - a.Severity || a.Id.localeCompare(b.Id));

        Logger.info(`getVulnerablePackages: Found ${vulnerable.length} vulnerable packages`);
        return ok({ Packages: vulnerable });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error("getVulnerablePackages: Failed", err);
        return fail(`Failed to scan for vulnerabilities: ${message}`);
      } finally {
        StatusBarUtils.hide();
      }
    },

    async showConfirmation(request: ShowConfirmationRequest): Promise<Result<ShowConfirmationResponse>> {
      const answer = await vscode.window.showWarningMessage(
        request.Message,
        { modal: true, detail: request.Detail },
        "Yes"
      );
      return ok({ Confirmed: answer === "Yes" });
    },

    async consolidatePackages(request: ConsolidateRequest): Promise<Result<void>> {
      Logger.info(
        `consolidatePackages: ${request.PackageId} to ${request.TargetVersion} across ${request.ProjectPaths.length} projects`
      );

      try {
        for (let i = 0; i < request.ProjectPaths.length; i++) {
          const projectPath = request.ProjectPaths[i];
          StatusBarUtils.ShowText(
            `Consolidating ${request.PackageId} (${i + 1}/${request.ProjectPaths.length})...`
          );

          const isCpm = await CpmResolver.GetPackageVersions(projectPath) !== null;
          const skipRestore =
            !!vscode.workspace.getConfiguration("NugetWorkbench").get<string>("skipRestore") && !isCpm;

          await executeAddPackage(request.PackageId, projectPath, request.TargetVersion, skipRestore);
        }

        CpmResolver.ClearCache();
        StatusBarUtils.hide();
        Logger.info(`consolidatePackages: Done`);
        return ok(undefined as void);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error(`consolidatePackages: Failed`, err);
        StatusBarUtils.hide();
        return fail(`Failed to consolidate: ${message}`);
      }
    },
  };
}

// ============================================================
// Shared Helpers
// ============================================================

async function executeRemovePackage(packageId: string, projectPath: string): Promise<void> {
  StatusBarUtils.ShowText(`Removing package ${packageId}...`);
  const args = ["remove", projectPath.replace(/\\/g, "/"), "package", packageId];

  const task = new vscode.Task(
    { type: "dotnet", task: "dotnet remove package" },
    vscode.TaskScope.Workspace,
    "nuget-workbench",
    "dotnet",
    new vscode.ShellExecution("dotnet", args)
  );
  task.presentationOptions.reveal = vscode.TaskRevealKind.Silent;
  await TaskExecutor.ExecuteTask(task);
}

async function executeAddPackage(
  packageId: string,
  projectPath: string,
  version?: string,
  skipRestore = false,
  sourceUrl?: string
): Promise<void> {
  StatusBarUtils.ShowText(`Installing package ${packageId} ${version || "latest"}...`);
  const args = ["add", projectPath.replace(/\\/g, "/"), "package", packageId];

  if (version) {
    args.push("--version", version);
  }
  if (skipRestore) {
    args.push("--no-restore");
  }
  if (sourceUrl) {
    args.push("-s", sourceUrl);
  }

  const task = new vscode.Task(
    { type: "dotnet", task: "dotnet add package" },
    vscode.TaskScope.Workspace,
    "nuget-workbench",
    "dotnet",
    new vscode.ShellExecution("dotnet", args)
  );
  task.presentationOptions.reveal = vscode.TaskRevealKind.Silent;
  await TaskExecutor.ExecuteTask(task);
}

async function getLatestVersion(
  packageId: string,
  prerelease: boolean,
  sources: Array<{ Name: string; Url: string }>
): Promise<{ version: string; sourceUrl: string; sourceName: string } | null> {
  let best: { version: string; sourceUrl: string; sourceName: string } | null = null;

  const promises = sources.map(async (source) => {
    try {
      const api = await nugetApiFactory.GetSourceApi(source.Url);
      // The top search hit is not necessarily the exact id (e.g. "Foo.Abstractions" for "Foo")
      const result = await api.GetPackagesAsync(packageId, prerelease, 0, 20);
      const pkg = result.data.find((p) => p.Name.toLowerCase() === packageId.toLowerCase());
      if (pkg) {
        return { version: pkg.Version, sourceUrl: source.Url, sourceName: source.Name };
      }
      // Fall back to the registration endpoint when search ranking hides the exact match
      const registration = await api.GetPackageAsync(packageId, prerelease);
      if (registration.data?.Version) {
        return { version: registration.data.Version, sourceUrl: source.Url, sourceName: source.Name };
      }
    } catch {
      // Ignore feed errors
    }
    return null;
  });

  const results = await Promise.allSettled(promises);

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      if (!best || compareVersions(result.value.version, best.version) > 0) {
        best = result.value;
      }
    }
  }

  return best;
}
