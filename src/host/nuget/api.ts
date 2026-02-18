import axios, { AxiosError, AxiosInstance, AxiosProxyConfig, AxiosRequestConfig, AxiosResponse } from "axios";
import * as vscode from "vscode";
import { Logger } from "../../common/logger";

type GetPackagesResponse = {
  data: Array<Package>;
};

type GetPackageResponse = {
  isError: boolean;
  errorMessage: string | undefined;
  data: Package | undefined;
};

type GetPackageDetailsResponse = {
  data: PackageDetails;
};

export default class NuGetApi {
  private _searchUrl: string = "";
  private _packageInfoUrl: string = "";
  private _vulnerabilityUrl: string = "";
  private http: AxiosInstance;
  private _packageCache: Map<string, { data: Package, timestamp: number }> = new Map();
  private _vulnerabilityCache: { data: Map<string, VulnerabilityEntry[]>, timestamp: number } | null = null;
  private readonly _cacheTtl: number = 5 * 60 * 1000; // 5 minutes
  private readonly _vulnCacheTtl: number = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly _url: string,
    private readonly _username?: string,
    private readonly _password?: string
  ) {
    this.http = axios.create({
      proxy: this.getProxy(),
    });
    // Add Basic Auth if credentials are provided
    if (this._username && this._password) {
      const token = btoa(`${this._username}:${this._password}`);
      this.http.interceptors.request.use((config) => {
        config.headers["Authorization"] = `Basic ${token}`;
        return config;
      });
    }
  }

  async GetPackagesAsync(
    filter: string,
    prerelease: boolean,
    skip: number,
    take: number
  ): Promise<GetPackagesResponse> {
    Logger.debug(`NuGetApi.GetPackagesAsync: Fetching packages (filter: '${filter}', prerelease: ${prerelease}, skip: ${skip}, take: ${take})`);
    await this.EnsureSearchUrl();
    const result = await this.ExecuteGet(this._searchUrl, {
      params: {
        q: filter,
        take: take,
        skip: skip,
        prerelease: prerelease,
        semVerLevel: "2.0.0",
      },
    });
    const mappedData: Array<Package> = result.data.data.map((item: any) => ({
      Id: item["@id"] || "",
      Name: item.id || "",
      Authors: item.authors || [],
      Description: item.description || "",
      IconUrl: item.iconUrl || "",
      Registration: item.registration || "",
      LicenseUrl: item.licenseUrl || "",
      ProjectUrl: item.projectUrl || "",
      TotalDownloads: item.totalDownloads || 0,
      Verified: item.verified || false,
      Version: item.version || "",
      Versions:
        item.versions.map((v: any) => ({
          Version: v.version,
          Id: v["@id"],
        })) || [],
      Tags: item.tags || [],
    }));

    return {
      data: mappedData,
    };
  }

  async GetPackageAsync(id: string, prerelease: boolean = true): Promise<GetPackageResponse> {
    const cacheKey = `${id.toLowerCase()}::${prerelease}`;
    const cached = this._packageCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this._cacheTtl)) {
      Logger.debug(`NuGetApi.GetPackageAsync: Returning cached package info for ${id} (prerelease: ${prerelease})`);
      return { data: cached.data, isError: false, errorMessage: undefined };
    }

    Logger.debug(`NuGetApi.GetPackageAsync: Fetching package info for ${id} (prerelease: ${prerelease})`);
    await this.EnsureSearchUrl();
    const url = new URL([id.toLowerCase(), "index.json"].join("/"), this._packageInfoUrl).href;
    const items: Array<any> = [];
    try {
      Logger.debug(`NuGetApi.GetPackageAsync: GET ${url}`);
      const result = await this.http.get(url);
      if (result instanceof AxiosError) {
        Logger.error("NuGetApi.GetPackageAsync: Axios Error Data:", result.response?.data);
        return {
          isError: true,
          errorMessage: "Package couldn't be found",
          data: undefined,
        };
      }

      for (let i = 0; i < result.data.count; i++) {
        const page = result.data.items[i];
        if (page.items) items.push(...page.items);
        else {
          const pageData = await this.http.get(page["@id"]);
          if (pageData instanceof AxiosError) {
            Logger.error("NuGetApi.GetPackageAsync: Axios Error while loading page data:", pageData.message);
          } else {
            items.push(...pageData.data.items);
          }
        }
      }
    } catch (err) {
      Logger.error(`NuGetApi.GetPackageAsync: ERROR url: ${url}`, err);
    }

    if (items.length <= 0) throw { message: "Package info couldn't be found for url:" + url };
    
    // Filter versions based on prerelease flag
    // Prerelease versions contain a hyphen (e.g., 1.0.0-beta)
    const filteredItems = prerelease 
      ? items 
      : items.filter((v: any) => !v.catalogEntry?.version?.includes('-'));
    
    if (!prerelease && filteredItems.length <= 0) {
      // If no stable versions found, fall back to all versions
      Logger.warn(`NuGetApi.GetPackageAsync: No stable versions found for ${id}, falling back to all versions including prerelease`);
    }
    
    const itemsToUse = filteredItems.length > 0 ? filteredItems : items;
    const item = itemsToUse[itemsToUse.length - 1];
    const catalogEntry = item.catalogEntry;
    const packageObject: Package = {
      Id: item["@id"] || "",
      Name: catalogEntry?.id || "",
      Authors: catalogEntry?.authors || [],
      Description: catalogEntry?.description || "",
      IconUrl: catalogEntry?.iconUrl || "",
      Registration: catalogEntry?.registration || "",
      LicenseUrl: catalogEntry?.licenseUrl || "",
      ProjectUrl: catalogEntry?.projectUrl || "",
      TotalDownloads: catalogEntry?.totalDownloads || 0,
      Verified: catalogEntry?.verified || false,
      Version: catalogEntry?.version || "",
      InstalledVersion: "",
      Versions:
        itemsToUse.map((v: any) => ({
          Version: v.catalogEntry.version,
          Id: v["@id"],
        })) || [],
      Tags: catalogEntry?.tags || [],
    };

    this._packageCache.set(cacheKey, { data: packageObject, timestamp: Date.now() });

    return { data: packageObject, isError: false, errorMessage: undefined };
  }

  public ClearPackageCache(packageId?: string) {
    if (packageId) {
      this._packageCache.delete(packageId.toLowerCase());
    } else {
      this._packageCache.clear();
    }
  }

  async GetPackageDetailsAsync(packageVersionUrl: string): Promise<GetPackageDetailsResponse> {
    try {
      await this.EnsureSearchUrl();
      Logger.debug(`NuGetApi.GetPackageDetailsAsync: Fetching package version from ${packageVersionUrl}`);
      const packageVersion = await this.ExecuteGet(packageVersionUrl);
      
      if (!packageVersion.data?.catalogEntry) {
        Logger.debug(`NuGetApi.GetPackageDetailsAsync: No catalogEntry found in package version response`);
        return {
          data: {
            dependencies: {
              frameworks: {},
            },
          },
        };
      }
      
      const catalogEntry = packageVersion.data.catalogEntry;
      let catalogData: any;
      
      // Check if catalogEntry is an embedded object with dependencyGroups (some feeds embed the data)
      // or if it's a URL/object with @id that needs to be fetched
      if (typeof catalogEntry === 'object' && catalogEntry.dependencyGroups !== undefined) {
        // catalogEntry is already an embedded object with dependency data
        Logger.debug(`NuGetApi.GetPackageDetailsAsync: Using embedded catalogEntry data`);
        catalogData = catalogEntry;
      } else {
        // catalogEntry is a URL string or an object with @id - need to fetch it
        const catalogUrl = typeof catalogEntry === 'string' ? catalogEntry : catalogEntry['@id'];
        if (!catalogUrl) {
          Logger.debug(`NuGetApi.GetPackageDetailsAsync: No valid catalog URL found`);
          return {
            data: {
              dependencies: {
                frameworks: {},
              },
            },
          };
        }
        Logger.debug(`NuGetApi.GetPackageDetailsAsync: Fetching catalog from ${catalogUrl}`);
        const result = await this.ExecuteGet(catalogUrl);
        catalogData = result.data;
      }

      const packageDetails: PackageDetails = {
        dependencies: {
          frameworks: {},
        },
      };

      const dependencyGroupCount = catalogData?.dependencyGroups?.length || 0;
      Logger.debug(`NuGetApi.GetPackageDetailsAsync: Found ${dependencyGroupCount} dependency groups`);

      catalogData?.dependencyGroups?.forEach((dependencyGroup: any) => {
        const targetFramework = dependencyGroup.targetFramework;
        packageDetails.dependencies.frameworks[targetFramework] = [];
        dependencyGroup.dependencies?.forEach((dependency: any) => {
          packageDetails.dependencies.frameworks[targetFramework].push({
            package: dependency.id,
            versionRange: dependency.range,
          });
        });
        if (packageDetails.dependencies.frameworks[targetFramework].length == 0)
          delete packageDetails.dependencies.frameworks[targetFramework];
      });

      Logger.debug(`NuGetApi.GetPackageDetailsAsync: Returning ${Object.keys(packageDetails.dependencies.frameworks).length} frameworks with dependencies`);
      return { data: packageDetails };
    }
    catch (err) {
      Logger.error(`NuGetApi.GetPackageDetailsAsync: ERROR fetching package details: ${packageVersionUrl}`, err);
      throw err;
    }
  }

  async GetVulnerabilitiesAsync(): Promise<Map<string, VulnerabilityEntry[]>> {
    // Return cached data if fresh
    if (this._vulnerabilityCache && (Date.now() - this._vulnerabilityCache.timestamp < this._vulnCacheTtl)) {
      Logger.debug("NuGetApi.GetVulnerabilitiesAsync: Returning cached vulnerability data");
      return this._vulnerabilityCache.data;
    }

    Logger.debug("NuGetApi.GetVulnerabilitiesAsync: Fetching vulnerability data");
    await this.EnsureSearchUrl();

    if (!this._vulnerabilityUrl) {
      Logger.debug("NuGetApi.GetVulnerabilitiesAsync: No vulnerability endpoint available");
      return new Map();
    }

    const vulnerabilities = new Map<string, VulnerabilityEntry[]>();

    try {
      const indexResponse = await this.ExecuteGet(this._vulnerabilityUrl);
      const pages: Array<{ "@name": string; "@id": string; "@updated": string }> = indexResponse.data;

      for (const page of pages) {
        const pageResponse = await this.ExecuteGet(page["@id"]);
        const data: Record<string, VulnerabilityEntry[]> = pageResponse.data;

        for (const [packageId, entries] of Object.entries(data)) {
          const existing = vulnerabilities.get(packageId) ?? [];
          existing.push(...entries);
          vulnerabilities.set(packageId, existing);
        }
      }

      Logger.info(`NuGetApi.GetVulnerabilitiesAsync: Loaded vulnerabilities for ${vulnerabilities.size} packages`);
    } catch (err) {
      Logger.error("NuGetApi.GetVulnerabilitiesAsync: Failed to fetch vulnerabilities", err);
    }

    this._vulnerabilityCache = { data: vulnerabilities, timestamp: Date.now() };
    return vulnerabilities;
  }

  private async EnsureSearchUrl() {
    if (this._searchUrl !== "" && this._packageInfoUrl !== "") return;

    Logger.debug(`NuGetApi.EnsureSearchUrl: resolving service URLs from ${this._url}`);
    const response = await this.ExecuteGet(this._url);

    this._searchUrl = await this.GetUrlFromNugetDefinition(response, "SearchQueryService");
    if (this._searchUrl == "") throw { message: "SearchQueryService couldn't be found" };
    if (!this._searchUrl.endsWith("/")) this._searchUrl += "/";
    this._packageInfoUrl = await this.GetUrlFromNugetDefinition(response, "RegistrationsBaseUrl/3.6.0");
    if (this._packageInfoUrl == "") throw { message: "RegistrationsBaseUrl couldn't be found" };
    if (!this._packageInfoUrl.endsWith("/")) this._packageInfoUrl += "/";

    // Vulnerability endpoint is optional (not all feeds support it)
    if (!this._vulnerabilityUrl) {
      this._vulnerabilityUrl = await this.GetUrlFromNugetDefinition(response, "VulnerabilityInfo");
    }

    Logger.debug(`NuGetApi.EnsureSearchUrl: SearchUrl=${this._searchUrl}, PackageInfoUrl=${this._packageInfoUrl}, VulnerabilityUrl=${this._vulnerabilityUrl}`);
  }

  private async GetUrlFromNugetDefinition(response: any, type: string): Promise<string> {
    const resource = response.data.resources.find((x: any) => x["@type"].includes(type));
    if (resource != null) return resource["@id"];
    else return "";
  }

  private async ExecuteGet(
    url: string,
    config?: AxiosRequestConfig<any> | undefined
  ): Promise<AxiosResponse<any, any>> {
    Logger.debug(`NuGetApi.ExecuteGet: Requesting ${url}`);
    const response = await this.http.get(url, config);
    if (response instanceof AxiosError) {
      Logger.error("NuGetApi.ExecuteGet: Axios Error Data:", response.response?.data);
      throw {
        message: `${response.message} on request to${url}`,
      };
    }

    return response;
  }

  private getProxy(): AxiosProxyConfig | undefined {
    let proxy: string | undefined = vscode.workspace.getConfiguration().get("http.proxy");
    if (proxy === "" || proxy == undefined) {
      proxy =
        process.env["HTTPS_PROXY"] ??
        process.env["https_proxy"] ??
        process.env["HTTP_PROXY"] ??
        process.env["http_proxy"];
    }

    if (proxy && proxy !== "") {
      const proxy_url = new URL(proxy);

      Logger.info(`NuGetApi.getProxy: Found proxy: ${proxy}`);

      return {
        host: proxy_url.hostname,
        port: Number(proxy_url.port),
      };
    } else {
      return undefined;
    }
  }
}
