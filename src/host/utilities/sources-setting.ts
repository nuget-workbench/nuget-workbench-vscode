/**
 * Builds the global "sources" setting from the sources shown in the UI.
 *
 * The UI list also contains the sources of the current workspace's nuget.config. Writing them
 * to the global setting would add them to every other workspace (and bring back sources that
 * nuget.config removes), so for those only a password script path, or a URL the user had already
 * stored in the setting, is kept. Setting entries this workspace hides because its nuget.config
 * disables or clears them are not shown in the UI and are kept unchanged.
 */
export function buildSourcesSetting(
  sources: Source[],
  currentSetting: string[],
  blockedNames: Set<string>
): string[] {
  const current = new Map<string, { raw: string; url?: string }>();
  for (const raw of currentSetting) {
    try {
      const parsed = JSON.parse(raw) as { name?: string; url?: string };
      if (parsed.name) current.set(parsed.name.toLowerCase(), { raw, url: parsed.url });
    } catch {
      // Unparseable entries are dropped, as the resolver ignores them anyway
    }
  }

  const result: string[] = [];
  const written = new Set<string>();
  for (const source of sources) {
    const name = source.Name?.trim();
    if (!name || written.has(name.toLowerCase())) continue;
    const key = name.toLowerCase();

    if (source.Origin === "nuget.config") {
      const storedUrl = current.get(key)?.url;
      if (!source.PasswordScriptPath && !storedUrl) continue;
      result.push(
        JSON.stringify({
          name,
          ...(storedUrl && { url: storedUrl }),
          ...(source.PasswordScriptPath && { passwordScriptPath: source.PasswordScriptPath }),
        })
      );
    } else {
      if (!source.Url?.trim()) continue;
      result.push(
        JSON.stringify({
          name,
          url: source.Url.trim(),
          ...(source.PasswordScriptPath && { passwordScriptPath: source.PasswordScriptPath }),
        })
      );
    }
    written.add(key);
  }

  for (const [key, entry] of current) {
    if (blockedNames.has(key) && !written.has(key)) {
      result.push(entry.raw);
    }
  }

  return result;
}
