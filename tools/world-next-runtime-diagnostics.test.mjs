import assert from 'node:assert/strict';
import {assessWorldRuntime} from './world-next-runtime-diagnostics.mjs';
import {WORLD_PROFILE} from './world-deployment-profile.mjs';
const good={me:{_id:'me'},branches:{list:[{branch:'chatgpt',activeWorld:true}]},status:{status:'normal'},room:{objects:[{type:'spawn',x:37,y:26,name:'Spawn1',user:'me',energy:300,energyCapacity:300},{type:'creep',user:'me',memory:{role:'harvester'}},{type:'controller',level:1,progress:100}]},memory:{data:JSON.stringify({deploymentId:'test-deployment',telemetryJournal:{events:[],snapshots:[]}})}};
const result=assessWorldRuntime(good,WORLD_PROFILE.branch);
assert.equal(assessWorldRuntime(good).ok,false,
 'staging-only default must reject active production branch');
assert.equal(WORLD_PROFILE.branch,'chatgpt');
assert.equal(result.ok,true);
assert.equal(result.activeBranch,WORLD_PROFILE.branch);
assert.equal(result.spawnVerified,true);
assert.equal(result.ownedCreepCount,1);
 // Missing GET evidence is unknown, not proof of zero creeps or missing Spawn.
 // This distinction matters when World is lost and the API returns partial data.
 for(const [label,patch] of [
   ['room GET missing',{room:{}}],
   ['owner missing',{me:null}],
   ['owner malformed',{me:{_id:{untrusted:true}}}]
 ]) {
   const unknown=assessWorldRuntime({...good,...patch},WORLD_PROFILE.branch);
   assert.equal(unknown.ok,false,label);
   assert.equal(unknown.ownedCreepCount,null,label+' count');
   assert.equal(unknown.ownedCreepRoles,null,label+' roles');
   assert.equal(unknown.spawnVerified,null,label+' spawn');
   assert.equal(unknown.currentRoomCrewRisk.status,'UNVERIFIED',label);
   assert.equal(unknown.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false,
     label+' must not claim empty crew');
   assert.equal(unknown.operationalReadiness.status,'HOLD',label);
   assert.equal(unknown.operationalReadiness.reasons.includes(
     'OWNED_PINNED_SPAWN_MISSING'),false,
     label+' must not claim missing Spawn from unverifiable GET');
 }
 // Authentication GET aliases are independent untrusted evidence. A
 // contradictory or malformed supplied id must not be silently ignored.
 for(const [label,me] of [
   ['conflicting aliases',{_id:'me',id:'another-user'}],
   ['numeric secondary alias',{_id:'me',id:42}],
   ['null secondary alias',{_id:'me',id:null}],
   ['blank secondary alias',{_id:'me',id:'   '}],
   ['malformed primary alias',{_id:{bad:true},id:'me'}]
 ]) {
   const unverified=assessWorldRuntime({...good,me},WORLD_PROFILE.branch);
   assert.equal(unverified.ok,false,label);
   assert.ok(unverified.failures.includes('AUTH_UNVERIFIED'),label);
   assert.equal(unverified.spawnVerified,null,label);
   assert.equal(unverified.ownedCreepCount,null,label);
   assert.equal(unverified.ownedCreepRoles,null,label);
   assert.equal(unverified.currentRoomCrewRisk.status,'UNVERIFIED',label);
   assert.equal(unverified.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),
     false,label);
   assert.equal(unverified.operationalReadiness.status,'HOLD',label);
   assert.equal(unverified.operationalReadiness.executionAuthority,false,label);
 }
 // Matching aliases and legacy single-id GET responses remain observable.
 for(const me of [{_id:'me',id:'me'},{id:'me'}]) {
   const verified=assessWorldRuntime({...good,me},WORLD_PROFILE.branch);
   assert.equal(verified.ok,true);
   assert.equal(verified.spawnVerified,true);
   assert.equal(verified.ownedCreepCount,1);
   assert.equal(verified.failures.includes('AUTH_UNVERIFIED'),false);
 }
 const validEmpty=assessWorldRuntime({...good,room:{objects:
   good.room.objects.filter(o=>o.type!=='creep')
 }},WORLD_PROFILE.branch);
 assert.equal(validEmpty.spawnVerified,true);
 assert.equal(validEmpty.ownedCreepCount,0);
 assert.ok(validEmpty.warnings.includes('NO_OWNED_CREEPS_OBSERVED'));
 assert.equal(Object.getPrototypeOf(validEmpty.ownedCreepRoles),null);
 const validMissingSpawn=assessWorldRuntime({...good,room:{objects:
   good.room.objects.filter(o=>o.type!=='spawn')
 }},WORLD_PROFILE.branch);
 assert.equal(validMissingSpawn.spawnVerified,false);
 assert.equal(validMissingSpawn.ownedCreepCount,1);
 assert.equal(validMissingSpawn.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false);
 assert.ok(validMissingSpawn.operationalReadiness.reasons.includes(
   'OWNED_PINNED_SPAWN_MISSING'));

// A room GET array containing malformed entries is not a complete census.
// Do not silently ignore them and claim a missing Spawn or zero owned creeps.
for(const [label,badObject] of [
  ['null room entry',null],
  ['numeric room entry',7],
  ['string room entry','creep'],
  ['nested array room entry',[]]
]) {
  const malformedRoom=assessWorldRuntime({...good,room:{objects:[
    ...good.room.objects,badObject
  ]}},WORLD_PROFILE.branch);
  assert.equal(malformedRoom.ok,false,label);
  assert.ok(malformedRoom.failures.includes('ROOM_OBJECTS_MALFORMED'),label);
  assert.equal(malformedRoom.failures.includes('ROOM_OBJECTS_UNAVAILABLE'),false,label);
  assert.equal(malformedRoom.failures.includes('OWNED_PINNED_SPAWN_MISSING'),
    false,label+' must not claim absent Spawn');
  assert.equal(malformedRoom.spawnVerified,null,label);
  assert.equal(malformedRoom.ownedCreepCount,null,label);
  assert.equal(malformedRoom.ownedCreepRoles,null,label);
  assert.equal(malformedRoom.controllerLevel,null,label);
  assert.equal(malformedRoom.controllerProgress,null,label);
  assert.equal(malformedRoom.currentRoomCrewRisk.status,'UNVERIFIED',label);
  assert.equal(malformedRoom.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),
    false,label);
  assert.equal(malformedRoom.operationalReadiness.status,'HOLD',label);
  assert.equal(malformedRoom.operationalReadiness.executionAuthority,false,label);
}

// Opaque object entries without either a type or structureType are not
// trustworthy room evidence. Do not infer a missing Spawn, zero owned creeps,
// or controller progress by silently dropping an untyped GET object.
for(const [label,opaque] of [
  ['missing discriminator',{}],
  ['null type',{type:null}],
  ['numeric type',{type:42}],
  ['blank type',{type:'   '}],
  ['malformed structureType',{structureType:{untrusted:true}}]
]) {
  const unknown=assessWorldRuntime({...good,room:{objects:[
    ...good.room.objects,opaque
  ]}},WORLD_PROFILE.branch);
  assert.equal(unknown.ok,false,label);
  assert.ok(unknown.failures.includes('ROOM_OBJECTS_MALFORMED'),label);
  assert.equal(unknown.spawnVerified,null,label);
  assert.equal(unknown.ownedCreepCount,null,label);
  assert.equal(unknown.ownedCreepRoles,null,label);
  assert.equal(unknown.controllerLevel,null,label);
  assert.equal(unknown.controllerProgress,null,label);
  assert.equal(unknown.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false,label);
  assert.equal(unknown.operationalReadiness.status,'HOLD',label);
  assert.equal(unknown.operationalReadiness.executionAuthority,false,label);
}
// A valid secondary discriminator cannot sanitize a malformed supplied
// primary discriminator (or vice versa). An incomplete GET census must
// never claim a missing pinned Spawn or an empty owned crew.
for(const [label,badObject] of [
  ['numeric type with valid structureType',{type:42,structureType:'spawn'}],
  ['null type with valid structureType',{type:null,structureType:'spawn'}],
  ['blank type with valid structureType',{type:'  ',structureType:'spawn'}],
  ['array type with valid structureType',{type:[],structureType:'spawn'}],
  ['numeric structureType with valid type',{type:'spawn',structureType:42}],
  ['null structureType with valid type',{type:'spawn',structureType:null}],
  ['blank structureType with valid type',{type:'spawn',structureType:'  '}],
  ['array structureType with valid type',{type:'spawn',structureType:[]}]
]) {
  const invalid=assessWorldRuntime({...good,room:{objects:[
    ...good.room.objects,badObject
  ]}},WORLD_PROFILE.branch);
  assert.equal(invalid.ok,false,label);
  assert.ok(invalid.failures.includes('ROOM_OBJECTS_MALFORMED'),label);
  assert.equal(invalid.spawnVerified,null,label);
  assert.equal(invalid.ownedCreepCount,null,label);
  assert.equal(invalid.ownedCreepRoles,null,label);
  assert.equal(invalid.controllerLevel,null,label);
  assert.equal(invalid.controllerProgress,null,label);
  assert.equal(invalid.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false,label);
  assert.equal(invalid.failures.includes('OWNED_PINNED_SPAWN_MISSING'),false,label);
  assert.equal(invalid.currentRoomCrewRisk.status,'UNVERIFIED',label);
  assert.equal(invalid.operationalReadiness.status,'HOLD',label);
  assert.equal(invalid.operationalReadiness.executionAuthority,false,label);
}
// Older GET shapes may use structureType instead of type. Do not turn a
// recognizable Spawn into an opaque object or manufacture a missing Spawn.
const structureOnlySpawn=assessWorldRuntime({...good,room:{objects:[
  {structureType:'spawn',x:37,y:26,name:'Spawn1',user:'me',
    energy:300,energyCapacity:300},...good.room.objects.slice(1)
]}},WORLD_PROFILE.branch);
assert.equal(structureOnlySpawn.ok,true);
assert.equal(structureOnlySpawn.spawnVerified,true);
assert.equal(structureOnlySpawn.ownedCreepCount,1);
assert.equal(structureOnlySpawn.operationalReadiness.status,'UNVERIFIED');
// Unknown future object types are distinguishable from missing type evidence.
const futureType=assessWorldRuntime({...good,room:{objects:[
  ...good.room.objects,{type:'future-object'}
]}},WORLD_PROFILE.branch);
assert.equal(futureType.ok,true);
assert.equal(futureType.ownedCreepCount,1);

// Contradictory explicit type aliases make the entire GET room census
// untrustworthy: one object must not count as both a Spawn and a creep.
for(const [label,object] of [
  ['creep versus spawn',{type:'creep',structureType:'spawn',
    x:37,y:26,name:'Spawn1',user:'me'}],
  ['controller versus spawn',{type:'controller',structureType:'spawn',
    x:37,y:26,name:'Spawn1',user:'me'}],
  ['spawn versus controller',{type:'spawn',structureType:'controller',
    x:37,y:26,name:'Spawn1',user:'me'}]
]) {
  const conflict=assessWorldRuntime({...good,room:{objects:[
    ...good.room.objects,object
  ]}},WORLD_PROFILE.branch);
  assert.equal(conflict.ok,false,label);
  assert.ok(conflict.failures.includes('ROOM_OBJECTS_MALFORMED'),label);
  assert.equal(conflict.spawnVerified,null,label);
  assert.equal(conflict.ownedCreepCount,null,label);
  assert.equal(conflict.ownedCreepRoles,null,label);
  assert.equal(conflict.controllerLevel,null,label);
  assert.equal(conflict.controllerProgress,null,label);
  assert.equal(conflict.currentRoomCrewRisk.status,'UNVERIFIED',label);
  assert.equal(conflict.operationalReadiness.status,'HOLD',label);
  assert.equal(conflict.operationalReadiness.executionAuthority,false,label);
}
// Equal aliases and generic structure wrappers remain valid GET shapes.
for(const alias of [
  {type:'spawn',structureType:'spawn'},
  {type:'structure',structureType:'spawn'}
]) {
  const compatible=assessWorldRuntime({...good,room:{objects:
    good.room.objects.map(o=>o.type==='spawn'?{...o,...alias}:o)
  }},WORLD_PROFILE.branch);
  assert.equal(compatible.ok,true);
  assert.equal(compatible.spawnVerified,true);
  assert.equal(compatible.ownedCreepCount,1);
  assert.equal(compatible.operationalReadiness.status,'UNVERIFIED');
}

// Owner IDs in GET room objects must be verified strings. Numeric IDs
// must not be coerced to authenticated IDs, and malformed owner evidence
// cannot establish an absent owned Spawn or a zero-creep room.
const numericOwnerRoom={...good,me:{_id:'42'},room:{objects:
  good.room.objects.map(o=>o.type==='spawn'||o.type==='creep'?
    {...o,user:42}:o)
}};
const numericOwner=assessWorldRuntime(numericOwnerRoom,WORLD_PROFILE.branch);
assert.equal(numericOwner.ok,false);
assert.equal(numericOwner.spawnVerified,null);
assert.equal(numericOwner.ownedCreepCount,null);
assert.equal(numericOwner.ownedCreepRoles,null);
assert.equal(numericOwner.spawnEnergyEvidence,'SPAWN_UNVERIFIED');
assert.ok(numericOwner.failures.includes('PINNED_SPAWN_OWNER_UNVERIFIED'));
assert.ok(numericOwner.failures.includes('ROOM_CREEP_OWNER_UNVERIFIED'));
assert.equal(numericOwner.failures.includes('OWNED_PINNED_SPAWN_MISSING'),false);
assert.equal(numericOwner.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false);
assert.equal(numericOwner.currentRoomCrewRisk.status,'UNVERIFIED');
assert.equal(numericOwner.operationalReadiness.status,'HOLD');
assert.equal(numericOwner.operationalReadiness.executionAuthority,false);
const malformedCreep=assessWorldRuntime({...good,room:{objects:
  good.room.objects.map(o=>o.type==='creep'?{...o,user:null}:o)
}},WORLD_PROFILE.branch);
assert.equal(malformedCreep.spawnVerified,true);
assert.equal(malformedCreep.ownedCreepCount,null);
assert.equal(malformedCreep.ownedCreepRoles,null);
assert.ok(malformedCreep.failures.includes('ROOM_CREEP_OWNER_UNVERIFIED'));
assert.equal(malformedCreep.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false);
// A blank GET identity is no more trustworthy than a numeric owner ID.
// Do not mistake a malformed Spawn/creep owner for confirmed absence.
for(const [label,blank] of [['empty',''],['whitespace','  ']]) {
  const unknownAuth=assessWorldRuntime({...good,me:{_id:blank}},
    WORLD_PROFILE.branch);
  assert.ok(unknownAuth.failures.includes('AUTH_UNVERIFIED'),label);
  assert.equal(unknownAuth.spawnVerified,null,label);
  assert.equal(unknownAuth.ownedCreepCount,null,label);
  assert.equal(unknownAuth.operationalReadiness.status,'HOLD',label);
  const unknownSpawn=assessWorldRuntime({...good,room:{objects:
    good.room.objects.map(o=>o.type==='spawn'?{...o,user:blank}:o)
  }},WORLD_PROFILE.branch);
  assert.ok(unknownSpawn.failures.includes('PINNED_SPAWN_OWNER_UNVERIFIED'),label);
  assert.equal(unknownSpawn.spawnVerified,null,label);
  assert.equal(unknownSpawn.ownedCreepCount,1,label);
  assert.equal(unknownSpawn.failures.includes('OWNED_PINNED_SPAWN_MISSING'),
    false,label);
  assert.equal(unknownSpawn.operationalReadiness.status,'HOLD',label);
  const unknownCrew=assessWorldRuntime({...good,room:{objects:
    good.room.objects.map(o=>o.type==='creep'?{...o,user:blank}:o)
  }},WORLD_PROFILE.branch);
  assert.ok(unknownCrew.failures.includes('ROOM_CREEP_OWNER_UNVERIFIED'),label);
  assert.equal(unknownCrew.spawnVerified,true,label);
  assert.equal(unknownCrew.ownedCreepCount,null,label);
  assert.equal(unknownCrew.ownedCreepRoles,null,label);
  assert.equal(unknownCrew.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),
    false,label);
  assert.equal(unknownCrew.operationalReadiness.status,'HOLD',label);
  assert.equal(unknownCrew.operationalReadiness.executionAuthority,false,label);
}
const stringOwner=assessWorldRuntime({...numericOwnerRoom,room:{objects:
  numericOwnerRoom.room.objects.map(o=>o.type==='spawn'||o.type==='creep'?
    {...o,user:'42'}:o)
}},WORLD_PROFILE.branch);
assert.equal(stringOwner.ok,true);
assert.equal(stringOwner.spawnVerified,true);
assert.equal(stringOwner.ownedCreepCount,1);
assert.equal(stringOwner.operationalReadiness.status,'UNVERIFIED');

// A duplicate pinned Spawn GET is ambiguous even when one object has the
// authenticated owner. No first-match energy/spawning or builder evidence
// may escape from contradictory objects at the same pinned coordinates.
for(const [label,duplicate] of [
  ['same-owner',{...good.room.objects[0],energy:200,spawning:{name:'x'}}],
  ['foreign-owner',{...good.room.objects[0],user:'other',energy:1}],
  ['malformed-owner',{...good.room.objects[0],user:42,energy:1}]
]) {
  const ambiguous=assessWorldRuntime({...good,room:{objects:[
    ...good.room.objects,duplicate
  ]}},WORLD_PROFILE.branch);
  assert.equal(ambiguous.ok,false,label);
  assert.ok(ambiguous.failures.includes('PINNED_SPAWN_AMBIGUOUS'),label);
  assert.equal(ambiguous.spawnVerified,null,label);
  assert.equal(ambiguous.spawnEnergy,null,label);
  assert.equal(ambiguous.spawnEnergyCapacity,null,label);
  assert.equal(ambiguous.spawnSpawning,null,label);
  assert.equal(ambiguous.spawnEnergyEvidence,'SPAWN_UNVERIFIED',label);
  assert.equal(ambiguous.spawnEnergyCapacityEvidence,'SPAWN_UNVERIFIED',label);
  assert.equal(ambiguous.currentRoomCrewRisk.status,'UNVERIFIED',label);
  assert.equal(ambiguous.operationalReadiness.status,'HOLD',label);
  assert.ok(ambiguous.operationalReadiness.reasons.includes(
    'PINNED_SPAWN_AMBIGUOUS'),label);
  assert.equal(ambiguous.operationalReadiness.executionAuthority,false,label);
  assert.equal(ambiguous.failures.includes('OWNED_PINNED_SPAWN_MISSING'),
    false,label+' ambiguous is not missing');
}


// GET creep memory may contain inherited object property names. Counting
// must preserve those literal labels without prototype pollution or coercion.
const reservedRoles=assessWorldRuntime({...good,room:{objects:[
  ...good.room.objects,
  {type:'creep',user:'me',memory:{role:'constructor'}},
  {type:'creep',user:'me',memory:{role:'__proto__'}},
  {type:'creep',user:'me',memory:{role:'__proto__'}},
  {type:'creep',user:'me',memory:{role:''}}
]}},WORLD_PROFILE.branch);
assert.equal(reservedRoles.ownedCreepCount,5);
assert.equal(Object.getPrototypeOf(reservedRoles.ownedCreepRoles),null);
assert.equal(reservedRoles.ownedCreepRoles.harvester,1);
assert.equal(reservedRoles.ownedCreepRoles.constructor,1);
assert.equal(reservedRoles.ownedCreepRoles.__proto__,2);
assert.equal(Object.hasOwn(reservedRoles.ownedCreepRoles,''),false);
assert.equal(JSON.parse(JSON.stringify(reservedRoles.ownedCreepRoles)).__proto__,2);
assert.equal(result.spawnEnergy,300);
// Contradictory GET values cannot establish spendable Spawn energy. A
// missing capacity is unknown, not proof of a capacity violation.
const impossibleEnergy=assessWorldRuntime({...good,room:{objects:
  good.room.objects.map(o=>o.type==='spawn'?
    {...o,energy:301,energyCapacity:300}:o)
}},WORLD_PROFILE.branch);
assert.equal(impossibleEnergy.ok,true,'GET itself can still succeed');
assert.equal(impossibleEnergy.spawnEnergy,null,
  'energy above observed capacity is not valid spendable evidence');
assert.equal(impossibleEnergy.spawnEnergyCapacity,300);
assert.ok(impossibleEnergy.warnings.includes('SPAWN_ENERGY_EXCEEDS_CAPACITY'));
assert.equal(impossibleEnergy.operationalReadiness.status,'HOLD',
  'contradictory GET evidence must fail closed without claiming a deploy pass');
assert.ok(impossibleEnergy.operationalReadiness.reasons.includes(
  'SPAWN_ENERGY_EXCEEDS_CAPACITY'));
assert.equal(impossibleEnergy.operationalReadiness.executionAuthority,false);
const capacityUnknown=assessWorldRuntime({...good,room:{objects:
  good.room.objects.map(o=>o.type==='spawn'?
    {...o,energy:301,energyCapacity:null}:o)
}},WORLD_PROFILE.branch);
assert.equal(capacityUnknown.spawnEnergy,301);
assert.equal(capacityUnknown.spawnEnergyCapacity,null);
assert.equal(capacityUnknown.warnings.includes('SPAWN_ENERGY_EXCEEDS_CAPACITY'),
  false,'unknown capacity must not invent a contradiction');
assert.equal(capacityUnknown.operationalReadiness.status,'UNVERIFIED',
  'unknown capacity is not evidence of a contradiction');
assert.equal(result.warnings.includes('SPAWN_ENERGY_EXCEEDS_CAPACITY'),false);
// Null is not zero, and absent GET properties are not malformed values.
// Expose the provenance of non-spendable Spawn energy without claiming a
// spawn action, live recovery or deployment authority.
assert.equal(result.spawnEnergyEvidence,'VALID');
assert.equal(result.spawnEnergyCapacityEvidence,'VALID');
assert.equal(impossibleEnergy.spawnEnergyEvidence,'CONTRADICTORY');
assert.equal(impossibleEnergy.spawnEnergyCapacityEvidence,'VALID');
assert.equal(capacityUnknown.spawnEnergyEvidence,'VALID');
assert.equal(capacityUnknown.spawnEnergyCapacityEvidence,'EXPLICIT_NULL');
assert.equal(validMissingSpawn.spawnEnergyEvidence,'SPAWN_UNVERIFIED');
assert.equal(validMissingSpawn.spawnEnergyCapacityEvidence,'SPAWN_UNVERIFIED');
const withSpawnFields=modify=>assessWorldRuntime({...good,room:{objects:
  good.room.objects.map(o=>o.type==='spawn'?modify({...o}):o)
}},WORLD_PROFILE.branch);
const explicitNull=withSpawnFields(o=>({...o,energy:null,energyCapacity:null}));
assert.equal(explicitNull.spawnEnergy,null);
assert.equal(explicitNull.spawnEnergyEvidence,'EXPLICIT_NULL');
assert.equal(explicitNull.spawnEnergyCapacityEvidence,'EXPLICIT_NULL');
const absentFields=withSpawnFields(o=>{
  delete o.energy;
  delete o.energyCapacity;
  return o;
});
assert.equal(absentFields.spawnEnergy,null);
assert.equal(absentFields.spawnEnergyCapacity,null);
assert.equal(absentFields.spawnEnergyEvidence,'FIELD_ABSENT');
assert.equal(absentFields.spawnEnergyCapacityEvidence,'FIELD_ABSENT');
const malformedFields=withSpawnFields(o=>({...o,
  energy:'300',energyCapacity:false}));
assert.equal(malformedFields.spawnEnergyEvidence,'INVALID_VALUE');
assert.equal(malformedFields.spawnEnergyCapacityEvidence,'INVALID_VALUE');
assert.equal(malformedFields.spawnEnergy,null);
assert.equal(malformedFields.spawnEnergyCapacity,null);
assert.equal(malformedFields.operationalReadiness.executionAuthority,false);

assert.equal(result.controllerProgress,100);
// A room GET with duplicate controller objects cannot establish which
// level/progress is current. Fail closed without confusing ambiguity with
// the absence of a controller or granting execution authority.
const duplicateController=assessWorldRuntime({...good,room:{objects:[
  ...good.room.objects,{type:'controller',level:8,progress:9999}
]}},WORLD_PROFILE.branch);
assert.equal(duplicateController.ok,false);
assert.ok(duplicateController.failures.includes('CONTROLLER_GET_AMBIGUOUS'));
assert.equal(duplicateController.controllerLevel,null);
assert.equal(duplicateController.controllerProgress,null);
assert.equal(duplicateController.warnings.includes('CONTROLLER_NOT_OBSERVED'),false);
assert.equal(duplicateController.operationalReadiness.status,'HOLD');
assert.ok(duplicateController.operationalReadiness.reasons.includes(
  'CONTROLLER_GET_AMBIGUOUS'));
assert.equal(duplicateController.operationalReadiness.executionAuthority,false);
const absentController=assessWorldRuntime({...good,room:{objects:
  good.room.objects.filter(o=>o.type!=='controller')
}},WORLD_PROFILE.branch);
assert.equal(absentController.ok,true,'absent controller remains a GET warning');
assert.ok(absentController.warnings.includes('CONTROLLER_NOT_OBSERVED'));
assert.equal(absentController.controllerLevel,null);
assert.equal(absentController.controllerProgress,null);
assert.equal(absentController.operationalReadiness.executionAuthority,false);

// Controller level is untrusted GET evidence too. Negative, fractional,
// string, boolean and unsafe integer values must never be published as levels.
assert.equal(result.controllerLevel,1);
for(const [label,value] of [
  ['null',null],['missing',undefined],['string','1'],['boolean',true],
  ['negative',-1],['fraction',1.5],['unsafe',Number.MAX_SAFE_INTEGER+1]
]) {
  const malformed=assessWorldRuntime({...good,room:{objects:
    good.room.objects.map(o=>o.type==='controller'?{...o,level:value}:o)
  }},WORLD_PROFILE.branch);
  assert.equal(malformed.controllerLevel,null,label+' controller level');
  assert.equal(malformed.operationalReadiness.executionAuthority,false);
}
const zeroLevel=assessWorldRuntime({...good,room:{objects:
  good.room.objects.map(o=>o.type==='controller'?{...o,level:0}:o)
}},WORLD_PROFILE.branch);
assert.equal(zeroLevel.controllerLevel,0);

// Impossible or malformed supplied controller levels must fail closed.
// Progress from that same controller cannot be treated as valid evidence.
for(const [label,level] of [
  ['above Screeps maximum',9],
  ['very large level',Number.MAX_SAFE_INTEGER],
  ['negative level',-1],
  ['fractional level',2.5],
  ['null level',null],
  ['string level','5']
]) {
  const invalid=assessWorldRuntime({...good,room:{objects:
    good.room.objects.map(o=>o.type==='controller'?
      {...o,level,progress:123}:o)
  }},WORLD_PROFILE.branch);
  assert.equal(invalid.ok,false,label);
  assert.ok(invalid.failures.includes('CONTROLLER_LEVEL_INVALID'),label);
  assert.equal(invalid.controllerLevel,null,label);
  assert.equal(invalid.controllerProgress,null,label);
  assert.equal(invalid.operationalReadiness.status,'HOLD',label);
  assert.ok(invalid.operationalReadiness.reasons.includes(
    'CONTROLLER_LEVEL_INVALID'),label);
  assert.equal(invalid.operationalReadiness.executionAuthority,false,label);
}
const maxValidController=assessWorldRuntime({...good,room:{objects:
  good.room.objects.map(o=>o.type==='controller'?
    {...o,level:8,progress:0}:o)
}},WORLD_PROFILE.branch);
assert.equal(maxValidController.ok,true);
assert.equal(maxValidController.controllerLevel,8);
assert.equal(maxValidController.controllerProgress,0);
assert.equal(maxValidController.failures.includes('CONTROLLER_LEVEL_INVALID'),
  false);

// A supplied malformed controller progress is contradictory evidence, not
// merely an unobserved optional value. It must hold operational readiness.
for(const [label,progress] of [
  ['null',null],['undefined',undefined],['string','100'],
  ['boolean',false],['negative',-1],['fraction',1.25],
  ['unsafe integer',Number.MAX_SAFE_INTEGER+1]
]) {
  const invalid=assessWorldRuntime({...good,room:{objects:
    good.room.objects.map(o=>o.type==='controller'?
      {...o,progress}:o)
  }},WORLD_PROFILE.branch);
  assert.equal(invalid.ok,false,label);
  assert.ok(invalid.failures.includes('CONTROLLER_PROGRESS_INVALID'),label);
  assert.equal(invalid.controllerLevel,1,label+' valid level preserved');
  assert.equal(invalid.controllerProgress,null,label);
  assert.equal(invalid.operationalReadiness.status,'HOLD',label);
  assert.ok(invalid.operationalReadiness.reasons.includes(
    'CONTROLLER_PROGRESS_INVALID'),label);
  assert.equal(invalid.operationalReadiness.executionAuthority,false,label);
}
const missingControllerProgress=assessWorldRuntime({...good,room:{objects:
  good.room.objects.map(o=>{
    if(o.type!=='controller')return o;
    const copy={...o};delete copy.progress;return copy;
  })
}},WORLD_PROFILE.branch);
assert.equal(missingControllerProgress.ok,true,
  'absent optional progress is not a malformed supplied value');
assert.equal(missingControllerProgress.controllerLevel,1);
assert.equal(missingControllerProgress.controllerProgress,null);
assert.equal(missingControllerProgress.failures.includes(
  'CONTROLLER_PROGRESS_INVALID'),false);
for(const progress of [0,Number.MAX_SAFE_INTEGER]) {
  const valid=assessWorldRuntime({...good,room:{objects:
    good.room.objects.map(o=>o.type==='controller'?
      {...o,progress}:o)
  }},WORLD_PROFILE.branch);
  assert.equal(valid.ok,true,'safe integer controller progress remains valid');
  assert.equal(valid.controllerProgress,progress);
  assert.equal(valid.failures.includes('CONTROLLER_PROGRESS_INVALID'),false);
}

// World GET values are untrusted observations: null, strings, booleans,
// negative values and fractions cannot be converted into fabricated energy
// or controller progress. A genuine numeric zero remains observable.
for(const [label,value] of [
  ['null',null],['missing',undefined],['numeric-string','300'],
  ['boolean',false],['negative',-1],['fraction',0.5]
]) {
  const malformed=assessWorldRuntime({...good,room:{objects:
    good.room.objects.map(o=>o.type==='spawn'?
      {...o,energy:value,energyCapacity:value}:
      o.type==='controller'?{...o,progress:value}:o)
  }},WORLD_PROFILE.branch);
  assert.equal(malformed.spawnEnergy,null,label+' spawn energy');
  assert.equal(malformed.spawnEnergyCapacity,null,label+' spawn capacity');
  assert.equal(malformed.controllerProgress,null,label+' controller progress');
  assert.equal(malformed.operationalReadiness.executionAuthority,false);
}
const zero=assessWorldRuntime({...good,room:{objects:
  good.room.objects.map(o=>o.type==='spawn'?
    {...o,energy:0,energyCapacity:0}:
    o.type==='controller'?{...o,progress:0}:o)
}},WORLD_PROFILE.branch);
assert.equal(zero.spawnEnergy,0);
assert.equal(zero.spawnEnergyCapacity,0);
assert.equal(zero.controllerProgress,0);
assert.equal(result.recoveryEvidence.availability,'OBSERVED_IN_BOT_MEMORY');
assert.equal(result.recoveryEvidence.observedEventCount,0);
assert.equal(result.recoveryEvidence.observationScope,'RETAINED_EVENTS_AND_BOUNDED_MISSION_HISTORY_ONLY');
assert.equal(assessWorldRuntime({...good,memory:null},WORLD_PROFILE.branch).recoveryEvidence.availability,'UNKNOWN');
assert.ok(assessWorldRuntime({...good,memory:null}).warnings.includes('RECOVERY_MEMORY_UNVERIFIED'));

// Failed GET prerequisites must be reflected in the operational HOLD gate,
// not merely in result.ok. Reasons remain deduplicated and non-authoritative.
for(const [patch,expectedReason] of [
  [{room:{objects:[]}},'OWNED_PINNED_SPAWN_MISSING'],
  [{room:{}},'ROOM_OBJECTS_UNAVAILABLE'],
  [{branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]}},
    'EXPECTED_BRANCH_NOT_ACTIVE'],
  [{status:{status:'empty'}},'WORLD_STATUS_INVALID'],
  [{me:null},'AUTH_UNVERIFIED'],
  [{me:{_id:'other'}},'OWNED_PINNED_SPAWN_MISSING']
]) {
  const invalid=assessWorldRuntime({...good,...patch},WORLD_PROFILE.branch);
  assert.equal(invalid.ok,false,expectedReason+' must fail inspection');
  assert.equal(invalid.operationalReadiness.status,'HOLD',expectedReason);
  assert.ok(invalid.operationalReadiness.reasons.includes(expectedReason));
  assert.equal(invalid.operationalReadiness.executionAuthority,false);
  assert.equal(new Set(invalid.operationalReadiness.reasons).size,
    invalid.operationalReadiness.reasons.length,
    'operational HOLD reasons must not be duplicated');
}
// World can be LOST while the pinned spawn is still visible to room GET.
// A successful read-only inspection must never imply deployment readiness.
assert.deepEqual(result.operationalReadiness,{
  status:'UNVERIFIED',reasons:[],
  evidenceType:'CURRENT_GET_ONLY_STATUS_AND_ROOM_OBJECTS',
  executionAuthority:false
});
const lost=assessWorldRuntime({...good,status:{status:'lost'}},WORLD_PROFILE.branch);
assert.equal(lost.ok,true,'GET-only evidence collection can succeed during loss');
assert.equal(lost.worldStatus,'lost');
assert.equal(lost.spawnVerified,true);
assert.deepEqual(lost.operationalReadiness.reasons,['WORLD_STATUS_NOT_NORMAL']);
assert.equal(lost.operationalReadiness.status,'HOLD');
assert.equal(lost.operationalReadiness.executionAuthority,false);
const missingSpawn=assessWorldRuntime({...good,
  room:{objects:good.room.objects.slice(1)}},WORLD_PROFILE.branch);
assert.equal(missingSpawn.ok,false);
assert.ok(missingSpawn.operationalReadiness.reasons.includes(
  'OWNED_PINNED_SPAWN_MISSING'));
assert.equal(missingSpawn.operationalReadiness.status,'HOLD');
// Retained STATUS_SNAPSHOT is historical, never a current spawn-state claim.
const retainedSpawnLoss={data:JSON.stringify({
  deploymentId:'test-deployment',
  telemetryJournal:{events:[],snapshots:[{
    c:'STATUS_SNAPSHOT',t:100,x:{
      expansionReadiness:{status:'HOLD',reasons:['NO_HEALTHY_SUPPORTING_PARENT']},
      rooms:{W37S79:{health:{status:'DEGRADED',
        reasons:['SPAWN_MISSING']}}}
    }
  }]}
})};
const historical=assessWorldRuntime({...good,memory:retainedSpawnLoss},
  WORLD_PROFILE.branch);
assert.equal(historical.ok,true);
assert.equal(historical.operationalReadiness.status,'UNVERIFIED',
  'historical spawn loss must not override a current normal status');
assert.ok(historical.warnings.includes('RETAINED_SNAPSHOT_SPAWN_MISSING'));
const lostWithHistory=assessWorldRuntime({...good,status:{status:'lost'},
  memory:retainedSpawnLoss},WORLD_PROFILE.branch);
assert.equal(lostWithHistory.operationalReadiness.status,'HOLD');
assert.ok(lostWithHistory.warnings.includes('RETAINED_SNAPSHOT_SPAWN_MISSING'));
assert.equal(lostWithHistory.operationalReadiness.executionAuthority,false);

// R1 site intent is not a completed Spawn, and WORK/CARRY/MOVE upgraders
// are not proof that a builder executes the site. Historical risk only.
const stalledMemory={data:JSON.stringify({
  deploymentId:'test-deployment',
  telemetryJournal:{
    events:[{c:'R1_OWNED_SPAWN_REBUILD_SITE_INTENT',t:175,
      x:{room:'W37S79',siteIntentAccepted:true}}],
    snapshots:[{c:'STATUS_SNAPSHOT',t:200,x:{
      expansionReadiness:{status:'HOLD',reasons:[]},
      rooms:{W37S79:{
        health:{status:'DEGRADED',reasons:['CONSTRUCTION_STALLED','SPAWN_MISSING']},
        creeps:{upgrader:2},constructionSites:15,
        economyModel:{dedicatedHarvestCapacityPerTick:0}
      }}
    }}]
  }
})};
const stalled=assessWorldRuntime({...good,status:{status:'lost'},
  memory:stalledMemory},WORLD_PROFILE.branch);
assert.equal(stalled.recoveryConstructionRisk.status,'POTENTIAL_STALL');
assert.equal(stalled.recoveryConstructionRisk.lastSnapshotTick,200);
assert.equal(stalled.recoveryConstructionRisk.lastSiteIntentTick,175);
assert.equal(stalled.recoveryConstructionRisk.currentBuilderAvailability,'UNVERIFIED');
assert.equal(stalled.recoveryConstructionRisk.executionAuthority,false);
assert.ok(stalled.warnings.includes('RETAINED_RECOVERY_CONSTRUCTION_STALL_RISK'));
assert.equal(stalled.operationalReadiness.status,'HOLD');
// Latest World GET can show zero owned creeps while the retained snapshot
// reports stalled construction and zero modeled harvest. This is a bounded
// cross-source risk, not a current construction observation or a build order.
const emptyPinnedRoom={...good,status:{status:'lost'},
  room:{objects:good.room.objects.filter(o=>o.type!=='creep')},
  memory:stalledMemory};
const emptyCrew=assessWorldRuntime(emptyPinnedRoom,WORLD_PROFILE.branch);
assert.equal(emptyCrew.ok,true,'valid GET-only inspection still succeeds');
assert.equal(emptyCrew.ownedCreepCount,0);
assert.equal(emptyCrew.currentRoomCrewRisk.status,'POTENTIAL_STALL');
assert.equal(emptyCrew.currentRoomCrewRisk.observedRoomCreepCount,0);
assert.equal(emptyCrew.currentRoomCrewRisk.lastSnapshotTick,200);
assert.equal(emptyCrew.currentRoomCrewRisk.executionAuthority,false);
assert.equal(emptyCrew.currentRoomCrewRisk.evidenceType,
  'PINNED_ROOM_GET_CREW_PLUS_RETAINED_STATUS_SNAPSHOT');
assert.ok(emptyCrew.warnings.includes('PINNED_ROOM_CREW_ABSENT_RETAINED_STALL'));
assert.equal(emptyCrew.operationalReadiness.status,'HOLD');
// The newer CRITICAL snapshot has no verified upgrader count; do not force
// the older upgrader-specific R1 risk, but preserve the independent GET risk.
const criticalMemory=JSON.parse(stalledMemory.data);
criticalMemory.telemetryJournal.snapshots[0].x.rooms.W37S79.health.status='CRITICAL';
criticalMemory.telemetryJournal.snapshots[0].x.rooms.W37S79.creeps={};
const criticalEmpty=assessWorldRuntime({...emptyPinnedRoom,
  memory:{data:JSON.stringify(criticalMemory)}},WORLD_PROFILE.branch);
assert.equal(criticalEmpty.recoveryConstructionRisk.status,'UNVERIFIED');
assert.equal(criticalEmpty.currentRoomCrewRisk.status,'POTENTIAL_STALL');
// No false empty-crew risk from a current creep, missing bot memory, failed
// room GET, absent pinned Spawn, unverified owner, or absent retained stall.
for(const [label,patch] of [
  ['creep-present',{room:good.room}],
  ['memory-unknown',{memory:null}],
  ['room-unavailable',{room:{}}],
  ['spawn-missing',{room:{objects:[{type:'controller',level:1}]}}],
  ['owner-unverified',{me:null}],
  ['no-stall',{memory:good.memory}]
]) {
  const observed=assessWorldRuntime({...emptyPinnedRoom,...patch},
    WORLD_PROFILE.branch);
  assert.equal(observed.currentRoomCrewRisk.status,'UNVERIFIED',label);
  assert.equal(observed.currentRoomCrewRisk.executionAuthority,false,label);
  assert.equal(observed.warnings.includes('PINNED_ROOM_CREW_ABSENT_RETAINED_STALL'),
    false,label);
}
assert.equal(assessWorldRuntime({...emptyPinnedRoom,room:{}},
  WORLD_PROFILE.branch).currentRoomCrewRisk.observedRoomCreepCount,null);
const noIntent=JSON.parse(stalledMemory.data);
noIntent.telemetryJournal.events=[];
const noIntentResult=assessWorldRuntime({...good,
  memory:{data:JSON.stringify(noIntent)}},WORLD_PROFILE.branch);
assert.equal(noIntentResult.recoveryConstructionRisk.status,'UNVERIFIED');
const futureIntent=JSON.parse(stalledMemory.data);
futureIntent.telemetryJournal.events[0].t=225;
const future=assessWorldRuntime({...good,
  memory:{data:JSON.stringify(futureIntent)}},WORLD_PROFILE.branch);
assert.equal(future.recoveryConstructionRisk.status,'UNVERIFIED',
  'a post-snapshot intent cannot prove earlier construction stall');
const confirmed=JSON.parse(stalledMemory.data);
confirmed.telemetryJournal.events.push({
  c:'R1_OWNED_SPAWN_REBUILD_CONFIRMED',t:190,
  x:{room:'W37S79',oldSpawnId:'old',newSpawnId:'new',confirmedTick:190}
});
const rebuilt=assessWorldRuntime({...good,
  memory:{data:JSON.stringify(confirmed)}},WORLD_PROFILE.branch);
assert.equal(rebuilt.recoveryConstructionRisk.status,'UNVERIFIED',
  'a later confirmed rebuild supersedes retained site-intent risk');
// A valid confirmation event may be newer than the latest retained snapshot.
// It cannot retroactively settle the earlier construction-stall observation.
const postSnapshotConfirmation=JSON.parse(stalledMemory.data);
postSnapshotConfirmation.telemetryJournal.events.push({
  c:'R1_OWNED_SPAWN_REBUILD_CONFIRMED',t:225,
  x:{room:'W37S79',oldSpawnId:'old',newSpawnId:'new',confirmedTick:225}
});
const postSnapshot=assessWorldRuntime({...good,
  memory:{data:JSON.stringify(postSnapshotConfirmation)}},WORLD_PROFILE.branch);
assert.equal(postSnapshot.recoveryConstructionRisk.status,'POTENTIAL_STALL',
  'a post-snapshot confirmation cannot suppress retained R1 stall risk');
assert.ok(postSnapshot.warnings.includes('RETAINED_RECOVERY_CONSTRUCTION_STALL_RISK'));
const sameTickConfirmation=JSON.parse(stalledMemory.data);
sameTickConfirmation.telemetryJournal.events.push({
  c:'R1_OWNED_SPAWN_REBUILD_CONFIRMED',t:200,
  x:{room:'W37S79',oldSpawnId:'old',newSpawnId:'new',confirmedTick:200}
});
const atSnapshot=assessWorldRuntime({...good,
  memory:{data:JSON.stringify(sameTickConfirmation)}},WORLD_PROFILE.branch);
assert.equal(atSnapshot.recoveryConstructionRisk.status,'UNVERIFIED',
  'a valid confirmation at the snapshot tick supersedes the earlier intent');
assert.equal(result.recoveryConstructionRisk.status,'UNVERIFIED');

// Duplicate creep IDs or names in one GET response must not inflate the
// current crew census or imply productive recovery. No gameplay authority.
const crewBase=[
  {type:'creep',id:'creep-a',name:'Alice',user:'me',memory:{role:'harvester'}},
  {type:'creep',id:'creep-b',name:'Bob',user:'me',memory:{role:'worker'}}
];
for(const [label,creeps] of [
  ['duplicate ID',[
    crewBase[0],{...crewBase[1],id:'creep-a'}]],
  ['duplicate name',[
    crewBase[0],{...crewBase[1],name:'Alice'}]],
  ['duplicate foreign identity',[
    crewBase[0],{...crewBase[1],user:'someone-else',name:'Alice'}]],
  ['duplicate secondary id despite unique _id',[
    {...crewBase[0],_id:'primary-a',id:'shared'},
    {...crewBase[1],_id:'primary-b',id:'shared'}]],
  ['cross-field alias collision',[
    {...crewBase[0],_id:'shared',id:'first'},
    {...crewBase[1],id:'shared'}]],
  ['duplicate _id despite unique secondary id',[
    {...crewBase[0],_id:'shared',id:'first'},
    {...crewBase[1],_id:'shared',id:'second'}]]
]) {
  const duplicate=assessWorldRuntime({...good,room:{objects:[
    ...good.room.objects.filter(o=>o.type!=='creep'),...creeps
  ]}},WORLD_PROFILE.branch);
  assert.equal(duplicate.ok,false,label);
  assert.ok(duplicate.failures.includes('ROOM_CREEP_DUPLICATE_IDENTITY'),label);
  assert.equal(duplicate.ownedCreepCount,null,label+' count');
  assert.equal(duplicate.ownedCreepRoles,null,label+' roles');
  assert.equal(duplicate.currentRoomCrewRisk.status,'UNVERIFIED',label);
  assert.equal(duplicate.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),
    false,label);
  assert.equal(duplicate.operationalReadiness.status,'HOLD',label);
  assert.equal(duplicate.operationalReadiness.executionAuthority,false,label);
}
const uniqueCrew=assessWorldRuntime({...good,room:{objects:[
  ...good.room.objects.filter(o=>o.type!=='creep'),...crewBase
]}},WORLD_PROFILE.branch);
assert.equal(uniqueCrew.ok,true);
assert.equal(uniqueCrew.ownedCreepCount,2);
assert.equal(uniqueCrew.ownedCreepRoles.harvester,1);
assert.equal(uniqueCrew.ownedCreepRoles.worker,1);
assert.equal(uniqueCrew.operationalReadiness.status,'UNVERIFIED');
assert.equal(uniqueCrew.failures.includes('ROOM_CREEP_DUPLICATE_IDENTITY'),false);
// The same identifier exposed in both fields of one creep is not a
// duplicate. Distinct creeps with unique aliases remain countable.
const uniqueDualIds=assessWorldRuntime({...good,room:{objects:[
  ...good.room.objects.filter(o=>o.type!=='creep'),
  {...crewBase[0],_id:'creep-a'},
  {...crewBase[1],_id:'creep-b'}
]}},WORLD_PROFILE.branch);
assert.equal(uniqueDualIds.ok,true);
assert.equal(uniqueDualIds.ownedCreepCount,2);
assert.equal(uniqueDualIds.operationalReadiness.status,'UNVERIFIED');

console.log('W37S79 runtime diagnostics: PASS');

// A supplied but malformed creep identity cannot be silently skipped by
// duplicate detection. Unknown identity is not a verified crew census,
// including when the malformed creep belongs to a different owner.
for(const [label,patch] of [
  ['numeric _id',{_id:42}],
  ['object id',{id:{untrusted:true}}],
  ['null id',{id:null}],
  ['empty name',{name:''}],
  ['whitespace name',{name:'   '}],
  ['array name',{name:[]}]
]) {
  const invalid=assessWorldRuntime({...good,room:{objects:[
    ...good.room.objects.filter(o=>o.type!=='creep'),
    {...crewBase[0],...patch}
  ]}},WORLD_PROFILE.branch);
  assert.equal(invalid.ok,false,label);
  assert.ok(invalid.failures.includes('ROOM_CREEP_IDENTITY_UNVERIFIED'),label);
  assert.equal(invalid.ownedCreepCount,null,label);
  assert.equal(invalid.ownedCreepRoles,null,label);
  assert.equal(invalid.currentRoomCrewRisk.status,'UNVERIFIED',label);
  assert.equal(invalid.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false,label);
  assert.equal(invalid.operationalReadiness.status,'HOLD',label);
  assert.equal(invalid.operationalReadiness.executionAuthority,false,label);
}
const invalidForeignIdentity=assessWorldRuntime({...good,room:{objects:[
  ...good.room.objects.filter(o=>o.type!=='creep'),
  {...crewBase[0],user:'another-user',id:12}
]}},WORLD_PROFILE.branch);
assert.ok(invalidForeignIdentity.failures.includes('ROOM_CREEP_IDENTITY_UNVERIFIED'));
assert.equal(invalidForeignIdentity.ownedCreepCount,null);
// Absent optional IDs/names in older GET responses are not malformed.
const legacyIdentityAbsent=assessWorldRuntime({...good,room:{objects:[
  ...good.room.objects.filter(o=>o.type!=='creep'),
  {type:'creep',user:'me',memory:{role:'harvester'}}
]}},WORLD_PROFILE.branch);
assert.equal(legacyIdentityAbsent.ok,true);
assert.equal(legacyIdentityAbsent.ownedCreepCount,1);
assert.equal(legacyIdentityAbsent.ownedCreepRoles.harvester,1);
assert.equal(legacyIdentityAbsent.failures.includes('ROOM_CREEP_IDENTITY_UNVERIFIED'),false);
assert.equal(uniqueDualIds.failures.includes('ROOM_CREEP_IDENTITY_UNVERIFIED'),false);

// A valid structureType-only GET object cannot disappear from the creep
// census or controller observations merely because "type" is absent.
const aliasRoomBase=good.room.objects.filter(o=>o.type==='spawn');
const aliasCreep=assessWorldRuntime({...good,room:{objects:[
  ...aliasRoomBase,
  {structureType:'creep',id:'alias-creep',user:'me',
    memory:{role:'harvester'}},
  {type:'controller',level:5,progress:123}
]}},WORLD_PROFILE.branch);
assert.equal(aliasCreep.ok,true,'structureType-only creep GET aliases');
assert.equal(aliasCreep.ownedCreepCount,1);
assert.equal(aliasCreep.ownedCreepRoles.harvester,1);
assert.equal(aliasCreep.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false);
const aliasForeign=assessWorldRuntime({...good,room:{objects:[
  ...aliasRoomBase,{structureType:'creep',id:'foreign',user:'other'},
  {type:'controller',level:5}
]}},WORLD_PROFILE.branch);
assert.equal(aliasForeign.ok,true);
assert.equal(aliasForeign.ownedCreepCount,0,
  'valid foreign structureType-only creep is not owned');
const aliasBadOwner=assessWorldRuntime({...good,room:{objects:[
  ...aliasRoomBase,{structureType:'creep',id:'unknown',user:null}
]}},WORLD_PROFILE.branch);
assert.ok(aliasBadOwner.failures.includes('ROOM_CREEP_OWNER_UNVERIFIED'));
assert.equal(aliasBadOwner.ownedCreepCount,null);
assert.equal(aliasBadOwner.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false);
assert.equal(aliasBadOwner.operationalReadiness.status,'HOLD');
const aliasDuplicate=assessWorldRuntime({...good,room:{objects:[
  ...aliasRoomBase,
  {structureType:'creep',id:'duplicate',user:'me'},
  {type:'creep',id:'duplicate',user:'me'}
]}},WORLD_PROFILE.branch);
assert.ok(aliasDuplicate.failures.includes('ROOM_CREEP_DUPLICATE_IDENTITY'));
assert.equal(aliasDuplicate.ownedCreepCount,null);
assert.equal(aliasDuplicate.operationalReadiness.status,'HOLD');
const aliasController=assessWorldRuntime({...good,room:{objects:[
  ...aliasRoomBase,{structureType:'controller',level:5,progress:123}
]}},WORLD_PROFILE.branch);
assert.equal(aliasController.ok,true);
assert.equal(aliasController.controllerLevel,5);
assert.equal(aliasController.controllerProgress,123);
assert.equal(aliasController.warnings.includes('CONTROLLER_NOT_OBSERVED'),false);
const aliasControllerDuplicate=assessWorldRuntime({...good,room:{objects:[
  ...aliasRoomBase,
  {structureType:'controller',level:5},
  {type:'controller',level:6}
]}},WORLD_PROFILE.branch);
assert.ok(aliasControllerDuplicate.failures.includes('CONTROLLER_GET_AMBIGUOUS'));
assert.equal(aliasControllerDuplicate.controllerLevel,null);
assert.equal(aliasControllerDuplicate.operationalReadiness.status,'HOLD');
assert.equal(aliasControllerDuplicate.operationalReadiness.executionAuthority,false);
