export type RunStatus =
  | "running"
  | "paused"
  | "awaiting_review"
  | "completed"
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
  evidenceAvailable?: boolean;
  sourceUrl?: string;
  pageTitle?: string;
  httpStatus?: number;
  durationMs?: number;
  forms?: number;
  fieldDetails?: FieldContract[];
  formActions?: string[];
  screenshotProvider?: string;
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

export type FieldContract = {
  key: string;
  label: string;
  control: string;
  required: boolean;
  sensitive: boolean;
  hidden: boolean;
  options: number;
  selector: string;
  originState: string;
  originUrl: string;
  frameUrl?: string;
  rendered?: boolean;
};

export type CrawlStats = {
  pagesAttempted: number;
  pagesFetched: number;
  formsFound: number;
  fieldsFound: number;
  screenshotsCaptured: number;
  bytesFetched: number;
  automationActions?: number;
  stateExaminations?: number;
  blockedWriteRequests?: number;
  allowedReadLikeRequests?: number;
  captchaPages?: number;
  startedAt: string;
  finishedAt?: string;
};

export type CrawlReportPage = {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  heading: string;
  httpStatus: number;
  contentType: string;
  durationMs: number;
  bytesFetched: number;
  fingerprint: string;
  forms: number;
  fields: Omit<FieldContract, "originState" | "originUrl">[];
  formActions: string[];
  links: { url: string; text: string }[];
  hasScripts: boolean;
  screenshotContentType?: string;
  screenshotProvider?: string;
  htmlArtifact?: string;
  screenshotArtifact?: string;
  rendered?: boolean;
  renderEngine?: string;
  browserMode?: BrowserMode;
  frameCount?: number;
  shadowRootCount?: number;
  blockedWriteRequests?: number;
  allowedReadLikeRequests?: number;
  automationActions?: TraversalAction[];
  captchaDetected?: boolean;
  unresolvedGate?: string;
  stateExaminations?: number;
  error?: string;
};

export type BrowserMode = "headless" | "headful";

export type TraversalSettings = {
  version: number;
  cookieConsent: "reject_non_essential" | "accept_all" | "observe_only";
  acceptCookiesWhenRequired: boolean;
  closeWelcomeBanners: boolean;
  dismissOptionalOffers: boolean;
  dismissOptionalAuth: boolean;
  expandSafeDisclosures: boolean;
  advanceIntroScreens: boolean;
  allowSameOriginReadLikePosts: boolean;
  pointerAndScrollPriming: boolean;
  unpredictablePopups: "observe_only";
  captchaPolicy: "detect_and_handoff";
  stableWindowMs: number;
  maxStateWaitMs: number;
  maxActionsPerPage: number;
  updatedAt?: string;
};

export type TraversalAction = {
  category:
    | "cookie_consent"
    | "welcome_banner"
    | "optional_offer"
    | "optional_auth"
    | "safe_disclosure"
    | "intro_advance";
  label: string;
  strategy: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  changed: boolean;
  timestamp: string;
  error?: string;
};

export type InferredField = {
  label: string;
  control: string;
  required: boolean;
  sensitive: boolean;
  confidence: "high" | "medium" | "low";
  evidence: string;
  originUrl: string;
};

export type CrawlAnalysis = {
  status: "completed" | "skipped" | "failed";
  model: string;
  summary: string;
  pagePurpose: string;
  visibleForms: string[];
  inferredFields: InferredField[];
  keyFindings: {
    tone: "success" | "warning" | "danger" | "info";
    title: string;
    detail: string;
  }[];
  limitations: string[];
  completedAt?: string;
  error?: string;
};

export type CrawlReport = {
  id: string;
  generatedAt: string;
  targets: string[];
  stats: CrawlStats;
  pages: CrawlReportPage[];
  contract: FieldContract[];
  findings: Finding[];
  browserMode?: BrowserMode;
  renderEngine?: string;
  traversalSettings?: TraversalSettings;
  analysis?: CrawlAnalysis;
  artifacts?: {
    runDirectory: string;
    report: string;
    events: string;
    pagesDirectory: string;
    evidenceDirectory: string;
  };
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
  browserMode?: BrowserMode;
  traversalSettings?: TraversalSettings;
  nodes: FlowNode[];
  edges: FlowEdge[];
  findings: Finding[];
  contract?: FieldContract[];
  stats?: CrawlStats;
  reportAvailable?: boolean;
  analysisStatus?: CrawlAnalysis["status"] | "pending";
  artifacts?: CrawlReport["artifacts"];
  synthetic: boolean;
  liveApproved: boolean;
  createdAt: string;
  updatedAt: string;
};
