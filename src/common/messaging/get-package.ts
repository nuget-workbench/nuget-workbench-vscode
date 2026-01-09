export type GetPackageRequest = {
  Url: string;
  SourceName?: string;
  Id: string;
  Prerelease: boolean;
  PasswordScriptPath?: string;
  ForceReload?: boolean;
};

export type GetPackageResponse = {
  IsFailure: boolean;
  Package?: Package;
  SourceUrl?: string;
  Error?: HttpError;
};
