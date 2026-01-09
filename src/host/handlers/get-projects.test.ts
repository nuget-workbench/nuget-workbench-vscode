import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { GetProjects } from './get-projects';
import CpmResolver from '../utilities/cpm-resolver';
import ProjectParser from '../utilities/project-parser';
import { Logger } from '../../common/logger';

suite('GetProjects Handler Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: GetProjects;
    let findFilesStub: sinon.SinonStub;
    let cpmClearCacheStub: sinon.SinonStub;
    let cpmGetVersionsStub: sinon.SinonStub;
    let projectParserStub: sinon.SinonStub;

    const createMockProject = (name: string, path: string): Project => ({
        Name: name,
        Path: path,
        Packages: []
    });

    setup(() => {
        sandbox = sinon.createSandbox();
        handler = new GetProjects();

        // Mock Logger
        sandbox.stub(Logger, 'info');
        sandbox.stub(Logger, 'debug');
        sandbox.stub(Logger, 'error');

        // Mock CpmResolver
        cpmClearCacheStub = sandbox.stub(CpmResolver, 'ClearCache');
        cpmGetVersionsStub = sandbox.stub(CpmResolver, 'GetPackageVersions');

        // Mock ProjectParser
        projectParserStub = sandbox.stub(ProjectParser, 'Parse');

        // Mock vscode.workspace.findFiles
        findFilesStub = sandbox.stub(vscode.workspace, 'findFiles');
    });

    teardown(() => {
        sandbox.restore();
    });

    test('HandleAsync should find projects and return sorted list', async () => {
        const file1 = vscode.Uri.file('/path/to/ProjectA.csproj');
        const file2 = vscode.Uri.file('/path/to/ProjectB.csproj');

        findFilesStub.resolves([file2, file1]); // Return unsorted to test sorting

        const projectA = createMockProject('ProjectA', file1.fsPath);
        const projectB = createMockProject('ProjectB', file2.fsPath);

        cpmGetVersionsStub.returns(null);
        projectParserStub.withArgs(file1.fsPath, null).returns(projectA);
        projectParserStub.withArgs(file2.fsPath, null).returns(projectB);

        const request: GetProjectsRequest = { ForceReload: false };
        const response = await handler.HandleAsync(request);

        assert.ok(findFilesStub.calledWith("**/*.{csproj,fsproj,vbproj}", "**/node_modules/**"));
        assert.strictEqual(response.Projects.length, 2);
        assert.strictEqual(response.Projects[0].Name, 'ProjectA'); // Should be sorted
        assert.strictEqual(response.Projects[1].Name, 'ProjectB');
    });

    test('HandleAsync should clear CPM cache if ForceReload is true', async () => {
        findFilesStub.resolves([]);
        const request: GetProjectsRequest = { ForceReload: true };
        await handler.HandleAsync(request);

        assert.ok(cpmClearCacheStub.calledOnce);
    });

    test('HandleAsync should NOT clear CPM cache if ForceReload is false', async () => {
        findFilesStub.resolves([]);
        const request: GetProjectsRequest = { ForceReload: false };
        await handler.HandleAsync(request);

        assert.ok(cpmClearCacheStub.notCalled);
    });

    test('HandleAsync should handle CPM enabled projects', async () => {
        const file = vscode.Uri.file('/path/to/Project.csproj');
        findFilesStub.resolves([file]);

        const cpmVersions = new Map<string, string>();
        cpmVersions.set('PackageA', '1.0.0');
        cpmGetVersionsStub.returns(cpmVersions);

        const project = createMockProject('Project', file.fsPath);
        projectParserStub.withArgs(file.fsPath, cpmVersions).returns(project);

        const request: GetProjectsRequest = {};
        await handler.HandleAsync(request);

        assert.ok(projectParserStub.calledWith(file.fsPath, cpmVersions));
        // Verify debug log for CPM enabled
        assert.ok((Logger.debug as sinon.SinonStub).calledWithMatch(/CPM enabled for .* with 1 versions/));
    });

    test('HandleAsync should log debug message when CPM is not enabled', async () => {
        const file = vscode.Uri.file('/path/to/Project.csproj');
        findFilesStub.resolves([file]);

        cpmGetVersionsStub.returns(null);
        projectParserStub.returns(createMockProject('Project', file.fsPath));

        const request: GetProjectsRequest = {};
        await handler.HandleAsync(request);

        // Verify debug log for CPM disabled
        assert.ok((Logger.debug as sinon.SinonStub).calledWithMatch(/CPM not enabled/));
    });

    test('HandleAsync should handle project parsing errors gracefully', async () => {
        const file1 = vscode.Uri.file('/path/to/Good.csproj');
        const file2 = vscode.Uri.file('/path/to/Bad.csproj');
        findFilesStub.resolves([file1, file2]);

        const projectGood = createMockProject('Good', file1.fsPath);
        projectParserStub.withArgs(file1.fsPath).returns(projectGood);
        projectParserStub.withArgs(file2.fsPath).throws(new Error('Parse error'));

        const request: GetProjectsRequest = {};
        const response = await handler.HandleAsync(request);

        assert.strictEqual(response.Projects.length, 1);
        assert.strictEqual(response.Projects[0].Name, 'Good');
        assert.ok((Logger.error as sinon.SinonStub).calledWithMatch(/Failed to parse project/, sinon.match.instanceOf(Error)));
    });

    test('HandleAsync should sort projects case-insensitively', async () => {
         const file1 = vscode.Uri.file('/path/to/b.csproj');
         const file2 = vscode.Uri.file('/path/to/A.csproj');
         const file3 = vscode.Uri.file('/path/to/c.csproj');

         findFilesStub.resolves([file1, file2, file3]);

         projectParserStub.withArgs(file1.fsPath).returns(createMockProject('b', file1.fsPath));
         projectParserStub.withArgs(file2.fsPath).returns(createMockProject('A', file2.fsPath));
         projectParserStub.withArgs(file3.fsPath).returns(createMockProject('c', file3.fsPath));

         const request: GetProjectsRequest = {};
         const response = await handler.HandleAsync(request);

         assert.strictEqual(response.Projects.length, 3);
         assert.strictEqual(response.Projects[0].Name, 'A');
         assert.strictEqual(response.Projects[1].Name, 'b');
         assert.strictEqual(response.Projects[2].Name, 'c');
    });

    test('HandleAsync should exclude node_modules', async () => {
        findFilesStub.resolves([]);
        const request: GetProjectsRequest = {};
        await handler.HandleAsync(request);

        assert.ok(findFilesStub.calledWith(sinon.match.any, "**/node_modules/**"));
    });
});
