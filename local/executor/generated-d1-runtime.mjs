import { createD3Executor } from "./executor.mjs";

export const GENERATED_D1_RUNTIME_VERSION = 1;

function validateDescriptor(descriptor, contract) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new TypeError("Generated D1 descriptor must be an object.");
  }
  if (descriptor.interfaceVersion !== GENERATED_D1_RUNTIME_VERSION) {
    throw new TypeError("Generated D1 interface version is unsupported.");
  }
  if (
    descriptor.artifactId !== contract.artifactId ||
    descriptor.contractVersion !== contract.contractVersion
  ) {
    throw new TypeError("Generated D1 descriptor does not match its D2 contract.");
  }
  if (!Number.isInteger(descriptor.scriptVersion) || descriptor.scriptVersion < 1) {
    throw new TypeError("Generated D1 script version is invalid.");
  }
}

export function createGeneratedD1Runtime(
  descriptor,
  {
    page,
    contract,
    evidenceSink = null,
    allowReadLikePost = () => false,
  },
) {
  validateDescriptor(descriptor, contract);
  const executor = createD3Executor({
    page,
    contract,
    mechanics: descriptor,
    evidenceSink,
    allowReadLikePost,
  });
  const fields = new Map(contract.fields.map((field) => [field.key, field]));
  return Object.freeze({
    artifactId: descriptor.artifactId,
    contractVersion: descriptor.contractVersion,
    scriptVersion: descriptor.scriptVersion,
    defaultInputs(stateKey) {
      const state = contract.states.find((item) => item.key === stateKey);
      if (!state) throw new TypeError(`Unknown D2 state "${stateKey}".`);
      return Object.fromEntries(
        state.fieldKeys
          .filter((key) => descriptor.allowedSyntheticFieldKeys.includes(key))
          .filter((key) => !descriptor.protectedFieldKeys.includes(key))
          .map((key) => [key, fields.get(key)?.testValue])
          .filter(([, value]) => value !== null && value !== undefined),
      );
    },
    probeChoice: (directive) => executor.probeChoice(directive),
    rebaseline: (url) => executor.toolbox.rebaseline(url),
    execute: (invocation) => executor.execute(invocation),
  });
}
