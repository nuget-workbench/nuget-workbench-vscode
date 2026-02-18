import '../web-setup'; // Must be first
import * as assert from 'assert';
import { SearchBar } from '@/web/components/search-bar';
import * as registrations from '@/web/registrations';
import { configuration } from '@/web/registrations';
import { ok } from '@/common/rpc/result';
import type { HostAPI } from '@/common/rpc/types';

suite('SearchBar Component', () => {
    let searchBar: SearchBar;
    let originalHostApi: HostAPI;

    let originalReload: typeof configuration.Reload;

    setup(() => {
        originalHostApi = registrations.hostApi;
        originalReload = configuration.Reload.bind(configuration);

        // Mock hostApi so prereleaseChangedEvent does not hang
        const mockHostApi = {
            updateConfiguration: () => Promise.resolve(ok(undefined)),
            getConfiguration: () => Promise.resolve(ok({
                Configuration: {
                    Prerelease: true,
                    SkipRestore: false,
                    EnablePackageVersionInlineInfo: false,
                    StatusBarLoadingIndicator: false,
                    Sources: [
                        { Name: 'NuGet.org', Url: 'https://api.nuget.org/v3/index.json' },
                        { Name: 'Local', Url: 'C:/LocalSource' }
                    ]
                }
            }))
        } as unknown as HostAPI;
        Object.defineProperty(registrations, 'hostApi', { value: mockHostApi, writable: true, configurable: true });

        // Mock configuration.Reload since its internal hostApi reference is not the mock
        configuration.Reload = () => Promise.resolve();

        // Set mock configuration via private field
        (configuration as any)['configuration'] = {
            Prerelease: true,
            SkipRestore: false,
            EnablePackageVersionInlineInfo: false,
            StatusBarLoadingIndicator: false,
            Sources: [
                { Name: 'NuGet.org', Url: 'https://api.nuget.org/v3/index.json' },
                { Name: 'Local', Url: 'C:/LocalSource' }
            ]
        };

        searchBar = new SearchBar();
        document.body.appendChild(searchBar);
    });

    teardown(() => {
        document.body.removeChild(searchBar);
        Object.defineProperty(registrations, 'hostApi', { value: originalHostApi, writable: true, configurable: true });
        configuration.Reload = originalReload;
    });

    test('should initialize with default values', () => {
        assert.strictEqual(searchBar.prerelease, true);
        assert.strictEqual(searchBar.filterQuery, "");
        assert.strictEqual(searchBar.selectedSourceUrl, "");
    });

    test('should emit filter-changed event on initialization', (done) => {
        const el = new SearchBar();

        el.addEventListener('filter-changed', (e: Event) => {
            const detail = (e as CustomEvent).detail;
            assert.deepStrictEqual(detail, {
                Query: "",
                Prerelease: true,
                SourceUrl: ""
            });
            done();
        });

        document.body.appendChild(el);
        document.body.removeChild(el);
    });

    test('typing in filter input should update filterQuery and emit event', async () => {
        await searchBar.updateComplete;

        let eventCalled = false;
        searchBar.addEventListener('filter-changed', (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail.Query === 'test-query') {
                eventCalled = true;
            }
        });

        // Find the input element in shadow DOM and simulate input
        const input = searchBar.shadowRoot?.querySelector('.search-input') as HTMLInputElement;
        assert.ok(input, 'Search input should exist');
        input.value = 'test-query';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        assert.strictEqual(searchBar.filterQuery, 'test-query');

        // Wait for debounce (500ms)
        await new Promise(resolve => setTimeout(resolve, 600));

        assert.strictEqual(eventCalled, true);
    });

    test('selecting a source should update selectedSourceUrl and emit event', async () => {
        await searchBar.updateComplete;

        const newSource = 'https://api.nuget.org/v3/index.json';

        const eventPromise = new Promise<void>((resolve) => {
            searchBar.addEventListener('filter-changed', (e: Event) => {
                const detail = (e as CustomEvent).detail;
                if (detail.SourceUrl === newSource) {
                    assert.strictEqual(searchBar.selectedSourceUrl, newSource);
                    resolve();
                }
            });
        });

        // Find the select element and change its value
        const select = searchBar.shadowRoot?.querySelector('select') as HTMLSelectElement;
        assert.ok(select, 'Source select should exist');
        select.value = newSource;
        select.dispatchEvent(new Event('change', { bubbles: true }));

        await eventPromise;
    });

    test('toggling prerelease checkbox should update prerelease and emit event', async () => {
        await searchBar.updateComplete;

        const eventPromise = new Promise<void>((resolve) => {
            searchBar.addEventListener('filter-changed', (e: Event) => {
                const detail = (e as CustomEvent).detail;
                if (detail.Prerelease === false) {
                    assert.strictEqual(searchBar.prerelease, false);
                    resolve();
                }
            });
        });

        // Find the checkbox and toggle it
        const checkbox = searchBar.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
        assert.ok(checkbox, 'Prerelease checkbox should exist');
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        await eventPromise;
    });

    test('clicking reload button should emit reload-invoked event', async () => {
        await searchBar.updateComplete;

        const eventPromise = new Promise<void>((resolve) => {
            searchBar.addEventListener('reload-invoked', (e: Event) => {
                const forceReload = (e as CustomEvent).detail;
                assert.strictEqual(forceReload, true);
                resolve();
            });
        });

        const reloadBtn = searchBar.shadowRoot?.querySelector('.icon-btn') as HTMLElement;
        assert.ok(reloadBtn, 'Reload button should exist');
        reloadBtn.click();

        await eventPromise;
    });

    test('should render sources in dropdown', async () => {
        await searchBar.updateComplete;

        const shadowRoot = searchBar.shadowRoot;
        assert.ok(shadowRoot, "Shadow root should exist");

        const select = shadowRoot.querySelector('select');
        assert.ok(select, "Select dropdown should exist");

        const options = select.querySelectorAll('option');
        // Expected: 1 (All) + 2 (Sources) = 3
        assert.strictEqual(options.length, 3);

        assert.strictEqual(options[0].value, "");
        assert.strictEqual(options[0].textContent?.trim(), "All");
        assert.strictEqual(options[1].value, "https://api.nuget.org/v3/index.json");
        assert.strictEqual(options[1].textContent?.trim(), "NuGet.org");
        assert.strictEqual(options[2].value, "C:/LocalSource");
        assert.strictEqual(options[2].textContent?.trim(), "Local");
    });
});
