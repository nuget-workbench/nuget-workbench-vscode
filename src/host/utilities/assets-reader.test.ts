import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AssetsReader from './assets-reader';
import { Logger } from '../../common/logger';

suite('AssetsReader Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let tempDir: string;
    let projectPath: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(Logger, 'warn');
        AssetsReader.ClearCache();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-test-'));
        projectPath = path.join(tempDir, 'App.csproj');
    });

    teardown(() => {
        sandbox.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function assets(targets: Record<string, Record<string, { type?: string; dependencies?: Record<string, string> }>>, direct: string[], restoredPath = projectPath) {
        return {
            version: 3,
            targets,
            project: {
                restore: { projectPath: restoredPath },
                frameworks: { 'net8.0': { dependencies: Object.fromEntries(direct.map((id) => [id, { target: 'Package', version: '[1.0.0, )' }])) } },
            },
        };
    }

    function writeAssets(content: unknown) {
        fs.mkdirSync(path.join(tempDir, 'obj'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'obj', 'project.assets.json'), typeof content === 'string' ? content : JSON.stringify(content));
    }

    test('reports a project without assets file as not restored', async () => {
        const result = await AssetsReader.Read(projectPath);

        assert.deepStrictEqual(result, { Status: 'notRestored', Packages: [] });
    });

    test('reports an assets file of another project or invalid JSON as not restored', async () => {
        writeAssets(assets({ 'net8.0': {} }, [], path.join(tempDir, 'Other.csproj')));
        assert.strictEqual((await AssetsReader.Read(projectPath)).Status, 'notRestored');

        AssetsReader.ClearCache();
        writeAssets('{ not json');
        assert.strictEqual((await AssetsReader.Read(projectPath)).Status, 'notRestored');
    });

    test('lists packages pulled in through a chain and names the direct reference', () => {
        const result = AssetsReader.ComputeTransitive(assets({
            'net8.0': {
                'Serilog.AspNetCore/8.0.0': { type: 'package', dependencies: { 'Serilog.Extensions.Hosting': '8.0.0' } },
                'Serilog.Extensions.Hosting/8.0.0': { type: 'package', dependencies: { 'Serilog': '3.1.1' } },
                'Serilog/3.1.1': { type: 'package' },
            },
        }, ['Serilog.AspNetCore']));

        assert.deepStrictEqual(result, [
            { Id: 'Serilog', Version: '3.1.1', Frameworks: ['net8.0'], ViaIds: ['Serilog.AspNetCore'] },
            { Id: 'Serilog.Extensions.Hosting', Version: '8.0.0', Frameworks: ['net8.0'], ViaIds: ['Serilog.AspNetCore'] },
        ]);
    });

    test('excludes direct references and lists every direct reference that pulls a package in', () => {
        const result = AssetsReader.ComputeTransitive(assets({
            'net8.0': {
                'A/1.0.0': { type: 'package', dependencies: { Shared: '1.0.0', B: '1.0.0' } },
                'B/1.0.0': { type: 'package', dependencies: { Shared: '1.0.0' } },
                'Shared/1.0.0': { type: 'package' },
            },
        }, ['A', 'B']));

        assert.deepStrictEqual(result.map((p) => `${p.Id}:${p.ViaIds.join(',')}`), ['Shared:A,B']);
    });

    test('treats project references as roots', () => {
        const result = AssetsReader.ComputeTransitive(assets({
            'net8.0': {
                'MyLib/1.0.0': { type: 'project', dependencies: { 'Newtonsoft.Json': '13.0.3' } },
                'Newtonsoft.Json/13.0.3': { type: 'package' },
            },
        }, []));

        assert.deepStrictEqual(result.map((p) => `${p.Id}:${p.ViaIds.join(',')}`), ['Newtonsoft.Json:MyLib']);
    });

    test('merges frameworks with the same version and ignores runtime targets', () => {
        const graph = {
            'A/1.0.0': { type: 'package', dependencies: { Dep: '1.0.0' } },
            'Dep/1.0.0': { type: 'package' },
        };
        const result = AssetsReader.ComputeTransitive(assets({
            'net8.0': graph,
            'net48': graph,
            'net8.0/win-x64': { ...graph, 'Runtime.Only/1.0.0': { type: 'package' } },
        }, ['A']));

        assert.deepStrictEqual(result, [{ Id: 'Dep', Version: '1.0.0', Frameworks: ['net8.0', 'net48'], ViaIds: ['A'] }]);
    });

    test('keeps different versions per framework apart', () => {
        const result = AssetsReader.ComputeTransitive(assets({
            'net8.0': { 'A/1.0.0': { type: 'package', dependencies: { Dep: '2.0.0' } }, 'Dep/2.0.0': { type: 'package' } },
            'net48': { 'A/1.0.0': { type: 'package', dependencies: { Dep: '1.0.0' } }, 'Dep/1.0.0': { type: 'package' } },
        }, ['A']));

        assert.deepStrictEqual(result.map((p) => `${p.Version}:${p.Frameworks.join(',')}`).sort(), ['1.0.0:net48', '2.0.0:net8.0']);
    });

    test('reads the file once until a restore rewrites it', async () => {
        writeAssets(assets({ 'net8.0': { 'A/1.0.0': { type: 'package', dependencies: { Dep: '1.0.0' } }, 'Dep/1.0.0': { type: 'package' } } }, ['A']));
        const readSpy = sandbox.spy(fs.promises, 'readFile');

        const first = await AssetsReader.Read(projectPath);
        await AssetsReader.Read(projectPath);
        assert.strictEqual(readSpy.callCount, 1);
        assert.strictEqual(first.Packages[0].Id, 'Dep');

        writeAssets(assets({ 'net8.0': { 'A/1.0.0': { type: 'package', dependencies: { Other: '1.0.0' } }, 'Other/1.0.0': { type: 'package' } } }, ['A']));
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(path.join(tempDir, 'obj', 'project.assets.json'), future, future);
        const second = await AssetsReader.Read(projectPath);

        assert.strictEqual(second.Packages[0].Id, 'Other');
    });
});
