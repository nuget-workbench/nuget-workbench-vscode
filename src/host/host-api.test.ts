import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createHostAPI } from './host-api';
import NuGetConfigResolver from './utilities/nuget-config-resolver';
import CpmResolver from './utilities/cpm-resolver';
import TaskExecutor from './utilities/task-executor';
import { Logger } from '../common/logger';

suite('HostAPI Tests', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(Logger, 'info');
        sandbox.stub(Logger, 'debug');
        sandbox.stub(Logger, 'error');
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('updateConfiguration', () => {
        const current: Record<string, unknown> = {
            skipRestore: false,
            enablePackageVersionInlineInfo: false,
            prerelease: false,
            statusBarLoadingIndicator: false,
            sources: [JSON.stringify({ name: 'Mine', url: 'https://mine/v3/index.json' })],
        };
        let updateStub: sinon.SinonStub;
        let workspaceValues: Record<string, unknown>;

        setup(() => {
            workspaceValues = {};
            updateStub = sandbox.stub().resolves();
            sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: (key: string) => (key in workspaceValues ? workspaceValues[key] : current[key]),
                inspect: (key: string) => ({ key, workspaceValue: workspaceValues[key] }),
                update: updateStub,
            } as any);
            sandbox.stub(NuGetConfigResolver, 'GetWorkspaceHiddenSourceNames').resolves(new Set());
        });

        function request(overrides: Partial<Configuration>) {
            return {
                Configuration: {
                    SkipRestore: false,
                    EnablePackageVersionInlineInfo: false,
                    Prerelease: false,
                    StatusBarLoadingIndicator: false,
                    Sources: [{ Name: 'Mine', Url: 'https://mine/v3/index.json', Origin: 'settings' as const }],
                    ...overrides,
                } as Configuration,
            };
        }

        test('writes only the settings that changed', async () => {
            await createHostAPI().updateConfiguration(request({ Prerelease: true }));

            assert.strictEqual(updateStub.callCount, 1);
            assert.deepStrictEqual(updateStub.firstCall.args, ['prerelease', true, vscode.ConfigurationTarget.Global]);
        });

        test('writes to the workspace when the workspace defines the setting', async () => {
            workspaceValues.skipRestore = true;

            await createHostAPI().updateConfiguration(request({ SkipRestore: false }));

            assert.deepStrictEqual(updateStub.firstCall.args, ['skipRestore', false, vscode.ConfigurationTarget.Workspace]);
        });

        test('does not copy workspace values into the user settings', async () => {
            workspaceValues.skipRestore = true;

            await createHostAPI().updateConfiguration(request({ SkipRestore: true, Prerelease: true }));

            assert.ok(updateStub.neverCalledWith('skipRestore', sinon.match.any, sinon.match.any));
        });
    });

    suite('batchUpdatePackages', () => {
        test('passes a feed that only the extension knows to dotnet', async () => {
            sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: () => false } as any);
            sandbox.stub(CpmResolver, 'GetPackageVersions').resolves(null);
            sandbox.stub(NuGetConfigResolver, 'GetSourcesWithCredentials').resolves([
                { Name: 'nuget.org', Url: 'https://api.nuget.org/v3/index.json' },
            ]);
            const runStub = sandbox.stub(TaskExecutor, 'ExecuteDotnet').resolves();

            const result = await createHostAPI().batchUpdatePackages({
                Updates: [{
                    PackageId: 'Company.Lib',
                    Version: '2.0.0',
                    ProjectPaths: ['/repo/App/App.csproj'],
                    SourceUrl: 'https://settings-only/v3/index.json',
                }],
            });

            assert.ok(result.ok && result.value.Results[0].Success);
            const args: string[] = runStub.firstCall.args[1];
            assert.deepStrictEqual(args.slice(0, 6), ['add', '/repo/App/App.csproj', 'package', 'Company.Lib', '--version', '2.0.0']);
            assert.deepStrictEqual(args.slice(6), [
                '-s', 'https://settings-only/v3/index.json',
                '-s', 'https://api.nuget.org/v3/index.json',
            ]);
        });
    });
});
