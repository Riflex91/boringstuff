import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { assertUniqueActiveCodeBranch }
  from './o39-code-upload-active-branch-policy.mjs';

// No remote Screeps calls: all HTTP scenarios use an ephemeral loopback server.
const valid={list:[
  {branch:'chatgpt',activeWorld:true},
  {branch:'inactive',activeWorld:false}
]};
assert.equal(assertUniqueActiveCodeBranch(valid,'chatgpt').verified,true);
for(const data of [
 null,{}, {list:[]},
 {list:[{branch:'chatgpt'}]},
 {list:[{branch:'chatgpt',activeWorld:false}]},
 {list:[{branch:'other',activeWorld:true}]},
 {list:[{branch:'chatgpt',activeWorld:true},
        {branch:'other',activeWorld:true}]},
 {list:[{branch:'chatgpt',activeWorld:true},
        {branch:'chatgpt',activeWorld:false}]},
 {list:[{branch:'chatgpt',activeWorld:true},
        {branch:'other',activeWorld:'false'}]},
 {list:Array.from({length:101},(_,i)=>({
   branch:'b'+i,activeWorld:i===0}))}
])assert.throws(()=>assertUniqueActiveCodeBranch(data,'chatgpt'),/CODE_UPLOAD_HOLD/);
assert.throws(()=>assertUniqueActiveCodeBranch(valid,'unknown'),/CODE_UPLOAD_HOLD/);
assert.throws(()=>assertUniqueActiveCodeBranch(valid,'bad/name'),/CODE_UPLOAD_HOLD/);

const modules={
 main:'module.exports.loop = () => {};',
 config:'module.exports = { VERSION: "o16" };'
};
for(let i=0;i<80;i++)modules['module'+i]='module.exports = '+i+';';
assert.equal(Object.keys(modules).length,82);
const fakeClient=new ScreepsHttpClient('local',{
 baseUrl:'http://127.0.0.1:9/',token:'test',email:'example',password:'example'
});
const rejected=[
 null,[],{}, {main:'data',config:'data'},
 {...modules,main:null},
 {...modules,config:''},
 {...modules,'wrong/path':'data'},
 {...modules,extra:'data'}
];
for(const payload of rejected){
 assert.throws(
   ()=>fakeClient.userUploadCodeOnce('chatgpt',payload),
   /EXACT_82_MODULE_CODE_UPLOAD_PAYLOAD_REQUIRED/
 );
}
assert.throws(
  ()=>fakeClient.userUploadCodeOnce('../unsafe',modules),
  /EXACT_82_MODULE_CODE_UPLOAD_PAYLOAD_REQUIRED/
);

async function localCase(kind) {
 let posts=0,signins=0,unexpected=0;
 const server=http.createServer((req,res)=>{
   if(req.url==='/api/auth/signin'){signins++;res.writeHead(200);res.end('{}');return;}
   if(req.method!=='POST'||req.url!=='/api/user/code'){
     unexpected++;res.writeHead(404);res.end();return;
   }
   posts++;
   const chunks=[];
   req.on('data',x=>chunks.push(x));
   req.on('end',()=>{
     const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
     assert.equal(data.branch,'chatgpt');
     assert.equal(Object.keys(data.modules).length,82);
     if(kind==='socket-disconnect'){req.socket.destroy();return;}
     if(kind==='success'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":1}');return;}
     if(kind==='application-error'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"error":"REJECTED"}');return;}
     const code=kind==='unauthorized'?401:kind==='rate-limit'?429:503;
     res.writeHead(code,{'Content-Type':'application/json',
       'Retry-After':'0.01'});
     res.end('{"error":"UPSTREAM_NOT_CONFIRMED"}');
   });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/';
 const client=new ScreepsHttpClient('local',{
   baseUrl:url,token:'unit-token',email:'username',password:'password'
 });
 try {
   if(kind==='success'){
     const result=await client.userUploadCodeOnce('chatgpt',modules);
     assert.deepEqual(result,{ok:1});
   }else{
     await assert.rejects(
       client.userUploadCodeOnce('chatgpt',modules),
       error=>error instanceof Error
     );
   }
   assert.equal(posts,1,kind+' must never send second POST');
   assert.equal(signins,0,kind+' must never refresh auth/replay upload');
   assert.equal(unexpected,0);
 } finally {
   await new Promise(resolve=>server.close(resolve));
 }
}
for(const kind of ['success','rate-limit','service-unavailable',
 'unauthorized','application-error','socket-disconnect'])
 await localCase(kind);

// Executable production entrypoint must use the exact nonreplaying method,
// and refuse ambiguous active branch BEFORE any persisted backup or POST.
const source=fs.readFileSync(
 new URL('./deploy-live.mjs',import.meta.url),'utf8'
);
const branchGuard=source.indexOf('assertUniqueActiveCodeBranch(branches, branch)');
const before=source.indexOf("const before = await api._request('GET', '/api/user/code'");
const backup=source.indexOf('Backup written:');
const upload=source.indexOf('await api.userUploadCodeOnce(branch, modules)');
assert.ok(branchGuard>0&&before>branchGuard&&backup>before&&upload>backup);
assert.equal((source.match(/await api\.userUploadCodeOnce\(branch, modules\)/g)||[]).length,1);
assert.ok(!/api\._request\('POST', '\/api\/user\/code'/.test(source));
assert.ok(source.includes("const receipt = writeDeploymentReceipt"));
assert.ok(upload<source.indexOf("const receipt = writeDeploymentReceipt"));
assert.ok(!/retry.*upload/i.test(source.slice(upload,source.indexOf(
 "const receipt = writeDeploymentReceipt"))));
console.log('O39 code POST at most once under 200/401/429/5xx/socket-loss + active branch HOLD: PASS');
