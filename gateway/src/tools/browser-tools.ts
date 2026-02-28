import type { ToolRegistry } from './tool-registry';
import type { SandboxManager } from './sandbox-manager';
import type { ToolExecutionContext, ToolExecutionResult } from './types';

export function registerBrowserTools(
  registry: ToolRegistry,
  sandboxManager: SandboxManager,
): void {
  registry.register({
    name: 'browser_navigate',
    description: 'Open a URL in a headless browser and return the page content',
    category: 'browser',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        waitForSelector: {
          type: 'string',
          description: 'CSS selector to wait for',
        },
        screenshotPath: {
          type: 'string',
          description: 'Path to save screenshot',
        },
      },
      required: ['url'],
    },
    agentWhitelist: ['qa-architect'],
    execute: async (
      input: Record<string, unknown>,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const start = Date.now();
      const url = input.url as string;
      const waitForSelector = input.waitForSelector as string | undefined;
      const screenshotPath = input.screenshotPath as string | undefined;

      try {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        const artifacts: string[] = [];

        try {
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: 'domcontentloaded' });

          if (waitForSelector) {
            await page.waitForSelector(waitForSelector, { timeout: 10_000 });
          }

          if (screenshotPath) {
            await page.screenshot({ path: screenshotPath, fullPage: true });
            artifacts.push(screenshotPath);
          }

          const content = (await page.textContent('body')) ?? '';

          return {
            success: true,
            output: content,
            artifacts,
            duration: Date.now() - start,
          };
        } finally {
          await browser.close();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isNotInstalled =
          message.includes('browserType.launch') ||
          message.includes('Executable doesn\'t exist') ||
          message.includes('Cannot find module') ||
          message.includes('playwright');

        return {
          success: false,
          output: '',
          error: isNotInstalled
            ? 'Playwright browsers not installed. Run: npx playwright install chromium'
            : message,
          artifacts: [],
          duration: Date.now() - start,
        };
      }
    },
  });

  registry.register({
    name: 'browser_test',
    description: 'Run a Playwright test script to verify UI behavior',
    category: 'browser',
    inputSchema: {
      type: 'object',
      properties: {
        testCode: {
          type: 'string',
          description: 'JavaScript test code using Playwright API',
        },
        baseUrl: {
          type: 'string',
          description: 'Base URL for the test',
        },
      },
      required: ['testCode', 'baseUrl'],
    },
    agentWhitelist: ['qa-architect'],
    execute: async (
      input: Record<string, unknown>,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const start = Date.now();
      const testCode = input.testCode as string;
      const baseUrl = input.baseUrl as string;

      let containerId: string | undefined;
      try {
        const sandbox = await sandboxManager.createSandbox({
          image: 'mcr.microsoft.com/playwright:v1.48.0-jammy',
          memoryLimit: '1g',
          cpuLimit: 2.0,
          networkMode: 'forgeteam-network',
          timeoutMs: 120_000,
          volumeMounts: [],
          workingDir: '/workspace',
        });
        containerId = sandbox.containerId;

        const escaped = testCode.replace(/'/g, "'\\''");
        await sandboxManager.execInSandbox(containerId, [
          'sh',
          '-c',
          `cat > /workspace/test.spec.ts << 'FORGE_EOF'\n${escaped}\nFORGE_EOF`,
        ]);

        const configContent = `
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '/workspace',
  use: { baseURL: '${baseUrl.replace(/'/g, "\\'")}' },
  reporter: 'list',
});
`.trim();
        const escapedConfig = configContent.replace(/'/g, "'\\''");
        await sandboxManager.execInSandbox(containerId, [
          'sh',
          '-c',
          `cat > /workspace/playwright.config.ts << 'FORGE_EOF'\n${escapedConfig}\nFORGE_EOF`,
        ]);

        const result = await sandboxManager.execInSandbox(
          containerId,
          ['npx', 'playwright', 'test', '--config=/workspace/playwright.config.ts'],
          { timeout: 120_000 },
        );

        const passed = result.exitCode === 0;

        return {
          success: passed,
          output: result.stdout || result.stderr,
          error: passed ? undefined : result.stderr || undefined,
          artifacts: [],
          duration: Date.now() - start,
          containerId,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isNotInstalled =
          message.includes('playwright') ||
          message.includes('Cannot find module');

        return {
          success: false,
          output: '',
          error: isNotInstalled
            ? 'Playwright browsers not installed. Run: npx playwright install chromium'
            : message,
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
