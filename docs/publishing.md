# Publishing to VS Code Marketplace

## Prerequisites

1. Create a publisher on [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage) (publisher ID: `daniel-rck`)
2. Generate a Personal Access Token (PAT) in [Azure DevOps](https://dev.azure.com/) with **Marketplace > Manage** scope

## CI/CD (automated)

The GitHub Actions workflow publishes automatically on version tags.

1. Add the PAT as a repository secret named `VSCE_PAT` (Settings > Secrets > Actions)
2. Tag and push:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. CI will build, test, publish to Marketplace, and create a GitHub Release with the `.vsix` attached

## Manual publish

```bash
npm run package                  # builds releases/nuget-workbench-x.x.x.vsix
npx @vscode/vsce login daniel-rck   # authenticate with PAT
npx @vscode/vsce publish --no-dependencies
```

## Version bump

Before each release, update the version in `package.json` and add a changelog entry in `CHANGELOG.md`.
