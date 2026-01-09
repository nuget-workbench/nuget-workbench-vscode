import '../web-setup';
import * as assert from 'assert';
import { ProjectRow } from '@/web/components/project-row';
import { ProjectViewModel, ProjectPackageViewModel } from '@/web/types';
import { DOM } from '@microsoft/fast-element';
import { IMediator } from '@/common/messaging/core/types';
import { UPDATE_PROJECT } from '@/common/messaging/core/commands';

suite('ProjectRow Component', () => {
    let projectRow: ProjectRow;
    let mockMediator: IMediator;
    let mockProject: ProjectViewModel;

    // Helper to create a mock ProjectViewModel
    const createMockProject = (name: string, path: string, packages: { Id: string, Version: string }[]): ProjectViewModel => {
        return new ProjectViewModel({
            Name: name,
            Path: path,
            Packages: packages
        });
    };

    setup(() => {
        // Mock Mediator
        mockMediator = {
            PublishAsync: async <REQ, RES>(command: string, request: REQ): Promise<RES> => {
                // Default implementation
                return {
                    Project: {
                        Name: 'TestProject',
                        Path: 'path/to/project',
                        Packages: []
                    },
                    IsCpmEnabled: false
                } as unknown as RES;
            },
            AddHandler: <REQ, RES>(command: string, handler: any): IMediator => {
                return mockMediator;
            }
        } as IMediator;

        mockProject = createMockProject('TestProject', 'path/to/project', [
            { Id: 'TestPackage', Version: '1.0.0' },
            { Id: 'OtherPackage', Version: '2.0.0' }
        ]);

        projectRow = new ProjectRow();
        projectRow.project = mockProject;
        projectRow.packageId = 'TestPackage';
        projectRow.packageVersion = '1.0.0'; // Current latest version available in gallery, effectively

        // Inject mock mediator
        Object.defineProperty(projectRow, 'mediator', {
            value: mockMediator,
            writable: true
        });

        document.body.appendChild(projectRow);
    });

    teardown(() => {
        document.body.removeChild(projectRow);
    });

    test('should render project name', async () => {
        await DOM.nextUpdate();
        const shadowRoot = projectRow.shadowRoot;
        const nameSpan = shadowRoot?.querySelector('.project-title .name');
        assert.strictEqual(nameSpan?.textContent, 'TestProject');
    });

    test('should show uninstall button when package is installed and version matches', async () => {
        projectRow.packageId = 'TestPackage';
        projectRow.packageVersion = '1.0.0';
        // Need to trigger update since we changed properties manually
        // FAST should handle it, but awaiting next update is safe
        await DOM.nextUpdate();

        const shadowRoot = projectRow.shadowRoot;
        const versionSpan = shadowRoot?.querySelector('.version');
        assert.strictEqual(versionSpan?.textContent, '1.0.0');

        const buttons = shadowRoot?.querySelectorAll('vscode-button');
        assert.strictEqual(buttons?.length, 1);

        const uninstallIcon = buttons?.[0].querySelector('.codicon-diff-removed');
        assert.ok(uninstallIcon, 'Uninstall icon should be present');
    });

    test('should show update button and uninstall button when package is installed but version differs', async () => {
        projectRow.packageId = 'TestPackage';
        projectRow.packageVersion = '1.1.0'; // Newer version available

        await DOM.nextUpdate();

        const shadowRoot = projectRow.shadowRoot;
        const versionSpan = shadowRoot?.querySelector('.version');
        assert.strictEqual(versionSpan?.textContent, '1.0.0'); // Installed version

        const buttons = shadowRoot?.querySelectorAll('vscode-button');
        assert.strictEqual(buttons?.length, 2);

        const updateIcon = buttons?.[0].querySelector('.codicon-arrow-circle-up');
        const uninstallIcon = buttons?.[1].querySelector('.codicon-diff-removed');

        assert.ok(updateIcon, 'Update icon should be present');
        assert.ok(uninstallIcon, 'Uninstall icon should be present');
    });

    test('should show install button when package is not installed', async () => {
        projectRow.packageId = 'NewPackage'; // Not in project packages
        projectRow.packageVersion = '1.0.0';

        await DOM.nextUpdate();

        const shadowRoot = projectRow.shadowRoot;
        const versionSpan = shadowRoot?.querySelector('.version');
        // Version span should display installed version, which is undefined/empty if not installed.
        // Looking at the template: <span class="version">${(x) => x.ProjectPackage?.Version}</span>
        // If ProjectPackage is undefined, it renders nothing or empty string.
        assert.strictEqual(versionSpan?.textContent, '');

        const buttons = shadowRoot?.querySelectorAll('vscode-button');
        assert.strictEqual(buttons?.length, 1);

        const installIcon = buttons?.[0].querySelector('.codicon-diff-added');
        assert.ok(installIcon, 'Install icon should be present');
    });

    test('Update(INSTALL) should call mediator and update project', async () => {
        projectRow.packageId = 'NewPackage';
        projectRow.packageVersion = '1.0.0';
        await DOM.nextUpdate();

        let called = false;
        // Mock mediator response
        projectRow.mediator.PublishAsync = async <REQ, RES>(command: string, request: REQ): Promise<RES> => {
            if (command === UPDATE_PROJECT) {
                const req = request as any;
                assert.strictEqual(req.Type, 'INSTALL');
                assert.strictEqual(req.PackageId, 'NewPackage');
                assert.strictEqual(req.Version, '1.0.0');
                called = true;
                return {
                    Project: {
                        Name: 'TestProject',
                        Path: 'path/to/project',
                        Packages: [
                            { Id: 'TestPackage', Version: '1.0.0' },
                            { Id: 'OtherPackage', Version: '2.0.0' },
                            { Id: 'NewPackage', Version: '1.0.0' }
                        ]
                    },
                    IsCpmEnabled: false
                } as unknown as RES;
            }
            return null as unknown as RES;
        };

        const installButton = projectRow.shadowRoot?.querySelector('vscode-button span.codicon-diff-added') as HTMLElement;
        installButton.click();

        // Wait for async operation
        await new Promise(r => setTimeout(r, 10)); // Give it a tick

        assert.strictEqual(called, true);

        // Verify project is updated
        const installed = projectRow.project.Packages.find(p => p.Id === 'NewPackage');
        assert.ok(installed, 'Package should be added to project');
        assert.strictEqual(installed?.Version, '1.0.0');
    });

    test('Update(UNINSTALL) should call mediator and update project', async () => {
        projectRow.packageId = 'TestPackage';
        projectRow.packageVersion = '1.0.0';
        await DOM.nextUpdate();

        let called = false;
        projectRow.mediator.PublishAsync = async <REQ, RES>(command: string, request: REQ): Promise<RES> => {
             if (command === UPDATE_PROJECT) {
                const req = request as any;
                assert.strictEqual(req.Type, 'UNINSTALL');
                assert.strictEqual(req.PackageId, 'TestPackage');
                called = true;
                return {
                    Project: {
                        Name: 'TestProject',
                        Path: 'path/to/project',
                        Packages: [
                            { Id: 'OtherPackage', Version: '2.0.0' }
                        ]
                    },
                    IsCpmEnabled: false
                } as unknown as RES;
            }
            return null as unknown as RES;
        };

        const uninstallButton = projectRow.shadowRoot?.querySelector('vscode-button span.codicon-diff-removed') as HTMLElement;
        uninstallButton.click();

        await new Promise(r => setTimeout(r, 10));

        assert.strictEqual(called, true);

        const installed = projectRow.project.Packages.find(p => p.Id === 'TestPackage');
        assert.strictEqual(installed, undefined, 'Package should be removed from project');
    });

    test('Update(UPDATE) should call mediator and update project', async () => {
        projectRow.packageId = 'TestPackage';
        projectRow.packageVersion = '1.1.0'; // Update available
        await DOM.nextUpdate();

        let called = false;
        projectRow.mediator.PublishAsync = async <REQ, RES>(command: string, request: REQ): Promise<RES> => {
             if (command === UPDATE_PROJECT) {
                const req = request as any;
                assert.strictEqual(req.Type, 'UPDATE');
                assert.strictEqual(req.PackageId, 'TestPackage');
                assert.strictEqual(req.Version, '1.1.0');
                called = true;
                return {
                    Project: {
                        Name: 'TestProject',
                        Path: 'path/to/project',
                        Packages: [
                             { Id: 'TestPackage', Version: '1.1.0' }, // Updated
                             { Id: 'OtherPackage', Version: '2.0.0' }
                        ]
                    },
                    IsCpmEnabled: false
                } as unknown as RES;
            }
            return null as unknown as RES;
        };

        const updateButton = projectRow.shadowRoot?.querySelector('vscode-button span.codicon-arrow-circle-up') as HTMLElement;
        updateButton.click();

        await new Promise(r => setTimeout(r, 10));

        assert.strictEqual(called, true);

        const installed = projectRow.project.Packages.find(p => p.Id === 'TestPackage');
        assert.strictEqual(installed?.Version, '1.1.0', 'Package version should be updated');
    });

    test('should show loader during update', async () => {
        projectRow.packageId = 'NewPackage';
        projectRow.packageVersion = '1.0.0';
        await DOM.nextUpdate();

        let resolvePromise: any;
        const promise = new Promise(resolve => { resolvePromise = resolve; });

        projectRow.mediator.PublishAsync = async <REQ, RES>(command: string, request: REQ): Promise<RES> => {
            await promise; // blocked until we resolve it
             return {
                    Project: {
                        Name: 'TestProject',
                        Path: 'path/to/project',
                        Packages: []
                    },
                    IsCpmEnabled: false
                } as unknown as RES;
        };

        // Call Update manually to control timing easier than click
        const updatePromise = projectRow.Update('INSTALL');

        // Check if loader is added
        // The loader state is observable
        assert.strictEqual(projectRow.loaders.Get('NewPackage'), true);

        // Force update to check DOM
        await DOM.nextUpdate();
        const loader = projectRow.shadowRoot?.querySelector('.loader');
        assert.ok(loader, 'Loader should be visible');

        // Finish the operation
        resolvePromise();
        await updatePromise;

        assert.strictEqual(projectRow.loaders.Get('NewPackage'), undefined); // Removed

        await DOM.nextUpdate();
        const loaderAfter = projectRow.shadowRoot?.querySelector('.loader');
        assert.strictEqual(loaderAfter, null, 'Loader should be hidden');
    });

    test('should emit project-updated event after update', async () => {
        projectRow.packageId = 'NewPackage';
        projectRow.packageVersion = '1.0.0';

        let eventDetail: any;
        projectRow.addEventListener('project-updated', (e: any) => {
            eventDetail = e.detail;
        });

        await projectRow.Update('INSTALL');

        assert.ok(eventDetail);
        assert.strictEqual(eventDetail.isCpmEnabled, false);
    });
});
