import '../web-setup';
import * as assert from 'assert';
import { VulnerabilitiesView } from '@/web/components/vulnerabilities-view';
import { ok } from '@/common/rpc/result';
import * as registrations from '@/web/registrations';
import type { HostAPI } from '@/common/rpc/types';

suite('VulnerabilitiesView Component', () => {
    let view: VulnerabilitiesView;
    let originalHostApi: HostAPI;

    const vulnerable = (id: string, transitive: boolean): VulnerablePackage => ({
        Id: id,
        InstalledVersion: '1.0.0',
        Severity: 2,
        AdvisoryUrl: 'https://github.com/advisories/GHSA-1',
        AffectedVersionRange: '[1.0.0, 1.2.0)',
        Projects: [{ Name: 'App', Path: '/src/App.csproj' }],
        ...(transitive && { IsTransitive: true, ViaIds: ['Parent.A', 'Parent.B'] }),
    });

    setup(async () => {
        originalHostApi = registrations.hostApi;
        const mockHostApi: Partial<HostAPI> = {
            getVulnerablePackages: async () => ok({ Packages: [vulnerable('Direct.Pkg', false), vulnerable('Deep.Pkg', true)] }),
        };
        Object.defineProperty(registrations, 'hostApi', { value: mockHostApi, writable: true, configurable: true });

        view = new VulnerabilitiesView();
        document.body.appendChild(view);
        await view.LoadVulnerablePackages();
        await view.updateComplete;
    });

    teardown(() => {
        document.body.removeChild(view);
        Object.defineProperty(registrations, 'hostApi', { value: originalHostApi, writable: true, configurable: true });
    });

    test('marks transitive packages and explains how to fix them', () => {
        const rows = Array.from(view.shadowRoot?.querySelectorAll('.vuln-row') ?? []);

        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].querySelector('.transitive-tag'), null);
        assert.strictEqual(rows[0].querySelector('.remediation'), null);
        assert.strictEqual(rows[1].querySelector('.transitive-tag')?.textContent, 'transitive via Parent.A, Parent.B');
        assert.ok(rows[1].querySelector('.remediation')?.textContent?.includes('Update Parent.A or Parent.B, or add a direct reference to Deep.Pkg'));
    });
});
