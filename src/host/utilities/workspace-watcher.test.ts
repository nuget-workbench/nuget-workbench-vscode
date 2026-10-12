import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { WorkspaceWatcher, RefreshKind } from './workspace-watcher';
import TaskExecutor from './task-executor';
import CpmResolver from './cpm-resolver';
import NuGetConfigResolver from './nuget-config-resolver';
import nugetApiFactory from '../nuget/api-factory';
import { Logger } from '../../common/logger';

suite('WorkspaceWatcher Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let watchers: Map<string, { create: vscode.EventEmitter<vscode.Uri>; change: vscode.EventEmitter<vscode.Uri>; delete: vscode.EventEmitter<vscode.Uri> }>;
    let configEmitter: vscode.EventEmitter<vscode.ConfigurationChangeEvent>;
    let refreshes: RefreshKind[][];
    let watcher: WorkspaceWatcher;
    let busy: boolean;

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(Logger, 'debug');
        watchers = new Map();
        sandbox.stub(vscode.workspace, 'createFileSystemWatcher').callsFake((glob: any) => {
            const emitters = {
                create: new vscode.EventEmitter<vscode.Uri>(),
                change: new vscode.EventEmitter<vscode.Uri>(),
                delete: new vscode.EventEmitter<vscode.Uri>(),
            };
            watchers.set(String(glob), emitters);
            return {
                onDidCreate: emitters.create.event,
                onDidChange: emitters.change.event,
                onDidDelete: emitters.delete.event,
                dispose: () => undefined,
            } as any;
        });
        configEmitter = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();
        sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').value(configEmitter.event);
        busy = false;
        sandbox.stub(TaskExecutor, 'IsBusy').get(() => busy);
        TaskExecutor.LastFinishedAt = 0;

        refreshes = [];
        watcher = new WorkspaceWatcher((kinds) => refreshes.push(kinds), 10, 50);
    });

    teardown(() => {
        watcher.dispose();
        sandbox.restore();
    });

    function projectWatcher() {
        return watchers.get('**/*.{csproj,fsproj,vbproj}')!;
    }

    function configFileWatcher() {
        return [...watchers.entries()].find(([glob]) => glob.includes('[Nn][Uu]'))![1];
    }

    test('reports a burst of project file changes once', async () => {
        const clearStub = sandbox.stub(CpmResolver, 'ClearCache');

        projectWatcher().change.fire(vscode.Uri.file('/repo/A/A.csproj'));
        projectWatcher().change.fire(vscode.Uri.file('/repo/B/B.csproj'));
        projectWatcher().create.fire(vscode.Uri.file('/repo/C/C.csproj'));
        await wait(40);

        assert.deepStrictEqual(refreshes, [['projects']]);
        assert.ok(clearStub.calledOnce);
    });

    test('ignores project changes while dotnet runs and shortly after', async () => {
        busy = true;
        projectWatcher().change.fire(vscode.Uri.file('/repo/A/A.csproj'));
        await wait(30);
        assert.deepStrictEqual(refreshes, []);

        busy = false;
        TaskExecutor.LastFinishedAt = Date.now();
        projectWatcher().change.fire(vscode.Uri.file('/repo/A/A.csproj'));
        await wait(30);
        assert.deepStrictEqual(refreshes, []);
    });

    test('ignores files in bin and obj folders', async () => {
        projectWatcher().create.fire(vscode.Uri.file('/repo/A/obj/Temp.csproj'));
        await wait(30);

        assert.deepStrictEqual(refreshes, []);
    });

    test('a new nuget.config refreshes the configuration and the source folders', async () => {
        const invalidateStub = sandbox.stub(NuGetConfigResolver, 'InvalidateWorkspaceDirs');
        const clearApiStub = sandbox.stub(nugetApiFactory, 'ClearCache');

        configFileWatcher().create.fire(vscode.Uri.file('/repo/nuget.config'));
        await wait(30);

        assert.deepStrictEqual(refreshes, [['configuration']]);
        assert.ok(invalidateStub.calledOnce);
        assert.ok(clearApiStub.calledOnce);
    });

    test('refreshes the configuration for view settings only', async () => {
        const event = (key: string) => ({ affectsConfiguration: (section: string) => section === key });

        configEmitter.fire(event('NugetWorkbench.logLevel'));
        configEmitter.fire(event('NugetWorkbench.enablePackageVersionInlineInfo'));
        await wait(30);
        assert.deepStrictEqual(refreshes, []);

        configEmitter.fire(event('NugetWorkbench.sources'));
        await wait(30);
        assert.deepStrictEqual(refreshes, [['configuration']]);
    });
});
