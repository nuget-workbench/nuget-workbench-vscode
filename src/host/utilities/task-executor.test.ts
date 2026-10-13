import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { TaskExecutor } from './task-executor';
import { DotnetPseudoterminal } from './dotnet-runner';
import { Logger } from '../../common/logger';

type FakeProcess = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: sinon.SinonStub };
    kill: sinon.SinonStub;
    exitCode: number | null;
    killed: boolean;
};

suite('TaskExecutor Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let executeTaskStub: sinon.SinonStub;
    let endTaskListeners: Array<(e: vscode.TaskEndEvent) => void>;
    let spawnStub: sinon.SinonStub;
    let processes: FakeProcess[];
    // Opens the task's terminal like VS Code does when it runs a CustomExecution
    let openTerminals: boolean;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(Logger, 'error');
        sandbox.stub(Logger, 'info');
        sandbox.stub(Logger, 'debug');

        processes = [];
        spawnStub = sandbox.stub(DotnetPseudoterminal, '_spawn' as any).callsFake(() => {
            const proc = Object.assign(new EventEmitter(), {
                stdout: new EventEmitter(),
                stderr: new EventEmitter(),
                stdin: { end: sandbox.stub() },
                kill: sandbox.stub(),
                exitCode: null,
                killed: false,
            });
            processes.push(proc);
            return proc;
        });

        openTerminals = true;
        executeTaskStub = sandbox.stub(vscode.tasks, 'executeTask').callsFake(async (task: vscode.Task) => {
            const execution = { task } as vscode.TaskExecution;
            if (openTerminals) {
                const customExecution = task.execution as any;
                const callback = customExecution.callback ?? customExecution._callback;
                const pty: vscode.Pseudoterminal = await callback({});
                pty.open(undefined);
            }
            return execution;
        });
        endTaskListeners = [];
        sandbox.stub(vscode.tasks, 'onDidEndTask').callsFake((listener: any) => {
            endTaskListeners.push(listener);
            return { dispose: () => { endTaskListeners = endTaskListeners.filter((l) => l !== listener); } };
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    /** Lets the running dotnet process print and exit once it was started. */
    async function finishProcess(index: number, exitCode: number, output = '') {
        while (processes.length <= index) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
        const proc = processes[index];
        if (output) proc.stdout.emit('data', Buffer.from(output));
        proc.emit('close', exitCode);
    }

    test('runs dotnet without a shell in the given folder', async () => {
        const executor = new TaskExecutor();

        const run = executor.ExecuteDotnet('dotnet add package', ['add', 'App.csproj', 'package', 'Foo'], '/repo/App');
        await finishProcess(0, 0, 'info : PackageReference added');
        await run;

        const [command, args, options] = spawnStub.firstCall.args;
        assert.strictEqual(command, 'dotnet');
        assert.deepStrictEqual(args, ['add', 'App.csproj', 'package', 'Foo']);
        assert.strictEqual(options.shell, false);
        assert.strictEqual(options.cwd, '/repo/App');
        assert.ok(executeTaskStub.calledOnce);
    });

    test('rejects with the errors from the dotnet output', async () => {
        const executor = new TaskExecutor();

        const run = executor.ExecuteDotnet('dotnet add package', ['add']);
        await finishProcess(0, 1,
            '  Determining projects to restore...\n' +
            '/repo/App/App.csproj : error NU1101: Unable to find package Foo. No packages exist with this id in source(s): nuget.org [/repo/App/App.csproj]\n');

        await assert.rejects(run, (err: Error) =>
            err.message === 'dotnet exited with code 1: error NU1101: Unable to find package Foo. No packages exist with this id in source(s): nuget.org');
    });

    test('rejects when dotnet cannot be started', async () => {
        const executor = new TaskExecutor();

        const run = executor.ExecuteDotnet('dotnet add package', ['add']);
        while (processes.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
        processes[0].emit('error', Object.assign(new Error('spawn dotnet ENOENT'), { code: 'ENOENT' }));

        await assert.rejects(run, /dotnet could not be started \(spawn dotnet ENOENT\)/);
    });

    test('rejects when the task ends without opening its terminal', async () => {
        openTerminals = false;
        const executor = new TaskExecutor();

        const run = executor.ExecuteDotnet('dotnet add package', ['add']);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const task = executeTaskStub.firstCall.args[0];
        endTaskListeners.forEach((l) => l({ execution: { task } as vscode.TaskExecution }));

        await assert.rejects(run, /could not be started/);
    });

    test('runs one dotnet command at a time and continues after a failure', async () => {
        const executor = new TaskExecutor();

        const first = executor.ExecuteDotnet('first', ['first']);
        const second = executor.ExecuteDotnet('second', ['second']);
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.strictEqual(spawnStub.callCount, 1, 'the second command waits for the first');
        assert.ok(executor.IsBusy);

        await finishProcess(0, 1);
        await assert.rejects(first);
        await finishProcess(1, 0);
        await second;

        assert.strictEqual(spawnStub.callCount, 2);
        assert.ok(!executor.IsBusy);
        assert.ok(executor.LastFinishedAt > 0);
    });
});
