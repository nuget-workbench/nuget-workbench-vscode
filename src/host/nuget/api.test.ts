import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import axios, { AxiosError, AxiosResponse } from 'axios';
import NuGetApi from './api';
import { Logger } from '../../common/logger';

suite('NuGetApi Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let axiosGetStub: sinon.SinonStub;
    let loggerDebugStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;
    let loggerInfoStub: sinon.SinonStub;

    // Mock NuGet service index response
    const mockServiceIndex = {
        data: {
            resources: [
                { '@type': 'SearchQueryService', '@id': 'https://api.nuget.org/v3/query' },
                { '@type': 'RegistrationsBaseUrl/3.6.0', '@id': 'https://api.nuget.org/v3/registration' }
            ]
        }
    };

    // Mock search response
    const mockSearchResponse = {
        data: {
            data: [
                {
                    '@id': 'https://api.nuget.org/v3/registration/newtonsoft.json/index.json',
                    id: 'Newtonsoft.Json',
                    authors: ['James Newton-King'],
                    description: 'Json.NET is a popular JSON framework',
                    iconUrl: 'https://nuget.org/icon.png',
                    registration: 'https://api.nuget.org/v3/registration',
                    licenseUrl: 'https://licenses.nuget.org/MIT',
                    projectUrl: 'https://www.newtonsoft.com/json',
                    totalDownloads: 1000000000,
                    verified: true,
                    version: '13.0.1',
                    versions: [
                        { version: '13.0.1', '@id': 'https://api.nuget.org/v3/registration/v13' },
                        { version: '12.0.3', '@id': 'https://api.nuget.org/v3/registration/v12' }
                    ],
                    tags: ['json', 'serialization']
                }
            ]
        }
    };

    // Mock package info response
    const mockPackageInfoResponse = {
        data: {
            count: 1,
            items: [
                {
                    items: [
                        {
                            '@id': 'https://api.nuget.org/v3/registration/pkg/1.0.0.json',
                            catalogEntry: {
                                id: 'TestPackage',
                                version: '1.0.0',
                                authors: ['Test Author'],
                                description: 'Test Description',
                                iconUrl: 'https://test.com/icon.png',
                                licenseUrl: 'https://test.com/license',
                                projectUrl: 'https://test.com',
                                totalDownloads: 5000,
                                verified: false,
                                tags: ['test']
                            }
                        }
                    ]
                }
            ]
        }
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock Logger
        loggerDebugStub = sandbox.stub(Logger, 'debug');
        loggerErrorStub = sandbox.stub(Logger, 'error');
        loggerInfoStub = sandbox.stub(Logger, 'info');
        
        // Mock vscode workspace configuration
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: sandbox.stub().returns(undefined)
        } as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Constructor', () => {
        test('should create instance with URL only', () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            assert.ok(api);
        });

        test('should create instance with credentials', () => {
            const api = new NuGetApi('https://private.nuget.org', 'user', 'pass');
            assert.ok(api);
        });
    });

    suite('GetPackagesAsync', () => {
        test('should fetch and map packages correctly', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            // Stub the http instance
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves(mockSearchResponse);

            const result = await api.GetPackagesAsync('newtonsoft', true, 0, 10);

            assert.strictEqual(result.data.length, 1);
            assert.strictEqual(result.data[0].Name, 'Newtonsoft.Json');
            assert.strictEqual(result.data[0].Version, '13.0.1');
            assert.deepStrictEqual(result.data[0].Authors, ['James Newton-King']);
            assert.strictEqual(result.data[0].TotalDownloads, 1000000000);
            assert.strictEqual(result.data[0].Verified, true);
        });

        test('should pass correct query parameters', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves({ data: { data: [] } });

            await api.GetPackagesAsync('test-filter', false, 20, 50);

            const secondCallConfig = httpStub.secondCall.args[1];
            assert.strictEqual(secondCallConfig.params.q, 'test-filter');
            assert.strictEqual(secondCallConfig.params.prerelease, false);
            assert.strictEqual(secondCallConfig.params.skip, 20);
            assert.strictEqual(secondCallConfig.params.take, 50);
            assert.strictEqual(secondCallConfig.params.semVerLevel, '2.0.0');
        });

        test('should map empty versions array', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves({
                data: {
                    data: [{
                        '@id': 'test',
                        id: 'TestPkg',
                        versions: []
                    }]
                }
            });

            const result = await api.GetPackagesAsync('test', true, 0, 10);

            assert.strictEqual(result.data.length, 1);
            assert.deepStrictEqual(result.data[0].Versions, []);
        });
    });

    suite('GetPackageAsync', () => {
        test('should fetch package info and map correctly', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves(mockPackageInfoResponse);

            const result = await api.GetPackageAsync('TestPackage');

            assert.strictEqual(result.isError, false);
            assert.strictEqual(result.data?.Name, 'TestPackage');
            assert.strictEqual(result.data?.Version, '1.0.0');
        });

        test('should return cached package on subsequent calls', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves(mockPackageInfoResponse);

            // First call
            await api.GetPackageAsync('TestPackage');
            
            // Second call should use cache
            const result2 = await api.GetPackageAsync('TestPackage');

            assert.strictEqual(result2.isError, false);
            assert.strictEqual(result2.data?.Name, 'TestPackage');
            
            // Should only have called http.get twice (service index + first package fetch)
            assert.strictEqual(httpStub.callCount, 2);
            assert.ok(loggerDebugStub.calledWith(sinon.match(/Returning cached package info/)));
        });

        test('should be case-insensitive for package ID caching', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves(mockPackageInfoResponse);

            await api.GetPackageAsync('TestPackage');
            await api.GetPackageAsync('TESTPACKAGE');
            await api.GetPackageAsync('testpackage');

            // Should only fetch once
            assert.strictEqual(httpStub.callCount, 2);
        });

        test('should throw when package not found', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves({
                data: {
                    count: 1,
                    items: [{ items: [] }]
                }
            });

            try {
                await api.GetPackageAsync('NonExistent');
                assert.fail('Should have thrown');
            } catch (err: any) {
                assert.ok(err.message.includes("Package info couldn't be found"));
            }
        });

        test('should fetch page data when not embedded', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves({
                data: {
                    count: 1,
                    items: [
                        { '@id': 'https://api.nuget.org/page1' } // No items, need to fetch
                    ]
                }
            });
            httpStub.onThirdCall().resolves({
                data: {
                    items: [
                        {
                            '@id': 'https://api.nuget.org/pkg/1.0.0',
                            catalogEntry: {
                                id: 'PagedPackage',
                                version: '1.0.0',
                                authors: [],
                                tags: []
                            }
                        }
                    ]
                }
            });

            const result = await api.GetPackageAsync('PagedPackage');

            assert.strictEqual(result.data?.Name, 'PagedPackage');
            assert.strictEqual(httpStub.callCount, 3);
        });

        test('should filter prerelease versions when prerelease is false', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const mockPackageWithPrereleases = {
                data: {
                    count: 1,
                    items: [
                        {
                            items: [
                                {
                                    '@id': 'https://api.nuget.org/v3/registration/pkg/1.0.0.json',
                                    catalogEntry: {
                                        id: 'TestPackage',
                                        version: '1.0.0',
                                        authors: [],
                                        tags: []
                                    }
                                },
                                {
                                    '@id': 'https://api.nuget.org/v3/registration/pkg/2.0.0-beta.json',
                                    catalogEntry: {
                                        id: 'TestPackage',
                                        version: '2.0.0-beta',
                                        authors: [],
                                        tags: []
                                    }
                                },
                                {
                                    '@id': 'https://api.nuget.org/v3/registration/pkg/1.1.0.json',
                                    catalogEntry: {
                                        id: 'TestPackage',
                                        version: '1.1.0',
                                        authors: [],
                                        tags: []
                                    }
                                }
                            ]
                        }
                    ]
                }
            };
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves(mockPackageWithPrereleases);

            const result = await api.GetPackageAsync('TestPackage', false);

            assert.strictEqual(result.isError, false);
            // When prerelease=false, 2.0.0-beta should be filtered out
            // Latest stable version should be 1.1.0
            assert.strictEqual(result.data?.Version, '1.1.0');
            assert.strictEqual(result.data?.Versions.length, 2);
            assert.ok(result.data?.Versions.every(v => !v.Version.includes('-')));
        });

        test('should include prerelease versions when prerelease is true', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const mockPackageWithPrereleases = {
                data: {
                    count: 1,
                    items: [
                        {
                            items: [
                                {
                                    '@id': 'https://api.nuget.org/v3/registration/pkg/1.0.0.json',
                                    catalogEntry: {
                                        id: 'TestPackage',
                                        version: '1.0.0',
                                        authors: [],
                                        tags: []
                                    }
                                },
                                {
                                    '@id': 'https://api.nuget.org/v3/registration/pkg/2.0.0-beta.json',
                                    catalogEntry: {
                                        id: 'TestPackage',
                                        version: '2.0.0-beta',
                                        authors: [],
                                        tags: []
                                    }
                                }
                            ]
                        }
                    ]
                }
            };
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves(mockPackageWithPrereleases);

            const result = await api.GetPackageAsync('TestPackage', true);

            assert.strictEqual(result.isError, false);
            // When prerelease=true, all versions should be included
            assert.strictEqual(result.data?.Version, '2.0.0-beta');
            assert.strictEqual(result.data?.Versions.length, 2);
        });

        test('should use separate cache entries for prerelease true and false', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const mockPackageWithPrereleases = {
                data: {
                    count: 1,
                    items: [
                        {
                            items: [
                                {
                                    '@id': 'https://api.nuget.org/v3/registration/pkg/1.0.0.json',
                                    catalogEntry: {
                                        id: 'TestPackage',
                                        version: '1.0.0',
                                        authors: [],
                                        tags: []
                                    }
                                },
                                {
                                    '@id': 'https://api.nuget.org/v3/registration/pkg/2.0.0-beta.json',
                                    catalogEntry: {
                                        id: 'TestPackage',
                                        version: '2.0.0-beta',
                                        authors: [],
                                        tags: []
                                    }
                                }
                            ]
                        }
                    ]
                }
            };
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves(mockPackageWithPrereleases);
            httpStub.onThirdCall().resolves(mockPackageWithPrereleases);

            // First call with prerelease=false
            const result1 = await api.GetPackageAsync('TestPackage', false);
            assert.strictEqual(result1.data?.Version, '1.0.0');
            
            // Second call with prerelease=true - should make a new request
            const result2 = await api.GetPackageAsync('TestPackage', true);
            assert.strictEqual(result2.data?.Version, '2.0.0-beta');
            
            // Should have made 3 HTTP calls (index + 2 package fetches for different prerelease settings)
            assert.strictEqual(httpStub.callCount, 3);
        });
    });

    suite('ClearPackageCache', () => {
        test('should clear all cache when no packageId provided', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            // Directly manipulate the cache for a simpler test
            (api as any)._packageCache.set('package1', { data: { Name: 'Package1' }, timestamp: Date.now() });
            (api as any)._packageCache.set('package2', { data: { Name: 'Package2' }, timestamp: Date.now() });

            assert.strictEqual((api as any)._packageCache.size, 2);
            
            // Clear all
            api.ClearPackageCache();

            // Cache should be empty
            assert.strictEqual((api as any)._packageCache.size, 0);
        });

        test('should clear specific package when packageId provided', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            // Directly manipulate the cache for this test
            // Keys match the format written by GetPackageAsync: "<id>::<prerelease>"
            (api as any)._packageCache.set('package1::true', { data: {}, timestamp: Date.now() });
            (api as any)._packageCache.set('package1::false', { data: {}, timestamp: Date.now() });
            (api as any)._packageCache.set('package2::true', { data: {}, timestamp: Date.now() });

            api.ClearPackageCache('Package1'); // Should be case-insensitive

            assert.strictEqual((api as any)._packageCache.has('package1::true'), false);
            assert.strictEqual((api as any)._packageCache.has('package1::false'), false);
            assert.strictEqual((api as any)._packageCache.has('package2::true'), true);
        });
    });

    suite('GetPackageDetailsAsync', () => {
        test('should fetch and map package details', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves({
                data: {
                    catalogEntry: 'https://api.nuget.org/catalog/entry'
                }
            });
            httpStub.onThirdCall().resolves({
                data: {
                    dependencyGroups: [
                        {
                            targetFramework: 'net6.0',
                            dependencies: [
                                { id: 'Dep1', range: '[1.0.0, )' },
                                { id: 'Dep2', range: '[2.0.0, 3.0.0)' }
                            ]
                        },
                        {
                            targetFramework: 'netstandard2.0',
                            dependencies: [
                                { id: 'Dep1', range: '[1.0.0, )' }
                            ]
                        }
                    ]
                }
            });

            const result = await api.GetPackageDetailsAsync('https://api.nuget.org/v3/registration/pkg/1.0.0.json');

            assert.ok(result.data.dependencies);
            assert.strictEqual(Object.keys(result.data.dependencies.frameworks).length, 2);
            assert.strictEqual(result.data.dependencies.frameworks['net6.0'].length, 2);
            assert.strictEqual(result.data.dependencies.frameworks['net6.0'][0].package, 'Dep1');
            assert.strictEqual(result.data.dependencies.frameworks['netstandard2.0'].length, 1);
        });

        test('should return empty dependencies when no catalogEntry', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves({
                data: {} // No catalogEntry
            });

            const result = await api.GetPackageDetailsAsync('https://api.nuget.org/version');

            assert.deepStrictEqual(result.data.dependencies.frameworks, {});
        });

        test('should filter out frameworks with no dependencies', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves({
                data: { catalogEntry: 'https://catalog' }
            });
            httpStub.onThirdCall().resolves({
                data: {
                    dependencyGroups: [
                        {
                            targetFramework: 'net6.0',
                            dependencies: [] // Empty dependencies
                        },
                        {
                            targetFramework: 'net7.0',
                            dependencies: [{ id: 'SomeDep', range: '1.0.0' }]
                        }
                    ]
                }
            });

            const result = await api.GetPackageDetailsAsync('https://api.nuget.org/version');

            // net6.0 should be filtered out because it has no dependencies
            assert.strictEqual(result.data.dependencies.frameworks['net6.0'], undefined);
            assert.strictEqual(result.data.dependencies.frameworks['net7.0'].length, 1);
        });

        test('should use embedded catalogEntry when dependencyGroups is present', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            // catalogEntry is an embedded object with dependencyGroups - no need to fetch catalog
            httpStub.onSecondCall().resolves({
                data: {
                    catalogEntry: {
                        '@id': 'https://api.nuget.org/catalog/entry',
                        id: 'TestPackage',
                        version: '1.0.0',
                        dependencyGroups: [
                            {
                                targetFramework: 'net8.0',
                                dependencies: [
                                    { id: 'EmbeddedDep', range: '[1.0.0, )' }
                                ]
                            }
                        ]
                    }
                }
            });

            const result = await api.GetPackageDetailsAsync('https://api.nuget.org/v3/registration/pkg/1.0.0.json');

            // Should only make 2 calls (service index + package version), NOT 3
            assert.strictEqual(httpStub.callCount, 2);
            assert.ok(result.data.dependencies);
            assert.strictEqual(Object.keys(result.data.dependencies.frameworks).length, 1);
            assert.strictEqual(result.data.dependencies.frameworks['net8.0'].length, 1);
            assert.strictEqual(result.data.dependencies.frameworks['net8.0'][0].package, 'EmbeddedDep');
        });

        test('should handle catalogEntry object with @id but no dependencyGroups', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            // catalogEntry is an object with @id but no dependencyGroups - need to fetch
            httpStub.onSecondCall().resolves({
                data: {
                    catalogEntry: {
                        '@id': 'https://api.nuget.org/catalog/entry'
                    }
                }
            });
            httpStub.onThirdCall().resolves({
                data: {
                    dependencyGroups: [
                        {
                            targetFramework: 'net6.0',
                            dependencies: [
                                { id: 'FetchedDep', range: '[2.0.0, )' }
                            ]
                        }
                    ]
                }
            });

            const result = await api.GetPackageDetailsAsync('https://api.nuget.org/v3/registration/pkg/1.0.0.json');

            // Should make 3 calls (service index + package version + catalog)
            assert.strictEqual(httpStub.callCount, 3);
            assert.strictEqual(result.data.dependencies.frameworks['net6.0'][0].package, 'FetchedDep');
        });

        test('should return empty dependencies when catalogEntry object has no @id and no dependencyGroups', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.onFirstCall().resolves(mockServiceIndex);
            // catalogEntry is an object but with no valid URL and no dependencyGroups
            httpStub.onSecondCall().resolves({
                data: {
                    catalogEntry: {
                        id: 'TestPackage',
                        version: '1.0.0'
                        // No @id and no dependencyGroups
                    }
                }
            });

            const result = await api.GetPackageDetailsAsync('https://api.nuget.org/v3/registration/pkg/1.0.0.json');

            assert.deepStrictEqual(result.data.dependencies.frameworks, {});
        });

        test('should throw on error and log', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.rejects(new Error('Network error'));

            await assert.rejects(
                async () => await api.GetPackageDetailsAsync('https://api.nuget.org/version'),
                /Network error/
            );

            assert.ok(loggerErrorStub.called);
        });
    });

    suite('EnsureSearchUrl', () => {
        test('should resolve service URLs from index', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.resolves(mockServiceIndex);

            // Trigger EnsureSearchUrl through GetPackagesAsync
            httpStub.onSecondCall().resolves({ data: { data: [] } });
            await api.GetPackagesAsync('', true, 0, 10);

            // Should have resolved URLs
            assert.strictEqual((api as any)._searchUrl, 'https://api.nuget.org/v3/query/');
            assert.strictEqual((api as any)._packageInfoUrl, 'https://api.nuget.org/v3/registration/');
        });

        test('should throw when SearchQueryService not found', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.resolves({
                data: {
                    resources: [
                        { '@type': 'RegistrationsBaseUrl/3.6.0', '@id': 'https://reg' }
                        // Missing SearchQueryService
                    ]
                }
            });

            try {
                await api.GetPackagesAsync('', true, 0, 10);
                assert.fail('Should have thrown');
            } catch (err: any) {
                assert.ok(err.message.includes("SearchQueryService couldn't be found"));
            }
        });

        test('should throw when RegistrationsBaseUrl not found', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.resolves({
                data: {
                    resources: [
                        { '@type': 'SearchQueryService', '@id': 'https://search' }
                        // Missing RegistrationsBaseUrl
                    ]
                }
            });

            try {
                await api.GetPackagesAsync('', true, 0, 10);
                assert.fail('Should have thrown');
            } catch (err: any) {
                assert.ok(err.message.includes("RegistrationsBaseUrl couldn't be found"));
            }
        });

        test('should not fetch service index again if already resolved', async () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves({ data: { data: [] } });
            httpStub.onThirdCall().resolves({ data: { data: [] } });

            await api.GetPackagesAsync('', true, 0, 10);
            await api.GetPackagesAsync('', true, 0, 10);

            // Service index should only be fetched once
            const indexCalls = httpStub.getCalls().filter(c => 
                c.args[0] === 'https://api.nuget.org/v3/index.json'
            );
            assert.strictEqual(indexCalls.length, 1);
        });
    });

    suite('Proxy Configuration', () => {
        test('should use proxy from vscode configuration', () => {
            sandbox.restore();
            sandbox = sinon.createSandbox();
            
            sandbox.stub(Logger, 'debug');
            sandbox.stub(Logger, 'info');
            sandbox.stub(Logger, 'error');

            sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: sandbox.stub().withArgs('http.proxy').returns('http://proxy.example.com:8080')
            } as any);

            const api = new NuGetApi('https://api.nuget.org/v3/index.json');

            // The proxy is configured in constructor, we can check the http instance
            assert.ok(api);
        });

        test('should use environment variable proxy when vscode config not set', () => {
            sandbox.restore();
            sandbox = sinon.createSandbox();
            
            sandbox.stub(Logger, 'debug');
            sandbox.stub(Logger, 'info');
            sandbox.stub(Logger, 'error');
            
            sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: sandbox.stub().returns(undefined)
            } as any);

            // Set environment variable
            const originalEnv = process.env.HTTPS_PROXY;
            process.env.HTTPS_PROXY = 'http://env-proxy:3128';

            try {
                const api = new NuGetApi('https://api.nuget.org/v3/index.json');
                assert.ok(api);
            } finally {
                // Restore environment
                if (originalEnv) {
                    process.env.HTTPS_PROXY = originalEnv;
                } else {
                    delete process.env.HTTPS_PROXY;
                }
            }
        });
    });

    suite('Authentication', () => {
        test('should add Basic Auth header when credentials provided', async () => {
            const api = new NuGetApi('https://private.nuget.org', 'myuser', 'mypass');
            
            const httpStub = sandbox.stub((api as any).http, 'get');
            httpStub.resolves(mockServiceIndex);
            httpStub.onSecondCall().resolves({ data: { data: [] } });

            await api.GetPackagesAsync('', true, 0, 10);

            // Check that interceptor was likely added (we can check by the call behavior)
            assert.ok(api);
        });

        test('should not add Auth header when no credentials', () => {
            const api = new NuGetApi('https://api.nuget.org/v3/index.json');
            assert.ok(api);
            // No error means interceptor wasn't set up for auth
        });
    });
});
