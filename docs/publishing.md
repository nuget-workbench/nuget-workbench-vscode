# Publishing to VS Code Marketplace

## Prerequisites

1. Create a publisher on [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage) (publisher ID: `nuget-workbench`)
2. Create a Personal Access Token (PAT) with the **Marketplace > Manage** scope, see [Creating the Marketplace token](#creating-the-marketplace-token-vsce_pat)
3. Add the PAT as a repository secret named `VSCE_PAT`

> [!WARNING]
> Azure DevOps retires **global** PATs on **December 1, 2026**. The Marketplace only accepts global PATs
> ("All accessible organizations"), so `VSCE_PAT` stops working on that date. Before then, switch the
> workflows to [publishing without a PAT](#publishing-without-a-pat).

## Creating the Marketplace token (`VSCE_PAT`)

The CI workflow (`ci.yml`, tag push) and the Release workflow (`release.yml`) both publish with the
repository secret `VSCE_PAT`. The token belongs to a person, so whoever creates it needs publish
rights for the `nuget-workbench` publisher.

### 1. Check your access to the publisher

1. Open [Marketplace publisher management](https://marketplace.visualstudio.com/manage/publishers/nuget-workbench)
   and sign in with the Microsoft account you will create the token with.
2. Open the **Members** tab. Your account needs the **Contributor** or **Owner** role. Otherwise, ask
   an owner to add you; a token from an account without that role is rejected with `403`.

### 2. Create the token in Azure DevOps

1. Sign in to [Azure DevOps](https://dev.azure.com/) with the same Microsoft account. If you do not
   have an organization yet, create one; it is only needed to create the token.
2. Open **User settings** (the person icon at the top right) > **Personal access tokens**.
3. Click **+ New Token** and fill in:

   | Field | Value |
   | --- | --- |
   | Name | e.g. `vsce nuget-workbench` |
   | Organization | **All accessible organizations** (a token for a single organization is rejected by the Marketplace) |
   | Expiration (UTC) | Custom defined, at most one year (and no later than December 1, 2026, when global PATs stop working) |
   | Scopes | **Custom defined**, then **Show all scopes** > **Marketplace** > **Manage** |

4. Click **Create** and copy the token right away. Azure DevOps shows it only once.

If **All accessible organizations** is not offered, your Microsoft Entra tenant has disabled global
PATs. Use [publishing without a PAT](#publishing-without-a-pat) instead.

### 3. Verify the token

Check that the token can publish before storing it. Read it into an environment variable, so it does
not end up in your shell history:

```bash
read -rs VSCE_PAT && export VSCE_PAT   # paste the token, then press Enter
npx @vscode/vsce verify-pat nuget-workbench
```

PowerShell 7:

```powershell
$env:VSCE_PAT = Read-Host "Token" -MaskInput
npx @vscode/vsce verify-pat nuget-workbench
```

Expected output: `The Personal Access Token verification succeeded for the publisher 'nuget-workbench'.`

### 4. Store it as a GitHub secret

1. In the repository, open **Settings** > **Secrets and variables** > **Actions**.
2. Click **New repository secret** (or the edit icon of an existing `VSCE_PAT`).
3. Name: `VSCE_PAT`, Secret: the token. Click **Add secret**.

Both workflows pick it up on their next run; no workflow change is needed.

### 5. Renew the token

A PAT expires on the date you chose. To renew it, open **Personal access tokens** in Azure DevOps,
select the token, choose **Regenerate**, and update the `VSCE_PAT` secret with the new value. The name,
organization and scope stay the same. Revoke the old token if it may have leaked.

### Troubleshooting

| Error | Cause |
| --- | --- |
| `401` or `The Personal Access Token verification has failed` | The token was created for a single organization instead of **All accessible organizations**, lacks the **Marketplace > Manage** scope, or has expired |
| `403` or `Access Denied: ... needs the following permission(s) on the resource` | The token's account is not a **Contributor** or **Owner** of the `nuget-workbench` publisher |
| The publish step fails in a workflow although `verify-pat` succeeds locally | The `VSCE_PAT` secret is missing or misspelled, or the run was triggered from a fork (secrets are not passed to those runs) |

## Publishing without a PAT

The Marketplace supports trusted publishing from GitHub Actions: `vsce` exchanges a short-lived GitHub
OIDC token for a Marketplace credential, so no secret has to be stored or renewed.

1. Add a trusted publishing policy to the `nuget-workbench` publisher on the Marketplace that names
   this repository and the workflow file that publishes (`release.yml`, and `ci.yml` if tag pushes
   should keep publishing).
2. Allow the publishing job to request an OIDC token:

   ```yaml
   permissions:
     contents: write   # release.yml also pushes the release commit and tag
     id-token: write
   ```

3. Replace `VSCE_PAT` in the publish step with `--oidc`:

   ```yaml
   - name: Publish to VS Code Marketplace
     run: npx @vscode/vsce publish --no-dependencies --oidc
   ```

Alternatively, `vsce publish --azure-credential` publishes with a Microsoft Entra ID identity (a service
principal or managed identity that is a member of the publisher), signed in with `azure/login`. See
[Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
for details.

## Release via script (recommended)

The release script bumps the version, updates `CHANGELOG.md`, commits, tags, and pushes. The CI pipeline then publishes automatically.

```bash
npm run release                # patch bump (1.1.0 -> 1.1.1)
npm run release -- minor       # minor bump (1.1.0 -> 1.2.0)
npm run release -- major       # major bump (1.1.0 -> 2.0.0)
npm run release -- 3.0.0       # explicit version
npm run release -- --dry-run   # preview without changes
```

The script:
1. Validates clean working tree and `main` branch
2. Bumps version in `package.json` and `package-lock.json`
3. Moves `## Unreleased` entries in `CHANGELOG.md` into a versioned section
4. Writes `RELEASE_NOTES.md` (used as GitHub Release body)
5. Commits, tags (`vX.Y.Z`), and pushes

## Release via GitHub UI

Go to **Actions > Release > Run workflow**, select the version bump type, and click **Run workflow**. The pipeline builds, tests, runs the release script, publishes to the Marketplace, and creates a GitHub Release — all in one run.

## CI/CD pipeline

Two separate workflow files:

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| **CI** | `ci.yml` | push to `main`, PRs, tag `v*` | Build, lint, test (+ publish on tags) |
| **Release** | `release.yml` | `workflow_dispatch` | Build, test, version bump, publish, GitHub Release |

The **CI** workflow runs on every push and PR. When a tag `v*` is pushed (via `npm run release`), it also publishes to the Marketplace. The **Release** workflow is for one-click releases via GitHub UI. Release notes come from `RELEASE_NOTES.md` (generated by the release script).

## Manual publish

```bash
npm run package                           # builds releases/nuget-workbench-x.x.x.vsix
npx @vscode/vsce login nuget-workbench   # authenticate with the PAT (see above)
npx @vscode/vsce publish --no-dependencies
```
