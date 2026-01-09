
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import PasswordScriptExecutor from './password-script-executor';
import { Logger } from '../../common/logger';

suite('PasswordScriptExecutor Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let createTerminalStub: sinon.SinonStub;
    let spawnStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;
    
    // Holds the latest created process mock
    let mockProcess: {
        stdout: EventEmitter;
        stderr: EventEmitter;
        on: sinon.SinonStub;
        kill: sinon.SinonStub;
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock Logger
        loggerErrorStub = sandbox.stub(Logger, 'error');

        // Mock vscode.window.createTerminal
        createTerminalStub = sandbox.stub(vscode.window, 'createTerminal');

        // Stub the static property _spawn
        spawnStub = sandbox.stub(PasswordScriptExecutor, '_spawn' as any).callsFake(() => {
            // Create a fresh process mock for each call
            mockProcess = {
                stdout: new EventEmitter(),
                stderr: new EventEmitter(),
                on: sandbox.stub(),
                kill: sandbox.stub()
            };
            return mockProcess;
        });

        // Clear cache
        PasswordScriptExecutor.ClearCache();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('ExecuteScript throws if encoded password is empty', async () => {
        await assert.rejects(
            async () => PasswordScriptExecutor.ExecuteScript('script.bat', ''),
            /Encoded password is empty or undefined/
        );
    });

    test('ExecuteScript executes script and returns output', async () => {
        const scriptPath = 'c:\\scripts\\get-pass.bat';
        const encodedPass = 'secret';
        const expectedOutput = 'decoded-password';

        createTerminalStub.callsFake((options: vscode.TerminalOptions | vscode.ExtensionTerminalOptions) => {
            const pty = (options as vscode.ExtensionTerminalOptions).pty!;
            pty.open(undefined);
            const proc = mockProcess;

            assert.ok(spawnStub.calledOnce);
            const [command, args] = spawnStub.firstCall.args;
            assert.strictEqual(command, 'cmd.exe');
            assert.deepStrictEqual(args, ['/c', scriptPath, encodedPass]);

            setTimeout(() => {
                proc.stdout.emit('data', Buffer.from(expectedOutput));
                const closeHandler = proc.on.args.find(arg => arg[0] === 'close')?.[1];
                if (closeHandler) closeHandler(0);
            }, 10);

            return { dispose: sandbox.stub() } as any;
        });

        const result = await PasswordScriptExecutor.ExecuteScript(scriptPath, encodedPass);
        assert.strictEqual(result, expectedOutput);
    });

    test('ExecuteScript executes PowerShell script correctly', async () => {
        const scriptPath = 'c:\\scripts\\get-pass.ps1';
        const encodedPass = 'secret';
        const expectedOutput = 'decoded-password';

        createTerminalStub.callsFake((options: vscode.TerminalOptions | vscode.ExtensionTerminalOptions) => {
            const pty = (options as vscode.ExtensionTerminalOptions).pty!;
            pty.open(undefined);
            const proc = mockProcess;
            
            const [command, args] = spawnStub.firstCall.args;
            assert.strictEqual(command, 'powershell.exe');
            assert.ok(args.includes('-File'));
            assert.ok(args.includes(scriptPath));

            setTimeout(() => {
                proc.stdout.emit('data', Buffer.from(expectedOutput));
                const closeHandler = proc.on.args.find(arg => arg[0] === 'close')?.[1];
                if (closeHandler) closeHandler(0);
            }, 10);

            return { dispose: sandbox.stub() } as any;
        });

        const result = await PasswordScriptExecutor.ExecuteScript(scriptPath, encodedPass);
        assert.strictEqual(result, expectedOutput);
    });

    test('ExecuteScript handles script error (non-zero exit code)', async () => {
        const scriptPath = 'c:\\scripts\\fail.bat';
        const errorOutput = 'Something went wrong';

        createTerminalStub.callsFake((options: vscode.TerminalOptions | vscode.ExtensionTerminalOptions) => {
            const pty = (options as vscode.ExtensionTerminalOptions).pty!;
            pty.open(undefined);
            const proc = mockProcess;

            setTimeout(() => {
                proc.stderr.emit('data', Buffer.from(errorOutput));
                const closeHandler = proc.on.args.find(arg => arg[0] === 'close')?.[1];
                if (closeHandler) closeHandler(1);
            }, 10);

            return { dispose: sandbox.stub() } as any;
        });

        await assert.rejects(
            async () => PasswordScriptExecutor.ExecuteScript(scriptPath, 'pass'),
            (err: Error) => {
                return err.message.includes('Script exited with code 1') && 
                       err.message.includes(errorOutput);
            }
        );
    });

    test('ExecuteScript handles spawn error', async () => {
        const scriptPath = 'c:\\scripts\\bad.bat';
        const spawnError = new Error('Spawn failed');

        createTerminalStub.callsFake((options: vscode.TerminalOptions | vscode.ExtensionTerminalOptions) => {
            const pty = (options as vscode.ExtensionTerminalOptions).pty!;
            pty.open(undefined);
            const proc = mockProcess;

            setTimeout(() => {
                const errorHandler = proc.on.args.find(arg => arg[0] === 'error')?.[1];
                if (errorHandler) errorHandler(spawnError);
            }, 10);

            return { dispose: sandbox.stub() } as any;
        });

        await assert.rejects(
            async () => PasswordScriptExecutor.ExecuteScript(scriptPath, 'pass'),
            (err: Error) => err.message.includes('Password script execution failed')
        );
    });

    test('ExecuteScript caches password', async () => {
        const scriptPath = 'c:\\scripts\\cache.bat';
        const encodedPass = 'secret';
        const expectedOutput = 'cached-password';

        createTerminalStub.callsFake((options: vscode.TerminalOptions | vscode.ExtensionTerminalOptions) => {
            const pty = (options as vscode.ExtensionTerminalOptions).pty!;
            pty.open(undefined);
            const proc = mockProcess;

            setTimeout(() => {
                proc.stdout.emit('data', Buffer.from(expectedOutput));
                const closeHandler = proc.on.args.find(arg => arg[0] === 'close')?.[1];
                if (closeHandler) closeHandler(0);
            }, 10);

            return { dispose: sandbox.stub() } as any;
        });

        // First call
        const result1 = await PasswordScriptExecutor.ExecuteScript(scriptPath, encodedPass);
        assert.strictEqual(result1, expectedOutput);
        assert.ok(spawnStub.calledOnce);

        // Second call should come from cache
        const result2 = await PasswordScriptExecutor.ExecuteScript(scriptPath, encodedPass);
        assert.strictEqual(result2, expectedOutput);
        assert.ok(spawnStub.calledOnce); // Should still be called only once
    });

    test('ClearCache clears the cache', async () => {
        const scriptPath = 'c:\\scripts\\clear.bat';
        const encodedPass = 'secret';

        createTerminalStub.callsFake((options: vscode.TerminalOptions | vscode.ExtensionTerminalOptions) => {
            const pty = (options as vscode.ExtensionTerminalOptions).pty!;
            pty.open(undefined);
            const proc = mockProcess;
            setTimeout(() => {
                proc.stdout.emit('data', Buffer.from('pass'));
                const closeHandler = proc.on.args.find(arg => arg[0] === 'close')?.[1];
                if (closeHandler) closeHandler(0);
            }, 10);
            return { dispose: sandbox.stub() } as any;
        });

        await PasswordScriptExecutor.ExecuteScript(scriptPath, encodedPass);
        assert.ok(spawnStub.calledOnce);

        PasswordScriptExecutor.ClearCache();

        await PasswordScriptExecutor.ExecuteScript(scriptPath, encodedPass);
        assert.ok(spawnStub.calledTwice);
    });

    test('ClearExpiredCache clears old entries', async () => {
        const start = 1000000;
        const ttl = 5 * 60 * 1000;
        const dateStub = sandbox.stub(Date, 'now').returns(start);
        
        const scriptPath = 'c:\\scripts\\ttl.bat';
        const encodedPass = 'secret';

        createTerminalStub.callsFake((options: vscode.TerminalOptions | vscode.ExtensionTerminalOptions) => {
            const pty = (options as vscode.ExtensionTerminalOptions).pty!;
            pty.open(undefined);
            const proc = mockProcess;
            setTimeout(() => {
                proc.stdout.emit('data', Buffer.from('pass'));
                const closeHandler = proc.on.args.find(arg => arg[0] === 'close')?.[1];
                if (closeHandler) closeHandler(0);
            }, 10);
            return { dispose: sandbox.stub() } as any;
        });

        // Run script to cache
        await PasswordScriptExecutor.ExecuteScript(scriptPath, encodedPass);
        assert.ok(spawnStub.calledOnce);

        // Fast forward 6 minutes (TTL is 5 mins)
        dateStub.returns(start + ttl + 1000);

        PasswordScriptExecutor.ClearExpiredCache();

        // Should re-run
        await PasswordScriptExecutor.ExecuteScript(scriptPath, encodedPass);
        assert.ok(spawnStub.calledTwice);
    });
});
