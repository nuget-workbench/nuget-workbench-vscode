import '../web-setup';
import * as assert from 'assert';
import * as registrations from '@/web/registrations';
import { PackageDetailsComponent } from '@/web/components/package-details';
import { PackageViewModel } from '@/web/types';
import { ok } from '@/common/rpc/result';
import type { GetPackageDetailsRequest, GetPackageDetailsResponse, HostAPI } from '@/common/rpc/types';
import type { Result } from '@/common/rpc/result';

suite('PackageDetails Component', () => {
    let packageDetails: PackageDetailsComponent;
    let getPackageDetailsStub: (req: GetPackageDetailsRequest) => Promise<Result<GetPackageDetailsResponse>>;
    let originalHostApi: HostAPI;

    setup(() => {
        // Save original hostApi for teardown
        originalHostApi = registrations.hostApi;

        // Default stub returns null package
        getPackageDetailsStub = () => Promise.resolve(ok({ Package: null as unknown as PackageDetails }));

        // Mock hostApi at module level
        const mockHostApi = {
            getPackageDetails: (req: GetPackageDetailsRequest) => getPackageDetailsStub(req)
        } as unknown as HostAPI;

        Object.defineProperty(registrations, 'hostApi', {
            value: mockHostApi,
            writable: true,
            configurable: true
        });

        // Create instance
        packageDetails = new PackageDetailsComponent();
        document.body.appendChild(packageDetails);
    });

    teardown(() => {
        document.body.removeChild(packageDetails);

        // Restore original hostApi
        Object.defineProperty(registrations, 'hostApi', {
            value: originalHostApi,
            writable: true,
            configurable: true
        });
    });

    test('should render package info correctly', async () => {
        const pkg: Package = {
            Id: 'Test.Package',
            Name: 'Test.Package',
            Version: '1.0.0',
            Description: 'Test Description',
            Authors: ['Test Author'],
            LicenseUrl: 'https://license.url',
            ProjectUrl: 'https://project.url',
            Tags: ['tag1', 'tag2'],
            IconUrl: '',
            Registration: '',
            Versions: [],
            TotalDownloads: 0,
            Verified: false,
            InstalledVersion: ''
        };

        const viewModel = new PackageViewModel(pkg);

        packageDetails.package = viewModel;
        await packageDetails.updateComplete;

        const shadowRoot = packageDetails.shadowRoot;
        assert.ok(shadowRoot, "Shadow root should exist");

        const infoContainer = shadowRoot.querySelector('expandable-container[title="Info"]');
        assert.ok(infoContainer, "Info container should exist");

        const detailsDiv = infoContainer.querySelector('.package-details');
        assert.ok(detailsDiv, "Details div should exist");

        // Helper to get text content by title
        const getTextByTitle = (title: string) => {
            const titles = Array.from(detailsDiv.querySelectorAll('.title'));
            const titleEl = titles.find(t => t.textContent?.trim() === title);
            if (!titleEl) return null;
            return titleEl.nextElementSibling?.textContent?.trim();
        };

        // Helper to get link by title
        const getLinkByTitle = (title: string) => {
            const titles = Array.from(detailsDiv.querySelectorAll('.title'));
            const titleEl = titles.find(t => t.textContent?.trim() === title);
            if (!titleEl) return null;
            return titleEl.nextElementSibling as HTMLElement;
        };

        assert.strictEqual(getTextByTitle('Author(s):'), 'Test Author');
        assert.strictEqual(getTextByTitle('Tags:'), 'tag1, tag2');

        const licenseLink = getLinkByTitle('License:');
        assert.strictEqual(licenseLink?.getAttribute('href'), 'https://license.url');

        const projectLink = getLinkByTitle('Project Url:');
        assert.strictEqual(projectLink?.getAttribute('href'), 'https://project.url');
    });

    test('should trigger reloadDependencies when source changes', async () => {
        let called = false;
        getPackageDetailsStub = () => {
            called = true;
            return Promise.resolve(ok({ Package: null as unknown as PackageDetails }));
        };

        packageDetails.packageVersionUrl = 'https://package.url';
        packageDetails.source = 'https://source.url';

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.ok(called, "reloadDependencies should be called");
    });

    test('should trigger reloadDependencies when packageVersionUrl changes', async () => {
        let called = false;
        getPackageDetailsStub = () => {
            called = true;
            return Promise.resolve(ok({ Package: null as unknown as PackageDetails }));
        };

        packageDetails.source = 'https://source.url';
        packageDetails.packageVersionUrl = 'https://package.url';

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.ok(called, "reloadDependencies should be called");
    });

    test('should fetch package details with correct parameters', async () => {
        let capturedRequest: GetPackageDetailsRequest | undefined;
        getPackageDetailsStub = (req: GetPackageDetailsRequest) => {
            capturedRequest = req;
            return Promise.resolve(ok({ Package: null as unknown as PackageDetails }));
        };

        const source = 'https://source.url';
        const versionUrl = 'https://package.url/v1';
        const passwordScript = 'script.sh';

        packageDetails.passwordScriptPath = passwordScript;
        packageDetails.source = source;
        packageDetails.packageVersionUrl = versionUrl;

        await new Promise(resolve => setTimeout(resolve, 0));

        assert.deepStrictEqual(capturedRequest, {
            PackageVersionUrl: versionUrl,
            Url: source,
            PasswordScriptPath: passwordScript
        });
    });

    test('should update packageDetails and loading state', async () => {
        const mockPackageDetails = {
            dependencies: {
                frameworks: {
                    'net6.0': [
                        { package: 'Dep1', versionRange: '1.0.0' }
                    ]
                }
            }
        };

        let resolvePromise: (value: Result<GetPackageDetailsResponse>) => void;
        const promise = new Promise<Result<GetPackageDetailsResponse>>(resolve => { resolvePromise = resolve; });

        getPackageDetailsStub = () => promise;

        packageDetails.source = 'src';
        packageDetails.packageVersionUrl = 'url';

        // Wait for Lit update cycle so updated() triggers reloadDependencies()
        await packageDetails.updateComplete;

        // Check loading state (set synchronously in reloadDependencies before first await)
        assert.strictEqual(packageDetails.packageDetailsLoading, true);

        // Resolve
        resolvePromise!(ok({ Package: mockPackageDetails as unknown as PackageDetails }));

        // Wait for async update
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(packageDetails.packageDetailsLoading, false);
        assert.deepStrictEqual(packageDetails.packageDetails, mockPackageDetails);
    });

    test('should handle race condition (ignore outdated result)', async () => {
        let resolveFirst: (value: Result<GetPackageDetailsResponse>) => void;
        const firstPromise = new Promise<Result<GetPackageDetailsResponse>>(resolve => { resolveFirst = resolve; });

        let resolveSecond: (value: Result<GetPackageDetailsResponse>) => void;
        const secondPromise = new Promise<Result<GetPackageDetailsResponse>>(resolve => { resolveSecond = resolve; });

        let callCount = 0;
        getPackageDetailsStub = () => {
            callCount++;
            if (callCount === 1) return firstPromise;
            return secondPromise;
        };

        packageDetails.source = 'src';

        // First change — trigger separate Lit update cycle
        packageDetails.packageVersionUrl = 'url1';
        await packageDetails.updateComplete;

        // Second change — triggers a new reloadDependencies call
        packageDetails.packageVersionUrl = 'url2';
        await packageDetails.updateComplete;

        assert.strictEqual(callCount, 2, 'Should have made two API calls');

        // Resolve first request (which corresponds to url1)
        resolveFirst!(ok({ Package: { id: 'old' } as unknown as PackageDetails }));
        await new Promise(resolve => setTimeout(resolve, 0));

        // Should not be updated yet because url1 != url2 (current)
        assert.strictEqual(packageDetails.packageDetails, undefined);

        // Resolve second request
        resolveSecond!(ok({ Package: { id: 'new' } as unknown as PackageDetails }));
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.deepStrictEqual(packageDetails.packageDetails, { id: 'new' });
    });

    test('should render dependencies correctly', async () => {
        const mockPackageDetails = {
            dependencies: {
                frameworks: {
                    'net6.0': [
                        { package: 'Dep1', versionRange: '1.0.0' },
                        { package: 'Dep2', versionRange: '2.0.0' }
                    ],
                    'net472': []
                }
            }
        };

        packageDetails.packageDetails = mockPackageDetails as unknown as PackageDetails;
        packageDetails.packageDetailsLoading = false;

        await packageDetails.updateComplete;

        const shadowRoot = packageDetails.shadowRoot;
        const depContainer = shadowRoot?.querySelector('expandable-container[title="Dependencies"]');
        assert.ok(depContainer);

        // Use direct child selector to count frameworks
        const frameworkLists = depContainer.querySelectorAll('.dependencies > ul > li');
        assert.strictEqual(frameworkLists.length, 2);

        // Check content
        const content = depContainer.textContent;
        assert.ok(content?.includes('net6.0'));
        assert.ok(content?.includes('Dep1 1.0.0'));
        assert.ok(content?.includes('Dep2 2.0.0'));
        assert.ok(content?.includes('net472'));
    });

    test('should render no dependencies message', async () => {
        const mockPackageDetails = {
            dependencies: {
                frameworks: {}
            }
        };

        packageDetails.packageDetails = mockPackageDetails as unknown as PackageDetails;
        packageDetails.packageDetailsLoading = false;

        await packageDetails.updateComplete;

        const shadowRoot = packageDetails.shadowRoot;
        const noDeps = shadowRoot?.querySelector('.no-dependencies');
        assert.ok(noDeps, "No dependencies message should be visible");
        assert.ok(noDeps.textContent?.includes('No dependencies'));
    });
});
