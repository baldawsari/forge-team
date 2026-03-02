export interface Agent {
  id: string;
  name: string;
  nameAr: string;
  role: string;
  roleAr: string;
  avatar: string;
  status: "idle" | "working" | "reviewing" | "blocked";
  currentTaskId: string | null;
  currentTaskIdAr: string | null;
  model: string;
  fallbackModel: string;
  temperature: number;
  tokensUsed: number;
  cost: number;
  dailyCap?: number;
}

export interface Task {
  id: string;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  status: "backlog" | "todo" | "in-progress" | "review" | "done" | "cancelled";
  assignedTo: string | null;
  priority: "critical" | "high" | "medium" | "low";
  startedAt: string | null;
  artifacts?: string[];
  waitingForHuman?: boolean;
  agentResponse?: string;
}

export interface Message {
  id: string;
  from: string;
  fromAvatar: string;
  to?: string;
  content: string;
  contentAr?: string;
  type: "task" | "question" | "escalation";
  timestamp: string;
  isHuman: boolean;
  project?: string;
}

export interface WorkflowPhase {
  id: string;
  name: string;
  nameAr: string;
  progress: number;
  status: "completed" | "active" | "pending";
  startDate: string;
  endDate?: string;
  checkpoints: number;
  checkpointsComplete: number;
}

export interface DelegationEntry {
  id: string;
  from: string;
  to: string;
  taskId: string;
  taskAr: string;
  trustScore: number;
  status: "verified" | "pending" | "failed";
  timestamp: string;
  proofChain: string[];
}

export interface CostDay {
  date: string;
  cost: number;
}

export interface AgentMemoryData {
  agentId: string;
  agentName: string;
  agentNameAr: string;
  shortTermTokens: number;
  shortTermLastUpdated: number; // minutes ago
  longTermEntries: number;
  longTermTokens: number;
}

export interface VoiceTranscript {
  id: string;
  timestamp: string;
  direction: "stt" | "tts";
  language: "ar" | "en";
  text: string;
  confidence?: number; // for STT
  duration: number; // seconds
  sessionId: string;
}

// ─── 12 BMAD Agents ───────────────────────────────────────────────────────────

export const mockAgents: Agent[] = [
  {
    id: "bmad-master",
    name: "BMad Master",
    nameAr: "بي ماد ماستر",
    role: "Orchestrator / Team Lead",
    roleAr: "المنسق / قائد الفريق",
    avatar: "🎯",
    status: "working",
    currentTaskId: "Sprint 2.1 orchestration and task delegation",
    currentTaskIdAr: "تنسيق السبرنت 2.1 وتفويض المهام",
    model: "gemini-3.1-pro",
    fallbackModel: "claude-sonnet-4-6",
    temperature: 0.4,
    tokensUsed: 125000,
    cost: 4.85,
    dailyCap: 8,
  },
  {
    id: "product-owner",
    name: "John (PM)",
    nameAr: "جون (مدير المنتج)",
    role: "Requirements & Prioritization",
    roleAr: "المتطلبات والأولويات",
    avatar: "📋",
    status: "working",
    currentTaskId: "Prioritizing sprint 2.2 backlog items",
    currentTaskIdAr: "ترتيب أولويات عناصر تراكم السبرنت 2.2",
    model: "gemini-3.1-pro",
    fallbackModel: "claude-sonnet-4-6",
    temperature: 0.5,
    tokensUsed: 89000,
    cost: 3.20,
    dailyCap: 8,
  },
  {
    id: "business-analyst",
    name: "Mary (BA)",
    nameAr: "ماري (محللة الأعمال)",
    role: "Research & Analysis",
    roleAr: "البحث والتحليل",
    avatar: "📊",
    status: "idle",
    currentTaskId: null,
    currentTaskIdAr: null,
    model: "gemini-3.1-pro",
    fallbackModel: "claude-sonnet-4-6",
    temperature: 0.4,
    tokensUsed: 67000,
    cost: 2.50,
    dailyCap: 8,
  },
  {
    id: "scrum-master",
    name: "Bob (SM)",
    nameAr: "بوب (سكرم ماستر)",
    role: "Agile Coordination",
    roleAr: "التنسيق الرشيق",
    avatar: "⚡",
    status: "working",
    currentTaskId: "Facilitating daily standup and tracking velocity",
    currentTaskIdAr: "تيسير الاجتماع اليومي وتتبع السرعة",
    model: "gemini-flash-3",
    fallbackModel: "claude-haiku-4-5",
    temperature: 0.3,
    tokensUsed: 45000,
    cost: 1.10,
    dailyCap: 3,
  },
  {
    id: "architect",
    name: "Winston (Architect)",
    nameAr: "ونستون (المعماري)",
    role: "System Design",
    roleAr: "تصميم النظام",
    avatar: "🏗️",
    status: "working",
    currentTaskId: "Designing microservices architecture with CQRS",
    currentTaskIdAr: "تصميم بنية الخدمات المصغرة مع CQRS",
    model: "claude-opus-4-6",
    fallbackModel: "gemini-3.1-pro",
    temperature: 0.3,
    tokensUsed: 178000,
    cost: 12.40,
    dailyCap: 15,
  },
  {
    id: "ux-designer",
    name: "Sally (UX)",
    nameAr: "سالي (مصممة UX)",
    role: "User Experience",
    roleAr: "تجربة المستخدم",
    avatar: "🎨",
    status: "idle",
    currentTaskId: null,
    currentTaskIdAr: null,
    model: "gemini-3.1-pro",
    fallbackModel: "claude-sonnet-4-6",
    temperature: 0.7,
    tokensUsed: 56000,
    cost: 2.10,
    dailyCap: 8,
  },
  {
    id: "frontend-dev",
    name: "Amelia-FE (Dev)",
    nameAr: "أميليا-FE (مطورة)",
    role: "Frontend Code",
    roleAr: "كود الواجهة",
    avatar: "💻",
    status: "working",
    currentTaskId: "Building dashboard components with RTL support",
    currentTaskIdAr: "بناء مكونات لوحة التحكم مع دعم RTL",
    model: "gemini-3.1-pro",
    fallbackModel: "claude-sonnet-4-6",
    temperature: 0.5,
    tokensUsed: 134000,
    cost: 4.80,
    dailyCap: 8,
  },
  {
    id: "backend-dev",
    name: "Amelia-BE (Dev)",
    nameAr: "أميليا-BE (مطورة)",
    role: "Backend & APIs",
    roleAr: "الخلفية والـ APIs",
    avatar: "⚙️",
    status: "reviewing",
    currentTaskId: "Reviewing API gateway implementation PR",
    currentTaskIdAr: "مراجعة طلب دمج تنفيذ بوابة API",
    model: "claude-opus-4-6",
    fallbackModel: "claude-sonnet-4-6",
    temperature: 0.3,
    tokensUsed: 165000,
    cost: 11.50,
    dailyCap: 15,
  },
  {
    id: "qa-architect",
    name: "Quinn (QA)",
    nameAr: "كوين (مهندسة جودة)",
    role: "Testing & QA",
    roleAr: "الاختبار والجودة",
    avatar: "🔍",
    status: "working",
    currentTaskId: "Writing integration test suite for auth module",
    currentTaskIdAr: "كتابة مجموعة اختبارات التكامل لوحدة المصادقة",
    model: "claude-opus-4-6",
    fallbackModel: "claude-sonnet-4-6",
    temperature: 0.3,
    tokensUsed: 112000,
    cost: 8.90,
    dailyCap: 15,
  },
  {
    id: "devops-engineer",
    name: "Barry (DevOps)",
    nameAr: "باري (DevOps)",
    role: "CI/CD & Infrastructure",
    roleAr: "البنية التحتية",
    avatar: "🚀",
    status: "blocked",
    currentTaskId: "CI/CD pipeline - waiting for AWS credentials",
    currentTaskIdAr: "خط أنابيب CI/CD - بانتظار بيانات اعتماد AWS",
    model: "gemini-3.1-pro",
    fallbackModel: "claude-sonnet-4-6",
    temperature: 0.3,
    tokensUsed: 78000,
    cost: 2.90,
    dailyCap: 8,
  },
  {
    id: "security-specialist",
    name: "Shield (Security)",
    nameAr: "شيلد (الأمن)",
    role: "Security & Compliance",
    roleAr: "الأمن والامتثال",
    avatar: "🛡️",
    status: "reviewing",
    currentTaskId: "OWASP Top 10 compliance audit",
    currentTaskIdAr: "تدقيق التوافق مع OWASP Top 10",
    model: "claude-opus-4-6",
    fallbackModel: "gemini-3.1-pro",
    temperature: 0.3,
    tokensUsed: 145000,
    cost: 10.20,
    dailyCap: 15,
  },
  {
    id: "tech-writer",
    name: "Paige (Docs)",
    nameAr: "بايج (التوثيق)",
    role: "Documentation",
    roleAr: "التوثيق",
    avatar: "📝",
    status: "idle",
    currentTaskId: null,
    currentTaskIdAr: null,
    model: "claude-sonnet-4-6",
    fallbackModel: "gemini-3.1-pro",
    temperature: 0.6,
    tokensUsed: 92000,
    cost: 5.60,
    dailyCap: 5,
  },
];

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const mockTasks: Task[] = [
  {
    id: "task-1",
    title: "User authentication flow",
    titleAr: "تدفق مصادقة المستخدم",
    description: "Implement OAuth2 + JWT authentication with refresh tokens",
    descriptionAr: "تنفيذ مصادقة OAuth2 + JWT مع رموز التحديث",
    status: "done",
    assignedTo: "backend-dev",
    priority: "critical",
    startedAt: "2026-02-24T08:00:00Z",
    artifacts: ["auth-flow-diagram.pdf", "jwt-spec.yaml"],
  },
  {
    id: "task-2",
    title: "Dashboard layout",
    titleAr: "تخطيط لوحة التحكم",
    description: "Build the main dashboard with RTL support and responsive grid",
    descriptionAr: "بناء لوحة التحكم الرئيسية مع دعم RTL وشبكة متجاوبة",
    status: "in-progress",
    assignedTo: "frontend-dev",
    priority: "high",
    startedAt: "2026-02-25T10:30:00Z",
  },
  {
    id: "task-3",
    title: "API Gateway setup",
    titleAr: "إعداد بوابة API",
    description: "Configure API gateway with rate limiting and auth middleware",
    descriptionAr: "تكوين بوابة API مع تحديد المعدل والبرمجيات الوسيطة للمصادقة",
    status: "review",
    assignedTo: "backend-dev",
    priority: "high",
    startedAt: "2026-02-25T09:00:00Z",
    artifacts: ["api-spec.yaml"],
  },
  {
    id: "task-4",
    title: "Database schema design",
    titleAr: "تصميم مخطط قاعدة البيانات",
    description: "Design PostgreSQL schema for agent state management and task tracking",
    descriptionAr: "تصميم مخطط PostgreSQL لإدارة حالة الوكيل وتتبع المهام",
    status: "done",
    assignedTo: "architect",
    priority: "critical",
    startedAt: "2026-02-23T14:00:00Z",
    artifacts: ["architecture-diagram.pdf", "db-schema.sql"],
  },
  {
    id: "task-5",
    title: "Integration test suite",
    titleAr: "مجموعة اختبارات التكامل",
    description: "Write end-to-end tests for agent communication pipeline",
    descriptionAr: "كتابة اختبارات شاملة لخط أنابيب اتصال الوكلاء",
    status: "in-progress",
    assignedTo: "qa-architect",
    priority: "medium",
    startedAt: "2026-02-26T07:00:00Z",
  },
  {
    id: "task-6",
    title: "CI/CD pipeline",
    titleAr: "خط أنابيب CI/CD",
    description: "Setup GitHub Actions with Docker builds and K8s deployment",
    descriptionAr: "إعداد GitHub Actions مع بناء Docker ونشر K8s",
    status: "in-progress",
    assignedTo: "devops-engineer",
    priority: "high",
    startedAt: "2026-02-26T06:00:00Z",
    waitingForHuman: true,
  },
  {
    id: "task-7",
    title: "OWASP security audit",
    titleAr: "تدقيق أمان OWASP",
    description: "Run full OWASP Top 10 audit on all API endpoints",
    descriptionAr: "إجراء تدقيق OWASP Top 10 الكامل على جميع نقاط نهاية API",
    status: "review",
    assignedTo: "security-specialist",
    priority: "critical",
    startedAt: "2026-02-25T16:00:00Z",
  },
  {
    id: "task-8",
    title: "API documentation v2",
    titleAr: "توثيق API v2",
    description: "Generate OpenAPI 3.1 docs with examples for all endpoints",
    descriptionAr: "إنشاء مستندات OpenAPI 3.1 مع أمثلة لجميع نقاط النهاية",
    status: "in-progress",
    assignedTo: "tech-writer",
    priority: "medium",
    startedAt: "2026-02-26T08:30:00Z",
  },
  {
    id: "task-9",
    title: "Microservices architecture",
    titleAr: "بنية الخدمات المصغرة",
    description: "Design event-driven microservices architecture with CQRS pattern",
    descriptionAr: "تصميم بنية الخدمات المصغرة المبنية على الأحداث مع نمط CQRS",
    status: "in-progress",
    assignedTo: "architect",
    priority: "critical",
    startedAt: "2026-02-25T11:00:00Z",
  },
  {
    id: "task-10",
    title: "Product backlog refinement",
    titleAr: "تنقيح تراكم المنتج",
    description: "Refine and prioritize backlog items for sprint 2.2 planning",
    descriptionAr: "تنقيح وترتيب أولويات عناصر التراكم لتخطيط السبرنت 2.2",
    status: "in-progress",
    assignedTo: "product-owner",
    priority: "high",
    startedAt: "2026-02-25T14:00:00Z",
  },
  {
    id: "task-11",
    title: "User onboarding wireframes",
    titleAr: "نماذج أولية لتسجيل المستخدم",
    description: "Design user onboarding flow wireframes with Figma",
    descriptionAr: "تصميم نماذج أولية لتدفق تسجيل المستخدم باستخدام Figma",
    status: "todo",
    assignedTo: "ux-designer",
    priority: "medium",
    startedAt: "2026-02-26T09:00:00Z",
  },
  {
    id: "task-12",
    title: "Sprint retrospective report",
    titleAr: "تقرير مراجعة السبرنت",
    description: "Compile sprint 2.0 retrospective with metrics and lessons learned",
    descriptionAr: "تجميع مراجعة السبرنت 2.0 مع المقاييس والدروس المستفادة",
    status: "todo",
    assignedTo: "scrum-master",
    priority: "low",
    startedAt: "2026-02-26T10:00:00Z",
  },
  {
    id: "task-13",
    title: "Requirements doc for billing",
    titleAr: "وثيقة متطلبات الفوترة",
    description: "Write BRD for the billing and subscription module",
    descriptionAr: "كتابة وثيقة متطلبات الأعمال لوحدة الفوترة والاشتراكات",
    status: "backlog",
    assignedTo: "business-analyst",
    priority: "medium",
    startedAt: "2026-02-26T10:00:00Z",
    waitingForHuman: true,
  },
  {
    id: "task-14",
    title: "Redis caching layer",
    titleAr: "طبقة التخزين المؤقت Redis",
    description: "Implement Redis caching for agent state and session data",
    descriptionAr: "تنفيذ التخزين المؤقت Redis لحالة الوكيل وبيانات الجلسة",
    status: "backlog",
    assignedTo: null,
    priority: "high",
    startedAt: "2026-02-26T10:00:00Z",
  },
  {
    id: "task-15",
    title: "WebSocket load testing",
    titleAr: "اختبار تحميل WebSocket",
    description: "Stress test WebSocket connections with 10K concurrent agents",
    descriptionAr: "اختبار إجهاد اتصالات WebSocket مع 10 آلاف وكيل متزامن",
    status: "backlog",
    assignedTo: null,
    priority: "low",
    startedAt: "2026-02-26T10:00:00Z",
  },
];

// ─── Messages ─────────────────────────────────────────────────────────────────

export const mockMessages: Message[] = [
  {
    id: "msg-1",
    from: "BMad Master",
    fromAvatar: "🎯",
    content: "Sprint 2.1 planning complete. Assigned 15 tasks across 12 agents. Priority: microservices architecture and dashboard.",
    contentAr: "اكتمل تخطيط السبرنت 2.1. تم تعيين 15 مهمة عبر 12 وكيلاً. الأولوية: بنية الخدمات المصغرة ولوحة التحكم.",
    type: "task",
    timestamp: "2026-02-26T08:00:00Z",
    isHuman: false,
    project: "ForgeTeam",
  },
  {
    id: "msg-2",
    from: "Winston (Architect)",
    fromAvatar: "🏗️",
    to: "Amelia-BE (Dev)",
    content: "Please implement the event bus using RabbitMQ. Schema attached in artifacts.",
    contentAr: "يرجى تنفيذ ناقل الأحداث باستخدام RabbitMQ. المخطط مرفق في المخرجات.",
    type: "task",
    timestamp: "2026-02-26T08:15:00Z",
    isHuman: false,
    project: "ForgeTeam",
  },
  {
    id: "msg-3",
    from: "Barry (DevOps)",
    fromAvatar: "🚀",
    content: "@human I'm blocked on the CI/CD pipeline. Need AWS credentials for the staging environment.",
    contentAr: "@human أنا متوقف على خط أنابيب CI/CD. أحتاج بيانات اعتماد AWS لبيئة التجربة.",
    type: "escalation",
    timestamp: "2026-02-26T08:30:00Z",
    isHuman: false,
    project: "ForgeTeam",
  },
  {
    id: "msg-4",
    from: "Human",
    fromAvatar: "👤",
    to: "Barry (DevOps)",
    content: "AWS credentials have been added to the vault. Use the forge-staging profile.",
    contentAr: "تمت إضافة بيانات اعتماد AWS إلى الخزنة. استخدم ملف التعريف forge-staging.",
    type: "task",
    timestamp: "2026-02-26T08:35:00Z",
    isHuman: true,
    project: "ForgeTeam",
  },
  {
    id: "msg-5",
    from: "Quinn (QA)",
    fromAvatar: "🔍",
    to: "Amelia-BE (Dev)",
    content: "Found 3 failing tests in the auth module. Token refresh endpoint returns 500 on expired tokens.",
    contentAr: "وجدت 3 اختبارات فاشلة في وحدة المصادقة. نقطة نهاية تحديث الرمز تعيد 500 على الرموز المنتهية.",
    type: "question",
    timestamp: "2026-02-26T09:00:00Z",
    isHuman: false,
    project: "ForgeTeam",
  },
  {
    id: "msg-6",
    from: "Shield (Security)",
    fromAvatar: "🛡️",
    content: "OWASP audit progress: 7/10 categories checked. Found 2 medium-severity issues in input validation.",
    contentAr: "تقدم تدقيق OWASP: تم فحص 7/10 فئات. تم العثور على مشكلتين متوسطتي الخطورة في التحقق من المدخلات.",
    type: "task",
    timestamp: "2026-02-26T09:15:00Z",
    isHuman: false,
    project: "ForgeTeam",
  },
  {
    id: "msg-7",
    from: "John (PM)",
    fromAvatar: "📋",
    content: "Backlog refinement session complete. 8 stories estimated, 3 moved to sprint 2.2.",
    contentAr: "اكتملت جلسة تنقيح التراكم. تم تقدير 8 قصص، ونُقلت 3 إلى السبرنت 2.2.",
    type: "task",
    timestamp: "2026-02-26T09:30:00Z",
    isHuman: false,
    project: "ForgeTeam",
  },
  {
    id: "msg-8",
    from: "Amelia-FE (Dev)",
    fromAvatar: "💻",
    to: "Sally (UX)",
    content: "Need design tokens for the dark mode color palette. Can you share the Figma file?",
    contentAr: "أحتاج رموز التصميم للوحة ألوان الوضع الداكن. هل يمكنك مشاركة ملف Figma؟",
    type: "question",
    timestamp: "2026-02-26T09:45:00Z",
    isHuman: false,
    project: "ForgeTeam",
  },
  {
    id: "msg-9",
    from: "Paige (Docs)",
    fromAvatar: "📝",
    content: "API documentation v2 is 60% complete. 23 endpoints documented with examples. Remaining: webhooks and WebSocket events.",
    contentAr: "توثيق API v2 مكتمل بنسبة 60%. تم توثيق 23 نقطة نهاية مع أمثلة. المتبقي: الويب هوكس وأحداث WebSocket.",
    type: "task",
    timestamp: "2026-02-26T10:00:00Z",
    isHuman: false,
    project: "ForgeTeam",
  },
  {
    id: "msg-10",
    from: "Amelia-BE (Dev)",
    fromAvatar: "⚙️",
    to: "Quinn (QA)",
    content: "Fixed the token refresh issue. The expired token handler was missing a catch block. PR #142 submitted.",
    contentAr: "تم إصلاح مشكلة تحديث الرمز. كان معالج الرمز المنتهي يفتقد كتلة catch. تم تقديم PR #142.",
    type: "task",
    timestamp: "2026-02-26T10:15:00Z",
    isHuman: false,
    project: "ForgeTeam",
  },
];

// ─── Workflow Phases ──────────────────────────────────────────────────────────

export const mockWorkflowPhases: WorkflowPhase[] = [
  {
    id: "requirements",
    name: "Requirements",
    nameAr: "المتطلبات",
    progress: 100,
    status: "completed",
    startDate: "2026-02-20",
    endDate: "2026-02-22",
    checkpoints: 5,
    checkpointsComplete: 5,
  },
  {
    id: "design",
    name: "Design",
    nameAr: "التصميم",
    progress: 100,
    status: "completed",
    startDate: "2026-02-22",
    endDate: "2026-02-24",
    checkpoints: 4,
    checkpointsComplete: 4,
  },
  {
    id: "code",
    name: "Code",
    nameAr: "البرمجة",
    progress: 65,
    status: "active",
    startDate: "2026-02-24",
    checkpoints: 8,
    checkpointsComplete: 5,
  },
  {
    id: "test",
    name: "Test",
    nameAr: "الاختبار",
    progress: 30,
    status: "active",
    startDate: "2026-02-25",
    checkpoints: 6,
    checkpointsComplete: 2,
  },
  {
    id: "deploy",
    name: "Deploy",
    nameAr: "النشر",
    progress: 0,
    status: "pending",
    startDate: "2026-02-28",
    checkpoints: 3,
    checkpointsComplete: 0,
  },
];

// ─── VIADP Delegations ───────────────────────────────────────────────────────

export const mockDelegations: DelegationEntry[] = [
  {
    id: "del-1",
    from: "BMad Master",
    to: "Winston (Architect)",
    taskId: "Design microservices architecture",
    taskAr: "تصميم بنية الخدمات المصغرة",
    trustScore: 0.95,
    status: "verified",
    timestamp: "2026-02-25T08:00:00Z",
    proofChain: [
      "Task assigned by BMad Master with authority level: HIGH",
      "Winston (Architect) capabilities verified: architecture, system-design",
      "VIADP trust score computed: 0.95 (based on 47 successful completions)",
      "Delegation approved and logged",
    ],
  },
  {
    id: "del-2",
    from: "Winston (Architect)",
    to: "Amelia-BE (Dev)",
    taskId: "Implement event bus with RabbitMQ",
    taskAr: "تنفيذ ناقل الأحداث باستخدام RabbitMQ",
    trustScore: 0.88,
    status: "verified",
    timestamp: "2026-02-25T10:00:00Z",
    proofChain: [
      "Sub-task delegated by Winston (Architect) under BMad Master authorization",
      "Amelia-BE (Dev) capabilities verified: backend, messaging, rabbitmq",
      "VIADP trust score computed: 0.88 (based on 35 successful completions)",
      "Delegation approved and logged",
    ],
  },
  {
    id: "del-3",
    from: "BMad Master",
    to: "Quinn (QA)",
    taskId: "Integration test suite for auth module",
    taskAr: "مجموعة اختبارات التكامل لوحدة المصادقة",
    trustScore: 0.92,
    status: "verified",
    timestamp: "2026-02-26T07:00:00Z",
    proofChain: [
      "Task assigned by BMad Master with authority level: HIGH",
      "Quinn (QA) capabilities verified: testing, integration, e2e",
      "VIADP trust score computed: 0.92 (based on 52 successful completions)",
      "Delegation approved and logged",
    ],
  },
  {
    id: "del-4",
    from: "BMad Master",
    to: "Barry (DevOps)",
    taskId: "CI/CD pipeline configuration",
    taskAr: "تكوين خط أنابيب CI/CD",
    trustScore: 0.85,
    status: "pending",
    timestamp: "2026-02-26T06:00:00Z",
    proofChain: [
      "Task assigned by BMad Master with authority level: HIGH",
      "Barry (DevOps) capabilities verified: devops, ci-cd, docker, k8s",
      "VIADP trust score computed: 0.85 (based on 28 successful completions)",
      "Awaiting verification - agent currently blocked",
    ],
  },
  {
    id: "del-5",
    from: "Shield (Security)",
    to: "Amelia-BE (Dev)",
    taskId: "Fix input validation vulnerabilities",
    taskAr: "إصلاح ثغرات التحقق من المدخلات",
    trustScore: 0.78,
    status: "pending",
    timestamp: "2026-02-26T09:30:00Z",
    proofChain: [
      "Security audit finding delegated as fix task",
      "Amelia-BE (Dev) capabilities verified: backend, security-fixes",
      "VIADP trust score computed: 0.78 (cross-domain delegation penalty applied)",
      "Awaiting verification",
    ],
  },
  {
    id: "del-6",
    from: "John (PM)",
    to: "Mary (BA)",
    taskId: "Write billing module BRD",
    taskAr: "كتابة وثيقة متطلبات وحدة الفوترة",
    trustScore: 0.91,
    status: "verified",
    timestamp: "2026-02-26T08:00:00Z",
    proofChain: [
      "Requirements task delegated by John (PM)",
      "Mary (BA) capabilities verified: analysis, brd, requirements",
      "VIADP trust score computed: 0.91 (based on 40 successful completions)",
      "Delegation approved and logged",
    ],
  },
];

// ─── Cost History ─────────────────────────────────────────────────────────────

export const mockCostHistory: CostDay[] = [
  { date: "Feb 20", cost: 28.5 },
  { date: "Feb 21", cost: 35.2 },
  { date: "Feb 22", cost: 42.8 },
  { date: "Feb 23", cost: 31.6 },
  { date: "Feb 24", cost: 38.9 },
  { date: "Feb 25", cost: 45.3 },
  { date: "Feb 26", cost: 48.45 },
];

export const dailyBudget = 75.0;
export const todayCost = 48.45;

// ─── Agent Memory Data ────────────────────────────────────────────────────────

export const mockMemoryData: AgentMemoryData[] = [
  { agentId: "bmad-master", agentName: "BMad Master", agentNameAr: "بي ماد ماستر", shortTermTokens: 32000, shortTermLastUpdated: 2, longTermEntries: 185, longTermTokens: 420000 },
  { agentId: "product-owner", agentName: "John (PM)", agentNameAr: "جون (مدير المنتج)", shortTermTokens: 18000, shortTermLastUpdated: 8, longTermEntries: 124, longTermTokens: 310000 },
  { agentId: "business-analyst", agentName: "Mary (BA)", agentNameAr: "ماري (محللة الأعمال)", shortTermTokens: 12000, shortTermLastUpdated: 25, longTermEntries: 89, longTermTokens: 245000 },
  { agentId: "scrum-master", agentName: "Bob (SM)", agentNameAr: "بوب (سكرم ماستر)", shortTermTokens: 8500, shortTermLastUpdated: 5, longTermEntries: 67, longTermTokens: 156000 },
  { agentId: "architect", agentName: "Winston (Architect)", agentNameAr: "ونستون (المعماري)", shortTermTokens: 45000, shortTermLastUpdated: 1, longTermEntries: 210, longTermTokens: 580000 },
  { agentId: "ux-designer", agentName: "Sally (UX)", agentNameAr: "سالي (مصممة UX)", shortTermTokens: 14000, shortTermLastUpdated: 18, longTermEntries: 95, longTermTokens: 198000 },
  { agentId: "frontend-dev", agentName: "Amelia-FE (Dev)", agentNameAr: "أميليا-FE (مطورة)", shortTermTokens: 28000, shortTermLastUpdated: 3, longTermEntries: 156, longTermTokens: 390000 },
  { agentId: "backend-dev", agentName: "Amelia-BE (Dev)", agentNameAr: "أميليا-BE (مطورة)", shortTermTokens: 38000, shortTermLastUpdated: 4, longTermEntries: 178, longTermTokens: 520000 },
  { agentId: "qa-architect", agentName: "Quinn (QA)", agentNameAr: "كوين (مهندسة جودة)", shortTermTokens: 22000, shortTermLastUpdated: 6, longTermEntries: 134, longTermTokens: 345000 },
  { agentId: "devops-engineer", agentName: "Barry (DevOps)", agentNameAr: "باري (DevOps)", shortTermTokens: 15000, shortTermLastUpdated: 12, longTermEntries: 78, longTermTokens: 210000 },
  { agentId: "security-specialist", agentName: "Shield (Security)", agentNameAr: "شيلد (الأمن)", shortTermTokens: 35000, shortTermLastUpdated: 7, longTermEntries: 145, longTermTokens: 410000 },
  { agentId: "tech-writer", agentName: "Paige (Docs)", agentNameAr: "بايج (التوثيق)", shortTermTokens: 20000, shortTermLastUpdated: 15, longTermEntries: 112, longTermTokens: 280000 },
];

// ─── Voice Transcripts ────────────────────────────────────────────────────────

export const mockTranscripts: VoiceTranscript[] = [
  {
    id: "vt-1",
    timestamp: "2026-02-26T08:05:00Z",
    direction: "stt",
    language: "ar",
    text: "أريد أن أبدأ سبرنت جديد لميزة الفوترة",
    confidence: 0.94,
    duration: 4.2,
    sessionId: "session-001",
  },
  {
    id: "vt-2",
    timestamp: "2026-02-26T08:05:15Z",
    direction: "tts",
    language: "ar",
    text: "تم إنشاء السبرنت الجديد بنجاح. سأقوم بتعيين المهام للوكلاء المناسبين.",
    duration: 5.8,
    sessionId: "session-001",
  },
  {
    id: "vt-3",
    timestamp: "2026-02-26T09:12:00Z",
    direction: "stt",
    language: "en",
    text: "Show me the current status of the CI/CD pipeline task",
    confidence: 0.97,
    duration: 3.1,
    sessionId: "session-002",
  },
  {
    id: "vt-4",
    timestamp: "2026-02-26T09:12:10Z",
    direction: "tts",
    language: "en",
    text: "The CI/CD pipeline task is currently blocked. DevOps Engineer is waiting for AWS credentials for the staging environment.",
    duration: 6.4,
    sessionId: "session-002",
  },
  {
    id: "vt-5",
    timestamp: "2026-02-26T10:30:00Z",
    direction: "stt",
    language: "ar",
    text: "ما هو تقدم تدقيق الأمان؟",
    confidence: 0.92,
    duration: 2.8,
    sessionId: "session-003",
  },
  {
    id: "vt-6",
    timestamp: "2026-02-26T10:30:12Z",
    direction: "tts",
    language: "ar",
    text: "تدقيق OWASP مكتمل بنسبة سبعين بالمئة. تم فحص سبع من عشر فئات. تم العثور على مشكلتين متوسطتي الخطورة في التحقق من المدخلات.",
    duration: 8.2,
    sessionId: "session-003",
  },
];
