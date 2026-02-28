/**
 * ForgeTeam Workflow Engine
 *
 * Core workflow engine that:
 * 1. Loads BMAD YAML workflow files
 * 2. Uses LangGraph StateGraph for execution
 * 3. Manages workflow execution with Postgres checkpoints
 * 4. Handles phase transitions, approvals via LangGraph interrupt
 * 5. Emits real-time progress updates
 * 6. Supports pause/resume/restart from any checkpoint
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse as parseYAML } from 'yaml';
import EventEmitter from 'eventemitter3';

import type {
  AgentId,
  WorkflowDefinition,
  YAMLPhaseDefinition,
  YAMLStepDefinition,
  TransitionType,
  WorkflowInstance,
  WorkflowInstanceStatus,
  WorkflowPhase,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowCheckpoint,
  WorkflowInstanceState,
  WorkflowProgress,
  WorkflowHistoryEntry,
  WorkflowEvent,
  WorkflowEventType,
  ApprovalRequest,
  StepResult,
  PhaseResult,
  PipelineConfig,
} from '@forge-team/shared';

import type { AgentManager } from './agent-manager';
import type { ModelRouter } from './model-router';
import type { VIADPEngine } from './viadp-engine';
import { MemorySaver, type BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresCheckpointSaver, buildWorkflowGraph } from './langgraph';
import type { WorkflowStateType } from './langgraph';
import { createViadpDelegationNode } from './langgraph-nodes/viadp-delegation-node';

// ============================================================================
// WorkflowLoader - Parse YAML files, validate structure
// ============================================================================

/** Validation error thrown when a YAML workflow file is malformed */
export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly details: string[]
  ) {
    super(`Workflow validation failed for ${filePath}: ${message}`);
    this.name = 'WorkflowValidationError';
  }
}

/** Loads and validates YAML workflow definitions from the filesystem */
export class WorkflowLoader {
  private readonly workflowsDir: string;
  private readonly cache: Map<string, WorkflowDefinition> = new Map();

  constructor(workflowsDir: string) {
    this.workflowsDir = resolve(workflowsDir);
  }

  /**
   * Load a single workflow definition from a YAML file.
   * Results are cached by file path.
   */
  loadWorkflow(filePath: string): WorkflowDefinition {
    const resolvedPath = resolve(this.workflowsDir, filePath);

    const cached = this.cache.get(resolvedPath);
    if (cached) {
      return cached;
    }

    if (!existsSync(resolvedPath)) {
      throw new Error(`Workflow file not found: ${resolvedPath}`);
    }

    const raw = readFileSync(resolvedPath, 'utf-8');
    const parsed = parseYAML(raw) as Record<string, unknown>;
    const definition = this.parseDefinition(parsed, resolvedPath);

    this.validate(definition, resolvedPath);
    this.cache.set(resolvedPath, definition);

    return definition;
  }

  /**
   * Load all workflow definitions from the workflows directory.
   */
  loadAllWorkflows(): Map<string, WorkflowDefinition> {
    const results = new Map<string, WorkflowDefinition>();

    if (!existsSync(this.workflowsDir)) {
      throw new Error(`Workflows directory not found: ${this.workflowsDir}`);
    }

    const files = readdirSync(this.workflowsDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml')
    );

    for (const file of files) {
      const key = basename(file, file.endsWith('.yaml') ? '.yaml' : '.yml');
      results.set(key, this.loadWorkflow(file));
    }

    return results;
  }

  /**
   * List available workflow files without loading them.
   */
  listWorkflows(): string[] {
    if (!existsSync(this.workflowsDir)) {
      return [];
    }

    return readdirSync(this.workflowsDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml')
    );
  }

  /**
   * Clear the definition cache, forcing reload on next access.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Parse a raw YAML object into a WorkflowDefinition.
   */
  private parseDefinition(
    raw: Record<string, unknown>,
    filePath: string
  ): WorkflowDefinition {
    const transitions: Record<string, TransitionType> = {};

    if (raw.transitions && typeof raw.transitions === 'object') {
      const rawTransitions = raw.transitions as Record<string, string>;
      for (const [key, value] of Object.entries(rawTransitions)) {
        const normalizedKey = key.replace(/\s+/g, ' ').trim();
        const normalizedValue = value.trim() as TransitionType;
        if (normalizedValue !== 'auto' && normalizedValue !== 'requires_approval') {
          throw new WorkflowValidationError(
            `Invalid transition type: "${normalizedValue}"`,
            filePath,
            [`Transition "${normalizedKey}" has invalid type. Expected "auto" or "requires_approval".`]
          );
        }
        transitions[normalizedKey] = normalizedValue;
      }
    }

    const phases: YAMLPhaseDefinition[] = [];
    if (Array.isArray(raw.phases)) {
      for (const rawPhase of raw.phases as Record<string, unknown>[]) {
        const steps: YAMLStepDefinition[] = [];
        if (Array.isArray(rawPhase.steps)) {
          for (const rawStep of rawPhase.steps as Record<string, unknown>[]) {
            steps.push({
              name: String(rawStep.name || ''),
              agent: String(rawStep.agent || '') as AgentId,
              action: String(rawStep.action || ''),
              model_override: rawStep.model_override != null
                ? String(rawStep.model_override)
                : undefined,
              inputs: Array.isArray(rawStep.inputs)
                ? (rawStep.inputs as string[])
                : undefined,
              outputs: Array.isArray(rawStep.outputs)
                ? (rawStep.outputs as string[])
                : undefined,
              depends_on: Array.isArray(rawStep.depends_on)
                ? (rawStep.depends_on as string[])
                : undefined,
              parallel: typeof rawStep.parallel === 'boolean'
                ? rawStep.parallel
                : undefined,
              approval_required: typeof rawStep.approval_required === 'boolean'
                ? rawStep.approval_required
                : undefined,
            });
          }
        }

        phases.push({
          name: String(rawPhase.name || ''),
          display_name: String(rawPhase.display_name || rawPhase.name || ''),
          display_name_ar: String(rawPhase.display_name_ar || ''),
          agents: Array.isArray(rawPhase.agents)
            ? (rawPhase.agents as AgentId[])
            : [],
          model_override: rawPhase.model_override != null
            ? String(rawPhase.model_override)
            : undefined,
          steps,
          checkpoint: rawPhase.checkpoint === true,
        });
      }
    }

    return {
      name: String(raw.name || ''),
      version: String(raw.version || '1.0'),
      description: String(raw.description || ''),
      phases,
      transitions,
    };
  }

  /**
   * Validate a parsed workflow definition for structural correctness.
   */
  private validate(definition: WorkflowDefinition, filePath: string): void {
    const errors: string[] = [];

    if (!definition.name) {
      errors.push('Workflow must have a "name" field.');
    }

    if (definition.phases.length === 0) {
      errors.push('Workflow must have at least one phase.');
    }

    const phaseNames = new Set<string>();
    for (const phase of definition.phases) {
      if (!phase.name) {
        errors.push('Every phase must have a "name" field.');
        continue;
      }

      if (phaseNames.has(phase.name)) {
        errors.push(`Duplicate phase name: "${phase.name}".`);
      }
      phaseNames.add(phase.name);

      if (phase.steps.length === 0) {
        errors.push(`Phase "${phase.name}" must have at least one step.`);
      }

      const stepNames = new Set<string>();
      for (const step of phase.steps) {
        if (!step.name) {
          errors.push(`Phase "${phase.name}" has a step without a name.`);
          continue;
        }

        if (stepNames.has(step.name)) {
          errors.push(`Phase "${phase.name}" has duplicate step name: "${step.name}".`);
        }
        stepNames.add(step.name);

        if (!step.agent) {
          errors.push(`Step "${step.name}" in phase "${phase.name}" must have an "agent" field.`);
        }

        if (!step.action) {
          errors.push(`Step "${step.name}" in phase "${phase.name}" must have an "action" field.`);
        }

        // Validate depends_on references exist within the same phase
        if (step.depends_on) {
          for (const dep of step.depends_on) {
            if (!stepNames.has(dep) && !phase.steps.some((s) => s.name === dep)) {
              errors.push(
                `Step "${step.name}" in phase "${phase.name}" depends on ` +
                `unknown step "${dep}". Dependencies must reference steps within the same phase.`
              );
            }
          }
        }
      }
    }

    // Validate transitions reference existing phases
    for (const transitionKey of Object.keys(definition.transitions)) {
      const match = transitionKey.match(/^(.+?)\s*->\s*(.+)$/);
      if (!match) {
        errors.push(`Invalid transition key format: "${transitionKey}". Expected "phaseA -> phaseB".`);
        continue;
      }
      const [, fromPhase, toPhase] = match;
      if (!phaseNames.has(fromPhase.trim())) {
        errors.push(`Transition references unknown source phase: "${fromPhase.trim()}".`);
      }
      if (!phaseNames.has(toPhase.trim())) {
        errors.push(`Transition references unknown target phase: "${toPhase.trim()}".`);
      }
    }

    if (errors.length > 0) {
      throw new WorkflowValidationError(
        `Found ${errors.length} validation error(s)`,
        filePath,
        errors
      );
    }
  }
}

// ============================================================================
// WorkflowExecutor - LangGraph-backed workflow execution engine
// ============================================================================

/** Event types emitted by the new workflow engine */
export interface WorkflowEngineEvents {
  'workflow:started': (instance: WorkflowInstance) => void;
  'workflow:phase-changed': (instance: WorkflowInstance, phase: WorkflowPhase) => void;
  'workflow:step-completed': (instance: WorkflowInstance, step: { phaseName: string; stepName: string; result: StepResult }) => void;
  'workflow:waiting-approval': (instance: WorkflowInstance, approval: ApprovalRequest) => void;
  'workflow:completed': (instance: WorkflowInstance) => void;
  'workflow:failed': (instance: WorkflowInstance, error: string) => void;
  // Legacy events preserved for backward compat
  'workflow:event': (event: WorkflowEvent) => void;
  'workflow:progress': (instanceId: string, progress: WorkflowProgress) => void;
}

/** Dependencies required to construct the WorkflowExecutor */
export interface WorkflowExecutorDeps {
  workflowsDir: string;
  agentManager: AgentManager;
  modelRouter: ModelRouter;
  viadpEngine: VIADPEngine;
  databaseUrl: string;
}

/**
 * LangGraph-backed workflow engine.
 *
 * Uses LangGraph StateGraph internally for state machine execution and
 * PostgresCheckpointSaver for durable checkpoint persistence.
 */
export class WorkflowExecutor extends EventEmitter<WorkflowEngineEvents> {
  private readonly loader: WorkflowLoader;
  private readonly checkpointer: BaseCheckpointSaver;
  private readonly instances: Map<string, WorkflowInstance> = new Map();
  private readonly agentManager: AgentManager;
  private readonly modelRouter: ModelRouter;
  private readonly viadpEngine: VIADPEngine;
  private pendingInterrupts: Map<string, {
    id: string;
    instanceId: string;
    agentId: string;
    agentName: string;
    stepId: string;
    type: 'approval_gate' | 'human_mention' | 'confidence_low';
    question: string;
    context?: string;
    confidence?: number;
    createdAt: string;
    status: 'pending' | 'approved' | 'rejected';
  }> = new Map();
  private compiledGraph: ReturnType<typeof buildWorkflowGraph> | null = null;
  private viadpNode: ReturnType<typeof createViadpDelegationNode> | null = null;

  constructor(deps: WorkflowExecutorDeps) {
    super();
    this.loader = new WorkflowLoader(deps.workflowsDir);
    this.checkpointer = deps.databaseUrl
      ? new PostgresCheckpointSaver(deps.databaseUrl)
      : new MemorySaver() as any;
    this.agentManager = deps.agentManager;
    this.modelRouter = deps.modelRouter;
    this.viadpEngine = deps.viadpEngine;
    this.viadpNode = createViadpDelegationNode(this.viadpEngine);
  }

  // --------------------------------------------------------------------------
  // Graph compilation (lazy)
  // --------------------------------------------------------------------------

  private getCompiledGraph() {
    if (!this.compiledGraph) {
      this.compiledGraph = buildWorkflowGraph(
        {
          agentManager: this.agentManager,
          modelRouter: this.modelRouter,
          viadpEngine: this.viadpEngine,
        },
        this.checkpointer
      );
    }
    return this.compiledGraph;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Start a new workflow from a definition name, returning the instance.
   */
  async startWorkflow(
    definitionName: string,
    sessionId: string
  ): Promise<WorkflowInstance> {
    // Load definition (tries with .yaml extension if needed)
    const fileName = definitionName.endsWith('.yaml') || definitionName.endsWith('.yml')
      ? definitionName
      : `${definitionName}.yaml`;
    const definition = this.loader.loadWorkflow(fileName);

    const instanceId = randomUUID();
    const now = new Date().toISOString();

    // Build runtime phases for the WorkflowInstance
    const phases = this.buildPhases(definition);

    const state: WorkflowInstanceState = {
      currentPhaseIndex: 0,
      phaseStatuses: {},
      stepStatuses: {},
      outputs: {},
      history: [],
      pendingApprovals: [],
    };

    for (const phase of phases) {
      state.phaseStatuses[phase.name] = 'pending';
      for (const step of phase.steps) {
        state.stepStatuses[`${phase.name}.${step.name}`] = 'pending';
      }
    }

    const defaultConfig: PipelineConfig = {
      autoAdvance: true,
      allowParallelPhases: false,
      phaseTimeout: null,
      requireHumanGates: false,
      skipPhases: [],
      phaseOrder: null,
    };

    const instance: WorkflowInstance = {
      id: instanceId,
      workflowName: definition.name,
      workflowFile: fileName,
      sessionId,
      status: 'in-progress',
      projectName: '',
      projectDescription: '',
      phases,
      currentPhaseIndex: 0,
      state,
      checkpoints: [],
      progress: this.calculateProgress(phases, state),
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
      config: defaultConfig,
    };

    this.instances.set(instanceId, instance);

    // Emit started event
    this.emit('workflow:started', instance);

    // Build initial LangGraph state
    const initialState: WorkflowStateType = {
      workflowId: instanceId,
      instanceId,
      sessionId,
      definitionName: definition.name,
      currentPhaseIndex: 0,
      currentStepIndex: 0,
      status: 'in-progress',
      phaseResults: {},
      stepResults: {},
      waitingForApproval: false,
      approvalRequest: null,
      lastError: null,
      retryCount: 0,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      viadpContext: null,
      definition,
    };

    const graph = this.getCompiledGraph();

    try {
      const result = await graph.invoke(initialState, {
        configurable: {
          thread_id: instanceId,
          instance_id: instanceId,
        },
      });

      // Sync LangGraph result back to WorkflowInstance
      this.syncStateToInstance(instance, result as WorkflowStateType);
    } catch (err) {
      // LangGraph may throw on interrupt() for approval - this is expected
      const error = err as Record<string, unknown>;
      if (error && typeof error === 'object' && error['__interrupt']) {
        // Workflow paused for approval
        const graphState = await this.getGraphState(instanceId);
        if (graphState) {
          this.syncStateToInstance(instance, graphState);
        }
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        instance.status = 'failed';
        instance.completedAt = new Date().toISOString();
        instance.updatedAt = instance.completedAt;
        this.emit('workflow:failed', instance, errorMsg);
      }
    }

    return instance;
  }

  /**
   * Pause a running workflow instance.
   */
  async pauseWorkflow(instanceId: string): Promise<void> {
    const instance = this.requireInstance(instanceId);

    if (instance.status !== 'in-progress' && instance.status !== 'waiting_approval') {
      throw new Error(`Cannot pause workflow ${instanceId} in status "${instance.status}".`);
    }

    instance.status = 'paused';
    instance.updatedAt = new Date().toISOString();

    // LangGraph state is already persisted via checkpointer; just update local instance
  }

  /**
   * Resume a paused or approval-waiting workflow instance.
   */
  async resumeWorkflow(instanceId: string, approvalData?: unknown): Promise<void> {
    const instance = this.requireInstance(instanceId);

    if (instance.status !== 'paused' && instance.status !== 'waiting_approval') {
      throw new Error(
        `Cannot resume workflow ${instanceId} in status "${instance.status}".`
      );
    }

    instance.status = 'in-progress';
    instance.updatedAt = new Date().toISOString();

    const graph = this.getCompiledGraph();
    const threadConfig = {
      configurable: {
        thread_id: instanceId,
        instance_id: instanceId,
      },
    };

    try {
      // If we have approval data, update the graph state to clear the interrupt
      if (approvalData !== undefined) {
        await graph.updateState(threadConfig, {
          waitingForApproval: false,
          approvalRequest: null,
          status: 'in-progress',
          updatedAt: new Date().toISOString(),
        });
      }

      // Continue the graph from the last checkpoint
      const result = await graph.invoke(null, threadConfig);
      this.syncStateToInstance(instance, result as WorkflowStateType);
    } catch (err) {
      const error = err as Record<string, unknown>;
      if (error && typeof error === 'object' && error['__interrupt']) {
        const graphState = await this.getGraphState(instanceId);
        if (graphState) {
          this.syncStateToInstance(instance, graphState);
        }
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        instance.status = 'failed';
        instance.completedAt = new Date().toISOString();
        instance.updatedAt = instance.completedAt;
        this.emit('workflow:failed', instance, errorMsg);
      }
    }
  }

  /**
   * Get the current progress of a workflow instance.
   */
  async getProgress(instanceId: string): Promise<WorkflowProgress> {
    const instance = this.requireInstance(instanceId);
    return instance.progress;
  }

  /**
   * Cancel a workflow instance.
   */
  async cancelWorkflow(instanceId: string): Promise<void> {
    const instance = this.requireInstance(instanceId);

    if (instance.status === 'completed' || instance.status === 'cancelled') {
      throw new Error(`Workflow ${instanceId} is already ${instance.status}.`);
    }

    instance.status = 'cancelled';
    instance.updatedAt = new Date().toISOString();
    instance.completedAt = new Date().toISOString();

    // Update LangGraph state to cancelled
    const graph = this.getCompiledGraph();
    try {
      await graph.updateState(
        { configurable: { thread_id: instanceId, instance_id: instanceId } },
        { status: 'cancelled', updatedAt: instance.updatedAt }
      );
    } catch {
      // Best effort - instance may not have been started in LangGraph yet
    }
  }

  createInterrupt(instanceId: string, agentId: string, agentName: string, stepId: string, type: string, question: string, context?: string, confidence?: number): string {
    const id = randomUUID();
    const interrupt = {
      id,
      instanceId,
      agentId,
      agentName,
      stepId,
      type: type as any,
      question,
      context,
      confidence,
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
    };
    this.pendingInterrupts.set(id, interrupt);
    if (this.instances.has(instanceId)) {
      this.pauseWorkflow(instanceId);
    }
    return id;
  }

  resolveInterrupt(interruptId: string, approved: boolean, feedback?: string): void {
    const interrupt = this.pendingInterrupts.get(interruptId);
    if (!interrupt) throw new Error(`Interrupt ${interruptId} not found`);
    interrupt.status = approved ? 'approved' : 'rejected';
    if (approved && this.instances.has(interrupt.instanceId)) {
      this.resumeWorkflow(interrupt.instanceId);
    }
  }

  getPendingInterrupts(): Array<typeof this.pendingInterrupts extends Map<string, infer V> ? V : never> {
    return Array.from(this.pendingInterrupts.values()).filter(i => i.status === 'pending');
  }

  getAllInterrupts(): Array<typeof this.pendingInterrupts extends Map<string, infer V> ? V : never> {
    return Array.from(this.pendingInterrupts.values());
  }

  pauseAllWorkflows(): { paused: string[] } {
    const paused: string[] = [];
    for (const [id, instance] of this.instances.entries()) {
      if (instance.status === 'in-progress' || instance.status === 'waiting_approval') {
        this.pauseWorkflow(id);
        paused.push(id);
      }
    }
    return { paused };
  }

  async resumeAllWorkflows(): Promise<{ resumed: string[] }> {
    const resumed: string[] = [];
    for (const [id, instance] of this.instances.entries()) {
      if (instance.status === 'paused') {
        await this.resumeWorkflow(id);
        resumed.push(id);
      }
    }
    return { resumed };
  }

  getWorkflowStatuses(): Array<{ id: string; label: string; status: string; progress: number }> {
    return Array.from(this.instances.values()).map(inst => ({
      id: inst.id,
      label: inst.workflowName,
      status: inst.status,
      progress: inst.progress.overall,
    }));
  }

  /**
   * List available workflow definition names.
   */
  listDefinitions(): string[] {
    return this.loader.listWorkflows().map((f) => {
      if (f.endsWith('.yaml')) return f.slice(0, -5);
      if (f.endsWith('.yml')) return f.slice(0, -4);
      return f;
    });
  }

  /**
   * Get the workflow loader for direct definition access.
   */
  getLoader(): WorkflowLoader {
    return this.loader;
  }

  /**
   * Get a workflow instance by ID.
   */
  getInstance(instanceId: string): WorkflowInstance | null {
    return this.instances.get(instanceId) ?? null;
  }

  /**
   * Get all workflow instances, optionally filtered by session.
   */
  getAllInstances(sessionId?: string): WorkflowInstance[] {
    const all = Array.from(this.instances.values());
    if (sessionId) {
      return all.filter((i) => i.sessionId === sessionId);
    }
    return all;
  }

  // --------------------------------------------------------------------------
  // Internal: sync LangGraph state -> WorkflowInstance
  // --------------------------------------------------------------------------

  private syncStateToInstance(
    instance: WorkflowInstance,
    graphState: WorkflowStateType
  ): void {
    const prevPhaseIndex = instance.currentPhaseIndex;

    instance.currentPhaseIndex = graphState.currentPhaseIndex;
    instance.status = graphState.status;
    instance.updatedAt = graphState.updatedAt;
    instance.completedAt = graphState.completedAt;

    // Sync step results into instance phases
    for (const phase of instance.phases) {
      for (const step of phase.steps) {
        const key = `${phase.name}.${step.name}`;
        const sr = graphState.stepResults[key];
        if (sr) {
          step.result = sr;
          step.status = sr.success ? 'completed' : 'failed';
          instance.state.stepStatuses[key] = step.status;

          // Emit step-completed event
          if (sr.success) {
            this.emit('workflow:step-completed', instance, {
              phaseName: phase.name,
              stepName: step.name,
              result: sr,
            });
          }
        }
      }

      // Update phase status based on steps
      const allDone = phase.steps.every(
        (s) => s.status === 'completed' || s.status === 'skipped'
      );
      const anyFailed = phase.steps.some(
        (s) => s.status === 'failed' || s.status === 'blocked'
      );

      if (allDone) {
        phase.status = 'completed';
        instance.state.phaseStatuses[phase.name] = 'completed';
      } else if (anyFailed) {
        phase.status = 'failed';
        instance.state.phaseStatuses[phase.name] = 'failed';
      }
    }

    // Sync phase results
    for (const [phaseName, pr] of Object.entries(graphState.phaseResults)) {
      const phase = instance.phases.find((p) => p.name === phaseName);
      if (phase) {
        phase.result = pr;
        Object.assign(instance.state.outputs, pr.outputs);
      }
    }

    // Emit phase-changed if phase index changed
    if (prevPhaseIndex !== graphState.currentPhaseIndex) {
      const newPhase = instance.phases[graphState.currentPhaseIndex];
      if (newPhase) {
        this.emit('workflow:phase-changed', instance, newPhase);
      }
    }

    // Handle approval waiting
    if (graphState.waitingForApproval && graphState.approvalRequest) {
      instance.status = 'waiting_approval';
      this.emit('workflow:waiting-approval', instance, graphState.approvalRequest);
    }

    // Recalculate progress
    instance.progress = this.calculateProgress(instance.phases, instance.state);
    this.emit('workflow:progress', instance.id, instance.progress);

    // Terminal states
    if (graphState.status === 'completed') {
      this.emit('workflow:completed', instance);
    } else if (graphState.status === 'failed') {
      this.emit('workflow:failed', instance, graphState.lastError ?? 'Unknown error');
    }
  }

  private async getGraphState(instanceId: string): Promise<WorkflowStateType | null> {
    try {
      const graph = this.getCompiledGraph();
      const state = await graph.getState({
        configurable: { thread_id: instanceId },
      });
      return (state?.values ?? null) as WorkflowStateType | null;
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Phase/Step Building from YAML
  // --------------------------------------------------------------------------

  private buildPhases(definition: WorkflowDefinition): WorkflowPhase[] {
    return definition.phases.map((yamlPhase, index) => {
      const steps = this.buildSteps(yamlPhase);

      let transitionToNext: TransitionType = 'auto';
      if (index < definition.phases.length - 1) {
        const nextPhase = definition.phases[index + 1];
        const key = `${yamlPhase.name} -> ${nextPhase.name}`;
        transitionToNext = definition.transitions[key] ?? 'auto';
      }

      return {
        id: `phase-${yamlPhase.name}-${randomUUID().slice(0, 8)}`,
        name: yamlPhase.name,
        displayName: yamlPhase.display_name,
        displayNameAr: yamlPhase.display_name_ar,
        description: `${yamlPhase.display_name} phase`,
        steps,
        status: 'pending' as WorkflowStepStatus,
        hasCheckpoint: yamlPhase.checkpoint,
        gateCondition: 'all-pass',
        involvedAgents: yamlPhase.agents,
        entryCriteria: [],
        exitCriteria: [],
        transitionToNext,
        order: index,
        result: null,
        startedAt: null,
        completedAt: null,
      };
    });
  }

  private buildSteps(yamlPhase: YAMLPhaseDefinition): WorkflowStep[] {
    return yamlPhase.steps.map((yamlStep) => ({
      id: `step-${yamlStep.name}-${randomUUID().slice(0, 8)}`,
      name: yamlStep.name,
      description: `${yamlStep.action} by ${yamlStep.agent}`,
      status: 'pending' as WorkflowStepStatus,
      assignedAgent: yamlStep.agent,
      action: yamlStep.action,
      modelOverride: yamlStep.model_override ?? yamlPhase.model_override ?? null,
      reviewers: [],
      dependencies: yamlStep.depends_on ?? [],
      parallel: yamlStep.parallel ?? false,
      approvalRequired: yamlStep.approval_required ?? false,
      inputArtifacts: yamlStep.inputs ?? [],
      outputArtifacts: yamlStep.outputs ?? [],
      acceptanceCriteria: [],
      estimatedDuration: null,
      actualDuration: null,
      startedAt: null,
      completedAt: null,
      retryCount: 0,
      maxRetries: 2,
      error: null,
      result: null,
      metadata: {},
    }));
  }

  // --------------------------------------------------------------------------
  // Progress Calculation
  // --------------------------------------------------------------------------

  private calculateProgress(
    phases: WorkflowPhase[],
    state: WorkflowInstanceState
  ): WorkflowProgress {
    let totalSteps = 0;
    let completedSteps = 0;
    let failedSteps = 0;
    const activeSteps: string[] = [];
    const waitingApproval: string[] = [];
    const phaseProgress: WorkflowProgress['phases'] = {};

    for (const phase of phases) {
      const phaseTotal = phase.steps.length;
      let phaseCompleted = 0;

      for (const step of phase.steps) {
        totalSteps++;
        const stepKey = `${phase.name}.${step.name}`;
        const status = state.stepStatuses[stepKey] ?? step.status;

        if (status === 'completed' || status === 'skipped') {
          completedSteps++;
          phaseCompleted++;
        } else if (status === 'failed' || status === 'blocked') {
          failedSteps++;
        } else if (status === 'active') {
          activeSteps.push(stepKey);
        } else if (status === 'waiting_approval') {
          waitingApproval.push(stepKey);
        }
      }

      const phaseStatus = state.phaseStatuses[phase.name] ?? phase.status;
      phaseProgress[phase.name] = {
        percentage: phaseTotal > 0 ? Math.round((phaseCompleted / phaseTotal) * 100) : 0,
        completedSteps: phaseCompleted,
        totalSteps: phaseTotal,
        status: phaseStatus,
      };
    }

    const overall = totalSteps > 0
      ? Math.round((completedSteps / totalSteps) * 100)
      : 0;

    return {
      overall,
      phases: phaseProgress,
      totalSteps,
      completedSteps,
      failedSteps,
      activeSteps,
      waitingApproval,
    };
  }

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  private requireInstance(instanceId: string): WorkflowInstance {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance not found: ${instanceId}`);
    }
    return instance;
  }
}
