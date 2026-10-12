import type { HostAPI } from "@/common/rpc/types";

export default class ConfigurationService extends EventTarget {
  private hostApi: HostAPI;
  private configuration: Configuration | null = null;

  constructor(hostApi: HostAPI) {
    super();
    this.hostApi = hostApi;
  }

  get Configuration(): Configuration | null {
    return this.configuration;
  }

  /** The URL of the "defaultSource" setting (a URL or a source name), or "" for all sources. */
  get DefaultSourceUrl(): string {
    const wanted = this.configuration?.DefaultSource?.trim().toLowerCase();
    if (!wanted) return "";
    const normalize = (url: string) => url.trim().replace(/\/+$/, "").toLowerCase();
    const source = this.configuration?.Sources.find(
      (s) => normalize(s.Url) === normalize(wanted) || s.Name.toLowerCase() === wanted
    );
    return source?.Url ?? "";
  }

  async Reload() {
    const result = await this.hostApi.getConfiguration();
    if (result.ok) {
      this.configuration = result.value.Configuration;
    }
    this.dispatchEvent(new Event("configuration-changed"));
  }
}
