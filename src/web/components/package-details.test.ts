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
        packageDetails.activeTab = 'description';
        await packageDetails.updateComplete;

        const shadowRoot = packageDetails.shadowRoot;
        assert.ok(shadowRoot, "Shadow root should exist");

        // New tabbed layout: check description tab content
        const descriptionText = shadowRoot.querySelector('.description-text');
        assert.ok(descriptionText, "Description text should exist");
        assert.strictEqual(descriptionText.textContent?.trim(), 'Test Description');

        // Check meta grid
        const metaLabels = shadowRoot.querySelectorAll('.package-meta .label');
        assert.ok(metaLabels.length > 0, "Meta labels should exist");

        const getValueByLabel = (label: string) => {
            const labels = Array.from(metaLabels);
            const labelEl = labels.find(l => l.textContent?.trim() === label);
            return labelEl?.nextElementSibling?.textContent?.trim();
        };

        assert.strictEqual(getValueByLabel('Authors'), 'Test Author');

        // Check tags
        const tags = shadowRoot.querySelectorAll('.tag');
        assert.strictEqual(tags.length, 2);
        assert.strictEqual(tags[0].textContent?.trim(), 'tag1');
        assert.strictEqual(tags[1].textContent?.trim(), 'tag2');
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

        // Set source and version URL to trigger reloadDependencies,
        // then mock the API to return our test data
        getPackageDetailsStub = () => Promise.resolve(ok({
            Package: mockPackageDetails as unknown as PackageDetails
        }));

        packageDetails.source = 'https://source.url';
        packageDetails.packageVersionUrl = 'https://package.url';

        // Wait for async reloadDependencies to complete
        await new Promise(resolve => setTimeout(resolve, 50));
        await packageDetails.updateComplete;

        // Verify the data was loaded
        assert.ok(packageDetails.packageDetails, "packageDetails should be set");
        assert.strictEqual(packageDetails.packageDetailsLoading, false);

        // Now switch to dependencies tab and check rendered output
        packageDetails.activeTab = 'dependencies';
        await packageDetails.updateComplete;

        const shadowRoot = packageDetails.shadowRoot;
        assert.ok(shadowRoot);

        const depContainer = shadowRoot.querySelector('.dependencies');
        assert.ok(depContainer, "Dependencies container should exist");

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
        packageDetails.activeTab = 'dependencies';

        await packageDetails.updateComplete;

        const shadowRoot = packageDetails.shadowRoot;
        const noDeps = shadowRoot?.querySelector('.no-dependencies');
        assert.ok(noDeps, "No dependencies message should be visible");
        assert.ok(noDeps.textContent?.includes('No dependencies'));
    });
});
