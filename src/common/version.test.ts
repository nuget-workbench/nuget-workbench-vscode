import * as assert from 'assert';
import { compareVersions, isNonConcreteVersion, isPrerelease, isVersionInRange } from './version';

suite('version utilities', () => {
    suite('compareVersions', () => {
        test('compares numeric parts numerically', () => {
            assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
            assert.ok(compareVersions('2.0.0', '10.0.0') < 0);
            assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
        });

        test('treats missing parts as zero (NuGet four-part versions)', () => {
            assert.strictEqual(compareVersions('1.0', '1.0.0'), 0);
            assert.strictEqual(compareVersions('1.0.0.0', '1.0.0'), 0);
            assert.ok(compareVersions('1.0.0.1', '1.0.0') > 0);
        });

        test('stable is greater than prerelease of the same version', () => {
            assert.ok(compareVersions('1.0.0', '1.0.0-beta') > 0);
            assert.ok(compareVersions('2.0.0-rc1', '2.0.0') < 0);
            assert.ok(compareVersions('1.0.1-alpha', '1.0.0') > 0);
        });

        test('compares prerelease labels per SemVer 2', () => {
            assert.ok(compareVersions('1.0.0-alpha', '1.0.0-beta') < 0);
            assert.ok(compareVersions('1.0.0-beta.2', '1.0.0-beta.11') < 0);
            assert.ok(compareVersions('1.0.0-alpha', '1.0.0-alpha.1') < 0);
            assert.ok(compareVersions('1.0.0-1', '1.0.0-alpha') < 0);
        });

        test('compares prerelease labels case-insensitively', () => {
            assert.strictEqual(compareVersions('1.0.0-Beta', '1.0.0-beta'), 0);
        });

        test('ignores build metadata', () => {
            assert.strictEqual(compareVersions('1.0.0+abc', '1.0.0+def'), 0);
            assert.strictEqual(compareVersions('1.0.0+build-1', '1.0.0'), 0);
        });

        test('handles exact-pin brackets', () => {
            assert.strictEqual(compareVersions('[1.2.3]', '1.2.3'), 0);
        });
    });

    test('isPrerelease ignores dashes in build metadata', () => {
        assert.strictEqual(isPrerelease('1.0.0-beta'), true);
        assert.strictEqual(isPrerelease('1.0.0+abc-def'), false);
        assert.strictEqual(isPrerelease('1.0.0'), false);
    });

    test('isNonConcreteVersion detects properties, floating versions and ranges', () => {
        assert.strictEqual(isNonConcreteVersion('$(SerilogVersion)'), true);
        assert.strictEqual(isNonConcreteVersion('1.*'), true);
        assert.strictEqual(isNonConcreteVersion('[1.0,2.0)'), true);
        assert.strictEqual(isNonConcreteVersion('[1.0.0]'), false);
        assert.strictEqual(isNonConcreteVersion('1.0.0'), false);
    });

    suite('isVersionInRange', () => {
        test('matches prereleases below an exclusive upper bound', () => {
            assert.strictEqual(isVersionInRange('1.0.0-beta', '(, 1.0.0)'), true);
            assert.strictEqual(isVersionInRange('1.0.0', '(, 1.0.0)'), false);
        });

        test('respects inclusive and exclusive bounds', () => {
            assert.strictEqual(isVersionInRange('1.0.0', '[1.0.0, 2.0.0)'), true);
            assert.strictEqual(isVersionInRange('2.0.0', '[1.0.0, 2.0.0)'), false);
            assert.strictEqual(isVersionInRange('2.0.0', '(1.0.0, 2.0.0]'), true);
            assert.strictEqual(isVersionInRange('1.0.0', '(1.0.0, 2.0.0]'), false);
        });

        test('matches exact ranges', () => {
            assert.strictEqual(isVersionInRange('1.2.3', '[1.2.3]'), true);
            assert.strictEqual(isVersionInRange('1.2.4', '[1.2.3]'), false);
        });
    });
});
