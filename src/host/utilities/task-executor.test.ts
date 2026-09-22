import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { TaskExecutor } from './task-executor';
import { Logger } from '../../common/logger';

suite('TaskExecutor Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let executeTaskStub: sinon.SinonStub;
    let onDidEndTaskStub: sinon.SinonStub;
    let onDidEndTaskProcessStub: sinon.SinonStub;
    let processListeners: Array<(e: vscode.TaskProcessEndEvent) => void>;
    let loggerInfoStub: sinon.SinonStub;
    let loggerDebugStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        executeTaskStub = sandbox.stub(vscode.tasks, 'executeTask');
        onDidEndTaskStub = sandbox.stub(vscode.tasks, 'onDidEndTask');
        processListeners = [];
        onDidEndTaskProcessStub = sandbox.stub(vscode.tasks, 'onDidEndTaskProcess').callsFake((listener: any) => {
            processListeners.push(listener);
            return { dispose: () => { processListeners = processListeners.filter((l) => l !== listener); } };
        });
        sandbox.stub(Logger, 'error');
        loggerInfoStub = sandbox.stub(Logger, 'info');
        loggerDebugStub = sandbox.stub(Logger, 'debug');
    });

    teardown(() => {
        sandbox.restore();
    });

    test('ExecuteTask executes a task successfully', async () => {
        const taskExecutor = new TaskExecutor();
        const task = new vscode.Task(
            { type: 'test' },
            vscode.TaskScope.Workspace,
            'Test Task',
            'test-source'
        );

        const taskExecution = { task } as vscode.TaskExecution;
        executeTaskStub.resolves(taskExecution);

        // Simulate task completion
        onDidEndTaskStub.callsFake((callback) => {
             // We can't immediately call the callback because ExecuteTask waits for mutex which is released IN the callback.
             // But the callback is registered.
             // We need to trigger it after ExecuteTask has registered it.
             // Actually, ExecuteTask registers the callback, then waits for mutex.
             // The callback releases the mutex.

             // So we should schedule the callback invocation.
             setTimeout(() => {
                 callback({ execution: taskExecution });
             }, 10);

             return { dispose: sandbox.stub() };
        });

        await taskExecutor.ExecuteTask(task);

        assert.ok(executeTaskStub.calledOnceWith(task));
        assert.ok(loggerInfoStub.calledWith(`TaskExecutor.ExecuteTask: Executing task ${task.name}`));
        assert.ok(loggerInfoStub.calledWith(`TaskExecutor.ExecuteTask: Task ${task.name} completed`));
    });

    test('ExecuteTask logs debug info for ShellExecution', async () => {
        const taskExecutor = new TaskExecutor();
        const shellExecution = new vscode.ShellExecution('echo hello', { cwd: '.' });
        const task = new vscode.Task(
            { type: 'test' },
            vscode.TaskScope.Workspace,
            'Shell Task',
            'test-source',
            shellExecution
        );

        const taskExecution = { task } as vscode.TaskExecution;
        executeTaskStub.resolves(taskExecution);

        onDidEndTaskStub.callsFake((callback) => {
             setTimeout(() => {
                 callback({ execution: taskExecution });
             }, 10);
             return { dispose: sandbox.stub() };
        });

        await taskExecutor.ExecuteTask(task);

        assert.ok(loggerDebugStub.calledWithMatch(/TaskExecutor.ExecuteTask: Shell command: echo hello/));
    });

    test('ExecuteTask logs debug info for ShellExecution with args array', async () => {
        const taskExecutor = new TaskExecutor();
        const shellExecution = new vscode.ShellExecution('echo', ['hello', 'world']);
        const task = new vscode.Task(
            { type: 'test' },
            vscode.TaskScope.Workspace,
            'Shell Task Args',
            'test-source',
            shellExecution
        );

        const taskExecution = { task } as vscode.TaskExecution;
        executeTaskStub.resolves(taskExecution);

        onDidEndTaskStub.callsFake((callback) => {
             setTimeout(() => {
                 callback({ execution: taskExecution });
             }, 10);
             return { dispose: sandbox.stub() };
        });

        await taskExecutor.ExecuteTask(task);

        assert.ok(loggerDebugStub.calledWithMatch(/TaskExecutor.ExecuteTask: Shell command: echo hello world/));
    });

    test('ExecuteTask logs debug info for ProcessExecution', async () => {
        const taskExecutor = new TaskExecutor();
        const processExecution = new vscode.ProcessExecution('node', ['-v']);
        const task = new vscode.Task(
            { type: 'test' },
            vscode.TaskScope.Workspace,
            'Process Task',
            'test-source',
            processExecution
        );

        const taskExecution = { task } as vscode.TaskExecution;
        executeTaskStub.resolves(taskExecution);

        onDidEndTaskStub.callsFake((callback) => {
             setTimeout(() => {
                 callback({ execution: taskExecution });
             }, 10);
             return { dispose: sandbox.stub() };
        });

        await taskExecutor.ExecuteTask(task);

        assert.ok(loggerDebugStub.calledWithMatch(/TaskExecutor.ExecuteTask: Process: node -v/));
    });

    test('ExecuteTask handles concurrent calls sequentially via mutex', async () => {
        const taskExecutor = new TaskExecutor();
        const task1 = new vscode.Task({ type: 'test1' }, vscode.TaskScope.Workspace, 'Task 1', 'source');
        const task2 = new vscode.Task({ type: 'test2' }, vscode.TaskScope.Workspace, 'Task 2', 'source');
        const executionOrder: string[] = [];

        onDidEndTaskStub.returns({ dispose: () => {} });
        executeTaskStub.callsFake(async (t: vscode.Task) => {
            executionOrder.push(`start ${t.name}`);
            const execution = { task: t } as vscode.TaskExecution;
            setTimeout(() => {
                executionOrder.push(`end ${t.name}`);
                processListeners.forEach((l) => l({ execution, exitCode: 0 }));
            }, t === task1 ? 50 : 10);
            return execution;
        });

        const p1 = taskExecutor.ExecuteTask(task1);
        await new Promise(r => setTimeout(r, 5));
        const p2 = taskExecutor.ExecuteTask(task2);
        await Promise.all([p1, p2]);

        assert.deepStrictEqual(executionOrder, ['start Task 1', 'end Task 1', 'start Task 2', 'end Task 2']);
    });

    test('ExecuteTask rejects when the process exits with a non-zero code', async () => {
        const taskExecutor = new TaskExecutor();
        const task = new vscode.Task({ type: 'test' }, vscode.TaskScope.Workspace, 'Failing Task', 'source');
        onDidEndTaskStub.returns({ dispose: () => {} });
        executeTaskStub.callsFake(async (t: vscode.Task) => {
            const execution = { task: t } as vscode.TaskExecution;
            setTimeout(() => processListeners.forEach((l) => l({ execution, exitCode: 1 })), 5);
            return execution;
        });

        await assert.rejects(() => taskExecutor.ExecuteTask(task), /exited with code 1/);
        assert.strictEqual(processListeners.length, 0, 'listeners should be disposed');
    });

    test('ExecuteTask releases the mutex after a failure so later tasks still run', async () => {
        const taskExecutor = new TaskExecutor();
        const task = new vscode.Task({ type: 'test' }, vscode.TaskScope.Workspace, 'Task', 'source');
        onDidEndTaskStub.returns({ dispose: () => {} });
        executeTaskStub.onFirstCall().rejects(new Error('cannot start'));
        executeTaskStub.onSecondCall().callsFake(async (t: vscode.Task) => {
            const execution = { task: t } as vscode.TaskExecution;
            setTimeout(() => processListeners.forEach((l) => l({ execution, exitCode: 0 })), 5);
            return execution;
        });

        await assert.rejects(() => taskExecutor.ExecuteTask(task), /cannot start/);
        await taskExecutor.ExecuteTask(task);
        assert.strictEqual(executeTaskStub.callCount, 2);
    });

    test('ExecuteTask does not hang when the task ends before executeTask resolves', async () => {
        const taskExecutor = new TaskExecutor();
        const task = new vscode.Task({ type: 'test' }, vscode.TaskScope.Workspace, 'Fast Task', 'source');
        onDidEndTaskStub.returns({ dispose: () => {} });
        executeTaskStub.callsFake(async (t: vscode.Task) => {
            const execution = { task: t } as vscode.TaskExecution;
            processListeners.forEach((l) => l({ execution, exitCode: 0 }));
            return execution;
        });

        await taskExecutor.ExecuteTask(task);
        assert.ok(onDidEndTaskProcessStub.calledOnce);
    });
});
