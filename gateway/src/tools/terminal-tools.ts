import type { ToolRegistry } from './tool-registry';
import type { SandboxManager } from './sandbox-manager';
import type { ToolExecutionContext, ToolExecutionResult } from './types';

export function registerTerminalTool(
  registry: ToolRegistry,
  sandboxManager: SandboxManager,
): void {
  registry.register({
    name: 'run_command',
    description:
      'Run a shell command in a sandboxed Docker container. Use for file operations, builds, and system tasks.',
    category: 'terminal',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
        workingDir: {
          type: 'string',
          description: 'Directory to run in, default /workspace',
        },
        timeout: { type: 'number', description: 'Timeout in seconds, default 60' },
      },
      required: ['command'],
    },
    agentWhitelist: [
      'architect',
      'backend-dev',
      'frontend-dev',
      'qa-architect',
      'security-specialist',
    ],
    execute: async (
      input: Record<string, unknown>,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const start = Date.now();
      const command = input.command as string;
      const workingDir = (input.workingDir as string) || '/workspace';
      const timeout = ((input.timeout as number) || 60) * 1000;

      let containerId: string | undefined;
      try {
        const sandbox = await sandboxManager.createSandbox({
          image: 'node:20-alpine',
          memoryLimit: '512m',
          cpuLimit: 1.0,
          networkMode: 'none',
          timeoutMs: timeout,
          volumeMounts: [],
          workingDir,
        });
        containerId = sandbox.containerId;

        const result = await sandboxManager.execInSandbox(
          containerId,
          ['sh', '-c', command],
          { timeout },
        );

        return {
          success: result.exitCode === 0,
          output: result.stdout,
          error: result.stderr || undefined,
          artifacts: [],
          duration: Date.now() - start,
          containerId,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: '',
          error: message,
          artifacts: [],
          duration: Date.now() - start,
        };
      } finally {
        if (containerId) {
          await sandboxManager.destroySandbox(containerId).catch(() => {});
        }
      }
    },
  });
}
