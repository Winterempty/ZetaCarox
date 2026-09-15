'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {spawnSync}=require('node:child_process');
const {createApp}=require('../src/app');const {parseCSV}=require('../src/stock');const {openDatabase}=require('../src/database');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zc-inventory-'));let app,base,owner;
async function req(url,data,auth=owner,key=crypto.randomUUID()){
  const res=await fetch(base+url,{method:data===undefined?'GET':'POST',headers:{...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.user.csrf}:{}),...(data===undefined?{}:{Origin:base,'Content-Type':'application/json','Idempotency-Key':key})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:res.status,body:res.headers.get('content-type').includes('json')?await res.json():Buffer.from(await res.arrayBuffer()),cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
async function ok(url,data,auth=owner,key){const r=await req(url,data,auth,key);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
before(async()=>{app=createApp({dbPath:path.join(dir,'shop.sqlite'),setupToken:'test-code'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;const r=await req('/api/setup',{username:'owner',password:'a-secure-password-123',name:'Owner',setupToken:'test-code'},null);assert.equal(r.status,200);owner={cookie:r.cookie,user:r.body.user};});
after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
const csv='\uFEFFsku,name,price,cost,stock,reorder,barcode\r\nTEA,"ชา, Jasmine",35.50,20.00,12,3,0001234567895\r\nCOFFEE,"Coffee ""House""",55,25,5,2,8851234567898\r\n';
test('fresh database is empty; no invented sales in either trend period',async()=>{const s=await ok('/api/state');assert.equal(s.products.length,0);for(const days of [7,30]){const o=await ok('/api/overview?days='+days);assert.equal(o.current,0);assert.equal(o.previous,0);assert.equal(o.percent,null);assert.equal(o.direction,'flat');assert.equal(o.series.length,days);assert.equal(o.series.reduce((s,r)=>s+r.total,0),0);}});
test('CSV parser supports BOM, quotes, line breaks, semicolon and tabs; rejects malformed input',()=>{
  assert.equal(parseCSV(csv)[1][1],'ชา, Jasmine');assert.equal(parseCSV(csv)[2][1],'Coffee "House"');
  assert.equal(parseCSV('a;b\r\n"line\nnext";c')[1][0],'line\nnext');assert.deepEqual(parseCSV('a\tb\n1\t2'),[['a','b'],['1','2']]);
  for(const text of ['a,b\n"open,x','a,b\nhello"x,y','a,b\n"x"z,y','a,b','x'.repeat(262145)])assert.throws(()=>parseCSV(text));
});
test('CSV preview is read-only; commit requires token and preserves leading zero barcode',async()=>{
  const p=await ok('/api/import/preview',{csv});assert.equal(p.valid,true);assert.equal((await ok('/api/state')).products.length,0);
  assert.equal((await req('/api/import/commit',{csv})).status,409);
  const key=crypto.randomUUID(),payload={csv,token:p.token};const a=await ok('/api/import/commit',payload,owner,key),b=await ok('/api/import/commit',payload,owner,key);assert.equal(a.count,2);assert.deepEqual(a,b);
  const s=await ok('/api/state');assert.equal(s.products.length,2);assert.equal(s.products.find(p=>p.sku==='TEA').barcode,'0001234567895');assert.equal(s.movements.length,2);
});
test('CSV reports all row errors and imports nothing when any row is invalid',async()=>{
  const bad='sku,name,price,cost,stock,reorder,barcode\nNEW,Good,1,0,1,0,\nBAD,Invalid,1.001,0,1,0,\nTEA,Duplicate,1,0,1,0,';
  const p=await ok('/api/import/preview',{csv:bad});assert.equal(p.valid,false);assert.equal(p.rows.filter(r=>r.error).length,2);assert.equal((await req('/api/import/commit',{csv:bad,token:'x'})).status,400);assert.equal((await ok('/api/state')).products.length,2);
  const duplicate='sku,name,price,cost,stock,reorder,barcode\nAAA,One,1,0,1,0,BBB\nBBB,Two,1,0,1,0,';assert.equal((await ok('/api/import/preview',{csv:duplicate})).valid,false);
  assert.equal((await req('/api/import/preview',{csv:'sku,name,name\nA,A,A'})).status,400);
});
test('stale preview cannot silently commit after stock changes',async()=>{
  const fresh='sku,name,price,cost,stock,reorder\nNEW,New product,1,0,1,0';const p=await ok('/api/import/preview',{csv:fresh});const tea=(await ok('/api/state')).products.find(p=>p.sku==='TEA');await ok(`/api/products/${tea.id}/adjust`,{delta:1,reason:'Restock',version:tea.version});assert.equal((await req('/api/import/commit',{csv:fresh,token:p.token})).status,409);
});
test('barcode uniqueness and SKU collisions are enforced; edits preserve previous barcode',async()=>{
  const tea=(await ok('/api/state')).products.find(p=>p.sku==='TEA');
  for(const data of [{sku:'OTHER',barcode:tea.barcode},{sku:tea.barcode,barcode:''},{sku:'OTHER',barcode:'TEA'}])assert.equal((await req('/api/products',{name:'Conflict',price:'1',cost:'0',stock:0,reorder:0,...data})).status,409);
  await ok(`/api/products/${tea.id}/edit`,{name:tea.name,price:'35.50',cost:'20',reorder:3,active:1,version:tea.version});assert.equal((await ok('/api/state')).products.find(p=>p.id===tea.id).barcode,tea.barcode);
});
test('confirmed sales are atomic, idempotent, use cents and reject stale/overselling/future input',async()=>{
  const p=(await ok('/api/state')).products.find(p=>p.sku==='TEA'),o=await ok('/api/overview');const payload={product_id:p.id,quantity:2,version:p.version,date:o.businessDay,note:'Test sale'},key=crypto.randomUUID();
  const a=await ok('/api/sales',payload,owner,key);assert.equal(a.total,7100);assert.deepEqual(await ok('/api/sales',payload,owner,key),a);
  assert.equal((await req('/api/sales',payload)).status,409);
  const s=await ok('/api/state'),updated=s.products.find(x=>x.id===p.id);assert.equal(updated.stock,p.stock-2);assert.equal(s.movements[0].delta,-2);
  assert.equal((await req('/api/sales',{...payload,version:updated.version,quantity:100})).status,409);
  assert.equal((await req('/api/sales',{...payload,version:updated.version,date:'9999-01-01'})).status,400);
  assert.equal((await ok('/api/overview')).sales.length,1);
});
test('sales trend uses current and previous dates, excludes void invoices, handles zero base',async()=>{
  let o=await ok('/api/overview');assert.equal(o.current,7100);assert.equal(o.percent,null);assert.equal(o.direction,'up');
  const p=(await ok('/api/state')).products.find(x=>x.sku==='TEA');const earlier=new Date(Date.parse(o.businessDay+'T12:00:00Z')-8*86400000).toISOString().slice(0,10);
  await ok('/api/sales',{product_id:p.id,quantity:4,version:p.version,date:earlier});
  o=await ok('/api/overview');assert.equal(o.previous,14200);assert.equal(o.percent,-50);assert.equal(o.direction,'down');assert.equal(o.series.reduce((s,r)=>s+r.total,0),o.current);
  const customer=(await ok('/api/contacts',{name:'Customer',kind:'customer'})).id;
  const invoice=(await ok('/api/invoices',{customer_id:customer,issued:o.businessDay,due:o.businessDay,tax_bps:700,lines:[{product_id:p.id,quantity:1}]})).id;
  assert.equal((await ok('/api/overview')).current,10650);await ok(`/api/invoices/${invoice}/void`,{reason:'Test void'});assert.equal((await ok('/api/overview')).current,7100);
  assert.equal((await ok('/api/overview?days=30')).current,21300);assert.equal((await req('/api/overview?days=0')).status,400);
});
test('concurrent final-item sales cannot oversell',async()=>{
  const id=(await ok('/api/products',{sku:'LAST',name:'Last',price:'1',cost:'0',stock:1,reorder:0})).id;const p=(await ok('/api/state')).products.find(p=>p.id===id);const data={product_id:id,quantity:1,version:p.version,date:(await ok('/api/overview')).businessDay};const r=await Promise.all([req('/api/sales',data),req('/api/sales',data)]);assert.deepEqual(r.map(r=>r.status).sort(),[200,409]);assert.equal((await ok('/api/state')).products.find(p=>p.id===id).stock,0);
});
test('viewer cannot preview imports, sell or adjust; history is paginated without losing old records',async()=>{
  await ok('/api/users',{name:'Viewer',username:'reader',password:'reader-password-123',role:'viewer'});const r=await req('/api/login',{username:'reader',password:'reader-password-123'},null),reader={user:r.body.user,cookie:r.cookie};for(const url of ['/api/import/preview','/api/import/commit','/api/sales','/api/products/1/adjust'])assert.equal((await req(url,{csv},reader)).status,403);
  const p=(await ok('/api/state')).products.find(x=>x.sku==='TEA');for(let i=0;i<55;i++)await ok(`/api/products/${p.id}/adjust`,{delta:1,reason:'Pagination test'});
  const first=await ok('/api/history?page=1'),second=await ok('/api/history?page=2');assert.equal(first.rows.length,50);assert.ok(second.rows.length>0);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,first.total);assert.equal((await req('/api/history?page=-1')).status,400);
});
test('inventory CSV uses major money units and BOM; spreadsheet formula injection is escaped',async()=>{
  await ok('/api/products',{sku:'FORMULA',name:'=SUM(1,2)',price:'10.25',cost:'0.29',stock:1,reorder:0});const r=await req('/api/inventory.csv');assert.equal(r.status,200);const text=r.body.toString();assert.ok(text.startsWith('\uFEFF'));assert.match(text,/"10\.25"/);assert.match(text,/"0\.29"/);assert.match(text,/"'=SUM\(1,2\)"/);assert.match(text,/0001234567895/);
  const report=await req('/api/export?table=sales&format=display');assert.match(report.body.toString(),/71\.00/);
});
test('backup includes sales and retains integrity; v1 migration snapshots and preserves records',async()=>{
  const backup=await req('/api/backup');const b=path.join(dir,'backup.sqlite');fs.writeFileSync(b,backup.body);require('../src/maintenance').check(b);const snap=new DatabaseSync(b,{readOnly:true});assert.ok(snap.prepare('SELECT COUNT(*) n FROM sales').get().n>0);snap.close();
  const old=path.join(dir,'old-v1.sqlite');let db=openDatabase(old);db.exec("INSERT INTO users(username,name,password,role) VALUES('legacy','Original owner','hash','admin'); INSERT INTO products(sku,name,price,cost,stock,reorder) VALUES('OLD','สินค้าเดิม',1234,500,7,3); INSERT INTO movements(product_id,delta,reason,date,user_id) VALUES(1,7,'Opening stock','2024-01-01',1); DROP TABLE sales; DROP INDEX product_barcode; ALTER TABLE products DROP COLUMN barcode; PRAGMA user_version=1;");db.close();
  const before=fs.readFileSync(old);db=openDatabase(old);assert.equal(db.prepare('SELECT name FROM products').get().name,'สินค้าเดิม');assert.equal(db.prepare('SELECT stock FROM products').get().stock,7);assert.equal(db.prepare('SELECT COUNT(*) n FROM movements').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n,0);db.close();
  const snapshots=fs.readdirSync(dir).filter(f=>f.startsWith('old-v1.sqlite.before-v2-'));assert.equal(snapshots.length,1);const original=new DatabaseSync(path.join(dir,snapshots[0]),{readOnly:true});assert.equal(original.prepare('PRAGMA user_version').get().user_version,1);assert.equal(original.prepare('SELECT stock FROM products').get().stock,7);original.close();assert.ok(before.length>0);
});
test('offline restore to a new installation accepts v1 and preserves the source',()=>{
  const source=path.join(dir,fs.readdirSync(dir).find(f=>f.startsWith('old-v1.sqlite.before-v2-'))),hash=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),dest=path.join(dir,'new-install','shop.sqlite');
  const r=spawnSync(process.execPath,[path.resolve(__dirname,'../src/maintenance.js'),'restore',source,'--confirm'],{env:{...process.env,DB_PATH:dest},encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),hash);const db=openDatabase(dest);assert.equal(db.prepare('SELECT stock FROM products').get().stock,7);assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);db.close();
});
