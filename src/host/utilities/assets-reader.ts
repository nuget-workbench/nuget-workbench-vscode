import fs from "fs";
import * as path from "path";
import { Logger } from "../../common/logger";

export type AssetsResult = { Status: AssetsStatus; Packages: TransitivePackage[] };

type AssetsNode = { id: string; version: string; type: string; deps: string[] };

/** The parts of obj/project.assets.json that are read. */
type AssetsFile = {
  targets?: Record<string, Record<string, { type?: string; dependencies?: Record<string, string> }>>;
  project?: {
    restore?: { projectPath?: string };
    frameworks?: Record<string, { dependencies?: Record<string, unknown> }>;
  };
};

const NOT_RESTORED: AssetsResult = { Status: "notRestored", Packages: [] };

/**
 * Reads the transitive packages of a project from obj/project.assets.json, which every restore
 * writes. Custom BaseIntermediateOutputPath / MSBuildProjectExtensionsPath locations and the
 * artifacts output layout are not supported.
 */
export default class AssetsReader {
  // Keyed by project path; the file stamp invalidates entries after a restore
  private static cache: Map<string, { stamp: string; result: AssetsResult }> = new Map();

  static async Read(projectPath: string): Promise<AssetsResult> {
    const assetsPath = path.join(path.dirname(projectPath), "obj", "project.assets.json");

    let stamp: string;
    try {
      const stat = await fs.promises.stat(assetsPath);
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return NOT_RESTORED;
    }

    const cached = this.cache.get(projectPath);
    if (cached && cached.stamp === stamp) {
      return cached.result;
    }

    let result: AssetsResult;
    try {
      const assets: AssetsFile = JSON.parse(await fs.promises.readFile(assetsPath, "utf8"));
      // A shared obj folder (several projects in one directory) belongs to another project
      const restoredPath: string | undefined = assets?.project?.restore?.projectPath;
      if (restoredPath && path.resolve(restoredPath).toLowerCase() !== path.resolve(projectPath).toLowerCase()) {
        result = NOT_RESTORED;
      } else {
        result = { Status: "ok", Packages: this.ComputeTransitive(assets) };
      }
    } catch (error) {
      Logger.warn(`AssetsReader.Read: Failed to read ${assetsPath}`, error);
      result = NOT_RESTORED;
    }

    this.cache.set(projectPath, { stamp, result });
    return result;
  }

  static ClearCache(): void {
    this.cache.clear();
  }

  /**
   * The packages of the restore graph that the project does not reference directly. ViaIds are
   * the direct references that pull a package in: those are what the user can update.
   */
  static ComputeTransitive(assets: AssetsFile): TransitivePackage[] {
    const direct = new Set<string>();
    for (const framework of Object.values(assets?.project?.frameworks ?? {})) {
      for (const id of Object.keys(framework?.dependencies ?? {})) {
        direct.add(id.toLowerCase());
      }
    }

    const targets = assets?.targets ?? {};
    const merged = new Map<string, TransitivePackage>();

    for (const [targetKey, libraries] of Object.entries(targets)) {
      // Runtime-specific targets ("net8.0/win-x64") repeat the graph of their framework
      const [framework, runtime] = targetKey.split("/");
      if (runtime && framework in targets) continue;

      const nodes = new Map<string, AssetsNode>();
      for (const [key, library] of Object.entries(libraries ?? {})) {
        const slash = key.indexOf("/");
        if (slash < 0) continue;
        const id = key.slice(0, slash);
        nodes.set(id.toLowerCase(), {
          id,
          version: key.slice(slash + 1),
          type: library?.type ?? "package",
          deps: Object.keys(library?.dependencies ?? {}),
        });
      }

      const roots = Array.from(nodes.values()).filter(
        (n) => n.type === "project" || direct.has(n.id.toLowerCase())
      );
      for (const root of roots) {
        const visited = new Set<string>([root.id.toLowerCase()]);
        const stack = [...root.deps];
        while (stack.length > 0) {
          const key = stack.pop()!.toLowerCase();
          if (visited.has(key)) continue;
          visited.add(key);
          const node = nodes.get(key);
          if (!node) continue;
          stack.push(...node.deps);
          if (node.type !== "package" || direct.has(key)) continue;

          const mergedKey = `${key}/${node.version.toLowerCase()}`;
          let entry = merged.get(mergedKey);
          if (!entry) {
            entry = { Id: node.id, Version: node.version, Frameworks: [], ViaIds: [] };
            merged.set(mergedKey, entry);
          }
          if (!entry.Frameworks.includes(framework)) entry.Frameworks.push(framework);
          if (!entry.ViaIds.includes(root.id)) entry.ViaIds.push(root.id);
        }
      }
    }

    return Array.from(merged.values()).sort((a, b) => a.Id.localeCompare(b.Id));
  }
}
