'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {openDatabase} = require('./database');
const {acquireLock} = require('./lock');
const {displayReport} = require('./reports');
const {businessHealth} = require('./health');
const {stockAPI}=require('./stock');
const ROOT = path.resolve(__dirname, '../..');
const iso = () => new Date().toISOString();
const today = () => iso().slice(0,10);
class Problem extends Error { constructor(message, status=400) { super(message); this.status=status; } }
function need(condition, message, status=400) { if (!condition) throw new Problem(message,status); }
function str(value, name, max=160, optional=false) {
  need(typeof value==='string', `${name} must be text.`);
  const v=value.trim(); need((optional || v.length>0) && v.length<=max, `${name} must be ${optional?'0':'1'}–${max} characters.`); return v;
}
function integer(v, name, min=0, max=1000000) { need(Number.isSafeInteger(v) && v>=min && v<=max, `${name} must be a whole number from ${min} to ${max}.`); return v; }
function money(v, name='Amount', allowZero=true) {
  need(typeof v==='string' && /^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(v), `${name} must be a positive amount with at most 2 decimal places.`);
  const [whole,fraction='']=v.split('.'); const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  need(allowZero || n>0, `${name} must be greater than zero.`); return n;
}
function date(v,name='Date') { need(typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v, `${name} is invalid.`); return v; }
function password(v) { need(typeof v==='string' && v.length>=12 && v.length<=128,'Password must contain 12–128 characters.'); return v; }
function hashPassword(v) { const salt=crypto.randomBytes(16).toString('hex'); return salt+':'+crypto.scryptSync(v,salt,64).toString('hex'); }
function matches(v, hash) { const [salt,digest]=hash.split(':'); return crypto.timingSafeEqual(crypto.scryptSync(v,salt,64),Buffer.from(digest,'hex')); }
function token() { return crypto.randomBytes(32).toString('hex'); }
function digest(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
function createApp(options={}) {
  const publicOrigin=options.publicOrigin || process.env.PUBLIC_ORIGIN;
  if(publicOrigin) need(new URL(publicOrigin).origin===publicOrigin && publicOrigin.startsWith('https://'),'PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash.');
  const filename=path.resolve(options.dbPath || process.env.DB_PATH || path.join(ROOT,'data/business.sqlite'));
  const release=acquireLock(filename);
  let db;try{db=openDatabase(filename);}catch(e){release();throw e;}
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const setupToken=options.setupToken || token();
  const secure=publicOrigin?.startsWith('https://');
  const attempts=new Map();
  const dummyHash=hashPassword(token());
  function businessDay() { return new Intl.DateTimeFormat('en-CA',{timeZone:get('SELECT timezone FROM settings WHERE id=1').timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
  function audit(user,action,entity,detail='') { run('INSERT INTO audit(date,user_id,action,entity,detail) VALUES(?,?,?,?,?)',iso(),user?.id??null,action,String(entity),detail); }
  function movement(user,id,delta,reason) { run('INSERT INTO movements(product_id,delta,reason,date,user_id) VALUES(?,?,?,?,?)',id,delta,reason,iso(),user.id); }
  function actor(req) {
    const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('zc_session='));
    const t=cookie?.slice(11); if (!t) return null;
    return get('SELECT users.id,users.username,users.name,users.role,sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>? AND users.active=1',digest(t),Date.now());
  }
  function session(user) {
    const t=token(), csrf=token();
    run('DELETE FROM sessions WHERE expires<=?',Date.now());
    run('INSERT INTO sessions VALUES(?,?,?,?)',digest(t),user.id,csrf,Date.now()+8*3600000);
    return {cookie:`zc_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure?'; Secure':''}`,user:{id:user.id,name:user.name,username:user.username,role:user.role,csrf}};
  }
  function role(user,...roles) { need(roles.includes(user.role),'Your role cannot perform this action.',403); }
  function existing(table,id) { integer(id,'Record ID',1); const r=get(`SELECT * FROM ${table} WHERE id=?`,id); need(r,'Record not found.',404); return r; }
  function lines(data,kind) {
    need(Array.isArray(data.lines) && data.lines.length>0 && data.lines.length<=100,'Add 1–100 product lines.');
    const seen=new Set();
    return data.lines.map(l=>{
      const p=existing('products',l.product_id); need(p.active,'This product is archived.'); need(!seen.has(p.id),'Combine repeated products into one line.'); seen.add(p.id);
      const quantity=integer(l.quantity,'Quantity',1,100000);
      if(kind==='sale' && l.expected_price!==undefined) need(l.expected_price===p.price,`Price changed for ${p.name}. Refresh before issuing.`,409);
      if(kind==='sale') need(p.stock>=quantity,`Insufficient stock for ${p.name}.`,409);
      const amount=kind==='sale'?p.price:money(l.cost,'Unit cost');
      need(amount*quantity<=100000000000,'Line total is too large.');
      return {p,quantity,amount};
    });
  }
  function mutate(user,url,data) {
    const stockResult=stock.mutate(user,url,data);if(stockResult!==null)return stockResult;
    if(url==='/api/password') {
      const u=existing('users',user.id); need(typeof data.current==='string' && data.current.length<=128 && matches(data.current,u.password),'Current password is incorrect.',403);
      run('UPDATE users SET password=? WHERE id=?',hashPassword(password(data.password)),user.id);
      run('DELETE FROM sessions WHERE user_id=?',user.id); audit(user,'password.changed',user.id); return {message:'Password changed. Sign in again.'};
    }
    role(user,'admin','staff');
    if(url==='/api/contacts') {
      need(['customer','supplier'].includes(data.kind),'Choose customer or supplier.');
      const result=run('INSERT INTO contacts(name,kind,email,phone,address) VALUES(?,?,?,?,?)',str(data.name,'Name'),data.kind,str(data.email||'','Email',160,true),str(data.phone||'','Phone',50,true),str(data.address||'','Address',500,true));
      audit(user,'contact.created',result.lastInsertRowid); return {id:Number(result.lastInsertRowid)};
    }
    if(url.match(/^\/api\/contacts\/\d+\/edit$/)) {
      const c=existing('contacts',Number(url.split('/')[3]));
      need(data.expected && ['name','kind','email','phone','address'].every(key=>data.expected[key]===c[key]),'Contact changed. Refresh and try again.',409);
      run('UPDATE contacts SET name=?,email=?,phone=?,address=? WHERE id=?',str(data.name,'Name'),str(data.email||'','Email',160,true),str(data.phone||'','Phone',50,true),str(data.address||'','Address',500,true),c.id);
      audit(user,'contact.updated',c.id);return {ok:true};
    }
    if(url==='/api/products') {
      const barcode=stock.validateProduct(data);
      const result=run('INSERT INTO products(sku,name,price,cost,stock,reorder) VALUES(?,?,?,?,?,?)',str(data.sku,'SKU',60),str(data.name,'Product'),money(data.price,'Price'),money(data.cost,'Cost'),integer(data.stock,'Opening stock'),integer(data.reorder,'Reorder point'));
      run('UPDATE products SET barcode=? WHERE id=?',barcode,result.lastInsertRowid);
      movement(user,Number(result.lastInsertRowid),data.stock,'Opening stock'); audit(user,'product.created',result.lastInsertRowid); return {id:Number(result.lastInsertRowid)};
    }
    if(url.match(/^\/api\/products\/\d+\/edit$/)) {
      role(user,'admin'); const p=existing('products',Number(url.split('/')[3])); need(p.version===data.version,'Product changed. Refresh and try again.',409);
      const barcode=stock.validateProduct({barcode:data.barcode??p.barcode},p.id);
      run('UPDATE products SET barcode=? WHERE id=?',barcode,p.id);
      run('UPDATE products SET name=?,price=?,cost=?,reorder=?,active=?,version=version+1 WHERE id=?',str(data.name,'Product'),money(data.price,'Price'),money(data.cost,'Cost'),integer(data.reorder,'Reorder point'),integer(data.active,'Active',0,1),p.id);
      audit(user,'product.updated',p.id,JSON.stringify({before:{name:p.name,price:p.price,cost:p.cost,reorder:p.reorder,active:p.active},after:data})); return {ok:true};
    }
    if(url.match(/^\/api\/products\/\d+\/adjust$/)) {
      const p=existing('products',Number(url.split('/')[3])); need(p.active,'Product is archived.');
      if(data.version!==undefined)need(p.version===data.version,'Product changed. Refresh and confirm again.',409);
      const delta=integer(data.delta,'Stock change',-1000000,1000000); need(delta!==0,'Stock change cannot be zero.'); need(p.stock+delta>=0 && p.stock+delta<=1000000,'Stock must remain between 0 and 1,000,000.',409);
      const reason=str(data.reason,'Reason',300); run('UPDATE products SET stock=stock+?,version=version+1 WHERE id=?',delta,p.id); movement(user,p.id,delta,reason); audit(user,'stock.adjusted',p.id,JSON.stringify({delta,reason})); return {ok:true};
    }
    if(url==='/api/invoices') {
      const c=existing('contacts',data.customer_id); need(c.kind==='customer','Choose a customer.');
      const due=date(data.due,'Due date'), issued=date(data.issued,'Issue date'); need(due>=issued,'Due date cannot precede issue date.'); need(issued<=businessDay(),'Issue date cannot be in the future.');
      const ls=lines(data,'sale'), subtotal=ls.reduce((s,l)=>s+l.amount*l.quantity,0); need(subtotal>0 && subtotal<=100000000000,'Invoice subtotal must be positive and within the supported limit.');
      const bps=integer(data.tax_bps,'Tax rate',0,10000), tax=Number((BigInt(subtotal)*BigInt(bps)+5000n)/10000n);
      const s=get('SELECT * FROM settings WHERE id=1');
      const result=run('INSERT INTO invoices(customer_id,customer_name,customer_address,business_name,business_address,currency,issued,due,subtotal,tax_bps,tax,total,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',c.id,c.name,c.address,s.name,s.address,s.currency,issued,due,subtotal,bps,tax,subtotal+tax,str(data.note||'','Note',1000,true));
      const id=Number(result.lastInsertRowid);
      for(const l of ls) { run('INSERT INTO invoice_lines(invoice_id,product_id,name,sku,quantity,price,cost) VALUES(?,?,?,?,?,?,?)',id,l.p.id,l.p.name,l.p.sku,l.quantity,l.amount,l.p.cost); run('UPDATE products SET stock=stock-?,version=version+1 WHERE id=?',l.quantity,l.p.id); movement(user,l.p.id,-l.quantity,`Invoice INV-${id}`); }
      audit(user,'invoice.issued',id); return {id};
    }
    if(url.match(/^\/api\/invoices\/\d+\/payments$/)) {
      const inv=existing('invoices',Number(url.split('/')[3])); need(inv.status!=='void','Cannot pay a void invoice.',409);
      const amount=money(data.amount,'Payment',false); need(amount<=inv.total-inv.paid,'Payment exceeds the remaining balance.',409);
      const d=date(data.date); need(d>=inv.issued && d<=businessDay(),'Payment date must be between the issue date and today.');
      run('INSERT INTO payments(invoice_id,amount,date,reference) VALUES(?,?,?,?)',inv.id,amount,d,str(data.reference||'','Reference',160,true)); run('UPDATE invoices SET paid=paid+? WHERE id=?',amount,inv.id); audit(user,'payment.recorded',inv.id,JSON.stringify({amount,date:d})); return {ok:true};
    }
    if(url.match(/^\/api\/invoices\/\d+\/void$/)) {
      role(user,'admin'); const inv=existing('invoices',Number(url.split('/')[3])); need(inv.status!=='void' && inv.paid===0,'Only unpaid, active invoices can be voided.',409);
      const reason=str(data.reason,'Reason',300);
      for(const l of all('SELECT * FROM invoice_lines WHERE invoice_id=?',inv.id)) { const p=existing('products',l.product_id); need(p.stock+l.quantity<=1000000,'Restocking would exceed the stock limit.',409); run('UPDATE products SET stock=stock+?,version=version+1 WHERE id=?',l.quantity,l.product_id); movement(user,l.product_id,l.quantity,`Void INV-${inv.id}: ${reason}`); }
      run("UPDATE invoices SET status='void' WHERE id=?",inv.id); audit(user,'invoice.voided',inv.id,reason); return {ok:true};
    }
    if(url==='/api/purchases') {
      const s=existing('contacts',data.supplier_id); need(s.kind==='supplier','Choose a supplier.'); const ls=lines(data,'purchase'); const total=ls.reduce((n,l)=>n+l.amount*l.quantity,0); need(total<=100000000000,'Purchase total is too large.');
      const result=run('INSERT INTO purchases(supplier_id,supplier_name,date,total,note) VALUES(?,?,?,?,?)',s.id,s.name,businessDay(),total,str(data.note||'','Note',1000,true)); const id=Number(result.lastInsertRowid);
      for(const l of ls) run('INSERT INTO purchase_lines(purchase_id,product_id,name,quantity,cost) VALUES(?,?,?,?,?)',id,l.p.id,l.p.name,l.quantity,l.amount);
      audit(user,'purchase.ordered',id); return {id};
    }
    if(url.match(/^\/api\/purchases\/\d+\/(receive|cancel)$/)) {
      const p=existing('purchases',Number(url.split('/')[3])); need(p.status==='ordered','Purchase order has already been processed.',409);
      const receive=url.endsWith('/receive');
      if(receive) for(const l of all('SELECT * FROM purchase_lines WHERE purchase_id=?',p.id)) {
        const product=existing('products',l.product_id); need(product.stock+l.quantity<=1000000,'Receiving exceeds the stock limit.',409);
        run('UPDATE products SET stock=stock+?,version=version+1 WHERE id=?',l.quantity,l.product_id); movement(user,l.product_id,l.quantity,`Received PO-${p.id}`);
      }
      run('UPDATE purchases SET status=? WHERE id=?',receive?'received':'cancelled',p.id); audit(user,receive?'purchase.received':'purchase.cancelled',p.id); return {ok:true};
    }
    if(url==='/api/expenses') {
      const d=date(data.date); need(d<=businessDay(),'Expense date cannot be in the future.');
      const result=run('INSERT INTO expenses(date,category,payee,amount,note) VALUES(?,?,?,?,?)',d,str(data.category,'Category',80),str(data.payee,'Payee'),money(data.amount,'Expense',false),str(data.note||'','Note',500,true)); audit(user,'expense.recorded',result.lastInsertRowid); return {id:Number(result.lastInsertRowid)};
    }
    if(url.match(/^\/api\/expenses\/\d+\/void$/)) { role(user,'admin'); const e=existing('expenses',Number(url.split('/')[3])); need(!e.voided,'Expense already voided.',409); const reason=str(data.reason,'Reason',300); run('UPDATE expenses SET voided=1 WHERE id=?',e.id); audit(user,'expense.voided',e.id,reason); return {ok:true}; }
    role(user,'admin');
    if(url==='/api/settings') {
      const s=get('SELECT * FROM settings WHERE id=1'); need(s.version===data.version,'Settings changed. Refresh and try again.',409);
      need(['THB','USD','EUR','GBP','SGD'].includes(data.currency),'Unsupported currency.');
      const hasMoney=get('SELECT (SELECT COUNT(*) FROM products)+(SELECT COUNT(*) FROM invoices)+(SELECT COUNT(*) FROM expenses)+(SELECT COUNT(*) FROM purchases) AS n').n;
      need(!hasMoney || s.currency===data.currency,'Currency is locked after financial or product records exist.');
      const timezone=data.timezone||s.timezone; need(['Asia/Bangkok','Asia/Singapore','UTC','Europe/London','America/New_York'].includes(timezone),'Unsupported time zone.');
      run('UPDATE settings SET name=?,currency=?,address=?,timezone=?,version=version+1 WHERE id=1',str(data.name,'Business name'),data.currency,str(data.address||'','Address',500,true),timezone); audit(user,'settings.updated','business'); return {ok:true};
    }
    if(url==='/api/users') {
      const username=str(data.username,'Username',60).toLowerCase(); need(/^[a-z0-9._-]+$/.test(username),'Username may contain letters, numbers, dots, underscores and hyphens.'); need(['admin','staff','viewer'].includes(data.role),'Invalid role.');
      const r=run('INSERT INTO users(username,name,password,role) VALUES(?,?,?,?)',username,str(data.name,'Name'),hashPassword(password(data.password)),data.role); audit(user,'user.created',r.lastInsertRowid,data.role); return {id:Number(r.lastInsertRowid)};
    }
    if(url.match(/^\/api\/users\/\d+\/reset-password$/)) {
      const u=existing('users',Number(url.split('/')[3]));need(u.id!==user.id,'Use Change password for your own account.');
      run('UPDATE users SET password=? WHERE id=?',hashPassword(password(data.password)),u.id);run('DELETE FROM sessions WHERE user_id=?',u.id);audit(user,'user.password_reset',u.id);return {ok:true};
    }
    if(url.match(/^\/api\/users\/\d+\/access$/)) {
      const u=existing('users',Number(url.split('/')[3])); need(u.id!==user.id,'You cannot change your own access.'); need(['admin','staff','viewer'].includes(data.role),'Invalid role.'); const active=integer(data.active,'Active',0,1);
      run('UPDATE users SET role=?,active=? WHERE id=?',data.role,active,u.id); run('DELETE FROM sessions WHERE user_id=?',u.id); audit(user,'user.access_changed',u.id,JSON.stringify({role:data.role,active})); return {ok:true};
    }
    throw new Problem('Endpoint not found.',404);
  }
  const stock=stockAPI({get,all,run,need,str,integer,money,date,role,movement,audit,businessDay});
  function state(user) {
    const invoices=all('SELECT * FROM invoices ORDER BY id DESC');
    const products=all('SELECT * FROM products ORDER BY name');
    const expenses=all('SELECT * FROM expenses ORDER BY date DESC,id DESC');
    const payments=all('SELECT * FROM payments ORDER BY date DESC,id DESC');
    const total=(rows,key)=>rows.reduce((n,r)=>n+r[key],0);
    const active=invoices.filter(i=>i.status!=='void');
    const collected=total(payments,'amount'), spent=total(expenses.filter(e=>!e.voided),'amount');
    return {user,health:businessHealth({invoices,payments,expenses,products,today:businessDay()}),settings:get('SELECT * FROM settings WHERE id=1'),products,contacts:all('SELECT * FROM contacts ORDER BY name'),invoices,payments,expenses,purchases:all('SELECT * FROM purchases ORDER BY id DESC'),movements:all('SELECT m.*,p.name product_name,u.name user_name FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 100'),
      users:user.role==='admin'?all('SELECT id,username,name,role,active FROM users ORDER BY id'):[],
      audit:user.role==='admin'?all('SELECT a.*,u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100'):[],
      summary:{invoiced:total(active,'total'),collected,expenses:spent,cashNet:collected-spent,outstanding:total(active,'total')-total(active,'paid'),overdue:total(active.filter(i=>i.due<businessDay()),'total')-total(active.filter(i=>i.due<businessDay()),'paid'),lowStock:products.filter(p=>p.active && p.stock<=p.reorder).length,stockValue:products.reduce((n,p)=>n+p.stock*p.cost,0)}};
  }
  function respond(res,status,data,extra={}) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...extra}); res.end(JSON.stringify(data)); }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host=req.headers.host || ''; const local=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
      need(local || (publicOrigin && host===new URL(publicOrigin).host),'Unrecognized host.',403);
      const url=new URL(req.url,`http://${host}`), endpoint=url.pathname;
      need(['GET','POST'].includes(req.method),'Method not allowed.',405);
      if(!endpoint.startsWith('/api/')) {
        need(req.method==='GET','Method not allowed.',405);
        const files={'/':'inventory.html','/inventory.js':'inventory.js','/inventory.css':'inventory.css','/zxing.js':'vendor/zxing.js','/legacy':'index.html','/app.js':'app.js','/i18n.js':'i18n.js','/health.js':'health.js','/style.css':'style.css'}; need(files[endpoint],'Not found.',404);
        res.setHeader('Content-Type',endpoint.endsWith('.js')?'text/javascript; charset=utf-8':endpoint.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'); return res.end(fs.readFileSync(path.join(ROOT,'public',files[endpoint])));
      }
      if(req.method==='GET' && endpoint==='/api/health') return respond(res,200,{ok:get('SELECT 1 AS ok').ok===1});
      let data={};
      if(req.method==='POST') {
        const expected=local?`http://${host}`:publicOrigin;
        need(req.headers.origin===expected || (publicOrigin && req.headers.origin===publicOrigin),'Request origin is not allowed.',403);
        need(req.headers['content-type']?.split(';')[0]==='application/json','Send JSON data.',415);
        const chunks=[];let bytes=0; for await(const chunk of req) { bytes+=chunk.length;need(bytes<=600*1024,'Request is too large.',413);chunks.push(chunk); }
        try { data=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Problem('Invalid JSON.'); } need(data && typeof data==='object' && !Array.isArray(data),'Send a JSON object.');
      }
      if(endpoint==='/api/session' && req.method==='GET') return respond(res,200,{user:actor(req),needsSetup:!get('SELECT id FROM users LIMIT 1')});
      if(req.method==='POST' && (endpoint==='/api/setup' || endpoint==='/api/login')) {
        const ip=req.socket.remoteAddress; const now=Date.now(); if(attempts.size>10000) for(const [key,value] of attempts) if(value.until<now) attempts.delete(key);
        const entry=attempts.get(ip)||{count:0,until:now+15*60000}; if(entry.until<now){entry.count=0;entry.until=now+15*60000;} entry.count++; attempts.set(ip,entry); need(entry.count<=15,'Too many sign-in attempts. Try again in 15 minutes.',429);
        const username=str(data.username,'Username',60).toLowerCase(); let user;
        if(endpoint==='/api/setup') {
          need(!get('SELECT id FROM users LIMIT 1'),'Setup is already complete.',409); need(data.setupToken===setupToken,'Enter the setup code shown in the server window.',403); need(/^[a-z0-9._-]+$/.test(username),'Invalid username.');
          db.exec('BEGIN IMMEDIATE');
          try { const r=run("INSERT INTO users(username,name,password,role) VALUES(?,?,?,'admin')",username,str(data.name,'Name'),hashPassword(password(data.password))); user=existing('users',Number(r.lastInsertRowid)); audit(user,'business.setup','business'); db.exec('COMMIT'); } catch(e){db.exec('ROLLBACK');throw e;}
        } else {
          need(typeof data.password==='string' && data.password.length<=128,'Invalid username or password.',401);
          user=get('SELECT * FROM users WHERE username=? AND active=1',username); const valid=matches(data.password,user?.password||dummyHash); need(user && valid,'Invalid username or password.',401);
        }
        attempts.delete(ip); const s=session(user); return respond(res,200,{user:s.user},{'Set-Cookie':s.cookie});
      }
      const user=actor(req); need(user,'Please sign in.',401);
      if(req.method==='POST') {
        need(req.headers['x-csrf-token']===user.csrf,'Session expired. Reload and sign in again.',403);
        if(endpoint==='/api/logout') { const t=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('zc_session='))?.slice(11); run('DELETE FROM sessions WHERE token=?',digest(t)); return respond(res,200,{ok:true},{'Set-Cookie':'zc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}); }
        const key=str(req.headers['idempotency-key'],'Request key',100); const fingerprint=digest(endpoint+JSON.stringify(data));
        db.exec('BEGIN IMMEDIATE');
        try {
          const previous=get('SELECT * FROM requests WHERE user_id=? AND key=?',user.id,key);
          if(previous) { need(previous.fingerprint===fingerprint,'Request key was already used for different data.',409); db.exec('COMMIT'); return respond(res,200,JSON.parse(previous.response)); }
          const result=mutate(user,endpoint,data); run('INSERT INTO requests VALUES(?,?,?,?)',user.id,key,fingerprint,JSON.stringify(result)); db.exec('COMMIT'); return respond(res,200,result);
        } catch(e) { if(db.isTransaction) db.exec('ROLLBACK'); throw e; }
      }
      if(endpoint==='/api/state') return respond(res,200,state(user));
      if(endpoint==='/api/overview')return respond(res,200,stock.overview(Number(url.searchParams.get('days')||7)));
      if(endpoint==='/api/history'){
        const page=integer(Number(url.searchParams.get('page')||1),'Page',1,1000000);
        const rows=all('SELECT m.*,p.name product_name,p.sku,u.name user_name FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 50 OFFSET ?', (page-1)*50);
        return respond(res,200,{rows,page,total:get('SELECT COUNT(*) n FROM movements').n});
      }
      if(endpoint==='/api/inventory.csv'){
        const csv=v=>'"'+String(v??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';
        const rows=all('SELECT * FROM products WHERE active=1 ORDER BY name').map(p=>[p.sku,p.name,(p.price/100).toFixed(2),(p.cost/100).toFixed(2),p.stock,p.reorder,p.barcode]);
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="inventory.csv"'});
        return res.end('\uFEFF'+[['sku','name','price','cost','stock','reorder','barcode'],...rows].map(r=>r.map(csv).join(',')).join('\r\n'));
      }
      if(endpoint.match(/^\/api\/(invoices|purchases)\/\d+$/)) {
        const [, ,table,id]=endpoint.split('/'); const record=existing(table,Number(id)); const isInvoice=table==='invoices';
        return respond(res,200,{...record,lines:all(`SELECT * FROM ${isInvoice?'invoice':'purchase'}_lines WHERE ${isInvoice?'invoice':'purchase'}_id=?`,record.id),...(isInvoice?{payments:all('SELECT * FROM payments WHERE invoice_id=?',record.id)}:{})});
      }
      if(endpoint==='/api/export') {
        const table=url.searchParams.get('table'); need(['products','contacts','invoices','payments','purchases','expenses','movements','audit','sales'].includes(table),'Unknown report.'); if(table==='audit') role(user,'admin');
        const rows=all(`SELECT * FROM ${table} ORDER BY id`), columns=db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name);
        function csv(v) { let s=String(v??''); if(typeof v==='string' && /^[\s]*[=+\-@\t\r]/.test(s))s="'"+s; return '"'+s.replaceAll('"','""')+'"'; }
        const display=url.searchParams.get('format')==='display',language=url.searchParams.get('lang')==='th'?'th':'en';
        const report=display?displayReport(table,rows,columns,{language,currency:get('SELECT currency FROM settings WHERE id=1').currency,today:businessDay()}):{headers:columns,rows:rows.map(r=>columns.map(c=>r[c]))};
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${table}-${businessDay()}${display?'-'+language:''}.csv"`}); return res.end('\uFEFF'+[report.headers,...report.rows].map(r=>r.map(csv).join(',')).join('\r\n'));
      }
      if(endpoint==='/api/backup') {
        role(user,'admin'); const backupDir=path.join(path.dirname(options.dbPath||process.env.DB_PATH||path.join(ROOT,'data/business.sqlite')),'backups'); fs.mkdirSync(backupDir,{recursive:true,mode:0o700}); const target=path.join(backupDir,`business-${Date.now()}-${token().slice(0,8)}.sqlite`);
        db.prepare('VACUUM INTO ?').run(target); fs.chmodSync(target,0o600); audit(user,'backup.created','database');
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="business-${businessDay()}.sqlite"`}); return res.end(fs.readFileSync(target));
      }
      throw new Problem('Endpoint not found.',404);
    } catch(e) {
      if(e instanceof Problem) return respond(res,e.status,{error:e.message});
      if(String(e.message).includes('UNIQUE constraint failed')) return respond(res,409,{error:'That SKU or username already exists.'});
      console.error('Request failed:',e.message); respond(res,500,{error:'The request could not be saved. Please retry or check the server logs.'});
    }
  });
  server.requestTimeout=15000; server.headersTimeout=10000;
  let closed=false;const closeStorage=()=>{if(!closed){closed=true;db.close();release();}};
  server.once('close',closeStorage);
  server.once('error',e=>{closeStorage();console.error('Server error:',e.message);});
  return {server,db,setupToken};
}
if(require.main===module) {
  const port=Number(process.env.PORT||3000), host=process.env.HOST||'127.0.0.1';
  need(Number.isInteger(port)&&port>=1&&port<=65535,'PORT must be between 1 and 65535.');
  if(!['127.0.0.1','localhost','::1'].includes(host) && !process.env.PUBLIC_ORIGIN) throw new Error('Set PUBLIC_ORIGIN before enabling network access.');
  const app=createApp();
  app.server.listen(port,host,()=>{ console.log(`ZetaCaros ready: ${process.env.PUBLIC_ORIGIN || `http://localhost:${port}`}`); if(!app.db.prepare('SELECT id FROM users LIMIT 1').get()) console.log(`First-run setup code: ${app.setupToken}`); });
  for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>app.server.close(()=>process.exit(0)));
}
module.exports={createApp,money};
