import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const scoring=require('../game/expansion.marginal.score.shadow.js');
const candidates=require('../game/expansion.candidates.shadow.js');
const ready={authority:'SHADOW',status:'PLANNING_CANDIDATE',
  claimActionEnabled:false,availableClaimSlots:1};
function record(name,neighbors,options={}) {
  const mine=options.mine===true;
  const sources=options.sources??2;
  return {schemaVersion:1,roomName:name,
    observation:{lastSeenTick:options.lastSeen??1000,
      confidence:1,source:'visible-room'},
    classification:{roomStatus:'normal'},
    controller:{exists:true,my:mine,owner:mine?'Me':null,
      reservationOwner:null,level:mine?5:0},
    resources:{sourceCount:sources,
      sources:Array.from({length:sources},(_,i)=>({
        id:name+'-'+i,pos:{x:11+i,y:12,roomName:name}
      })),
      mineral:options.mineral?{type:options.mineral}:null},
    topology:{exits:neighbors.map(roomName=>({roomName}))},
    structures:{count:0,ownedByType:{}},
    threat:{hostileCreeps:0,lastHostileTick:options.hostile??null}};
}
const parent=record('E2N2',['E2N3','E3N2'],{mine:true,mineral:'H'});
const similar=record('E2N3',['E2N2'],{mineral:'H'});
const diverse=record('E3N2',['E2N2'],{mineral:'O'});
const parentState={room:{name:'E2N2',controller:{my:true}},
  spawn:{name:'First'},rcl:5,emergency:false,
  health:{status:'HEALTHY'},hostileCreeps:[],
  economyModel:{haulerCarryDeficit:0}};
const tick=1050;
const original=JSON.stringify({parent,similar,diverse,parentState});
const a=scoring.score(similar,parent,1,tick,ready);
const b=scoring.score(diverse,parent,1,tick,ready);
assert.equal(a.roomQuality,b.roomQuality,'equal verified local resources');
assert.equal(a.observed.mineralDiversity,false);
assert.equal(b.observed.mineralDiversity,true);
assert.equal(b.empireFit-a.empireFit,6,
  'known new mineral may improve relative empire fit');
assert.equal(b.total,b.roomQuality+b.empireFit);
assert.equal(b.status,'PARTIAL_ADVISORY');
assert.equal(b.authority,'SHADOW');
assert.equal(b.actionAuthority,'NONE');
assert.equal(b.readyForClaim,false);
for (const label of ['plannerQuality','defensePerimeter','remoteYield',
  'creepTravelPathCost','regionalDefenseExposure','terminalTopology',
  'incrementalCpuPerTick','supportOpportunityCost']) {
  assert.ok(b.unknownFactors.includes(label),
    'unknown economy input must not be assumed to be zero: '+label);
}
assert.equal(scoring.score(diverse,parent,2,tick,ready).empireFit,
  b.empireFit-15,'each additional observed room hop costs support geometry');
assert.equal(scoring.score(diverse,parent,1,1250,ready).roomQuality,
  b.roomQuality-3,'older but still valid intel ranks below newer intel');
const historic=record('E3N2',['E2N2'],{mineral:'O',hostile:10});
assert.equal(scoring.score(historic,parent,1,tick,ready).roomQuality,
  b.roomQuality-5,'bounded historic threat penalty is not a no-risk assertion');
const unknownParent=record('E2N2',['E3N2'],{mine:true});
const unknown=scoring.score(diverse,unknownParent,1,tick,ready);
assert.equal(unknown.observed.mineralDiversity,null);
assert.ok(unknown.unknownFactors.includes('mineralDiversity'));
assert.equal(unknown.empireFit,b.empireFit-6,
  'no mineral diversity bonus when parent evidence is absent');
assert.equal(scoring.score(diverse,{...parent,controller:{my:false}},
  1,tick,ready),null,'unowned parent is not an expansion budget source');
assert.equal(scoring.score(diverse,parent,0,tick,ready),null);
assert.equal(scoring.score(diverse,parent,4,tick,ready),null);
assert.equal(scoring.score(diverse,parent,1,600,ready),null);
assert.equal(scoring.score({...diverse,topology:{exits:[]}},
  parent,1,tick,ready),null);
assert.equal(scoring.score(diverse,parent,1,tick,
  {...ready,availableClaimSlots:0}),null);

const memory={bot:{worldIntel:{rooms:{
  E2N2:parent,E2N3:similar,E3N2:diverse
}}}};
const game={time:tick};
const advisory=candidates.evaluate(ready,[parentState],game,memory);
assert.equal(advisory.status,'ADVISORY_ONLY');
assert.equal(advisory.claimActionEnabled,false);
assert.equal(advisory.placementEnabled,false);
assert.equal(advisory.routeVerified,false);
assert.equal(advisory.topCandidates[0].roomName,'E3N2',
  'rank according to observed mineral diversity with equal local resources');
assert.equal(advisory.scoreModel,'observed-room-quality-empire-fit-v1');
assert.equal(advisory.topCandidates[0].roomQualityScore,b.roomQuality);
assert.equal(advisory.topCandidates[0].empireFitScore,b.empireFit);
assert.equal(advisory.topCandidates[0].reconScore,b.total);
assert.equal(advisory.topCandidates[0].marginalScoreEvidence.readyForClaim,false);
assert.deepEqual(candidates.evaluate(ready,[parentState],game,memory),advisory,
  'pure and deterministic ranking of cached intel');
assert.equal(JSON.stringify({parent,similar,diverse,parentState}),original,
  'passive marginal ranker never mutates inputs');
for (const name of ['expansion.marginal.score.shadow.js',
  'expansion.candidates.shadow.js']) {
  const source=fs.readFileSync(path.resolve(here,'../game',name),'utf8');
  for (const forbidden of ['.claimController(','.reserveController(',
    '.spawnCreep(','.createConstructionSite(']) {
    assert.equal(source.includes(forbidden),false,
      'I3 passive ranker must not issue gameplay intents: '+forbidden);
  }
}
console.log('I3 observed RoomQuality and EmpireFit partial advisory: PASS');
