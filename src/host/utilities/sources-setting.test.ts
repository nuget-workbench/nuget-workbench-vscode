import * as assert from 'assert';
import { buildSourcesSetting } from './sources-setting';

suite('buildSourcesSetting', () => {
    const parse = (entries: string[]) => entries.map((e) => JSON.parse(e));

    test('keeps sources that come from the setting', () => {
        const result = buildSourcesSetting(
            [{ Name: 'Mine', Url: 'https://mine/v3/index.json', Origin: 'settings' }],
            [],
            new Set()
        );
        assert.deepStrictEqual(parse(result), [{ name: 'Mine', url: 'https://mine/v3/index.json' }]);
    });

    test('does not copy nuget.config sources into the global setting', () => {
        const result = buildSourcesSetting(
            [
                { Name: 'CompanyFeed', Url: 'https://company/v3/index.json', Origin: 'nuget.config' },
                { Name: 'Mine', Url: 'https://mine', Origin: 'settings' },
            ],
            [],
            new Set()
        );
        assert.deepStrictEqual(parse(result), [{ name: 'Mine', url: 'https://mine' }]);
    });

    test('stores only the password script for a nuget.config source', () => {
        const result = buildSourcesSetting(
            [{ Name: 'CompanyFeed', Url: 'https://company', PasswordScriptPath: '/decode.sh', Origin: 'nuget.config' }],
            [],
            new Set()
        );
        assert.deepStrictEqual(parse(result), [{ name: 'CompanyFeed', passwordScriptPath: '/decode.sh' }]);
    });

    test('keeps the URL the user stored for a name that nuget.config also defines', () => {
        const result = buildSourcesSetting(
            [{ Name: 'nuget.org', Url: 'https://mirror', Origin: 'nuget.config' }],
            [JSON.stringify({ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json' })],
            new Set()
        );
        assert.deepStrictEqual(parse(result), [{ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json' }]);
    });

    test('keeps setting entries that this workspace hides', () => {
        const hidden = JSON.stringify({ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json' });
        const result = buildSourcesSetting([], [hidden], new Set(['nuget.org']));
        assert.deepStrictEqual(result, [hidden]);
    });

    test('drops removed and empty rows', () => {
        const result = buildSourcesSetting(
            [{ Name: '', Url: '' }, { Name: 'Kept', Url: 'https://kept' }],
            [JSON.stringify({ name: 'Removed', url: 'https://removed' })],
            new Set()
        );
        assert.deepStrictEqual(parse(result), [{ name: 'Kept', url: 'https://kept' }]);
    });
});
