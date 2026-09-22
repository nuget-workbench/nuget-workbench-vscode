import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import { createRpcClient } from './rpc-client';

suite('RpcClient', () => {
    let dom: JSDOM;
    let originalWindow: unknown;

    setup(() => {
        dom = new JSDOM('<!DOCTYPE html>');
        originalWindow = (global as any).window;
        (global as any).window = dom.window;
    });

    teardown(() => {
        (global as any).window = originalWindow;
        dom.window.close();
    });

    test('uses the default timeout for regular methods', async () => {
        const client = createRpcClient(() => {}, 20, 10_000);
        const result = await client.getConfiguration();
        assert.strictEqual(result.ok, false);
        assert.match((result as { error: string }).error, /RPC timeout after 20ms for method: getConfiguration/);
    });

    test('uses the long-running timeout for dotnet operations', async () => {
        let sent: any;
        const client = createRpcClient((msg) => { sent = msg; }, 20, 10_000);
        const promise = client.batchUpdatePackages({ Updates: [] });

        // Still pending after the default timeout has elapsed
        await new Promise((r) => setTimeout(r, 50));
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: { type: 'rpc-response', id: sent.id, result: { ok: true, value: { Results: [] } } },
        }));

        const result = await promise;
        assert.strictEqual(result.ok, true);
    });
});
