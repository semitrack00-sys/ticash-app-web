import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { mountRecharge } from '../js/recharge-page.js';
import { createApiClient } from '../js/api-client.js';
import { rechargePath, rechargeReturnPath, isRechargeResetPath } from '../js/recharge-routes.js';
import { fixtureApi, quote } from './fixtures.mjs';
import { checkFlupflapAssets } from './check-flupflap-assets.mjs';

execFileSync(process.execPath, ['tools/build-flupflap.mjs']);
const built = path => readFileSync(new URL('../dist/flupflap/' + path, import.meta.url), 'utf8');

test('built-output crawl resolves HTML, CSS, JS, navigation and dynamic flag family references',()=>{
  const report=checkFlupflapAssets();
  assert.deepEqual(report.families,['/flags/*.svg']);
  for(const path of ['route.css','js/translations/en.js','js/translations/ht.js','js/translations/fr.js','js/translations/es.js','js/translations/pt.js','brand/flupflap/icon.svg','flags/ht.svg','flags/jp.svg']) assert.ok(report.required.includes(path),path);
});

test('every existing production flag is packaged byte-for-byte with its license',()=>{
  const names=readdirSync(new URL('../flags/',import.meta.url)).filter(name=>name.endsWith('.svg'));
  assert.ok(names.length>249);
  for(const name of [...names,'LICENSE.flag-icons.txt']) assert.equal(built('flags/'+name),readFileSync(new URL('../flags/'+name,import.meta.url),'utf8'),name);
  for(const code of ['ht','us','br','fr','za','jp','au']) {
    const dom=new JSDOM(built('flags/'+code+'.svg'),{contentType:'image/svg+xml'});
    assert.equal(dom.window.document.documentElement.localName,'svg');dom.window.close();
  }
});

test('asset gate rejects missing flags, styles, modules, translations, icons and linked pages',()=>{
  const temp=mkdtempSync(join(tmpdir(),'flupflap-asset-test-'));
  const source=fileURLToPath(new URL('..',import.meta.url));
  try {
    cpSync(resolve(source,'dist/flupflap'),temp,{recursive:true});
    for(const path of ['flags/ht.svg','flags/za.svg','route.css','js/recharge.js','js/translations/pt.js','brand/flupflap/icon.svg','index.html']) {
      const target=join(temp,path),original=readFileSync(target);rmSync(target);
      assert.throws(()=>checkFlupflapAssets(temp,source),error=>error.message.includes(path),path);
      writeFileSync(target,original);
    }
    const css=join(temp,'route.css'),original=readFileSync(css,'utf8');
    writeFileSync(css,original+'\n.audit{background:url("/missing-production-image.png")}');
    assert.throws(()=>checkFlupflapAssets(temp,source),/missing-production-image\.png/);
  } finally {
    if(!resolve(temp).startsWith(resolve(tmpdir(),'flupflap-asset-test-'))) throw new Error('Unsafe temporary test path');
    rmSync(temp,{recursive:true,force:true});
  }
});
const tick = async () => { for (let i=0;i<5;i++) await new Promise(resolve=>setTimeout(resolve,0)); };
async function page(path, api, run) {
  const file = path.startsWith('/reset-password') ? 'reset-password/index.html' : path.startsWith('/login') ? 'login/index.html' : 'index.html';
  const dom = new JSDOM(built(file), {url:'https://www.flupflap.com'+path});
  globalThis.document=dom.window.document; globalThis.location=dom.window.location; globalThis.history=dom.window.history;
  globalThis.addEventListener=dom.window.addEventListener.bind(dom.window);globalThis.removeEventListener=dom.window.removeEventListener.bind(dom.window);
  const root=document.querySelector('[data-recharge-root]');
  const app=mountRecharge(root,{apiBaseUrl:'https://ticash-api.onrender.com/api',mobileRechargeLive:true},{api});
  try { await tick(); await run({dom,root,app,q:s=>document.querySelector(s)}); }
  finally { app.dispose();dom.window.close();delete globalThis.document;delete globalThis.location;delete globalThis.history;delete globalThis.addEventListener;delete globalThis.removeEventListener; }
}

test('dedicated build serves approved recharge at root without shipping TiCash homepage, tools or admin',()=>{
  const source=readFileSync(new URL('../recharge/index.html',import.meta.url),'utf8');
  assert.equal(built('index.html'),source.replace('data-recharge-root','data-recharge-root data-recharge-path="/"').replaceAll('href="/recharge"','href="/"').replace(/connect-src [^;]+;/g,"connect-src 'self' https://ticash-api.onrender.com;"));
  for(const path of ['login/index.html','reset-password/index.html','recharge/index.html','recharge/reset-password/index.html']) assert.match(built(path),/data-recharge-path="\/"/);
  for(const path of ['tools','node_modules','.env','admin','send','analytics.js']) assert.equal(existsSync(new URL('../dist/flupflap/'+path,import.meta.url)),false,path);
  assert.equal(built('public-config.js'),readFileSync(new URL('../public-config.js',import.meta.url),'utf8'));
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(new URL(e.name+'/',dir)):[new URL(e.name,dir)]);
  for(const file of walk(new URL('../dist/flupflap/',import.meta.url)).filter(f=>/\.(html|css|js)$/.test(f.pathname))) {
    const text=readFileSync(file,'utf8');
    assert.doesNotMatch(text,/Test catalog operator|Test airtime|sk_live_|sk_test_|BEGIN PRIVATE KEY/);
    for(const match of text.matchAll(/url\(['"]?(\/[^)'"\s]+)['"]?\)/g)) assert.ok(existsSync(new URL('../dist/flupflap'+match[1],import.meta.url)),match[1]);
    for(const match of text.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) {
      const path=decodeURIComponent(match[1]);
      if(['/','/support','/send','/legal/privacy','/legal/terms'].includes(path))continue;
      assert.ok(existsSync(new URL('../dist/flupflap'+path,import.meta.url)),path);
    }
  }
});

test('every generated route uses the exact production API CSP without development or wildcard origins',()=>{
  for(const path of ['index.html','login/index.html','reset-password/index.html','recharge/index.html','recharge/reset-password/index.html']) {
    const dom=new JSDOM(built(path));
    const policy=dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    assert.equal(policy.split(';').map(s=>s.trim()).find(s=>s.startsWith('connect-src ')),"connect-src 'self' https://ticash-api.onrender.com");
    assert.doesNotMatch(policy,/localhost|127\.0\.0\.1|\[::1\]|connect-src https:|flupflap-recharge\.onrender\.com/);
    assert.match(policy,/object-src 'none'/);assert.match(policy,/base-uri 'none'/);assert.match(policy,/form-action 'none'/);dom.window.close();
  }
});

test('routing is build-selected; TiCash keeps /recharge and untrusted query cannot select redirects',()=>{
  const dom=new JSDOM('<main></main>',{url:'https://ticash-app.com/login?next=https://evil.invalid#keep'});
  const root=dom.window.document.querySelector('main');
  assert.equal(rechargePath(root),'/recharge');assert.equal(isRechargeResetPath(root,'/reset-password'),false);
  root.dataset.rechargePath='/';
  assert.equal(rechargeReturnPath(root),'/?next=https://evil.invalid#keep');
  for(const path of ['/reset-password','/reset-password/','/recharge/reset-password'])assert.equal(isRechargeResetPath(root,path),true);
  root.dataset.rechargePath='https://evil.invalid';assert.equal(rechargePath(root),'/recharge');dom.window.close();
});

for(const mode of ['login','guest','register']) test(`dedicated /login: ${mode} retains real API behavior and returns to root`,async()=>{
  const api=fixtureApi();let called=0;api[mode]=async()=>{called++;return {id:mode,domain:'FLUPFLAP',isGuest:mode==='guest'};};
  await page('/login?lang=fr#keep',api,async({dom,q,app})=>{
    if(mode==='guest')q('#continue-guest').click();
    else {
      if(mode==='register') {
        q('#choose-register').click();
        q('#first-name').value='Domain';q('#last-name').value='Test';q('#register-phone').value='+15555550123';
      }
      q(mode==='login'?'#email':'#register-email').value='domain-test@example.test';
      q(mode==='login'?'#password':'#register-password').value='secure-test-password';
      q(mode==='login'?'#login-form':'#register-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    }
    await tick();assert.equal(called,1);assert.equal(q('#checkout').hidden,false);
    assert.equal(dom.window.location.pathname,'/');assert.equal(dom.window.location.search,'?lang=fr');assert.equal(dom.window.location.hash,'#keep');
    assert.equal(app.model.state.guest,mode==='guest');assert.ok(api.calls.every(c=>c.method!=='PATCH'));
    assert.equal(dom.window.localStorage.length,0);assert.equal(dom.window.sessionStorage.length,0);
  });
});

test('root cookie restore miss is silent; forgot/reset work and reset token is removed before API calls',async()=>{
  const api=fixtureApi();let forgot=0,reset=0;api.restore=async()=>null;api.forgotPassword=async()=>{forgot++;};
  await page('/',api,async({dom,q})=>{
    assert.equal(q('.login-panel [role=alert]').hidden,true);
    q('#forgot-password').click();q('#forgot-email').value='domain-test@example.test';
    q('#forgot-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();assert.equal(forgot,1);
  });
  const token='T'.repeat(43);api.resetPassword=async(value)=>{assert.equal(value,token);assert.equal(globalThis.location.search,'?lang=fr');reset++;};
  await page('/reset-password?token='+token+'&lang=fr',api,async({dom,q})=>{
    q('#new-password').value='new-secure-password';q('#confirm-password').value='new-secure-password';
    q('#reset-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();
    assert.equal(reset,1);assert.equal(dom.window.location.pathname,'/');assert.equal(dom.window.location.search,'?lang=fr');
  });
});

test('root and legacy return URLs scrub resume capability and expose only read-only recovery',async()=>{
  for(const path of ['/','/recharge','/checkout/return']) {
    const token='R'.repeat(43);let calls=0;
    const api={resumeCheckout:async(value)=>{calls++;assert.equal(value,token);assert.equal(globalThis.location.search,'?lang=fr');return {transaction:{status:'DELIVERED',testMode:false,recipientPhone:quote.recipientPhone,operatorName:quote.operatorName,productName:quote.productName,providerAmount:quote.providerAmount,providerCurrency:'USD',feeUsd:quote.feeUsd,totalChargeUsd:quote.totalChargeUsd}};}};
    await page(path+'?checkoutResumeToken='+token+'&lang=fr',api,async({app,q,dom})=>{
      assert.equal(app.mode,'resume');assert.equal(calls,1);assert.equal(q('[data-checkout-resume] a').getAttribute('href'),'/');
      assert.equal(dom.window.localStorage.length,0);assert.equal(dom.window.sessionStorage.length,0);
    });
  }
});

test('production API remains fixed and cross-origin FlupFlap credentials/isolation are unchanged',async()=>{
  const calls=[];let expired=0;
  const api=createApiClient({baseUrl:'https://ticash-api.onrender.com/api',identityDomain:'FLUPFLAP',onSessionExpired:()=>expired++,fetchImpl:async(url,options)=>{
    calls.push({url,options});return new Response(JSON.stringify({code:'INVALID_REFRESH_TOKEN'}),{status:401});
  }});
  assert.equal(await api.restore(),null);assert.equal(expired,0);
  assert.equal(calls[0].url,'https://ticash-api.onrender.com/api/flupflap/auth/refresh');
  assert.equal(calls[0].options.credentials,'include');assert.equal(calls[0].options.mode,'cors');assert.equal(calls[0].options.redirect,'error');
  await assert.rejects(api.request('/admin'),{code:'INVALID_PATH'});
});

test('root journey loads provider catalog, quotes without payment, and browser Back preserves root',async()=>{
  const api=fixtureApi();
  await page('/',api,async({dom,q,app})=>{
    q('#continue-guest').click();await tick();
    q('#country').value='JM';q('#country').dispatchEvent(new dom.window.Event('change'));await tick();
    q('#phone').value=quote.recipientPhone;q('#phone').dispatchEvent(new dom.window.Event('input'));
    q('#continue-number').click();await tick();assert.equal(q('#journey-amount').hidden,false);
    dom.window.history.back();await tick();assert.equal(q('[data-journey-screen="number"]').hidden,false);assert.equal(dom.window.location.pathname,'/');
    q('#continue-number').click();await tick();q('[data-product-id]').click();q('#get-quote').click();await tick();
    assert.equal(app.model.state.quote.totalChargeUsd,quote.totalChargeUsd);
    assert.ok(api.calls.some(c=>c.path==='/mobile-topups/quotes'));
    assert.ok(api.calls.every(c=>!['/mobile-topups/payment-sessions','/mobile-topups/transactions'].includes(c.path)||c.method!=='POST'));
  });
});

test('refresh at dedicated root restores only the existing server session',async()=>{
  const api=fixtureApi();let restores=0;api.restore=async()=>{restores++;return {id:'server-user',domain:'FLUPFLAP',isGuest:false};};
  await page('/',api,async({q,app,dom})=>{
    assert.equal(restores,1);assert.equal(q('#checkout').hidden,false);assert.equal(app.model.state.account.id,'server-user');
    assert.equal(dom.window.location.pathname,'/');assert.equal(q('.login-panel [role=alert]').hidden,true);
  });
});

test('rejected cookie restoration logs nothing and leaves real sign-in available without authenticating',async()=>{
  const originalWarn=console.warn;const logs=[];console.warn=(...args)=>logs.push(args);
  try {
    for(const failure of [new Error('Restore unavailable'),{code:'RESTORE_UNAVAILABLE'}]) {
      const api=fixtureApi();api.restore=async()=>{throw failure;};
      await page('/',api,async({q,app})=>{
        assert.equal(q('#checkout').hidden,true);
        assert.equal(q('#login-form button[type=submit]').disabled,false);
        assert.equal(q('#continue-guest').disabled,false);
        assert.equal(q('.login-panel [role=alert]').hidden,true);
        assert.equal(app.model.state.account,null);
      });
    }
    assert.deepEqual(logs,[]);
  } finally {console.warn=originalWarn;}
});
