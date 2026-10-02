import '../web-setup';
import * as assert from 'assert';
import { CustomDropdown } from '@/web/components/dropdown';

suite('CustomDropdown Component', () => {
    let dropdown: CustomDropdown;

    setup(async () => {
        dropdown = new CustomDropdown();
        dropdown.options = [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
            { value: 'c', label: 'C' },
        ];
        dropdown.value = 'a';
        document.body.appendChild(dropdown);
        await dropdown.updateComplete;
    });

    teardown(() => {
        document.body.removeChild(dropdown);
    });

    const trigger = () => dropdown.shadowRoot!.querySelector('.dropdown-trigger') as HTMLButtonElement;
    const press = async (key: string) => {
        trigger().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await dropdown.updateComplete;
    };

    test('selects an option with the keyboard', async () => {
        let changed: string | undefined;
        dropdown.addEventListener('change', (e: Event) => { changed = (e as CustomEvent<string>).detail; });

        await press('ArrowDown'); // open, active = current value
        await press('ArrowDown'); // move to "b"
        await press('ArrowDown'); // move to "c"
        await press('Enter');

        assert.strictEqual(changed, 'c');
        assert.strictEqual(dropdown.value, 'c');
        assert.strictEqual(dropdown.shadowRoot!.querySelector('.dropdown-menu'), null, 'menu should close');
    });

    test('Home/End jump and aria-activedescendant follows the active option', async () => {
        await press('Enter');
        await press('End');
        const activeId = trigger().getAttribute('aria-activedescendant');
        const active = dropdown.shadowRoot!.getElementById(activeId!);
        assert.strictEqual(active?.textContent?.trim(), 'C');

        await press('Home');
        const homeId = trigger().getAttribute('aria-activedescendant');
        assert.strictEqual(dropdown.shadowRoot!.getElementById(homeId!)?.textContent?.trim(), 'A');
    });

    test('Escape closes without changing the value', async () => {
        await press('ArrowDown');
        await press('ArrowDown');
        await press('Escape');
        assert.strictEqual(dropdown.value, 'a');
        assert.strictEqual(dropdown.shadowRoot!.querySelector('.dropdown-menu'), null);
    });

    test('keeps the active option valid when the options shrink while open', async () => {
        await press('Enter');
        await press('End'); // active = "c"
        dropdown.options = [{ value: 'a', label: 'A' }];
        await dropdown.updateComplete;

        const activeId = trigger().getAttribute('aria-activedescendant');
        assert.strictEqual(dropdown.shadowRoot!.getElementById(activeId!)?.textContent?.trim(), 'A');
    });

    test('closes when removed from the document', async () => {
        await press('Enter');
        document.body.removeChild(dropdown);
        document.body.appendChild(dropdown);
        await dropdown.updateComplete;
        assert.strictEqual(dropdown.shadowRoot!.querySelector('.dropdown-menu'), null);
    });

    test('does not open when disabled', async () => {
        dropdown.disabled = true;
        await dropdown.updateComplete;
        await press('ArrowDown');
        assert.strictEqual(dropdown.shadowRoot!.querySelector('.dropdown-menu'), null);
    });
});
