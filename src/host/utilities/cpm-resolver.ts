import fs from "fs";
import * as path from "path";
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import { Logger } from "../../common/logger";

export default class CpmResolver {
  private static cache: Map<string, Map<string, string>> = new Map();

  static GetPackageVersions(projectPath: string): Map<string, string> | null {
    const cpmFilePath = this.FindDirectoryPackagesPropsFile(projectPath);
    if (!cpmFilePath) {
      return null;
    }

    if (!this.IsCentralPackageManagementEnabled(projectPath, cpmFilePath)) {
      return null;
    }

    return this.ParsePackageVersions(cpmFilePath);
  }

  private static FindDirectoryPackagesPropsFile(projectPath: string): string | null {
    let currentDir = path.dirname(projectPath);
    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
      const cpmPath = path.join(currentDir, "Directory.Packages.props");
      if (fs.existsSync(cpmPath)) {
        return cpmPath;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }

    return null;
  }

  private static IsCentralPackageManagementEnabled(projectPath: string, cpmFilePath: string): boolean {
    try {
      // Check if Directory.Packages.props has CPM enabled
      const cpmContent = fs.readFileSync(cpmFilePath, "utf8");
      const cpmDoc = new DOMParser().parseFromString(cpmContent);
      const cpmEnabled = xpath.select("string(//PropertyGroup/ManagePackageVersionsCentrally)", cpmDoc);
      
      if (cpmEnabled !== "true") {
        return false;
      }

      // Check if project has CPM disabled
      const projectContent = fs.readFileSync(projectPath, "utf8");
      const projectDoc = new DOMParser().parseFromString(projectContent);
      const projectCpmSetting = xpath.select("string(//PropertyGroup/ManagePackageVersionsCentrally)", projectDoc);
      
      if (projectCpmSetting === "false") {
        return false;
      }

      return true;
    } catch (error) {
      Logger.error(`CpmResolver: Failed to check CPM status for ${projectPath}`, error);
      return false;
    }
  }

  private static ParsePackageVersions(cpmFilePath: string): Map<string, string> {
    if (this.cache.has(cpmFilePath)) {
      return this.cache.get(cpmFilePath)!;
    }

    const versionMap = new Map<string, string>();

    try {
      const cpmContent = fs.readFileSync(cpmFilePath, "utf8");
      const document = new DOMParser().parseFromString(cpmContent);
      const packageVersions = xpath.select("//ItemGroup/PackageVersion", document) as Node[];

      (packageVersions || []).forEach((p: any) => {
        const packageId = p.attributes?.getNamedItem("Include")?.value;
        const version = p.attributes?.getNamedItem("Version")?.value;

        if (packageId && version) {
          versionMap.set(packageId, version);
        }
      });

      this.cache.set(cpmFilePath, versionMap);
    } catch (error) {
      Logger.error(`CpmResolver: Failed to parse CPM versions from ${cpmFilePath}`, error);
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
