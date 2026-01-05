import * as vscode from 'vscode';
import nugetApiFactory from '../nuget/api-factory';
import NuGetConfigResolver from '../utilities/nuget-config-resolver';
import { Logger } from '../../common/logger';

export class PackageVersionDecorator implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _decorationType: vscode.TextEditorDecorationType;
    private _failedCache: Set<string> = new Set(); // PackageIds that failed to fetch
    private _isEnabled: boolean = false;

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
            if (e.affectsConfiguration('NugetGallery.enablePackageVersionInlineInfo')) {
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
        this._isEnabled = vscode.workspace.getConfiguration('NugetGallery').get<boolean>('enablePackageVersionInlineInfo', false);
        Logger.debug(`PackageVersionDecorator.updateConfiguration: Configuration updated, enabled=${this._isEnabled}`);
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

    private async updateDecorations(editor: vscode.TextEditor) {
        if (!editor || editor.document.isClosed) {
            return;
        }

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

                if (!this._failedCache.has(packageId)) {
                    packagesToFetch.add(packageId);
                }
            }
        }

        // Fetch and decorate
        if (packagesToFetch.size > 0) {
            this.fetchAndDecorate(packagesToFetch, packagePositions, editor);
        }
    }

    private async fetchAndDecorate(
        packageIds: Set<string>,
        packagePositions: Map<string, { start: vscode.Position, end: vscode.Position, version: string }[]>,
        editor: vscode.TextEditor
    ) {
        Logger.debug(`PackageVersionDecorator.fetchAndDecorate: Fetching versions for ${Array.from(packageIds).join(', ')}`);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const sources = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceRoot);
        const decorations: vscode.DecorationOptions[] = [];

        if (sources.length === 0) {
            Logger.warn('PackageVersionDecorator.fetchAndDecorate: No NuGet sources configured.');
            return;
        }

        const promises = Array.from(packageIds).map(async (packageId) => {
             if (this._failedCache.has(packageId)) return;

             try {
                 // Try sources in order until found
                 let found = false;
                 let latestVersion: string | undefined;

                 for (const source of sources) {
                     try {
                         const api = await nugetApiFactory.GetSourceApi(source.Url);
                         const result = await api.GetPackageAsync(packageId);

                         if (!result.isError && result.data) {
                             latestVersion = result.data.Version;
                             found = true;
                             break;
                         }
                     } catch (e) {
                         // Try next source
                     }
                 }

                 if (found && latestVersion) {
                    const positions = packagePositions.get(packageId);
                    if (positions) {
                        for (const pos of positions) {
                            if (pos.version !== latestVersion) {
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
                     this._failedCache.add(packageId);
                 }
             } catch (error) {
                 Logger.error(`PackageVersionDecorator.fetchAndDecorate: Failed to fetch version for ${packageId}`, error);
                 this._failedCache.add(packageId);
             }
        });

        await Promise.all(promises);

        // Ensure editor is still active and valid
        if (editor && !editor.document.isClosed) {
             editor.setDecorations(this._decorationType, decorations);
        }
    }

    dispose() {
        this._disposables.forEach(d => d.dispose());
        this._decorationType.dispose();
    }
}
