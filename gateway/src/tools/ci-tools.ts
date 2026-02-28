import type { ToolRegistry } from './tool-registry';
import type { ToolExecutionResult } from './types';

async function getOctokit(token: string) {
  const { Octokit } = await import('@octokit/rest');
  return new Octokit({ auth: token });
}

export function registerCITools(registry: ToolRegistry): void {
  registry.register({
    name: 'trigger_ci_pipeline',
    description: 'Trigger a CI/CD pipeline run (GitHub Actions)',
    category: 'ci',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        workflow: { type: 'string', description: 'Workflow file name' },
        ref: { type: 'string', description: 'Git ref, default main' },
        inputs: { type: 'object', description: 'Optional workflow inputs' },
      },
      required: ['owner', 'repo', 'workflow'],
    },
    agentWhitelist: ['backend-dev', 'devops-engineer'],
    execute: async (input: Record<string, unknown>): Promise<ToolExecutionResult> => {
      const start = Date.now();
      const token = process.env.GITHUB_TOKEN;

      if (!token) {
        return {
          success: false,
          output: '',
          error: 'GITHUB_TOKEN environment variable is not set',
          artifacts: [],
          duration: Date.now() - start,
        };
      }

      const octokit = await getOctokit(token);

      try {
        await octokit.actions.createWorkflowDispatch({
          owner: input.owner as string,
          repo: input.repo as string,
          workflow_id: input.workflow as string,
          ref: (input.ref as string) || 'main',
          inputs: (input.inputs as Record<string, string>) ?? undefined,
        });

        return {
          success: true,
          output: `CI pipeline triggered: ${input.workflow} on ${(input.ref as string) || 'main'}`,
          artifacts: [],
          duration: Date.now() - start,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          output: '',
          error: `Failed to trigger CI pipeline: ${message}`,
          artifacts: [],
          duration: Date.now() - start,
        };
      }
    },
  });
}
