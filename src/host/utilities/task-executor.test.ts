import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { TaskExecutor } from './task-executor';
import { Logger } from '../../common/logger';

suite('TaskExecutor Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let executeTaskStub: sinon.SinonStub;
    let onDidEndTaskStub: sinon.SinonStub;
    let loggerInfoStub: sinon.SinonStub;
    let loggerDebugStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        executeTaskStub = sandbox.stub(vscode.tasks, 'executeTask');
        onDidEndTaskStub = sandbox.stub(vscode.tasks, 'onDidEndTask');
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

        const execution1 = { task: task1 } as vscode.TaskExecution;
        const execution2 = { task: task2 } as vscode.TaskExecution;

        // Spy on execution order
        const executionOrder: string[] = [];

        executeTaskStub.callsFake(async (t) => {
            executionOrder.push(`start ${t.name}`);
            if (t === task1) return execution1;
            if (t === task2) return execution2;
        });

        onDidEndTaskStub.callsFake((callback) => {
             // Complete task 1 after 50ms, task 2 after 10ms (if it could run immediately)
             // But since we want to prove they run sequentially, we make task 1 take longer.
             // If they were concurrent, task 2 would start before task 1 finishes.

             // We can't really control the timing passed to callback easily here because we don't know which task triggered the listener setup.
             // But wait, onDidEndTask is a global listener. The code registers a NEW listener for EACH ExecuteTask call.
             // "let callback = vscode.tasks.onDidEndTask((x) => {"

             const taskName = executionOrder[executionOrder.length - 1].replace('start ', '');

             setTimeout(() => {
                 if (taskName === 'Task 1') {
                     executionOrder.push('end Task 1');
                     callback({ execution: execution1 });
                 } else {
                     executionOrder.push('end Task 2');
                     callback({ execution: execution2 });
                 }
             }, taskName === 'Task 1' ? 50 : 10);

             return { dispose: sandbox.stub() };
        });

        // Run both in parallel (but they should serialize internally)
        const p1 = taskExecutor.ExecuteTask(task1);
        // Add a small delay to ensure p1 enters mutex first
        await new Promise(r => setTimeout(r, 5));
        const p2 = taskExecutor.ExecuteTask(task2);

        await Promise.all([p1, p2]);

        // Expected order: start Task 1 -> end Task 1 -> start Task 2 -> end Task 2
        // If parallel: start Task 1 -> start Task 2 ...

        assert.deepStrictEqual(executionOrder, ['start Task 1', 'end Task 1', 'start Task 2', 'end Task 2']);
    });
});
