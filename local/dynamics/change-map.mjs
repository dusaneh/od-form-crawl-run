import { validateRawObservation } from "../contracts/runtime-schemas.mjs";

function factSignature(fact) {
  return JSON.stringify([
    fact.tag,
    fact.rawType,
    fact.name,
    fact.id,
    fact.frameUrl,
  ]);
}

export function aggregateChangeMap(observations) {
  const probes = observations.map((observation) => {
    validateRawObservation(observation);
    const before = new Map(
      observation.before.controls.map((fact) => [fact.factId, fact]),
    );
    const after = new Map(
      observation.after.controls.map((fact) => [fact.factId, fact]),
    );
    return {
      stateKey: observation.stateKey,
      fieldKey: observation.probe.fieldKey,
      value: observation.probe.value,
      added: observation.delta.addedFactIds
        .map((factId) => after.get(factId))
        .filter(Boolean),
      removed: observation.delta.removedFactIds
        .map((factId) => before.get(factId))
        .filter(Boolean),
      requiredChanged: observation.delta.requiredChangedFactIds.map(
        (factId) => ({
          before: before.get(factId),
          after: after.get(factId),
        }),
      ),
    };
  });
  return {
    schemaVersion: 1,
    kind: "d6_change_map",
    probes,
    distinctAddedControlSignatures: [
      ...new Set(
        probes.flatMap((probe) => probe.added.map((fact) => factSignature(fact))),
      ),
    ].sort(),
  };
}
