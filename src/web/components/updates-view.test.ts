import '../web-setup';
import * as assert from 'assert';
import { UpdatesView } from '@/web/components/updates-view';
import { ok } from '@/common/rpc/result';
import * as registrations from '@/web/registrations';
import type { HostAPI } from '@/common/rpc/types';

suite('UpdatesView Component', () => {
    let view: UpdatesView;
    let mockHostApi: Partial<HostAPI>;
    let originalHostApi: HostAPI;

    const outdated = (id: string): OutdatedPackage => ({
        Id: id,
        InstalledVersion: '1.0.0',
        LatestVersion: '2.0.0',
        Projects: [{ Name: 'App', Path: '/src/App.csproj', Version: '1.0.0' }],
        SourceUrl: 'https://api.nuget.org/v3/index.json',
        SourceName: 'nuget.org',
    });

    setup(async () => {
        originalHostApi = registrations.hostApi;
        mockHostApi = {
            getOutdatedPackages: async () => ok({ Packages: [outdated('Pkg.A'), outdated('Pkg.B')] }),
            showConfirmation: async () => ok({ Confirmed: true }),
        };
        Object.defineProperty(registrations, 'hostApi', { value: mockHostApi, writable: true, configurable: true });

        view = new UpdatesView();
        document.body.appendChild(view);
        await new Promise(r => setTimeout(r, 0));
        await view.updateComplete;
    });

    teardown(() => {
        document.body.removeChild(view);
        Object.defineProperty(registrations, 'hostApi', { value: originalHostApi, writable: true, configurable: true });
    });

    test('keeps failed packages in the list and shows their error', async () => {
        mockHostApi.batchUpdatePackages = async () => ok({
            Results: [
                { PackageId: 'Pkg.A', Success: true },
                { PackageId: 'Pkg.B', Success: false, Error: 'NU1102: Unable to find package' },
            ],
        });
        let projectsChanged = false;
        view.addEventListener('projects-changed', () => { projectsChanged = true; });

        const updateAll = view.shadowRoot?.querySelector('.primary-btn') as HTMLButtonElement;
        updateAll.click();
        await new Promise(r => setTimeout(r, 20));
        await view.updateComplete;

        assert.deepStrictEqual(view.packages.map(p => p.Id), ['Pkg.B']);
        assert.strictEqual(view.packages[0].Error, 'NU1102: Unable to find package');
        assert.ok(view.shadowRoot?.querySelector('.row-error'), 'error indicator should be rendered');
        assert.match(view.statusText, /1 of 2 updates failed/);
        assert.strictEqual(projectsChanged, true);
    });

    test('keeps all packages when the RPC call fails', async () => {
        mockHostApi.batchUpdatePackages = async () => ({ ok: false, error: 'RPC timeout' });

        (view.shadowRoot?.querySelector('.primary-btn') as HTMLButtonElement).click();
        await new Promise(r => setTimeout(r, 20));

        assert.strictEqual(view.packages.length, 2);
        assert.ok(view.packages.every(p => p.Error === 'RPC timeout'));
    });

    test('update button counts selected packages and select-all toggles them', async () => {
        const button = () => view.shadowRoot?.querySelector('.primary-btn') as HTMLButtonElement;
        assert.match(button().textContent ?? '', /Update All \(2\)/);

        const selectAll = view.shadowRoot?.querySelector('.select-all') as HTMLInputElement;
        selectAll.checked = false;
        selectAll.dispatchEvent(new Event('change'));
        await view.updateComplete;

        assert.match(button().textContent ?? '', /Update Selected \(0\)/);
        assert.strictEqual(button().disabled, true);
    });

    test('ignores a stale load that finishes after a newer one', async () => {
        let resolveFirst!: (v: unknown) => void;
        mockHostApi.getOutdatedPackages = () => new Promise(r => { resolveFirst = r; }) as any;
        const first = view.LoadOutdatedPackages();

        mockHostApi.getOutdatedPackages = async () => ok({ Packages: [outdated('Newer')] });
        await view.LoadOutdatedPackages();

        resolveFirst(ok({ Packages: [outdated('Stale')] }));
        await first;

        assert.deepStrictEqual(view.packages.map(p => p.Id), ['Newer']);
        assert.strictEqual(view.isLoading, false);
    });
});
