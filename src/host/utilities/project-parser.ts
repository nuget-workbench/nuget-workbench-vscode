import fs from "fs";
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import * as path from "path";
import { Logger } from "../../common/logger";

export default class ProjectParser {
  static Parse(projectPath: string, cpmVersions?: Map<string, string> | null): Project {
    Logger.debug(`ProjectParser.Parse: Parsing project: ${projectPath}`);
    let projectContent = fs.readFileSync(projectPath, "utf8");
    let document = new DOMParser().parseFromString(projectContent);

    // Check for parsing errors or empty document
    if (!document || !document.documentElement) {
      Logger.error(`ProjectParser.Parse: ${projectPath} has invalid content`);
      throw `${projectPath} has invalid content`;
    }

    // Handle XML Namespaces
    let select = xpath.useNamespaces({ "ns": "http://schemas.microsoft.com/developer/msbuild/2003" });
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

    let project: Project = {
      Path: projectPath,
      Name: path.basename(projectPath),
      Packages: Array(),
    };

    (packagesReferences || []).forEach((p: any) => {
      let versionNode = p.attributes?.getNamedItem("Version");
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
      
      if (cpmVersions) {
        let cpmVersion = cpmVersions.get(packageId) || null;    
        if (cpmVersion) {
          version = cpmVersion;
        } else {
          Logger.warn(`ProjectParser.Parse: CPM version not found for package ${packageId} in ${projectPath}`);
        }
      }

      // Check if version is pinned (exact version match using [x.x.x] notation - no comma)
      // According to NuGet versioning: [1.0] means x == 1.0 (exact version match, pinned)
      // Ranges like [1.0,2.0], (1.0,), [1.0,) etc. are NOT pinned
      const isPinned = version ? (version.startsWith('[') && version.endsWith(']') && !version.includes(',')) : false;

      let projectPackage: ProjectPackage = {
        Id: packageId,
        Version: version || "", // Ensure string
        IsPinned: isPinned,
      };
      project.Packages.push(projectPackage);
    });

    return project;
  }
}
