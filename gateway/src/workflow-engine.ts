/**
 * ForgeTeam Workflow Engine
 *
 * Core workflow engine that:
 * 1. Loads BMAD YAML workflow files
 * 2. Converts them to executable state machines (LangGraph-style)
 * 3. Manages workflow execution with checkpoints
 * 4. Handles parallel steps, dependencies, approvals
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
// CheckpointManager - Save/restore workflow state
// ============================================================================

/** Manages saving and restoring workflow checkpoints */
export class CheckpointManager {
  /** In-memory store of checkpoints by workflow instance ID */
  private readonly checkpoints: Map<string, WorkflowCheckpoint[]> = new Map();

  /**
   * Create a checkpoint for the given workflow instance.
   */
  createCheckpoint(
    instance: WorkflowInstance,
    label?: string
  ): WorkflowCheckpoint {
    const currentPhase = instance.phases[instance.currentPhaseIndex];

    const checkpoint: WorkflowCheckpoint = {
      id: randomUUID(),
      workflowInstanceId: instance.id,
      phaseName: currentPhase ? currentPhase.name : '',
      phaseIndex: instance.currentPhaseIndex,
      state: this.serializeState(instance),
      accumulatedOutputs: { ...instance.state.outputs },
      createdAt: new Date().toISOString(),
      label: label ?? null,
    };

    const existing = this.checkpoints.get(instance.id) ?? [];
    existing.push(checkpoint);
    this.checkpoints.set(instance.id, existing);

    return checkpoint;
  }

  /**
   * List all checkpoints for a workflow instance.
   */
  getCheckpoints(workflowInstanceId: string): WorkflowCheckpoint[] {
    return this.checkpoints.get(workflowInstanceId) ?? [];
  }

  /**
   * Get a specific checkpoint by ID.
   */
  getCheckpoint(
    workflowInstanceId: string,
    checkpointId: string
  ): WorkflowCheckpoint | null {
    const all = this.checkpoints.get(workflowInstanceId) ?? [];
    return all.find((c) => c.id === checkpointId) ?? null;
  }

  /**
   * Get the latest checkpoint for a workflow instance.
   */
  getLatestCheckpoint(workflowInstanceId: string): WorkflowCheckpoint | null {
    const all = this.checkpoints.get(workflowInstanceId) ?? [];
    return all.length > 0 ? all[all.length - 1] : null;
  }

  /**
   * Restore a workflow instance to a given checkpoint state.
   * Returns the restored state. Caller is responsible for applying it
   * back to the WorkflowInstance.
   */
  restoreFromCheckpoint(checkpoint: WorkflowCheckpoint): WorkflowInstanceState {
    return JSON.parse(JSON.stringify(checkpoint.state)) as WorkflowInstanceState;
  }

  /**
   * Delete all checkpoints for a workflow instance.
   */
  deleteCheckpoints(workflowInstanceId: string): void {
    this.checkpoints.delete(workflowInstanceId);
  }

  /**
   * Serialize the current workflow instance state into a checkpoint-safe format.
   */
  private serializeState(instance: WorkflowInstance): WorkflowInstanceState {
    return JSON.parse(JSON.stringify(instance.state)) as WorkflowInstanceState;
  }
}

// ============================================================================
// WorkflowExecutor - Run workflows step by step
// ============================================================================

/** Event types emitted by the workflow engine */
export interface WorkflowEngineEvents {
  'workflow:event': (event: WorkflowEvent) => void;
  'workflow:progress': (instanceId: string, progress: WorkflowProgress) => void;
  'workflow:approval_required': (approval: ApprovalRequest) => void;
  'workflow:checkpoint': (checkpoint: WorkflowCheckpoint) => void;
  'workflow:error': (instanceId: string, error: Error) => void;
}

/** Step executor function type - the actual work done for a step */
export type StepExecutorFn = (
  step: WorkflowStep,
  context: StepExecutionContext
) => Promise<StepResult>;

/** Context provided to a step executor */
export interface StepExecutionContext {
  /** The workflow instance */
  workflowInstanceId: string;
  /** The phase this step belongs to */
  phaseName: string;
  /** Session ID */
  sessionId: string;
  /** All accumulated outputs from prior steps */
  accumulatedOutputs: Record<string, unknown>;
  /** The input artifacts this step requests */
  resolvedInputs: Record<string, unknown>;
  /** Project name */
  projectName: string;
  /** Project description */
  projectDescription: string;
}

/** Options for creating a workflow instance */
export interface CreateWorkflowOptions {
  sessionId: string;
  projectName: string;
  projectDescription: string;
  config?: Partial<PipelineConfig>;
}

/**
 * The main workflow engine. Manages creation, execution, pausing, resuming,
 * and event emission for workflow instances.
 */
export class WorkflowExecutor extends EventEmitter<WorkflowEngineEvents> {
  private readonly instances: Map<string, WorkflowInstance> = new Map();
  private readonly loader: WorkflowLoader;
  private readonly checkpointManager: CheckpointManager;
  private stepExecutor: StepExecutorFn;
  /** Tracks which instances currently have an active execution loop running */
  private readonly executionLocks: Set<string> = new Set();

  constructor(workflowsDir: string, stepExecutor?: StepExecutorFn) {
    super();
    this.loader = new WorkflowLoader(workflowsDir);
    this.checkpointManager = new CheckpointManager();
    this.stepExecutor = stepExecutor ?? defaultStepExecutor;
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  /** Get the workflow loader for direct definition access */
  getLoader(): WorkflowLoader {
    return this.loader;
  }

  /** Get the checkpoint manager */
  getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }

  /**
   * Set or replace the step executor function.
   * This is the function that performs the actual work for each step
   * (e.g., calling an LLM agent).
   */
  setStepExecutor(executor: StepExecutorFn): void {
    this.stepExecutor = executor;
  }

  // --------------------------------------------------------------------------
  // Instance Management
  // --------------------------------------------------------------------------

  /**
   * Create a new workflow instance from a YAML definition file.
   * Does not start execution; call startWorkflow() to begin.
   */
  createInstance(
    workflowFile: string,
    options: CreateWorkflowOptions
  ): WorkflowInstance {
    const definition = this.loader.loadWorkflow(workflowFile);
    const instanceId = randomUUID();
    const now = new Date().toISOString();

    const defaultConfig: PipelineConfig = {
      autoAdvance: true,
      allowParallelPhases: false,
      phaseTimeout: null,
      requireHumanGates: false,
      skipPhases: [],
      phaseOrder: null,
    };

    const config: PipelineConfig = {
      ...defaultConfig,
      ...(options.config ?? {}),
    };

    // Build runtime phases from the YAML definition
    const phases = this.buildPhases(definition, config);

    const state: WorkflowInstanceState = {
      currentPhaseIndex: -1,
      phaseStatuses: {},
      stepStatuses: {},
      outputs: {},
      history: [],
      pendingApprovals: [],
    };

    // Initialize phase and step statuses
    for (const phase of phases) {
      state.phaseStatuses[phase.name] = 'pending';
      for (const step of phase.steps) {
        state.stepStatuses[`${phase.name}.${step.name}`] = 'pending';
      }
    }

    const instance: WorkflowInstance = {
      id: instanceId,
      workflowName: definition.name,
      workflowFile,
      sessionId: options.sessionId,
      status: 'not-started',
      projectName: options.projectName,
      projectDescription: options.projectDescription,
      phases,
      currentPhaseIndex: -1,
      state,
      checkpoints: [],
      progress: this.calculateProgress(phases, state),
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      config,
    };

    this.instances.set(instanceId, instance);

    this.emitWorkflowEvent(instance, 'workflow.instance.created', {});

    return instance;
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

  /**
   * Delete a workflow instance and its checkpoints.
   */
  deleteInstance(instanceId: string): boolean {
    const existed = this.instances.delete(instanceId);
    if (existed) {
      this.checkpointManager.deleteCheckpoints(instanceId);
    }
    return existed;
  }

  // --------------------------------------------------------------------------
  // Workflow Execution
  // --------------------------------------------------------------------------

  /**
   * Start executing a workflow instance from the beginning
   * or from the current position if it was restored from a checkpoint.
   */
  async startWorkflow(instanceId: string): Promise<void> {
    const instance = this.requireInstance(instanceId);

    if (instance.status === 'in-progress') {
      throw new Error(`Workflow ${instanceId} is already in progress.`);
    }

    if (instance.status === 'completed') {
      throw new Error(`Workflow ${instanceId} is already completed. Create a new instance or restore from checkpoint.`);
    }

    const now = new Date().toISOString();
    instance.status = 'in-progress';
    instance.startedAt = instance.startedAt ?? now;
    instance.updatedAt = now;

    this.addHistory(instance, {
      type: 'workflow_started',
      message: `Workflow "${instance.workflowName}" started.`,
    });

    this.emitWorkflowEvent(instance, 'workflow.instance.started', {});

    // If currentPhaseIndex is -1, start from phase 0
    if (instance.currentPhaseIndex < 0) {
      instance.currentPhaseIndex = 0;
      instance.state.currentPhaseIndex = 0;
    }

    // Execute phases sequentially
    await this.executeFromCurrentPhase(instance);
  }

  /**
   * Pause a running workflow instance.
   */
  pauseWorkflow(instanceId: string): void {
    const instance = this.requireInstance(instanceId);

    if (instance.status !== 'in-progress' && instance.status !== 'waiting_approval') {
      throw new Error(`Cannot pause workflow ${instanceId} in status "${instance.status}".`);
    }

    instance.status = 'paused';
    instance.updatedAt = new Date().toISOString();

    this.addHistory(instance, {
      type: 'workflow_paused',
      message: 'Workflow paused by user.',
    });

    this.emitWorkflowEvent(instance, 'workflow.instance.paused', {});
  }

  /**
   * Resume a paused workflow instance.
   */
  async resumeWorkflow(instanceId: string): Promise<void> {
    const instance = this.requireInstance(instanceId);

    if (instance.status !== 'paused') {
      throw new Error(`Cannot resume workflow ${instanceId} in status "${instance.status}". Only paused workflows can be resumed.`);
    }

    instance.status = 'in-progress';
    instance.updatedAt = new Date().toISOString();

    this.addHistory(instance, {
      type: 'workflow_resumed',
      message: 'Workflow resumed.',
    });

    this.emitWorkflowEvent(instance, 'workflow.instance.resumed', {});

    // Continue executing from the current phase
    await this.executeFromCurrentPhase(instance);
  }

  /**
   * Cancel a workflow instance.
   */
  cancelWorkflow(instanceId: string): void {
    const instance = this.requireInstance(instanceId);

    if (instance.status === 'completed' || instance.status === 'cancelled') {
      throw new Error(`Workflow ${instanceId} is already ${instance.status}.`);
    }

    instance.status = 'cancelled';
    instance.updatedAt = new Date().toISOString();
    instance.completedAt = new Date().toISOString();

    this.addHistory(instance, {
      type: 'workflow_cancelled',
      message: 'Workflow cancelled.',
    });

    this.emitWorkflowEvent(instance, 'workflow.instance.cancelled', {});
  }

  /**
   * Restart a workflow from a specific checkpoint.
   */
  async restartFromCheckpoint(
    instanceId: string,
    checkpointId: string
  ): Promise<void> {
    const instance = this.requireInstance(instanceId);
    const checkpoint = this.checkpointManager.getCheckpoint(
      instanceId,
      checkpointId
    );

    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found for workflow ${instanceId}.`);
    }

    // Restore the state from the checkpoint
    const restoredState = this.checkpointManager.restoreFromCheckpoint(checkpoint);

    // Apply restored state to the instance
    instance.state = restoredState;
    instance.currentPhaseIndex = checkpoint.phaseIndex;
    instance.status = 'in-progress';
    instance.updatedAt = new Date().toISOString();

    // Rebuild phase/step statuses from the restored state
    for (const phase of instance.phases) {
      phase.status = restoredState.phaseStatuses[phase.name] ?? 'pending';
      for (const step of phase.steps) {
        const key = `${phase.name}.${step.name}`;
        step.status = restoredState.stepStatuses[key] ?? 'pending';
      }
    }

    // Recalculate progress
    instance.progress = this.calculateProgress(instance.phases, instance.state);

    this.addHistory(instance, {
      type: 'workflow_resumed',
      message: `Workflow restored from checkpoint "${checkpoint.label ?? checkpoint.id}" at phase "${checkpoint.phaseName}".`,
      data: { checkpointId: checkpoint.id },
    });

    this.emitWorkflowEvent(instance, 'workflow.checkpoint.restored', {
      checkpointId: checkpoint.id,
      phaseName: checkpoint.phaseName,
    });

    // Continue execution from the restored phase
    // Advance to the next phase after the checkpoint phase
    const nextPhaseIndex = checkpoint.phaseIndex + 1;
    if (nextPhaseIndex < instance.phases.length) {
      instance.currentPhaseIndex = nextPhaseIndex;
      instance.state.currentPhaseIndex = nextPhaseIndex;
      await this.executeFromCurrentPhase(instance);
    } else {
      // Checkpoint was at the last phase; workflow is completed
      this.completeWorkflow(instance);
    }
  }

  // --------------------------------------------------------------------------
  // Approval Handling
  // --------------------------------------------------------------------------

  /**
   * Handle an approval decision for a pending approval request.
   */
  async handleApproval(
    workflowInstanceId: string,
    approvalId: string,
    approved: boolean,
    resolvedBy: string,
    comment?: string
  ): Promise<void> {
    const instance = this.requireInstance(workflowInstanceId);

    const approvalIdx = instance.state.pendingApprovals.findIndex(
      (a) => a.id === approvalId
    );

    if (approvalIdx === -1) {
      throw new Error(`Approval request ${approvalId} not found in workflow ${workflowInstanceId}.`);
    }

    const approval = instance.state.pendingApprovals[approvalIdx];
    approval.status = approved ? 'approved' : 'rejected';
    approval.resolvedBy = resolvedBy;
    approval.comment = comment ?? null;
    approval.resolvedAt = new Date().toISOString();

    // Remove from pending
    instance.state.pendingApprovals.splice(approvalIdx, 1);

    this.addHistory(instance, {
      type: 'approval_resolved',
      phaseName: approval.phaseName,
      stepName: approval.stepName ?? undefined,
      message: `Approval ${approved ? 'granted' : 'rejected'} by ${resolvedBy}.${comment ? ` Comment: ${comment}` : ''}`,
      data: { approvalId, approved, resolvedBy, comment },
    });

    this.emitWorkflowEvent(instance, 'workflow.step.approval_resolved', {
      approvalId,
      approved,
      resolvedBy,
      comment,
      phaseName: approval.phaseName,
      stepName: approval.stepName,
    });

    if (approved) {
      // Mark the step as completed if this was a step approval
      if (approval.stepName) {
        const phase = instance.phases.find((p) => p.name === approval.phaseName);
        if (phase) {
          const step = phase.steps.find((s) => s.name === approval.stepName);
          if (step && step.status === 'waiting_approval') {
            step.status = 'completed';
            step.completedAt = new Date().toISOString();
            step.actualDuration = step.startedAt
              ? Math.round((Date.now() - new Date(step.startedAt).getTime()) / 60000)
              : null;
            instance.state.stepStatuses[`${phase.name}.${step.name}`] = 'completed';
          }
        }
      }

      // Update progress
      instance.progress = this.calculateProgress(instance.phases, instance.state);

      // If the workflow was waiting for approval, resume execution.
      // If the workflow was paused, only update state - user must call resumeWorkflow().
      const currentStatus = instance.status as WorkflowInstanceStatus;
      if (currentStatus === 'waiting_approval') {
        instance.status = 'in-progress';
        instance.updatedAt = new Date().toISOString();
        // Continue execution
        await this.executeFromCurrentPhase(instance);
      } else if (currentStatus === 'paused') {
        // Approval resolved while paused. State is updated but execution
        // does not resume until the user calls resumeWorkflow().
        instance.updatedAt = new Date().toISOString();
      }
    } else {
      // Rejection: fail the step and potentially the phase
      if (approval.stepName) {
        const phase = instance.phases.find((p) => p.name === approval.phaseName);
        if (phase) {
          const step = phase.steps.find((s) => s.name === approval.stepName);
          if (step) {
            step.status = 'failed';
            step.error = `Approval rejected by ${resolvedBy}.${comment ? ` Reason: ${comment}` : ''}`;
            instance.state.stepStatuses[`${phase.name}.${step.name}`] = 'failed';
          }
        }
      }

      this.failWorkflow(instance, `Approval rejected for ${approval.phaseName}${approval.stepName ? `.${approval.stepName}` : ''}.`);
    }
  }

  /**
   * Get all pending approval requests for a workflow instance.
   */
  getPendingApprovals(instanceId: string): ApprovalRequest[] {
    const instance = this.requireInstance(instanceId);
    return [...instance.state.pendingApprovals];
  }

  // --------------------------------------------------------------------------
  // Progress Tracking
  // --------------------------------------------------------------------------

  /**
   * Get the current progress of a workflow instance.
   */
  getProgress(instanceId: string): WorkflowProgress {
    const instance = this.requireInstance(instanceId);
    return instance.progress;
  }

  /**
   * Get a summary of workflow status suitable for display.
   */
  getWorkflowSummary(instanceId: string): {
    id: string;
    name: string;
    status: WorkflowInstanceStatus;
    progress: WorkflowProgress;
    currentPhase: string | null;
    pendingApprovals: number;
    checkpoints: number;
    startedAt: string | null;
    elapsedMs: number | null;
  } {
    const instance = this.requireInstance(instanceId);
    const currentPhase = instance.currentPhaseIndex >= 0 && instance.currentPhaseIndex < instance.phases.length
      ? instance.phases[instance.currentPhaseIndex].displayName
      : null;

    const elapsedMs = instance.startedAt
      ? Date.now() - new Date(instance.startedAt).getTime()
      : null;

    return {
      id: instance.id,
      name: instance.workflowName,
      status: instance.status,
      progress: instance.progress,
      currentPhase,
      pendingApprovals: instance.state.pendingApprovals.length,
      checkpoints: this.checkpointManager.getCheckpoints(instance.id).length,
      startedAt: instance.startedAt,
      elapsedMs,
    };
  }

  // --------------------------------------------------------------------------
  // Internal Execution Logic
  // --------------------------------------------------------------------------

  /**
   * Execute phases starting from the current phase index.
   * Uses a re-entrancy lock to prevent multiple concurrent execution loops
   * for the same workflow instance (e.g., when approval handlers are called
   * synchronously during step execution).
   */
  private async executeFromCurrentPhase(instance: WorkflowInstance): Promise<void> {
    // Prevent re-entrant execution. If this instance already has an active
    // execution loop, the current loop will pick up any state changes
    // (like resolved approvals) on its next iteration.
    if (this.executionLocks.has(instance.id)) {
      return;
    }

    this.executionLocks.add(instance.id);

    try {
      await this.executeFromCurrentPhaseInner(instance);
    } finally {
      this.executionLocks.delete(instance.id);
    }
  }

  /**
   * Inner execution loop (called by executeFromCurrentPhase with lock held).
   */
  private async executeFromCurrentPhaseInner(instance: WorkflowInstance): Promise<void> {
    while (
      instance.currentPhaseIndex < instance.phases.length &&
      instance.status === 'in-progress'
    ) {
      const phase = instance.phases[instance.currentPhaseIndex];

      // Skip phases in the skip list
      if (instance.config.skipPhases.includes(phase.name)) {
        phase.status = 'skipped';
        instance.state.phaseStatuses[phase.name] = 'skipped';
        for (const step of phase.steps) {
          step.status = 'skipped';
          instance.state.stepStatuses[`${phase.name}.${step.name}`] = 'skipped';
        }
        instance.currentPhaseIndex++;
        instance.state.currentPhaseIndex = instance.currentPhaseIndex;
        continue;
      }

      // Check if this phase requires approval to enter (from transitions)
      if (instance.currentPhaseIndex > 0) {
        const prevPhase = instance.phases[instance.currentPhaseIndex - 1];
        const transitionKey = `${prevPhase.name} -> ${phase.name}`;
        const transitionType = this.getTransitionType(instance, transitionKey);

        if (transitionType === 'requires_approval') {
          const hasApproval = this.checkTransitionApproval(instance, prevPhase.name, phase.name);
          if (!hasApproval) {
            // Create approval request for the transition
            this.requestTransitionApproval(instance, prevPhase.name, phase.name);

            // The approval event may have been handled synchronously (e.g., by
            // an auto-approve listener). Re-check whether the approval was resolved.
            const hasApprovalNow = this.checkTransitionApproval(instance, prevPhase.name, phase.name);
            if (!hasApprovalNow) {
              return; // Stop execution until approval is granted
            }
            // Approval was resolved synchronously; restore status and continue
            instance.status = 'in-progress';
          }
        }
      }

      // Execute the phase
      const success = await this.executePhase(instance, phase);

      if (!success) {
        // Phase failed - workflow fails
        // Note: status may have been mutated during executePhase to 'paused' or 'waiting_approval'
        const currentStatus = instance.status as WorkflowInstanceStatus;
        if (currentStatus !== 'paused' && currentStatus !== 'waiting_approval') {
          this.failWorkflow(instance, `Phase "${phase.displayName}" failed.`);
        }
        return;
      }

      // Create checkpoint if phase has one
      if (phase.hasCheckpoint) {
        const checkpoint = this.checkpointManager.createCheckpoint(
          instance,
          `After phase: ${phase.displayName}`
        );
        instance.checkpoints.push(checkpoint);

        this.addHistory(instance, {
          type: 'checkpoint_created',
          phaseName: phase.name,
          message: `Checkpoint created after phase "${phase.displayName}".`,
          data: { checkpointId: checkpoint.id },
        });

        this.emit('workflow:checkpoint', checkpoint);
        this.emitWorkflowEvent(instance, 'workflow.checkpoint.created', {
          checkpointId: checkpoint.id,
          phaseName: phase.name,
        });
      }

      // Advance to next phase
      instance.currentPhaseIndex++;
      instance.state.currentPhaseIndex = instance.currentPhaseIndex;
      instance.updatedAt = new Date().toISOString();

      // Update progress
      instance.progress = this.calculateProgress(instance.phases, instance.state);
      this.emit('workflow:progress', instance.id, instance.progress);
      this.emitWorkflowEvent(instance, 'workflow.progress.updated', {
        progress: instance.progress,
      });
    }

    // If we ran through all phases, the workflow is complete
    if (
      instance.currentPhaseIndex >= instance.phases.length &&
      instance.status === 'in-progress'
    ) {
      this.completeWorkflow(instance);
    }
  }

  /**
   * Execute a single phase, running steps in dependency order,
   * handling parallel execution.
   */
  private async executePhase(
    instance: WorkflowInstance,
    phase: WorkflowPhase
  ): Promise<boolean> {
    // Only emit phase start event/history on first entry (not re-entry after approval)
    if (phase.status !== 'active') {
      const now = new Date().toISOString();
      phase.status = 'active';
      phase.startedAt = phase.startedAt ?? now;
      instance.state.phaseStatuses[phase.name] = 'active';

      this.addHistory(instance, {
        type: 'phase_started',
        phaseName: phase.name,
        message: `Phase "${phase.displayName}" started.`,
      });

      this.emitWorkflowEvent(instance, 'workflow.phase.started', {
        phaseName: phase.name,
        displayName: phase.displayName,
      });
    }

    const phaseStartTime = phase.startedAt
      ? new Date(phase.startedAt).getTime()
      : Date.now();

    // Build dependency tracking sets from current step statuses
    // so that re-entry after approval correctly recognizes previously completed steps
    const completed = new Set<string>();
    const failed = new Set<string>();

    for (const step of phase.steps) {
      if (step.status === 'completed' || step.status === 'skipped') {
        completed.add(step.name);
      } else if (step.status === 'failed' || step.status === 'blocked') {
        failed.add(step.name);
      }
    }

    while (instance.status === 'in-progress') {
      // Find all steps that are ready to execute
      const readySteps = phase.steps.filter((step) => {
        if (step.status !== 'pending') return false;

        // Check all dependencies are met
        const deps = step.dependencies;
        if (deps.length > 0) {
          const allDepsMet = deps.every((d) => completed.has(d));
          const anyDepFailed = deps.some((d) => failed.has(d));
          if (anyDepFailed) {
            step.status = 'blocked';
            instance.state.stepStatuses[`${phase.name}.${step.name}`] = 'blocked';
            return false;
          }
          if (!allDepsMet) return false;
        }

        return true;
      });

      // If no steps are ready and some are still pending/active, we might be stuck
      if (readySteps.length === 0) {
        const hasPending = phase.steps.some((s) => s.status === 'pending');
        const hasActive = phase.steps.some((s) => s.status === 'active' || s.status === 'waiting_approval');

        if (!hasPending && !hasActive) {
          // All steps are done (completed, failed, blocked, or skipped)
          break;
        }

        if (hasPending && !hasActive) {
          // Steps are pending but nothing can run (all blocked by failed deps)
          break;
        }

        // There are active steps - this shouldn't happen in our sequential-async model
        // but guard against it
        break;
      }

      // Group steps: parallel steps can run concurrently, sequential steps run one at a time
      const parallelBatch = readySteps.filter((s) => s.parallel);
      const sequentialSteps = readySteps.filter((s) => !s.parallel);

      // Execute parallel steps concurrently
      if (parallelBatch.length > 0) {
        const parallelResults = await Promise.allSettled(
          parallelBatch.map((step) => this.executeStep(instance, phase, step))
        );

        for (let i = 0; i < parallelBatch.length; i++) {
          const step = parallelBatch[i];
          const result = parallelResults[i];

          // Check the actual step status, not just the return value.
          // The step may have been approved synchronously via an event listener
          // during execution, changing its status to 'completed' even though
          // executeStep returned false (because it originally required approval).
          if ((result.status === 'fulfilled' && result.value) || step.status === 'completed') {
            completed.add(step.name);
          } else if (step.status === 'failed' || step.status === 'blocked') {
            failed.add(step.name);
          }
          // If step is still waiting_approval, it's neither completed nor failed yet

          // Check if workflow was paused/cancelled during execution
          const statusCheck = instance.status as WorkflowInstanceStatus;
          if (statusCheck !== 'in-progress') {
            return false;
          }
        }
      }

      // Execute sequential steps one by one
      for (const step of sequentialSteps) {
        const statusCheck = instance.status as WorkflowInstanceStatus;
        if (statusCheck !== 'in-progress') {
          return false;
        }

        const success = await this.executeStep(instance, phase, step);

        // Check the actual step status after execution. An approval may have
        // been resolved synchronously (via event listener) during executeStep,
        // changing the status to 'completed' even though executeStep returned false.
        if (success || step.status === 'completed') {
          completed.add(step.name);
        } else if (step.status === 'waiting_approval') {
          // Step needs approval but hasn't been approved yet.
          // Stop the phase execution loop; it will be resumed
          // when the approval is handled.
          return false;
        } else {
          failed.add(step.name);
        }
      }
    }

    // Determine phase result
    const allStepsCompleted = phase.steps.every(
      (s) => s.status === 'completed' || s.status === 'skipped'
    );
    const anyStepFailed = phase.steps.some(
      (s) => s.status === 'failed' || s.status === 'blocked'
    );

    if (allStepsCompleted) {
      const phaseEndTime = Date.now();
      phase.status = 'completed';
      phase.completedAt = new Date().toISOString();
      instance.state.phaseStatuses[phase.name] = 'completed';

      // Build phase result
      const stepResults: Record<string, StepResult> = {};
      const phaseOutputs: Record<string, unknown> = {};
      for (const step of phase.steps) {
        if (step.result) {
          stepResults[step.name] = step.result;
          Object.assign(phaseOutputs, step.result.outputs);
        }
      }

      phase.result = {
        phaseName: phase.name,
        success: true,
        stepResults,
        outputs: phaseOutputs,
        durationMs: phaseEndTime - phaseStartTime,
        completedAt: phase.completedAt,
      };

      // Merge outputs into accumulated state
      Object.assign(instance.state.outputs, phaseOutputs);

      this.addHistory(instance, {
        type: 'phase_completed',
        phaseName: phase.name,
        message: `Phase "${phase.displayName}" completed successfully.`,
        data: { durationMs: phaseEndTime - phaseStartTime },
      });

      this.emitWorkflowEvent(instance, 'workflow.phase.completed', {
        phaseName: phase.name,
        displayName: phase.displayName,
        durationMs: phaseEndTime - phaseStartTime,
      });

      // Update progress
      instance.progress = this.calculateProgress(instance.phases, instance.state);
      this.emit('workflow:progress', instance.id, instance.progress);

      return true;
    }

    if (anyStepFailed && instance.status === 'in-progress') {
      phase.status = 'failed';
      instance.state.phaseStatuses[phase.name] = 'failed';

      this.addHistory(instance, {
        type: 'phase_failed',
        phaseName: phase.name,
        message: `Phase "${phase.displayName}" failed.`,
      });

      this.emitWorkflowEvent(instance, 'workflow.phase.failed', {
        phaseName: phase.name,
        displayName: phase.displayName,
        failedSteps: Array.from(failed),
      });

      return false;
    }

    // Phase is not done yet (possibly waiting for approval)
    return false;
  }

  /**
   * Execute a single workflow step.
   * Returns true if the step completed successfully.
   */
  private async executeStep(
    instance: WorkflowInstance,
    phase: WorkflowPhase,
    step: WorkflowStep
  ): Promise<boolean> {
    const stepKey = `${phase.name}.${step.name}`;
    const now = new Date().toISOString();

    step.status = 'active';
    step.startedAt = now;
    instance.state.stepStatuses[stepKey] = 'active';

    this.addHistory(instance, {
      type: 'step_started',
      phaseName: phase.name,
      stepName: step.name,
      message: `Step "${step.name}" started (agent: ${step.assignedAgent}, action: ${step.action}).`,
    });

    this.emitWorkflowEvent(instance, 'workflow.step.started', {
      phaseName: phase.name,
      stepName: step.name,
      agent: step.assignedAgent,
      action: step.action,
    });

    // Resolve inputs from accumulated outputs
    const resolvedInputs: Record<string, unknown> = {};
    for (const inputKey of step.inputArtifacts) {
      if (inputKey in instance.state.outputs) {
        resolvedInputs[inputKey] = instance.state.outputs[inputKey];
      }
    }

    const context: StepExecutionContext = {
      workflowInstanceId: instance.id,
      phaseName: phase.name,
      sessionId: instance.sessionId,
      accumulatedOutputs: { ...instance.state.outputs },
      resolvedInputs,
      projectName: instance.projectName,
      projectDescription: instance.projectDescription,
    };

    let result: StepResult;

    try {
      result = await this.stepExecutor(step, context);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Retry logic
      if (step.retryCount < step.maxRetries) {
        step.retryCount++;
        step.status = 'pending';
        instance.state.stepStatuses[stepKey] = 'pending';

        this.addHistory(instance, {
          type: 'step_failed',
          phaseName: phase.name,
          stepName: step.name,
          message: `Step "${step.name}" failed (attempt ${step.retryCount}/${step.maxRetries}): ${errorMessage}. Retrying...`,
        });

        // Recursive retry
        return this.executeStep(instance, phase, step);
      }

      step.status = 'failed';
      step.error = errorMessage;
      step.completedAt = new Date().toISOString();
      instance.state.stepStatuses[stepKey] = 'failed';

      step.result = {
        success: false,
        outputs: {},
        logs: [`Error: ${errorMessage}`],
        durationMs: step.startedAt ? Date.now() - new Date(step.startedAt).getTime() : 0,
        modelUsed: null,
        tokenUsage: null,
      };

      this.addHistory(instance, {
        type: 'step_failed',
        phaseName: phase.name,
        stepName: step.name,
        message: `Step "${step.name}" failed permanently: ${errorMessage}`,
      });

      this.emitWorkflowEvent(instance, 'workflow.step.failed', {
        phaseName: phase.name,
        stepName: step.name,
        error: errorMessage,
      });

      this.emit('workflow:error', instance.id, error instanceof Error ? error : new Error(errorMessage));

      return false;
    }

    // Step executed successfully
    if (result.success) {
      // Store outputs in accumulated state
      for (const [key, value] of Object.entries(result.outputs)) {
        instance.state.outputs[key] = value;
      }

      step.result = result;

      // Check if approval is required after this step
      if (step.approvalRequired) {
        step.status = 'waiting_approval';
        instance.state.stepStatuses[stepKey] = 'waiting_approval';
        instance.status = 'waiting_approval';

        const approval = this.createApprovalRequest(
          instance,
          phase.name,
          step.name,
          `Step "${step.name}" in phase "${phase.displayName}" completed and requires approval to proceed.`,
          step.assignedAgent
        );

        this.addHistory(instance, {
          type: 'approval_requested',
          phaseName: phase.name,
          stepName: step.name,
          message: `Approval requested for step "${step.name}".`,
          data: { approvalId: approval.id },
        });

        this.emitWorkflowEvent(instance, 'workflow.step.approval_requested', {
          phaseName: phase.name,
          stepName: step.name,
          approvalId: approval.id,
        });

        this.emit('workflow:approval_required', approval);

        return false; // Not "done" yet, waiting approval
      }

      step.status = 'completed';
      step.completedAt = new Date().toISOString();
      step.actualDuration = step.startedAt
        ? Math.round((Date.now() - new Date(step.startedAt).getTime()) / 60000)
        : null;
      instance.state.stepStatuses[stepKey] = 'completed';

      this.addHistory(instance, {
        type: 'step_completed',
        phaseName: phase.name,
        stepName: step.name,
        message: `Step "${step.name}" completed successfully.`,
        data: {
          durationMs: result.durationMs,
          outputKeys: Object.keys(result.outputs),
        },
      });

      this.emitWorkflowEvent(instance, 'workflow.step.completed', {
        phaseName: phase.name,
        stepName: step.name,
        durationMs: result.durationMs,
        outputs: Object.keys(result.outputs),
      });

      // Update progress
      instance.progress = this.calculateProgress(instance.phases, instance.state);
      this.emit('workflow:progress', instance.id, instance.progress);

      return true;
    } else {
      // Step returned success=false (soft failure)
      step.status = 'failed';
      step.error = result.logs.join('\n') || 'Step returned success=false';
      step.completedAt = new Date().toISOString();
      step.result = result;
      instance.state.stepStatuses[stepKey] = 'failed';

      this.addHistory(instance, {
        type: 'step_failed',
        phaseName: phase.name,
        stepName: step.name,
        message: `Step "${step.name}" failed: ${step.error}`,
      });

      this.emitWorkflowEvent(instance, 'workflow.step.failed', {
        phaseName: phase.name,
        stepName: step.name,
        error: step.error,
      });

      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Approval Helpers
  // --------------------------------------------------------------------------

  private createApprovalRequest(
    instance: WorkflowInstance,
    phaseName: string,
    stepName: string | null,
    description: string,
    requestedBy: AgentId | 'system'
  ): ApprovalRequest {
    const approval: ApprovalRequest = {
      id: randomUUID(),
      workflowInstanceId: instance.id,
      phaseName,
      stepName,
      description,
      status: 'pending',
      requestedBy,
      resolvedBy: null,
      comment: null,
      requestedAt: new Date().toISOString(),
      resolvedAt: null,
      context: {
        workflowName: instance.workflowName,
        projectName: instance.projectName,
        currentOutputs: Object.keys(instance.state.outputs),
      },
    };

    instance.state.pendingApprovals.push(approval);
    return approval;
  }

  private requestTransitionApproval(
    instance: WorkflowInstance,
    fromPhase: string,
    toPhase: string
  ): void {
    const fromDisplay = instance.phases.find((p) => p.name === fromPhase)?.displayName ?? fromPhase;
    const toDisplay = instance.phases.find((p) => p.name === toPhase)?.displayName ?? toPhase;

    instance.status = 'waiting_approval';

    const approval = this.createApprovalRequest(
      instance,
      toPhase,
      null,
      `Transition from "${fromDisplay}" to "${toDisplay}" requires approval.`,
      'system'
    );

    this.addHistory(instance, {
      type: 'approval_requested',
      phaseName: toPhase,
      message: `Approval requested for transition from "${fromDisplay}" to "${toDisplay}".`,
      data: { approvalId: approval.id, fromPhase, toPhase },
    });

    this.emitWorkflowEvent(instance, 'workflow.step.approval_requested', {
      approvalId: approval.id,
      fromPhase,
      toPhase,
      transitionApproval: true,
    });

    this.emit('workflow:approval_required', approval);
  }

  private checkTransitionApproval(
    instance: WorkflowInstance,
    _fromPhase: string,
    toPhase: string
  ): boolean {
    // Check if there's already a resolved approval for this transition
    const history = instance.state.history;
    const approvalResolved = history.some(
      (h) =>
        h.type === 'approval_resolved' &&
        h.phaseName === toPhase &&
        h.data?.['approved'] === true
    );
    return approvalResolved;
  }

  private getTransitionType(
    instance: WorkflowInstance,
    transitionKey: string
  ): TransitionType {
    // Look up the transition in the original definition
    const definition = this.loader.loadWorkflow(instance.workflowFile);
    return definition.transitions[transitionKey] ?? 'auto';
  }

  // --------------------------------------------------------------------------
  // Completion / Failure
  // --------------------------------------------------------------------------

  private completeWorkflow(instance: WorkflowInstance): void {
    instance.status = 'completed';
    instance.completedAt = new Date().toISOString();
    instance.updatedAt = instance.completedAt;

    instance.progress = this.calculateProgress(instance.phases, instance.state);

    this.addHistory(instance, {
      type: 'workflow_completed',
      message: `Workflow "${instance.workflowName}" completed successfully.`,
    });

    this.emitWorkflowEvent(instance, 'workflow.instance.completed', {
      totalPhases: instance.phases.length,
      completedPhases: instance.phases.filter((p) => p.status === 'completed').length,
    });

    this.emitWorkflowEvent(instance, 'workflow.pipeline.completed', {});
  }

  private failWorkflow(instance: WorkflowInstance, reason: string): void {
    instance.status = 'failed';
    instance.completedAt = new Date().toISOString();
    instance.updatedAt = instance.completedAt;

    instance.progress = this.calculateProgress(instance.phases, instance.state);

    this.addHistory(instance, {
      type: 'workflow_failed',
      message: `Workflow "${instance.workflowName}" failed: ${reason}`,
    });

    this.emitWorkflowEvent(instance, 'workflow.instance.failed', {
      reason,
    });

    this.emitWorkflowEvent(instance, 'workflow.pipeline.failed', { reason });
  }

  // --------------------------------------------------------------------------
  // Phase/Step Building from YAML
  // --------------------------------------------------------------------------

  /**
   * Build runtime WorkflowPhase objects from a YAML WorkflowDefinition.
   */
  private buildPhases(
    definition: WorkflowDefinition,
    _config: PipelineConfig
  ): WorkflowPhase[] {
    return definition.phases.map((yamlPhase, index) => {
      const steps = this.buildSteps(yamlPhase);

      // Determine transition type to next phase
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

  /**
   * Build runtime WorkflowStep objects from YAML step definitions.
   */
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

  /**
   * Calculate the current progress of a workflow from its phases and state.
   */
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
  // History / Events
  // --------------------------------------------------------------------------

  private addHistory(
    instance: WorkflowInstance,
    entry: Omit<WorkflowHistoryEntry, 'timestamp'>
  ): void {
    instance.state.history.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  private emitWorkflowEvent(
    instance: WorkflowInstance,
    type: WorkflowEventType,
    data: Record<string, unknown>
  ): void {
    const event: WorkflowEvent = {
      type,
      workflowInstanceId: instance.id,
      pipelineId: instance.id, // legacy alias
      phaseName: data['phaseName'] as string | undefined,
      stepName: data['stepName'] as string | undefined,
      sessionId: instance.sessionId,
      timestamp: new Date().toISOString(),
      triggeredBy: 'system',
      data,
      progress: instance.progress,
    };

    this.emit('workflow:event', event);
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

// ============================================================================
// Default Step Executor
// ============================================================================

/**
 * Default step executor that simulates step execution.
 * In production, this would be replaced with actual agent invocation
 * (e.g., calling an LLM through the model router).
 */
const defaultStepExecutor: StepExecutorFn = async (
  step: WorkflowStep,
  _context: StepExecutionContext
): Promise<StepResult> => {
  // Simulate execution time (50-200ms)
  const delay = 50 + Math.floor(Math.random() * 150);
  await new Promise((resolve) => setTimeout(resolve, delay));

  // Build simulated outputs from the step's declared output artifacts
  const outputs: Record<string, unknown> = {};
  for (const outputKey of step.outputArtifacts) {
    outputs[outputKey] = {
      _generated: true,
      _step: step.name,
      _agent: step.assignedAgent,
      _action: step.action,
      _timestamp: new Date().toISOString(),
    };
  }

  return {
    success: true,
    outputs,
    logs: [
      `[${step.assignedAgent}] Executed action "${step.action}" for step "${step.name}".`,
      `[${step.assignedAgent}] Produced outputs: ${step.outputArtifacts.join(', ') || 'none'}.`,
    ],
    durationMs: delay,
    modelUsed: step.modelOverride ?? null,
    tokenUsage: null,
  };
};

// ============================================================================
// Factory / Convenience
// ============================================================================

/**
 * Create and configure a WorkflowExecutor with sensible defaults.
 * workflowsDir defaults to the project's workflows/ directory.
 */
export function createWorkflowEngine(
  workflowsDir?: string,
  stepExecutor?: StepExecutorFn
): WorkflowExecutor {
  const dir = workflowsDir ?? join(__dirname, '..', '..', 'workflows');
  return new WorkflowExecutor(dir, stepExecutor);
}
