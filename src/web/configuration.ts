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

  async Reload() {
    const result = await this.hostApi.getConfiguration();
    if (result.ok) {
      this.configuration = result.value.Configuration;
    }
    this.dispatchEvent(new Event("configuration-changed"));
  }
}
