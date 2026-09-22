/**
 * NuGet version comparison following SemVer 2.0 rules with NuGet's
 * four-part numeric extension:
 * - Numeric parts (major.minor.patch.revision) are compared first; missing parts are 0.
 * - A stable version is greater than any prerelease of the same numeric version.
 * - Prerelease labels are compared part by part: numeric parts numerically,
 *   alphanumeric parts case-insensitively by ordinal; numeric < alphanumeric.
 * - Build metadata (after "+") is ignored.
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);

  const len = Math.max(va.numbers.length, vb.numbers.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (va.numbers[i] ?? 0) - (vb.numbers[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }

  if (va.release.length === 0 && vb.release.length === 0) return 0;
  if (va.release.length === 0) return 1;
  if (vb.release.length === 0) return -1;

  const relLen = Math.max(va.release.length, vb.release.length);
  for (let i = 0; i < relLen; i++) {
    const pa = va.release[i];
    const pb = vb.release[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    const cmp = compareLabel(pa, pb);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/** Returns true if the version string has a prerelease label (ignores build metadata). */
export function isPrerelease(version: string): boolean {
  return parseVersion(version).release.length > 0;
}

/**
 * Returns true for versions that cannot be compared as a concrete version:
 * MSBuild properties ("$(FooVersion)"), floating versions ("1.*") and ranges ("[1.0,2.0)").
 * Exact pins like "[1.0.0]" are concrete.
 */
export function isNonConcreteVersion(version: string): boolean {
  const v = version.trim();
  return v.includes("$(") || v.includes("*") || v.includes(",");
}

function parseVersion(version: string): { numbers: number[]; release: string[] } {
  const clean = version.trim().replace(/^[[(]|[\])]$/g, "").split("+")[0];
  const dash = clean.indexOf("-");
  const numericPart = dash >= 0 ? clean.slice(0, dash) : clean;
  const releasePart = dash >= 0 ? clean.slice(dash + 1) : "";

  const numbers = numericPart.split(".").map((p) => {
    const n = parseInt(p, 10);
    return isNaN(n) ? 0 : n;
  });
  const release = releasePart ? releasePart.split(".") : [];
  return { numbers, release };
}

function compareLabel(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    const diff = parseInt(a, 10) - parseInt(b, 10);
    return diff === 0 ? 0 : diff < 0 ? -1 : 1;
  }
  if (aNum) return -1;
  if (bNum) return 1;
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : 0;
}

/**
 * Checks if a version falls within a NuGet version range.
 * NuGet uses interval notation:
 *   [1.0.0, 2.0.0)  -> >= 1.0.0 AND < 2.0.0
 *   (1.0.0, 2.0.0]  -> > 1.0.0 AND <= 2.0.0
 *   [1.0.0, )        -> >= 1.0.0
 *   (, 2.0.0)        -> < 2.0.0
 */
export function isVersionInRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (!trimmed) return false;

  const lowerInclusive = trimmed.startsWith("[");
  const upperInclusive = trimmed.endsWith("]");

  const inner = trimmed.slice(1, -1);
  const commaIdx = inner.indexOf(",");

  if (commaIdx === -1) {
    // Exact version match: [1.0.0]
    if (lowerInclusive && upperInclusive) {
      return compareVersions(version, inner.trim()) === 0;
    }
    return false;
  }

  const lowerBound = inner.substring(0, commaIdx).trim();
  const upperBound = inner.substring(commaIdx + 1).trim();

  // Check lower bound
  if (lowerBound) {
    const cmp = compareVersions(version, lowerBound);
    if (lowerInclusive && cmp < 0) return false;
    if (!lowerInclusive && cmp <= 0) return false;
  }

  // Check upper bound
  if (upperBound) {
    const cmp = compareVersions(version, upperBound);
    if (upperInclusive && cmp > 0) return false;
    if (!upperInclusive && cmp >= 0) return false;
  }

  return true;
}
