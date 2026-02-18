# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run esbuild          # Build (dev) - compiles host + web bundles
npm run lint             # Check code style (ESLint 9 flat config)
npm run lint:fix         # Auto-fix linting issues
npm test                 # Run tests (VSCode Test CLI + Mocha)
npm run test-compile     # Compile tests only (tsconfig.test.json)
npm run package          # Package extension (.vsix) into releases/
```

Build produces two separate bundles via `esbuild.js`:
- **Host**: `src/host/extension.ts` -> `dist/extension.js` (Node.js, CommonJS)
- **Web**: `src/web/main.ts` -> `dist/web.js` (Browser, ESM)

## Architecture

### Dual-Process Model

The extension runs in two separate contexts communicating via `postMessage`:

```
VSCode Extension Host (Node.js)          VSCode Webview (Browser)
  extension.ts                              main.ts
  RpcHost (postMessage)  <-- RPC -->       RpcClient (acquireVsCodeApi)
  host-api.ts                               components/*
```

### Typed RPC Layer (Core IPC)

All host-web communication uses a **typed RPC layer** with `Result<T>`:

- **HostAPI interface** in `src/common/rpc/types.ts` defines all methods with typed request/response
- **Result<T>**: Discriminated union `{ ok: true, value: T } | { ok: false, error: string }`
- **Wire protocol**: `{ type: 'rpc-request', id, method, params }` / `{ type: 'rpc-response', id, result }`
- **RpcHost** (`src/common/rpc/rpc-host.ts`): Host-side dispatcher mapping method names to HostAPI
- **RpcClient** (`src/common/rpc/rpc-client.ts`): Client-side ES Proxy, 30s timeout, Promise-based
- **Host implementation** in `src/host/host-api.ts`: All handlers as functions returning `Result<T>`

### Web Components (Lit)

UI uses **Lit** (LitElement) with native HTML elements styled via VS Code CSS variables:

- `@customElement("tag-name")` decorator for components
- `@state()` for internal reactive state, `@property()` for external attributes
- Template syntax: `html` literals, `.prop` (property binding), `?attr` (boolean attr), `@event`
- Module-level singletons in `src/web/registrations.ts`: `hostApi`, `router`, `configuration`

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `packages-view` | `src/web/components/packages-view.ts` | Main 3-pane layout (project tree / packages / details) with Split.js |
| `project-tree` | `src/web/components/project-tree.ts` | Checkbox tree for project selection |
| `updates-view` | `src/web/components/updates-view.ts` | Outdated packages tab |
| `consolidate-view` | `src/web/components/consolidate-view.ts` | Version inconsistency finder |
| `search-bar` | `src/web/components/search-bar.ts` | Search + source + prerelease filter |
| `package-row` | `src/web/components/package-row.ts` | Package list item |
| `project-row` | `src/web/components/project-row.ts` | Per-project install/update/uninstall UI |

### Path Alias

`@/*` resolves to `src/*` (configured in tsconfig.json, resolved by esbuild).

## Testing

Tests use **VSCode Test CLI** with Mocha + Sinon + Node.js assert:

- Test files: `src/**/*.test.ts`
- Mocking: Sinon sandboxes for VSCode API, Axios, file system
- Test config: `tsconfig.test.json` (CommonJS override for Node.js execution)
- Pattern: Arrange with stubs -> Act via component method -> Assert with `assert.strictEqual`
- Web component tests: Mock `hostApi` via `Object.defineProperty(registrations, 'hostApi', { value: mock })`
- Lit updates: Use `await element.updateComplete` instead of manual DOM tick

Run a single test file by modifying `.vscode-test.mjs` config or using the test explorer.

## Code Conventions

- **Strict TypeScript**: `strict: true`, avoid `any` (warn-level in ESLint)
- **Unused vars**: Prefix with `_` to suppress warnings
- **Error responses**: RPC methods return `Result<T>` - use `ok(value)` / `fail(error)` helpers
- **Styling**: CSS-in-JS via Lit `css` tagged template literals, using VS Code CSS variables
- **Commit messages**: English, conventional commits (`feat:`, `fix:`, `refactor:`, etc.)

## Technology Stack

- **UI Framework**: Lit 3.x (LitElement)
- **HTTP**: axios (NuGet API, proxy/auth support)
- **XML Parsing**: xmldom + xpath (.csproj/.sln files)
- **Layout**: Split.js (resizable panes)
- **Concurrency**: async-mutex (task serialization)
- **Telemetry**: OpenTelemetry (OTLP exporter)
- **Build**: esbuild 0.20
- **Lint**: ESLint 9 + typescript-eslint + prettier compat
