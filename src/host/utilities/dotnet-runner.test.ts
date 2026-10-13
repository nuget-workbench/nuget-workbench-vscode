import * as assert from 'assert';
import { extractDotnetErrors } from './dotnet-runner';

suite('extractDotnetErrors Tests', () => {
    test('keeps NuGet error lines without the project path', () => {
        const output = [
            '  Determining projects to restore...',
            '/repo/App/App.csproj : error NU1605: Detected package downgrade: Foo from 2.0.0 to 1.0.0. [/repo/App/App.csproj]',
            '  Failed to restore /repo/App/App.csproj (in 1.2 sec).',
        ].join('\n');

        assert.strictEqual(
            extractDotnetErrors(output),
            'error NU1605: Detected package downgrade: Foo from 2.0.0 to 1.0.0.'
        );
    });

    test('keeps plain "error:" lines and removes duplicates and ANSI colors', () => {
        const output = [
            '\x1b[31merror: Package \'Foo\' is incompatible with \'all\' frameworks in project \'/repo/App.csproj\'.\x1b[0m',
            'error: Package \'Foo\' is incompatible with \'all\' frameworks in project \'/repo/App.csproj\'.',
        ].join('\r\n');

        assert.strictEqual(
            extractDotnetErrors(output),
            'error: Package \'Foo\' is incompatible with \'all\' frameworks in project \'/repo/App.csproj\'.'
        );
    });

    test('falls back to the last lines when there is no error line', () => {
        const output = 'one\ntwo\nthree\nfour\n';

        assert.strictEqual(extractDotnetErrors(output), 'two three four');
    });

    test('limits the length', () => {
        const output = `error NU1101: ${'x'.repeat(1000)}`;

        const text = extractDotnetErrors(output, 100);

        assert.strictEqual(text.length, 100);
        assert.ok(text.endsWith('…'));
    });
});
