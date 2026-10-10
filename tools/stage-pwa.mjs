import {cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const [source, revision] = process.argv.slice(2);
if (!source || !/^[a-f0-9]{40}$/.test(revision || '')) throw Error('Validated PWA build and commit required');
const output = resolve('dist/flupflap');
if (!existsSync(output + '/index.html') || realpathSync(output) !== output) throw Error('Build the dedicated website first');
const manifest=JSON.parse(readFileSync(resolve(source,'manifest.json')));
if(manifest.start_url !== '/app/' || manifest.scope !== '/app/' || manifest.display !== 'standalone') throw Error('Unexpected PWA scope');
for(const path of ['index.html','main.dart.js','flutter_bootstrap.js','pwa-worker.js','icons/icon-192.png','icons/icon-512.png']) {
  if(!existsSync(resolve(source,path))) throw Error('Missing PWA asset: '+path);
}
const worker=readFileSync(resolve(source,'pwa-worker.js'),'utf8');
if(worker.includes('__PWA_') || !worker.includes('flupflap-pwa-')) throw Error('Unprepared worker');
mkdirSync(output+'/app',{recursive:true});
cpSync(source,output+'/app',{recursive:true});
writeFileSync(output+'/app/build.json',JSON.stringify({sourceRevision:revision})+'\n');
console.log('Staged FlupFlap PWA at /app/ from '+revision);
