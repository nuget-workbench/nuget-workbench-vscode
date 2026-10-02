import fs from "fs";
import * as path from "path";
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import { Logger } from "../../common/logger";

export default class CpmResolver {
  // Keyed by file path; the modification time invalidates entries for files edited outside the extension
  private static cache: Map<string, { stamp: string; versions: Map<string, string> }> = new Map();

  static async GetPackageVersions(projectPath: string): Promise<Map<string, string> | null> {
    const cpmFilePath = this.FindDirectoryPackagesPropsFile(projectPath);
    if (!cpmFilePath) {
      return null;
    }

    Logger.debug(`CpmResolver.GetPackageVersions: Found CPM file at ${cpmFilePath}`);

    if (!await this.IsCentralPackageManagementEnabled(projectPath, cpmFilePath)) {
      Logger.debug(`CpmResolver.GetPackageVersions: CPM is disabled for ${projectPath}`);
      return null;
    }

    return this.ParsePackageVersions(cpmFilePath);
  }

  private static FindDirectoryPackagesPropsFile(projectPath: string): string | null {
    return this.FindFileAbove(projectPath, "Directory.Packages.props");
  }

  /** Finds the closest file with the given name in the project's folder or any parent folder. */
  private static FindFileAbove(projectPath: string, fileName: string): string | null {
    let currentDir = path.dirname(projectPath);

    for (;;) {
      const candidate = path.join(currentDir, fileName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        return null;
      }
      currentDir = parentDir;
    }
  }

  private static async IsCentralPackageManagementEnabled(projectPath: string, cpmFilePath: string): Promise<boolean> {
    try {
      // MSBuild evaluates Directory.Build.props, then Directory.Packages.props, then the project
      // file, so the last of them that sets ManagePackageVersionsCentrally wins
      const projectSetting = await this.ReadCpmProperty(projectPath);
      if (projectSetting) {
        return projectSetting === "true";
      }

      const cpmSetting = await this.ReadCpmProperty(cpmFilePath);
      if (cpmSetting) {
        return cpmSetting === "true";
      }

      const buildPropsPath = this.FindFileAbove(projectPath, "Directory.Build.props");
      if (buildPropsPath) {
        return (await this.ReadCpmProperty(buildPropsPath)) === "true";
      }

      return false;
    } catch (error) {
      Logger.error(`CpmResolver.IsCentralPackageManagementEnabled: Failed to check CPM status for ${projectPath}`, error);
      return false;
    }
  }

  /** Returns the lowercased ManagePackageVersionsCentrally value of a file, or "" if it is not set. */
  private static async ReadCpmProperty(filePath: string): Promise<string> {
    const content = await fs.promises.readFile(filePath, "utf8");
    const document = new DOMParser().parseFromString(content);
    const value = xpath.select("string(//*[local-name()='PropertyGroup']/*[local-name()='ManagePackageVersionsCentrally'])", document);
    return String(value).trim().toLowerCase();
  }

  private static async ParsePackageVersions(cpmFilePath: string): Promise<Map<string, string>> {
    let stamp = "";
    try {
      const stat = await fs.promises.stat(cpmFilePath);
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      // Parsing below reports the error
    }

    const cached = this.cache.get(cpmFilePath);
    if (cached && cached.stamp === stamp) {
      return cached.versions;
    }

    Logger.debug(`CpmResolver.ParsePackageVersions: Parsing ${cpmFilePath}`);
    const versionMap = new Map<string, string>();

    try {
      const cpmContent = await fs.promises.readFile(cpmFilePath, "utf8");
      const document = new DOMParser().parseFromString(cpmContent);
      const packageVersions = xpath.select("//*[local-name()='ItemGroup']/*[local-name()='PackageVersion']", document) as Node[];

      (packageVersions || []).forEach((p: any) => {
        const packageId = p.attributes?.getNamedItem("Include")?.value;
        const version = p.attributes?.getNamedItem("Version")?.value;

        if (packageId && version) {
          versionMap.set(packageId, version);
        }
      });

      Logger.debug(`CpmResolver.ParsePackageVersions: Found ${versionMap.size} package versions in ${cpmFilePath}`);
      this.cache.set(cpmFilePath, { stamp, versions: versionMap });
    } catch (error) {
      Logger.error(`CpmResolver.ParsePackageVersions: Failed to parse CPM versions from ${cpmFilePath}`, error);
    }

    return versionMap;
  }

  static ClearCache(cpmFilePath?: string): void {
    if (cpmFilePath) {
      this.cache.delete(cpmFilePath);
    } else {
      this.cache.clear();
    }
  }

  static ClearCacheForProject(projectPath: string): void {
    const cpmFilePath = this.FindDirectoryPackagesPropsFile(projectPath);
    if (cpmFilePath) {
      this.ClearCache(cpmFilePath);
    }
  }
}
