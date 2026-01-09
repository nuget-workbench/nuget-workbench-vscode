import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { GetPackage } from './get-package';
import nugetApiFactory from '../nuget/api-factory';
import NuGetConfigResolver from '../utilities/nuget-config-resolver';
import { Logger } from '../../common/logger';
import { GetPackageRequest, GetPackageResponse } from '../../common/messaging/get-package';

suite('GetPackage Handler Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: GetPackage;
    let getSourceApiStub: sinon.SinonStub;
    let getSourcesStub: sinon.SinonStub;
    let workspaceFoldersStub: sinon.SinonStub;

    const mockPackage = {
        Id: 'TestPackage',
        Version: '1.0.0',
        Authors: ['Test Author'],
        Description: 'Test Description',
        Versions: []
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        handler = new GetPackage();

        // Mock Logger
        sandbox.stub(Logger, 'debug');
        sandbox.stub(Logger, 'info');
        sandbox.stub(Logger, 'error');
        sandbox.stub(Logger, 'warn');

        // Mock nugetApiFactory
        getSourceApiStub = sandbox.stub(nugetApiFactory, 'GetSourceApi');

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

    suite('With Specific URL', () => {
        test('should fetch package from specified URL', async () => {
            const mockApi = {
                GetPackageAsync: sandbox.stub().resolves({ data: mockPackage, isError: false }),
                ClearPackageCache: sandbox.stub()
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Id: 'TestPackage',
                Prerelease: false
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.deepStrictEqual(result.Package, mockPackage);
            assert.strictEqual(result.SourceUrl, request.Url);
            assert.ok(getSourceApiStub.calledWith(request.Url));
            assert.ok(mockApi.GetPackageAsync.calledWith('TestPackage'));
        });

        test('should return error when API call returns error', async () => {
            const mockApi = {
                GetPackageAsync: sandbox.stub().resolves({ isError: true, data: null }),
                ClearPackageCache: sandbox.stub()
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Id: 'TestPackage',
                Prerelease: false
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, true);
            assert.strictEqual(result.Error?.Message, 'Failed to fetch package');
            assert.ok((Logger.error as sinon.SinonStub).called);
        });

        test('should return error when API call throws exception', async () => {
            const mockApi = {
                GetPackageAsync: sandbox.stub().rejects(new Error('Network error')),
                ClearPackageCache: sandbox.stub()
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Id: 'TestPackage',
                Prerelease: false
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, true);
            assert.strictEqual(result.Error?.Message, 'Failed to fetch package');
            assert.ok((Logger.error as sinon.SinonStub).called);
        });

        test('should clear cache when ForceReload is true', async () => {
            const mockApi = {
                GetPackageAsync: sandbox.stub().resolves({ data: mockPackage, isError: false }),
                ClearPackageCache: sandbox.stub()
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageRequest = {
                Url: 'https://api.nuget.org/v3/index.json',
                Id: 'TestPackage',
                Prerelease: false,
                ForceReload: true
            };

            await handler.HandleAsync(request);

            assert.ok(mockApi.ClearPackageCache.calledWith('TestPackage'));
        });
    });

    suite('Without URL (Auto-resolve from config)', () => {
        test('should use first successful source', async () => {
            const sources = [
                { Url: 'https://source1.com', Name: 'Source1', Password: '' },
                { Url: 'https://source2.com', Name: 'Source2', Password: '' }
            ];
            getSourcesStub.resolves(sources);

            const mockApi1 = {
                GetPackageAsync: sandbox.stub().resolves({ data: mockPackage, isError: false }),
                ClearPackageCache: sandbox.stub()
            };

            getSourceApiStub.withArgs('https://source1.com').resolves(mockApi1);

            const request: GetPackageRequest = {
                Url: '',
                Id: 'TestPackage',
                Prerelease: false
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.deepStrictEqual(result.Package, mockPackage);
            assert.strictEqual(result.SourceUrl, 'https://source1.com');
            assert.ok(mockApi1.GetPackageAsync.calledWith('TestPackage'));
        });

        test('should fail over to next source if first fails', async () => {
            const sources = [
                { Url: 'https://source1.com', Name: 'Source1', Password: '' },
                { Url: 'https://source2.com', Name: 'Source2', Password: '' }
            ];
            getSourcesStub.resolves(sources);

            const mockApi1 = {
                GetPackageAsync: sandbox.stub().resolves({ isError: true }),
                ClearPackageCache: sandbox.stub()
            };
            const mockApi2 = {
                GetPackageAsync: sandbox.stub().resolves({ data: mockPackage, isError: false }),
                ClearPackageCache: sandbox.stub()
            };

            getSourceApiStub.withArgs('https://source1.com').resolves(mockApi1);
            getSourceApiStub.withArgs('https://source2.com').resolves(mockApi2);

            const request: GetPackageRequest = {
                Url: '',
                Id: 'TestPackage',
                Prerelease: false
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.deepStrictEqual(result.Package, mockPackage);
            assert.strictEqual(result.SourceUrl, 'https://source2.com');
            // Logger.warn is only called on exception, not on API error result
            assert.ok((Logger.warn as sinon.SinonStub).notCalled);
        });

        test('should fail if all sources fail', async () => {
            const sources = [
                { Url: 'https://source1.com', Name: 'Source1', Password: '' }
            ];
            getSourcesStub.resolves(sources);

            const mockApi1 = {
                GetPackageAsync: sandbox.stub().resolves({ isError: true }),
                ClearPackageCache: sandbox.stub()
            };

            getSourceApiStub.withArgs('https://source1.com').resolves(mockApi1);

            const request: GetPackageRequest = {
                Url: '',
                Id: 'TestPackage',
                Prerelease: false
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, true);
            assert.strictEqual(result.Error?.Message, 'Failed to fetch package from any source');
        });

        test('should handle no sources', async () => {
            getSourcesStub.resolves([]);

            const request: GetPackageRequest = {
                Url: '',
                Id: 'TestPackage',
                Prerelease: false
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, true);
            assert.strictEqual(result.Error?.Message, 'Failed to fetch package from any source');
        });

        test('should handle source exception and continue', async () => {
            const sources = [
                { Url: 'https://source1.com', Name: 'Source1', Password: '' },
                { Url: 'https://source2.com', Name: 'Source2', Password: '' }
            ];
            getSourcesStub.resolves(sources);

            const mockApi1 = {
                GetPackageAsync: sandbox.stub().rejects(new Error('Network Error')),
                ClearPackageCache: sandbox.stub()
            };
            const mockApi2 = {
                GetPackageAsync: sandbox.stub().resolves({ data: mockPackage, isError: false }),
                ClearPackageCache: sandbox.stub()
            };

            getSourceApiStub.withArgs('https://source1.com').resolves(mockApi1);
            getSourceApiStub.withArgs('https://source2.com').resolves(mockApi2);

            const request: GetPackageRequest = {
                Url: '',
                Id: 'TestPackage',
                Prerelease: false
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.strictEqual(result.SourceUrl, 'https://source2.com');
            assert.ok((Logger.warn as sinon.SinonStub).called);
        });
    });
});
