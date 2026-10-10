const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function moduleFrom(file, dependencies = {}, env = {}, globals = {}) {
 const source=fs.readFileSync(path.resolve(__dirname,'..',file),'utf8').replaceAll('import.meta.env','__env');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const exports={};vm.runInNewContext(compiled,{exports,require:name=>dependencies[name],__env:env,Intl,Date,URLSearchParams,...globals});return exports;
}
const adapter=moduleFrom('src/piData.ts');
const fixture=()=>({pi_id:'pi4',fetched_at:'2026-10-10T10:00:00Z',health:{status:'ok',camera_status:[{camera_id:'usb',status:'unavailable'},{camera_id:'icspring',status:'online'}]},users:[{user_id:'u1',name:'Alice',status:'active'}],attendance:[{attendance_id:1,user_id:'u1',name:'Alice',occurred_at:'2026-10-09T18:00:00Z',camera_ids:['icspring','usb']}],unknown:[{observation_id:'o1',camera_id:'usb',occurred_at:'2026-10-10T00:00:00Z',reason:'no_candidate',model_version:'v1'}],next_attendance_id:null,next_unknown_rowid:null});
test('One multi-camera attendance, stable source IDs, actual unavailable health',()=>{
 const result=adapter.adaptPiDashboard(fixture());assert.equal(result.attendance.length,1);assert.equal(result.attendance[0].id,'pi4:1');assert.equal(result.attendance[0].attendance_id,'1');assert.equal(result.attendance[0].camera_id,'icspring, usb');assert.equal(result.attendance[0].date,'2026-10-10');assert.equal(result.users[0].id,'u1');assert.equal(result.cameras[0].status,'offline');assert.equal(result.cameras[0].last_error,'unavailable');assert.equal(result.cameras[1].last_seen.toDate().toISOString(),new Date(fixture().fetched_at).toISOString());assert.equal(result.unknown[0].image_url,undefined);assert.equal(result.unknown[0].reason,'no_candidate');
});
test('Independently exhausted pagination preserves -1 and collects full history',async()=>{
 const cursors=[];const result=await adapter.loadPiDashboard(async(a,u)=>{cursors.push([a,u]);const value=fixture();if(cursors.length===1)value.next_unknown_rowid=10;else{value.attendance=[];value.unknown=[{...value.unknown[0],observation_id:'o2'}];}return value;});assert.deepEqual(cursors,[[0,0],[-1,10]]);assert.equal(result.attendance.length,1);assert.equal(result.unknown.length,2);
});
test('Nonadvancing cursor rejects truncated history',async()=>{await assert.rejects(adapter.loadPiDashboard(async()=>({...fixture(),next_attendance_id:0})),/did not advance/);});
test('Date ranges follow Vietnam calendar',()=>{const now=new Date('2026-10-11T18:00:00Z');assert.equal(adapter.piIsoDate(now),'2026-10-12');assert.equal(adapter.piDateBounds('week','',now).start,'2026-10-12');assert.equal(adapter.piDateBounds('yesterday','',now).start,'2026-10-11');});
test('Pi mode routes metadata, admin and health through gateway',async()=>{
 const urls=[];const api=moduleFrom('src/api.ts',{'./firebase':{auth:{currentUser:{getIdToken:async()=>'token'}}},'./piData':adapter},{VITE_DATA_SOURCE:'pi',VITE_API_BASE_URL:'https://full.example',VITE_PI_API_BASE_URL:'https://pi.example'},{AbortController,window:{setTimeout,clearTimeout},fetch:async url=>{urls.push(url);return{ok:true,json:async()=>url.endsWith('/health')?{status:'ok'}:[]}}});await api.getUsers();await api.getAdminAccounts();await api.deactivateUser('u1');await api.checkApiHealth();assert.deepEqual(urls,['https://pi.example/api/pi/users','https://pi.example/api/pi/admin/accounts','https://pi.example/api/pi/users/u1','https://pi.example/health']);
});

test('Overview fetch spans seven Vietnam days while today KPI excludes prior records',()=>{
 const now=new Date('2026-10-11T18:00:00Z');
 const bounds=adapter.piDateBounds('overview','',now);
 assert.equal(bounds.start,'2026-10-06');assert.equal(bounds.end,'2026-10-12');
 const entries=[{date:'2026-10-06'},{date:'2026-10-11'},{date:'2026-10-12'},{date:'2026-10-12'},{date:'2026-10-05'}];
 const overview=adapter.piOverviewAttendance(entries,'en-US',now);
 assert.equal(overview.today.length,2);assert.equal(overview.trend.length,7);
 assert.equal(overview.trend[0].dateStr,bounds.start);assert.equal(overview.trend[0].count,1);
 assert.equal(overview.trend[5].count,1);assert.equal(overview.trend[6].dateStr,bounds.end);assert.equal(overview.trend[6].count,2);
 assert.equal(overview.trend.reduce((sum,day)=>sum+day.count,0),4);
});
