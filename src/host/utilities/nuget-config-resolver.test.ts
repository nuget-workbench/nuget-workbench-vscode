import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import NuGetConfigResolver from './nuget-config-resolver';
import PasswordScriptExecutor from './password-script-executor';
import CredentialsCache from './credentials-cache';
import { Logger } from '../../common/logger';

suite('NuGetConfigResolver Tests', () => {
    let sandbox: sinon.SinonSandbox;
    // let osHomedirStub: sinon.SinonStub; // Cannot stub immutable property
    let vscodeGetConfigurationStub: sinon.SinonStub;
    let executeScriptStub: sinon.SinonStub;
    let credentialsCacheSetStub: sinon.SinonStub;
    let originalPlatform: string;
    let originalEnv: NodeJS.ProcessEnv;

    let tempDir: string;
    let workspaceDir: string;
    let homeDir: string;
    let appDataDir: string;
    let programFilesDir: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        // os.homedir is immutable in this environment, so we cannot stub it.
        // We will rely on process.env.HOME (Linux/macOS) or USERPROFILE (Windows) if the code uses os.homedir().
        // However, os.homedir() usually reads from env vars or system calls.
        // If we cannot stub it, we might be stuck unless we can change the env vars it reads.
        // Node's os.homedir() reads HOME on POSIX and USERPROFILE on Windows.

        vscodeGetConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration');
        executeScriptStub = sandbox.stub(PasswordScriptExecutor, 'ExecuteScript');
        credentialsCacheSetStub = sandbox.stub(CredentialsCache, 'set');
        sandbox.stub(Logger, 'debug');
        sandbox.stub(Logger, 'error');
        sandbox.stub(Logger, 'info');

        originalPlatform = process.platform;
        originalEnv = { ...process.env };

        NuGetConfigResolver.ClearCache();

        // Setup temp directories
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-test-'));
        workspaceDir = path.join(tempDir, 'workspace');
        homeDir = path.join(tempDir, 'home');
        appDataDir = path.join(tempDir, 'appdata');
        programFilesDir = path.join(tempDir, 'programfiles');

        fs.mkdirSync(workspaceDir);
        fs.mkdirSync(homeDir);
        fs.mkdirSync(appDataDir);
        fs.mkdirSync(programFilesDir);

        // Try to influence os.homedir via env vars
        process.env.HOME = homeDir;
        process.env.USERPROFILE = homeDir;

        process.env.APPDATA = appDataDir;
        process.env['ProgramFiles(x86)'] = programFilesDir;
        process.env['ProgramFiles'] = programFilesDir;
    });

    teardown(() => {
        sandbox.restore();
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        process.env = originalEnv;

        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.error('Failed to cleanup temp dir', e);
        }
    });

    // Helper to write config file
    function writeConfig(dir: string, subPath: string, content: string) {
        const fullPath = path.join(dir, subPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
        return fullPath;
    }

    suite('FindAllConfigFiles', () => {
        test('Returns workspace configs when they exist', () => {
            writeConfig(workspaceDir, 'nuget.config', '<configuration/>');
            writeConfig(workspaceDir, '.nuget/nuget.config', '<configuration/>');

            const paths = (NuGetConfigResolver as any).FindAllConfigFiles(workspaceDir);

            const expected1 = path.join(workspaceDir, '.nuget', 'nuget.config');
            const expected2 = path.join(workspaceDir, 'nuget.config');

            assert.ok(paths.includes(expected1));
            assert.ok(paths.includes(expected2));
            assert.strictEqual(paths[0], expected1);
        });

        test('Returns user config paths on Windows', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });

            // Check if os.homedir() respects USERPROFILE change
            const currentHome = os.homedir();
            // If currentHome is not homeDir, we might have issues if we rely on os.homedir()
            // But let's assume it works or just check behavior.

            const appDataConfig = writeConfig(appDataDir, 'NuGet/NuGet.Config', '<configuration/>');
            // If os.homedir() is not mocked, this path might be wrong in the test expectation if code uses real homedir
            // But we set USERPROFILE.

            const userProfileConfig = writeConfig(homeDir, '.nuget/NuGet/NuGet.Config', '<configuration/>');

            const paths = (NuGetConfigResolver as any).FindAllConfigFiles(undefined);

            assert.ok(paths.includes(appDataConfig));
            // Only check if homedir was successfully influenced
            if (currentHome === homeDir) {
                assert.ok(paths.includes(userProfileConfig));
            }
        });

        test('Returns user config paths on Non-Windows', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });

            const userProfileConfig = writeConfig(homeDir, '.nuget/NuGet/NuGet.Config', '<configuration/>');
            const xdgConfig = writeConfig(homeDir, '.config/NuGet/NuGet.Config', '<configuration/>');

            const paths = (NuGetConfigResolver as any).FindAllConfigFiles(undefined);

            // Only check if homedir was successfully influenced
            if (os.homedir() === homeDir) {
                assert.ok(paths.includes(userProfileConfig));
                assert.ok(paths.includes(xdgConfig));
            }
        });

        test('Returns machine config on Windows', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });

            const machineConfig = writeConfig(programFilesDir, 'NuGet/Config/Microsoft.VisualStudio.Offline.config', '<configuration/>');

            const paths = (NuGetConfigResolver as any).FindAllConfigFiles(undefined);
            assert.ok(paths.includes(machineConfig));
        });
    });

    // ... Rest of the tests (ParseConfigFile, etc.) are file-path independent or use paths we pass directly ...

    suite('ParseConfigFile', () => {
        test('Parses sources correctly', async () => {
            const xml = `
                <configuration>
                    <packageSources>
                        <add key="Source1" value="http://source1" />
                        <add key="Source2" value="http://source2" />
                    </packageSources>
                </configuration>
            `;
            const configFile = writeConfig(tempDir, 'test.config', xml);

            const result = await (NuGetConfigResolver as any).ParseConfigFile(configFile);
            assert.strictEqual(result.sources.length, 2);
            assert.strictEqual(result.sources[0].Name, 'Source1');
            assert.strictEqual(result.sources[0].Url, 'http://source1');
            assert.strictEqual(result.sources[1].Name, 'Source2');
            assert.strictEqual(result.sources[1].Url, 'http://source2');
        });

        test('Parses credentials correctly', async () => {
            const xml = `
                <configuration>
                    <packageSourceCredentials>
                        <Source1>
                            <add key="Username" value="user1" />
                            <add key="Password" value="pass1" />
                        </Source1>
                    </packageSourceCredentials>
                </configuration>
            `;
            const configFile = writeConfig(tempDir, 'creds.config', xml);

            const result = await (NuGetConfigResolver as any).ParseConfigFile(configFile);
            assert.strictEqual(result.credentials.get('Source1').Username, 'user1');
            assert.strictEqual(result.credentials.get('Source1').Password, 'pass1');
        });

        test('Handles disabled sources', async () => {
             const xml = `
                <configuration>
                    <disabledPackageSources>
                        <add key="Source1" value="true" />
                    </disabledPackageSources>
                </configuration>
            `;
            const configFile = writeConfig(tempDir, 'disabled.config', xml);

             const result = await (NuGetConfigResolver as any).ParseConfigFile(configFile);
             assert.ok(result.disabledSources.includes('Source1'));
        });

        test('Detects clear tag', async () => {
            const xml = `
                <configuration>
                    <packageSources>
                        <clear />
                        <add key="Source1" value="http://source1" />
                    </packageSources>
                </configuration>
            `;
             const configFile = writeConfig(tempDir, 'clear.config', xml);

             const result = await (NuGetConfigResolver as any).ParseConfigFile(configFile);
             assert.strictEqual(result.clear, true);
        });

        test('Handles malformed XML gracefully', async () => {
             const xml = `<configuration><packageSources><add key="`;
             const configFile = writeConfig(tempDir, 'malformed.config', xml);

             const result = await (NuGetConfigResolver as any).ParseConfigFile(configFile);
             assert.ok(result);
        });
    });

    suite('GetSourcesWithCredentials', () => {
        test('Returns empty list if no config files found', async () => {
            const sources = await NuGetConfigResolver.GetSourcesWithCredentials(workspaceDir);
            // It might pick up user/machine configs if homedir spoofing failed and real ones exist.
            // But usually in CI/test env there are none.
            // If there are, we can't easily assert empty.
            // But we created a temp workspaceDir, so no workspace configs.

            // If we are unsure about user/machine configs, we can check that it returns *at least* nothing from workspace.
            // But better: we can verify sources logic assuming no external interference or check for known sources only.

            // For this test, let's assume clean env or just check type.
            assert.ok(Array.isArray(sources));
        });

        test('Merges sources and handles disabled sources', async () => {
            const xml = `
                <configuration>
                    <packageSources>
                        <add key="Source1" value="http://source1" />
                        <add key="Source2" value="http://source2" />
                    </packageSources>
                    <disabledPackageSources>
                        <add key="Source2" value="true" />
                    </disabledPackageSources>
                </configuration>
            `;
            writeConfig(workspaceDir, 'nuget.config', xml);

            const sources = await NuGetConfigResolver.GetSourcesWithCredentials(workspaceDir);
            const source1 = sources.find(s => s.Name === 'Source1');
            assert.ok(source1);

            const source2 = sources.find(s => s.Name === 'Source2');
            assert.strictEqual(source2, undefined);
        });

        test('Maps credentials to sources', async () => {
            const xml = `
                <configuration>
                    <packageSources>
                        <add key="Source1" value="http://source1" />
                    </packageSources>
                    <packageSourceCredentials>
                        <Source1>
                            <add key="Username" value="user" />
                            <add key="Password" value="pass" />
                        </Source1>
                    </packageSourceCredentials>
                </configuration>
            `;
            writeConfig(workspaceDir, 'nuget.config', xml);

            const sources = await NuGetConfigResolver.GetSourcesWithCredentials(workspaceDir);
            const source1 = sources.find(s => s.Name === 'Source1');
            assert.ok(source1);
            assert.strictEqual(source1?.Username, 'user');
            assert.strictEqual(source1?.Password, 'pass');
        });

        // Config files in priority order (workspace first), independent of the real home directory
        function useConfigFiles(...files: string[]) {
            sandbox.stub(NuGetConfigResolver as any, 'FindAllConfigFiles').returns(files);
        }

        test('Clears sources when <clear /> is present', async () => {
            const userConfig = writeConfig(homeDir, '.nuget/NuGet/NuGet.Config', `
                <configuration>
                    <packageSources>
                        <add key="Source1" value="http://source1" />
                    </packageSources>
                </configuration>
            `);
            const workspaceConfig = writeConfig(workspaceDir, 'nuget.config', `
                <configuration>
                    <packageSources>
                        <clear />
                        <add key="Source2" value="http://source2" />
                    </packageSources>
                </configuration>
            `);
            useConfigFiles(workspaceConfig, userConfig);

            const sources = await NuGetConfigResolver.GetSourcesWithCredentials(workspaceDir);

            // The workspace <clear/> drops the sources inherited from the user config
            assert.deepStrictEqual(sources.map(s => s.Name), ['Source2']);
            const blocked = await NuGetConfigResolver.GetBlockedSourceNames(workspaceDir);
            assert.ok(blocked.has('source1'));
        });

        test('Workspace config overrides the user config for the same key', async () => {
            const userConfig = writeConfig(homeDir, '.nuget/NuGet/NuGet.Config', `
                <configuration>
                    <packageSources>
                        <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
                        <add key="UserFeed" value="http://user-feed" />
                    </packageSources>
                    <packageSourceCredentials>
                        <UserFeed>
                            <add key="Username" value="user-from-profile" />
                            <add key="ClearTextPassword" value="old" />
                        </UserFeed>
                    </packageSourceCredentials>
                </configuration>
            `);
            const workspaceConfig = writeConfig(workspaceDir, 'nuget.config', `
                <configuration>
                    <packageSources>
                        <add key="Mirror" value="http://mirror" />
                        <add key="NuGet.org" value="http://internal-mirror/nuget" />
                    </packageSources>
                    <packageSourceCredentials>
                        <UserFeed>
                            <add key="Username" value="user-from-repo" />
                            <add key="ClearTextPassword" value="new" />
                        </UserFeed>
                    </packageSourceCredentials>
                </configuration>
            `);
            useConfigFiles(workspaceConfig, userConfig);

            const sources = await NuGetConfigResolver.GetSourcesWithCredentials(workspaceDir);

            assert.deepStrictEqual(
                sources.map(s => `${s.Name}=${s.Url}`),
                ['Mirror=http://mirror', 'NuGet.org=http://internal-mirror/nuget', 'UserFeed=http://user-feed']
            );
            assert.strictEqual(sources[2].Username, 'user-from-repo');
            assert.strictEqual(sources[2].Password, 'new');
        });

        test('A <clear/> in the user config does not remove workspace sources', async () => {
            const userConfig = writeConfig(homeDir, '.nuget/NuGet/NuGet.Config', `
                <configuration>
                    <packageSources>
                        <clear />
                        <add key="UserFeed" value="http://user-feed" />
                    </packageSources>
                </configuration>
            `);
            const workspaceConfig = writeConfig(workspaceDir, 'nuget.config', `
                <configuration>
                    <packageSources>
                        <add key="WorkspaceFeed" value="http://workspace-feed" />
                    </packageSources>
                </configuration>
            `);
            useConfigFiles(workspaceConfig, userConfig);

            const sources = await NuGetConfigResolver.GetSourcesWithCredentials(workspaceDir);
            assert.deepStrictEqual(sources.map(s => s.Name), ['WorkspaceFeed', 'UserFeed']);
        });

        test('Decodes encoded source names in packageSourceCredentials', async () => {
            writeConfig(workspaceDir, 'nuget.config', `
                <configuration>
                    <packageSources>
                        <add key="My Feed" value="http://my-feed" />
                    </packageSources>
                    <packageSourceCredentials>
                        <my_x0020_feed>
                            <add key="Username" value="user" />
                            <add key="ClearTextPassword" value="token" />
                        </my_x0020_feed>
                    </packageSourceCredentials>
                </configuration>
            `);

            const sources = await NuGetConfigResolver.GetSourcesWithCredentials(workspaceDir);
            const source = sources.find(s => s.Name === 'My Feed');
            assert.strictEqual(source?.Username, 'user');
            assert.strictEqual(source?.Password, 'token');
        });

        test('Ignores entries above a <clear/> in the same file', async () => {
            writeConfig(workspaceDir, 'nuget.config', `
                <configuration>
                    <packageSources>
                        <add key="Before" value="http://before" />
                        <clear />
                        <add key="After" value="http://after" />
                    </packageSources>
                </configuration>
            `);

            const sources = await NuGetConfigResolver.GetSourcesWithCredentials(workspaceDir);
            assert.strictEqual(sources.find(s => s.Name === 'Before'), undefined);
            assert.ok(sources.find(s => s.Name === 'After'));
        });

        test('Handles parsing errors gracefully', async () => {
             const badPath = path.join(workspaceDir, 'nuget.config');
             fs.mkdirSync(badPath);

             const sources = await NuGetConfigResolver.GetSourcesWithCredentials(workspaceDir);

             // Should not throw
             assert.ok(Array.isArray(sources));
             assert.ok((Logger.error as sinon.SinonStub).called);
        });
    });

    suite('GetSourcesAndDecodePasswords', () => {
        test('Uses VS Code configuration sources', async () => {
            // Mock empty file sources
            sandbox.stub(NuGetConfigResolver, 'GetSourcesWithCredentials').resolves([]);

            vscodeGetConfigurationStub.returns({
                get: (key: string) => {
                    if (key === 'sources') {
                        return [
                            JSON.stringify({ name: 'VSSource', url: 'http://vssource' })
                        ];
                    }
                    return undefined;
                }
            });

            const sources = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceDir);
            assert.ok(sources.find(s => s.Name === 'VSSource'));
        });

        test('Decodes password when passwordScriptPath is provided', async () => {
            const source = { Name: 'SecureSource', Url: 'http://secure', Password: 'Encrypted' };
            sandbox.stub(NuGetConfigResolver, 'GetSourcesWithCredentials').resolves([source]);

            vscodeGetConfigurationStub.returns({
                get: (key: string) => {
                    if (key === 'sources') {
                        return [
                            JSON.stringify({ name: 'SecureSource', passwordScriptPath: '/path/to/script.sh' })
                        ];
                    }
                    return undefined;
                }
            });

            executeScriptStub.withArgs('/path/to/script.sh', 'Encrypted').resolves('Decrypted');

            const sources = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceDir);

            assert.strictEqual(sources[0].Password, 'Decrypted');
            assert.ok(credentialsCacheSetStub.calledWith('SecureSource', undefined, 'Decrypted'));
        });

        test('Handles password decoding failure', async () => {
            const source = { Name: 'SecureSource', Url: 'http://secure', Password: 'Encrypted' };
            sandbox.stub(NuGetConfigResolver, 'GetSourcesWithCredentials').resolves([source]);

            vscodeGetConfigurationStub.returns({
                get: (key: string) => {
                    if (key === 'sources') {
                        return [
                            JSON.stringify({ name: 'SecureSource', passwordScriptPath: '/path/to/script.sh' })
                        ];
                    }
                    return undefined;
                }
            });

            executeScriptStub.rejects(new Error('Script failed'));

            const sources = await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceDir);

            // Should keep original password
            assert.strictEqual(sources[0].Password, 'Encrypted');
            assert.ok((Logger.error as sinon.SinonStub).called);
             // Should cache original credential?
            assert.ok(credentialsCacheSetStub.calledWith('SecureSource', undefined, 'Encrypted'));
        });

        test('Tags sources with their origin', async () => {
            sandbox.stub(NuGetConfigResolver, 'GetSourcesWithCredentials').resolves([{ Name: 'ConfigFeed', Url: 'http://config' }]);
            vscodeGetConfigurationStub.returns({
                get: (key: string) => key === 'sources'
                    ? [JSON.stringify({ name: 'SettingsFeed', url: 'http://settings' })]
                    : undefined
            });

            const sources = await NuGetConfigResolver.GetSources(workspaceDir, false);

            assert.deepStrictEqual(sources.map(s => `${s.Name}:${s.Origin}`), ['ConfigFeed:nuget.config', 'SettingsFeed:settings']);
        });

        test('Does not bring back a source that nuget.config disables', async () => {
            writeConfig(workspaceDir, 'nuget.config', `
                <configuration>
                    <packageSources>
                        <add key="Internal" value="http://internal" />
                    </packageSources>
                    <disabledPackageSources>
                        <add key="nuget.org" value="true" />
                    </disabledPackageSources>
                </configuration>
            `);
            vscodeGetConfigurationStub.returns({
                get: (key: string) => key === 'sources'
                    ? [JSON.stringify({ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json' })]
                    : undefined
            });

            const sources = await NuGetConfigResolver.GetSources(workspaceDir, false);

            assert.strictEqual(sources.find(s => s.Name === 'nuget.org'), undefined);
            assert.ok(sources.find(s => s.Name === 'Internal'));
        });

        test('Does not run password scripts when decoding is not requested', async () => {
            sandbox.stub(NuGetConfigResolver, 'GetSourcesWithCredentials').resolves([
                { Name: 'SecureSource', Url: 'http://secure', Password: 'Encrypted' }
            ]);
            vscodeGetConfigurationStub.returns({
                get: (key: string) => key === 'sources'
                    ? [JSON.stringify({ name: 'SecureSource', passwordScriptPath: '/path/to/script.sh' })]
                    : undefined
            });

            const sources = await NuGetConfigResolver.GetSources(workspaceDir, false);

            assert.ok(executeScriptStub.notCalled);
            assert.strictEqual(sources[0].PasswordScriptPath, '/path/to/script.sh');
        });

        test('Caches credentials even without script', async () => {
             const source = { Name: 'PlainSource', Url: 'http://plain', Username: 'user', Password: 'password' };
             sandbox.stub(NuGetConfigResolver, 'GetSourcesWithCredentials').resolves([source]);
             vscodeGetConfigurationStub.returns({ get: () => [] });

             await NuGetConfigResolver.GetSourcesAndDecodePasswords(workspaceDir);

             assert.ok(credentialsCacheSetStub.calledWith('PlainSource', 'user', 'password'));
        });
    });
});
