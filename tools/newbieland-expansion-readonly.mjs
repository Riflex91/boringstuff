// Newbieland expansion diagnosis — authenticated GET-only game observation.
// No code upload, spawn, controller, memory, or branch mutation.
import { pathToFileURL } from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { parseBotMemory, summarizeExpansionEvidence } from './ci-deployment-guard.mjs';

const HOME = 'E8N1';
const BRANCH = 'chatgpt';
const goodTick = n => Number.isSafeInteger(n) && n >= 0 && n <= 2_000_000_000;

export function inspectNewbielandExpansion(reply, branches) {
  const active = Array.isArray(branches?.list)
    ? branches.list.filter(item => item?.activeWorld === true) : null;
  // A successful HTTP request alone does not prove that our expected branch
  // owns the active world. Fail closed on zero/ambiguous/mismatched branches.
  if (!active || active.length !== 1 || active[0].branch !== BRANCH)
    return { status: 'UNVERIFIED', reason: 'ACTIVE_BRANCH_NOT_VERIFIED',
      readOnly: true, homeRoom: HOME };

  const bot = parseBotMemory(reply);
  if (!bot) return { status: 'UNVERIFIED',
    reason: 'BOT_MEMORY_NOT_VERIFIABLE', readOnly: true, homeRoom: HOME };
  const journal = bot.telemetryJournal;
  const snapshots = Array.isArray(journal?.snapshots)
    ? journal.snapshots.filter(s => s?.c === 'STATUS_SNAPSHOT' &&
      goodTick(s.t)).sort((a,b) => b.t-a.t) : [];
  if (!snapshots.length)
    return { status: 'UNVERIFIED', reason: 'NO_RETAINED_STATUS_SNAPSHOT',
      readOnly: true, homeRoom: HOME };
  const latest=snapshots[0];
  // Never silently fall back to a previous valid snapshot when the newest
  // snapshot is incomplete: it would present an older support streak as now.
  const evidence=summarizeExpansionEvidence(latest, HOME);
  if (!evidence) return { status: 'UNVERIFIED',
    reason: 'LATEST_ROOM_STATUS_UNAVAILABLE',
    readOnly: true, homeRoom: HOME, snapshotTick: latest.t };
  const events=Array.isArray(journal?.events)?journal.events:[];
  const journalLatestTick=Math.max(latest.t,...events.filter(e=>goodTick(e?.t))
    .map(e=>e.t));
  const ageWithinRetainedJournal=journalLatestTick-latest.t;
  return {
    status:'OBSERVED_RETAINED', readOnly:true, homeRoom:HOME,
    snapshotTick:latest.t, journalLatestTick,
    snapshotLagWithinJournalTicks:ageWithinRetainedJournal,
    // This is not a server-current tick. Absence of journal events does not
    // prove fresh real-time observation.
    currentGameTickVerified:false,
    expansionEvidence:evidence
  };
}

async function main() {
  const api = await ScreepsHttpClient.fromConfig('newbieland');
  const branches = await api.userBranches();
  // Read memory only after verifying the intended active branch.
  const branchState = inspectNewbielandExpansion(null,branches);
  if (branchState.reason === 'ACTIVE_BRANCH_NOT_VERIFIED') {
    console.log('NEWBIELAND_EXPANSION_GET_ONLY '+JSON.stringify(branchState));
    process.exitCode=2;
    return;
  }
  const reply=await api.userMemory('bot');
  const result=inspectNewbielandExpansion(reply,branches);
  console.log('NEWBIELAND_EXPANSION_GET_ONLY '+JSON.stringify(result));
  if (result.status!=='OBSERVED_RETAINED') process.exitCode=2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(err=>{
    // Do not print full HTTP configuration, credentials or raw responses.
    console.error('NEWBIELAND_EXPANSION_GET_ONLY_FAILED',
      String(err?.code || 'API_READ_FAILED'));
    process.exitCode=1;
  });
