import '../web-setup';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as registrations from '@/web/registrations';
import { ok, fail } from '@/common/rpc/result';
import type { HostAPI } from '@/common/rpc/types';
import { PackagesView } from '@/web/components/packages-view';
import { PackageViewModel, ProjectViewModel } from '@/web/types';

// Helper to create mock Package data
function createMockPackage(overrides: Partial<Package> = {}): Package {
    return {
        Id: 'Test.Package',
        Name: 'Test.Package',
        Authors: ['Author1'],
        Description: 'Test Description',
        IconUrl: 'http://test.com/icon.png',
        LicenseUrl: 'http://license.com',
        ProjectUrl: 'http://project.com',
        Registration: '',
        TotalDownloads: 1000,
        Verified: true,
        InstalledVersion: '',
        Version: '1.0.0',
        Versions: [{ Id: 'url1', Version: '1.0.0' }, { Id: 'url2', Version: '0.9.0' }],
        Tags: ['tag1', 'tag2'],
        ...overrides
    };
}

// Helper to create mock Project data
function createMockProject(name: string, packages: (ProjectPackage | { Id: string, Version: string })[] = []): Project {
    return {
        Name: name,
        Path: `/path/to/${name}.csproj`,
        Packages: packages.map(p => ({ ...p, IsPinned: (p as ProjectPackage).IsPinned ?? false, VersionSource: (p as ProjectPackage).VersionSource ?? "project" as VersionSource })),
        CpmEnabled: false,
    };
}

suite('PackagesView Component', () => {
    let packagesView: PackagesView;
    let sandbox: sinon.SinonSandbox;
    let mockHostApi: Partial<HostAPI>;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Create mock hostApi
        mockHostApi = {
            getPackages: sandbox.stub().resolves(ok({ Packages: [] })),
            getProjects: sandbox.stub().resolves(ok({ Projects: [] })),
            getPackage: sandbox.stub().resolves(ok({ Package: createMockPackage(), SourceUrl: '' })),
            updateStatusBar: sandbox.stub().resolves(ok(undefined)),
        };

        // Inject mock hostApi into the registrations module
        Object.defineProperty(registrations, 'hostApi', { value: mockHostApi, writable: true, configurable: true });

        // Create mock configuration with Sources
        (registrations.configuration as any)['configuration'] = {
            Sources: [
                { Name: 'nuget.org', Url: 'https://api.nuget.org/v3/index.json' },
                { Name: 'Private', Url: 'https://private.nuget.org', PasswordScriptPath: '/script.ps1' }
            ]
        };

        packagesView = new PackagesView();

        // Initialize observable properties (don't connect to DOM to avoid Split.js issues)
        packagesView.packages = [];
        packagesView.projects = [];
        packagesView.projectsPackages = [];
        packagesView.filters = { Prerelease: true, Query: '', SourceUrl: '', Sort: 'relevance' };
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Initial State', () => {
        test('should have empty packages array initially', () => {
            assert.deepStrictEqual(packagesView.packages, []);
        });

        test('should have empty projects array initially', () => {
            assert.deepStrictEqual(packagesView.projects, []);
        });

        test('should have null selectedPackage initially', () => {
            assert.strictEqual(packagesView.selectedPackage, null);
        });

        test('should have default filter values', () => {
            assert.strictEqual(packagesView.filters.Prerelease, true);
            assert.strictEqual(packagesView.filters.Query, '');
            assert.strictEqual(packagesView.filters.SourceUrl, '');
        });

        test('should have noMorePackages as false initially', () => {
            assert.strictEqual(packagesView.noMorePackages, false);
        });

        test('should have packagesLoadingError as false initially', () => {
            assert.strictEqual(packagesView.packagesLoadingError, false);
        });
    });

    suite('LoadPackages', () => {
        test('should call mediator with correct parameters', async () => {
            (mockHostApi.getPackages as sinon.SinonStub).resolves(ok({ Packages: [] }));

            packagesView.filters = {
                Prerelease: true,
                Query: 'test-query',
                SourceUrl: 'https://api.nuget.org/v3/index.json',
                Sort: 'relevance',
            };

            await packagesView.LoadPackages();

            assert.ok((mockHostApi.getPackages as sinon.SinonStub).calledOnce);
            const callArgs = (mockHostApi.getPackages as sinon.SinonStub).firstCall.args[0];
            assert.strictEqual(callArgs.Filter, 'test-query');
            assert.strictEqual(callArgs.Prerelease, true);
            assert.strictEqual(callArgs.Url, 'https://api.nuget.org/v3/index.json');
            assert.strictEqual(callArgs.Skip, 0);
            assert.strictEqual(callArgs.Take, 50);
        });

        test('should populate packages on successful response', async () => {
            const mockPackages = [
                createMockPackage({ Id: 'Package1', Name: 'Package1' }),
                createMockPackage({ Id: 'Package2', Name: 'Package2' })
            ];

            (mockHostApi.getPackages as sinon.SinonStub).resolves(ok({ Packages: mockPackages }));

            await packagesView.LoadPackages();

            assert.strictEqual(packagesView.packages.length, 2);
            assert.strictEqual(packagesView.packages[0].Id, 'Package1');
            assert.strictEqual(packagesView.packages[1].Id, 'Package2');
        });

        test('should set noMorePackages when fewer packages returned than requested', async () => {
            const mockPackages = [createMockPackage()]; // Only 1 package, less than 50

            (mockHostApi.getPackages as sinon.SinonStub).resolves(ok({ Packages: mockPackages }));

            await packagesView.LoadPackages();

            assert.strictEqual(packagesView.noMorePackages, true);
        });

        test('should set packagesLoadingError on failure', async () => {
            (mockHostApi.getPackages as sinon.SinonStub).resolves(fail('Network error'));

            await packagesView.LoadPackages();

            assert.strictEqual(packagesView.packagesLoadingError, true);
        });

        test('should append packages when append is true', async () => {
            // First load
            packagesView.packages = [
                new PackageViewModel(createMockPackage({ Id: 'Existing' }))
            ];
            packagesView.packagesPage = 1;

            (mockHostApi.getPackages as sinon.SinonStub).resolves(
                ok({ Packages: [createMockPackage({ Id: 'NewPackage' })] })
            );

            await packagesView.LoadPackages(true);

            assert.strictEqual(packagesView.packages.length, 2);
            assert.strictEqual(packagesView.packages[0].Id, 'Existing');
            assert.strictEqual(packagesView.packages[1].Id, 'NewPackage');
        });

        test('should reset packages when append is false', async () => {
            packagesView.packages = [
                new PackageViewModel(createMockPackage({ Id: 'OldPackage' }))
            ];

            (mockHostApi.getPackages as sinon.SinonStub).resolves(
                ok({ Packages: [createMockPackage({ Id: 'NewPackage' })] })
            );

            await packagesView.LoadPackages(false);

            assert.strictEqual(packagesView.packages.length, 1);
            assert.strictEqual(packagesView.packages[0].Id, 'NewPackage');
        });

        test('should pass ForceReload flag to mediator', async () => {
            (mockHostApi.getPackages as sinon.SinonStub).resolves(ok({ Packages: [] }));

            await packagesView.LoadPackages(false, true);

            const callArgs = (mockHostApi.getPackages as sinon.SinonStub).firstCall.args[0];
            assert.strictEqual(callArgs.ForceReload, true);
        });
    });

    suite('LoadProjects', () => {
        test('should call mediator with correct parameters', async () => {
            (mockHostApi.getProjects as sinon.SinonStub).resolves(ok({ Projects: [] }));

            await packagesView.LoadProjects();

            assert.ok((mockHostApi.getProjects as sinon.SinonStub).called);
            const callArgs = (mockHostApi.getProjects as sinon.SinonStub).firstCall.args[0];
            assert.strictEqual(callArgs.ForceReload, false);
        });

        test('should populate projects from response', async () => {
            const mockProjects = [
                createMockProject('Project1', [{ Id: 'Pkg1', Version: '1.0.0' }]),
                createMockProject('Project2', [{ Id: 'Pkg2', Version: '2.0.0' }])
            ];

            (mockHostApi.getProjects as sinon.SinonStub).resolves(ok({ Projects: mockProjects }));

            await packagesView.LoadProjects();

            assert.strictEqual(packagesView.projects.length, 2);
            assert.strictEqual(packagesView.projects[0].Name, 'Project1');
            assert.strictEqual(packagesView.projects[1].Name, 'Project2');
        });

        test('should pass ForceReload flag', async () => {
            (mockHostApi.getProjects as sinon.SinonStub).resolves(ok({ Projects: [] }));

            await packagesView.LoadProjects(true);

            const callArgs = (mockHostApi.getProjects as sinon.SinonStub).firstCall.args[0];
            assert.strictEqual(callArgs.ForceReload, true);
        });
    });

    suite('SelectPackage', () => {
        test('should set selectedPackage', async () => {
            const pkg = new PackageViewModel(createMockPackage({ Id: 'Selected' }));
            packagesView.packages = [pkg];

            await packagesView.SelectPackage(pkg);

            assert.strictEqual(packagesView.selectedPackage, pkg);
        });

        test('should set package as selected', async () => {
            const pkg = new PackageViewModel(createMockPackage());

            await packagesView.SelectPackage(pkg);

            assert.strictEqual(pkg.Selected, true);
        });

        test('should deselect previously selected packages', async () => {
            const pkg1 = new PackageViewModel(createMockPackage({ Id: 'Pkg1' }));
            const pkg2 = new PackageViewModel(createMockPackage({ Id: 'Pkg2' }));
            pkg1.Selected = true;
            packagesView.packages = [pkg1, pkg2];

            await packagesView.SelectPackage(pkg2);

            assert.strictEqual(pkg1.Selected, false);
            assert.strictEqual(pkg2.Selected, true);
        });

        test('should set selectedVersion from package Version', async () => {
            const pkg = new PackageViewModel(createMockPackage({ Version: '2.0.0' }));

            await packagesView.SelectPackage(pkg);

            assert.strictEqual(packagesView.selectedVersion, '2.0.0');
        });

        test('should fetch package details if status is MissingDetails', async () => {
            const pkg = new PackageViewModel(createMockPackage(), 'MissingDetails');

            (mockHostApi.getPackage as sinon.SinonStub).resolves(
                ok({
                    Package: createMockPackage({ Version: '1.5.0' }),
                    SourceUrl: 'https://api.nuget.org'
                })
            );

            await packagesView.SelectPackage(pkg);

            assert.ok((mockHostApi.getPackage as sinon.SinonStub).calledOnce);
            assert.strictEqual(pkg.Status, 'Detailed');
        });

        test('should set status to Error if package fetch fails', async () => {
            const pkg = new PackageViewModel(createMockPackage(), 'MissingDetails');

            (mockHostApi.getPackage as sinon.SinonStub).resolves(fail('Not found'));

            await packagesView.SelectPackage(pkg);

            assert.strictEqual(pkg.Status, 'Error');
        });
    });

    suite('UpdatePackagesFilters', () => {
        test('should update filters', async () => {
            (mockHostApi.getPackages as sinon.SinonStub).resolves(ok({ Packages: [] }));

            const newFilters = {
                Prerelease: false,
                Query: 'newtonsoft',
                SourceUrl: 'https://private.nuget.org',
                Sort: 'relevance' as const,
            };

            await packagesView.UpdatePackagesFilters(newFilters);

            assert.strictEqual(packagesView.filters.Prerelease, false);
            assert.strictEqual(packagesView.filters.Query, 'newtonsoft');
            assert.strictEqual(packagesView.filters.SourceUrl, 'https://private.nuget.org');
        });

        test('should reload packages with new filters', async () => {
            (mockHostApi.getPackages as sinon.SinonStub).resolves(ok({ Packages: [] }));

            await packagesView.UpdatePackagesFilters({
                Prerelease: false,
                Query: 'test',
                SourceUrl: '',
                Sort: 'relevance',
            });

            assert.ok((mockHostApi.getPackages as sinon.SinonStub).called);
        });

        test('should force reload when Prerelease changes', async () => {
            packagesView.filters.Prerelease = true;

            (mockHostApi.getPackages as sinon.SinonStub).resolves(ok({ Packages: [] }));

            await packagesView.UpdatePackagesFilters({
                Prerelease: false, // Changed from true
                Query: '',
                SourceUrl: '',
                Sort: 'relevance',
            });

            const callArgs = (mockHostApi.getPackages as sinon.SinonStub).firstCall.args[0];
            assert.strictEqual(callArgs.ForceReload, true);
        });
    });

    suite('ReloadInvoked', () => {
        test('should reload packages and projects', async () => {
            (mockHostApi.getPackages as sinon.SinonStub).resolves(ok({ Packages: [] }));
            (mockHostApi.getProjects as sinon.SinonStub).resolves(ok({ Projects: [] }));

            await packagesView.ReloadInvoked();

            assert.ok((mockHostApi.getPackages as sinon.SinonStub).called);
            assert.ok((mockHostApi.getProjects as sinon.SinonStub).called);
        });

        test('should pass forceReload flag', async () => {
            (mockHostApi.getPackages as sinon.SinonStub).resolves(ok({ Packages: [] }));
            (mockHostApi.getProjects as sinon.SinonStub).resolves(ok({ Projects: [] }));

            await packagesView.ReloadInvoked(true);

            const getPackagesArgs = (mockHostApi.getPackages as sinon.SinonStub).firstCall.args[0];
            assert.strictEqual(getPackagesArgs.ForceReload, true);

            const getProjectsArgs = (mockHostApi.getProjects as sinon.SinonStub).firstCall.args[0];
            assert.strictEqual(getProjectsArgs.ForceReload, true);
        });
    });

    suite('PackagesScrollEvent', () => {
        test('should not load more if already loading', async () => {
            packagesView.packagesLoadingInProgress = true;

            const mockTarget = {
                scrollTop: 1000,
                getBoundingClientRect: () => ({ height: 500 }),
                scrollHeight: 1200
            } as HTMLElement;

            await packagesView.PackagesScrollEvent(mockTarget);

            assert.ok((mockHostApi.getPackages as sinon.SinonStub).notCalled);
        });

        test('should not load more if noMorePackages is true', async () => {
            packagesView.noMorePackages = true;

            const mockTarget = {
                scrollTop: 1000,
                getBoundingClientRect: () => ({ height: 500 }),
                scrollHeight: 1200
            } as HTMLElement;

            await packagesView.PackagesScrollEvent(mockTarget);

            assert.ok((mockHostApi.getPackages as sinon.SinonStub).notCalled);
        });

        test('should load more when scrolled near bottom', async () => {
            packagesView.packagesLoadingInProgress = false;
            packagesView.noMorePackages = false;

            (mockHostApi.getPackages as sinon.SinonStub).resolves(ok({ Packages: [] }));

            // Simulate scrolled near bottom
            const mockTarget = {
                scrollTop: 900,
                getBoundingClientRect: () => ({ height: 500 }),
                scrollHeight: 1200 // 900 + 500 = 1400 > 1200 - 196 = 1004
            } as HTMLElement;

            await packagesView.PackagesScrollEvent(mockTarget);

            assert.ok((mockHostApi.getPackages as sinon.SinonStub).called);
        });
    });

    suite('OnProjectUpdated', () => {
        test('should reload all projects when CPM is enabled', async () => {
            (mockHostApi.getProjects as sinon.SinonStub).resolves(ok({ Projects: [] }));

            const event = new CustomEvent('project-updated', {
                detail: { isCpmEnabled: true }
            });

            await packagesView.OnProjectUpdated(event);

            assert.ok((mockHostApi.getProjects as sinon.SinonStub).called);
        });

        test('should only refresh packages when CPM is not enabled', async () => {
            // Set up projects with packages
            packagesView.projects = [
                new ProjectViewModel(createMockProject('Project1', [
                    { Id: 'Pkg1', Version: '1.0.0' }
                ]))
            ];

            (mockHostApi.getPackage as sinon.SinonStub).resolves(
                ok({ Package: createMockPackage(), SourceUrl: '' })
            );

            const event = new CustomEvent('project-updated', {
                detail: { isCpmEnabled: false }
            });

            await packagesView.OnProjectUpdated(event);

            // Should call getPackage for installed packages, not getProjects
            assert.ok((mockHostApi.getProjects as sinon.SinonStub).notCalled);
        });
    });

    suite('Computed Properties', () => {
        test('CurrentSource should return matching source from configuration', () => {
            packagesView.filters.SourceUrl = 'https://private.nuget.org';

            const source = packagesView.CurrentSource;

            assert.strictEqual(source?.Name, 'Private');
            assert.strictEqual(source?.PasswordScriptPath, '/script.ps1');
        });

        test('CurrentSource should return undefined for non-matching URL', () => {
            packagesView.filters.SourceUrl = 'https://unknown.nuget.org';

            const source = packagesView.CurrentSource;

            assert.strictEqual(source, undefined);
        });

        test('NugetOrgPackageUrl should return URL for nuget.org source', () => {
            packagesView.filters.SourceUrl = 'https://api.nuget.org/v3/index.json';
            packagesView.selectedPackage = new PackageViewModel(
                createMockPackage({ Name: 'Newtonsoft.Json' })
            );
            packagesView.selectedVersion = '13.0.1';

            const url = packagesView.NugetOrgPackageUrl;

            assert.strictEqual(url, 'https://www.nuget.org/packages/Newtonsoft.Json/13.0.1');
        });

        test('NugetOrgPackageUrl should return null for non-nuget.org source', () => {
            packagesView.filters.SourceUrl = 'https://private.nuget.org';
            packagesView.selectedPackage = new PackageViewModel(createMockPackage());
            packagesView.selectedVersion = '1.0.0';

            const url = packagesView.NugetOrgPackageUrl;

            assert.strictEqual(url, null);
        });

        test('NugetOrgPackageUrl should use selectedPackage.SourceUrl when filters.SourceUrl is empty', () => {
            packagesView.filters.SourceUrl = ''; // "All" sources selected
            packagesView.selectedPackage = new PackageViewModel(
                createMockPackage({ Name: 'Newtonsoft.Json' })
            );
            packagesView.selectedPackage.SourceUrl = 'https://api.nuget.org/v3/index.json';
            packagesView.selectedVersion = '13.0.1';

            const url = packagesView.NugetOrgPackageUrl;

            assert.strictEqual(url, 'https://www.nuget.org/packages/Newtonsoft.Json/13.0.1');
        });

        test('NugetOrgPackageUrl should return null when package is from non-nuget.org source with empty filter', () => {
            packagesView.filters.SourceUrl = ''; // "All" sources selected
            packagesView.selectedPackage = new PackageViewModel(createMockPackage());
            packagesView.selectedPackage.SourceUrl = 'https://private.nuget.org/v3/index.json';
            packagesView.selectedVersion = '1.0.0';

            const url = packagesView.NugetOrgPackageUrl;

            assert.strictEqual(url, null);
        });

        test('PackageVersionUrl should return version URL', () => {
            const pkg = new PackageViewModel(createMockPackage({
                Version: '1.0.0',
                Versions: [
                    { Id: 'https://nuget.org/v1', Version: '1.0.0' },
                    { Id: 'https://nuget.org/v2', Version: '0.9.0' }
                ]
            }));
            packagesView.selectedPackage = pkg;
            packagesView.selectedVersion = '1.0.0';

            const url = packagesView.PackageVersionUrl;

            assert.strictEqual(url, 'https://nuget.org/v1');
        });

        test('PackageVersionUrl should return empty for MissingDetails status', () => {
            const pkg = new PackageViewModel(createMockPackage(), 'MissingDetails');
            packagesView.selectedPackage = pkg;

            const url = packagesView.PackageVersionUrl;

            assert.strictEqual(url, '');
        });
    });

    suite('LoadProjectsPackages', () => {
        test('should aggregate packages from all projects', async () => {
            packagesView.projects = [
                new ProjectViewModel(createMockProject('Project1', [
                    { Id: 'Pkg1', Version: '1.0.0' },
                    { Id: 'Pkg2', Version: '2.0.0' }
                ])),
                new ProjectViewModel(createMockProject('Project2', [
                    { Id: 'Pkg1', Version: '1.0.0' }, // Duplicate
                    { Id: 'Pkg3', Version: '3.0.0' }
                ]))
            ];

            (mockHostApi.getPackage as sinon.SinonStub).resolves(
                ok({ Package: createMockPackage(), SourceUrl: 'https://api.nuget.org' })
            );

            await packagesView.LoadProjectsPackages();

            // Should have 3 unique packages: Pkg1, Pkg2, Pkg3
            assert.strictEqual(packagesView.projectsPackages.length, 3);
        });

        test('should filter packages by query', async () => {
            packagesView.projects = [
                new ProjectViewModel(createMockProject('Project1', [
                    { Id: 'Newtonsoft.Json', Version: '1.0.0' },
                    { Id: 'Serilog', Version: '2.0.0' }
                ]))
            ];
            packagesView.filters.Query = 'newtonsoft';

            // Mock returns matching package
            (mockHostApi.getPackage as sinon.SinonStub).resolves(
                ok({
                    Package: createMockPackage({ Id: 'Newtonsoft.Json', Name: 'Newtonsoft.Json' }),
                    SourceUrl: ''
                })
            );

            await packagesView.LoadProjectsPackages();

            // Should only have 1 package matching the query filter
            assert.strictEqual(packagesView.projectsPackages.length, 1);
            assert.strictEqual(packagesView.projectsPackages[0].Id, 'Newtonsoft.Json');
        });

        test('should show "Multiple" for packages with different versions', async () => {
            packagesView.projects = [
                new ProjectViewModel(createMockProject('Project1', [
                    { Id: 'Pkg1', Version: '1.0.0' }
                ])),
                new ProjectViewModel(createMockProject('Project2', [
                    { Id: 'Pkg1', Version: '2.0.0' } // Different version
                ]))
            ];

            // Mock returns matching package ID so the find() works
            (mockHostApi.getPackage as sinon.SinonStub).resolves(
                ok({
                    Package: createMockPackage({ Id: 'Pkg1', Name: 'Pkg1' }),
                    SourceUrl: ''
                })
            );

            await packagesView.LoadProjectsPackages();

            const pkg1 = packagesView.projectsPackages.find(p => p.Id === 'Pkg1');
            assert.ok(pkg1, 'Package Pkg1 should exist');
            assert.strictEqual(pkg1?.InstalledVersion, 'Multiple');
        });

        test('should update status bar during loading', async () => {
            packagesView.projects = [
                new ProjectViewModel(createMockProject('Project1', [
                    { Id: 'Pkg1', Version: '1.0.0' }
                ]))
            ];

            (mockHostApi.getPackage as sinon.SinonStub).resolves(
                ok({ Package: createMockPackage(), SourceUrl: '' })
            );

            await packagesView.LoadProjectsPackages();

            const statusBarStub = mockHostApi.updateStatusBar as sinon.SinonStub;
            const statusBarCalls = statusBarStub.getCalls();

            // Should have calls for: start (0%), progress, and hide (null)
            assert.ok(statusBarCalls.length >= 2);

            // Last call should hide the status bar
            const lastCall = statusBarCalls[statusBarCalls.length - 1];
            assert.strictEqual(lastCall.args[0].Percentage, null);
        });
    });
});
