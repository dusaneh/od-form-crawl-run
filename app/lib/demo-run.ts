import type { Finding, FlowEdge, FlowNode, FormRun } from "./models";

export const demoNodes: FlowNode[] = [
  {
    id: "welcome",
    step: "01",
    title: "Start & consent",
    subtitle: "Cookie banner dismissed",
    fingerprint: "7e41·a20c",
    status: "complete",
    fields: 2,
    branches: 0,
    x: 34,
    y: 146,
    evidence: "evidence/start-consent.webp",
    sensitiveMasks: 0,
    notes: [
      "Invisible reCAPTCHA v3 detected and flagged.",
      "Single advance candidate verified by state change.",
    ],
  },
  {
    id: "identity",
    step: "02",
    title: "About you",
    subtitle: "Identity and contact",
    fingerprint: "2b86·d0f1",
    status: "complete",
    fields: 8,
    branches: 0,
    x: 250,
    y: 146,
    evidence: "evidence/about-you.webp",
    sensitiveMasks: 6,
    notes: [
      "All eight writes read back successfully.",
      "Six sensitive bounds registered for masking.",
    ],
  },
  {
    id: "household",
    step: "03",
    title: "Household details",
    subtitle: "Probing 7 of 8 values",
    fingerprint: "b91a·44ee",
    status: "active",
    fields: 11,
    branches: 3,
    x: 466,
    y: 146,
    evidence: "evidence/household.webp",
    sensitiveMasks: 3,
    notes: [
      "Base schema is frozen; dynamic fields are expand-only.",
      "Veteran status reveal carries lineage: veteran_status=yes.",
    ],
  },
  {
    id: "adult",
    step: "03A",
    title: "Adult household",
    subtitle: "age_18_plus = yes",
    fingerprint: "0aa4·617b",
    status: "complete",
    fields: 4,
    branches: 0,
    x: 690,
    y: 48,
    evidence: "evidence/adult-branch.webp",
    sensitiveMasks: 2,
    notes: [
      "Four dependent fields appended to the base schema.",
      "Probe began from a clean household baseline.",
    ],
  },
  {
    id: "children",
    step: "03B",
    title: "Children in home",
    subtitle: "dependents > 0",
    fingerprint: "8c3e·19da",
    status: "review",
    fields: 6,
    branches: 1,
    x: 690,
    y: 244,
    evidence: "evidence/children-branch.webp",
    sensitiveMasks: 3,
    notes: [
      "Cross-page dependency phrase detected.",
      "Queued for review before runtime trust.",
    ],
  },
  {
    id: "income",
    step: "04",
    title: "Income & benefits",
    subtitle: "Awaiting branch merge",
    fingerprint: "5fd0·331e",
    status: "queued",
    fields: 9,
    branches: 2,
    x: 924,
    y: 146,
    evidence: "evidence/income.webp",
    sensitiveMasks: 4,
    notes: [
      "State is known but not yet certified.",
      "Advance is unreachable until upstream branches merge.",
    ],
  },
  {
    id: "captcha",
    step: "05",
    title: "Human verification",
    subtitle: "Interactive challenge",
    fingerprint: "d318·907c",
    status: "review",
    fields: 0,
    branches: 0,
    x: 1140,
    y: 146,
    evidence: "evidence/captcha.webp",
    sensitiveMasks: 0,
    notes: [
      "Deterministic backstop confirmed interactive CAPTCHA.",
      "Automation is paused for human handoff.",
    ],
  },
  {
    id: "submit",
    step: "06",
    title: "Review & submit",
    subtitle: "Approval gate locked",
    fingerprint: "—",
    status: "locked",
    fields: 3,
    branches: 0,
    x: 1356,
    y: 146,
    evidence: "evidence/submit.webp",
    sensitiveMasks: 5,
    notes: [
      "Submit is structurally unreachable in synthetic mode.",
      "A named operator must approve a live execution.",
    ],
  },
];

export const demoEdges: FlowEdge[] = [
  { id: "e1", from: "welcome", to: "identity", status: "verified", kind: "advance" },
  { id: "e2", from: "identity", to: "household", status: "verified", kind: "advance" },
  {
    id: "e3",
    from: "household",
    to: "adult",
    label: "adult = yes",
    status: "verified",
    kind: "branch",
  },
  {
    id: "e4",
    from: "household",
    to: "children",
    label: "dependents > 0",
    status: "observed",
    kind: "branch",
  },
  { id: "e5", from: "adult", to: "income", status: "verified", kind: "branch" },
  { id: "e6", from: "children", to: "income", status: "observed", kind: "branch" },
  { id: "e7", from: "income", to: "captcha", status: "queued", kind: "advance" },
  {
    id: "e8",
    from: "captcha",
    to: "submit",
    label: "human handoff",
    status: "halted",
    kind: "halt",
  },
];

export const demoFindings: Finding[] = [
  {
    id: "f1",
    tone: "warning",
    code: "cross_page_dependence",
    title: "Earlier value echoed on a later state",
    detail:
      "“Because you selected children in household…” was found in state 03B. Human review is required before trust.",
    time: "12s ago",
  },
  {
    id: "f2",
    tone: "success",
    code: "actuation_verified",
    title: "Seven branch probes verified",
    detail:
      "Each option was applied from a re-baselined state and read back before DOM comparison.",
    time: "31s ago",
  },
  {
    id: "f3",
    tone: "info",
    code: "schema_expanded",
    title: "Four dependent fields appended",
    detail:
      "Delta accepted with lineage household_member_18_plus=yes. No existing fields changed or deleted.",
    time: "1m ago",
  },
  {
    id: "f4",
    tone: "success",
    code: "screenshot_masked",
    title: "Evidence frame safely captured",
    detail:
      "Three sensitive field bounds and two text echoes were masked before storage.",
    time: "2m ago",
  },
];

export function makeDemoRun(overrides: Partial<FormRun> = {}): FormRun {
  return {
    id: "run_demo_housing_042",
    name: "Santa Clara County Housing Intake",
    targetUrl: "https://apply.housingconnect.example/intake",
    urls: [
      "https://apply.housingconnect.example/intake",
      "https://helpcenter.example/rapid-rehousing",
    ],
    status: "running",
    stage: "Probing dynamic branches",
    progress: 74,
    mode: "crawl",
    nodes: demoNodes,
    edges: demoEdges,
    findings: demoFindings,
    synthetic: true,
    liveApproved: false,
    createdAt: "2026-07-23T03:42:00.000Z",
    updatedAt: "2026-07-23T04:01:26.000Z",
    ...overrides,
  };
}

export function makeFreshGraph(): Pick<FormRun, "nodes" | "edges" | "findings"> {
  return {
    nodes: demoNodes.map((node, index) => ({
      ...node,
      status: index === 0 ? "active" : "queued",
    })),
    edges: demoEdges.map((edge) => ({ ...edge, status: "queued" })),
    findings: [
      {
        id: crypto.randomUUID(),
        tone: "info",
        code: "session_initialized",
        title: "Isolated browser session created",
        detail:
          "Synthetic values are active. Final submission is structurally unreachable.",
        time: "now",
      },
    ],
  };
}
