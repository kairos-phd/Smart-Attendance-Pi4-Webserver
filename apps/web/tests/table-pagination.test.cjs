const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const exportsObject = {};
// The missing helper is represented as the former unbounded table behavior.
const file = require('node:path').resolve(__dirname, '../src/components/paginationUtils.ts');
if (fs.existsSync(file)) vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, {exports:exportsObject});
const paginate = exportsObject.paginate ?? ((rows) => ({rows,page:0,pages:1}));
const latest = exportsObject.latestFirst ?? (rows => rows);
const rows = Array.from({length:101},(_,id)=>({id,time:id}));
test('defaults to 10 latest rows without discarding history',()=>{const ordered=latest(rows,row=>row.time);const result=paginate(ordered,10,0);assert.equal(result.rows.length,10);assert.equal(result.rows[0].id,100);assert.equal(rows.length,101);});
test('older pages and final page clamp at boundaries',()=>{const ordered=latest(rows,row=>row.time);assert.equal(paginate(ordered,20,1).rows[0].id,80);const end=paginate(ordered,50,99);assert.equal(end.page,2);assert.equal(end.rows.length,1);assert.equal(paginate([],10,99).page,0);});
test('changed rows reset to latest while identical polling preserves older page',()=>{const reset=exportsObject.pageForRows ?? (()=>2);assert.equal(reset('same','same',2),2);assert.equal(reset('old','new',2),0);});
test('pagination hook retains older page on polling then resets when a new row arrives',()=>{
 const states=[];let cursor=0;
 const react={useState:initial=>{const slot=cursor++;if(!(slot in states))states[slot]=initial;return[states[slot],next=>{states[slot]=typeof next==='function'?next(states[slot]):next}];}};
 const hookExports={};const source=fs.readFileSync(require('node:path').resolve(__dirname,'../src/components/TablePagination.tsx'),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText,{exports:hookExports,require:name=>name==='react'?react:name==='./paginationUtils'?exportsObject:{}});
 const render=values=>{cursor=0;return hookExports.useTablePagination(values,row=>String(row.id),row=>row.time)};
 let page=render(rows);assert.equal(page.rows.length,10);page.setPage(2);page=render([...rows]);assert.equal(page.page,2);assert.equal(page.rows[0].id,80);
 page=render([...rows,{id:102,time:102}]);assert.equal(page.page,0);assert.equal(page.rows[0].id,102);page.setSize(100);page=render(rows);assert.equal(page.rows.length,100);
});

// Reproduce Windows' case-insensitive .ts-before-.tsx module resolution.
test('Windows resolves the pagination component to TSX, not a similarly named helper',()=>{
 const path=require('node:path');
 const host={...ts.sys,fileExists:file=>{
   try {return fs.readdirSync(path.dirname(file)).some(name=>name.toLowerCase()===path.basename(file).toLowerCase());}
   catch {return false;}
 }};
 const resolved=ts.resolveModuleName('./TablePagination',path.resolve(__dirname,'../src/components/PiPanel.tsx'),{moduleResolution:ts.ModuleResolutionKind.Bundler},host).resolvedModule;
 assert.equal(resolved?.extension,ts.Extension.Tsx);
});
