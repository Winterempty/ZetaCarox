'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {createApp,money}=require('../src/app');
let app,base,owner,product,customer,supplier,invoice,purchase,viewer,staff;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zetacaros-test-')),dbPath=path.join(dir,'business.sqlite');
const date=new Date().toISOString().slice(0,10);
async function request(url,data,auth=owner,options={}){
  const headers={...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.user.csrf}:{}),...options.headers};
  if(data!==undefined)Object.assign(headers,{'Content-Type':'application/json',Origin:options.origin||base,'Idempotency-Key':options.key||crypto.randomUUID()});
  const res=await fetch(base+url,{method:data===undefined?'GET':'POST',headers,...(data===undefined?{}:{body:JSON.stringify(data)})});
  const type=res.headers.get('content-type')||'';const body=type.includes('json')?await res.json():Buffer.from(await res.arrayBuffer());
  return {status:res.status,body,cookie:res.headers.get('set-cookie')?.split(';')[0],headers:res.headers};
}
async function ok(url,data,auth=owner,opts={}){const r=await request(url,data,auth,opts);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
async function login(username,password='very-secure-password-123'){const r=await request('/api/login',{username,password},null);assert.equal(r.status,200);return {cookie:r.cookie,user:r.body.user};}
function start(){app=createApp({dbPath,setupToken:'test-setup'});return new Promise(resolve=>app.server.listen(0,'127.0.0.1',()=>{base=`http://127.0.0.1:${app.server.address().port}`;resolve();}));}
function stop(){return new Promise(resolve=>app.server.close(resolve));}
before(async()=>{await start();const r=await request('/api/setup',{setupToken:'test-setup',username:'owner',name:'Owner',password:'very-secure-password-123'},null);assert.equal(r.status,200,JSON.stringify(r.body));owner={cookie:r.cookie,user:r.body.user};});
after(async()=>{if(app.server.listening)await stop();fs.rmSync(dir,{recursive:true,force:true});});
test('strict monetary input prevents floating point and malformed values',()=>{assert.equal(money('0.29'),29);assert.equal(money('1234.50'),123450);for(const n of ['1.001','-1','NaN','1e3',' 1','01','Infinity',5])assert.throws(()=>money(n));});
test('setup is one-time; unauthenticated and cross-origin access denied',async()=>{
  assert.equal((await request('/api/state',undefined,null)).status,401);
  assert.equal((await request('/api/setup',{username:'owner',setupToken:'test-setup'},null)).status,409);
  assert.equal((await request('/api/products',{},owner,{origin:'https://evil.example'})).status,403);
  assert.equal((await request('/api/products',{},owner,{headers:{'X-CSRF-Token':'wrong'}})).status,403);
  const h=await request('/');assert.match(h.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('create contacts and persistent inventory; reject duplicate SKU',async()=>{
  customer=(await ok('/api/contacts',{name:'ลูกค้า ทดสอบ',kind:'customer',email:'',phone:'',address:'Bangkok'})).id;
  supplier=(await ok('/api/contacts',{name:'Supplier',kind:'supplier',email:'',phone:'',address:''})).id;
  product=(await ok('/api/products',{sku:'W-1',name:'Widget',price:'10.25',cost:'4.00',stock:10,reorder:3})).id;
  assert.equal((await request('/api/products',{sku:'w-1',name:'Duplicate',price:'1',cost:'1',stock:0,reorder:0})).status,409);
  assert.equal((await ok('/api/state')).contacts.find(c=>c.id===customer).name,'ลูกค้า ทดสอบ');
});
test('invoice totals, tax rounding, stock deduction and duplicate protection',async()=>{
  const key=crypto.randomUUID(),payload={customer_id:customer,issued:date,due:date,tax_bps:700,note:'Sale',lines:[{product_id:product,quantity:3}]};
  const a=await ok('/api/invoices',payload,owner,{key});const b=await ok('/api/invoices',payload,owner,{key});assert.equal(a.id,b.id);invoice=a.id;
  const i=await ok(`/api/invoices/${invoice}`);assert.equal(i.subtotal,3075);assert.equal(i.tax,215);assert.equal(i.total,3290);
  const state=await ok('/api/state');assert.equal(state.products[0].stock,7);assert.equal(state.invoices.length,1);
  assert.equal((await request('/api/invoices',{...payload,note:'Changed'},owner,{key})).status,409);
});
test('failed multi-line invoices roll back all effects',async()=>{
  const p=(await ok('/api/products',{sku:'W-2',name:'Second',price:'3.00',cost:'1.00',stock:2,reorder:0})).id;
  const before=await ok('/api/state');
  const result=await request('/api/invoices',{customer_id:customer,issued:date,due:date,tax_bps:0,lines:[{product_id:product,quantity:1},{product_id:p,quantity:3}]});assert.equal(result.status,409);
  const after=await ok('/api/state');assert.deepEqual(after.products,before.products);assert.equal(after.invoices.length,before.invoices.length);
  assert.equal((await request(`/api/products/${product}/adjust`,{delta:-99,reason:'Test'})).status,409);
  assert.equal((await request('/api/invoices',{customer_id:customer,issued:date,due:'2026-02-30',tax_bps:0,lines:[{product_id:product,quantity:1}]})).status,400);
});
test('partial payments, overpayment prevention and idempotency',async()=>{
  const key=crypto.randomUUID(),payload={amount:'10.00',date,reference:'Bank'};
  await ok(`/api/invoices/${invoice}/payments`,payload,owner,{key});await ok(`/api/invoices/${invoice}/payments`,payload,owner,{key});
  let i=await ok(`/api/invoices/${invoice}`);assert.equal(i.paid,1000);assert.equal(i.payments.length,1);
  assert.equal((await request(`/api/invoices/${invoice}/payments`,{amount:'22.91',date,reference:''})).status,409);
  assert.equal((await request(`/api/invoices/${invoice}/void`,{reason:'Cannot void paid'})).status,409);
  await ok(`/api/invoices/${invoice}/payments`,{amount:'22.90',date,reference:'Balance'});i=await ok(`/api/invoices/${invoice}`);assert.equal(i.paid,i.total);
});
test('void invoice restocks once and keeps history',async()=>{
  const id=(await ok('/api/invoices',{customer_id:customer,issued:date,due:date,tax_bps:0,lines:[{product_id:product,quantity:2}]})).id;
  await ok(`/api/invoices/${id}/void`,{reason:'Customer cancelled'});
  assert.equal((await request(`/api/invoices/${id}/void`,{reason:'Again'})).status,409);
  const s=await ok('/api/state');assert.equal(s.products.find(p=>p.id===product).stock,7);assert.equal(s.invoices.find(i=>i.id===id).status,'void');
});
test('purchase receive is atomic, once-only, and does not invent a cash expense',async()=>{
  purchase=(await ok('/api/purchases',{supplier_id:supplier,note:'Restock',lines:[{product_id:product,quantity:5,cost:'4.00'}]})).id;
  await ok(`/api/purchases/${purchase}/receive`,{});assert.equal((await request(`/api/purchases/${purchase}/receive`,{})).status,409);
  const s=await ok('/api/state');assert.equal(s.products.find(p=>p.id===product).stock,12);assert.equal(s.expenses.length,0);assert.equal(s.purchases[0].status,'received');
});
test('expense void updates cash summary without erasing history',async()=>{
  const id=(await ok('/api/expenses',{date,amount:'15.00',category:'Utilities',payee:'Power',note:''})).id;
  assert.equal((await ok('/api/state')).summary.cashNet,1790);
  await ok(`/api/expenses/${id}/void`,{reason:'Wrong amount'});const s=await ok('/api/state');assert.equal(s.summary.cashNet,3290);assert.equal(s.expenses[0].voided,1);
});
test('roles, disabled users, and stale updates enforced server-side',async()=>{
  const sid=(await ok('/api/users',{username:'staff',name:'Staff',password:'very-secure-password-123',role:'staff'})).id;
  await ok('/api/users',{username:'viewer',name:'Viewer',password:'very-secure-password-123',role:'viewer'});staff=await login('staff');viewer=await login('viewer');
  assert.equal((await request('/api/products',{},viewer)).status,403);assert.equal((await request('/api/users',{},staff)).status,403);assert.equal((await request('/api/backup',undefined,staff)).status,403);
  const s=await ok('/api/state',undefined,viewer);assert.equal(s.users.length,0);assert.equal(s.audit.length,0);
  const p=s.products.find(p=>p.id===product),edit={name:p.name,price:'11.25',cost:'4.00',reorder:3,active:1,version:p.version};
  await ok(`/api/products/${p.id}/edit`,edit);assert.equal((await request(`/api/products/${p.id}/edit`,edit)).status,409);
  assert.equal((await ok(`/api/invoices/${invoice}`)).lines[0].price,1025);
  await ok(`/api/users/${sid}/access`,{role:'staff',active:0});assert.equal((await request('/api/state',undefined,staff)).status,401);
});
test('currency lock and spreadsheet-safe exports',async()=>{
  const s=await ok('/api/state');assert.equal((await request('/api/settings',{name:'Test',currency:'USD',address:'',version:s.settings.version})).status,400);
  await ok('/api/contacts',{name:'=SUM(1,2)',kind:'customer',email:'',phone:'',address:''});const r=await request('/api/export?table=contacts');assert.equal(r.status,200);assert.match(r.body.toString(),/"'=SUM\(1,2\)"/);
  assert.equal((await request('/api/export?table=users')).status,400);
});
test('parallel overselling attempts allow only the available quantity',async()=>{
  const pid=(await ok('/api/products',{sku:'LAST',name:'Last item',price:'1.00',cost:'0',stock:1,reorder:0})).id;
  const payload={customer_id:customer,issued:date,due:date,tax_bps:0,lines:[{product_id:pid,quantity:1}]};
  const result=await Promise.all([request('/api/invoices',payload),request('/api/invoices',payload)]);assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
});
test('backup integrity, restart persistence, offline restore and session invalidation',async()=>{
  const r=await request('/api/backup');assert.equal(r.status,200);const backup=path.join(dir,'saved.sqlite');fs.writeFileSync(backup,r.body);require('../src/maintenance').check(backup);
  const locked=spawnSync(process.execPath,[path.resolve(__dirname,'../src/maintenance.js'),'restore',backup,'--confirm'],{env:{...process.env,DB_PATH:dbPath},encoding:'utf8'});assert.notEqual(locked.status,0);assert.match(locked.stderr,/Database is in use/);
  const count=(await ok('/api/state')).invoices.length;await stop();await start();assert.equal((await ok('/api/state')).invoices.length,count);
  await ok('/api/contacts',{name:'After backup',kind:'customer',email:'',phone:'',address:''});await stop();
  const restore=spawnSync(process.execPath,[path.resolve(__dirname,'../src/maintenance.js'),'restore',backup,'--confirm'],{env:{...process.env,DB_PATH:dbPath},encoding:'utf8'});assert.equal(restore.status,0,restore.stderr);await start();
  assert.equal((await request('/api/state')).status,401);owner=await login('owner');assert.equal((await ok('/api/state')).contacts.some(c=>c.name==='After backup'),false);
});
test('password change invalidates sessions; login rejects old password',async()=>{
  await ok('/api/password',{current:'very-secure-password-123',password:'new-password-safe-456'});
  assert.equal((await request('/api/state')).status,401);assert.equal((await request('/api/login',{username:'owner',password:'very-secure-password-123'},null)).status,401);
  owner=await login('owner','new-password-safe-456');assert.equal((await request('/api/state')).status,200);
});
test('contact edits preserve invoice snapshots and reject stale or viewer writes',async()=>{
  const c=(await ok('/api/state')).contacts.find(c=>c.id===customer);
  const payload={name:'ลูกค้าใหม่',email:'new@example.test',phone:'0800000000',address:'New address',expected:c};
  await ok(`/api/contacts/${c.id}/edit`,payload);
  assert.equal((await ok('/api/state')).contacts.find(r=>r.id===c.id).name,'ลูกค้าใหม่');
  assert.equal((await ok(`/api/invoices/${invoice}`)).customer_name,'ลูกค้า ทดสอบ');
  assert.equal((await request(`/api/contacts/${c.id}/edit`,payload)).status,409);
  const reader=await login('viewer');assert.equal((await request(`/api/contacts/${c.id}/edit`,payload,reader)).status,403);
});
test('display CSV uses Thai headings, major units and computed balances without changing raw exports',async()=>{
  const r=await request('/api/export?table=invoices&format=display&lang=th');assert.equal(r.status,200);const text=r.body.toString();assert.match(text,/ยอดรวม \(THB\)/);assert.match(text,/ยอดค้างชำระ \(THB\)/);assert.match(text,/"32\.90"/);assert.match(text,/"7\.00"/);assert.match(text,/ชำระแล้ว/);
  const raw=(await request('/api/export?table=invoices')).body.toString();assert.match(raw,/"tax_bps"/);assert.match(raw,/"3290"/);
  const contacts=(await request('/api/export?table=contacts&format=display&lang=th')).body.toString();assert.match(contacts,/"'=SUM\(1,2\)"/);
});
test('language script is served locally with the existing content security policy',async()=>{
  const r=await request('/i18n.js',undefined,null);assert.equal(r.status,200);assert.match(r.body.toString(),/let language='en'/);assert.match(r.headers.get('content-type'),/javascript/);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
});
