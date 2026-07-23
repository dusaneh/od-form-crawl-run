export type RunStatus =
  | "running"
  | "paused"
  | "awaiting_review"
  | "certified"
  | "failed";

export type NodeStatus =
  | "complete"
  | "active"
  | "queued"
  | "review"
  | "locked";

export type ReasonCode =
  | "locator_unresolved"
  | "type_mismatch"
  | "actuation_unverified"
  | "advance_no_navigation"
  | "validation_blocked"
  | "drift_fingerprint"
  | "captcha_handoff"
  | "ambiguous_advance";

export type FlowNode = {
  id: string;
  step: string;
  title: string;
  subtitle: string;
  fingerprint: string;
  status: NodeStatus;
  fields: number;
  branches: number;
  x: number;
  y: number;
  evidence: string;
  sensitiveMasks: number;
  notes: string[];
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  status: "verified" | "observed" | "queued" | "halted";
  kind?: "advance" | "branch" | "halt";
};

export type Finding = {
  id: string;
  tone: "success" | "warning" | "danger" | "info";
  code: string;
  title: string;
  detail: string;
  time: string;
};

export type FormRun = {
  id: string;
  name: string;
  targetUrl: string;
  urls: string[];
  status: RunStatus;
  stage: string;
  progress: number;
  mode: "crawl" | "dry_run" | "live";
  nodes: FlowNode[];
  edges: FlowEdge[];
  findings: Finding[];
  synthetic: boolean;
  liveApproved: boolean;
  createdAt: string;
  updatedAt: string;
};
