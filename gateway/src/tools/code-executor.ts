import type { ToolRegistry } from './tool-registry';
import type { SandboxManager } from './sandbox-manager';
import type { ToolExecutionContext, ToolExecutionResult } from './types';

const RUNTIMES: Record<string, string[]> = {
  javascript: ['node'],
  typescript: ['npx', 'tsx'],
  python: ['python3'],
  shell: ['sh'],
};

const FILE_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  shell: 'sh',
};

export function registerCodeExecutorTool(
  registry: ToolRegistry,
  sandboxManager: SandboxManager,
): void {
  registry.register({
    name: 'execute_code',
    description:
      'Execute code in a sandboxed Docker container. Supports JavaScript/TypeScript, Python, and shell scripts.',
    category: 'code-execution',
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'python', 'shell'],
        },
        code: { type: 'string', description: 'The code to execute' },
        timeout: { type: 'number', description: 'Timeout in seconds, default 30' },
      },
      required: ['language', 'code'],
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
      const language = input.language as string;
      const code = input.code as string;
      const timeout = ((input.timeout as number) || 30) * 1000;

      let containerId: string | undefined;
      try {
        const sandbox = await sandboxManager.createSandbox({
          image: 'node:20-alpine',
          memoryLimit: '512m',
          cpuLimit: 1.0,
          networkMode: 'none',
          timeoutMs: timeout,
          volumeMounts: [],
          workingDir: '/workspace',
        });
        containerId = sandbox.containerId;

        const ext = FILE_EXTENSIONS[language];
        const filePath = `/workspace/main.${ext}`;
        const escaped = code.replace(/'/g, "'\\''");
        await sandboxManager.execInSandbox(containerId, [
          'sh',
          '-c',
          `cat > ${filePath} << 'FORGE_EOF'\n${escaped}\nFORGE_EOF`,
        ]);

        const runtime = RUNTIMES[language];
        const result = await sandboxManager.execInSandbox(
          containerId,
          [...runtime, filePath],
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
