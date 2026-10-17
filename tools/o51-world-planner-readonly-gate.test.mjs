import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { assertWorldPlannerReadOnly, assertWorldScoutRoomArguments,
  WORLD_PLANNER_PLACE_HOLD } from './o51-world-planner-readonly-gate.mjs';

const expectHold=(args)=>assert.throws(
  ()=>assertWorldPlannerReadOnly(args),new RegExp(WORLD_PLANNER_PLACE_HOLD));
for(const arg of [
  {server:'world',place:true,rooms:['W37S79']},
  {server:'world',place:true},
  null,[],undefined
])expectHold(arg);
assert.equal(assertWorldPlannerReadOnly({server:'world',place:false}),undefined);
assert.equal(assertWorldPlannerReadOnly({server:'newbieland',place:true}),undefined);

for(const badRooms of [
  ['--place'],['W37S79','--place'],['--server','newbieland'],
  ['W37S79','W37S79\n--place'],['W37S79;--place'],
  ['W37S79','../../--place'],[],['X1N1'],[null],new Array(97).fill('W1N1')
]){
  assert.throws(()=>assertWorldScoutRoomArguments(badRooms),
    /O51_WORLD_SCOUT_ROOM_ARG_HOLD/);
}
assert.deepEqual(assertWorldScoutRoomArguments(['W37S79','E8N1']),['W37S79','E8N1']);

const tools=path.dirname(fileURLToPath(import.meta.url));
const temp=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP||os.tmpdir(),
  'o51-planner-no-write-'));
try{
  const cmd=spawnSync(process.execPath,[
    path.join(tools,'initial-spawn-planner.mjs'),'--server','world',
    '--place','W37S79'
  ],{cwd:tools,encoding:'utf8',timeout:5000,env:{
    PATH:process.env.PATH||'',SCREEPS_LOG_DIR:temp,
    SCREEPS_CONFIG:path.join(temp,'missing-config.json')
  }});
  assert.equal(cmd.status,1,'World --place CLI must abort');
  assert.match(cmd.stderr,/O51_WORLD_PLANNER_PLACEMENT_HOLD_NO_APPROVED_EXECUTOR/);
  assert.doesNotMatch(cmd.stdout,/Authenticated as|Placing initial spawn|Connecting using Screeps/);
  assert.equal(fs.existsSync(path.join(temp,'missing-config.json')),false);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log('O51 World planner --place pre-auth HOLD and scout room argv anti-injection: PASS');
