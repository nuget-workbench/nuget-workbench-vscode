import * as vscode from 'vscode';
import { Logger } from '../../common/logger';
import NuGetConfigResolver from './nuget-config-resolver';
import nugetApiFactory from '../nuget/api-factory';
import { compareVersions, isNonConcreteVersion } from '../../common/version';

// Failed lookups are retried after this time (e.g. VS Code started before the VPN was up)
const FAILED_LOOKUP_TTL_MS = 10 * 60 * 1000;

export class PackageVersionDecorator implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _decorationType: vscode.TextEditorDecorationType;
    private _failedCache: Map<string, number> = new Map(); // PackageId -> time of the failed fetch
    private _updateSeq = 0;
    private _isEnabled: boolean = false;
    private _prerelease: boolean = false;

    constructor() {
        Logger.debug('PackageVersionDecorator.constructor: Initialized');
        this._decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 1em',
                color: new vscode.ThemeColor('editorCodeLens.foreground'),
            }
        });

        this.updateConfiguration();

        // Listen for configuration changes
        this._disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('NugetWorkbench.enablePackageVersionInlineInfo') ||
                e.affectsConfiguration('NugetWorkbench.prerelease')) {
                this.updateConfiguration();
                if (vscode.window.activeTextEditor) {
                    this.triggerUpdateDecorations(vscode.window.activeTextEditor);
                }
            }
        }));

        // Listen for active editor changes
        this._disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                Logger.debug(`PackageVersionDecorator.constructor: Active editor changed to ${editor.document.fileName}`);
                this.triggerUpdateDecorations(editor);
            }
        }));

        // Listen for document changes
        this._disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
            if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
                this.triggerUpdateDecorations(vscode.window.activeTextEditor);
            }
        }));

        if (vscode.window.activeTextEditor) {
            this.triggerUpdateDecorations(vscode.window.activeTextEditor);
        }
    }

    private updateConfiguration() {
        const config = vscode.workspace.getConfiguration('NugetWorkbench');
        this._isEnabled = config.get<boolean>('enablePackageVersionInlineInfo', false);
        this._prerelease = config.get<boolean>('prerelease', false);
        Logger.debug(`PackageVersionDecorator.updateConfiguration: Configuration updated, enabled=${this._isEnabled}, prerelease=${this._prerelease}`);
    }

    private _timeout: NodeJS.Timeout | undefined = undefined;

    private triggerUpdateDecorations(editor: vscode.TextEditor) {
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = undefined;
        }
        this._timeout = setTimeout(() => {
            this.updateDecorations(editor);
        }, 500);
    }

    private hasFailedRecently(packageId: string): boolean {
        const failedAt = this._failedCache.get(packageId);
        if (failedAt === undefined) return false;
        if (Date.now() - failedAt < FAILED_LOOKUP_TTL_MS) return true;
        this._failedCache.delete(packageId);
        return false;
    }

    private async updateDecorations(editor: vscode.TextEditor) {
        if (!editor || editor.document.isClosed) {
            return;
        }
        // A slower, older update must not overwrite the decorations of a newer one
        const seq = ++this._updateSeq;

        if (!this._isEnabled) {
            editor.setDecorations(this._decorationType, []);
            return;
        }

        const doc = editor.document;
        const fileName = doc.fileName;

        if (!fileName.endsWith('Directory.Packages.props') &&
            !fileName.endsWith('.csproj') &&
            !fileName.endsWith('.fsproj') &&
            !fileName.endsWith('.vbproj')) {
            return;
        }

        Logger.debug(`PackageVersionDecorator.updateDecorations: Processing ${fileName}`);

        const text = doc.getText();
        const regex = /<(PackageReference|PackageVersion)\s+[^>]*>/g;
        const packagesToFetch: Set<string> = new Set();

        // Map current document positions for packages
        const packagePositions: Map<string, { start: vscode.Position, end: vscode.Position, version: string }[]> = new Map();

        let match;
        while ((match = regex.exec(text))) {
            const tag = match[0];
            const includeMatch = /Include="([^"]+)"/.exec(tag);
            const versionMatch = /Version="([^"]+)"/.exec(tag);

            if (includeMatch && versionMatch) {
                const packageId = includeMatch[1];
                const currentVersion = versionMatch[1];

                // Skip pinned versions (exact version match using [x.x.x] notation - no comma)
                // Ranges like [1.0,2.0], (1.0,), [1.0,) etc. are NOT pinned and should show updates
                const isPinned = currentVersion.startsWith('[') && currentVersion.endsWith(']') && !currentVersion.includes(',');
                // "$(Prop)", floating and range versions cannot be compared with a concrete version
                if (isPinned || isNonConcreteVersion(currentVersion)) {
                    continue;
                }

                // Find position of Version value
                const versionAttrIndex = tag.indexOf(versionMatch[0]);
                if (versionAttrIndex === -1) continue;

                // Value start is after Version="
                const versionValueStartIndex = versionAttrIndex + 'Version="'.length;
                const absoluteIndex = match.index + versionValueStartIndex;

                const startPos = doc.positionAt(absoluteIndex);
                const endPos = doc.positionAt(absoluteIndex + currentVersion.length);

                if (!packagePositions.has(packageId)) {
                    packagePositions.set(packageId, []);
                }
                packagePositions.get(packageId)!.push({ start: startPos, end: endPos, version: currentVersion });

                if (!this.hasFailedRecently(packageId)) {
                    packagesToFetch.add(packageId);
                }
            }
        }

        // Fetch and decorate; with nothing to fetch, decorations from the previous text are cleared
        await this.fetchAndDecorate(packagesToFetch, packagePositions, editor, seq);
    }

    private async fetchAndDecorate(
        packageIds: Set<string>,
        packagePositions: Map<string, { start: vscode.Position, end: vscode.Position, version: string }[]>,
        editor: vscode.TextEditor,
        seq: number
    ) {
        Logger.debug(`PackageVersionDecorator.fetchAndDecorate: Fetching versions for ${Array.from(packageIds).join(', ')}`);
        const decorations: vscode.DecorationOptions[] = [];

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const sources = packageIds.size > 0
            ? await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceRoot)
            : [];

        const promises = Array.from(packageIds).map(async (packageId) => {
             if (this.hasFailedRecently(packageId)) return;

             try {
                 let latestVersion: string | null = null;

                 for (const source of sources) {
                     try {
                         const api = await nugetApiFactory.GetSourceApi(source.Url);
                         const result = await api.GetPackageAsync(packageId, this._prerelease);
                         if (!result.isError && result.data) {
                             latestVersion = result.data.Version;
                             break;
                         }
                     } catch {
                         // Try next source
                     }
                 }

                 if (latestVersion) {
                    const positions = packagePositions.get(packageId);
                    if (positions) {
                        for (const pos of positions) {
                            // Only an actually newer version is worth a hint ("1.0" equals "1.0.0")
                            if (compareVersions(latestVersion, pos.version) > 0) {
                                decorations.push({
                                    range: new vscode.Range(pos.start, pos.end),
                                    renderOptions: {
                                        after: {
                                            contentText: ` (Latest: ${latestVersion})`,
                                        }
                                    }
                                });
                            }
                        }
                    }
                 } else {
                     this._failedCache.set(packageId, Date.now());
                 }
             } catch (error) {
                 Logger.error(`PackageVersionDecorator.fetchAndDecorate: Failed to fetch version for ${packageId}`, error);
                 this._failedCache.set(packageId, Date.now());
             }
        });

        await Promise.all(promises);

        // Ensure editor is still valid and no newer update has started meanwhile
        if (seq === this._updateSeq && editor && !editor.document.isClosed) {
             editor.setDecorations(this._decorationType, decorations);
        }
    }

    dispose() {
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = undefined;
        }
        this._disposables.forEach(d => d.dispose());
        this._decorationType.dispose();
    }
}
