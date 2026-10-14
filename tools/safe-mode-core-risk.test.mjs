import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const configSource = fs.readFileSync(new URL('../game/config.js', import.meta.url), 'utf8');
const configContext = { module: { exports: {} } };
vm.runInNewContext(configSource, configContext);
assert.equal(configContext.module.exports.AUTO_SAFE_MODE,true,
  'guarded automatic safe mode must be enabled in actual runtime config');

const source = fs.readFileSync(new URL('../game/room.manager.js', import.meta.url), 'utf8');
const warnings = [];
const ctx = { module: { exports: {} },
  STRUCTURE_SPAWN: 'spawn', STRUCTURE_STORAGE: 'storage',
  STRUCTURE_TOWER: 'tower',
  require(name) {
    if (name === 'config') return configContext.module.exports;
    if (name === 'logger') return { warn(...args) { warnings.push(args); } };
    return {};
  } };
vm.runInNewContext(source, ctx);
const {safeModeDecision: decide, maybeSafeMode: attempt} = ctx.module.exports._test;
let activations = 0;
const controller = {my:true,safeModeAvailable:1,safeMode:0,
  activateSafeMode() { activations++; return 0; }};
const spawn = {id:'spawn',my:true,structureType:'spawn',hits:600,hitsMax:1000,
  pos:{x:10,y:10}};
const tower = {id:'tower',my:true,structureType:'tower',hits:300,hitsMax:1000,
  pos:{x:11,y:11}};
const enemy = (parts, range) => ({
  body: parts.map(type => typeof type === 'string'
    ? {type,hits:100} : type),
  pos:{ getRangeTo() { return range; } }
});
const state = {room:{name:'W1N1',controller},structures:[spawn],
  hostileCreeps:[enemy(['move'],1)]};

// No Safe Mode for scouts, inactive hostile parts, or opponents outside
// attack range, even if a previous battle left the core badly damaged.
assert.equal(decide(state),null,'scout must not consume safe mode');
state.hostileCreeps=[enemy(['attack'],4)];
assert.equal(decide(state),null,'distant melee threat must not consume safe mode');
state.hostileCreeps=[enemy(['attack'],1)];
assert.equal(decide(state).reason,'IMMINENT_CORE_ATTACK');
state.hostileCreeps=[enemy(['ranged_attack'],3)];
assert.equal(decide(state).reason,'IMMINENT_CORE_ATTACK');
spawn.hits=900;
assert.equal(decide(state),null,'healthy core must not consume safe mode early');
spawn.hits=300;
state.hostileCreeps=[enemy(['move'],1)];
assert.equal(decide(state),null,'historically damaged spawn and lone scout are not imminent loss');
state.hostileCreeps=[enemy(['attack'],4)];
assert.equal(decide(state),null,'historically damaged spawn and distant hostile are not imminent loss');
state.hostileCreeps=[enemy([{type:'attack',hits:0}],1)];
assert.equal(decide(state),null,'destroyed ATTACK parts have zero active threat');
state.hostileCreeps=[enemy(['ranged_attack'],3)];
assert.equal(decide(state).reason,'CRITICAL_CORE_DAMAGE');
spawn.hits=1000;
state.hostileCreeps=[enemy(Array(12).fill('attack'),1)];
assert.equal(decide(state).reason,'PREDICTED_CORE_LOSS',
  'observed lethal three-tick pressure should protect even a healthy spawn');
state.hostileCreeps=[enemy(Array(12).fill('attack'),2)];
assert.equal(decide(state),null,'strong melee force outside strike range cannot consume safe mode');

state.structures=[tower];
state.hostileCreeps=[enemy(['ranged_attack'],3)];
assert.equal(decide(state).structure.id,'tower',
  'an endangered own tower is a protected core asset');
tower.my=false;
assert.equal(decide(state),null,'non-owned structure must not cause safe mode');
tower.my=true;
state.structures=[spawn];

spawn.hits=600;
state.hostileCreeps=[enemy(['attack'],1)];
assert.equal(decide(state).reason,'IMMINENT_CORE_ATTACK');
attempt(state);
assert.equal(activations,1,'real activation occurs once for imminent core attack');
assert.equal(warnings.length,1);
assert.equal(warnings[0][0],'SAFE_MODE_ATTEMPT');
assert.equal(warnings[0][2].reason,'IMMINENT_CORE_ATTACK');
assert.equal(warnings[0][2].structureId,'spawn');

state.hostileCreeps=[enemy(['move'],1)];
attempt(state);
assert.equal(activations,1,'unarmed scouts cannot invoke actual activation');

state.hostileCreeps=[enemy(['attack'],1)];
controller.safeModeAvailable=0;
assert.equal(decide(state),null,'no available safe mode');
attempt(state);
assert.equal(activations,1);
controller.safeModeAvailable=1;
controller.safeModeCooldown=100;
assert.equal(decide(state),null,'cooldown blocks futile safe mode attempts');
attempt(state);
assert.equal(activations,1);
controller.safeModeCooldown=0;
controller.safeMode=100;
assert.equal(decide(state),null,'already active safe mode is not reactivated');
attempt(state);
assert.equal(activations,1);
console.log('D1 guarded active Safe Mode core-loss tests PASS');
