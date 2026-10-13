import './web-setup';
import * as assert from 'assert';
import { PackageViewModel, ProjectViewModel, applyDirHints } from '@/web/types';

suite('Web view models', () => {
    const project = (path: string) => new ProjectViewModel({
        Name: path.split(/[\\/]/).pop()!,
        Path: path,
        Packages: [],
        CpmEnabled: false,
    });

    test('applyDirHints leaves unique project names alone', () => {
        const projects = [project('/repo/src/App/App.csproj'), project('/repo/tests/App.Tests/App.Tests.csproj')];

        applyDirHints(projects);

        assert.deepStrictEqual(projects.map((p) => p.DirHint), ['', '']);
    });

    test('applyDirHints names the parent folders of projects with the same name', () => {
        const projects = [
            project('/repo/src/Unit/Tests.csproj'),
            project('/repo/tests/Unit/Tests.csproj'),
            project('C:\\repo\\tools\\Tests.csproj'),
            project('/repo/src/App/App.csproj'),
        ];

        applyDirHints(projects);

        assert.deepStrictEqual(projects.map((p) => p.DirHint), ['src/Unit', 'tests/Unit', 'repo/tools', '']);
    });

    test('GetDeprecation matches equivalent versions and ignores "Multiple"', () => {
        const pkg = new PackageViewModel({
            Id: 'Old', Name: 'Old', Authors: [], Description: '', IconUrl: '', LicenseUrl: '', ProjectUrl: '',
            Registration: '', TotalDownloads: 0, Verified: false, InstalledVersion: '', Version: '2.0.0', Versions: [], Tags: [],
            Deprecations: { '1.0.0': { Reasons: ['Legacy'] } },
        });

        assert.deepStrictEqual(pkg.GetDeprecation('1.0'), { Reasons: ['Legacy'] });
        assert.strictEqual(pkg.GetDeprecation('2.0.0'), undefined);
        assert.strictEqual(pkg.GetDeprecation('Multiple'), undefined);
    });
});
