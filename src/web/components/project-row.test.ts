import '../web-setup';
import * as assert from 'assert';
import { ProjectRow } from '@/web/components/project-row';
import { ProjectViewModel, ProjectPackageViewModel } from '@/web/types';
import { ok } from '@/common/rpc/result';
import * as registrations from '@/web/registrations';
import type { HostAPI } from '@/common/rpc/types';

suite('ProjectRow Component', () => {
    let projectRow: ProjectRow;
    let mockHostApi: Partial<HostAPI>;
    let originalHostApi: HostAPI;

    const createMockProject = (name: string, path: string, packages: { Id: string, Version: string, IsPinned?: boolean }[]): ProjectViewModel => {
        return new ProjectViewModel({
            Name: name,
            Path: path,
            Packages: packages.map(p => ({ ...p, IsPinned: p.IsPinned ?? false, VersionSource: "project" as VersionSource })),
            CpmEnabled: false,
        });
    };

    setup(() => {
        originalHostApi = registrations.hostApi;

        mockHostApi = {
            updateProject: async () => ok({
                Project: {
                    Name: 'TestProject',
                    Path: 'path/to/project',
                    Packages: [],
                    CpmEnabled: false,
                },
                IsCpmEnabled: false
            }),
        };

        // Replace the module-level hostApi
        Object.defineProperty(registrations, 'hostApi', {
            value: mockHostApi,
            writable: true,
            configurable: true,
        });

        projectRow = new ProjectRow();
        projectRow.project = createMockProject('TestProject', 'path/to/project', [
            { Id: 'TestPackage', Version: '1.0.0' },
            { Id: 'OtherPackage', Version: '2.0.0' }
        ]);
        projectRow.packageId = 'TestPackage';
        projectRow.packageVersion = '1.0.0';

        document.body.appendChild(projectRow);
    });

    teardown(() => {
        document.body.removeChild(projectRow);
        Object.defineProperty(registrations, 'hostApi', {
            value: originalHostApi,
            writable: true,
            configurable: true,
        });
    });

    test('should render project name', async () => {
        await projectRow.updateComplete;
        const shadowRoot = projectRow.shadowRoot;
        const nameSpan = shadowRoot?.querySelector('.project-title .name');
        assert.strictEqual(nameSpan?.textContent, 'TestProject');
    });

    test('should show uninstall button when package is installed and version matches', async () => {
        projectRow.packageId = 'TestPackage';
        projectRow.packageVersion = '1.0.0';
        await projectRow.updateComplete;

        const shadowRoot = projectRow.shadowRoot;
        const uninstallIcon = shadowRoot?.querySelector('.icon-btn .codicon-diff-removed');
        assert.ok(uninstallIcon, 'Uninstall icon should be present');
    });

    test('should show update and uninstall buttons when version differs', async () => {
        projectRow.packageId = 'TestPackage';
        projectRow.packageVersion = '1.1.0';
        await projectRow.updateComplete;

        const shadowRoot = projectRow.shadowRoot;
        const updateIcon = shadowRoot?.querySelector('.icon-btn .codicon-arrow-circle-up');
        const uninstallIcon = shadowRoot?.querySelector('.icon-btn .codicon-diff-removed');

        assert.ok(updateIcon, 'Update icon should be present');
        assert.ok(uninstallIcon, 'Uninstall icon should be present');
    });

    test('should show install button when package is not installed', async () => {
        projectRow.packageId = 'NewPackage';
        projectRow.packageVersion = '1.0.0';
        await projectRow.updateComplete;

        const shadowRoot = projectRow.shadowRoot;
        const installIcon = shadowRoot?.querySelector('.icon-btn .codicon-diff-added');
        assert.ok(installIcon, 'Install icon should be present');
    });

    test('Install click should call hostApi.updateProject with INSTALL', async () => {
        projectRow.packageId = 'NewPackage';
        projectRow.packageVersion = '1.0.0';
        await projectRow.updateComplete;

        let calledWith: any;
        mockHostApi.updateProject = async (req) => {
            calledWith = req;
            return ok({
                Project: {
                    Name: 'TestProject',
                    Path: 'path/to/project',
                    Packages: [
                        { Id: 'TestPackage', Version: '1.0.0', IsPinned: false, VersionSource: 'project' as VersionSource },
                        { Id: 'NewPackage', Version: '1.0.0', IsPinned: false, VersionSource: 'project' as VersionSource },
                    ],
                    CpmEnabled: false,
                },
                IsCpmEnabled: false,
            });
        };

        const installButton = projectRow.shadowRoot?.querySelector('.icon-btn') as HTMLElement;
        installButton?.click();

        await new Promise(r => setTimeout(r, 50));

        assert.ok(calledWith, 'updateProject should have been called');
        assert.strictEqual(calledWith.Type, 'INSTALL');
        assert.strictEqual(calledWith.PackageId, 'NewPackage');
    });

    test('should emit project-updated event after successful update', async () => {
        projectRow.packageId = 'NewPackage';
        projectRow.packageVersion = '1.0.0';
        await projectRow.updateComplete;

        mockHostApi.updateProject = async () => ok({
            Project: {
                Name: 'TestProject',
                Path: 'path/to/project',
                Packages: [],
                CpmEnabled: false,
            },
            IsCpmEnabled: true,
        });

        let eventDetail: any;
        projectRow.addEventListener('project-updated', (e: any) => {
            eventDetail = e.detail;
        });

        const installButton = projectRow.shadowRoot?.querySelector('.icon-btn') as HTMLElement;
        installButton?.click();

        await new Promise(r => setTimeout(r, 50));

        assert.ok(eventDetail, 'project-updated event should have been dispatched');
        assert.strictEqual(eventDetail.isCpmEnabled, true);
    });

    test('should label a lower target version as a downgrade', async () => {
        projectRow.packageId = 'TestPackage';
        projectRow.packageVersion = '0.9.0';
        await projectRow.updateComplete;

        const shadowRoot = projectRow.shadowRoot;
        assert.ok(shadowRoot?.querySelector('.icon-btn .codicon-arrow-circle-down'), 'Downgrade icon should be present');
        assert.strictEqual(shadowRoot?.querySelector('.icon-btn .codicon-arrow-circle-up'), null);
    });

    test('should match the package id case-insensitively', async () => {
        projectRow.packageId = 'testpackage';
        projectRow.packageVersion = '1.0.0';
        await projectRow.updateComplete;

        assert.strictEqual(projectRow.shadowRoot?.querySelector('.codicon-diff-added'), null, 'should not offer install');
        assert.ok(projectRow.shadowRoot?.querySelector('.codicon-diff-removed'));
    });

    test('should show an error when the operation fails', async () => {
        projectRow.packageId = 'NewPackage';
        projectRow.packageVersion = '1.0.0';
        await projectRow.updateComplete;

        mockHostApi.updateProject = async () => ({ ok: false, error: 'dotnet exited with code 1' });

        (projectRow.shadowRoot?.querySelector('.icon-btn') as HTMLElement).click();
        await new Promise(r => setTimeout(r, 50));
        await projectRow.updateComplete;

        const error = projectRow.shadowRoot?.querySelector('.row-error');
        assert.ok(error, 'error indicator should be shown');
        assert.strictEqual(error?.getAttribute('title'), 'dotnet exited with code 1');
    });

    test('should not offer an update for a property or floating version', async () => {
        projectRow.project = createMockProject('TestProject', 'path/to/project', [
            { Id: 'TestPackage', Version: '$(TestPackageVersion)' },
        ]);
        projectRow.packageVersion = '2.0.0';
        await projectRow.updateComplete;

        const shadowRoot = projectRow.shadowRoot;
        assert.strictEqual(shadowRoot?.querySelector('.codicon-arrow-circle-up'), null);
        assert.ok(shadowRoot?.querySelector('.codicon-diff-removed'), 'uninstall stays available');
    });

    test('should apply the result to the project it was started for', async () => {
        const projectA = createMockProject('A', 'path/to/A', []);
        const projectB = createMockProject('B', 'path/to/B', []);
        projectRow.project = projectA;
        projectRow.packageId = 'Serilog';
        projectRow.packageVersion = '3.0.0';
        await projectRow.updateComplete;

        type UpdateResult = Awaited<ReturnType<HostAPI['updateProject']>>;
        let resolveUpdate!: (v: UpdateResult) => void;
        mockHostApi.updateProject = () => new Promise<UpdateResult>(r => { resolveUpdate = r; });

        (projectRow.shadowRoot?.querySelector('.icon-btn') as HTMLElement).click();
        // The row is given another project while dotnet runs
        projectRow.project = projectB;
        resolveUpdate(ok({
            Project: {
                Name: 'A',
                Path: 'path/to/A',
                Packages: [{ Id: 'Serilog', Version: '3.0.0', IsPinned: false, VersionSource: 'project' as VersionSource }],
                CpmEnabled: false,
            },
            IsCpmEnabled: false,
        }));
        await new Promise(r => setTimeout(r, 20));

        assert.deepStrictEqual(projectA.Packages.map(p => p.Id), ['Serilog']);
        assert.strictEqual(projectB.Packages.length, 0);
    });

    test('should not offer an update for an equivalent version', async () => {
        projectRow.packageId = 'TestPackage';
        projectRow.packageVersion = '1.0';
        await projectRow.updateComplete;

        const shadowRoot = projectRow.shadowRoot;
        assert.strictEqual(shadowRoot?.querySelector('.codicon-arrow-circle-up'), null);
        assert.strictEqual(shadowRoot?.querySelector('.codicon-arrow-circle-down'), null);
    });

    test('run() without confirmation and notification skips the dialog and the reload event', async () => {
        let confirmations = 0;
        (mockHostApi as any).showConfirmation = async () => { confirmations++; return ok({ Confirmed: true }); };
        let updatedEvents = 0;
        projectRow.addEventListener('project-updated', () => updatedEvents++);

        const result = await projectRow.run('UNINSTALL', { confirm: false, notify: false });

        assert.ok(result);
        assert.strictEqual(confirmations, 0);
        assert.strictEqual(updatedEvents, 0);
    });

    test('run() reports the operation and its error to the output log', async () => {
        mockHostApi.updateProject = async () => ({ ok: false, error: 'dotnet exited with code 1: error NU1101: Unable to find package' });
        const entries: Array<{ text: string; level: string }> = [];
        projectRow.addEventListener('operation-log', (e) => entries.push((e as CustomEvent).detail));

        const result = await projectRow.run('INSTALL');

        assert.strictEqual(result, null);
        assert.strictEqual(entries[0].level, 'info');
        assert.ok(entries[0].text.startsWith('Installing TestPackage 1.0.0 in TestProject'));
        assert.deepStrictEqual(entries[1], { text: 'TestProject: dotnet exited with code 1: error NU1101: Unable to find package', level: 'error' });
    });

    test('labels centrally managed versions and the project folder', async () => {
        projectRow.project = new ProjectViewModel({
            Name: 'TestProject',
            Path: 'path/to/project',
            Packages: [{ Id: 'TestPackage', Version: '1.0.0', IsPinned: false, VersionSource: 'central' }],
            CpmEnabled: true,
        });
        projectRow.project.DirHint = 'src/TestProject';
        await projectRow.updateComplete;

        assert.strictEqual(projectRow.shadowRoot?.querySelector('.version-source')?.textContent, 'CPM');
        assert.strictEqual(projectRow.shadowRoot?.querySelector('.dir-hint')?.textContent, 'src/TestProject');
    });

    test('shows a transitive version and offers a direct reference', async () => {
        projectRow.project = new ProjectViewModel({
            Name: 'TestProject',
            Path: 'path/to/project',
            Packages: [],
            CpmEnabled: false,
            TransitivePackages: [{ Id: 'TestPackage', Version: '0.9.0', Frameworks: ['net8.0'], ViaIds: ['Parent'] }],
        });
        await projectRow.updateComplete;

        assert.strictEqual(projectRow.shadowRoot?.querySelector('.version.transitive')?.textContent?.trim(), '0.9.0 (transitive)');
        assert.strictEqual(projectRow.shadowRoot?.querySelector('.icon-btn')?.getAttribute('title'), 'Add direct reference 1.0.0');
    });

    test('run() keeps the transitive packages returned for the project and logs an update as updated', async () => {
        mockHostApi.updateProject = async () => ok({
            Project: {
                Name: 'TestProject',
                Path: 'path/to/project',
                Packages: [{ Id: 'TestPackage', Version: '2.0.0', IsPinned: false, VersionSource: 'project' }],
                CpmEnabled: false,
                TransitivePackages: [{ Id: 'Dep', Version: '1.0.0', Frameworks: ['net8.0'], ViaIds: ['TestPackage'] }],
                AssetsStatus: 'ok',
            },
            IsCpmEnabled: false,
        });
        projectRow.packageVersion = '2.0.0';
        const entries: Array<{ text: string; level: string }> = [];
        projectRow.addEventListener('operation-log', (e) => entries.push((e as CustomEvent).detail));

        await projectRow.run('UPDATE');

        assert.deepStrictEqual(projectRow.project.TransitivePackages.map(p => p.Id), ['Dep']);
        assert.strictEqual(projectRow.project.AssetsStatus, 'ok');
        assert.strictEqual(entries[1].text, 'TestProject: TestPackage 2.0.0 updated');
    });
});
