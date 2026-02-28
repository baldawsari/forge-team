import type { ToolRegistry } from './tool-registry';
import type { SandboxManager } from './sandbox-manager';
import type { ToolExecutionContext, ToolExecutionResult } from './types';

async function getOctokit(token: string) {
  const { Octokit } = await import('@octokit/rest');
  return new Octokit({ auth: token });
}

export function registerGitTools(registry: ToolRegistry, sandboxManager: SandboxManager): void {
  registry.register({
    name: 'git_clone',
    description: 'Clone a git repository into the sandbox workspace',
    category: 'git',
    inputSchema: {
      type: 'object',
      properties: {
        repoUrl: { type: 'string', description: 'Repository URL to clone' },
        branch: { type: 'string', description: 'Branch to clone, default main' },
      },
      required: ['repoUrl'],
    },
    agentWhitelist: ['architect', 'backend-dev', 'frontend-dev', 'qa-architect', 'security-specialist'],
    execute: async (input: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const start = Date.now();
      const repoUrl = input.repoUrl as string;
      const branch = (input.branch as string) || 'main';
      let containerId: string | undefined;

      try {
        const sandbox = await sandboxManager.createSandbox({
          image: 'node:20-alpine',
          memoryLimit: '512m',
          cpuLimit: 1,
          networkMode: 'forgeteam-network',
          timeoutMs: 300_000,
          volumeMounts: [],
          workingDir: '/workspace',
        });
        containerId = sandbox.containerId;

        const result = await sandboxManager.execInSandbox(containerId, [
          'sh', '-c', `git clone --branch ${branch} ${repoUrl} /workspace/repo`,
        ]);

        return {
          success: result.exitCode === 0,
          output: result.stdout,
          error: result.exitCode !== 0 ? result.stderr : undefined,
          artifacts: [],
          duration: Date.now() - start,
          containerId,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: message, artifacts: [], duration: Date.now() - start };
      } finally {
        if (containerId) await sandboxManager.destroySandbox(containerId).catch(() => {});
      }
    },
  });

  registry.register({
    name: 'git_commit_and_push',
    description: 'Stage changes, commit, and push to a remote repository',
    category: 'git',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
        files: { type: 'array', items: { type: 'string' }, description: "File paths to stage, or ['.'] for all" },
        branch: { type: 'string', description: 'Branch to push to' },
      },
      required: ['message', 'files'],
    },
    agentWhitelist: ['architect', 'backend-dev', 'frontend-dev'],
    execute: async (input: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const start = Date.now();
      const message = input.message as string;
      const files = input.files as string[];
      const branch = (input.branch as string) || 'HEAD';
      let containerId: string | undefined;

      try {
        const sandbox = await sandboxManager.createSandbox({
          image: 'node:20-alpine',
          memoryLimit: '512m',
          cpuLimit: 1,
          networkMode: 'forgeteam-network',
          timeoutMs: 300_000,
          volumeMounts: [],
          workingDir: '/workspace',
        });
        containerId = sandbox.containerId;

        for (const file of files) {
          const addResult = await sandboxManager.execInSandbox(containerId, ['sh', '-c', `git add ${file}`]);
          if (addResult.exitCode !== 0) {
            return { success: false, output: addResult.stdout, error: `Failed to stage ${file}: ${addResult.stderr}`, artifacts: [], duration: Date.now() - start, containerId };
          }
        }

        const commitResult = await sandboxManager.execInSandbox(containerId, ['sh', '-c', `git commit -m "${message}"`]);
        if (commitResult.exitCode !== 0) {
          return { success: false, output: commitResult.stdout, error: `Commit failed: ${commitResult.stderr}`, artifacts: [], duration: Date.now() - start, containerId };
        }

        const pushResult = await sandboxManager.execInSandbox(containerId, ['sh', '-c', `git push origin ${branch}`]);
        return {
          success: pushResult.exitCode === 0,
          output: [commitResult.stdout, pushResult.stdout].join('\n'),
          error: pushResult.exitCode !== 0 ? pushResult.stderr : undefined,
          artifacts: [],
          duration: Date.now() - start,
          containerId,
        };
      } catch (err) {
        const message2 = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: message2, artifacts: [], duration: Date.now() - start };
      } finally {
        if (containerId) await sandboxManager.destroySandbox(containerId).catch(() => {});
      }
    },
  });

  registry.register({
    name: 'github_create_pr',
    description: 'Create a pull request on GitHub',
    category: 'git',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        head: { type: 'string', description: 'Source branch' },
        base: { type: 'string', description: 'Target branch, default main' },
      },
      required: ['owner', 'repo', 'title', 'body', 'head'],
    },
    agentWhitelist: ['architect', 'backend-dev', 'frontend-dev'],
    execute: async (input: Record<string, unknown>): Promise<ToolExecutionResult> => {
      const start = Date.now();
      const token = process.env.GITHUB_TOKEN;

      if (!token) {
        return { success: false, output: '', error: 'GITHUB_TOKEN environment variable is not set', artifacts: [], duration: Date.now() - start };
      }

      const octokit = await getOctokit(token);

      try {
        const { data } = await octokit.pulls.create({
          owner: input.owner as string,
          repo: input.repo as string,
          title: input.title as string,
          body: input.body as string,
          head: input.head as string,
          base: (input.base as string) || 'main',
        });

        return {
          success: true,
          output: `Pull request created: ${data.html_url}`,
          artifacts: [data.html_url],
          duration: Date.now() - start,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: `Failed to create PR: ${message}`, artifacts: [], duration: Date.now() - start };
      }
    },
  });
}
