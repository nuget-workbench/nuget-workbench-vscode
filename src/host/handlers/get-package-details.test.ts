import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { GetPackageDetails } from './get-package-details';
import nugetApiFactory from '../nuget/api-factory';
import { Logger } from '../../common/logger';

suite('GetPackageDetails Handler Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: GetPackageDetails;
    let getSourceApiStub: sinon.SinonStub;

    const mockPackageDetails: PackageDetails = {
        dependencies: {
            frameworks: {
                'net6.0': [
                    { package: 'Microsoft.Extensions.Logging', versionRange: '[6.0.0, )' },
                    { package: 'System.Text.Json', versionRange: '[6.0.0, )' }
                ],
                'netstandard2.0': [
                    { package: 'Newtonsoft.Json', versionRange: '[13.0.0, )' }
                ]
            }
        }
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        handler = new GetPackageDetails();

        // Mock Logger
        sandbox.stub(Logger, 'debug');
        sandbox.stub(Logger, 'info');
        sandbox.stub(Logger, 'error');
        sandbox.stub(Logger, 'warn');

        // Mock nugetApiFactory
        getSourceApiStub = sandbox.stub(nugetApiFactory, 'GetSourceApi');
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Successful Requests', () => {
        test('should fetch package details successfully', async () => {
            const mockApi = {
                GetPackageDetailsAsync: sandbox.stub().resolves({ data: mockPackageDetails })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                PackageVersionUrl: 'https://api.nuget.org/v3/registration/newtonsoft.json/13.0.1.json'
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.ok(result.Package);
            assert.deepStrictEqual(result.Package, mockPackageDetails);
        });

        test('should call GetSourceApi with correct SourceUrl', async () => {
            const mockApi = {
                GetPackageDetailsAsync: sandbox.stub().resolves({ data: mockPackageDetails })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://private.nuget.org/v3/index.json',
                PackageVersionUrl: 'https://private.nuget.org/v3/registration/mypackage/1.0.0.json'
            };

            await handler.HandleAsync(request);

            assert.ok(getSourceApiStub.calledWith('https://private.nuget.org/v3/index.json'));
        });

        test('should call GetPackageDetailsAsync with correct PackageVersionUrl', async () => {
            const mockApi = {
                GetPackageDetailsAsync: sandbox.stub().resolves({ data: mockPackageDetails })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                PackageVersionUrl: 'https://api.nuget.org/v3/registration/serilog/2.0.0.json'
            };

            await handler.HandleAsync(request);

            assert.ok(mockApi.GetPackageDetailsAsync.calledWith('https://api.nuget.org/v3/registration/serilog/2.0.0.json'));
        });

        test('should log info message when fetching details', async () => {
            const mockApi = {
                GetPackageDetailsAsync: sandbox.stub().resolves({ data: mockPackageDetails })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                PackageVersionUrl: 'https://api.nuget.org/v3/registration/test/1.0.0.json'
            };

            await handler.HandleAsync(request);

            assert.ok((Logger.info as sinon.SinonStub).calledWith(
                'GetPackageDetails.HandleAsync: Fetching details from https://api.nuget.org/v3/registration/test/1.0.0.json'
            ));
        });
    });

    suite('Validation Errors', () => {
        test('should return error when SourceUrl is empty', async () => {
            const request: GetPackageDetailsRequest = {
                SourceUrl: '',
                PackageVersionUrl: 'https://api.nuget.org/v3/registration/test/1.0.0.json'
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, true);
            assert.strictEqual(result.Error?.Message, 'SourceUrl is empty');
            assert.ok(getSourceApiStub.notCalled, 'Should not call API when SourceUrl is empty');
        });

        test('should return error when PackageVersionUrl is empty', async () => {
            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                PackageVersionUrl: ''
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, true);
            assert.strictEqual(result.Error?.Message, 'PackageVersionUrl is empty');
            assert.ok(getSourceApiStub.notCalled, 'Should not call API when PackageVersionUrl is empty');
        });

        test('should return error when both SourceUrl and PackageVersionUrl are empty', async () => {
            const request: GetPackageDetailsRequest = {
                SourceUrl: '',
                PackageVersionUrl: ''
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, true);
            // SourceUrl is checked first
            assert.strictEqual(result.Error?.Message, 'SourceUrl is empty');
        });
    });

    suite('API Errors', () => {
        test('should return error response when API call fails', async () => {
            const mockApi = {
                GetPackageDetailsAsync: sandbox.stub().rejects(new Error('Network error'))
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                PackageVersionUrl: 'https://api.nuget.org/v3/registration/test/1.0.0.json'
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, true);
            assert.strictEqual(result.Error?.Message, 'Failed to fetch package details');
        });

        test('should log error when API call fails', async () => {
            const error = new Error('Connection timeout');
            const mockApi = {
                GetPackageDetailsAsync: sandbox.stub().rejects(error)
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                PackageVersionUrl: 'https://api.nuget.org/v3/registration/test/1.0.0.json'
            };

            await handler.HandleAsync(request);

            assert.ok((Logger.error as sinon.SinonStub).called);
            const loggerCall = (Logger.error as sinon.SinonStub).firstCall;
            assert.ok(loggerCall.args[0].includes('Failed to fetch package details'));
            assert.ok(loggerCall.args[0].includes('https://api.nuget.org/v3/registration/test/1.0.0.json'));
        });

        test('should throw error when GetSourceApi fails', async () => {
            getSourceApiStub.rejects(new Error('Failed to create API'));

            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                PackageVersionUrl: 'https://api.nuget.org/v3/registration/test/1.0.0.json'
            };

            // GetSourceApi is called outside the try-catch, so the error propagates
            try {
                await handler.HandleAsync(request);
                assert.fail('Expected an error to be thrown');
            } catch (err: any) {
                assert.strictEqual(err.message, 'Failed to create API');
            }
        });
    });

    suite('Edge Cases', () => {
        test('should handle package with no dependencies', async () => {
            const emptyDependencies: PackageDetails = {
                dependencies: {
                    frameworks: {}
                }
            };
            const mockApi = {
                GetPackageDetailsAsync: sandbox.stub().resolves({ data: emptyDependencies })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                PackageVersionUrl: 'https://api.nuget.org/v3/registration/simple/1.0.0.json'
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.deepStrictEqual(result.Package?.dependencies.frameworks, {});
        });

        test('should handle package with many frameworks', async () => {
            const multiFramework: PackageDetails = {
                dependencies: {
                    frameworks: {
                        'net45': [],
                        'net46': [],
                        'net47': [],
                        'net48': [],
                        'netstandard1.0': [],
                        'netstandard2.0': [],
                        'netstandard2.1': [],
                        'net5.0': [],
                        'net6.0': [],
                        'net7.0': [],
                        'net8.0': []
                    }
                }
            };
            const mockApi = {
                GetPackageDetailsAsync: sandbox.stub().resolves({ data: multiFramework })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                PackageVersionUrl: 'https://api.nuget.org/v3/registration/multiplatform/1.0.0.json'
            };

            const result = await handler.HandleAsync(request);

            assert.strictEqual(result.IsFailure, false);
            assert.strictEqual(Object.keys(result.Package?.dependencies.frameworks || {}).length, 11);
        });

        test('should handle optional request parameters', async () => {
            const mockApi = {
                GetPackageDetailsAsync: sandbox.stub().resolves({ data: mockPackageDetails })
            };
            getSourceApiStub.resolves(mockApi);

            const request: GetPackageDetailsRequest = {
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                PackageVersionUrl: 'https://api.nuget.org/v3/registration/test/1.0.0.json',
                SourceName: 'nuget.org',
                PasswordScriptPath: '/path/to/script.ps1'
            };

            const result = await handler.HandleAsync(request);

            // Optional parameters don't affect the result, just ensuring they don't break anything
            assert.strictEqual(result.IsFailure, false);
            assert.ok(result.Package);
        });
    });
});
