export const PRIVILEGED_OPERATOR_EMAIL = "dbosmail@gmail.com";
export const STANDARD_TEST_ORIGIN = "https://testforms.dbolab.io";

export const ACCESS_SCOPES = Object.freeze({
  controlPlane: "control-plane",
  externalTargets: "external-targets",
  llmReasoningOverride: "llm-reasoning-override",
});

export function userScopes(email, role) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedRole = role === "admin" ? "admin" : "operator";
  const scopes = ["ui", "api"];
  if (normalizedRole === "admin") scopes.push("admin");
  if (
    normalizedEmail === PRIVILEGED_OPERATOR_EMAIL &&
    normalizedRole === "admin"
  ) {
    scopes.push(
      ACCESS_SCOPES.controlPlane,
      ACCESS_SCOPES.externalTargets,
      ACCESS_SCOPES.llmReasoningOverride,
    );
  }
  return scopes;
}

export function hasPrivilegedUserScope(identity, scope) {
  return (
    ["basic", "session"].includes(String(identity?.mechanism || "")) &&
    String(identity?.principal || "").trim().toLowerCase() ===
      PRIVILEGED_OPERATOR_EMAIL &&
    identity?.role === "admin" &&
    Array.isArray(identity?.scopes) &&
    identity.scopes.includes(scope)
  );
}

export function isStandardTestTarget(value) {
  try {
    return new URL(String(value)).origin === STANDARD_TEST_ORIGIN;
  } catch {
    return false;
  }
}

export function requiresExternalTargetAccess(value) {
  try {
    return new URL(String(value)).origin !== STANDARD_TEST_ORIGIN;
  } catch {
    // URL validation owns malformed-target errors; access control should not
    // turn those into misleading authorization failures.
    return false;
  }
}

export function mayExecuteHostedTarget(identity, targetUrl) {
  return (
    !requiresExternalTargetAccess(targetUrl) ||
    hasPrivilegedUserScope(identity, ACCESS_SCOPES.externalTargets)
  );
}
