'use strict';
// Optional interaction tests using jsdom (not a rendering browser).
const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../src/app');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zc-ui-'));const app=createApp({dbPath:path.join(dir,'test.sqlite'),setupToken:'test-setup-only'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 const html=fs.readFileSync(path.resolve(__dirname,'../../public/index.html'),'utf8');
 const dom=new JSDOM(html,{url:base,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,d=w.document;let cookie='';const faults=[];w.addEventListener('error',e=>faults.push(e.message));
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(url,options={})=>{const response=await fetch(base+url,{...options,headers:{...options.headers,Origin:base,...(cookie?{Cookie:cookie}:{})}});const c=response.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return response;};
 const check=async(condition,label)=>{const end=Date.now()+5000;while(!condition()){if(Date.now()>end)throw new Error('Timed out: '+label+' '+d.querySelector('.form-error')?.textContent);await new Promise(r=>setTimeout(r,10));}};
 const change=(selector,value)=>{const el=d.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 const fill=(name,value)=>{const el=d.querySelector(`[name="${name}"]`);assert.ok(el,name);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const click=selector=>{const el=d.querySelector(selector);assert.ok(el,selector);el.click();};
 const submit=async()=>{const form=d.querySelector('#modal-form');assert.ok(form.checkValidity(),form.outerHTML);form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await check(()=>!d.querySelector('dialog').open,'save dialog');await check(()=>d.querySelector('[data-view]'),'refresh');};
 try{
   for(const file of ['i18n.js','health.js','app.js'])new (require('node:vm').Script)(fs.readFileSync(path.resolve(__dirname,'../../public',file),'utf8')).runInContext(dom.getInternalVMContext());
   await check(()=>d.querySelector('#auth-form'),'setup');assert.equal(d.documentElement.lang,'en');
   fill('name','เจ้าของร้าน');fill('username','owner');fill('password','test-password-123');fill('setupToken','test-setup-only');
   change('[data-preference="language"]','th');assert.equal(d.documentElement.lang,'th');assert.equal(d.querySelector('[name="name"]').value,'เจ้าของร้าน');assert.equal(d.querySelector('[name="password"]').value,'test-password-123');assert.equal(w.localStorage.getItem('zetacaros.language'),'th');assert.match(d.body.textContent,/ไม่ต้องคิดรหัสนี้ขึ้นเอง/);
   click('[data-action="toggle-password"]');assert.equal(d.querySelector('[name="password"]').type,'text');click('[data-action="toggle-password"]');assert.equal(d.querySelector('[name="password"]').type,'password');
   d.querySelector('#auth-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await check(()=>d.querySelector('[data-view="overview"]'),'owner setup');
   change('[data-preference="text-size"]','large');assert.equal(d.documentElement.dataset.textSize,'large');assert.equal(w.localStorage.getItem('zetacaros.text-size'),'large');
   click('[data-view="settings"]');fill('name','ร้านทดสอบ');change('[data-preference="language"]','en');assert.equal(d.querySelector('[name="name"]').value,'ร้านทดสอบ');change('[data-preference="language"]','th');
   d.querySelector('#settings-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await check(()=>d.querySelector('.workspace-name')?.textContent==='ร้านทดสอบ','save settings');
   click('[data-view="inventory"]');click('[data-action="product"]');fill('sku','TH-01');fill('name','ชาไทย');fill('price','50.25');fill('cost','20.00');fill('stock','10');await submit();
   await check(()=>d.querySelector('table')?.textContent.includes('ชาไทย'),'new product');
   const input=d.querySelector('#search');input.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true}));input.value='ชา';input.dispatchEvent(new w.InputEvent('input',{bubbles:true,isComposing:true}));assert.equal(d.querySelector('#search'),input);input.dispatchEvent(new w.CompositionEvent('compositionend',{bubbles:true}));assert.equal(d.querySelector('#search').value,'ชา');assert.match(d.querySelector('table').textContent,/ชาไทย/);
   click('[data-view="contacts"]');click('[data-action="contact"]');fill('name','Customer');await submit();await check(()=>d.querySelector('table')?.textContent.includes('Customer'),'customer saved');
   click('[data-view="invoices"]');click('[data-action="invoice"]');assert.equal(d.querySelector('[name="customer_id"] option').textContent,'Customer');fill('quantity','2');await submit();await check(()=>d.querySelector('[data-action="view-invoice"]'),'new invoice');
   click('[data-action="view-invoice"]');await check(()=>d.querySelector('#dialog-title')?.textContent==='รายละเอียดใบแจ้งหนี้','invoice details');assert.match(d.querySelector('#print-area').textContent,/ใบแจ้งหนี้/);assert.match(d.querySelector('#print-area').textContent,/ไม่ได้ถือเป็นใบกำกับภาษี/);
   const event=new w.Event('submit',{bubbles:true,cancelable:true});d.querySelector('#modal-form').dispatchEvent(event);assert.equal(event.defaultPrevented,true);
   click('[data-action="payment"]');await check(()=>d.querySelector('[name="amount"]'),'payment form');fill('amount','999.00');d.querySelector('#modal-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await check(()=>d.querySelector('.form-error')?.textContent.includes('มากกว่ายอดค้างชำระ'),'Thai server error');assert.equal(d.querySelector('#modal-form').inert,false);fill('amount','20.00');await submit();
   for(const [offset,quantity] of [[-2,'1'],[-1,'2']]){const month=new Date();month.setUTCDate(1);month.setUTCMonth(month.getUTCMonth()+offset);click('[data-view="invoices"]');click('[data-action="invoice"]');fill('issued',month.toISOString().slice(0,10));fill('quantity',quantity);await submit();await check(()=>d.querySelector('[data-action="view-invoice"]'),'historical invoice');}
   click('[data-view="health"]');assert.ok(d.querySelector('svg path.health-series'));assert.match(d.querySelector('#view-content').textContent,/100%/);
   for(const lang of ['en','th']){change('[data-preference="language"]',lang);for(const view of ['overview','health','inventory','invoices','purchases','contacts','expenses','reports','settings']){click(`[data-view="${view}"]`);assert.ok(d.querySelector('h1'));assert.doesNotMatch(d.querySelector('#view-content').textContent,/\$\{|undefined|NaN/);}}
   click('[data-view="health"]');assert.match(d.querySelector('#view-content').textContent,/ควรทำอะไรต่อ/);change('[data-health-metric]','cash');assert.equal(d.querySelector('[data-health-metric]').value,'cash');click('[data-action="health-action"]');await check(()=>d.querySelector('#view-content')||d.querySelector('dialog').open,'health action');
   if(d.querySelector('dialog').open)click('[data-action="close"]');
   // Product/contacts names must never be passed through the UI dictionary.
   click('[data-view="contacts"]');assert.match(d.querySelector('table').textContent,/Customer/);assert.doesNotMatch(d.querySelector('table').textContent,/undefined/);
   click('[data-action="edit-contact"]');fill('phone','0812345678');await submit();await check(()=>d.querySelector('table')?.textContent.includes('0812345678'),'contact edit');
   click('[data-view="reports"]');assert.match(d.querySelector('a[href*="format=display"]').getAttribute('href'),/lang=th/);
   click('[data-view="expenses"]');click('[data-action="expense"]');fill('amount','10.00');fill('payee','ค่าอุปกรณ์');await submit();await check(()=>d.querySelector('table')?.textContent.includes('ค่าอุปกรณ์'),'expense saved');
   change('[data-preference="language"]','en');assert.equal(d.documentElement.lang,'en');assert.equal(w.localStorage.getItem('zetacaros.language'),'en');assert.deepEqual(faults,[]);
   console.log('PASS: DOM interaction suite — language persistence, draft retention, password visibility, setup, font preference, business settings, Thai products/search composition, unchanged customer names, invoices/print text, read-only Enter, translated overpayment, payment retry, all nine screens in both languages, contact edit, localized export links, expenses.');
 }finally{w.close();await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
