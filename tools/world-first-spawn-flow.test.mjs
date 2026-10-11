import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {placePinnedWorldSpawn} from './world-first-spawn.mjs';

const game=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');
const modules=Object.fromEntries(fs.readdirSync(game).filter(x=>x.endsWith('.js'))
  .map(x=>[x.slice(0,-3),fs.readFileSync(path.join(game,x),'utf8')]));
function fakeWorld({occupied=false,otherEnemy=false,failedPost=false,
 badName=false}={}) {
  const calls=[];
  let placed=false;
  const api={
    defaultShard:'shard0',
    async authMe() {calls.push('GET_AUTH');return {_id:'me',ok:1};},
    async userWorldStatus() {
      calls.push('GET_WORLD');return {status:placed?'normal':'empty'};
    },
    async userBranches() {
      calls.push('GET_BRANCHES');return {list:[
        {branch:'default',activeWorld:true},
        {branch:'chatgpt'}
      ]};
    },
    async _request(method,endpoint,params) {
      assert.equal(method,'GET');
      calls.push('GET_'+endpoint);
      if(endpoint==='/api/game/shards/info')
        return {shards:[{name:'shard0',rooms:2000,users:4}]};
      if(endpoint==='/api/user/code')
        return {modules:params.branch==='chatgpt'?modules:{main:'legacy'}};
      throw Error('unexpected GET');
    },
    async gameRoomStatus(room,shard) {
      assert.ok(shard===undefined||shard==='shard0');calls.push('GET_ROOM_STATUS');
      return {room:{status:room.endsWith('N9')?'out of borders':'normal'}};
    },
    async gameRoomObjects(room,shard) {
      assert.ok(shard===undefined||shard==='shard0');calls.push('GET_ROOM_OBJECTS');
      if(room==='W37N11') {
        const objects=[
          {type:'controller',x:22,y:22,level:placed?1:0,
            ...(placed?{user:'me'}:{})},
          {type:'source',x:14,y:8,id:'sourceA'},
          {type:'source',x:17,y:12,id:'sourceB'}
        ];
        if(occupied||placed)objects.push({type:'spawn',
          x:12,y:13,name:'Spawn1',user:occupied?'other':'me'});
        return {objects,users:{}};
      }
      if(room==='W35N11')return {objects:[
        {type:'controller',x:22,y:22,user:'other',level:8}
      ],users:{}};
      if(otherEnemy&&room==='W36N11')return {objects:[
        {type:'controller',x:22,y:22,user:'other2',level:8}
      ],users:{}};
      if(room.endsWith('N9')||room.endsWith('N10'))
        return {objects:[],users:{}};
      return {objects:[{type:'controller',x:22,y:22,level:0}],users:{}};
    },
    async gameRoomTerrain(room,shard) {
      assert.ok(shard===undefined||shard==='shard0');calls.push('GET_TERRAIN');
      return {terrain:[{terrain:'0'.repeat(2500)}]};
    },
    async gameCheckUniqueObjectName(type,name,shard) {
      calls.push('POST_NAME_CHECK');
      assert.equal(type,'spawn');assert.equal(name,'Spawn1');
      assert.ok(shard===undefined||shard==='shard0');
      if(badName)throw Error('not unique');
      return {ok:1};
    },
    async gamePlaceSpawn(room,x,y,name,shard) {
      calls.push('POST_PLACE_SPAWN');
      assert.deepEqual([room,x,y,name,shard],
        ['W37N11',12,13,'Spawn1','shard0']);
      if(failedPost)throw Error('uncertain response');
      placed=true;return {ok:1};
    },
    async userSetActiveBranch() {
      throw Error('Placement may never activate World bot');
    }
  };
  return {api,calls,placed:()=>placed};
}
{
 const f=fakeWorld();
 const done=await placePinnedWorldSpawn(f.api,'me');
 assert.equal(done.status,'PASS');
 assert.equal(done.spawnVerified,true);
 assert.equal(done.worldCodeActivated,false);
 assert.equal(done.activeBranch,'default');
 assert.equal(done.placementApiCalls,1);
 assert.equal(f.placed(),true);
 assert.equal(f.calls.filter(c=>c==='POST_PLACE_SPAWN').length,1);
 await assert.rejects(()=>placePinnedWorldSpawn(f.api,'me'));
 assert.equal(f.calls.filter(c=>c==='POST_PLACE_SPAWN').length,1);
}
for (const cfg of [{occupied:true},{otherEnemy:true},{badName:true}]) {
 const f=fakeWorld(cfg);
 await assert.rejects(()=>placePinnedWorldSpawn(f.api,'me'));
 assert.equal(f.calls.includes('POST_PLACE_SPAWN'),false);
 assert.equal(f.placed(),false);
}
{
 const f=fakeWorld({failedPost:true});
 await assert.rejects(()=>placePinnedWorldSpawn(f.api,'me'),
   /WORLD_PLACEMENT_RESULT_UNCERTAIN/);
 assert.equal(f.calls.filter(c=>c==='POST_PLACE_SPAWN').length,1);
}
console.log('World pinned first spawn isolated full offline flow: PASS');
