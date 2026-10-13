import NuGetApi from "../nuget/api";
import NuGetConfigResolver, { normalizeSourceUrl } from "../utilities/nuget-config-resolver";
import PasswordScriptExecutor from "../utilities/password-script-executor";
import CredentialProvider from "../utilities/credential-provider";
import { Logger } from "../../common/logger";

class NuGetApiFactory {
  // Promises, so concurrent requests for the same feed share one instance
  private readonly _sourceApiCollection: Map<string, Promise<NuGetApi>> = new Map();

  public GetSourceApi(url: string): Promise<NuGetApi> {
    // URLs that differ only in a trailing slash or case are the same feed
    const key = normalizeSourceUrl(url);
    let api = this._sourceApiCollection.get(key);
    if (!api) {
      const created = this.CreateSourceApi(url);
      api = created;
      this._sourceApiCollection.set(key, created);
      // A failed lookup (e.g. a password script error) must not be cached
      created.catch(() => {
        if (this._sourceApiCollection.get(key) === created) this._sourceApiCollection.delete(key);
      });
    } else {
      Logger.debug(`NuGetApiFactory.GetSourceApi: Returning cached API instance for ${url}`);
    }
    return api;
  }

  private async CreateSourceApi(url: string): Promise<NuGetApi> {
    Logger.debug(`NuGetApiFactory.GetSourceApi: Creating new API instance for ${url}`);
    const sources = await NuGetConfigResolver.GetWorkspaceSources(true);

    Logger.debug(`NuGetApiFactory.GetSourceApi: Available sources: ${sources.map(s => `${s.Name}=${s.Url} (hasAuth=${!!s.Username || !!s.Password})`).join(", ")}`);

    const sourceWithCreds = sources.find(
      (s) => normalizeSourceUrl(s.Url) === normalizeSourceUrl(url) && (s.Username || s.Password)
    );

    if (sourceWithCreds) {
      Logger.info(`NuGetApiFactory.GetSourceApi: Using credentials for ${url} (user: ${sourceWithCreds.Username})`);
    } else {
      Logger.debug(`NuGetApiFactory.GetSourceApi: No credentials in nuget.config for ${url}, using the credential provider if the feed asks for them`);
    }

    return new NuGetApi(
      url,
      sourceWithCreds?.Username,
      sourceWithCreds?.Password,
      sourceWithCreds ? undefined : CredentialProvider
    );
  }

  /** Drops the feed clients and their package caches; credentials stay cached. */
  public ClearCache() {
    for (const api of this._sourceApiCollection.values()) {
      api.then((a) => a.ClearPackageCache()).catch(() => undefined);
    }
    this._sourceApiCollection.clear();
  }

  /** Also forgets decoded passwords and provider tokens, so they are fetched again. */
  public ClearCredentials() {
    this.ClearCache();
    PasswordScriptExecutor.ClearCache();
    CredentialProvider.ClearCache();
    NuGetConfigResolver.ClearCache();
  }
}

export default new NuGetApiFactory();
