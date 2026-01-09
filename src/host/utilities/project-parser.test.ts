import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ProjectParser from './project-parser';
import { Logger } from '../../common/logger';

suite('ProjectParser Tests', () => {
    let tmpDir: string;

    setup(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-gallery-test-'));
    });

    teardown(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('Parse returns project with packages for valid XML', () => {
        const projectPath = path.join(tmpDir, 'test.csproj');
        const xml = `
            <Project>
                <ItemGroup>
                    <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />
                    <PackageReference Include="Serilog" Version="2.10.0" />
                </ItemGroup>
            </Project>`;
        fs.writeFileSync(projectPath, xml);

        const project = ProjectParser.Parse(projectPath);

        assert.strictEqual(project.Packages.length, 2);
        assert.strictEqual(project.Packages[0].Id, 'Newtonsoft.Json');
        assert.strictEqual(project.Packages[0].Version, '13.0.1');
        assert.strictEqual(project.Packages[1].Id, 'Serilog');
        assert.strictEqual(project.Packages[1].Version, '2.10.0');
    });

    test('Parse handles CPM versions correctly', () => {
        const projectPath = path.join(tmpDir, 'cpm.csproj');
        const xml = `
            <Project>
                <ItemGroup>
                    <PackageReference Include="Newtonsoft.Json" />
                    <PackageReference Include="Serilog" Version="1.0.0" />
                </ItemGroup>
            </Project>`;
        fs.writeFileSync(projectPath, xml);

        const cpmVersions = new Map<string, string>();
        cpmVersions.set('Newtonsoft.Json', '13.0.3');

        const project = ProjectParser.Parse(projectPath, cpmVersions);

        assert.strictEqual(project.Packages.length, 2);
        assert.strictEqual(project.Packages[0].Id, 'Newtonsoft.Json');
        assert.strictEqual(project.Packages[0].Version, '13.0.3');

        assert.strictEqual(project.Packages[1].Id, 'Serilog');
        assert.strictEqual(project.Packages[1].Version, '1.0.0');
    });

    test('Parse logs warning for missing CPM version', () => {
        const projectPath = path.join(tmpDir, 'cpm_missing.csproj');
        const xml = `
            <Project>
                <ItemGroup>
                    <PackageReference Include="Missing.Package" />
                </ItemGroup>
            </Project>`;
        fs.writeFileSync(projectPath, xml);

        const cpmVersions = new Map<string, string>();
        // Map is empty

        // Spy on Logger.warn
        const originalWarn = Logger.warn;
        let warned = false;
        Logger.warn = (msg: string) => {
            if (msg.includes('CPM version not found')) {
                warned = true;
            }
        };

        try {
            const project = ProjectParser.Parse(projectPath, cpmVersions);
            assert.strictEqual(project.Packages.length, 1);
            assert.strictEqual(warned, true);
        } finally {
            Logger.warn = originalWarn;
        }
    });

    test('Parse throws error for invalid XML', () => {
        const projectPath = path.join(tmpDir, 'invalid.csproj');
        const content = 'Invalid Content';
        fs.writeFileSync(projectPath, content);

        // Spy on Logger.error
        const originalError = Logger.error;
        let errorLogged = false;
        Logger.error = (msg: string) => {
             errorLogged = true;
        };

        try {
            assert.throws(() => {
                ProjectParser.Parse(projectPath);
            });
            assert.strictEqual(errorLogged, true);
        } finally {
            Logger.error = originalError;
        }
    });

     test('Parse handles empty project', () => {
        const projectPath = path.join(tmpDir, 'empty.csproj');
        const xml = `<Project></Project>`;
        fs.writeFileSync(projectPath, xml);

        const project = ProjectParser.Parse(projectPath);
        assert.strictEqual(project.Packages.length, 0);
    });
});
