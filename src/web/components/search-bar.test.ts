import '../web-setup'; // Must be first
import * as assert from 'assert';
import { SearchBar } from '@/web/components/search-bar';
import { Configuration } from '@/web/registrations';
import { DOM } from '@microsoft/fast-element';

suite('SearchBar Component', () => {
    let searchBar: SearchBar;
    let mockConfiguration: any;

    setup(() => {
        // Mock Configuration
        mockConfiguration = {
            Configuration: {
                Sources: [
                    { Name: 'NuGet.org', Url: 'https://api.nuget.org/v3/index.json' },
                    { Name: 'Local', Url: 'C:/LocalSource' }
                ]
            }
        };

        // Create instance
        searchBar = new SearchBar();
        // Since property injection happens via decorator which might not work in test env if DI container is not set up correctly,
        // we might need to manually set it.
        // However, the error "Cannot set property configuration of #<SearchBar> which has only a getter" implies
        // that the decorator replaced the property with a getter (probably resolving from DI), and we are trying to set it.
        // If it's a getter only, we need to mock the DI container.

        // Let's assume the @Configuration decorator uses DI.get(Configuration).
        // We can try to register the mock configuration in the DI container.
        // Or if we can't easily access DI, we can try Object.defineProperty to override it on the instance.

        Object.defineProperty(searchBar, 'configuration', {
            value: mockConfiguration,
            writable: true
        });

        // Append to document to trigger connectedCallback
        document.body.appendChild(searchBar);
    });

    teardown(() => {
        document.body.removeChild(searchBar);
    });

    test('should initialize with default values', () => {
        assert.strictEqual(searchBar.prerelase, true);
        assert.strictEqual(searchBar.filterQuery, "");
        assert.strictEqual(searchBar.selectedSourceUrl, "");
    });

    test('should emit filter-changed event on initialization', (done) => {
        // Since connectedCallback calls EmitFilterChangedEvent, we need to check if it was called.
        // But we are in setup already.
        // Let's create a new instance to test this.
        const el = new SearchBar();
        Object.defineProperty(el, 'configuration', {
            value: mockConfiguration,
            writable: true
        });

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

    test('FilterInputEvent should update filterQuery and emit event', async () => {
        // Mock lodash debounce to execute immediately or wait
        // In the component: delayedPackagesLoader = lodash.debounce(...)
        // Since we cannot easily mock lodash import inside the module without rewiring,
        // we will wait for the debounce time.
        // Or we can overwrite the property on the instance?
        // searchBar.delayedPackagesLoader is a property initialized in constructor.

        let eventCalled = false;
        searchBar.addEventListener('filter-changed', (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail.Query === 'test-query') {
                eventCalled = true;
            }
        });

        const input = document.createElement('input');
        input.value = 'test-query';

        searchBar.FilterInputEvent(input);

        assert.strictEqual(searchBar.filterQuery, 'test-query');

        // Wait for debounce (500ms)
        await new Promise(resolve => setTimeout(resolve, 600));

        assert.strictEqual(eventCalled, true);
    });

    test('SelectSource should update selectedSourceUrl and emit event', (done) => {
        const newSource = 'https://api.nuget.org/v3/index.json';

        searchBar.addEventListener('filter-changed', (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail.SourceUrl === newSource) {
                assert.strictEqual(searchBar.selectedSourceUrl, newSource);
                done();
            }
        });

        searchBar.SelectSource(newSource);
    });

    test('PrerelaseChangedEvent should update prerelase and emit event', (done) => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = false;

        searchBar.addEventListener('filter-changed', (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail.Prerelease === false) {
                assert.strictEqual(searchBar.prerelase, false);
                done();
            }
        });

        searchBar.PrerelaseChangedEvent(checkbox);
    });

    test('ReloadClicked should emit reload-invoked event', (done) => {
        searchBar.addEventListener('reload-invoked', (e: Event) => {
            const forceReload = (e as CustomEvent).detail;
            assert.strictEqual(forceReload, true);
            done();
        });

        searchBar.ReloadClicked();
    });

    test('should render sources in dropdown', async () => {
        // We need to wait for the template to render.
        // FAST updates are async.
        await DOM.nextUpdate();

        // Check if options are rendered.
        // Since we are mocking DOM, shadowRoot might be populated if FASTElement works correctly in JSDOM.
        const shadowRoot = searchBar.shadowRoot;
        assert.ok(shadowRoot, "Shadow root should exist");

        // Use querySelector to find the dropdown
        const dropdown = shadowRoot.querySelector('vscode-dropdown');
        assert.ok(dropdown, "Dropdown should exist");

        // The options are children of dropdown in the template:
        // <vscode-dropdown ...>
        //   <vscode-option ...>All</vscode-option>
        //   repeat(...)
        // </vscode-dropdown>

        // Note: In JSDOM with FAST, sometimes the repeat directive might not update the DOM immediately or correctly if not fully polyfilled,
        // but let's check.
        const options = dropdown.querySelectorAll('vscode-option');
        // Expected: 1 (All) + 2 (Sources) = 3
        assert.strictEqual(options.length, 3);

        // Use getAttribute for attributes
        // JSDOM might return null if empty string is not explicitly set?
        // Or if the binding uses :value which is a property binding, FAST reflects it to attribute?
        // FAST updates attributes for observed attributes.
        // Let's check currentValue if attribute fails.
        const val0 = options[0].getAttribute('value');
        if (val0 === null) {
            // It might be a property
            assert.strictEqual((options[0] as any).value, "");
        } else {
             assert.strictEqual(val0, "");
        }

        // Use textContent for content
        assert.strictEqual(options[0].textContent?.trim(), "All");

        // Similar check for other options
        const val1 = options[1].getAttribute('value');
        if (val1 === null) {
            assert.strictEqual((options[1] as any).value, "https://api.nuget.org/v3/index.json");
        } else {
            assert.strictEqual(val1, "https://api.nuget.org/v3/index.json");
        }
        assert.strictEqual(options[1].textContent?.trim(), "NuGet.org");

        const val2 = options[2].getAttribute('value');
        if (val2 === null) {
            assert.strictEqual((options[2] as any).value, "C:/LocalSource");
        } else {
             assert.strictEqual(val2, "C:/LocalSource");
        }
        assert.strictEqual(options[2].textContent?.trim(), "Local");
    });
});
