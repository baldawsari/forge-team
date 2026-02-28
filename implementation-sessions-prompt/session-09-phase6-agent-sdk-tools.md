# Session 09 — Phase 6: Claude Agent SDK + Sandboxed Execution (Stream D, Day 5-8)

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL tasks listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing TypeScript style and project conventions. The goal is to give ForgeTeam agents the ability to execute code, run shell commands, interact with git/GitHub, run browser tests, and use external APIs — all within sandboxed Docker containers.

---

## CONTEXT

The audit report found Phase 6 at **0% completion**:

- No `@anthropic-ai/claude-agent-sdk` dependency anywhere
- No Docker SDK dependency — no per-task container spawning
- No external API integrations (GitHub, Jira, Supabase, Vercel, WhatsApp, Docker SDK)
- No Playwright for browser testing
- Gateway uses `@anthropic-ai/sdk` for raw LLM calls only — no tool-use wiring
- No shell/git/terminal execution capability for any agent

Currently, agents can only generate text responses via `agent-runner.ts`. They cannot execute code, run commands, create files, push to Git, or interact with any external system. This session adds the entire tool execution layer.

**Key constraint**: Only certain agents should receive code execution tools — Architect, Backend Dev, Frontend Dev, QA Architect, and Security Specialist. Other agents (Product Owner, Scrum Master, Business Analyst, UX Designer, Tech Writer, DevOps Engineer) should NOT get sandboxed execution tools in this phase.

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

**Gateway core (all must read):**
- `/forge-team/gateway/src/index.ts` — entry point, Express + WS server setup, REST routes, Socket.IO
- `/forge-team/gateway/src/agent-runner.ts` — agent LLM execution, prompt construction, Anthropic + Gemini API calls
- `/forge-team/gateway/src/model-router.ts` — model catalog (5 models), per-agent assignments, cost tracking
- `/forge-team/gateway/src/server.ts` — WebSocket server, connection management, message routing
- `/forge-team/gateway/src/openclaw/tool-runner.ts` — existing tool runner skeleton (placeholder from Phase 0)

**Configuration and infrastructure:**
- `/forge-team/gateway/package.json` — current dependencies (no dockerode, no playwright, no claude-agent-sdk)
- `/forge-team/gateway/tsconfig.json` — TypeScript config
- `/forge-team/docker/docker-compose.yml` — Docker services
- `/forge-team/docker/gateway.Dockerfile` — gateway Docker build

**Shared types:**
- `/forge-team/shared/types/` — all shared TypeScript interfaces

**Agent configs (read to understand which agents get tools):**
- `/forge-team/agents/architect/config.json` — Claude Opus 4.6, canSpawnSubAgents: true
- `/forge-team/agents/backend-dev/config.json` — Claude Opus 4.6
- `/forge-team/agents/frontend-dev/config.json` — Gemini 3.1 Pro
- `/forge-team/agents/qa-architect/config.json` — Claude Opus 4.6
- `/forge-team/agents/security-specialist/config.json` — Claude Opus 4.6

---

## WORKSTREAM 1: Install Dependencies and Create Tool Framework

**Files to modify:**
- `/forge-team/gateway/package.json`

**Files to create:**
- `/forge-team/gateway/src/tools/index.ts`
- `/forge-team/gateway/src/tools/types.ts`
- `/forge-team/gateway/src/tools/tool-registry.ts`

### 1A. Install new dependencies

Add the following to `/forge-team/gateway/package.json` dependencies:

```json
{
  "dockerode": "^4.0.4",
  "playwright": "^1.50.0",
  "@octokit/rest": "^21.1.1"
}
```

Add to devDependencies:

```json
{
  "@types/dockerode": "^3.3.34"
}
```

Then run `npm install` from the project root to install all workspace dependencies.

> **Note**: `@anthropic-ai/claude-agent-sdk` does not exist as a real npm package. Instead, we will use the existing `@anthropic-ai/sdk` package which already supports `tool_use` via `tools` parameter in `messages.create()`. The "Claude Agent SDK integration" means wiring Anthropic's tool_use feature into the agent runner.

### 1B. Define tool types (`tools/types.ts`)

Create the core type definitions for the tool execution framework:

```typescript
// Key types to define:
// - ToolDefinition: name, description, inputSchema (JSON Schema), agentWhitelist (which agents can use it)
// - ToolExecutionContext: agentId, sessionId, taskId, workingDir, timeout
// - ToolExecutionResult: success/error, output (string), artifacts (file paths), duration, containerId
// - SandboxConfig: image, memoryLimit, cpuLimit, networkMode, timeoutMs, volumeMounts
// - ToolCategory: 'code-execution' | 'git' | 'terminal' | 'ci' | 'browser' | 'api'
```

Import and extend existing types from `@forge-team/shared` where applicable. The `ToolDefinition.inputSchema` must be a valid JSON Schema object so it can be passed directly to Anthropic's `tools` parameter.

### 1C. Create tool registry (`tools/tool-registry.ts`)

Create a `ToolRegistry` class that manages all available tools:

- `register(tool: ToolDefinition)` — register a tool definition
- `get(name: string)` — get a tool by name
- `listForAgent(agentId: string)` — return only tools that the agent is whitelisted for
- `listAll()` — return all registered tools
- `toAnthropicTools(agentId: string)` — convert the agent's available tools into the format expected by `@anthropic-ai/sdk` `tools` parameter (name, description, input_schema)
- `toGeminiTools(agentId: string)` — convert to Google Generative AI function declarations format

The agent whitelist for code execution tools must be: `['architect', 'backend-dev', 'frontend-dev', 'qa-architect', 'security-specialist']`. All other agents should NOT receive these tools.

### 1D. Create barrel export (`tools/index.ts`)

Re-export all tool types and classes from a single entry point.

---

## WORKSTREAM 2: Sandboxed Docker Execution

**Files to create:**
- `/forge-team/gateway/src/tools/sandbox-manager.ts`
- `/forge-team/gateway/src/tools/code-executor.ts`
- `/forge-team/gateway/src/tools/terminal-tools.ts`

### 2A. Create sandbox manager (`tools/sandbox-manager.ts`)

Create a `SandboxManager` class that manages per-task Docker containers using the `dockerode` library:

- `createSandbox(config: SandboxConfig)` — spawn a new Docker container with:
  - Image: `node:20-alpine` (default, configurable per tool)
  - Memory limit: `512m` (configurable)
  - CPU limit: `1.0` (configurable)
  - Network mode: `none` by default (no network access). Can be set to `forgeteam-network` for tools that need it (e.g., git clone)
  - Working directory: `/workspace` inside the container
  - Auto-cleanup: track container ID, remove after task completion or timeout
  - Timeout: default 300 seconds (5 minutes), configurable
- `execInSandbox(containerId: string, command: string[], options?: { timeout?: number })` — execute a command inside an existing container, return stdout/stderr/exitCode
- `destroySandbox(containerId: string)` — stop and remove the container
- `destroyAll()` — cleanup all tracked containers (call on gateway shutdown)
- `listActive()` — return all currently running sandbox containers

The sandbox manager must handle Docker daemon unavailability gracefully — if Docker is not running, return an error result instead of crashing the gateway.

### 2B. Create code executor tool (`tools/code-executor.ts`)

Create a `CodeExecutorTool` that registers as a tool and uses the sandbox manager:

Tool definition:
- **Name**: `execute_code`
- **Description**: "Execute code in a sandboxed Docker container. Supports JavaScript/TypeScript, Python, and shell scripts."
- **Input schema**:
  - `language`: enum `['javascript', 'typescript', 'python', 'shell']`
  - `code`: string (the code to execute)
  - `timeout`: number (optional, seconds, default 30)
- **Agent whitelist**: `['architect', 'backend-dev', 'frontend-dev', 'qa-architect', 'security-specialist']`

Implementation:
1. Create a sandbox (or reuse the task's existing sandbox)
2. Write the code to a temp file inside the container
3. Execute with the appropriate runtime (`node`, `tsx`, `python3`, `sh`)
4. Capture stdout, stderr, exit code
5. Return result with output, errors, and execution duration
6. If timeout is exceeded, kill the process and return timeout error

### 2C. Create terminal tools (`tools/terminal-tools.ts`)

Create a `TerminalTool` that provides shell command execution:

Tool definition:
- **Name**: `run_command`
- **Description**: "Run a shell command in a sandboxed Docker container. Use for file operations, builds, and system tasks."
- **Input schema**:
  - `command`: string (the shell command to run)
  - `workingDir`: string (optional, directory to run in, default `/workspace`)
  - `timeout`: number (optional, seconds, default 60)
- **Agent whitelist**: `['architect', 'backend-dev', 'frontend-dev', 'qa-architect', 'security-specialist']`

Implementation: delegate to `SandboxManager.execInSandbox()`.

---

## WORKSTREAM 3: Git and CI Tools

**Files to create:**
- `/forge-team/gateway/src/tools/git-tools.ts`
- `/forge-team/gateway/src/tools/ci-tools.ts`

### 3A. Create git tools (`tools/git-tools.ts`)

Create git-related tools using the `@octokit/rest` library for GitHub API and shell commands in sandboxes for local git operations. Register **three** tools:

**Tool 1: `git_clone`**
- Description: "Clone a git repository into the sandbox workspace"
- Input: `repoUrl` (string), `branch` (optional string, default 'main')
- Implementation: run `git clone` in sandbox with network access enabled
- Agent whitelist: `['architect', 'backend-dev', 'frontend-dev', 'qa-architect', 'security-specialist']`

**Tool 2: `git_commit_and_push`**
- Description: "Stage changes, commit, and push to a remote repository"
- Input: `message` (string), `files` (string[] of file paths to stage, or `['.']` for all), `branch` (optional string)
- Implementation: run `git add`, `git commit -m`, `git push` in sequence in sandbox
- Agent whitelist: `['architect', 'backend-dev', 'frontend-dev']`

**Tool 3: `github_create_pr`**
- Description: "Create a pull request on GitHub"
- Input: `owner` (string), `repo` (string), `title` (string), `body` (string), `head` (string), `base` (string, default 'main')
- Implementation: use `@octokit/rest` Octokit client. Read GitHub token from `process.env.GITHUB_TOKEN`
- Agent whitelist: `['architect', 'backend-dev', 'frontend-dev']`

### 3B. Create CI tools (`tools/ci-tools.ts`)

Create CI/CD pipeline tools:

**Tool: `trigger_ci_pipeline`**
- Description: "Trigger a CI/CD pipeline run (GitHub Actions)"
- Input: `owner` (string), `repo` (string), `workflow` (string, workflow file name), `ref` (string, default 'main'), `inputs` (optional Record<string, string>)
- Implementation: use `@octokit/rest` to call `actions.createWorkflowDispatch()`
- Agent whitelist: `['backend-dev', 'devops-engineer']`

> **Note**: `devops-engineer` gets CI tools but NOT code execution tools.

---

## WORKSTREAM 4: Browser Testing and External API Tools

**Files to create:**
- `/forge-team/gateway/src/tools/browser-tools.ts`
- `/forge-team/gateway/src/tools/api-stubs.ts`

### 4A. Create browser tools (`tools/browser-tools.ts`)

Create Playwright-based browser automation tools for the QA agent:

**Tool 1: `browser_navigate`**
- Description: "Open a URL in a headless browser and return the page content"
- Input: `url` (string), `waitForSelector` (optional string), `screenshotPath` (optional string)
- Implementation: launch Playwright chromium, navigate to URL, optionally wait for selector, optionally take screenshot, return page text content
- Agent whitelist: `['qa-architect']`

**Tool 2: `browser_test`**
- Description: "Run a Playwright test script to verify UI behavior"
- Input: `testCode` (string, JavaScript code using Playwright API), `baseUrl` (string)
- Implementation: write test code to a temp file, run with `npx playwright test` in sandbox, return pass/fail and output
- Agent whitelist: `['qa-architect']`

Handle Playwright installation gracefully: if browsers are not installed, catch the error and return a descriptive message suggesting `npx playwright install chromium`.

### 4B. Create external API stubs (`tools/api-stubs.ts`)

Create interface definitions and initial implementations for external service integrations. These should be functional for GitHub (most critical) and stub/interface-only for others:

**GitHub (functional via @octokit/rest):**
- Already covered by `git-tools.ts` and `ci-tools.ts`

**Jira (interface + stub):**
```typescript
interface JiraClient {
  createIssue(project: string, summary: string, description: string, type: string): Promise<{ key: string; url: string }>;
  updateIssue(key: string, updates: Record<string, any>): Promise<void>;
  getIssue(key: string): Promise<{ key: string; summary: string; status: string }>;
  transitionIssue(key: string, transitionName: string): Promise<void>;
}
```

**Supabase (interface + stub):**
```typescript
interface SupabaseClient {
  query(table: string, filters?: Record<string, any>): Promise<any[]>;
  insert(table: string, data: Record<string, any>): Promise<any>;
  update(table: string, id: string, data: Record<string, any>): Promise<any>;
  createMigration(name: string, sql: string): Promise<{ path: string }>;
}
```

**Vercel (interface + stub):**
```typescript
interface VercelClient {
  deploy(projectId: string, options?: { production?: boolean }): Promise<{ url: string; deploymentId: string }>;
  getDeploymentStatus(deploymentId: string): Promise<{ status: string; url: string }>;
  listDeployments(projectId: string, limit?: number): Promise<any[]>;
}
```

**WhatsApp (interface + stub):**
```typescript
interface WhatsAppClient {
  sendMessage(to: string, message: string): Promise<{ messageId: string }>;
  sendTemplate(to: string, templateName: string, params: Record<string, string>): Promise<{ messageId: string }>;
}
```

Each stub implementation should:
1. Check for the relevant environment variable (e.g., `JIRA_API_TOKEN`, `SUPABASE_URL`, `VERCEL_TOKEN`, `WHATSAPP_API_TOKEN`)
2. If not set, throw a descriptive error: `"Jira integration not configured. Set JIRA_API_TOKEN, JIRA_BASE_URL, and JIRA_EMAIL environment variables."`
3. If set, make the real API call using `fetch()` (no additional npm packages needed for REST APIs)

Export a `createExternalClients()` factory function that returns all clients.

---

## WORKSTREAM 5: Wire Tools into Agent Runner (Claude tool_use + Gemini Function Calling)

**Files to modify:**
- `/forge-team/gateway/src/agent-runner.ts`
- `/forge-team/gateway/src/index.ts`
- `/forge-team/gateway/src/server.ts`

### 5A. Add tool registry to AgentRunner

Modify the `AgentRunnerDeps` interface in `agent-runner.ts` to include:

```typescript
interface AgentRunnerDeps {
  modelRouter: ModelRouter;
  agentManager: AgentManager;
  sessionManager: SessionManager;
  toolRegistry: ToolRegistry;       // NEW
  sandboxManager: SandboxManager;   // NEW
}
```

Store these as private members in the `AgentRunner` class.

### 5B. Wire Anthropic tool_use into agent runner

In `agent-runner.ts`, modify the `callAnthropic()` method to support tool use:

1. Accept a `tools` parameter (the Anthropic-formatted tool definitions from `ToolRegistry.toAnthropicTools()`)
2. If tools are provided, pass them to `client.messages.create({ ..., tools })`
3. After receiving the response, check if any `content` block has `type === 'tool_use'`
4. If tool_use is requested:
   a. Extract the tool name and input from the response
   b. Call the tool via `ToolRegistry.get(name)` and execute it using the sandbox
   c. Send the tool result back to Claude in a follow-up message with `role: 'user'` and `content: [{ type: 'tool_result', tool_use_id, content }]`
   d. Repeat until Claude returns a `text` response (max 5 tool-use rounds to prevent infinite loops)
5. Sum up all input/output tokens across the full tool-use loop

### 5C. Wire Gemini function calling into agent runner

In `agent-runner.ts`, modify the `callGemini()` method to support function calling:

1. Accept a `tools` parameter (the Gemini-formatted function declarations from `ToolRegistry.toGeminiTools()`)
2. If tools are provided, pass them via `model.startChat({ tools: [{ functionDeclarations }] })`
3. After receiving the response, check for `functionCall` in the response parts
4. If function call is requested:
   a. Extract the function name and args
   b. Execute the tool via the sandbox
   c. Send the result back via `chat.sendMessage()` with a `functionResponse` part
   d. Repeat until Gemini returns a text response (max 5 rounds)
5. Sum up all tokens across the loop

### 5D. Modify `processUserMessage` to pass tools

In the `processUserMessage()` method of `AgentRunner`:

1. After routing the model, get the agent's available tools: `const tools = this.toolRegistry.listForAgent(agentId)`
2. If the agent has tools AND the model supports tool use (`routingResult.model.supportsTools`):
   a. Convert to the appropriate format based on provider
   b. Pass to `callAnthropic()` or `callGemini()`
3. If the agent has no tools or the model doesn't support them, call as before (no tools)

### 5E. Instantiate and wire in `index.ts`

In `/forge-team/gateway/src/index.ts`:

1. Import `ToolRegistry`, `SandboxManager`, and all tool modules
2. Instantiate after existing managers:
   ```typescript
   const toolRegistry = new ToolRegistry();
   const sandboxManager = new SandboxManager();
   ```
3. Register all tools:
   ```typescript
   import { registerCodeExecutorTool } from './tools/code-executor';
   import { registerTerminalTool } from './tools/terminal-tools';
   import { registerGitTools } from './tools/git-tools';
   import { registerCITools } from './tools/ci-tools';
   import { registerBrowserTools } from './tools/browser-tools';

   registerCodeExecutorTool(toolRegistry, sandboxManager);
   registerTerminalTool(toolRegistry, sandboxManager);
   registerGitTools(toolRegistry, sandboxManager);
   registerCITools(toolRegistry);
   registerBrowserTools(toolRegistry, sandboxManager);
   ```
4. Pass `toolRegistry` and `sandboxManager` to `AgentRunner`
5. Add cleanup on shutdown: `sandboxManager.destroyAll()` in the SIGTERM/SIGINT handler

### 5F. Add tool execution REST endpoints

In `/forge-team/gateway/src/index.ts`, add:

```typescript
// GET /api/tools — list all registered tools
app.get('/api/tools', (_req, res) => {
  res.json({ tools: toolRegistry.listAll() });
});

// GET /api/tools/:agentId — list tools available to a specific agent
app.get('/api/tools/:agentId', (req, res) => {
  const tools = toolRegistry.listForAgent(req.params.agentId as AgentId);
  res.json({ agentId: req.params.agentId, tools });
});

// GET /api/sandboxes — list active sandbox containers
app.get('/api/sandboxes', async (_req, res) => {
  const sandboxes = await sandboxManager.listActive();
  res.json({ sandboxes });
});
```

### 5G. Add tool execution WS message types

In `/forge-team/gateway/src/server.ts`, add new cases to the `handleMessage()` switch:

```
case 'tool.list':     → return tools available to the requesting agent
case 'tool.execute':  → execute a specific tool and return result (async)
```

The `tool.execute` handler should:
1. Verify the requesting client is an agent
2. Verify the tool is whitelisted for that agent
3. Execute the tool asynchronously
4. Send the result back when complete
5. Broadcast a `tool.executed` event to dashboards for monitoring

---

## WORKSTREAM 6: Update Docker Infrastructure for Sandboxing

**Files to modify:**
- `/forge-team/docker/docker-compose.yml`
- `/forge-team/docker/gateway.Dockerfile`

### 6A. Grant Docker socket access to gateway

In `/forge-team/docker/docker-compose.yml`, add a Docker socket volume mount to the gateway service so it can spawn sibling containers:

```yaml
gateway:
  # ... existing config ...
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
  # Add gateway to the group that owns the docker socket
  # On most systems this is group 999 or 'docker'
```

> **Security note**: Docker socket access is a significant privilege. In production, this should be replaced with a rootless Docker-in-Docker or Sysbox runtime. For the development environment, direct socket access is acceptable.

### 6B. Add sandbox network to Docker Compose

Add a dedicated network for sandboxed containers:

```yaml
networks:
  forgeteam:
    driver: bridge
    name: forgeteam-network
  sandbox:
    driver: bridge
    name: forgeteam-sandbox
    internal: true  # No external internet access by default
```

### 6C. Update Dockerfile for Playwright

In `/forge-team/docker/gateway.Dockerfile`, add Playwright browser installation to the builder stage:

```dockerfile
# After npm install, install Playwright browsers
RUN npx playwright install --with-deps chromium
```

This adds Chromium to the gateway image so QA browser tests can run.

### 6D. Add environment variables for external APIs

In `/forge-team/docker/docker-compose.yml`, add to the gateway environment:

```yaml
- GITHUB_TOKEN=${GITHUB_TOKEN:-}
- JIRA_API_TOKEN=${JIRA_API_TOKEN:-}
- JIRA_BASE_URL=${JIRA_BASE_URL:-}
- JIRA_EMAIL=${JIRA_EMAIL:-}
- SUPABASE_URL=${SUPABASE_URL:-}
- SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY:-}
- VERCEL_TOKEN=${VERCEL_TOKEN:-}
- WHATSAPP_API_TOKEN=${WHATSAPP_API_TOKEN:-}
```

Also add these placeholder entries to `/forge-team/.env.example`:

```
# --- Optional: External Integrations ---
GITHUB_TOKEN=your-github-personal-access-token
JIRA_API_TOKEN=your-jira-api-token
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your-email@example.com
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-key
VERCEL_TOKEN=your-vercel-token
WHATSAPP_API_TOKEN=your-whatsapp-api-token
```

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **tool-framework** — Handles WORKSTREAM 1 (install deps, create tool types, tool registry). This must complete first as other workstreams depend on it.
2. **sandbox-builder** — Handles WORKSTREAM 2 (SandboxManager, CodeExecutor, TerminalTool). Depends on WORKSTREAM 1 types.
3. **git-ci-builder** — Handles WORKSTREAM 3 (git tools, CI tools, GitHub integration). Depends on WORKSTREAM 1 types.
4. **browser-api-builder** — Handles WORKSTREAM 4 (Playwright browser tools, external API stubs). Depends on WORKSTREAM 1 types.
5. **agent-wirer** — Handles WORKSTREAM 5 (wire tools into agent-runner, index.ts, server.ts). Depends on ALL other workstreams.
6. **infra-updater** — Handles WORKSTREAM 6 (Docker config updates). Can run in parallel with everything.

**Dependency order**: WORKSTREAM 1 first. WORKSTREAMS 2, 3, 4, 6 in parallel. WORKSTREAM 5 last (after 1-4 complete).

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all work is complete, verify:

- [x] `dockerode`, `playwright`, and `@octokit/rest` are in `/forge-team/gateway/package.json` dependencies
- [x] `@types/dockerode` is in devDependencies
- [x] `/forge-team/gateway/src/tools/` directory exists with all files: `index.ts`, `types.ts`, `tool-registry.ts`, `sandbox-manager.ts`, `code-executor.ts`, `terminal-tools.ts`, `git-tools.ts`, `ci-tools.ts`, `browser-tools.ts`, `api-stubs.ts`
- [x] `ToolRegistry.toAnthropicTools()` returns a valid `tools` array for `@anthropic-ai/sdk`
- [x] `ToolRegistry.toGeminiTools()` returns valid function declarations for `@google/generative-ai`
- [x] `ToolRegistry.listForAgent('backend-dev')` returns code execution + git + terminal tools
- [x] `ToolRegistry.listForAgent('product-owner')` returns an empty array (no tools)
- [x] `ToolRegistry.listForAgent('qa-architect')` includes browser tools
- [x] `ToolRegistry.listForAgent('devops-engineer')` includes only CI tools, NOT code execution
- [x] `SandboxManager.createSandbox()` handles Docker daemon unavailability gracefully (returns error, does not crash)
- [x] `agent-runner.ts` `callAnthropic()` supports tool_use loop (max 5 rounds)
- [x] `agent-runner.ts` `callGemini()` supports function calling loop (max 5 rounds)
- [x] `processUserMessage()` only passes tools when agent is whitelisted AND model supports tools
- [x] REST endpoints respond: `GET /api/tools`, `GET /api/tools/:agentId`, `GET /api/sandboxes`
- [x] WS message types handled: `tool.list`, `tool.execute`
- [x] Docker socket volume mount added to gateway in `docker-compose.yml`
- [x] Sandbox network defined in `docker-compose.yml` with `internal: true`
- [x] External API env vars added to `.env.example` with placeholder values
- [x] All external API stubs throw descriptive errors when env vars are not set
- [x] `SandboxManager.destroyAll()` is called on gateway SIGTERM/SIGINT
- [x] `npx tsc --noEmit` in `/forge-team/gateway/` succeeds with zero errors (or only pre-existing errors)
- [x] All existing gateway functionality is preserved — no existing switch cases, routes, or handlers were removed
