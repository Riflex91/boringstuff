// O45 fail-closed legacy World mutation quarantine.
// This function deliberately has NO environment-variable bypass. A prior
// operator confirmation, github.sha, credential or GitHub ref by itself
// cannot authorize a mutation while the safe two-phase executor is missing.
// It protects *command entrypoints*, not imported helper functions; CI also
// forbids legacy workflow invocation from being treated as authorization.
const OPERATIONS = Object.freeze(new Set([
  'legacy-code-bootstrap',
  'legacy-inactive-restage',
  'legacy-separate-stage',
  'legacy-spawn-activation',
  'legacy-spawn-placement',
  'legacy-first-spawn',
  'legacy-direct-code-deploy'
]));

export function assertLegacyWorldMutationDisabled(operation) {
  if (typeof operation !== 'string' || !OPERATIONS.has(operation))
    throw new Error('O45_WORLD_MUTATION_HOLD_UNKNOWN_OPERATION');
  throw new Error('O45_WORLD_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR');
}
