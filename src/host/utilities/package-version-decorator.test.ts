
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import { PackageVersionDecorator } from './package-version-decorator';
import nugetApiFactory from '../nuget/api-factory';
import NuGetConfigResolver from './nuget-config-resolver';
import { Logger } from '../../common/logger';

suite('PackageVersionDecorator Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let createTextEditorDecorationTypeStub: sinon.SinonStub;
    let getConfigurationStub: sinon.SinonStub;
    let loggerDebugStub: sinon.SinonStub;
    let loggerWarnStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;
    let getSourcesStub: sinon.SinonStub;
    let getSourceApiStub: sinon.SinonStub;
    let decorator: PackageVersionDecorator | undefined;
    let mockEditor: any;
    let mockDocument: any;
    let decorationType: any;
    let setDecorationsStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        decorator = undefined;
        
        // Mock Logger
        loggerDebugStub = sandbox.stub(Logger, 'debug');
        loggerWarnStub = sandbox.stub(Logger, 'warn');
        loggerErrorStub = sandbox.stub(Logger, 'error');

        // Mock vscode.window.createTextEditorDecorationType
        decorationType = { dispose: sandbox.stub() };
        createTextEditorDecorationTypeStub = sandbox.stub(vscode.window, 'createTextEditorDecorationType').returns(decorationType);

        // Mock vscode.workspace.getConfiguration
        const configMock = {
            get: sandbox.stub().returns(true),
            update: sandbox.stub(),
            has: sandbox.stub(),
            inspect: sandbox.stub()
        };
        getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(configMock as any);

        // Mock NuGetConfigResolver
        getSourcesStub = sandbox.stub(NuGetConfigResolver, 'GetSourcesAndDecodePasswords').resolves([
            { Name: 'nuget.org', Url: 'https://api.nuget.org/v3/index.json', Password: '' }
        ]);

        // Mock nugetApiFactory
        getSourceApiStub = sandbox.stub(nugetApiFactory, 'GetSourceApi');

        // Mock Editor and Document
        setDecorationsStub = sandbox.stub();
        mockDocument = {
            fileName: 'c:\\test\\MyProject.csproj',
            isClosed: false,
            getText: sandbox.stub().returns(''),
            positionAt: sandbox.stub().returns(new vscode.Position(0, 0))
        };
        mockEditor = {
            document: mockDocument,
            setDecorations: setDecorationsStub
        };

        // Stub activeTextEditor to be our mock
        // We can't easily stub the getter on vscode.window directly if it's read-only in the env, 
        // but typically in vscode-test environment we can often get away with stubbing or just relying on passing editor explicitly if possible.
        // However, the decorator constructor reads vscode.window.activeTextEditor.
        // Let's stub vscode.window properties if possible, or use `sandbox.stub(vscode.window, 'activeTextEditor').get(() => mockEditor)`
        // But activeTextEditor is a property.
        
        // Note: Stubbing activeTextEditor might fail if property descriptor is non-configurable.
        // Checking previous tests, we often just pass mocks to methods.
        // But the constructor calls `triggerUpdateDecorations(vscode.window.activeTextEditor)`.
    });

    teardown(() => {
        decorator?.dispose();
        sandbox.restore();
    });

    test('constructor initializes and respects configuration', () => {
        decorator = new PackageVersionDecorator();
        assert.ok(createTextEditorDecorationTypeStub.calledOnce);
        decorator.dispose();
    });

    test('updateDecorations does nothing if disabled', async () => {
        getConfigurationStub.returns({ get: () => false }); // Disable
        decorator = new PackageVersionDecorator();
        
        // Access private method via cast
        await (decorator as any).updateDecorations(mockEditor);

        assert.ok(setDecorationsStub.calledWith(decorationType, []));
    });

    test('updateDecorations ignores unsupported files', async () => {
        mockDocument.fileName = 'test.txt';
        decorator = new PackageVersionDecorator();
        await (decorator as any).updateDecorations(mockEditor);
        
        assert.ok(setDecorationsStub.notCalled);
    });

    test('updateDecorations parses packages and fetches versions', async () => {
        const xml = `
<Project>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="12.0.1" />
    <PackageVersion Include="Serilog" Version="2.0.0" />
  </ItemGroup>
</Project>`;
        mockDocument.getText.returns(xml);
        mockDocument.positionAt.callsFake((index: number) => {
            // Simple mock position
            return new vscode.Position(0, index); 
        });

        // Mock API response
        const mockApi = {
            GetPackageAsync: sandbox.stub().callsFake(async (id: string) => {
                if (id === 'Newtonsoft.Json') return { isError: false, data: { Version: '13.0.1' } };
                if (id === 'Serilog') return { isError: false, data: { Version: '2.0.0' } }; // Same version
                return { isError: true };
            })
        };
        getSourceApiStub.resolves(mockApi);

        decorator = new PackageVersionDecorator();
        await (decorator as any).updateDecorations(mockEditor);

        // Should have called setDecorations
        assert.ok(setDecorationsStub.calledOnce);
        
        // Check arguments
        const args = setDecorationsStub.firstCall.args;
        assert.strictEqual(args[0], decorationType);
        
        const decorations = args[1] as vscode.DecorationOptions[];
        // Only Newtonsoft.Json should be decorated (newer version)
        // Serilog matches, so no decoration.
        assert.strictEqual(decorations.length, 1);
        
        const deco = decorations[0];
        assert.strictEqual(deco.renderOptions?.after?.contentText, ' (Latest: 13.0.1)');
    });

    test('updateDecorations handles API errors gracefully', async () => {
        const xml = `<PackageReference Include="Error.Package" Version="1.0.0" />`;
        mockDocument.getText.returns(xml);
        
        const mockApi = {
            GetPackageAsync: sandbox.stub().resolves({ isError: true })
        };
        getSourceApiStub.resolves(mockApi);

        decorator = new PackageVersionDecorator();
        await (decorator as any).updateDecorations(mockEditor);

        assert.ok(setDecorationsStub.calledOnce); // Called with empty array or existing?
        // Wait, if packagesToFetch > 0, fetchAndDecorate is called.
        // Inside fetchAndDecorate, it sets decorations.
        // If API fails, decorations array is empty.
        // It should call setDecorations with empty array.
        
        assert.strictEqual(setDecorationsStub.firstCall.args[1].length, 0);
        assert.ok(loggerErrorStub.notCalled); // Should not log error for isError: true result (it's handled silently or logged?)
        // The code says: catch (e) { Logger.error ... }
        // But if result.isError is true, it just sets found=false.
        // Then loop finishes.
        // If !found, it adds to failedCache.
    });

    test('updateDecorations uses cache for failed packages', async () => {
         const xml = `<PackageReference Include="Failed.Package" Version="1.0.0" />`;
        mockDocument.getText.returns(xml);
        
        const mockApi = {
            GetPackageAsync: sandbox.stub().resolves({ isError: true })
        };
        getSourceApiStub.resolves(mockApi);

        decorator = new PackageVersionDecorator();
        
        // First run - fail
        await (decorator as any).updateDecorations(mockEditor);
        assert.ok(mockApi.GetPackageAsync.calledOnce);

        // Second run - should assume failed and not call API
        await (decorator as any).updateDecorations(mockEditor);
        assert.ok(mockApi.GetPackageAsync.calledOnce); // Still called once
    });

    test('updateDecorations handles multiple sources', async () => {
         const xml = `<PackageReference Include="Multi.Source" Version="1.0.0" />`;
        mockDocument.getText.returns(xml);
        
        getSourcesStub.resolves([
            { Name: 'Source1', Url: 'url1', Password: '' },
            { Name: 'Source2', Url: 'url2', Password: '' }
        ]);

        const api1 = { GetPackageAsync: sandbox.stub().resolves({ isError: true }) };
        const api2 = { GetPackageAsync: sandbox.stub().resolves({ isError: false, data: { Version: '1.1.0' } }) };

        getSourceApiStub.withArgs('url1').resolves(api1);
        getSourceApiStub.withArgs('url2').resolves(api2);

        decorator = new PackageVersionDecorator();
        await (decorator as any).updateDecorations(mockEditor);

        assert.ok(api1.GetPackageAsync.called);
        assert.ok(api2.GetPackageAsync.called);

        const decorations = setDecorationsStub.firstCall.args[1];
        assert.strictEqual(decorations.length, 1);
        assert.strictEqual(decorations[0].renderOptions.after.contentText, ' (Latest: 1.1.0)');
    });
});
