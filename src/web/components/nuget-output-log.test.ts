import '../web-setup';
import * as assert from 'assert';
import { NugetOutputLog } from '@/web/components/nuget-output-log';

suite('NugetOutputLog Component', () => {
    let log: NugetOutputLog;

    setup(() => {
        log = new NugetOutputLog();
        document.body.appendChild(log);
    });

    teardown(() => {
        document.body.removeChild(log);
    });

    test('expands when an error is added', () => {
        log.addEntry('Installing Foo...');
        assert.strictEqual(log.isExpanded, false);

        log.addEntry('App: dotnet exited with code 1', 'error');

        assert.strictEqual(log.isExpanded, true);
    });

    test('stays collapsed on errors when showOutputOnError is off', () => {
        log.expandOnError = false;

        log.addEntry('App: dotnet exited with code 1', 'error');

        assert.strictEqual(log.isExpanded, false);
        assert.strictEqual(log.entries.length, 1);
    });

    test('keeps only the latest entries', () => {
        for (let i = 0; i < 250; i++) log.addEntry(`entry ${i}`);

        assert.strictEqual(log.entries.length, 200);
        assert.strictEqual(log.entries[199].text, 'entry 249');
    });
});
