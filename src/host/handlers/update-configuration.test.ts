import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import UpdateConfiguration from './update-configuration';
import { Logger } from '../../common/logger';
import { UpdateConfigurationRequest } from '../../common/messaging/update-configuration';

suite('UpdateConfiguration Handler Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: UpdateConfiguration;
    let getConfigurationStub: sinon.SinonStub;
    let configUpdateStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        handler = new UpdateConfiguration();

        // Mock Logger
        sandbox.stub(Logger, 'info');

        // Mock vscode configuration
        configUpdateStub = sandbox.stub().resolves();
        const configMock = {
            update: configUpdateStub
        };
        getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should update configuration successfully', async () => {
        const request: UpdateConfigurationRequest = {
            Configuration: {
                SkipRestore: true,
                EnablePackageVersionInlineInfo: true,
                StatusBarLoadingIndicator: false,
                Sources: [
                    { Name: 'Source1', Url: 'http://source1.com' },
                    { Name: 'Source2', Url: 'http://source2.com', PasswordScriptPath: '/path/to/script' }
                ]
            }
        };

        await handler.HandleAsync(request);

        // Verify Logger was called
        assert.ok((Logger.info as sinon.SinonStub).calledWith('UpdateConfiguration.HandleAsync: Updating configuration'));
        assert.ok((Logger.info as sinon.SinonStub).calledWith('UpdateConfiguration.HandleAsync: Configuration updated successfully'));

        // Verify config.update calls
        assert.ok(configUpdateStub.calledWith('skipRestore', true, vscode.ConfigurationTarget.Global));
        assert.ok(configUpdateStub.calledWith('enablePackageVersionInlineInfo', true, vscode.ConfigurationTarget.Global));

        // Verify sources update
        const expectedSources = [
            JSON.stringify({ name: 'Source1', url: 'http://source1.com' }),
            JSON.stringify({ name: 'Source2', url: 'http://source2.com', passwordScriptPath: '/path/to/script' })
        ];
        assert.ok(configUpdateStub.calledWith('sources', expectedSources, vscode.ConfigurationTarget.Global));
    });

    test('should handle empty sources list', async () => {
        const request: UpdateConfigurationRequest = {
            Configuration: {
                SkipRestore: false,
                EnablePackageVersionInlineInfo: false,
                StatusBarLoadingIndicator: false,
                Sources: []
            }
        };

        await handler.HandleAsync(request);

        assert.ok(configUpdateStub.calledWith('skipRestore', false, vscode.ConfigurationTarget.Global));
        assert.ok(configUpdateStub.calledWith('enablePackageVersionInlineInfo', false, vscode.ConfigurationTarget.Global));
        assert.ok(configUpdateStub.calledWith('sources', [], vscode.ConfigurationTarget.Global));
    });

    test('should handle sources with missing optional properties', async () => {
        const request: UpdateConfigurationRequest = {
            Configuration: {
                SkipRestore: true,
                EnablePackageVersionInlineInfo: false,
                StatusBarLoadingIndicator: false,
                Sources: [
                    { Name: 'SimpleSource', Url: 'http://simple.com' } // No PasswordScriptPath
                ]
            }
        };

        await handler.HandleAsync(request);

        const expectedSources = [
            JSON.stringify({ name: 'SimpleSource', url: 'http://simple.com' })
        ];

        assert.ok(configUpdateStub.calledWith('sources', expectedSources, vscode.ConfigurationTarget.Global));

        // Verify that the object passed to JSON.stringify didn't have undefined properties
        // We can do this by checking the actual call argument
        const call = configUpdateStub.getCalls().find(c => c.args[0] === 'sources');
        assert.ok(call, 'Expected update call for "sources"');
        const sourcesArg = call!.args[1];
        const sourceObj = JSON.parse(sourcesArg[0]);
        assert.strictEqual(sourceObj.passwordScriptPath, undefined);
    });

    test('should propagate errors from update calls', async () => {
        const error = new Error('Update failed');
        configUpdateStub.rejects(error);

        const request: UpdateConfigurationRequest = {
            Configuration: {
                SkipRestore: false,
                EnablePackageVersionInlineInfo: false,
                StatusBarLoadingIndicator: false,
                Sources: []
            }
        };

        await assert.rejects(async () => {
            await handler.HandleAsync(request);
        }, error);
    });
});
