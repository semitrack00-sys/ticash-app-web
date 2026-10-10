import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./stage-pwa.mjs',import.meta.url));
const revision='a'.repeat(40);
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'flupflap-pwa-stage-'));
  mkdirSync(join(root,'dist/flupflap'),{recursive:true});writeFileSync(join(root,'dist/flupflap/index.html'),'existing website');
  const source=join(root,'built');mkdirSync(join(source,'icons'),{recursive:true});
  writeFileSync(join(source,'manifest.json'),JSON.stringify({start_url:'/app/',scope:'/app/',display:'standalone'}));
  for(const file of ['index.html','main.dart.js','flutter_bootstrap.js','pwa-worker.js','icons/icon-192.png','icons/icon-512.png']) writeFileSync(join(source,file),file==='pwa-worker.js'?'flupflap-pwa-fixture':'fixture-only');
  return {root,source};
}
test('PWA staging preserves the existing website and confines output to /app/',()=>{
  const f=fixture();try {
    execFileSync(process.execPath,[script,f.source,revision],{cwd:f.root});
    assert.equal(readFileSync(join(f.root,'dist/flupflap/index.html'),'utf8'),'existing website');
    assert.ok(existsSync(join(f.root,'dist/flupflap/app/main.dart.js')));
    assert.equal(JSON.parse(readFileSync(join(f.root,'dist/flupflap/app/build.json'))).sourceRevision,revision);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('invalid revisions, wrong scopes and missing compiled assets fail closed',()=>{
  const f=fixture();try {
    const run=rev=>execFileSync(process.execPath,[script,f.source,rev],{cwd:f.root,stdio:'pipe'});
    assert.throws(()=>run('main'));
    writeFileSync(join(f.source,'manifest.json'),JSON.stringify({start_url:'/',scope:'/',display:'standalone'}));assert.throws(()=>run(revision));
    writeFileSync(join(f.source,'manifest.json'),JSON.stringify({start_url:'/app/',scope:'/app/',display:'standalone'}));
    rmSync(join(f.source,'main.dart.js'));assert.throws(()=>run(revision));
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('Render app security permissions are scoped without relaxing existing account pages',()=>{
  const yaml=readFileSync(new URL('../render.flupflap.yaml',import.meta.url),'utf8');
  const app=yaml.split('      - path: /app/*')[1];
  assert.match(app,/script-src 'self' 'wasm-unsafe-eval'/);assert.match(app,/worker-src 'self'/);assert.match(app,/base-uri 'self'/);
  const login=yaml.split('      - path: /login\n        name: Content-Security-Policy')[1].split('      - path:')[0];
  assert.match(login,/worker-src 'none'/);assert.match(login,/base-uri 'none'/);assert.doesNotMatch(login,/wasm-unsafe-eval/);
});
