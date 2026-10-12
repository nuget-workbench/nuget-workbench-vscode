import * as assert from 'assert';
import * as sinon from 'sinon';
import * as path from 'path';
import NuGetConfigResolver from './nuget-config-resolver';
import { buildSourceArgs } from './source-args';
import { Logger } from '../../common/logger';

suite('buildSourceArgs Tests', () => {
    const projectPath = path.join('/repo', 'src', 'App', 'App.csproj');
    let sandbox: sinon.SinonSandbox;
    let sourcesStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(Logger, 'debug');
        sourcesStub = sandbox.stub(NuGetConfigResolver, 'GetSourcesWithCredentials').resolves([
            { Name: 'nuget.org', Url: 'https://api.nuget.org/v3/index.json' },
            { Name: 'Company', Url: 'https://feed.example.com/v3/index.json' },
        ]);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('passes nothing without a source', async () => {
        assert.deepStrictEqual(await buildSourceArgs(projectPath, undefined), []);
        assert.deepStrictEqual(await buildSourceArgs(projectPath, ''), []);
    });

    test('passes nothing for a feed the project nuget.config already has', async () => {
        assert.deepStrictEqual(await buildSourceArgs(projectPath, 'https://FEED.example.com/v3/index.json/'), []);
        assert.ok(sourcesStub.calledWith(path.dirname(projectPath)));
    });

    test('passes the extra feed together with all configured feeds', async () => {
        const args = await buildSourceArgs(projectPath, 'https://settings-only.example.com/v3/index.json');

        assert.deepStrictEqual(args, [
            '-s', 'https://settings-only.example.com/v3/index.json',
            '-s', 'https://api.nuget.org/v3/index.json',
            '-s', 'https://feed.example.com/v3/index.json',
        ]);
    });

    test('passes nothing when the restore is skipped', async () => {
        assert.deepStrictEqual(await buildSourceArgs(projectPath, 'https://settings-only.example.com/v3/index.json', true), []);
    });
});
