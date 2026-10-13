import * as path from "path";
import NuGetConfigResolver, { normalizeSourceUrl } from "./nuget-config-resolver";
import { Logger } from "../../common/logger";

/**
 * The "-s" arguments for `dotnet add package`. dotnet already knows the feeds of the project's
 * nuget.config, so nothing is passed for them. A feed that only the extension knows (from the
 * "sources" setting) must be passed; "-s" replaces the configured feeds for the restore, so
 * those are passed as well, otherwise the project's other packages could not be restored.
 */
export async function buildSourceArgs(
  projectPath: string,
  sourceUrl: string | undefined,
  skipRestore = false
): Promise<string[]> {
  // --no-restore never contacts a feed
  if (!sourceUrl || skipRestore) return [];

  const projectSources = await NuGetConfigResolver.GetSourcesWithCredentials(path.dirname(projectPath));
  const target = normalizeSourceUrl(sourceUrl);
  if (projectSources.some((s) => normalizeSourceUrl(s.Url) === target)) return [];

  Logger.debug(`buildSourceArgs: ${sourceUrl} is not in the nuget.config of ${projectPath}, passing all feeds`);
  return [sourceUrl, ...projectSources.map((s) => s.Url)].flatMap((url) => ["-s", url]);
}
