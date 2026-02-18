import fs from "fs";
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import * as path from "path";
import { Logger } from "../../common/logger";

export default class ProjectParser {
  static async Parse(projectPath: string, cpmVersions?: Map<string, string> | null): Promise<Project> {
    Logger.debug(`ProjectParser.Parse: Parsing project: ${projectPath}`);
    const projectContent = await fs.promises.readFile(projectPath, "utf8");
    const document = new DOMParser().parseFromString(projectContent);

    // Check for parsing errors or empty document
    if (!document || !document.documentElement) {
      Logger.error(`ProjectParser.Parse: ${projectPath} has invalid content`);
      throw `${projectPath} has invalid content`;
    }

    // Handle XML Namespaces
    const select = xpath.useNamespaces({ "ns": "http://schemas.microsoft.com/developer/msbuild/2003" });
    let packagesReferences: Node[] = [];

    // Try selecting with namespace first
    try {
        if (document.documentElement.getAttribute("xmlns") === "http://schemas.microsoft.com/developer/msbuild/2003") {
             packagesReferences = select("//ns:ItemGroup/ns:PackageReference", document) as Node[];
        } else {
             // Fallback to no namespace if not present
             packagesReferences = xpath.select("//ItemGroup/PackageReference", document) as Node[];
        }
    } catch (e) {
        // Fallback to local-name strategy if namespace selection fails or is complicated
        packagesReferences = xpath.select("//*[local-name()='ItemGroup']/*[local-name()='PackageReference']", document) as Node[];
    }

    // If we still found nothing, try the local-name strategy as a final fallback
    if (!packagesReferences || packagesReferences.length === 0) {
         packagesReferences = xpath.select("//*[local-name()='ItemGroup']/*[local-name()='PackageReference']", document) as Node[];
    }

    const project: Project = {
      Path: projectPath,
      Name: path.basename(projectPath),
      Packages: [],
      CpmEnabled: false,
    };

    (packagesReferences || []).forEach((p: any) => {
      const versionNode = p.attributes?.getNamedItem("Version");
      let version = versionNode ? versionNode.value : undefined;

      // Check for child element if attribute is missing
      if (!version) {
          const versionChild = xpath.select("string(Version)", p); // Relative path from 'p'
          if (versionChild) {
              version = versionChild.toString();
          }
           // Also try namespaced child if applicable
           if (!version) {
               const versionChildNS = xpath.select("string(*[local-name()='Version'])", p);
               if (versionChildNS) {
                   version = versionChildNS.toString();
               }
           }
      }

      const packageId = p.attributes?.getNamedItem("Include").value;

      // Check for VersionOverride attribute (CPM override at project level)
      let versionOverride = p.attributes?.getNamedItem("VersionOverride")?.value;
      if (!versionOverride) {
        const versionOverrideChild = xpath.select("string(*[local-name()='VersionOverride'])", p);
        if (versionOverrideChild) {
          versionOverride = versionOverrideChild.toString() || undefined;
        }
      }

      let versionSource: VersionSource = "project";

      if (cpmVersions) {
        if (versionOverride) {
          version = versionOverride;
          versionSource = "override";
          Logger.debug(`ProjectParser.Parse: Package ${packageId} uses VersionOverride ${versionOverride} in ${projectPath}`);
        } else {
          const cpmVersion = cpmVersions.get(packageId) || null;
          if (cpmVersion) {
            version = cpmVersion;
            versionSource = "central";
          } else {
            Logger.warn(`ProjectParser.Parse: CPM version not found for package ${packageId} in ${projectPath}`);
          }
        }
      }

      // Check if version is pinned (exact version match using [x.x.x] notation - no comma)
      // According to NuGet versioning: [1.0] means x == 1.0 (exact version match, pinned)
      // Ranges like [1.0,2.0], (1.0,), [1.0,) etc. are NOT pinned
      const isPinned = version ? (version.startsWith('[') && version.endsWith(']') && !version.includes(',')) : false;

      const projectPackage: ProjectPackage = {
        Id: packageId,
        Version: version || "",
        IsPinned: isPinned,
        VersionSource: versionSource,
      };
      project.Packages.push(projectPackage);
    });

    return project;
  }
}
