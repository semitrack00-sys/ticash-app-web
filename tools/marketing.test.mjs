import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { acquisitionQuery, acquisitionLink, createAcquisition, marketingControls, safeShareUrl } from '../js/marketing.js';
import { createApiClient } from '../js/api-client.js';
const receipt = 'r'.repeat(43), ref = 'a'.repeat(32);
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

test('only normalized referral/promotion codes survive acquisition query parsing', () => {
  assert.deepEqual(acquisitionQuery(`https://www.flupflap.com/join?r=${ref}&promo=jean20&email=private&fee=0`), { r: ref, promo:'JEAN20' });
  for (const bad of ['<script>', '//evil', 'bad code', 'x'.repeat(80)]) assert.deepEqual(acquisitionQuery('https://www.flupflap.com/join?promo='+encodeURIComponent(bad)), {});
  assert.equal(acquisitionLink('/login',{r:ref,promo:'JEAN20',fee:0},true),`/login?r=${ref}&promo=JEAN20&mode=register`);
});
test('public attribution receipt is memory-only, final claim uses authenticated API and never submits reward/fee', async () => {
  const calls=[];const api={marketingVisit:async input=>{calls.push(input);return{capability:receipt};},marketingSignupStarted:async r=>calls.push({started:r}),request:async(path,options)=>calls.push({path,...options})};
  const acquisition=createAcquisition(api,`https://www.flupflap.com/join?r=${ref}`);
  await acquisition.begin();await acquisition.signupStarted();await acquisition.claim();
  assert.equal(calls.length,3);assert.deepEqual(calls[2],{path:'/marketing/attribution',method:'POST',body:{capability:receipt}});
  assert.doesNotMatch(JSON.stringify(calls),/discount|reward|fee|payment|email|phone/);
  assert.equal(acquisition.link('/login'),`/login?r=${ref}`);
});
test('manual code uses backend validation; expired/invalid code does not produce a success claim',async()=>{
  const calls=[];const acquisition=createAcquisition({marketingVisit:async v=>{calls.push(v);throw new Error('Unavailable');}},'https://www.flupflap.com');
  await assert.rejects(acquisition.manual(' jean20 '));assert.deepEqual(calls,[{promo:'JEAN20'}]);
  await assert.rejects(acquisition.manual('<script>'));assert.equal(calls.length,1);
});
test('malformed server receipt fails closed',async()=>{
  const acquisition=createAcquisition({marketingVisit:async()=>({capability:'bad'})},`https://www.flupflap.com/join?r=${ref}`);
  await assert.rejects(acquisition.begin());
});
test('referral sharing accepts only fixed-origin opaque public URLs',()=>{
  const url=`https://www.flupflap.com/join?r=${ref}`;assert.equal(safeShareUrl(url),url);
  for(const bad of ['javascript:alert(1)','https://evil.test/join?r='+ref,url+'&accessToken=x','https://www.flupflap.com/join?r=user@email.com'])assert.equal(safeShareUrl(bad),null);
});
test('authenticated share controls generate WhatsApp/SMS/copy/QR without exposing customer identity',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://www.flupflap.com/'});const doc=dom.window.document;
  const url=`https://www.flupflap.com/join?r=${ref}`, calls=[];
  const api={request:async path=>{calls.push(path);return path.endsWith('/qr')?{dataUrl:'data:image/png;base64,aGVsbG8='}:{url};}};
  const controls=marketingControls({doc,client:api,url:dom.window.location.href});doc.body.append(controls.panel);
  await controls.authenticated({guest:false});controls.panel.open=true;await tick();
  assert.equal(doc.querySelector('input').value,url);
  assert.ok(doc.querySelector('a').href.startsWith('https://wa.me/?text='));
  assert.equal(doc.querySelector('img').hidden,false);assert.deepEqual(calls,['/marketing/share','/marketing/share/qr']);
  controls.reset();assert.equal(controls.panel.hidden,true);assert.equal(doc.querySelector('input').value,'');
  controls.dispose();dom.window.close();
});
test('guest cannot obtain a customer referral link; logout clears in-flight results',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://www.flupflap.com/'});let requests=0;
  const controls=marketingControls({doc:dom.window.document,client:{request:async()=>{requests++;}},url:dom.window.location.href});
  dom.window.document.body.append(controls.panel);await controls.authenticated({guest:true});controls.panel.open=true;await tick();
  assert.equal(requests,0);assert.equal(controls.panel.hidden,true);controls.dispose();dom.window.close();
});
test('manual entry feedback remains safe text and never claims a monetary discount before server quote',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://www.flupflap.com/'});
  const controls=marketingControls({doc:dom.window.document,client:{marketingVisit:async()=>({capability:receipt})},url:dom.window.location.href});
  dom.window.document.body.append(controls.promo);dom.window.document.querySelector('input').value='jean20';dom.window.document.querySelector('button').click();await tick();
  assert.match(dom.window.document.querySelector('[role=status]').textContent,/eligibility review/);controls.dispose();dom.window.close();
});
test('FlupFlap-only API marketing allowlist cannot bypass identity separation',async()=>{
  const calls=[];
  const client=createApiClient({baseUrl:'https://api.example.test/api',identityDomain:'FLUPFLAP',fetchImpl:async(url,options)=>{
    calls.push({url,...options});return {ok:true,status:200,json:async()=>url.endsWith('/login')?{accessToken:'test-access',refreshToken:'test-refresh',user:{domain:'FLUPFLAP'}}:{capability:receipt}};
  }});
  await client.marketingVisit({promo:'JEAN20'});assert.equal(calls[0].headers.Authorization,undefined);
  await client.login('fixture@example.test','test-only');await client.request('/marketing/attribution',{method:'POST',body:{capability:receipt}});
  assert.match(calls.at(-1).url,/\/flupflap\/marketing\/attribution$/);assert.equal(calls.at(-1).headers.Authorization,'Bearer test-access');
  for(const path of ['/marketing/../admin','/marketing/share?redirect=evil','/admin/flupflap/promotions','/users/other'])await assert.rejects(client.request(path));
  const ti=createApiClient({baseUrl:'https://api.example.test/api'});assert.throws(()=>ti.marketingVisit({}));
});
test('social metadata is canonical and contains no referral, customer or tracking data',()=>{
  const html=readFileSync('join/index.html','utf8');const doc=new JSDOM(html).window.document;
  assert.equal(doc.querySelector('[rel=canonical]').href,'https://www.flupflap.com/join');
  assert.equal(doc.querySelector('[property="og:url"]').content,'https://www.flupflap.com/join');
  assert.equal(doc.querySelector('[name="twitter:card"]').content,'summary_large_image');
  assert.doesNotMatch([...doc.querySelectorAll('meta')].map(n=>n.content).join(' '),/\?r=|\?promo=|email=|accessToken|customerId/);
  assert.match(html,/availability|Availability/);
});
test('five established translation catalogs contain all new customer marketing strings',async()=>{
  const languages=await Promise.all(['en','ht','fr','es','pt'].map(l=>import(`../js/translations/${l}.js`).then(m=>m.default)));
  const keys=Object.keys(languages[0]).filter(k=>k.startsWith('marketing'));
  assert.ok(keys.length>=35);for(const lang of languages)for(const key of keys)assert.ok(lang[key]);
});
import { mountRecharge } from '../js/recharge-page.js';
import { fixtureApi, quote, operator, products, countries } from './fixtures.mjs';
test('actual recharge review shows stored promotion benefit and terms without altering principal or total', async()=>{
  const dom=new JSDOM('<main data-recharge-root data-login-brand="flupflap"></main>',{url:'https://www.flupflap.com/'});
  globalThis.document=dom.window.document;
  const root=document.querySelector('main'), api=fixtureApi();const app=mountRecharge(root,{mobileRechargeLive:true},{api});
  try {
    document.querySelector('#email').value='fixture@example.test';document.querySelector('#password').value='test-only-password';
    document.querySelector('#login-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
    const reviewed={...quote,feeUsd:0.25,totalChargeUsd:7.75,promotion:{name:'Fixture promotion',originalFeeCents:50,benefitCents:25,firstRechargeOnly:true,testMode:true}};
    Object.assign(app.model.state,{countries,country:'JM',phone:quote.recipientPhone,operator,operators:[operator],product:products[0],products,quote:reviewed});app.model.emit();
    document.querySelector('#get-quote').click();await tick();
    const text=document.querySelector('#quote-details').textContent;
    assert.match(text,/Fixture promotion/);assert.match(text,/Original fee/);assert.match(text,/Promotion benefit/);assert.match(text,/First eligible recharge/);
    assert.match(text,/7\.75/);assert.equal(app.model.state.quote.providerAmount,7.5);assert.equal(app.model.state.quote.deliveredValue,1170);
    assert.equal(api.calls.filter(c=>c.path.endsWith('/payment-sessions')).length,0);
  } finally {app.dispose();dom.window.close();delete globalThis.document;}
});

test('new translated marketing copy is valid UTF-8 without replacement characters',()=>{
  for(const language of ['en','ht','fr','es','pt']){
    const text=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(`js/translations/${language}.js`));
    assert.ok(!text.includes('\uFFFD'));
  }
});
