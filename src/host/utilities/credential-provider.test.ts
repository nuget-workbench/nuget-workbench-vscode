import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import CredentialProvider, { isAzureArtifactsUrl } from './credential-provider';
import { Logger } from '../../common/logger';

suite('CredentialProvider Tests', () => {
    const feedUrl = 'https://pkgs.dev.azure.com/org/_packaging/feed/nuget/v3/index.json';
    let sandbox: sinon.SinonSandbox;
    let spawnStub: sinon.SinonStub;
    let processes: Array<EventEmitter & { stdout: EventEmitter; stdin: { end: sinon.SinonStub }; kill: sinon.SinonStub }>;
    let originalEnv: NodeJS.ProcessEnv;
    let tempDir: string;
    let pluginPath: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(Logger, 'debug');
        sandbox.stub(Logger, 'warn');
        originalEnv = { ...process.env };
        processes = [];

        spawnStub = sandbox.stub(CredentialProvider, '_spawn' as any).callsFake(() => {
            const proc = Object.assign(new EventEmitter(), {
                stdout: new EventEmitter(),
                stdin: { end: sandbox.stub() },
                kill: sandbox.stub(),
            });
            processes.push(proc);
            return proc;
        });

        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credprovider-test-'));
        pluginPath = path.join(tempDir, 'CredentialProvider.Microsoft.dll');
        fs.writeFileSync(pluginPath, '');
        delete process.env.VSS_NUGET_EXTERNAL_FEED_ENDPOINTS;
        delete process.env.NUGET_NETCORE_PLUGIN_PATHS;
        process.env.NUGET_PLUGIN_PATHS = pluginPath;

        CredentialProvider.ClearCache();
    });

    teardown(() => {
        sandbox.restore();
        process.env = originalEnv;
        CredentialProvider.TIMEOUT_MS = 60 * 1000;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function answer(output: string, code = 0) {
        const proc = processes[processes.length - 1];
        proc.stdout.emit('data', Buffer.from(output));
        proc.emit('close', code);
    }

    test('isAzureArtifactsUrl recognizes Azure Artifacts hosts only', () => {
        assert.ok(isAzureArtifactsUrl(feedUrl));
        assert.ok(isAzureArtifactsUrl('https://org.pkgs.visualstudio.com/_packaging/feed/nuget/v3/index.json'));
        assert.ok(!isAzureArtifactsUrl('https://api.nuget.org/v3/index.json'));
        assert.ok(!isAzureArtifactsUrl('not a url'));
    });

    test('uses VSS_NUGET_EXTERNAL_FEED_ENDPOINTS without starting a process', async () => {
        process.env.VSS_NUGET_EXTERNAL_FEED_ENDPOINTS = JSON.stringify({
            endpointCredentials: [{ endpoint: 'https://Private.example.com/v3/index.json/', username: 'ci', password: 'pat' }],
        });

        const credentials = await CredentialProvider.GetCredentials('https://private.example.com/v3/index.json');

        assert.deepStrictEqual(credentials, { Username: 'ci', Password: 'pat' });
        assert.ok(spawnStub.notCalled);
    });

    test('does not start the plugin for feeds outside Azure Artifacts', async () => {
        const credentials = await CredentialProvider.GetCredentials('https://private.example.com/v3/index.json');

        assert.strictEqual(credentials, undefined);
        assert.ok(spawnStub.notCalled);
    });

    test('runs the plugin non-interactively without a shell and parses its JSON output', async () => {
        const promise = CredentialProvider.GetCredentials(feedUrl);
        answer('[Information] [CredentialProvider]Using cached token\n{"Username":"VssSessionToken","Password":"token"}\n');

        const credentials = await promise;

        assert.deepStrictEqual(credentials, { Username: 'VssSessionToken', Password: 'token' });
        const [command, args, options] = spawnStub.firstCall.args;
        assert.strictEqual(command, 'dotnet');
        assert.deepStrictEqual(args, [pluginPath, '-U', feedUrl, '-N', '-F', 'Json']);
        assert.strictEqual(options.shell, false);
    });

    test('caches the token and shares a running request', async () => {
        const first = CredentialProvider.GetCredentials(feedUrl);
        const second = CredentialProvider.GetCredentials(feedUrl);
        answer('{"Username":"u","Password":"p"}');
        await Promise.all([first, second]);
        await CredentialProvider.GetCredentials(feedUrl);

        assert.strictEqual(spawnStub.callCount, 1);
    });

    test('asks the plugin again after Invalidate', async () => {
        const first = CredentialProvider.GetCredentials(feedUrl);
        answer('{"Username":"u","Password":"p"}');
        await first;

        CredentialProvider.Invalidate(feedUrl);
        const second = CredentialProvider.GetCredentials(feedUrl);
        answer('{"Username":"u","Password":"p2"}');

        assert.strictEqual((await second)?.Password, 'p2');
        assert.strictEqual(spawnStub.callCount, 2);
    });

    test('returns undefined when the plugin fails', async () => {
        const promise = CredentialProvider.GetCredentials(feedUrl);
        answer('[Error] Interactive sign-in required', 1);

        assert.strictEqual(await promise, undefined);
    });

    test('kills a plugin that does not answer in time', async () => {
        CredentialProvider.TIMEOUT_MS = 10;

        const credentials = await CredentialProvider.GetCredentials(feedUrl);

        assert.strictEqual(credentials, undefined);
        assert.ok(processes[0].kill.calledOnce);
    });

    test('returns undefined when the plugin is not installed', async () => {
        process.env.NUGET_PLUGIN_PATHS = path.join(tempDir, 'missing', 'CredentialProvider.Microsoft.dll');
        process.env.HOME = tempDir;
        process.env.USERPROFILE = tempDir;

        const credentials = await CredentialProvider.GetCredentials(feedUrl);

        assert.strictEqual(credentials, undefined);
        assert.ok(spawnStub.notCalled);
    });
});
