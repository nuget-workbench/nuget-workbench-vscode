import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import UpdateProject from './update-project';
import TaskExecutor from '../utilities/task-executor';
import ProjectParser from '../utilities/project-parser';
import CpmResolver from '../utilities/cpm-resolver';
import nugetApiFactory from '../nuget/api-factory';
import { Logger } from '../../common/logger';

suite('UpdateProject Handler Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: UpdateProject;
    let executeTaskStub: sinon.SinonStub;
    let projectParserStub: sinon.SinonStub;
    let cpmGetPackageVersionsStub: sinon.SinonStub;
    let cpmClearCacheStub: sinon.SinonStub;
    let apiClearCacheStub: sinon.SinonStub;
    let getConfigurationStub: sinon.SinonStub;

    const mockProject: Project = {
        Name: 'TestProject',
        Path: '/path/to/project.csproj',
        Packages: []
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        handler = new UpdateProject();

        // Mock Logger
        sandbox.stub(Logger, 'info');
        sandbox.stub(Logger, 'debug');
        sandbox.stub(Logger, 'error');

        // Mock TaskExecutor
        executeTaskStub = sandbox.stub(TaskExecutor, 'ExecuteTask').resolves();

        // Mock ProjectParser
        projectParserStub = sandbox.stub(ProjectParser, 'Parse').returns(mockProject);

        // Mock CpmResolver
        cpmGetPackageVersionsStub = sandbox.stub(CpmResolver, 'GetPackageVersions').returns(null);
        cpmClearCacheStub = sandbox.stub(CpmResolver, 'ClearCache');

        // Mock nugetApiFactory
        apiClearCacheStub = sandbox.stub(nugetApiFactory, 'ClearCache');

        // Mock vscode configuration
        const configMock = {
            get: sandbox.stub().returns('')
        };
        getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('INSTALL', () => {
        test('should install package with basic arguments', async () => {
            const request: UpdateProjectRequest = {
                ProjectPath: '/path/to/project.csproj',
                PackageId: 'TestPackage',
                Type: 'INSTALL'
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.Project, mockProject);
            assert.strictEqual(result.IsCpmEnabled, false);

            assert.ok(executeTaskStub.calledOnce);
            const task = executeTaskStub.firstCall.args[0] as vscode.Task;
            const execution = task.execution as vscode.ShellExecution;

            // Verify command arguments
            // dotnet package add TestPackage --project /path/to/project.csproj
            const args = execution.args as string[];
            assert.strictEqual(args[0], 'package');
            assert.strictEqual(args[1], 'add');
            assert.strictEqual(args[2], 'TestPackage');

            const projectIndex = args.indexOf('--project');
            assert.ok(projectIndex > -1);
            assert.strictEqual(args[projectIndex + 1], '/path/to/project.csproj');

            // Should not have version, no-restore, or source by default
            assert.ok(!args.includes('--version'));
            assert.ok(!args.includes('--no-restore'));
            assert.ok(!args.includes('-s'));

            // Verify cleanups
            assert.ok(cpmClearCacheStub.calledOnce);
            assert.ok(apiClearCacheStub.calledOnce);
            assert.ok(projectParserStub.calledWith(request.ProjectPath, null));
        });

        test('should install package with version', async () => {
            const request: UpdateProjectRequest = {
                ProjectPath: '/path/to/project.csproj',
                PackageId: 'TestPackage',
                Version: '1.2.3',
                Type: 'INSTALL'
            };

            await handler.HandleAsync(request);

            assert.ok(executeTaskStub.calledOnce);
            const task = executeTaskStub.firstCall.args[0] as vscode.Task;
            const execution = task.execution as vscode.ShellExecution;
            const args = execution.args as string[];

            const versionIndex = args.indexOf('--version');
            assert.ok(versionIndex > -1);
            assert.strictEqual(args[versionIndex + 1], '1.2.3');
        });

        test('should install package with source url', async () => {
            const request: UpdateProjectRequest = {
                ProjectPath: '/path/to/project.csproj',
                PackageId: 'TestPackage',
                Type: 'INSTALL',
                SourceUrl: 'https://source.com/index.json'
            };

            await handler.HandleAsync(request);

            assert.ok(executeTaskStub.calledOnce);
            const task = executeTaskStub.firstCall.args[0] as vscode.Task;
            const execution = task.execution as vscode.ShellExecution;
            const args = execution.args as string[];

            const sourceIndex = args.indexOf('-s');
            assert.ok(sourceIndex > -1);
            assert.strictEqual(args[sourceIndex + 1], 'https://source.com/index.json');
        });

        test('should respect skipRestore configuration', async () => {
            // Setup config to return 'true' (string or boolean depending on how it's stored, logic checks for truthiness)
            // The code does: const skipRestoreConfiguration = ... .get<string>("skipRestore") ?? "";
            // const skipRestore: boolean = !!skipRestoreConfiguration && !isCpmEnabled;
            // So if it returns a non-empty string, it's true.
            getConfigurationStub.returns({
                get: sandbox.stub().withArgs('skipRestore').returns('true')
            } as any);

            const request: UpdateProjectRequest = {
                ProjectPath: '/path/to/project.csproj',
                PackageId: 'TestPackage',
                Type: 'INSTALL'
            };

            await handler.HandleAsync(request);

            const task = executeTaskStub.firstCall.args[0] as vscode.Task;
            const execution = task.execution as vscode.ShellExecution;
            const args = execution.args as string[];

            assert.ok(args.includes('--no-restore'));
        });

        test('should ignore skipRestore when CPM is enabled', async () => {
            // Setup CPM enabled
            cpmGetPackageVersionsStub.returns(new Map());

            // Setup config to return 'true'
            getConfigurationStub.returns({
                get: sandbox.stub().withArgs('skipRestore').returns('true')
            } as any);

            const request: UpdateProjectRequest = {
                ProjectPath: '/path/to/project.csproj',
                PackageId: 'TestPackage',
                Type: 'INSTALL'
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsCpmEnabled, true);

            const task = executeTaskStub.firstCall.args[0] as vscode.Task;
            const execution = task.execution as vscode.ShellExecution;
            const args = execution.args as string[];

            assert.ok(!args.includes('--no-restore'));
        });
    });

    suite('UNINSTALL', () => {
        test('should remove package', async () => {
            const request: UpdateProjectRequest = {
                ProjectPath: '/path/to/project.csproj',
                PackageId: 'TestPackage',
                Type: 'UNINSTALL'
            };

            await handler.HandleAsync(request);

            assert.ok(executeTaskStub.calledOnce);
            const task = executeTaskStub.firstCall.args[0] as vscode.Task;
            const execution = task.execution as vscode.ShellExecution;
            const args = execution.args as string[];

            // dotnet package remove TestPackage --project /path/to/project.csproj
            assert.strictEqual(args[0], 'package');
            assert.strictEqual(args[1], 'remove');
            assert.strictEqual(args[2], 'TestPackage');
        });
    });

    suite('UPDATE', () => {
        test('should remove then add package', async () => {
            const request: UpdateProjectRequest = {
                ProjectPath: '/path/to/project.csproj',
                PackageId: 'TestPackage',
                Version: '2.0.0',
                Type: 'UPDATE'
            };

            await handler.HandleAsync(request);

            assert.strictEqual(executeTaskStub.callCount, 2);

            // First call: Remove
            const removeTask = executeTaskStub.firstCall.args[0] as vscode.Task;
            const removeExec = removeTask.execution as vscode.ShellExecution;
            const removeArgs = removeExec.args as string[];
            assert.strictEqual(removeArgs[1], 'remove');

            // Second call: Add
            const addTask = executeTaskStub.secondCall.args[0] as vscode.Task;
            const addExec = addTask.execution as vscode.ShellExecution;
            const addArgs = addExec.args as string[];
            assert.strictEqual(addArgs[1], 'add');

            // Verify version is passed to add command
            const versionIndex = addArgs.indexOf('--version');
            assert.ok(versionIndex > -1);
            assert.strictEqual(addArgs[versionIndex + 1], '2.0.0');
        });

        test('should pass source url to add command during update', async () => {
            const request: UpdateProjectRequest = {
                ProjectPath: '/path/to/project.csproj',
                PackageId: 'TestPackage',
                Version: '2.0.0',
                Type: 'UPDATE',
                SourceUrl: 'https://source.com/index.json'
            };

            await handler.HandleAsync(request);

            assert.strictEqual(executeTaskStub.callCount, 2);

            const addTask = executeTaskStub.secondCall.args[0] as vscode.Task;
            const addExec = addTask.execution as vscode.ShellExecution;
            const addArgs = addExec.args as string[];

            const sourceIndex = addArgs.indexOf('-s');
            assert.ok(sourceIndex > -1);
            assert.strictEqual(addArgs[sourceIndex + 1], 'https://source.com/index.json');
        });
    });
});
