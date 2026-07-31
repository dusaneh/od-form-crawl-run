export type RunStatus =
  | "running"
  | "paused"
  | "awaiting_review"
  | "disqualified"
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
  | "fetch_failed"
  | "locator_unresolved"
  | "actuation_unverified"
  | "could_not_test"
  | "advance_no_navigation"
  | "challenge_detected"
  | "login_or_payment_detected"
  | "drift_fingerprint"
  | "quality_floor";

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
  evidenceValueCount?: number;
  sourceUrl?: string;
  pageTitle?: string;
  httpStatus?: number;
  durationMs?: number;
  forms?: number;
  fieldDetails?: FieldContract[];
  formActions?: string[];
  screenshotProvider?: string;
  stateEvidence?: StateEvidence[];
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
  name?: string;
  id?: string;
  key: string;
  label: string;
  control: string;
  required: boolean;
  sensitive: boolean;
  hidden: boolean;
  options: number;
  optionSet?: { value: string; label: string }[];
  groupLabel?: string;
  optionValues?: string[];
  selector: string;
  selectorCandidates?: string[];
  originState: string;
  originUrl: string;
  frameUrl?: string;
  rendered?: boolean;
  testValue?: string;
  testValues?: string[];
  testValueSource?: "llm" | "deterministic" | "unavailable";
  entryStatus?: "entered" | "skipped" | "failed";
  entryError?: string;
  requiredSource?: "required_attribute" | "aria_required" | "aria_or_runtime" | "not_observed";
  validation?: {
    pattern?: string;
    min?: string;
    max?: string;
    minLength?: string;
    maxLength?: string;
  };
  upload?: {
    accept?: string;
    maxSize?: string;
    maxFiles?: string;
    multiple?: boolean;
  };
  consent?: boolean;
  adminAssisted?: boolean;
  legalAcceptanceType?:
    | "acknowledgement"
    | "consent"
    | "reviewConfirmation"
    | "signature";
  canonicalProfileKey?: string;
  repeatableSection?: string;
  addRowControl?: string;
  otherSpecifyFor?: string;
  sectionText?: string;
  sectionId?: string;
  guidanceIds?: string[];
  formId?: string;
};

export type GuidanceRecord = {
  id: string;
  kind:
    | "instruction"
    | "eligibility"
    | "definition"
    | "warning"
    | "example"
    | "privacy"
    | "other";
  scope: "form" | "section" | "question";
  scopeId: string;
  text: string;
  provenance: {
    source:
      | "aria-describedby"
      | "aria-labelledby"
      | "nearby-dom"
      | "section-dom";
    selector: string;
    frameUrl: string;
  };
};

export type SectionRecord = {
  id: string;
  parentId?: string;
  label: string;
  ordinal: number;
  selector: string;
  frameUrl: string;
  questionKeys: string[];
  guidanceIds: string[];
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
  statesCaptured?: number;
  fieldsEntered?: number;
  entryFailures?: number;
  branchStates?: number;
  submissionsAttempted?: number;
  submissionsSucceeded?: number;
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
  fingerprintAlgorithmVersion?: string;
  fingerprintInput?: {
    algorithmVersion: string;
    normalizedUrl: string;
    fields: {
      nameOrId: string;
      type: string;
      required: boolean;
      optionValues: string[];
      sectionText: string;
    }[];
    stateCount: number;
    uploadPresence: boolean;
  };
  forms: number;
  fields: Omit<FieldContract, "originState" | "originUrl">[];
  guidanceRecords?: GuidanceRecord[];
  sections?: SectionRecord[];
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
  executionMode?: ExecutionMode;
  frameCount?: number;
  shadowRootCount?: number;
  blockedWriteRequests?: number;
  allowedReadLikeRequests?: number;
  automationActions?: TraversalAction[];
  captchaDetected?: boolean;
  unresolvedGate?: string;
  stateExaminations?: number;
  stateEvidence?: StateEvidence[];
  fieldsEntered?: number;
  entryFailures?: number;
  branchStates?: number;
  finalSubmission?:
    | "blocked"
    | "submitted"
    | "submitted_unverified"
    | "not_found"
    | "not_requested";
  submissionResult?: {
    verified: boolean;
    outcome: "success" | "failure" | "unknown";
    source: string;
    detail: string;
    criteria?: {
      assessmentId: string;
      confidence: "high" | "medium" | "low";
      markers: string[];
      rationale: string;
    } | null;
    provenance?: {
      generatedAt: string;
      model: string;
      promptVersion: string;
      responseId?: string | null;
      durationMs?: number;
    } | null;
    transport?: {
      clicked?: boolean;
      submitEventObserved?: boolean;
      writeRequestObserved?: boolean;
      verified: boolean;
      navigationStatus: number | null;
      stateChanged: boolean;
      detail: string;
    } | null;
  } | null;
  certificationStatus?:
    | "probe_completed"
    | "generated_script_validated"
    | "fixture_submitted"
    | "could_not_test"
    | "branching_logic_detected"
    | "script_missing"
    | "no_form";
  reconScriptId?: string;
  reconScriptVersion?: number;
  generatedArtifact?: {
    artifactId: string;
    scriptVersion: number;
    sourceHash: string;
    path: string;
    modelCalls: number;
    modelCallsThisRun?: number;
    states: number;
    lifecycle?:
      | "generated_and_validated"
      | "generated_and_published"
      | "generated_not_published"
      | "retained_replay";
  } | null;
  journeyUrls?: string[];
  entryMode?: "canonical" | "mid_flow" | "unknown";
  entryDetail?: string;
  journeyComplete?: boolean;
  haltReason?: string;
  error?: string;
};

export type BrowserMode = "headless" | "headful";
export type ExecutionMode = "probe" | "fixture_submit";
export type FixtureAuthorities = {
  acknowledgement: boolean;
  consent: boolean;
  reviewConfirmation: boolean;
  signature: boolean;
  upload: boolean;
};

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
  captchaPolicy: "detect_and_disqualify";
  stableWindowMs: number;
  maxStateWaitMs: number;
  maxActionsPerPage: number;
  enterTestValues: boolean;
  exerciseBranches: boolean;
  advanceFormSteps: boolean;
  maxFormStates: number;
  maxBranchOptionsPerControl: number;
  agentInstructions: string;
  updatedAt?: string;
};

export type TraversalAction = {
  category:
    | "cookie_consent"
    | "welcome_banner"
    | "optional_offer"
    | "optional_auth"
    | "safe_disclosure"
    | "intro_advance"
    | "field_entry"
    | "branch_probe"
    | "choice_probe"
    | "branch_reveal"
    | "form_advance"
    | "final_submit_blocked";
  label: string;
  strategy: string;
  beforeFingerprint?: string;
  afterFingerprint?: string;
  changed?: boolean;
  timestamp: string;
  fieldKey?: string;
  testValue?: string;
  source?: string;
  stateId?: string;
  classification?:
    | "deterministic"
    | "deterministic_replay"
    | "llm_generated_probe"
    | "conditional"
    | "human_review";
  rationale?: string;
  outcome?: "landed" | "could_not_test";
  failureCode?: ReasonCode;
  error?: string;
};

export type StateEvidence = {
  id: string;
  sequence: number;
  kind:
    | "initial"
    | "populated"
    | "branch"
    | "pre_advance"
    | "post_advance"
    | "choice_probe"
    | "branch_variant_populated"
    | "selected_branch_populated"
    | "blocked_final"
    | "submitted";
  label: string;
  url: string;
  title: string;
  fingerprint: string;
  capturedAt: string;
  fieldsVisible: number;
  values: {
    fieldKey: string;
    label: string;
    value: string;
    source: string;
    control?: string;
    required?: boolean;
    sensitive?: boolean;
    consent?: boolean;
    adminAssisted?: boolean;
    upload?: boolean;
    sectionText?: string;
    formId?: string;
    classification?:
      | "deterministic"
      | "deterministic_replay"
      | "llm_generated"
      | "conditional"
      | "human_review";
  }[];
  evidence?: string;
  evidenceAvailable?: boolean;
  screenshotArtifact?: string;
  screenshotContentType?: string;
  screenshotProvider?: string;
  evidenceRole?:
    | "pre_action"
    | "pre_action_branch"
    | "post_action"
    | "terminal_result"
    | "failure_boundary";
};

export type LiveTraversalField = {
  fieldKey: string;
  label: string;
  control: string;
  source: string;
  status: "pending" | "verified" | "failed";
  required?: boolean;
  sensitive?: boolean;
  consent?: boolean;
  adminAssisted?: boolean;
  upload?: boolean;
  sectionText?: string;
  formId?: string;
  classification?: "deterministic" | "conditional" | "human_review";
  rationale?: string;
  error?: string;
  updatedAt: string;
};

export type LiveTraversalFlag = {
  tone: "danger" | "warning" | "neutral";
  code: string;
  label: string;
  detail?: string;
};

export type LiveTraversalState = {
  id: string;
  sequence: number;
  kind: StateEvidence["kind"] | "working";
  label: string;
  description: string;
  url?: string;
  fingerprint?: string;
  fieldsVisible?: number;
  valuesCount: number;
  status: "active" | "verified" | "review" | "failed";
  fields: LiveTraversalField[];
  flags: LiveTraversalFlag[];
  capturedAt?: string;
};

export type LiveTraversal = {
  activeStateId: string;
  currentLabel: string;
  scriptId?: string;
  scriptVersion?: number;
  states: LiveTraversalState[];
  currentFields: LiveTraversalField[];
  flags: LiveTraversalFlag[];
  eventsSeen: number;
};

export type InferredField = {
  label: string;
  control: string;
  required: boolean;
  sensitive: boolean;
  confidence: "high" | "medium" | "low";
  evidence: string;
  originUrl: string;
  defaultTestValue: string;
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

export type ArchitectureExchange = {
  sequence: number;
  stateKey: string;
  label: string;
  route: string;
  status: "verified" | "failed" | "review";
  decisionTiming?: "generated_this_run" | "retained_prior_run";
  condition?: {
    fieldKey: string;
    value: unknown;
  } | null;
  sensing: {
    from: string;
    to: string;
    observedAt: string;
    url: string;
    title: string;
    heading: string;
    controlsObserved: number;
    actionsObserved: number;
    sectionsObserved: number;
    guidanceObserved: number;
    accessibilityCharacters: number;
    priorStates: number;
    existingContractFields: number;
    screenshotSha256: string;
    screenshotBytes: number;
    evidence: string;
  };
  semantics: {
    from: string;
    to: string;
    proposalId: string;
    model: string;
    promptVersion: string;
    responseId?: string;
    durationMs: number;
    attempts: number;
    fieldsProposed: number;
    sectionsProposed: number;
    guidanceProposed: number;
    actionsProposed: number;
    progression?: {
      key: string;
      kind: string;
      rationale?: string;
    };
    acceptedActions: number;
    rejectedActions: {
      code: string;
      detail: string;
      proposalId?: string;
    }[];
    safe: boolean;
  };
  script: {
    from: string;
    to: string;
    artifactId: string;
    scriptVersion: number;
    sourceHash: string;
    completeSourceHash: string;
    storedPath: string;
    fields: {
      key: string;
      label: string;
      control: string;
      required: boolean;
      testValue: unknown;
      selectors: string[];
      actionKind: string;
      safetyDisposition: string;
    }[];
    progression: {
      key: string;
      kind: string;
      label?: string;
      selectors: string[];
    };
  };
  execution: {
    from: string;
    to: string;
    mode: string;
    fieldsAttempted: number;
    fieldsVerified: number;
    fieldsSkipped: number;
    fieldFailures: number;
    progressionOutcome: string;
    observedStateIdentity: string;
    evidence: {
      id: string;
      kind: string;
      label: string;
      url: string;
      values: number;
    }[];
  };
};

export type RunnerJourneyField = {
  key: string;
  label: string;
  control: string;
  required: boolean;
  section: string;
  action: string;
  instruction: string;
};

export type RunnerJourney = {
  schemaVersion: number;
  available: boolean;
  source: "llm_authored_script";
  artifactId?: string;
  scriptVersion?: number;
  summary: string;
  approvalNote?: string;
  fieldCount: number;
  stateCount: number;
  terminalActionCount: number;
  steps: {
    sequence: number;
    type: "preparation" | "state";
    stateKey?: string;
    title: string;
    route?: string;
    description: string;
    source?: string;
    observedOutcome?: string;
    fields?: RunnerJourneyField[];
    conditionalGroups?: {
      condition: {
        fieldKey: string;
        fieldLabel: string;
        value: unknown;
        instruction: string;
      };
      fields: RunnerJourneyField[];
    }[];
    progression?: {
      kind: string;
      label: string;
      instruction: string;
      rationale: string;
      observedOutcome: string;
    };
  }[];
};

export type CrawlReport = {
  id: string;
  crawlId?: string;
  generatedAt: string;
  targets: string[];
  stats: CrawlStats;
  pages: CrawlReportPage[];
  contract: FieldContract[];
  findings: Finding[];
  browserMode?: BrowserMode;
  executionMode?: ExecutionMode;
  fixtureAuthorities?: FixtureAuthorities;
  renderEngine?: string;
  traversalSettings?: TraversalSettings;
  evidencePolicy?: {
    version: number;
    mode: "key_moments";
    retainedMoments: string[];
    transientModelScreenshotsPersisted: boolean;
    detail: string;
  };
  analysis?: CrawlAnalysis;
  architectureExchanges?: ArchitectureExchange[];
  runnerJourney?: RunnerJourney;
  formDefinitions?: CrawlFormDefinition[];
  artifacts?: {
    runDirectory: string;
    report: string;
    events: string;
    pagesDirectory: string;
    evidenceDirectory: string;
  };
};

export type CrawlFormDefinition = {
  formId: string;
  sourceRunId: string;
  targetUrl: string;
  title: string;
  status: "observed" | "approved" | "rejected" | "disqualified";
  eligibility: {
    status: "eligible" | "disqualified";
    reasons: { code: string; detail: string }[];
  };
  script: {
    artifactId: string;
    scriptVersion: number;
    sourceHash: string;
    path: string;
  };
  inputSchema: Record<string, unknown>;
  approvalEndpoint: string;
  runEndpoint: string;
};

export type FormRun = {
  id: string;
  crawlId?: string;
  name: string;
  targetUrl: string;
  urls: string[];
  status: RunStatus;
  stage: string;
  progress: number;
  mode: ExecutionMode | "crawl";
  browserMode?: BrowserMode;
  allowLocalTargets?: boolean;
  fixtureAuthorities?: FixtureAuthorities;
  traversalSettings?: TraversalSettings;
  nodes: FlowNode[];
  edges: FlowEdge[];
  findings: Finding[];
  contract?: FieldContract[];
  stats?: CrawlStats;
  reportAvailable?: boolean;
  formIds?: string[];
  analysisStatus?: CrawlAnalysis["status"] | "pending";
  liveTraversal?: LiveTraversal;
  artifacts?: CrawlReport["artifacts"];
  synthetic: boolean;
  liveApproved: boolean;
  createdAt: string;
  updatedAt: string;
};
