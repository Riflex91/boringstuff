import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../game/spawn.manager.js',import.meta.url),'utf8');
const ctx={module:{exports:{}},require(name){
 if(name==='config')return{MAX_BOOTSTRAP_HARVESTERS:5,
  MAX_BOOTSTRAP_HAULERS:3,MAX_UPGRADERS:4,MAX_BUILDERS:3,
  SCOUTS_AFTER_RCL:3,RCL1_SURPLUS_STREAK_TICKS:10,
  RCL1_SURPLUS_UPGRADERS:2,RCL2_PLUS_SURPLUS_STREAK_TICKS:25};
 if(name==='logger')return{info(){},warn(){}};
 if(name==='body.builder')return{};
 if(name==='work.priority')return{hasEmergencyRepair:()=>false};
 throw Error(name);
}};
vm.runInNewContext(source,ctx,{filename:'spawn.manager.js'});
const {desired,_test:{standingGarrison,defenderDemand}}=ctx.module.exports;
const stable={
 room:{name:'E8N1',controller:{my:true}},
 rcl:6,energyCapacityAvailable:1050,energyAvailable:1050,
 energyStored:12500,emergency:false,
 sources:[{id:'s1'},{id:'s2'}],sites:[],structures:[],
 hostileCreeps:[],towers:[{my:true},{my:true}],
 byRole:{harvester:2,hauler:2,worker:1,defender:0},
 economyModel:{recommendedHaulerCount:2,recommendedHarvesterCount:2},
 economyMetrics:{energyCappedStreak:0,spawnIdleStreak:0}
};
assert.equal(standingGarrison(stable),2);
assert.equal(desired(stable).defender,2,
 'stable stocked colony keeps two defenders BEFORE attackers arrive');
const early={...stable,rcl:5,energyStored:4000,towers:[{my:true}]};
assert.equal(standingGarrison(early),1,
 'one standing sentry protects a stable RCL5 room with only one Spawn');
assert.equal(desired(early).defender,1);
for(const [state,explain] of [
 [{...stable,emergency:true},'survival emergency'],
 [{...stable,energyStored:500},'no economic buffer'],
 [{...stable,energyCapacityAvailable:300},'capacity cannot fund combat body'],
 [{...stable,byRole:{...stable.byRole,hauler:0}},'no live logistics'],
 [{...stable,byRole:{...stable.byRole,harvester:1}},'mining deficit'],
 [{...stable,byRole:{...stable.byRole,worker:0}},'no productive worker'],
 [{...stable,room:{name:'E8N1',controller:{my:false}}},'room not ours'],
 [{...stable,rcl:3},'insufficient level']
]) {
 assert.equal(standingGarrison(state),0,explain+' must postpone peacetime army');
 assert.equal(desired(state).defender,0);
}
const notRich={...stable,energyStored:7000};
assert.equal(standingGarrison(notRich),1,
 'second defender requires a deep buffer');
const oneTower={...stable,towers:[{my:true}]};
assert.equal(standingGarrison(oneTower),1,
 'second defender requires already built redundant tower support');
const hostile={body:[{type:'attack',hits:100},{type:'move',hits:100}]};
assert.equal(defenderDemand([hostile]),1);
assert.equal(desired({...stable,emergency:true,hostileCreeps:[hostile]}).defender,1,
 'an active attacker still demands response during a harvesting emergency');
const harmless={body:[{type:'move',hits:100}]};
assert.equal(desired({...stable,emergency:true,hostileCreeps:[harmless]}).defender,0,
 'harmless scout must not starve post-siege recovery');
const strong={body:Array.from({length:12},()=>({type:'attack',hits:100}))};
assert.equal(desired({...stable,hostileCreeps:[strong]}).defender,3,
 'active raid pressure scales live demand beyond peacetime garrison');
console.log('D3 sustainable standing defense, survival/logistics first, raid scaling PASS');
