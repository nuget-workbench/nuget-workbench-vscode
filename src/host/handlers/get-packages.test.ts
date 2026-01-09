import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { GetPackages } from './get-packages';
import nugetApiFactory from '../nuget/api-factory';
import NuGetConfigResolver from '../utilities/nuget-config-resolver';
import StatusBarUtils from '../utilities/status-bar-utils';
import { Logger } from '../../common/logger';

suite('GetPackages Handler Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: GetPackages;
    let getSourceApiStub: sinon.SinonStub;
    let getSourcesStub: sinon.SinonStub;
    let statusBarShowStub: sinon.SinonStub;
    let statusBarHideStub: sinon.SinonStub;
    let clearCacheStub: sinon.SinonStub;
    let workspaceFoldersStub: sinon.SinonStub;

    const createMockPackage = (id: string, version: string): Package => ({
        Id: id,
        Name: id,
        Version: version,
        Authors: ['Author'],
        Description: `Description for ${id}`,
        IconUrl: '',
        LicenseUrl: '',
        ProjectUrl: '',
        Registration: '',
        TotalDownloads: 100,
        Verified: false,
        InstalledVersion: '',
        Versions: [],
        Tags: []
    });

    const mockPackages: Package[] = [
        createMockPackage('Package1', '1.0.0'),
        createMockPackage('Package2', '2.0.0')
    ];

    setup(() => {
        sandbox = sinon.createSandbox();
        handler = new GetPackages();

        // Mock Logger
        sandbox.stub(Logger, 'debug');
        sandbox.stub(Logger, 'info');
        sandbox.stub(Logger, 'error');
        sandbox.stub(Logger, 'warn');

        // Mock StatusBarUtils
        statusBarShowStub = sandbox.stub(StatusBarUtils, 'show');
        statusBarHideStub = sandbox.stub(StatusBarUtils, 'hide');

        // Mock nugetApiFactory
        getSourceApiStub = sandbox.stub(nugetApiFactory, 'GetSourceApi');
        clearCacheStub = sandbox.stub(nugetApiFactory, 'ClearCache');

        // Mock NuGetConfigResolver
        getSourcesStub = sandbox.stub(NuGetConfigResolver, 'GetSourcesAndDecodePasswords');

        // Mock vscode.workspace.workspaceFolders
        workspaceFoldersStub = sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: { fsPath: '/workspace/root' }, name: 'root', index: 0 }
        ]);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Basic Functionality', () => {
        test('should show and hide status bar during operation', async () => {
            const mockApi = {
                GetPackagesAsync: sandbox.stub().resolves({ data: [] })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackagesRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Filter: 'test',
                Prerelease: false,
                Skip: 0,
                Take: 10
            };

            await handler.HandleAsync(request);

            assert.ok(statusBarShowStub.called, 'StatusBar.show should be called');
            assert.ok(statusBarHideStub.calledOnce, 'StatusBar.hide should be called once');
        });

        test('should clear cache when ForceReload is true', async () => {
            const mockApi = {
                GetPackagesAsync: sandbox.stub().resolves({ data: [] })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackagesRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Filter: 'test',
                Prerelease: false,
                Skip: 0,
                Take: 10,
                ForceReload: true
            };

            await handler.HandleAsync(request);

            assert.ok(clearCacheStub.calledOnce, 'ClearCache should be called when ForceReload is true');
        });

        test('should not clear cache when ForceReload is false', async () => {
            const mockApi = {
                GetPackagesAsync: sandbox.stub().resolves({ data: [] })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackagesRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Filter: 'test',
                Prerelease: false,
                Skip: 0,
                Take: 10,
                ForceReload: false
            };

            await handler.HandleAsync(request);

            assert.ok(clearCacheStub.notCalled, 'ClearCache should not be called when ForceReload is false');
        });
    });

    suite('With Specific URL', () => {
        test('should fetch packages from specified URL', async () => {
            const mockApi = {
                GetPackagesAsync: sandbox.stub().resolves({ data: mockPackages })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackagesRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Filter: 'Newtonsoft',
                Prerelease: false,
                Skip: 0,
                Take: 20
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.strictEqual(result.Packages?.length, 2);
            assert.ok(getSourceApiStub.calledWith('https://api.nuget.org/v3/index.json'));
            assert.ok(mockApi.GetPackagesAsync.calledWith('Newtonsoft', false, 0, 20));
        });

        test('should return error response when API call fails', async () => {
            const mockApi = {
                GetPackagesAsync: sandbox.stub().rejects(new Error('Network error'))
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackagesRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Filter: 'test',
                Prerelease: false,
                Skip: 0,
                Take: 10
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, true);
            assert.strictEqual(result.Error?.Message, 'Failed to fetch packages');
            assert.ok((Logger.error as sinon.SinonStub).called);
        });

        test('should pass prerelease flag correctly', async () => {
            const mockApi = {
                GetPackagesAsync: sandbox.stub().resolves({ data: [] })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackagesRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Filter: 'test',
                Prerelease: true,
                Skip: 0,
                Take: 10
            };

            await handler.HandleAsync(request);

            assert.ok(mockApi.GetPackagesAsync.calledWith('test', true, 0, 10));
        });
    });

    suite('Without URL (Auto-resolve from config)', () => {
        test('should return empty packages when no sources configured and no filter', async () => {
            getSourcesStub.resolves([]);

            const request: GetPackagesRequest = {
                Url: '',
                Filter: '',
                Prerelease: false,
                Skip: 0,
                Take: 10
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.strictEqual(result.Packages?.length, 0);
        });

        test('should use first source URL when no filter and Url is empty', async () => {
            getSourcesStub.resolves([
                { Name: 'nuget.org', Url: 'https://api.nuget.org/v3/index.json', Password: '' },
                { Name: 'Private', Url: 'https://private.nuget.org/v3/index.json', Password: '' }
            ]);

            const mockApi = {
                GetPackagesAsync: sandbox.stub().resolves({ data: mockPackages })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackagesRequest = {
                Url: '',
                Filter: '',
                Prerelease: false,
                Skip: 0,
                Take: 10
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.ok(getSourceApiStub.calledWith('https://api.nuget.org/v3/index.json'));
        });

        test('should search all sources when filter is provided and Url is empty', async () => {
            getSourcesStub.resolves([
                { Name: 'Source1', Url: 'https://source1.nuget.org/v3/index.json', Password: '' },
                { Name: 'Source2', Url: 'https://source2.nuget.org/v3/index.json', Password: '' }
            ]);

            const source1Packages: Package[] = [createMockPackage('Package1', '1.0.0')];
            const source2Packages: Package[] = [createMockPackage('Package2', '2.0.0')];

            const mockApi1 = { GetPackagesAsync: sandbox.stub().resolves({ data: source1Packages }) };
            const mockApi2 = { GetPackagesAsync: sandbox.stub().resolves({ data: source2Packages }) };

            getSourceApiStub.withArgs('https://source1.nuget.org/v3/index.json').resolves(mockApi1);
            getSourceApiStub.withArgs('https://source2.nuget.org/v3/index.json').resolves(mockApi2);

            const request: GetPackagesRequest = {
                Url: '',
                Filter: 'test',
                Prerelease: false,
                Skip: 0,
                Take: 10
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.strictEqual(result.Packages?.length, 2);
            assert.ok(result.Packages?.some(p => p.Id === 'Package1'));
            assert.ok(result.Packages?.some(p => p.Id === 'Package2'));
        });

        test('should deduplicate packages from multiple sources', async () => {
            getSourcesStub.resolves([
                { Name: 'Source1', Url: 'https://source1.nuget.org/v3/index.json', Password: '' },
                { Name: 'Source2', Url: 'https://source2.nuget.org/v3/index.json', Password: '' }
            ]);

            const duplicatePackage = createMockPackage('DuplicatePackage', '1.0.0');

            const mockApi1 = { GetPackagesAsync: sandbox.stub().resolves({ data: [duplicatePackage] }) };
            const mockApi2 = { GetPackagesAsync: sandbox.stub().resolves({ data: [duplicatePackage] }) };

            getSourceApiStub.withArgs('https://source1.nuget.org/v3/index.json').resolves(mockApi1);
            getSourceApiStub.withArgs('https://source2.nuget.org/v3/index.json').resolves(mockApi2);

            const request: GetPackagesRequest = {
                Url: '',
                Filter: 'test',
                Prerelease: false,
                Skip: 0,
                Take: 10
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.strictEqual(result.Packages?.length, 1, 'Duplicate packages should be filtered out');
            assert.strictEqual(result.Packages?.[0].Id, 'DuplicatePackage');
        });

        test('should continue fetching from other sources when one fails', async () => {
            getSourcesStub.resolves([
                { Name: 'FailingSource', Url: 'https://failing.nuget.org/v3/index.json', Password: '' },
                { Name: 'WorkingSource', Url: 'https://working.nuget.org/v3/index.json', Password: '' }
            ]);

            const workingPackages: Package[] = [createMockPackage('WorkingPackage', '1.0.0')];

            const mockApiFailure = { GetPackagesAsync: sandbox.stub().rejects(new Error('Source error')) };
            const mockApiSuccess = { GetPackagesAsync: sandbox.stub().resolves({ data: workingPackages }) };

            getSourceApiStub.withArgs('https://failing.nuget.org/v3/index.json').resolves(mockApiFailure);
            getSourceApiStub.withArgs('https://working.nuget.org/v3/index.json').resolves(mockApiSuccess);

            const request: GetPackagesRequest = {
                Url: '',
                Filter: 'test',
                Prerelease: false,
                Skip: 0,
                Take: 10
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.strictEqual(result.Packages?.length, 1);
            assert.strictEqual(result.Packages?.[0].Id, 'WorkingPackage');
            assert.ok((Logger.error as sinon.SinonStub).called, 'Error should be logged for failing source');
        });

        test('should update status bar progress for each source', async () => {
            getSourcesStub.resolves([
                { Name: 'Source1', Url: 'https://source1.nuget.org/v3/index.json', Password: '' },
                { Name: 'Source2', Url: 'https://source2.nuget.org/v3/index.json', Password: '' }
            ]);

            const mockApi = { GetPackagesAsync: sandbox.stub().resolves({ data: [] }) };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackagesRequest = {
                Url: '',
                Filter: 'test',
                Prerelease: false,
                Skip: 0,
                Take: 10
            };

            await handler.HandleAsync(request);

            // Should be called initially with 0% and then for each source completion
            assert.ok(statusBarShowStub.calledWith(0, 'Loading packages...'), 'Initial status bar message');
            // There should be calls for progress updates (50% and 100%)
            assert.ok(statusBarShowStub.callCount >= 2, 'Status bar should be updated multiple times');
        });
    });

    suite('Edge Cases', () => {
        test('should handle undefined workspace folders', async () => {
            sandbox.restore();
            sandbox = sinon.createSandbox();
            
            // Re-stub everything without workspace folders
            sandbox.stub(Logger, 'debug');
            sandbox.stub(Logger, 'info');
            sandbox.stub(Logger, 'error');
            sandbox.stub(Logger, 'warn');
            statusBarShowStub = sandbox.stub(StatusBarUtils, 'show');
            statusBarHideStub = sandbox.stub(StatusBarUtils, 'hide');
            getSourceApiStub = sandbox.stub(nugetApiFactory, 'GetSourceApi');
            getSourcesStub = sandbox.stub(NuGetConfigResolver, 'GetSourcesAndDecodePasswords');
            
            // Set workspaceFolders to undefined
            sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
            
            getSourcesStub.resolves([]);

            const request: GetPackagesRequest = {
                Url: '',
                Filter: '',
                Prerelease: false,
                Skip: 0,
                Take: 10
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.deepStrictEqual(result.Packages, []);
        });

        test('should handle empty filter with sources available', async () => {
            getSourcesStub.resolves([
                { Name: 'nuget.org', Url: 'https://api.nuget.org/v3/index.json', Password: '' }
            ]);

            const mockApi = {
                GetPackagesAsync: sandbox.stub().resolves({ data: mockPackages })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackagesRequest = {
                Url: '',
                Filter: '',
                Prerelease: false,
                Skip: 0,
                Take: 10
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            // When filter is empty and Url is empty, it should use the first source
            assert.ok(getSourceApiStub.calledWith('https://api.nuget.org/v3/index.json'));
        });

        test('should handle skip and take parameters correctly', async () => {
            const mockApi = {
                GetPackagesAsync: sandbox.stub().resolves({ data: [] })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackagesRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Filter: 'test',
                Prerelease: false,
                Skip: 50,
                Take: 25
            };

            await handler.HandleAsync(request);

            assert.ok(mockApi.GetPackagesAsync.calledWith('test', false, 50, 25));
        });
    });
});
