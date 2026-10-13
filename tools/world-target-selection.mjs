// Operator-chosen World target. This is configuration for GET-only evidence,
// not permission to place a spawn or deploy code. World and Newbieland isolated.
export const WORLD_TARGET = Object.freeze({
  server: 'world',
  shard: 'shard0',
  room: 'W37N11',
  x: 12,
  y: 13,
  spawnName: 'Spawn1',
  branch: 'chatgpt',
  knownRivalRooms: Object.freeze(['W35N11','W36N13']),
  sourceScoutingRun: 38153270573,
  decisionIssue: 172,
  operatorSelected: true,
  placementApproved: false,
  deploymentApproved: false
});
