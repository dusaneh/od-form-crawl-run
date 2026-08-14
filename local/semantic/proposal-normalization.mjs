export function uniquifyActionProposalIds(proposal) {
  const normalizations = [];
  const usedActionIds = new Set();
  for (const [index, action] of (proposal?.proposedActions || []).entries()) {
    const original = String(action.proposalId || "");
    let candidate = original;
    let suffix = index + 1;
    while (usedActionIds.has(candidate)) {
      candidate = `${original}__${suffix}`;
      suffix += 1;
    }
    if (candidate !== original) {
      action.proposalId = candidate;
      normalizations.push({
        path: `$.proposedActions[${index}].proposalId`,
        kind: "deduplicate_opaque_id",
        before: original,
        after: candidate,
      });
    }
    usedActionIds.add(candidate);
  }
  return normalizations;
}
