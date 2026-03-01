# ForgeTeam Usage Guide

A comprehensive guide to using ForgeTeam's 12-agent autonomous SDLC platform. Every scenario includes exact dashboard steps referencing real UI elements.

---

## Table of Contents

1. [Full Project Lifecycle](#1-full-project-lifecycle)
2. [Feature Development](#2-feature-development)
3. [Bug Fixing & Incidents](#3-bug-fixing--incidents)
4. [Testing & Quality](#4-testing--quality)
5. [Security & Compliance](#5-security--compliance)
6. [Infrastructure & DevOps](#6-infrastructure--devops)
7. [Code Maintenance](#7-code-maintenance)
8. [Project Management](#8-project-management)
9. [Documentation](#9-documentation)
10. [Real-Time Dashboard Interactions](#10-real-time-dashboard-interactions)
11. [Cost Control](#11-cost-control)
12. [Human-in-the-Loop](#12-human-in-the-loop)
13. [VIADP Delegation](#13-viadp-delegation)
14. [External Integrations](#14-external-integrations)
15. [Tool Execution](#15-tool-execution)
16. [Data Sovereignty](#16-data-sovereignty)

---

## Dashboard Layout Reference

Before diving into scenarios, here is a quick reference of the dashboard's major UI elements:

- **Sidebar** (left): 10 navigation tabs — Dashboard, Conversation, Kanban, Agents, Workflows, Memory, Models & Cost, Escalations, VIADP Audit, Settings. At the bottom: Language toggle (AR/EN), Theme toggle (dark/light), and Collapse button.
- **Kanban Board**: 5 columns (Backlog, To Do, In Progress, Review, Done). Each card has a priority badge, assigned agent, and action buttons (Start, Approve, Revise). A "+ New Task" button sits in the top-right corner.
- **Conversation Panel**: Session selector dropdown, agent target dropdown, text input field, microphone button, and Party Mode toggle.
- **Workflows Panel**: Pause All / Resume All buttons, phase pipeline with progress bars and checkpoint dots, and a Gantt-style timeline below.
- **Agents Panel**: Grid of agent cards showing avatar, name, role, status dot, model, and current task. Clicking a card opens a detail modal with Take Over / Release buttons.
- **Escalation Queue**: Filter tabs (All / Pending / Reviewed / Dismissed), expandable escalation cards with Review and Dismiss buttons.
- **Interrupt Modal**: A floating red badge (top-right corner) with a pending count. Clicking it opens a modal listing pending interrupts with Approve and Reject buttons (Reject reveals a feedback text input).
- **Models & Cost Panel**: Area chart (last 7 days), daily budget progress bar, editable agent-model table (Primary Model, Fallback, Fallback 2, Temperature, Daily Cap columns), Optimize button, and Save button.
- **Memory Explorer**: Search input, scope dropdown (Company KB / Team Memory / Project Memory / Agent Memory), result cards with relevance scores, and per-agent memory stat cards below.
- **VIADP Audit**: Agent filter dropdown, status filter dropdown (Verified / Pending / Failed), timeline with expandable delegation entries showing proof chains.
- **Voice Transcripts**: Session filter dropdown, language filter dropdown (All / Arabic / English), transcript cards with direction icon and confidence bar.
- **Settings Panel**: Gateway URL input, Default Model dropdown, Daily Budget Limit input, Auto-Scroll toggle, Escalation Notifications toggle, and Save button.
- **Connection indicator**: Top-right corner shows a green dot (Connected) or grey dot (Offline).

---

## 1. Full Project Lifecycle

### 1.1 Launch a Full SDLC Project from Scratch

Build an entire application — from requirements through deployment — using the `full-sdlc` workflow.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. In the session selector (top of the panel), click **+ New Session** to start a fresh session.
3. Leave the agent target dropdown set to **bmad-master** (the default orchestrator).
4. In the text input, type your project brief, e.g.:
   ```
   Build a mobile-first attendance tracker for schools in Riyadh.
   Requirements: student check-in via QR code, parent SMS notifications,
   Arabic/English UI, PostgreSQL backend.
   Use the full-sdlc workflow.
   ```
5. Press **Enter** or click the **Send** button (arrow icon).
6. Switch to the **Kanban** tab in the sidebar. You will see tasks appearing in the **Backlog** column as the orchestrator decomposes your brief into work items.
7. Watch the **Workflows** tab — the full-sdlc pipeline phases (Requirements, Design, Implementation, Testing, Deployment) will light up sequentially.
8. On the **Dashboard** tab, the **StatsBar** at the top shows active tasks, working agents, sprint progress percentage, and today's cost in real time.

**What happens:** bmad-master parses your request, selects the `full-sdlc.yaml` workflow, and delegates tasks to the 12 agents in sequence. Product Owner writes requirements, Architect designs the system, Frontend/Backend devs implement, QA tests, DevOps deploys, and Tech Writer documents — all autonomously.

---

### 1.2 Monitor Overall Sprint Progress

Track how far along the team is in completing the current sprint.

**From the Dashboard:**

1. Click **Dashboard** in the sidebar.
2. The **StatsBar** at the top shows four cards: Active Tasks, Working Agents, Sprint Progress (percentage), and Today's Cost.
3. The **Sprint Progress** card shows a percentage calculated from completed vs total tasks.
4. Below the StatsBar, the **Kanban Board** shows task distribution across all 5 columns. The count badge on each column header tells you how many tasks are in that state.
5. To the right of the Kanban, the **Agent Status Grid** shows which agents are working (green pulse dot), idle (grey), reviewing (purple), or blocked (red).

**What happens:** The dashboard polls the gateway every 3 seconds and receives real-time WebSocket events, so all numbers update live.

---

### 1.3 View Workflow Phase Details

See exactly which phases have completed, which are active, and which are pending.

**From the Dashboard:**

1. Click **Workflows** in the sidebar.
2. The **phase pipeline** at the top shows each phase as a node with a status icon:
   - Green checkmark = Complete
   - Gold play icon = Active
   - Grey circle = Pending
3. Each phase shows its name, a mini progress bar, a percentage, and checkpoint dots (filled = done, empty = remaining).
4. Below the pipeline, a **Gantt-style timeline** shows phase durations as horizontal bars with fill levels matching progress.
5. Use the **Pause All** button (amber, top-right) to freeze all agents. Use **Resume All** (green) to restart.

---

## 2. Feature Development

### 2.1 Create a New Feature Task

Add a feature request to the Kanban board for the team to pick up.

**From the Dashboard:**

1. Click **Kanban** in the sidebar.
2. Click the **"New Task"** button (blue, top-right corner with a + icon).
3. A modal appears with fields:
   - **Task title**: type the feature name, e.g. "Add dark mode toggle to settings page"
   - **Description**: add details (optional)
   - **Priority**: select from the dropdown (Low / Medium / High / Critical)
   - **Assign to**: optionally pick an agent from the dropdown, or leave as "Unassigned"
4. Click **Create**.
5. The task appears in the **Backlog** column.

**What happens:** The task is sent to the gateway via the API. If assigned to an agent, that agent will be notified. If unassigned, bmad-master picks it up during the next planning cycle.

---

### 2.2 Start a Feature Task

Kick off work on a task that's sitting in Backlog or To Do.

**From the Dashboard:**

1. Click **Kanban** in the sidebar.
2. Find the task card in the **Backlog** or **To Do** column.
3. Click the green **Start** button at the bottom of the card.
4. The button changes to a spinning loader with "Working..." text.
5. The task card automatically moves to the **In Progress** column.
6. Switch to the **Agents** tab — the assigned agent's status dot turns green ("Working").

**What happens:** The gateway dispatches the task to the assigned agent (or auto-assigns one). The agent reads the task description, plans its approach, and begins generating code/designs.

---

### 2.3 Run a Feature Sprint Workflow

Use the `feature-sprint` workflow for rapid, focused feature delivery.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Select or create a session.
3. Set the agent target to **bmad-master**.
4. Type:
   ```
   Start a feature sprint for: user profile page with avatar upload,
   bio editor, and activity feed. Sprint duration: 3 days.
   ```
5. Press **Enter**.
6. Switch to **Workflows** — the feature-sprint phases (Plan, Design, Implement, Review, Ship) appear.
7. Switch to **Kanban** — sprint tasks populate automatically.

---

### 2.4 Review and Approve a Completed Feature

When an agent finishes a feature task, review its output and approve or request revisions.

**From the Dashboard:**

1. Click **Kanban** in the sidebar.
2. Look for task cards in the **Review** column. These have two action buttons:
   - **Approve** (green checkmark) — moves the task to Done
   - **Revise** (amber rotate icon) — sends the task back for rework
3. Click the **task card body** to open the expanded detail modal. Inside you'll see:
   - Task title and description
   - Priority badge
   - Assigned agent info (avatar, name, role)
   - **Agent Response** section with the agent's full output
   - **Artifacts** section with links to generated files
   - **Agent Messages** section with recent chat from the agent
   - A **"View in Conversation"** button to jump to the agent's chat
4. After reviewing, close the modal and click **Approve** to accept, or click **Revise** to open a feedback dialog.
5. If you click **Revise**, type your feedback in the textarea (e.g. "Add error handling for file upload > 5MB") and click **Send Feedback**.

**What happens:** Approving moves the task to Done. Revising sends the task back to In Progress with your feedback attached, and the agent re-works the task.

---

## 3. Bug Fixing & Incidents

### 3.1 Report a Bug

Create a high-priority bug task for the team.

**From the Dashboard:**

1. Click **Kanban** in the sidebar.
2. Click **"New Task"** (blue button, top-right).
3. Fill in:
   - **Title**: "Login fails with 500 error when password contains special characters"
   - **Description**: paste the stack trace or reproduction steps
   - **Priority**: select **Critical** or **High**
   - **Assign to**: select **qa-architect** or leave unassigned
4. Click **Create**.
5. The task appears in **Backlog** with a red "Critical" badge.
6. Click the **Start** button to immediately dispatch it.

---

### 3.2 Run a Bug-Fix Workflow

Use the structured `bug-fix` workflow for systematic bug resolution.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Set the agent target to **bmad-master**.
3. Type:
   ```
   Run the bug-fix workflow for: Users report 500 error on /api/login
   when password contains special chars like !@#. The error occurs in
   auth-service/src/middleware/validate.ts line 42.
   ```
4. Press **Enter**.
5. Switch to **Workflows** — the bug-fix phases (Reproduce, Diagnose, Fix, Test, Verify) light up.
6. Switch to **Kanban** to see individual tasks for each phase.

**What happens:** bmad-master launches the `bug-fix.yaml` workflow. QA reproduces the issue, Backend Dev diagnoses and patches, QA writes regression tests, and Security Specialist verifies no new vulnerabilities were introduced.

---

### 3.3 Handle an Incident with Hotfix

Deploy an emergency fix using the `hotfix` workflow.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Set the target to **bmad-master**.
3. Type:
   ```
   URGENT: Production is down. The /api/payments endpoint returns
   502 since the last deploy. Run the hotfix workflow.
   ```
4. Press **Enter**.
5. Monitor the **Workflows** tab — hotfix phases move quickly (Triage, Patch, Smoke Test, Deploy).
6. Check the **Agents** tab — Backend Dev and DevOps engineer will show as "Working" simultaneously.

---

### 3.4 Run an Incident Response Workflow

For broader production incidents requiring coordinated response.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type:
   ```
   Incident: Database connection pool exhaustion causing cascading
   failures across microservices. Run the incident-response workflow.
   ```
4. Press **Enter**.
5. Watch **Workflows** for the incident-response phases (Detect, Contain, Eradicate, Recover, Post-Mortem).
6. Check **Escalations** tab — agents may escalate decisions requiring human judgment.

---

## 4. Testing & Quality

### 4.1 Request a Full Test Suite

Ask QA to write comprehensive tests for a module.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Set agent target to **qa-architect** from the dropdown.
3. Type:
   ```
   Write a full test suite for the authentication module:
   - Unit tests for all auth functions
   - Integration tests for login/logout/register flows
   - Edge cases: expired tokens, brute force protection, special characters
   ```
4. Press **Enter**.
5. Switch to **Kanban** — a task appears in **In Progress** assigned to qa-architect.
6. When done, the task moves to **Review**. Click the card to see generated test files in the **Artifacts** section.

---

### 4.2 Run E2E Tests

Trigger end-to-end testing using the `e2e-test-suite` workflow.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the e2e-test-suite workflow against the staging environment.`
4. Press **Enter**.
5. Monitor in **Workflows** — phases like Setup, Execute, Report will appear.
6. Check **Kanban** for individual test task results.

---

### 4.3 Request a Code Review

Have the team review a specific piece of code.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type:
   ```
   Run the code-review workflow on the payment processing module
   (src/services/payment/). Focus on security, error handling,
   and performance.
   ```
4. Press **Enter**.
5. Switch to **Kanban** — review tasks appear for Architect (design review), Security Specialist (security review), and QA (test coverage review).

---

### 4.4 Run Load Tests

Stress-test your application with the `load-test` workflow.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run load-test workflow: simulate 10,000 concurrent users on /api/checkout for 15 minutes.`
4. Press **Enter**.
5. Monitor **Workflows** for load-test phases (Plan, Configure, Execute, Analyze).
6. Results appear as artifacts on the completed tasks in **Kanban**.

---

## 5. Security & Compliance

### 5.1 Run a Security Review

Launch a full security audit of your codebase.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the security-review workflow on the entire codebase.`
4. Press **Enter**.
5. Switch to **Workflows** — the security-review phases (Scan, Analyze, Report, Remediate) appear.
6. Switch to **Agents** tab — security-specialist's card shows "Working" status.
7. When complete, check **Kanban** for the review task. Click it to see the security report in the **Agent Response** section and any file artifacts.

---

### 5.2 Run a Penetration Test

Use the `penetration-test` workflow for active security testing.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type:
   ```
   Run the penetration-test workflow against the staging API.
   Focus on: OWASP Top 10, authentication bypass, SQL injection,
   XSS, and CSRF.
   ```
4. Press **Enter**.
5. Monitor **Workflows** for pentest phases.
6. Security findings will trigger **Escalation** items. Switch to the **Escalations** tab to review them.

---

### 5.3 Run a Compliance Check

Verify your project meets compliance standards.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the compliance-check workflow for GDPR and Saudi PDPL data protection requirements.`
4. Press **Enter**.
5. Check **Kanban** and **Workflows** for compliance task progress.
6. Review findings in the **Escalations** tab — compliance issues that need human decisions appear here with **Review** and **Dismiss** buttons.

---

### 5.4 Security Hardening

Harden your infrastructure and application security posture.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the security-hardening workflow. Include TLS configuration, secrets management, CORS policies, and rate limiting.`
4. Press **Enter**.
5. Monitor tasks in **Kanban** — security-specialist and devops-engineer work in parallel.

---

## 6. Infrastructure & DevOps

### 6.1 Set Up CI/CD Pipeline

Create a continuous integration and deployment pipeline.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the ci-cd-pipeline workflow. Target: GitHub Actions, deploy to Docker containers, include staging and production environments.`
4. Press **Enter**.
5. Switch to **Workflows** to see pipeline setup phases.
6. Switch to **Agents** — devops-engineer (rocket icon) will be "Working".

---

### 6.2 Environment Setup

Provision development and staging environments.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **devops-engineer** from the dropdown.
3. Type:
   ```
   Set up the development environment:
   - Docker Compose with PostgreSQL, Redis, and the gateway
   - Seed data for testing
   - Environment variable template
   ```
4. Press **Enter**.
5. Check **Kanban** for the task. When done, artifacts will include Docker Compose files and setup scripts.

---

### 6.3 Infrastructure Audit

Review and improve your infrastructure.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the infrastructure-audit workflow. Check for: unused resources, security groups, backup configurations, and monitoring gaps.`
4. Press **Enter**.
5. Monitor in **Workflows** and **Kanban**.

---

### 6.4 Monitoring Setup

Set up application monitoring and alerting.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the monitoring-setup workflow. Include health checks, error rate alerts, latency tracking, and cost monitoring dashboards.`
4. Press **Enter**.

---

## 7. Code Maintenance

### 7.1 Refactor a Module

Clean up and restructure existing code.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type:
   ```
   Run the refactoring workflow on src/services/user/.
   Goals: extract common auth logic into shared middleware,
   improve type safety, reduce code duplication.
   ```
4. Press **Enter**.
5. Switch to **Kanban** — tasks appear for Architect (plan), Backend Dev (implement), and QA (verify no regressions).

---

### 7.2 Reduce Technical Debt

Systematically address tech debt across the codebase.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the tech-debt-reduction workflow. Prioritize: deprecated dependencies, TODO comments, missing error handling, and dead code.`
4. Press **Enter**.
5. Monitor **Kanban** for individual debt items being created and resolved.

---

### 7.3 Database Migration

Plan and execute a database schema change.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type:
   ```
   Run the migration workflow: Add a "preferences" JSONB column
   to the users table, backfill from the legacy settings table,
   then drop the settings table.
   ```
4. Press **Enter**.
5. Watch **Workflows** — migration phases (Plan, Script, Test, Execute, Verify) track progress.
6. Expect an **interrupt** (red badge) asking for approval before executing destructive changes.

---

### 7.4 Microservice Extraction

Extract a bounded context into its own service.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the microservice-extraction workflow to extract the notification subsystem into a standalone service.`
4. Press **Enter**.
5. Architect and Backend Dev collaborate — check both agents' status in the **Agents** tab.

---

## 8. Project Management

### 8.1 Kick Off a New Project

Start project planning with stakeholder alignment.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the project-kickoff workflow for a new e-commerce platform. Stakeholders: product team, engineering, design, and compliance.`
4. Press **Enter**.
5. Product Owner and Business Analyst will create initial requirements. Check **Kanban** for planning deliverables.

---

### 8.2 Run a Sprint Retrospective

Reflect on what went well and what to improve.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the sprint-retrospective workflow for Sprint 4.`
4. Press **Enter**.
5. The Scrum Master agent collects data from completed tasks, agent performance, and escalation history.
6. Results appear as a retrospective report in **Kanban** task artifacts.

---

### 8.3 Generate a Stakeholder Report

Create a progress report for external stakeholders.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the stakeholder-report workflow. Include: sprint progress, key deliverables, blockers, budget utilization, and next sprint plan.`
4. Press **Enter**.
5. The report task appears in **Kanban**. When complete, click the card and check **Artifacts** for the generated report document.

---

### 8.4 Estimation Workshop

Estimate effort for upcoming features.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type:
   ```
   Run the estimation-workshop workflow for these features:
   1. Real-time notifications system
   2. Multi-tenant support
   3. Data export to CSV/PDF
   ```
4. Press **Enter**.
5. Multiple agents collaborate on estimates — Architect for complexity, Backend Dev for effort, QA for test effort.

---

### 8.5 Capacity Planning

Plan resource allocation for the next quarter.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the capacity-planning workflow for Q2 2026. Consider current team velocity, planned features, and tech debt backlog.`
4. Press **Enter**.

---

## 9. Documentation

### 9.1 Generate API Documentation

Have the Tech Writer create comprehensive API docs.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Set agent target to **tech-writer** from the dropdown.
3. Type:
   ```
   Generate complete API documentation for the gateway REST API.
   Include: all endpoints, request/response schemas, authentication,
   error codes, and example curl commands.
   ```
4. Press **Enter**.
5. Switch to **Kanban** — the documentation task appears.
6. When complete, click the task card and check **Artifacts** for the generated docs.

---

### 9.2 Update Documentation After Changes

Keep docs in sync with code changes.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the documentation-update workflow. The authentication module was refactored — update all related docs, README, and API reference.`
4. Press **Enter**.

---

### 9.3 Create Onboarding Guide

Generate a developer onboarding guide.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the onboarding workflow. Create a new developer onboarding guide covering: project setup, architecture overview, coding standards, and PR process.`
4. Press **Enter**.

---

## 10. Real-Time Dashboard Interactions

### 10.1 Chat Directly with an Agent

Send a message to a specific agent and get a response.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. In the **session selector** at the top, pick an existing session or click **+ New Session**.
3. Open the **agent target dropdown** (below the session selector). Select the agent you want to talk to, e.g. **architect**.
4. Type your message in the text input at the bottom, e.g.: "What design patterns would you recommend for the notification system?"
5. Press **Enter** or click the **Send** button (arrow icon).
6. The agent's response appears as a chat bubble in the message thread.

---

### 10.2 Use Voice Input

Speak your instructions instead of typing.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Click the **microphone button** (mic icon, next to the text input).
3. The mic icon turns red and shows a pulsing animation — speak your instruction.
4. Click the mic button again to stop recording.
5. Your speech is transcribed and sent as a text message. The transcription appears in the text input.
6. To view all voice transcripts, a **Voice Transcripts** panel can be found showing session and language filters.

**What you'll see:** The VoiceTranscriptViewer shows all past transcriptions with:
- Direction icon (microphone for speech-to-text, speaker for text-to-speech)
- Language badge (AR or EN)
- Confidence bar showing transcription accuracy
- Session and language filter dropdowns at the top

---

### 10.3 Use Party Mode (Multi-Agent Chat)

Have multiple agents discuss a topic together.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Click the **Party Mode toggle** (sparkles icon with "Party" label, near the session selector).
3. The panel switches to multi-agent mode. Select which agents to include using the agent selection interface.
4. Type your discussion topic: "Discuss the trade-offs between monolith and microservices for our project."
5. Press **Enter**.
6. Multiple agents respond in the thread, building on each other's points.

---

### 10.4 Drag a Task Between Columns

Manually move a task on the Kanban board.

**From the Dashboard:**

1. Click **Kanban** in the sidebar.
2. Find the task card you want to move.
3. Click and hold the task card, then drag it to the target column (e.g. from "To Do" to "In Progress").
4. Release the card. The column count badges update immediately.
5. The status change is persisted to the gateway automatically.

---

### 10.5 Switch Between Arabic and English

Toggle the dashboard language.

**From the Dashboard:**

1. Look at the **sidebar footer** (bottom of the left sidebar).
2. Click the **Language button** — it shows "English" when the UI is in Arabic, or "العربية" when in English.
3. The entire dashboard immediately re-renders in the selected language. All labels, agent names, task titles, and navigation switch to the chosen language.
4. The layout direction also flips: Arabic uses right-to-left (RTL), English uses left-to-right (LTR).

---

### 10.6 Switch Between Dark and Light Theme

Toggle the visual theme.

**From the Dashboard:**

1. In the **sidebar footer**, click the **Theme button**. It shows a sun icon (to switch to light) or moon icon (to switch to dark).
2. The entire dashboard re-renders with the new color scheme.

---

### 10.7 View the Message Feed

See a live stream of all agent communications.

**From the Dashboard:**

1. Click **Dashboard** in the sidebar.
2. Scroll down below the Kanban board to the bottom row.
3. The **Message Feed** panel (left side) shows the latest messages from all agents in chronological order.
4. Each message shows the sender's name, content, and timestamp.

---

## 11. Cost Control

### 11.1 Monitor Daily Spending

Track how much the team is spending today.

**From the Dashboard:**

1. Click **Models & Cost** in the sidebar.
2. The **area chart** at the top shows spending over the last 7 days. A red dashed line indicates your budget limit.
3. Below the chart, the **daily budget bar** shows today's spend vs. your limit:
   - Green = under 60% of budget
   - Amber = 60-80% of budget
   - Red = over 80% of budget
4. The label shows exact figures, e.g. "$12.50 / $75.00".

---

### 11.2 Change an Agent's Model

Switch which LLM model an agent uses.

**From the Dashboard:**

1. Click **Models & Cost** in the sidebar.
2. Scroll down to the **agent-model table**.
3. Find the agent row (use the **search input** above the table to filter by name).
4. Click the **Primary Model** dropdown for that agent and select a new model, e.g. change from `gemini-3.1-pro` to `claude-sonnet-4-6`.
5. Optionally adjust the **Fallback** and **Fallback 2** dropdowns.
6. Click **Save** (blue button below the table) to persist changes.

**What happens:** The gateway updates the model routing for that agent. All future requests from that agent will use the new model.

---

### 11.3 Adjust Agent Temperature

Fine-tune an agent's creativity vs. precision.

**From the Dashboard:**

1. Click **Models & Cost** in the sidebar.
2. In the agent-model table, find the agent row.
3. The **Temperature** column has a numeric input. Change it (range 0.0 to 1.0):
   - Lower values (0.0-0.3) = more deterministic, precise
   - Higher values (0.5-0.8) = more creative, varied
4. Click **Save** to persist.

---

### 11.4 Set a Daily Cost Cap per Agent

Prevent a single agent from consuming too much budget.

**From the Dashboard:**

1. Click **Models & Cost** in the sidebar.
2. In the agent-model table, find the **Daily Cap** column.
3. Edit the numeric input for each agent (value in USD).
4. If an agent exceeds its cap, its cost cell turns red with a warning icon.
5. Click **Save** to persist.

---

### 11.5 Use the Auto-Optimize Suggestion

Get AI-powered recommendations for cost optimization.

**From the Dashboard:**

1. Click **Models & Cost** in the sidebar.
2. Click the **Optimize** button (sparkles icon, top-right of the table section).
3. A toast notification appears at the top of the screen with optimization suggestions, e.g.:
   - "Consider switching Scrum Master to gemini-flash-3 for 40% cost reduction"
   - "Frontend Dev's temperature of 0.7 is high for code generation — try 0.3"
4. Apply suggestions manually by editing the table, then click **Save**.

---

### 11.6 Sort Agents by Cost or Token Usage

Identify which agents consume the most resources.

**From the Dashboard:**

1. Click **Models & Cost** in the sidebar.
2. In the agent-model table, click the **Tokens Used** column header — it shows a sort icon (arrows). Click to toggle ascending/descending sort.
3. Click the **Cost (USD)** column header to sort by dollar spend.
4. The **Total** row at the bottom of the table shows aggregate tokens and cost across all agents.

---

## 12. Human-in-the-Loop

### 12.1 Respond to an Interrupt (Approval Gate)

When an agent hits a decision point requiring human approval.

**From the Dashboard:**

1. A **floating red badge** appears in the top-right corner of the screen showing the number of pending interrupts, e.g. "1 Pending".
2. Click the red badge to open the **Interrupt Modal**.
3. Each interrupt card shows:
   - Agent avatar and name
   - Type badge (Approval Gate, @human Mention, or Low Confidence)
   - The agent's question or request
   - Context details
   - For Low Confidence types: a confidence percentage bar
   - Timestamp
4. Click **Approve** (green button with checkmark) to authorize the agent to proceed.
5. Or click **Reject** (red button with X) — this reveals a text input. Type your feedback explaining why you're rejecting (e.g. "Use a different approach — avoid breaking the existing API contract"). Press the checkmark button or Enter to submit.
6. The interrupt disappears from the list. The agent acts on your decision.

---

### 12.2 Review an Escalation

When an agent's confidence is below threshold or it encounters an issue.

**From the Dashboard:**

1. Click **Escalations** in the sidebar.
2. The **filter tabs** at the top let you view: **All**, **Pending**, **Reviewed**, or **Dismissed** escalations.
3. Click the **Pending** tab to see only unresolved items.
4. Each escalation card shows:
   - Agent avatar and name
   - Task title
   - Status badge (Pending / Reviewed / Dismissed)
   - Confidence bar with color coding (red < 70%, amber 70-85%, green > 85%)
   - Reason text explaining why the agent escalated
   - "Show response" link to expand and see the agent's attempted output
   - Timestamp
5. To review: Click the **Review** button. A text input appears — type your guidance and click the checkmark to submit. The escalation moves to "Reviewed" status.
6. To dismiss: Click the **Dismiss** button. The escalation moves to "Dismissed" status.

---

### 12.3 Take Over an Agent

Assume direct control of an agent's actions.

**From the Dashboard:**

1. Click **Agents** in the sidebar.
2. Click on the agent card you want to control. A **detail modal** opens showing the agent's full info.
3. At the bottom of the modal, click the **Take Over** button (blue, with a user-check icon).
4. The modal closes. A **TakeOverBanner** appears at the top of the dashboard:
   - It shows the agent's avatar, name, and a "You are controlling this agent" message.
   - A text input lets you type commands as the agent.
   - A **Release** button lets you return control to the AI.
5. Type instructions in the banner's text input to act as that agent.
6. On the **Agents** tab, the taken-over agent now shows "Human Controlled" status with an amber ring.

---

### 12.4 Release a Taken-Over Agent

Return control of an agent back to the AI.

**From the Dashboard:**

1. If you have taken over an agent, a **TakeOverBanner** is visible at the top of the page.
2. Click the **Release** button (amber, with user-X icon) in the banner.
3. Alternatively, go to **Agents** tab, click the taken-over agent's card, and click **Release** in the detail modal.
4. The agent returns to autonomous operation and its status returns to "Idle" or "Working" based on its current task.

---

## 13. VIADP Delegation

### 13.1 View the Delegation Audit Trail

Inspect how agents delegate tasks to each other with cryptographic verification.

**From the Dashboard:**

1. Click **VIADP Audit** in the sidebar.
2. The **timeline view** shows a chronological list of all agent-to-agent delegations.
3. Each entry shows:
   - **Delegator → Delegatee** (agent names with an arrow)
   - **Status badge**: Verified (green), Pending (amber), or Failed (red)
   - **Task description**
   - **Timestamp** and **Trust Score** (color-coded percentage)
4. Click any entry to **expand** it and reveal the **Proof Chain** — a numbered list of verification steps that prove the delegation was authorized and valid.

---

### 13.2 Filter Delegations by Agent

Find delegations involving a specific agent.

**From the Dashboard:**

1. Click **VIADP Audit** in the sidebar.
2. Use the **Agent filter dropdown** (shows "Filter by Agent: All" by default).
3. Select an agent name from the list. The timeline filters to show only delegations where that agent was either the delegator or delegatee.
4. Combine with the **Status filter dropdown** (Verified / Pending / Failed) to narrow results further.

---

### 13.3 Investigate a Failed Delegation

Understand why a delegation failed.

**From the Dashboard:**

1. Click **VIADP Audit** in the sidebar.
2. Set the **Status filter** dropdown to **Failed**.
3. Click on the failed delegation entry to expand it.
4. Read the **Proof Chain** — it shows where verification broke down, e.g.:
   - "Trust score 45% below threshold of 70%"
   - "Delegatee capability mismatch: requested 'security-audit' but agent lacks 'security' skill"
5. The trust score color indicates severity: red (< 70%) means significant trust issues.

---

## 14. External Integrations

### 14.1 Connect to a Gateway

Configure the WebSocket connection to the ForgeTeam gateway.

**From the Dashboard:**

1. Click **Settings** in the sidebar.
2. The **Gateway URL** field shows the current WebSocket endpoint (default: `ws://localhost:3001`).
3. Change the URL to point to your gateway, e.g. `ws://forge.internal:3001`.
4. Click **Save** (blue button at the bottom of the settings panel).
5. Check the **connection indicator** (top-right of the main content area) — it should show a green dot with "Connected" text.

---

### 14.2 Direct an Agent to Integrate an External API

Ask an agent to write integration code for third-party services.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Set agent target to **backend-dev** or **bmad-master**.
3. Type:
   ```
   Integrate the Twilio SMS API for sending parent notifications.
   Use environment variables for credentials. Include error handling
   and rate limiting.
   ```
4. Press **Enter**.
5. The agent generates the integration code. Review it in the task's **Agent Response** section on the **Kanban** tab.

---

### 14.3 Configure Release Management

Set up automated releases with the `release-management` workflow.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the release-management workflow. Version: v2.1.0. Include changelog generation, version bumping, Docker image tagging, and deployment to staging.`
4. Press **Enter**.
5. Monitor in **Workflows** and **Kanban**.

---

## 15. Tool Execution

### 15.1 Ask an Agent to Execute a Specific Tool

Have an agent run a tool (e.g., linting, formatting, testing) through the conversation.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Set agent target to the relevant agent (e.g., **qa-architect** for tests, **devops-engineer** for builds).
3. Type: `Run the linter on src/ and fix all ESLint errors.`
4. Press **Enter**.
5. The agent uses its tool execution capabilities to run the linter, shows results in the chat, and creates fix tasks if needed.

---

### 15.2 Design an API Endpoint

Have the Architect design and the Backend Dev implement an API.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type:
   ```
   Run the api-design workflow for a new endpoint:
   POST /api/attendance/check-in
   - Accept: student_id, school_id, timestamp, QR code payload
   - Validate QR code authenticity
   - Record attendance and notify parent via SMS
   ```
4. Press **Enter**.
5. Architect designs the endpoint schema. Backend Dev implements it. QA writes tests. All tracked in **Kanban**.

---

### 15.3 Design a Database Schema

Have the team design and implement a database.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the database-design workflow for the attendance tracking system. Include: students, schools, attendance records, parents, and notifications tables.`
4. Press **Enter**.

---

### 15.4 UI Redesign

Redesign a user interface component or page.

**From the Dashboard:**

1. Click **Conversation** in the sidebar.
2. Target: **bmad-master**.
3. Type: `Run the ui-redesign workflow for the student dashboard. Goals: mobile-first responsive design, Arabic RTL support, accessibility WCAG 2.1 AA compliance.`
4. Press **Enter**.
5. UX Designer creates wireframes, Frontend Dev implements, QA validates accessibility.

---

## 16. Data Sovereignty

### 16.1 Search the Memory System

Find specific information stored in the team's collective memory.

**From the Dashboard:**

1. Click **Memory** in the sidebar.
2. In the **search input** at the top, type your query, e.g. "authentication flow design decisions".
3. Select the **scope** from the dropdown:
   - **Company KB** — organization-wide knowledge base
   - **Team Memory** — shared team context
   - **Project Memory** — project-specific decisions and artifacts
   - **Agent Memory** — individual agent's context and learnings
4. Results appear as cards below the search input, each showing:
   - Title
   - Content snippet
   - Source (agent or system)
   - Relevance score (percentage)
5. Below the search results, **per-agent memory cards** show each agent's memory stats:
   - Short-term memory tokens and last update time
   - Long-term memory entry count and token total

---

### 16.2 Review Agent Memory Usage

Check how much memory each agent has accumulated.

**From the Dashboard:**

1. Click **Memory** in the sidebar.
2. Scroll past the search section to the **agent memory grid**.
3. Each card shows an agent's avatar, name, and two memory sections:
   - **Short-Term**: current token count and minutes since last update.
   - **Long-Term**: number of stored entries and total token count.
4. This helps identify agents with excessive memory usage that may need pruning.

---

### 16.3 Verify Data Stays On-Premise

Confirm that all processing uses your configured models and gateway.

**From the Dashboard:**

1. Click **Settings** in the sidebar.
2. Verify the **Gateway URL** points to your internal server (not an external endpoint).
3. Click **Models & Cost** in the sidebar.
4. In the agent-model table, verify all agents use approved models. The available models are:
   - `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5` (Anthropic)
   - `gemini-3.1-pro`, `gemini-flash-3`, `gemini-2.0-flash` (Google)
5. No GPT or other third-party models are available by design.

---

### 16.4 Audit Agent Delegations for Data Compliance

Ensure delegations follow your data handling policies.

**From the Dashboard:**

1. Click **VIADP Audit** in the sidebar.
2. Review the delegation timeline. Each entry shows which agent delegated what task to whom.
3. Expand entries to view the **Proof Chain** — verify that:
   - Delegations follow the trust hierarchy
   - Trust scores are above your compliance threshold
   - Failed delegations are properly logged and not retried without authorization
4. Use the **Agent filter** to focus on agents handling sensitive data (e.g., security-specialist, backend-dev).
5. Use the **Status filter** set to **Failed** to review any rejected delegations that might indicate policy violations.

---

## Quick Reference: Sidebar Navigation

| Tab | What It Shows |
|---|---|
| **Dashboard** | StatsBar + Kanban + Agent Grid + Message Feed + Workflow Progress |
| **Conversation** | Chat with agents, session management, voice input, Party Mode |
| **Kanban** | Full-screen Kanban board with all 5 columns |
| **Agents** | Full-screen agent grid with detailed agent cards |
| **Workflows** | Pipeline phases, Gantt chart, Pause/Resume controls |
| **Memory** | Search interface, scope selector, per-agent memory stats |
| **Models & Cost** | Cost chart, budget bar, agent model configuration table |
| **Escalations** | Filtered queue of agent-escalated items needing human review |
| **VIADP Audit** | Delegation timeline with trust scores and proof chains |
| **Settings** | Gateway URL, default model, budget limit, toggles |

---

## Quick Reference: The 12 Agents

| Agent | Role | Default Model |
|---|---|---|
| bmad-master | Orchestrator / Team Lead | gemini-3.1-pro |
| product-owner | Requirements & Prioritization | gemini-3.1-pro |
| business-analyst | Research & Analysis | gemini-3.1-pro |
| scrum-master | Agile Coordination | gemini-flash-3 |
| architect | System Design | claude-opus-4-6 |
| ux-designer | User Experience | gemini-3.1-pro |
| frontend-dev | Frontend Code | gemini-3.1-pro |
| backend-dev | Backend & APIs | claude-opus-4-6 |
| qa-architect | Testing & QA | claude-opus-4-6 |
| devops-engineer | CI/CD & Infrastructure | gemini-3.1-pro |
| security-specialist | Security & Compliance | claude-opus-4-6 |
| tech-writer | Documentation | claude-sonnet-4-6 |
