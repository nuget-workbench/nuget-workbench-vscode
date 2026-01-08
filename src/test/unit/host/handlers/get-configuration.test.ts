import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import GetConfiguration from '../../../../host/handlers/get-configuration';
import NuGetConfigResolver from '../../../../host/utilities/nuget-config-resolver';
import { Logger } from '../../../../common/logger';

suite('GetConfiguration Handler Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: GetConfiguration;
    let getConfigurationStub: sinon.SinonStub;
    let getSourcesStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        handler = new GetConfiguration();

        // Mock Logger
        sandbox.stub(Logger, 'debug');
        sandbox.stub(Logger, 'info');
        sandbox.stub(Logger, 'error');
        sandbox.stub(Logger, 'warn');

        // Mock NuGetConfigResolver
        getSourcesStub = sandbox.stub(NuGetConfigResolver, 'GetSourcesAndDecodePasswords');

        // Mock vscode.workspace.workspaceFolders
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: { fsPath: '/workspace/root' }, name: 'root', index: 0 }
        ]);
    });

    teardown(() => {
        sandbox.restore();
    });

    function createConfigMock(overrides: {
        skipRestore?: boolean;
        enablePackageVersionInlineInfo?: boolean;
        statusBarLoadingIndicator?: boolean;
        sources?: string[];
    } = {}) {
        const config = {
            get: sandbox.stub().callsFake((key: string) => {
                switch (key) {
                    case 'skipRestore': return overrides.skipRestore ?? false;
                    case 'enablePackageVersionInlineInfo': return overrides.enablePackageVersionInlineInfo ?? false;
                    case 'statusBarLoadingIndicator': return overrides.statusBarLoadingIndicator ?? false;
                    case 'sources': return overrides.sources ?? [];
                    default: return undefined;
                }
            }),
            update: sandbox.stub().resolves(),
            has: sandbox.stub(),
            inspect: sandbox.stub()
        };
        return config;
    }

    suite('Basic Configuration Retrieval', () => {
        test('should return default configuration when no settings are set', async () => {
            const configMock = createConfigMock();
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([]);

            const result = await handler.HandleAsync({});

            assert.strictEqual(result.Configuration.SkipRestore, false);
            assert.strictEqual(result.Configuration.EnablePackageVersionInlineInfo, false);
            assert.strictEqual(result.Configuration.StatusBarLoadingIndicator, false);
            assert.deepStrictEqual(result.Configuration.Sources, []);
        });

        test('should return configured settings', async () => {
            const configMock = createConfigMock({
                skipRestore: true,
                enablePackageVersionInlineInfo: true,
                statusBarLoadingIndicator: true
            });
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([]);

            const result = await handler.HandleAsync({});

            assert.strictEqual(result.Configuration.SkipRestore, true);
            assert.strictEqual(result.Configuration.EnablePackageVersionInlineInfo, true);
            assert.strictEqual(result.Configuration.StatusBarLoadingIndicator, true);
        });

        test('should log info message when retrieving configuration', async () => {
            const configMock = createConfigMock();
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([]);

            await handler.HandleAsync({});

            assert.ok((Logger.info as sinon.SinonStub).calledWith('GetConfiguration.HandleAsync: Retrieving configuration'));
        });
    });

    suite('Source Configuration', () => {
        test('should return sources from NuGetConfigResolver', async () => {
            const configMock = createConfigMock();
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([
                { Name: 'nuget.org', Url: 'https://api.nuget.org/v3/index.json', Password: 'secret' },
                { Name: 'Private Feed', Url: 'https://private.nuget.org/v3/index.json', Username: 'user', Password: 'pass' }
            ]);

            const result = await handler.HandleAsync({});

            assert.strictEqual(result.Configuration.Sources.length, 2);
            assert.strictEqual(result.Configuration.Sources[0].Name, 'nuget.org');
            assert.strictEqual(result.Configuration.Sources[0].Url, 'https://api.nuget.org/v3/index.json');
            assert.strictEqual(result.Configuration.Sources[1].Name, 'Private Feed');
            assert.strictEqual(result.Configuration.Sources[1].Url, 'https://private.nuget.org/v3/index.json');
        });

        test('should strip credentials from sources for security', async () => {
            const configMock = createConfigMock();
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([
                { Name: 'Secure Source', Url: 'https://secure.nuget.org/v3/index.json', Username: 'admin', Password: 'supersecret' }
            ]);

            const result = await handler.HandleAsync({});

            const source = result.Configuration.Sources[0];
            assert.strictEqual(source.Name, 'Secure Source');
            assert.strictEqual(source.Url, 'https://secure.nuget.org/v3/index.json');
            // Credentials should NOT be present
            assert.strictEqual((source as any).Username, undefined);
            assert.strictEqual((source as any).Password, undefined);
        });

        test('should add passwordScriptPath from VSCode settings to matching sources', async () => {
            const configMock = createConfigMock({
                sources: [
                    JSON.stringify({ name: 'Private Feed', passwordScriptPath: '/path/to/decrypt.ps1' })
                ]
            });
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([
                { Name: 'Private Feed', Url: 'https://private.nuget.org/v3/index.json', Password: 'encrypted' }
            ]);

            const result = await handler.HandleAsync({});

            assert.strictEqual(result.Configuration.Sources[0].PasswordScriptPath, '/path/to/decrypt.ps1');
        });

        test('should not add passwordScriptPath if source name does not match', async () => {
            const configMock = createConfigMock({
                sources: [
                    JSON.stringify({ name: 'Other Feed', passwordScriptPath: '/path/to/script.ps1' })
                ]
            });
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([
                { Name: 'Private Feed', Url: 'https://private.nuget.org/v3/index.json' }
            ]);

            const result = await handler.HandleAsync({});

            assert.strictEqual(result.Configuration.Sources[0].PasswordScriptPath, undefined);
        });

        test('should handle malformed source configuration JSON gracefully', async () => {
            const configMock = createConfigMock({
                sources: [
                    'not valid json',
                    '{"incomplete":',
                    JSON.stringify({ name: 'Valid Source', passwordScriptPath: '/valid/path.ps1' })
                ]
            });
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([
                { Name: 'Valid Source', Url: 'https://valid.nuget.org/v3/index.json' }
            ]);

            const result = await handler.HandleAsync({});

            // Should still work and log warnings for invalid entries
            assert.strictEqual(result.Configuration.Sources[0].PasswordScriptPath, '/valid/path.ps1');
            assert.ok((Logger.warn as sinon.SinonStub).called);
        });

        test('should handle source config without passwordScriptPath', async () => {
            const configMock = createConfigMock({
                sources: [
                    JSON.stringify({ name: 'My Source', url: 'https://my.nuget.org' })
                ]
            });
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([
                { Name: 'My Source', Url: 'https://my.nuget.org' }
            ]);

            const result = await handler.HandleAsync({});

            assert.strictEqual(result.Configuration.Sources[0].PasswordScriptPath, undefined);
        });
    });

    suite('Configuration Update Cleanup', () => {
        test('should attempt to clear workspace-level sources and skipRestore settings', async () => {
            const configMock = createConfigMock();
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([]);

            await handler.HandleAsync({});

            // Should call update to clear workspace settings
            assert.ok(configMock.update.calledWith('sources', undefined, vscode.ConfigurationTarget.Workspace));
            assert.ok(configMock.update.calledWith('skipRestore', undefined, vscode.ConfigurationTarget.Workspace));
        });

        test('should handle errors during configuration update gracefully', async () => {
            const configMock = createConfigMock();
            configMock.update.rejects(new Error('Update failed'));
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([]);

            // Should not throw
            const result = await handler.HandleAsync({});

            assert.ok(result.Configuration);
            assert.strictEqual(result.Configuration.SkipRestore, false);
        });
    });

    suite('Workspace Handling', () => {
        test('should pass workspace root to NuGetConfigResolver', async () => {
            const configMock = createConfigMock();
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([]);

            await handler.HandleAsync({});

            assert.ok(getSourcesStub.calledWith('/workspace/root'));
        });

        test('should handle undefined workspace folders', async () => {
            sandbox.restore();
            sandbox = sinon.createSandbox();

            // Re-stub everything
            sandbox.stub(Logger, 'debug');
            sandbox.stub(Logger, 'info');
            sandbox.stub(Logger, 'error');
            sandbox.stub(Logger, 'warn');

            getSourcesStub = sandbox.stub(NuGetConfigResolver, 'GetSourcesAndDecodePasswords');
            getSourcesStub.resolves([]);

            sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

            const configMock = createConfigMock();
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);

            const result = await handler.HandleAsync({});

            assert.ok(getSourcesStub.calledWith(undefined));
            assert.ok(result.Configuration);
        });

        test('should handle empty workspace folders array', async () => {
            sandbox.restore();
            sandbox = sinon.createSandbox();

            // Re-stub everything
            sandbox.stub(Logger, 'debug');
            sandbox.stub(Logger, 'info');
            sandbox.stub(Logger, 'error');
            sandbox.stub(Logger, 'warn');

            getSourcesStub = sandbox.stub(NuGetConfigResolver, 'GetSourcesAndDecodePasswords');
            getSourcesStub.resolves([]);

            sandbox.stub(vscode.workspace, 'workspaceFolders').value([]);

            const configMock = createConfigMock();
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);

            const result = await handler.HandleAsync({});

            assert.ok(getSourcesStub.calledWith(undefined));
            assert.ok(result.Configuration);
        });
    });

    suite('Multiple Sources', () => {
        test('should handle multiple sources with mixed passwordScriptPath settings', async () => {
            const configMock = createConfigMock({
                sources: [
                    JSON.stringify({ name: 'Source1', passwordScriptPath: '/path/to/script1.ps1' }),
                    JSON.stringify({ name: 'Source3', passwordScriptPath: '/path/to/script3.ps1' })
                ]
            });
            getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
            getSourcesStub.resolves([
                { Name: 'Source1', Url: 'https://source1.nuget.org' },
                { Name: 'Source2', Url: 'https://source2.nuget.org' },
                { Name: 'Source3', Url: 'https://source3.nuget.org' }
            ]);

            const result = await handler.HandleAsync({});

            assert.strictEqual(result.Configuration.Sources.length, 3);
            assert.strictEqual(result.Configuration.Sources[0].PasswordScriptPath, '/path/to/script1.ps1');
            assert.strictEqual(result.Configuration.Sources[1].PasswordScriptPath, undefined);
            assert.strictEqual(result.Configuration.Sources[2].PasswordScriptPath, '/path/to/script3.ps1');
        });
    });
});
