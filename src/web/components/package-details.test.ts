import '../web-setup';
import * as assert from 'assert';
import { PackageDetailsComponent } from '@/web/components/package-details';
import { PackageViewModel } from '@/web/types';
import { DOM } from '@microsoft/fast-element';
import { GET_PACKAGE_DETAILS } from '@/common/messaging/core/commands';

suite('PackageDetails Component', () => {
    let packageDetails: PackageDetailsComponent;
    let mockMediator: any;
    let publishAsyncStub: any;

    setup(() => {
        // Mock IMediator
        publishAsyncStub = (command: string, request: any) => Promise.resolve({ Package: null });
        mockMediator = {
            PublishAsync: (command: string, request: any) => publishAsyncStub(command, request)
        };

        // Create instance
        packageDetails = new PackageDetailsComponent();

        // Inject mock mediator
        Object.defineProperty(packageDetails, 'mediator', {
            value: mockMediator,
            writable: true
        });

        document.body.appendChild(packageDetails);
    });

    teardown(() => {
        document.body.removeChild(packageDetails);
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
        await DOM.nextUpdate();

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

    test('should trigger ReloadDependencies when source changes', async () => {
        let called = false;
        publishAsyncStub = (command: string, request: any) => {
            if (command === GET_PACKAGE_DETAILS) {
                called = true;
            }
            return Promise.resolve({ Package: null });
        };

        packageDetails.packageVersionUrl = 'https://package.url';
        packageDetails.source = 'https://source.url'; // This triggers change

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.ok(called, "ReloadDependencies should be called");
    });

    test('should trigger ReloadDependencies when packageVersionUrl changes', async () => {
        let called = false;
        publishAsyncStub = (command: string, request: any) => {
            if (command === GET_PACKAGE_DETAILS) {
                called = true;
            }
            return Promise.resolve({ Package: null });
        };

        packageDetails.source = 'https://source.url';
        packageDetails.packageVersionUrl = 'https://package.url'; // This triggers change

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.ok(called, "ReloadDependencies should be called");
    });

    test('should fetch package details with correct parameters', async () => {
        let capturedRequest: any;
        publishAsyncStub = (command: string, request: any) => {
            if (command === GET_PACKAGE_DETAILS) {
                capturedRequest = request;
            }
            return Promise.resolve({ Package: null });
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
            SourceUrl: source,
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

        let resolvePromise: any;
        const promise = new Promise(resolve => { resolvePromise = resolve; });

        publishAsyncStub = () => promise;

        packageDetails.source = 'src';
        packageDetails.packageVersionUrl = 'url';

        // Check loading state
        assert.strictEqual(packageDetails.packageDetailsLoading, true);

        // Resolve
        resolvePromise({ Package: mockPackageDetails });

        // Wait for async update
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(packageDetails.packageDetailsLoading, false);
        assert.deepStrictEqual(packageDetails.packageDetails, mockPackageDetails);
    });

    test('should handle race condition (ignore outdated result)', async () => {
        let resolveFirst: any;
        const firstPromise = new Promise(resolve => { resolveFirst = resolve; });

        let resolveSecond: any;
        const secondPromise = new Promise(resolve => { resolveSecond = resolve; });

        let callCount = 0;
        publishAsyncStub = () => {
            callCount++;
            if (callCount === 1) return firstPromise;
            return secondPromise;
        };

        packageDetails.source = 'src';

        // First change
        packageDetails.packageVersionUrl = 'url1';

        // Second change
        packageDetails.packageVersionUrl = 'url2';

        // Resolve first request (which corresponds to url1)
        resolveFirst({ Package: { id: 'old' } });
        await new Promise(resolve => setTimeout(resolve, 0));

        // Should not be updated yet because url1 != url2 (current)
        assert.strictEqual(packageDetails.packageDetails, undefined);

        // Resolve second request
        resolveSecond({ Package: { id: 'new' } });
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

        packageDetails.packageDetails = mockPackageDetails;
        packageDetails.packageDetailsLoading = false;

        await DOM.nextUpdate();

        const shadowRoot = packageDetails.shadowRoot;
        const depContainer = shadowRoot?.querySelector('expandable-container[title="Dependencies"]');
        assert.ok(depContainer);

        // The structure is:
        // .dependencies
        //   ul
        //     li (Framework 1)
        //       text
        //       ul
        //         li (Dep 1)
        //         li (Dep 2)
        //     li (Framework 2)
        // ...

        // Use direct child selector to count frameworks
        const frameworkLists = depContainer.querySelectorAll('.dependencies > ul > li');
        assert.strictEqual(frameworkLists.length, 2);

        // Check content (simplified check)
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

        packageDetails.packageDetails = mockPackageDetails;
        packageDetails.packageDetailsLoading = false;

        await DOM.nextUpdate();

        const shadowRoot = packageDetails.shadowRoot;
        const noDeps = shadowRoot?.querySelector('.no-dependencies');
        assert.ok(noDeps, "No dependencies message should be visible");
        assert.ok(noDeps.textContent?.includes('No dependencies'));
    });
});
