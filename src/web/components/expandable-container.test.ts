import '../web-setup';
import * as assert from 'assert';
import { ExpandableContainer } from '@/web/components/expandable-container';

suite('ExpandableContainer Component', () => {
    let container: ExpandableContainer;

    setup(() => {
        container = new ExpandableContainer();
        document.body.appendChild(container);
    });

    teardown(() => {
        document.body.removeChild(container);
    });

    test('should initialize with default values', () => {
        assert.strictEqual(container.isExpanded, false);
        assert.strictEqual(container.expanded, false);
        assert.strictEqual(container.title, "");
        assert.strictEqual(container.summary, "");
    });

    test('should initialize expanded when expanded attribute is set', async () => {
        const expandedContainer = new ExpandableContainer();
        expandedContainer.setAttribute('expanded', '');
        document.body.appendChild(expandedContainer);

        await expandedContainer.updateComplete;

        assert.strictEqual(expandedContainer.expanded, true);
        assert.strictEqual(expandedContainer.isExpanded, true);

        document.body.removeChild(expandedContainer);
    });

    test('should update title and summary from attributes', async () => {
        container.setAttribute('title', 'Test Title');
        container.setAttribute('summary', 'Test Summary');

        await container.updateComplete;

        assert.strictEqual(container.title, 'Test Title');
        assert.strictEqual(container.summary, 'Test Summary');

        const shadowRoot = container.shadowRoot;
        const titleSpan = shadowRoot?.querySelector('.title span:nth-child(2)');
        const summarySpan = shadowRoot?.querySelector('.summary');

        assert.strictEqual(titleSpan?.textContent, 'Test Title');
        assert.strictEqual(summarySpan?.textContent, 'Test Summary');
    });

    test('should toggle expansion when header is clicked', async () => {
        await container.updateComplete;

        const shadowRoot = container.shadowRoot!;
        const header = shadowRoot.querySelector('.expandable') as HTMLElement;
        const icon = shadowRoot.querySelector('.codicon') as HTMLElement;

        // Initial state: collapsed
        assert.ok(header.classList.contains('collapsed'));
        assert.ok(icon.classList.contains('codicon-chevron-right'));
        assert.ok(!container.shadowRoot?.querySelector('slot'));

        // Click to expand
        header.click();
        await container.updateComplete;

        assert.strictEqual(container.isExpanded, true);
        assert.ok(!header.classList.contains('collapsed'));
        assert.ok(icon.classList.contains('codicon-chevron-down'));
        assert.ok(container.shadowRoot?.querySelector('slot'));

        // Click to collapse
        header.click();
        await container.updateComplete;

        assert.strictEqual(container.isExpanded, false);
        assert.ok(header.classList.contains('collapsed'));
        assert.ok(icon.classList.contains('codicon-chevron-right'));
        assert.ok(!container.shadowRoot?.querySelector('slot'));
    });

    test('should render slot content when expanded', async () => {
        const content = document.createElement('div');
        content.textContent = 'Slot Content';
        container.appendChild(content);

        container.isExpanded = true;
        await container.updateComplete;

        const slot = container.shadowRoot?.querySelector('slot') as HTMLSlotElement;
        assert.ok(slot);

        const assignedNodes = slot.assignedNodes();
        if (assignedNodes.length > 0) {
            assert.strictEqual(assignedNodes[0].textContent, 'Slot Content');
        }
    });
});
