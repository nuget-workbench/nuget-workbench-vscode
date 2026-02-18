import type { Result } from "./result";

// ============================================================
// Domain Types (re-exported from common/types.ts)
// ============================================================

// These are defined globally in common/types.ts and referenced here
// for type-safety in the HostAPI interface. The actual domain types
// (Package, Project, Configuration, etc.) remain in common/types.ts.

// ============================================================
// Reusable Request Building Blocks
// ============================================================

export type SourceContext = {
  Url: string;
  SourceName?: string;
  PasswordScriptPath?: string;
};

export type PaginationParams = {
  Skip: number;
  Take: number;
};

export type CacheControl = {
  ForceReload?: boolean;
};

// ============================================================
// Request Types
// ============================================================

export type GetProjectsRequest = CacheControl;

export type GetPackagesRequest = SourceContext &
  PaginationParams &
  CacheControl & {
    Filter: string;
    Prerelease: boolean;
  };

export type GetPackageRequest = SourceContext &
  CacheControl & {
    Id: string;
    Prerelease: boolean;
  };

export type GetPackageDetailsRequest = SourceContext & {
  PackageVersionUrl: string;
};

export type GetOutdatedPackagesRequest = CacheControl & {
  Prerelease: boolean;
  ProjectPaths?: string[];
};

export type GetInconsistentPackagesRequest = {
  ProjectPaths?: string[];
};

export type GetVulnerablePackagesRequest = {
  ProjectPaths?: string[];
};

export type UpdateProjectRequest = {
  ProjectPath: string;
  PackageId: string;
  Version?: string;
  Type: "INSTALL" | "UNINSTALL" | "UPDATE";
  SourceUrl?: string;
};

export type BatchUpdateRequest = {
  Updates: Array<{
    PackageId: string;
    Version: string;
    ProjectPaths: string[];
  }>;
};

export type ConsolidateRequest = {
  PackageId: string;
  TargetVersion: string;
  ProjectPaths: string[];
};

export type UpdateConfigurationRequest = {
  Configuration: Configuration;
};

export type OpenUrlRequest = {
  Url: string;
};

export type UpdateStatusBarRequest = {
  Percentage: number | null;
  Message?: string;
};

export type ShowConfirmationRequest = {
  Message: string;
  Detail?: string;
};

export type ShowConfirmationResponse = {
  Confirmed: boolean;
};

// ============================================================
// Response Types (only data, errors handled by Result<T>)
// ============================================================

export type GetProjectsResponse = {
  Projects: Project[];
};

export type GetPackagesResponse = {
  Packages: Package[];
};

export type GetPackageResponse = {
  Package: Package;
  SourceUrl: string;
};

export type GetPackageDetailsResponse = {
  Package: PackageDetails;
};

export type GetOutdatedPackagesResponse = {
  Packages: OutdatedPackage[];
};

export type GetInconsistentPackagesResponse = {
  Packages: InconsistentPackage[];
};

export type GetVulnerablePackagesResponse = {
  Packages: VulnerablePackage[];
};

export type UpdateProjectResponse = {
  Project: Project;
  IsCpmEnabled: boolean;
};

export type BatchUpdateResponse = {
  Results: Array<{
    PackageId: string;
    Success: boolean;
    Error?: string;
  }>;
};

export type GetConfigurationResponse = {
  Configuration: Configuration;
};

// Legacy response aliases (empty responses, used as generics in compat layer)
export type UpdateStatusBarResponse = Record<string, never>;
export type UpdateConfigurationResponse = Record<string, never>;

// ============================================================
// Wire Protocol (internal, over postMessage)
// ============================================================

export type RpcRequest = {
  type: "rpc-request";
  id: number;
  method: string;
  params: unknown;
};

export type RpcResponse = {
  type: "rpc-response";
  id: number;
  result: Result<unknown>;
};

export type RpcMessage = RpcRequest | RpcResponse;

// ============================================================
// Host API Contract
// ============================================================

export interface HostAPI {
  getProjects(req: GetProjectsRequest): Promise<Result<GetProjectsResponse>>;
  getPackages(req: GetPackagesRequest): Promise<Result<GetPackagesResponse>>;
  getPackage(req: GetPackageRequest): Promise<Result<GetPackageResponse>>;
  getPackageDetails(req: GetPackageDetailsRequest): Promise<Result<GetPackageDetailsResponse>>;
  updateProject(req: UpdateProjectRequest): Promise<Result<UpdateProjectResponse>>;
  getConfiguration(): Promise<Result<GetConfigurationResponse>>;
  updateConfiguration(req: UpdateConfigurationRequest): Promise<Result<void>>;
  openUrl(req: OpenUrlRequest): Promise<Result<void>>;
  updateStatusBar(req: UpdateStatusBarRequest): Promise<Result<void>>;
  getOutdatedPackages(req: GetOutdatedPackagesRequest): Promise<Result<GetOutdatedPackagesResponse>>;
  batchUpdatePackages(req: BatchUpdateRequest): Promise<Result<BatchUpdateResponse>>;
  getInconsistentPackages(req: GetInconsistentPackagesRequest): Promise<Result<GetInconsistentPackagesResponse>>;
  consolidatePackages(req: ConsolidateRequest): Promise<Result<void>>;
  getVulnerablePackages(req: GetVulnerablePackagesRequest): Promise<Result<GetVulnerablePackagesResponse>>;
  showConfirmation(req: ShowConfirmationRequest): Promise<Result<ShowConfirmationResponse>>;
}

// ============================================================
// RPC Timeout
// ============================================================

export const RPC_TIMEOUT_MS = 30_000;
