# ForgeTeam Session 07 — Phase 7: Dashboard Polish (shadcn/ui, TanStack Table, RTL Fixes)

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL items listed below in the ForgeTeam dashboard at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing glass-card dark aesthetic. All fixes must maintain full RTL Arabic support.

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

- **Dashboard package.json:** `/forge-team/dashboard/package.json`
- **PostCSS config:** `/forge-team/dashboard/postcss.config.mjs`
- **Tailwind / CSS:** `/forge-team/dashboard/src/app/globals.css`
- **Layout:** `/forge-team/dashboard/src/app/layout.tsx`
- **Main page:** `/forge-team/dashboard/src/app/page.tsx`
- **Sidebar:** `/forge-team/dashboard/src/components/Sidebar.tsx` — has physical CSS classes
- **ModelsCostPanel:** `/forge-team/dashboard/src/components/ModelsCostPanel.tsx` — uses plain `<table>`
- **AgentStatusGrid:** `/forge-team/dashboard/src/components/AgentStatusGrid.tsx`
- **KanbanBoard:** `/forge-team/dashboard/src/components/KanbanBoard.tsx`
- **ConversationPanel:** `/forge-team/dashboard/src/components/ConversationPanel.tsx`
- **MessageFeed:** `/forge-team/dashboard/src/components/MessageFeed.tsx`
- **WorkflowProgress:** `/forge-team/dashboard/src/components/WorkflowProgress.tsx`
- **MemoryExplorer:** `/forge-team/dashboard/src/components/MemoryExplorer.tsx`
- **VoiceTranscriptViewer:** `/forge-team/dashboard/src/components/VoiceTranscriptViewer.tsx`
- **ViadpAuditLog:** `/forge-team/dashboard/src/components/ViadpAuditLog.tsx`
- **i18n system:** `/forge-team/dashboard/src/lib/i18n.ts`
- **Locale context:** `/forge-team/dashboard/src/lib/locale-context.tsx`
- **API client:** `/forge-team/dashboard/src/lib/api.ts`
- **Socket client:** `/forge-team/dashboard/src/lib/socket.ts`
- **Translations:** `/forge-team/dashboard/src/messages/ar.json`, `/forge-team/dashboard/src/messages/en.json`
- **Mock data:** `/forge-team/dashboard/src/lib/mock-data.ts`

---

## WORKSTREAM 1: Install & Configure shadcn/ui

**Files to modify:**
- `/forge-team/dashboard/package.json`
- `/forge-team/dashboard/tsconfig.json`
- `/forge-team/dashboard/src/app/globals.css`
- `/forge-team/dashboard/src/lib/utils.ts` (already has `cn()` — verify compatibility)
- New files under `/forge-team/dashboard/src/components/ui/` (created by shadcn CLI)

### 1A. Initialize shadcn/ui

Run from `/forge-team/dashboard/`:

```bash
npx shadcn@latest init
```

When prompted:
- Style: **Default**
- Base color: **Slate** (closest to the existing dark palette)
- CSS variables: **yes**
- Path aliases already configured (`@/` maps to `src/`)

**IMPORTANT**: The project uses Tailwind CSS v4 with `@import "tailwindcss"` syntax and `@theme {}` block in `globals.css`. shadcn/ui must be configured to work with this. If the init modifies `globals.css`, ensure the existing `@theme` variables (`--color-primary`, `--color-surface`, etc.) are preserved. Do NOT let shadcn overwrite the existing color scheme.

Check that `src/lib/utils.ts` still exports the `cn()` function (currently uses `clsx` + `tailwind-merge`). shadcn expects the same pattern, so it should be compatible. If shadcn creates its own `utils.ts`, merge them — do not duplicate.

### 1B. Install shadcn/ui components

Run each individually:

```bash
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add dialog
npx shadcn@latest add table
npx shadcn@latest add select
npx shadcn@latest add input
npx shadcn@latest add badge
npx shadcn@latest add tabs
npx shadcn@latest add toast
npx shadcn@latest add tooltip
```

These will create files under `/forge-team/dashboard/src/components/ui/`. Do NOT modify the generated shadcn files unless absolutely necessary for dark theme compatibility.

### 1C. Migrate existing modals to shadcn Dialog

Replace the custom modal pattern used across components. The current pattern is:

```tsx
<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
  <div className="glass-card w-full max-w-lg p-6 relative">
    ...
  </div>
</div>
```

Migrate these modals to use `<Dialog>` from shadcn:

- `KanbanBoard.tsx` — TaskCardExpanded modal (line ~78), Create Task modal (line ~258), Feedback modal (line ~518)
- `AgentStatusGrid.tsx` — AgentDetailModal (line ~36)

Wrap each in `<Dialog>` + `<DialogContent>` + `<DialogHeader>` + `<DialogTitle>`. Keep the `glass-card` styling by applying it to `DialogContent` via `className`. The backdrop blur should come from shadcn's built-in overlay.

### 1D. Migrate buttons to shadcn Button

Replace custom `<button>` elements that have complex styling with `<Button>` from shadcn where appropriate:

- `KanbanBoard.tsx` — "New Task" button (line ~248), Start/Approve/Revise buttons
- `ConversationPanel.tsx` — Send button, session buttons
- `ModelsCostPanel.tsx` — Optimize button (line ~173)
- Settings view in `page.tsx` — Save button (line ~895)
- `Sidebar.tsx` — Keep as-is (sidebar nav buttons have unique styling that shouldn't use shadcn Button)

Use variants: `variant="default"` for primary actions, `variant="outline"` for secondary, `variant="ghost"` for subtle. Preserve the existing green (`bg-primary`) and accent colors.

### 1E. Use shadcn Badge for status/priority indicators

Replace the custom `.priority-badge` spans with `<Badge>`:

- `KanbanBoard.tsx` — priority badges (Critical/High/Medium/Low), "Waiting for Human" badge
- `AgentStatusGrid.tsx` — status labels
- `MessageFeed.tsx` — type filter pills (Task/Question/Escalation)

Map to shadcn variants: `variant="destructive"` for Critical, `variant="outline"` for others. Override colors via `className` to match existing color scheme (`priority-critical`, `priority-high`, etc.).

### 1F. Use shadcn Tooltip

Replace custom `title` attributes with proper `<Tooltip>` components:

- `Sidebar.tsx` — collapsed nav items currently use `title={...}` (line ~105)
- `ConversationPanel.tsx` — mic button disabled tooltip (voice not configured)
- `VoiceTranscriptViewer.tsx` — STT/TTS direction emoji titles

---

## WORKSTREAM 2: Install TanStack Table & Migrate ModelsCostPanel

**Files to modify:**
- `/forge-team/dashboard/package.json`
- `/forge-team/dashboard/src/components/ModelsCostPanel.tsx`
- `/forge-team/dashboard/src/lib/api.ts`
- `/forge-team/dashboard/src/messages/ar.json`
- `/forge-team/dashboard/src/messages/en.json`

### 2A. Install TanStack Table

```bash
cd /Users/bandar/Documents/AreebPro/forge-team/dashboard
npm install @tanstack/react-table
```

### 2B. Migrate ModelsCostPanel table to TanStack

The current `ModelsCostPanel.tsx` (lines ~183-328) uses a plain `<table>` with hand-written rows. Replace with TanStack Table.

Define column definitions using `createColumnHelper<AgentModelRow>()`:

```typescript
type AgentModelRow = {
  id: string;
  name: string;
  nameAr: string;
  avatar: string;
  primary: string;
  fallback: string;
  fallback2: string;
  temperature: number;
  tokensUsed: number;
  cost: number;
  dailyCap: number;  // NEW — see 2D
};
```

Columns:
1. **Agent** — avatar + name (bilingual)
2. **Primary Model** — `<select>` dropdown from `availableModels`
3. **Fallback** — `<select>` dropdown
4. **Fallback 2** — `<select>` dropdown (with `--` empty option)
5. **Temp** — `<input type="number">` (min=0, max=1, step=0.1)
6. **Daily Cap ($)** — `<input type="number">` (min=0, step=5) — NEW column
7. **Tokens Used** — formatted read-only, sortable
8. **Cost (USD)** — formatted read-only, sortable

Enable sorting on columns 7 and 8 using `getSortedRowModel()`. Enable filtering by agent name using `getFilteredRowModel()`. Add a search input above the table.

Use the shadcn `<Table>` component (from Workstream 1) as the rendering primitive to match the existing look.

Keep the footer row showing totals.

### 2C. Add sorting indicators

When a sortable column header is clicked, show a small arrow icon (up/down) next to the column label. Use `column.getIsSorted()` to determine direction. Use lucide-react `ArrowUpDown`, `ArrowUp`, `ArrowDown` icons.

### 2D. Add per-agent daily cost cap column

Add a "Daily Cap ($)" column to the TanStack table. This should be an editable number input per agent.

Add `dailyCap?: number` to the `Agent` interface in `mock-data.ts`. Set default values:
- Premium agents (Architect, Backend Dev, QA, Security): `$15`
- Balanced agents (BMad Master, Product Owner, BA, UX, Frontend, DevOps): `$8`
- Fast agents (Scrum Master): `$3`
- Writer (Tech Writer): `$5`

Store the caps in the `agentModels` local state. When an agent's `agent.cost` exceeds their `dailyCap`, highlight the cost cell with a red background and show a warning icon.

### 2E. Add Save button to ModelsCostPanel

Add a "Save Changes" / "حفظ التغييرات" button below the table. When clicked:

1. Collect the current `agentModels` state (primary, fallback, fallback2, temperature, dailyCap per agent)
2. POST to a new API endpoint. Add to `api.ts`:

```typescript
export async function saveModelAssignments(
  assignments: Record<string, {
    primary: string;
    fallback: string;
    fallback2: string;
    temperature: number;
    dailyCap: number;
  }>
): Promise<void> {
  await postAPI('/api/models/assignments', { assignments });
}
```

3. Show a success toast (using shadcn Toast from Workstream 1) on success
4. Show an error toast on failure

Add translation keys:
- `en.json` → `"cost.save": "Save Changes"`, `"cost.saved": "Changes saved successfully"`, `"cost.saveFailed": "Failed to save changes"`, `"cost.dailyCap": "Daily Cap ($)"`
- `ar.json` → `"cost.save": "حفظ التغييرات"`, `"cost.saved": "تم حفظ التغييرات بنجاح"`, `"cost.saveFailed": "فشل حفظ التغييرات"`, `"cost.dailyCap": "الحد اليومي ($)"`

---

## WORKSTREAM 3: Install tailwindcss-logical & Fix Physical CSS

**Files to modify:**
- `/forge-team/dashboard/package.json`
- `/forge-team/dashboard/postcss.config.mjs`
- `/forge-team/dashboard/src/components/Sidebar.tsx`
- Any other component files with physical CSS classes

### 3A. Install tailwindcss-logical

```bash
cd /Users/bandar/Documents/AreebPro/forge-team/dashboard
npm install tailwindcss-logical
```

**IMPORTANT**: Tailwind CSS v4 uses a different plugin system than v3. In v4, PostCSS plugins are added to `postcss.config.mjs`, NOT to a `tailwind.config.js` (which may not even exist). The current `postcss.config.mjs` is:

```javascript
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

Check the `tailwindcss-logical` package documentation for Tailwind v4 compatibility. If it provides a PostCSS plugin, add it after `@tailwindcss/postcss`. If it provides Tailwind v4 `@plugin` syntax, use that instead. If `tailwindcss-logical` is NOT compatible with Tailwind v4, skip the plugin installation and instead manually replace physical classes with the CSS logical property equivalents already available in Tailwind v4 (Tailwind v4 has built-in logical property support via `ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `border-s-*`, `border-e-*` classes).

### 3B. Fix physical CSS in Sidebar.tsx

In `Sidebar.tsx` lines ~193-199, the desktop sidebar uses physical positioning:

```tsx
isRtl ? "right-0 border-l" : "left-0 border-r",
```

Replace with logical Tailwind classes. In Tailwind v4, the logical equivalents are:

- `right-0` / `left-0` → Use `inset-inline-start-0` or the shorthand: just set `style={{ insetInlineStart: 0 }}` (already done for mobile drawer). For Tailwind classes, use `start-0` if available, or keep using the inline style approach that already works elsewhere
- `border-l` / `border-r` → `border-s` / `border-e` (or `border-inline-start` / `border-inline-end`)

Remove the `isRtl` conditional entirely. The corrected code should be:

```tsx
<aside
  className={cn(
    "fixed top-0 start-0 h-screen z-50 flex-col transition-all duration-300",
    "bg-gradient-to-b from-[#0f1628] to-[#0a0f1e] border-e border-border",
    collapsed ? "w-[68px]" : "w-[240px]",
    "hidden lg:flex"
  )}
  style={{
    borderInlineEnd: "1px solid rgba(42, 74, 127, 0.4)",
  }}
>
```

Note: The sidebar already has `borderInlineEnd` in the `style` prop, which makes the `border-l`/`border-r` class redundant. Remove the class-based border and keep only the inline style.

Also fix the mobile drawer (line ~219):

```tsx
isRtl ? "right-0" : "left-0"
```

Replace with:

```tsx
"start-0"
```

Or use `insetInlineStart: 0` in the style prop.

### 3C. Scan and fix all other physical CSS

Search all files in `/forge-team/dashboard/src/` for physical direction classes. Run:

```bash
grep -rn "left-0\|right-0\|border-l\|border-r\|pl-\|pr-\|ml-\|mr-\|text-left\|text-right" dashboard/src/
```

Replace each occurrence:
- `pl-*` → `ps-*` (padding-inline-start)
- `pr-*` → `pe-*` (padding-inline-end)
- `ml-*` → `ms-*` (margin-inline-start)
- `mr-*` → `me-*` (margin-inline-end)
- `left-*` → `start-*` (inset-inline-start)
- `right-*` → `end-*` (inset-inline-end)
- `border-l` → `border-s` (border-inline-start)
- `border-r` → `border-e` (border-inline-end)
- `text-left` → `text-start`
- `text-right` → `text-end`

**Exceptions**: Do NOT change physical classes inside `DragDropContext` or where `direction: "ltr"` is forced (e.g., `KanbanBoard.tsx` line ~316 forces `style={{ direction: "ltr" }}` for the dnd library — that's intentional).

---

## WORKSTREAM 4: Fix next-intl & Inline Strings

**Files to modify:**
- `/forge-team/dashboard/package.json`
- All component files with `isAr ? "..." : "..."` patterns
- `/forge-team/dashboard/src/messages/ar.json`
- `/forge-team/dashboard/src/messages/en.json`

### 4A. Remove next-intl phantom dependency

The `next-intl` package (v3.26.3) is installed in `package.json` (line ~19) but never imported or used anywhere in the codebase. The dashboard uses a custom i18n system (`i18n.ts` + `locale-context.tsx` with `useLocale()` hook and `t()` function).

Remove it:

```bash
cd /Users/bandar/Documents/AreebPro/forge-team/dashboard
npm uninstall next-intl
```

Verify no files import from `next-intl`:

```bash
grep -rn "next-intl" dashboard/src/
```

If any imports exist, replace them with the custom `useLocale()` hook from `@/lib/locale-context`.

### 4B. Migrate remaining inline bilingual strings to t() calls

Search for all `isAr ? "..." : "..."` and `locale === "ar" ? "..." : "..."` patterns across components. Each one should be replaced with a `t("key")` call.

**Known locations:**

1. **page.tsx** Settings view (lines ~835-901):
   - Line ~835: `t("settings.gatewayUrl")` fallback pattern `|| (locale === "ar" ? ...)` — remove the fallback, the key already exists in both JSON files
   - Same for lines ~848, ~863, ~876, ~886, ~896

2. **page.tsx** Agents full view (lines ~748-792):
   - Line ~751: `locale === "ar" ? "لا يوجد وكلاء متصلين" : "No agents connected"` → `t("agents.noAgents")`
   - Line ~760-761: agent name display already uses locale — OK
   - Line ~780-782: `locale === "ar" ? "لا يوجد مهمة" : "No active task"` → `t("agents.noActiveTask")`

3. **page.tsx** connection status (lines ~679-682):
   - Lines with `t("common.connected") || (locale === "ar" ? ...)` — remove the fallback since the key exists

4. **Sidebar.tsx**:
   - Line ~73: `locale === "ar" ? "فورج تيم" : "ForgeTeam"` → `t("app.title")`
   - Line ~76: `locale === "ar" ? "إصدار BMAD-Claw" : "BMAD-Claw Edition"` → `t("app.subtitle")`
   - Line ~132: `locale === "ar" ? "English" : "العربية"` — Keep as-is (this is intentionally showing the opposite language name)
   - Lines ~149-155: dark/light theme labels → use `t("common.light")` / `t("common.dark")`
   - Line ~181: `locale === "ar" ? "طي" : "Collapse"` → `t("common.collapse")`

5. **KanbanBoard.tsx**:
   - Line ~264: `isAr ? "إنشاء مهمة جديدة" : "Create New Task"` — add key `"kanban.createTask"` to both JSON files
   - Line ~287-290: priority labels in create form — these use inline strings, add `t("kanban.priorityLow")`, etc. or keep as-is since they are `<option>` elements
   - Line ~297: `isAr ? "غير مسند" : "Unassigned"` → `t("kanban.unassigned")`
   - Line ~308: `isAr ? "إنشاء" : "Create"` — add key `"kanban.create"` or `"common.create"`
   - Line ~525: `isAr ? "ملاحظات المراجعة" : "Revision Feedback"` — add key `"kanban.revisionFeedback"`

6. **MemoryExplorer.tsx** and **VoiceTranscriptViewer.tsx**:
   - Both use local `labels` objects with `{ en: "...", ar: "..." }` and a local `l()` function instead of the global `t()`. Migrate these to use the global `useLocale()` hook's `t()` function.
   - In `MemoryExplorer.tsx`: remove the `labels` object and `l()` function. Import `useLocale` and call `t("memory.title")`, `t("memory.search")`, etc. The keys already exist in both JSON files.
   - In `VoiceTranscriptViewer.tsx`: same migration. Add any missing keys to both JSON files:
     - `"voice.allSessions"`: "All Sessions" / "جميع الجلسات"
     - `"voice.session"`: "Session" / "الجلسة"
     - `"voice.language"`: "Language" / "اللغة"
     - `"voice.all"`: "All" / "الكل"
     - `"voice.arabic"`: "Arabic" / "العربية"
     - `"voice.english"`: "English" / "الإنجليزية"
     - `"voice.confidence"`: "Confidence" / "الثقة"
     - `"voice.duration"`: "Duration" / "المدة"
     - `"voice.noTranscripts"`: "No transcripts found" / "لا توجد نصوص"
     - `"voice.sttLabel"`: "User → System" / "المستخدم → النظام"
     - `"voice.ttsLabel"`: "System → User" / "النظام → المستخدم"

### 4C. Add any missing translation keys

After scanning all components, ensure both `ar.json` and `en.json` have identical key structures. Add any keys discovered during migration:

```json
// en.json additions:
"kanban.createTask": "Create New Task",
"kanban.create": "Create",
"kanban.revisionFeedback": "Revision Feedback",
"common.create": "Create"

// ar.json additions:
"kanban.createTask": "إنشاء مهمة جديدة",
"kanban.create": "إنشاء",
"kanban.revisionFeedback": "ملاحظات المراجعة",
"common.create": "إنشاء"
```

Verify key parity:
```bash
node -e "const en=require('./src/messages/en.json'); const ar=require('./src/messages/ar.json'); function keys(o,p=''){return Object.entries(o).flatMap(([k,v])=>typeof v==='object'?keys(v,p+k+'.'):p+k)} const e=keys(en),a=keys(ar); console.log('Missing in AR:',e.filter(k=>!a.includes(k))); console.log('Missing in EN:',a.filter(k=>!e.includes(k)));"
```

---

## WORKSTREAM 5: Connect MemoryExplorer & VoiceTranscriptViewer to Real Data

**Files to modify:**
- `/forge-team/dashboard/src/components/MemoryExplorer.tsx`
- `/forge-team/dashboard/src/components/VoiceTranscriptViewer.tsx`
- `/forge-team/dashboard/src/lib/api.ts`
- `/forge-team/dashboard/src/lib/socket.ts`

### 5A. Connect MemoryExplorer to real API

The `MemoryExplorer.tsx` currently uses mock data for search results and per-agent memory stats. If memory API endpoints exist from prior sessions, connect to them:

1. Add to `api.ts`:

```typescript
export async function searchMemory(query: string, scope: string): Promise<{
  results: Array<{
    id: string;
    title: string;
    snippet: string;
    source: string;
    score: number;
  }>;
}> {
  return postAPI('/api/memory/search', { query, scope });
}

export async function fetchMemoryStats(): Promise<{
  stats: Record<string, {
    shortTermTokens: number;
    shortTermLastUpdated: number;
    longTermEntries: number;
    longTermTokens: number;
  }>;
}> {
  return fetchAPI('/api/memory/stats');
}
```

2. In `MemoryExplorer.tsx`, add `useEffect` to fetch memory stats on mount (with mock fallback). Add a debounced search handler that calls `searchMemory()` when the user types a query (with 500ms debounce). Fall back to `mockSearchResults` on API error.

### 5B. Connect VoiceTranscriptViewer to real WebSocket data

1. In `VoiceTranscriptViewer.tsx`, subscribe to a `voice_transcript` socket event that appends new transcripts in real time:

```typescript
const { on } = useSocket();

useEffect(() => {
  const unsub = on('voice_transcript' as any, (data: any) => {
    // Append new transcript to local state
  });
  return unsub;
}, [on]);
```

2. Start with `mockTranscripts` as initial data and append real transcripts as they arrive via WebSocket.

3. Add a `voice_transcript` event type to `socket.ts` `SocketEvents` interface:

```typescript
voice_transcript: (data: {
  id: string;
  sessionId: string;
  direction: 'stt' | 'tts';
  language: string;
  text: string;
  confidence?: number;
  duration: string;
  timestamp: string;
}) => void;
```

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all changes, verify:

- [x] `npm run build` in `/forge-team/dashboard/` succeeds with zero errors
- [x] shadcn/ui components installed and `components/ui/` directory exists with button, card, dialog, table, select, input, badge, tabs, toast (sonner), tooltip
- [x] `@tanstack/react-table` is in `package.json` dependencies
- [x] ModelsCostPanel uses TanStack Table with sorting on Tokens Used and Cost columns
- [x] ModelsCostPanel has "Daily Cap ($)" column with per-agent editable inputs
- [x] ModelsCostPanel has "Save Changes" button that POSTs to `/api/models/assignments`
- [x] `next-intl` is NOT in `package.json` (removed)
- [x] No `isAr ? "..." : "..."` patterns remain in `Sidebar.tsx`, `page.tsx` Settings view, `MemoryExplorer.tsx`, or `VoiceTranscriptViewer.tsx` (except intentional cases like the language toggle label)
- [x] `Sidebar.tsx` uses NO physical CSS classes (`right-0`, `left-0`, `border-l`, `border-r`) — only logical equivalents
- [x] All physical Tailwind direction classes across dashboard/src/ are replaced with logical equivalents
- [x] Both `ar.json` and `en.json` have identical key structures — no key in one is missing from the other (200 keys each)
- [x] The glass-card dark aesthetic is preserved
- [x] Dark/light mode toggle still works
- [x] RTL Arabic layout still works correctly
- [x] MemoryExplorer attempts real API call (falls back to mock data)
- [x] VoiceTranscriptViewer subscribes to WebSocket (falls back to mock data)

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **shadcn-installer** — Handles WORKSTREAM 1 (shadcn/ui init, component installation, modal/button/badge/tooltip migration)
2. **table-migrator** — Handles WORKSTREAM 2 (TanStack Table install, ModelsCostPanel migration, daily caps, save button)
3. **rtl-fixer** — Handles WORKSTREAM 3 (tailwindcss-logical, Sidebar physical CSS fix, scan all physical classes)
4. **i18n-fixer** — Handles WORKSTREAM 4 (remove next-intl, migrate inline strings, add missing translation keys)
5. **data-connector** — Handles WORKSTREAM 5 (MemoryExplorer API, VoiceTranscriptViewer WebSocket)

After all agents finish, run `npm run build` to verify zero errors.
