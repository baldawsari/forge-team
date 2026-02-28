# Session 04 — Phase 4: Workflow Engine LangGraph Conversion + 30 BMAD Workflows

**Stream A, Day 7-9 | Depends on: Session 02 (LangGraph installed), Session 03 (VIADP nodes ready)**

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL items listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change.

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

**Workflow Engine (current custom state machine — to be replaced):**
- `/forge-team/gateway/src/workflow-engine.ts` — ~1800 lines, contains WorkflowLoader + WorkflowExecutor classes. Custom state machine with phase transitions, step deps, parallel execution, approval gates, checkpoints. NOT actual LangGraph.

**Existing Workflow YAMLs (4 of them — need 30+ more):**
- `/forge-team/workflows/full-sdlc.yaml` — 6 phases, 14 steps, 4 model overrides
- `/forge-team/workflows/bug-fix.yaml` — 6 phases, 11 steps, 0 model overrides
- `/forge-team/workflows/feature-sprint.yaml` — 7 phases, 19 steps, 1 model override
- `/forge-team/workflows/security-review.yaml` — 7 phases, 17 steps, 3 model overrides

**Shared Types:**
- `/forge-team/shared/types/workflow.ts` — WorkflowDefinition, WorkflowInstance, WorkflowPhase, WorkflowStep, YAMLPhaseDefinition, YAMLStepDefinition, TransitionType, ApprovalRequest, WorkflowCheckpoint, etc.
- `/forge-team/shared/types/agent.ts` — AgentId type

**VIADP Integration (from Session 03):**
- `/forge-team/gateway/src/langgraph-nodes/viadp-delegation-node.ts` — VIADP pre-step node
- `/forge-team/gateway/src/viadp-engine.ts` — thin wrapper around @forge-team/viadp

**Gateway Server:**
- `/forge-team/gateway/src/index.ts` — WebSocket server, REST routes. WorkflowExecutor is NEVER instantiated here (dead code per audit)
- `/forge-team/gateway/package.json` — should have `@langchain/langgraph` and `@langchain/langgraph-checkpoint-postgres` from Session 02

**Infrastructure:**
- `/forge-team/infrastructure/init.sql` — workflow_instances table, sessions table

**12 BMAD Agents (for workflow step assignments):**
- `bmad-master` — Orchestrator
- `product-owner` — Requirements
- `business-analyst` — Analysis
- `scrum-master` — Agile coordination (gemini-flash-3)
- `architect` — System design (claude-opus-4.6)
- `ux-designer` — UX/UI
- `frontend-dev` — Frontend code
- `backend-dev` — Backend & APIs (claude-opus-4.6)
- `qa-architect` — Testing & QA (claude-opus-4.6)
- `devops-engineer` — CI/CD
- `security-specialist` — Security (claude-opus-4.6)
- `tech-writer` — Documentation

---

## CRITICAL PROBLEM

The AUDIT-REPORT found:
1. **WorkflowExecutor is dead code** — it is never instantiated in `index.ts`. The entire workflow engine exists but is never used at runtime.
2. **Not actual LangGraph** — the engine says "LangGraph-style" but is a custom in-house state machine. No `@langchain/langgraph` StateGraph.
3. **Only 4 workflows** — need 34+ per the checklist.
4. **Model overrides recorded but not applied** — YAML `model_override` is parsed into `WorkflowStep.modelOverride` but never used when dispatching to agents.
5. **Checkpoints are in-memory only** — no DB persistence. Need Postgres-backed checkpoints.

---

## WORKSTREAM 1: Convert WorkflowExecutor to LangGraph StateGraph

**Files to modify:**
- `/forge-team/gateway/src/workflow-engine.ts` (MAJOR REWRITE of WorkflowExecutor section)

### 1A. Keep WorkflowLoader as-is

The `WorkflowLoader` class (first ~400 lines of workflow-engine.ts) is solid:
- Loads YAML files correctly
- Validates structure with good error messages
- Parses transitions, phases, steps
- `loadAllWorkflows()` scans the workflows directory

Keep it exactly as-is. Only modify the `WorkflowExecutor` class.

### 1B. Rewrite WorkflowExecutor using LangGraph StateGraph

Replace the custom state machine implementation with actual LangGraph:

```typescript
import { StateGraph, Annotation, MemorySaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
```

The new `WorkflowExecutor` class should:

1. **Define workflow state as a LangGraph Annotation:**
```typescript
const WorkflowState = Annotation.Root({
  workflowInstanceId: Annotation<string>,
  currentPhaseIndex: Annotation<number>,
  currentStepIndex: Annotation<number>,
  phaseStatuses: Annotation<Record<string, WorkflowStepStatus>>,
  stepStatuses: Annotation<Record<string, WorkflowStepStatus>>,
  outputs: Annotation<Record<string, unknown>>,
  pendingApprovals: Annotation<ApprovalRequest[]>,
  viadpContext: Annotation<Record<string, unknown> | null>,
  needsDelegation: Annotation<boolean>,
  delegationRequest: Annotation<Record<string, unknown> | null>,
  taskId: Annotation<string>,
  currentAgent: Annotation<string>,
  sessionId: Annotation<string>,
  error: Annotation<string | null>,
});
```

2. **Build a StateGraph from the YAML definition:**
```typescript
buildGraph(definition: WorkflowDefinition, sessionId: string): CompiledGraph {
  const graph = new StateGraph(WorkflowState);

  // For each phase in the YAML
  for (const phase of definition.phases) {
    // Add VIADP pre-check node (from Session 03)
    graph.addNode(`${phase.name}_viadp`, createViadpDelegationNode(this.viadpEngine));

    // Add phase execution node
    graph.addNode(`${phase.name}_execute`, this.createPhaseNode(phase));

    // Add checkpoint node (if phase.checkpoint === true)
    if (phase.checkpoint) {
      graph.addNode(`${phase.name}_checkpoint`, this.createCheckpointNode(phase.name));
    }

    // Add approval gate node (if transition requires approval)
    // ...
  }

  // Wire edges based on YAML transitions
  for (const [transitionKey, transitionType] of Object.entries(definition.transitions)) {
    const [fromPhase, toPhase] = transitionKey.split(' -> ');
    // ... wire conditional edges for approval gates
  }

  return graph.compile({ checkpointer: this.checkpointer });
}
```

3. **Create phase execution nodes** that handle:
   - Parallel step execution (steps with `parallel: true` run concurrently)
   - Step dependency resolution (`depends_on` — wait for dependencies before executing)
   - Per-step model override application (pass `modelOverride` to agent execution)
   - Approval gate pausing (steps with `approval_required: true` pause and wait)

4. **Use Postgres-backed checkpoints:**
```typescript
const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL || 'postgresql://forgeteam:forgeteam_secret@localhost:5432/forgeteam');
await checkpointer.setup(); // Creates checkpoint tables
```

If `@langchain/langgraph-checkpoint-postgres` is not available or DATABASE_URL is not set, fall back to `MemorySaver`:
```typescript
const checkpointer = process.env.DATABASE_URL
  ? PostgresSaver.fromConnString(process.env.DATABASE_URL)
  : new MemorySaver();
```

### 1C. Support all BMAD YAML features

The new LangGraph-based executor must support:

| YAML Feature | How It Maps to LangGraph |
|---|---|
| `phases[].steps[].parallel: true` | Multiple nodes execute concurrently within a phase node |
| `phases[].steps[].depends_on` | Conditional edges — wait for dependency steps to complete |
| `phases[].steps[].approval_required` | Node returns `__interrupt__` to pause graph execution |
| `phases[].checkpoint: true` | Checkpoint is saved after phase node completes |
| `transitions: requires_approval` | Conditional edge with human-in-the-loop interrupt |
| `transitions: auto` | Direct edge to next phase node |
| `phases[].steps[].model_override` | Passed to agent execution function |

### 1D. Apply per-step model overrides

Currently `WorkflowStep.modelOverride` is populated from YAML but never used when dispatching to agents. Fix this:

In the step execution logic, when calling the agent/model router:
```typescript
if (step.modelOverride) {
  // Pass the override to the model router so it uses this model
  // instead of the agent's default
  executionOptions.modelOverride = step.modelOverride;
}
```

This must work with the gateway's `ModelRouter.routeRequest()` which already accepts model preferences.

### 1E. Preserve EventEmitter events

The existing WorkflowExecutor emits events via EventEmitter. Keep all event emissions:
- `workflow.instance.started`, `workflow.instance.completed`, `workflow.instance.failed`
- `workflow.phase.started`, `workflow.phase.completed`, `workflow.phase.failed`
- `workflow.step.started`, `workflow.step.completed`, `workflow.step.failed`
- `workflow.step.approval_requested`, `workflow.step.approval_resolved`
- `workflow.checkpoint.created`
- `workflow.progress.updated`

These events drive the dashboard's real-time workflow tracking panel.

### 1F. Keep pause/resume/restart methods

The existing `pauseWorkflow()`, `resumeWorkflow()`, `restartFromCheckpoint()` must still work. With LangGraph:
- Pause: Save state to checkpoint and stop graph execution
- Resume: Load from checkpoint and continue
- Restart from checkpoint: Load specific checkpoint and restart

### Verification
- `npx tsc --noEmit` passes for the workflow-engine.ts
- WorkflowLoader still loads and validates all 4 existing YAMLs
- WorkflowExecutor.buildGraph() creates a valid StateGraph from a YAML definition
- The StateGraph has VIADP nodes injected before each phase
- Postgres checkpointer is used when DATABASE_URL is set
- EventEmitter events are still emitted during execution

---

## WORKSTREAM 2: Wire WorkflowExecutor into Gateway

**Files to modify:**
- `/forge-team/gateway/src/index.ts`

### 2A. Instantiate WorkflowExecutor

In `gateway/src/index.ts`, the audit found that WorkflowExecutor is never instantiated. Fix this:

1. Import WorkflowExecutor and WorkflowLoader
2. After AgentManager and VIADPEngine are created, instantiate:
```typescript
const workflowLoader = new WorkflowLoader(path.resolve(__dirname, '../../workflows'));
const workflowExecutor = new WorkflowExecutor(workflowLoader, viadpEngine, {
  checkpointerType: process.env.DATABASE_URL ? 'postgres' : 'memory',
  databaseUrl: process.env.DATABASE_URL,
});
```

3. Wire event listeners to broadcast workflow updates via WebSocket:
```typescript
workflowExecutor.on('workflow.progress.updated', (event) => {
  io.emit('workflow_update', event);
});
workflowExecutor.on('workflow.step.approval_requested', (event) => {
  io.emit('approval_requested', event);
});
```

### 2B. Add WebSocket command handlers for workflow operations

Add handlers for these WS messages:

```typescript
// Start a workflow
socket.on('workflow:start', async (data: { workflowName: string; projectName: string; sessionId: string }) => {
  const definition = workflowLoader.getWorkflow(data.workflowName);
  if (definition) {
    const instance = await workflowExecutor.startWorkflow(definition, data.sessionId, data.projectName);
    socket.emit('workflow:started', { instanceId: instance.id, workflowName: data.workflowName });
  }
});

// Approve a step
socket.on('workflow:approve', async (data: { instanceId: string; approvalId: string; comment?: string }) => {
  await workflowExecutor.resolveApproval(data.instanceId, data.approvalId, true, data.comment);
});

// Reject a step
socket.on('workflow:reject', async (data: { instanceId: string; approvalId: string; comment?: string }) => {
  await workflowExecutor.resolveApproval(data.instanceId, data.approvalId, false, data.comment);
});

// Pause workflow
socket.on('workflow:pause', async (data: { instanceId: string }) => {
  await workflowExecutor.pauseWorkflow(data.instanceId);
});

// Resume workflow
socket.on('workflow:resume', async (data: { instanceId: string }) => {
  await workflowExecutor.resumeWorkflow(data.instanceId);
});

// List available workflows
socket.on('workflow:list', () => {
  const workflows = workflowLoader.getAllWorkflows();
  socket.emit('workflow:list', workflows.map(w => ({ name: w.name, description: w.description, phases: w.phases.length })));
});
```

### 2C. Add REST endpoints for workflows

Add to the Express routes:

```typescript
app.get('/api/workflows', (req, res) => {
  const workflows = workflowLoader.getAllWorkflows();
  res.json({ workflows: workflows.map(w => ({ name: w.name, version: w.version, description: w.description, phaseCount: w.phases.length })) });
});

app.get('/api/workflows/:name', (req, res) => {
  const workflow = workflowLoader.getWorkflow(req.params.name);
  if (workflow) res.json({ workflow });
  else res.status(404).json({ error: 'Workflow not found' });
});

app.get('/api/workflow-instances', (req, res) => {
  const instances = workflowExecutor.getAllInstances();
  res.json({ instances });
});

app.get('/api/workflow-instances/:id', (req, res) => {
  const instance = workflowExecutor.getInstance(req.params.id);
  if (instance) res.json({ instance });
  else res.status(404).json({ error: 'Instance not found' });
});
```

### Verification
- Gateway starts without errors
- `workflow:list` WS command returns the loaded workflows
- `workflow:start` creates a new instance and begins execution
- Workflow progress events are broadcast via WebSocket
- REST endpoints return workflow data

---

## WORKSTREAM 3: Create 30+ BMAD Workflow YAMLs

**Files to create in `/forge-team/workflows/`:**

All workflows follow the same YAML structure as the existing 4. Each must have:
- `name`, `version: "1.0"`, `description`
- `phases` with `display_name`, `display_name_ar`, `agents`, `steps`, `checkpoint`
- `transitions` between phases (`auto` or `requires_approval`)
- Steps with `agent`, `action`, `outputs`, and optionally `inputs`, `depends_on`, `parallel`, `approval_required`, `model_override`
- Realistic Arabic display names for every phase

Use `claude-opus-4.6` as `model_override` for steps requiring deep analysis (architecture review, security audit, complex backend logic). Use `gemini-flash-3` override for fast/routine steps (status updates, simple scans).

### Workflow YAMLs to create:

**Development Workflows (10):**

| # | File | Name | Phases | Key Agents |
|---|------|------|--------|------------|
| 1 | `code-review.yaml` | Code Review Pipeline | scope -> static-analysis -> review -> feedback -> resolution | qa-architect, security-specialist, architect |
| 2 | `hotfix.yaml` | Emergency Hotfix | triage -> fix -> test -> deploy | backend-dev, qa-architect, devops-engineer |
| 3 | `api-design.yaml` | API Design & Documentation | requirements -> design -> spec -> review -> docs | architect, backend-dev, tech-writer |
| 4 | `database-design.yaml` | Database Schema Design | requirements -> modeling -> migration -> review -> docs | architect, backend-dev, qa-architect |
| 5 | `ui-redesign.yaml` | UI/UX Redesign | research -> wireframe -> prototype -> implement -> test | ux-designer, frontend-dev, qa-architect |
| 6 | `performance-tuning.yaml` | Performance Optimization | profiling -> analysis -> optimization -> benchmark -> deploy | backend-dev, devops-engineer, qa-architect |
| 7 | `refactoring.yaml` | Code Refactoring | analysis -> planning -> refactor -> test -> review | architect, backend-dev, qa-architect |
| 8 | `migration.yaml` | System Migration | assessment -> planning -> migration -> validation -> cutover | architect, devops-engineer, backend-dev |
| 9 | `microservice-extraction.yaml` | Microservice Extraction | analysis -> boundaries -> extract -> test -> deploy | architect, backend-dev, devops-engineer |
| 10 | `tech-debt-reduction.yaml` | Technical Debt Reduction | audit -> prioritize -> fix -> test -> document | architect, backend-dev, qa-architect, tech-writer |

**Operations Workflows (8):**

| # | File | Name | Phases | Key Agents |
|---|------|------|--------|------------|
| 11 | `incident-response.yaml` | Incident Response | detection -> triage -> mitigate -> resolve -> postmortem | devops-engineer, backend-dev, security-specialist |
| 12 | `monitoring-setup.yaml` | Monitoring & Alerting Setup | requirements -> instrumentation -> dashboards -> alerts -> test | devops-engineer, backend-dev |
| 13 | `ci-cd-pipeline.yaml` | CI/CD Pipeline Setup | design -> build -> test -> deploy-stages -> validation | devops-engineer, qa-architect |
| 14 | `infrastructure-audit.yaml` | Infrastructure Audit | inventory -> security-scan -> compliance -> cost -> report | devops-engineer, security-specialist, tech-writer |
| 15 | `disaster-recovery.yaml` | Disaster Recovery Plan | analysis -> backup-strategy -> recovery-plan -> drill -> docs | devops-engineer, architect, security-specialist |
| 16 | `capacity-planning.yaml` | Capacity Planning | current-analysis -> forecast -> scaling-plan -> implement -> monitor | devops-engineer, architect |
| 17 | `release-management.yaml` | Release Management | planning -> staging -> validation -> release -> monitoring | devops-engineer, qa-architect, scrum-master |
| 18 | `environment-setup.yaml` | Development Environment Setup | requirements -> provisioning -> configuration -> testing -> docs | devops-engineer, tech-writer |

**Quality & Security Workflows (6):**

| # | File | Name | Phases | Key Agents |
|---|------|------|--------|------------|
| 19 | `accessibility-audit.yaml` | Accessibility Audit (WCAG) | scope -> automated-scan -> manual-review -> remediation -> report | ux-designer, frontend-dev, qa-architect |
| 20 | `compliance-check.yaml` | Regulatory Compliance Check | scope -> data-audit -> policy-review -> gap-analysis -> report | security-specialist, business-analyst, tech-writer |
| 21 | `penetration-test.yaml` | Penetration Testing | scoping -> reconnaissance -> exploitation -> reporting -> remediation | security-specialist, architect |
| 22 | `load-test.yaml` | Load & Stress Testing | design -> setup -> execute -> analyze -> report | qa-architect, devops-engineer, backend-dev |
| 23 | `e2e-test-suite.yaml` | E2E Test Suite Creation | analysis -> framework-setup -> test-creation -> execution -> maintenance | qa-architect, frontend-dev, backend-dev |
| 24 | `security-hardening.yaml` | Security Hardening | assessment -> network -> application -> data -> verification | security-specialist, devops-engineer, architect |

**Project Management Workflows (6):**

| # | File | Name | Phases | Key Agents |
|---|------|------|--------|------------|
| 25 | `onboarding.yaml` | New Developer Onboarding | orientation -> environment -> codebase -> first-task -> review | scrum-master, tech-writer, architect |
| 26 | `documentation-update.yaml` | Documentation Update | audit -> plan -> write -> review -> publish | tech-writer, architect, product-owner |
| 27 | `sprint-retrospective.yaml` | Sprint Retrospective | data-collection -> analysis -> discussion -> action-items -> followup | scrum-master, product-owner |
| 28 | `project-kickoff.yaml` | Project Kickoff | discovery -> requirements -> team-setup -> architecture -> sprint-0 | product-owner, architect, scrum-master, bmad-master |
| 29 | `stakeholder-report.yaml` | Stakeholder Progress Report | data-gathering -> analysis -> report-writing -> review -> presentation | product-owner, scrum-master, tech-writer |
| 30 | `estimation-workshop.yaml` | Estimation Workshop | backlog-review -> complexity-assessment -> estimation -> planning -> commitment | scrum-master, architect, product-owner |

### Per-Workflow YAML Template

Each workflow should follow this structure (example for `code-review.yaml`):

```yaml
name: Code Review Pipeline
version: "1.0"
description: Structured code review workflow with static analysis and peer review

phases:
  - name: scope_definition
    display_name: "Review Scope"
    display_name_ar: "نطاق المراجعة"
    agents: [architect, qa-architect]
    steps:
      - name: define_review_scope
        agent: architect
        action: define_code_review_scope
        outputs: [review_scope, affected_modules, risk_areas]
        approval_required: false
      - name: select_reviewers
        agent: qa-architect
        action: assign_reviewers
        inputs: [review_scope, risk_areas]
        outputs: [reviewer_assignments, review_checklist]
        depends_on: [define_review_scope]
    checkpoint: true

  - name: static_analysis
    display_name: "Static Analysis"
    display_name_ar: "التحليل الثابت"
    agents: [qa-architect, security-specialist]
    steps:
      - name: run_linters
        agent: qa-architect
        action: run_static_analysis
        outputs: [lint_results, code_quality_score]
        parallel: true
      - name: security_scan
        agent: security-specialist
        model_override: claude-opus-4.6
        action: run_security_scan
        outputs: [security_findings, vulnerability_report]
        parallel: true
    checkpoint: true

  # ... more phases ...

transitions:
  scope_definition -> static_analysis: auto
  static_analysis -> peer_review: auto
  peer_review -> feedback_resolution: auto
  feedback_resolution -> final_approval: requires_approval
```

### 3A. Create the Riyadh Attendance Tracker workflow

Create `/forge-team/workflows/riyadh-attendance-tracker.yaml` as the reference test case:

```yaml
name: Riyadh Attendance Tracker
version: "1.0"
description: Full SDLC pipeline for building the Riyadh Attendance Tracker with Saudization compliance module

phases:
  - name: requirements
    display_name: "Requirements & Compliance Research"
    display_name_ar: "المتطلبات وبحث الامتثال"
    agents: [product-owner, business-analyst]
    steps:
      - name: gather_requirements
        agent: product-owner
        action: gather_attendance_requirements
        outputs: [user_stories, saudization_rules, compliance_requirements]
        approval_required: true
      - name: compliance_research
        agent: business-analyst
        action: research_saudi_labor_law
        outputs: [labor_law_summary, nitaqat_rules, attendance_regulations]
        parallel: true
      - name: finalize_requirements
        agent: product-owner
        action: finalize_requirements_doc
        inputs: [user_stories, saudization_rules, labor_law_summary]
        outputs: [prd, acceptance_criteria]
        depends_on: [gather_requirements, compliance_research]
    checkpoint: true

  - name: architecture
    display_name: "System Architecture"
    display_name_ar: "تصميم النظام"
    agents: [architect]
    steps:
      - name: design_system
        agent: architect
        model_override: claude-opus-4.6
        action: design_attendance_system
        inputs: [prd, saudization_rules]
        outputs: [system_diagram, api_spec, db_schema, auth_design]
        approval_required: true
      - name: design_saudization_module
        agent: architect
        model_override: claude-opus-4.6
        action: design_compliance_module
        inputs: [nitaqat_rules, attendance_regulations]
        outputs: [compliance_module_design, integration_plan]
        depends_on: [design_system]
    checkpoint: true

  - name: ux_design
    display_name: "UX/UI Design"
    display_name_ar: "تصميم الواجهة"
    agents: [ux-designer]
    steps:
      - name: create_wireframes
        agent: ux-designer
        action: design_attendance_ui
        inputs: [prd, system_diagram]
        outputs: [wireframes, component_specs, rtl_layout, arabic_ui_kit]
    checkpoint: true

  - name: backend_development
    display_name: "Backend Development"
    display_name_ar: "تطوير الخلفية"
    agents: [backend-dev]
    steps:
      - name: implement_api
        agent: backend-dev
        model_override: claude-opus-4.6
        action: implement_attendance_api
        inputs: [api_spec, db_schema]
        outputs: [api_code, db_migrations, api_tests]
      - name: implement_saudization
        agent: backend-dev
        model_override: claude-opus-4.6
        action: implement_compliance_module
        inputs: [compliance_module_design, integration_plan]
        outputs: [compliance_code, compliance_tests]
        depends_on: [implement_api]
    checkpoint: true

  - name: frontend_development
    display_name: "Frontend Development"
    display_name_ar: "تطوير الواجهة"
    agents: [frontend-dev]
    steps:
      - name: implement_ui
        agent: frontend-dev
        action: implement_attendance_ui
        inputs: [wireframes, component_specs, rtl_layout]
        outputs: [frontend_code, component_library, rtl_styles]
      - name: integrate_frontend_backend
        agent: frontend-dev
        action: integrate_with_api
        inputs: [api_code, frontend_code]
        outputs: [integrated_app, integration_tests]
        depends_on: [implement_ui]
    checkpoint: true

  - name: testing
    display_name: "Testing & QA"
    display_name_ar: "الاختبار وضمان الجودة"
    agents: [qa-architect, security-specialist]
    steps:
      - name: functional_testing
        agent: qa-architect
        model_override: claude-opus-4.6
        action: run_functional_tests
        inputs: [integrated_app, acceptance_criteria]
        outputs: [test_results, bug_list, coverage_report]
      - name: compliance_testing
        agent: qa-architect
        action: test_saudization_compliance
        inputs: [compliance_code, nitaqat_rules]
        outputs: [compliance_test_results, compliance_score]
        depends_on: [functional_testing]
      - name: security_audit
        agent: security-specialist
        model_override: claude-opus-4.6
        action: audit_attendance_security
        inputs: [integrated_app, auth_design]
        outputs: [security_report, threat_model, remediation_plan]
        parallel: true
      - name: arabic_rtl_testing
        agent: qa-architect
        action: test_arabic_rtl
        inputs: [frontend_code, rtl_styles]
        outputs: [rtl_test_results, localization_report]
        parallel: true
    checkpoint: true

  - name: deployment
    display_name: "Deployment"
    display_name_ar: "النشر"
    agents: [devops-engineer]
    steps:
      - name: setup_infrastructure
        agent: devops-engineer
        action: provision_riyadh_infra
        outputs: [infra_config, riyadh_vpc, monitoring_setup]
      - name: deploy_application
        agent: devops-engineer
        action: deploy_to_riyadh
        inputs: [integrated_app, infra_config]
        outputs: [deployment_url, health_checks, rollback_plan]
        depends_on: [setup_infrastructure]
        approval_required: true
    checkpoint: true

  - name: documentation
    display_name: "Documentation"
    display_name_ar: "التوثيق"
    agents: [tech-writer]
    steps:
      - name: write_docs
        agent: tech-writer
        action: write_attendance_docs
        inputs: [api_spec, prd, deployment_url]
        outputs: [api_docs, user_guide, admin_guide, compliance_handbook]
    checkpoint: true

transitions:
  requirements -> architecture: requires_approval
  architecture -> ux_design: auto
  ux_design -> backend_development: auto
  backend_development -> frontend_development: auto
  frontend_development -> testing: auto
  testing -> deployment: requires_approval
  deployment -> documentation: auto
```

### Verification
- All 30+ new YAML files exist in `/forge-team/workflows/`
- Each YAML has valid structure (name, phases, transitions)
- Each phase has `display_name_ar` (Arabic name)
- `WorkflowLoader.loadAllWorkflows()` successfully loads all 34+ YAMLs without validation errors
- Model overrides use only: `claude-opus-4.6`, `claude-sonnet-4.6`, `gemini-flash-3`
- `riyadh-attendance-tracker.yaml` exists with 9 phases covering the full SDLC

---

## WORKSTREAM 4: Inject VIADP Delegation Before Every Agent Step

**Files to modify:**
- `/forge-team/gateway/src/workflow-engine.ts` (WorkflowExecutor section)

### 4A. Import VIADP delegation node

At the top of the WorkflowExecutor section:
```typescript
import { createViadpDelegationNode } from './langgraph-nodes/viadp-delegation-node';
```

### 4B. Insert VIADP node before every phase execution

When building the LangGraph StateGraph, for every phase:
1. Add a VIADP assessment node before the phase execution node
2. Wire the edge: `__start__ -> phase1_viadp -> phase1_execute -> phase1_checkpoint -> phase2_viadp -> ...`

The VIADP node runs the delegation protocol for the agent assigned to the first step of the phase. If delegation is rejected (risk too high), the workflow pauses and requests human approval.

### 4C. Pass VIADP context to step execution

When a step executes, the VIADP context (delegation token, trust score, risk score) should be available:
```typescript
const stepResult = await this.executeAgentStep(step, {
  ...executionContext,
  viadpToken: state.viadpContext?.token,
  modelOverride: step.modelOverride,
});
```

### Verification
- Every phase in a built LangGraph has a VIADP pre-check node
- The VIADP node runs before agent execution
- If VIADP rejects (risk=critical), the workflow pauses

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **langgraph-converter** — Handles WORKSTREAM 1 (convert WorkflowExecutor to LangGraph StateGraph, Postgres checkpoints, model override application)
2. **gateway-wirer** — Handles WORKSTREAM 2 (instantiate WorkflowExecutor in gateway, WS commands, REST endpoints) — depends on WORKSTREAM 1
3. **workflow-author-1** — Handles WORKSTREAM 3 workflows 1-10 (Development workflows)
4. **workflow-author-2** — Handles WORKSTREAM 3 workflows 11-20 (Operations + Quality workflows)
5. **workflow-author-3** — Handles WORKSTREAM 3 workflows 21-31 (remaining Quality + Project Management + Riyadh Attendance Tracker)
6. **viadp-injector** — Handles WORKSTREAM 4 (VIADP injection into workflow graph) — depends on WORKSTREAM 1

Dependency chain: WS1 -> WS2, WS4
Independent: WS3 (all three workflow authors can start immediately)

---

## FINAL CHECKLIST

After all workstreams complete, verify:

- [ ] `npx tsc --noEmit` succeeds in `/forge-team/gateway/` with zero errors
- [ ] WorkflowLoader loads all 34+ YAMLs: `workflowLoader.getAllWorkflows().length >= 34`
- [ ] WorkflowExecutor uses `StateGraph` from `@langchain/langgraph` (not custom state machine)
- [ ] WorkflowExecutor uses `PostgresSaver` when DATABASE_URL is set
- [ ] WorkflowExecutor falls back to `MemorySaver` when DATABASE_URL is not set
- [ ] WorkflowExecutor is instantiated in `gateway/src/index.ts` (no longer dead code)
- [ ] WebSocket commands `workflow:start`, `workflow:pause`, `workflow:resume`, `workflow:approve`, `workflow:reject`, `workflow:list` are handled
- [ ] REST endpoints `/api/workflows`, `/api/workflows/:name`, `/api/workflow-instances` exist
- [ ] Every phase in the LangGraph has a VIADP pre-check node
- [ ] Per-step `model_override` is passed to the agent execution function
- [ ] `riyadh-attendance-tracker.yaml` exists with 9 phases and Saudization compliance steps
- [ ] All YAML files have `display_name_ar` for every phase
- [ ] All workflow event types are emitted and broadcast via WebSocket
- [ ] `pauseWorkflow()` and `resumeWorkflow()` save/restore from checkpoints
- [ ] No `gpt-4o` or `gpt-4o-mini` appears in any workflow YAML model_override
- [ ] All model_override values are from: `claude-opus-4.6`, `claude-sonnet-4.6`, `claude-haiku-4.5`, `gemini-3.1-pro`, `gemini-flash-3`
