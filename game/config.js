'use strict';

module.exports = {
  VERSION: '0.3.0-shadow.7-node18',
  BOT_NAME: 'Autonomy',

  // Console logging. DEBUG is noisy; INFO is a good default.
  LOG_LEVEL: 'INFO',
  LOG_HEARTBEAT_INTERVAL: 25,
  STATUS_SNAPSHOT_INTERVAL: 100,
  LOG_MEMORY_LIMIT: 250,
  LOG_DEDUPE_TICKS: 10,
  LOG_SERIALIZE_DEPTH: 6,

  // Durable server-side telemetry journal. The collector may be offline; these
  // records remain in Screeps Memory and are replayed on the next connection.
  // A byte ceiling prevents observability from consuming unbounded Memory.
  TELEMETRY_JOURNAL_MAX_SNAPSHOTS: 512,
  TELEMETRY_JOURNAL_MAX_EVENTS: 1500,
  TELEMETRY_JOURNAL_MAX_BYTES: 700000,

  // Scheduler / CPU protection.
  CPU_BUCKET_CRITICAL: 1000,
  CPU_BUCKET_LOW: 3000,
  CPU_BUCKET_HEALTHY: 7000,
  PLANNER_INTERVAL: 50,
  INTEL_INTERVAL: 25,
  VISUALS: true,
  // Bound individual legacy PathFinder searches so a cache miss cannot consume
  // an entire tick's CPU budget. Same-room role movement should normally fit
  // well inside this ceiling and will retry on later ticks if incomplete.
  PATH_MAX_OPS: 200,

  // Economy tuning.
  UPGRADE_ENERGY_RESERVE: 600,
  REPAIR_WALL_TARGET_RCL_MULTIPLIER: 25000,
  MAX_BUILDERS: 3,
  MAX_UPGRADERS: 4,
  MAX_REPAIRERS: 2,
  SCOUTS_AFTER_RCL: 3,

  // v0.2.8: when a healthy RCL1 colony repeatedly caps its spawn energy,
  // convert the otherwise-idle spawn time into one additional upgrader.
  RCL1_SURPLUS_UPGRADERS: 2,
  RCL1_SURPLUS_STREAK_TICKS: 10,

  // Dedicated upgrader diagnostics. Warn only after a meaningful no-progress
  // interval so normal travel/harvest cycles do not generate noise.
  UPGRADER_STALL_TICKS: 150,



  // Phase 2A bootstrap logistics. Keep the first active control loop bounded:
  // one calculated hauler at early RCL, while workers retain a self-harvest
  // fallback if delivery does not arrive quickly enough.
  MAX_BOOTSTRAP_HAULERS: 3,
  // Phase 2B: grow mining capacity from measured WORK-part deficit, but keep
  // the early bootstrap bounded while containers and extensions are unfinished.
  MAX_BOOTSTRAP_HARVESTERS: 5,
  BOOTSTRAP_MINING_FLOOR_RATIO: 0.60,
  CONSUMER_HAULER_WAIT_TICKS: 12,

  // Conservative safety defaults. Turn on only after reviewing logs.
  AUTO_SAFE_MODE: false,
  ENABLE_REMOTE_MINING: false,

  // Construction planning is staged. Critical energy infrastructure is placed
  // first; roads are delayed until source containers/extensions are complete.
  ROAD_SITE_BUDGET_PER_PLAN: 4,
  MAX_CONSTRUCTION_SITES_PER_ROOM: 20,
  EARLY_RCL2_SITE_CAP: 8
};
