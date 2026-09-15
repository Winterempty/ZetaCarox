'use strict';
const crypto=require('node:crypto');
function parseCSV(text) {
  if(typeof text!=='string' || Buffer.byteLength(text)>256*1024) throw new Error('CSV must be UTF-8 text, at most 256 KB.');
  text=text.replace(/^\uFEFF/,'');
  const first=text.split(/\r?\n/,1)[0];
  const delimiter=first.includes('\t')?'\t':first.includes(';')?';':',';
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw new Error('Unexpected quote in CSV.');quoted=true;}
    else if(c===delimiter){row.push(cell);cell='';closed=false;}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';closed=false;}
    else{if(closed)throw new Error('Unexpected text after a quoted CSV field.');cell+=c;}
  }
  if(quoted)throw new Error('Unclosed quote in CSV.');
  row.push(cell);if(row.some(v=>v!==''))rows.push(row);
  if(rows.length<2||rows.length>501)throw new Error('CSV must contain a header and 1–500 product rows.');
  return rows;
}
function stockAPI(ctx) {
  const {get,all,run,need,str,integer,money,date,role,movement,audit,businessDay}=ctx;
  const secret=crypto.randomBytes(32);
  function barcode(value,id=0) {
    const code=str(value??'','Barcode',60,true);
    need(!code||/^[A-Za-z0-9._-]+$/.test(code),'Barcode may contain letters, numbers, dots, underscores and hyphens.');
    need(!code||!get('SELECT id FROM products WHERE (barcode=? OR sku=? COLLATE NOCASE) AND id<>?',code,code,id),'Barcode conflicts with an existing product.',409);
    return code;
  }
  function validateProduct(data,id=0){
    const code=barcode(data.barcode,id);
    if(data.sku)need(!get('SELECT id FROM products WHERE barcode=? COLLATE NOCASE AND barcode<>\'\' AND id<>?',data.sku,id),'SKU conflicts with an existing barcode.',409);
    return code;
  }
  function preview(text,user) {
    let matrix;try{matrix=parseCSV(text);}catch(e){need(false,e.message);}
    const aliases={'รหัสสินค้า':'sku','ชื่อสินค้า':'name','ราคาขาย':'price','ต้นทุน':'cost','จำนวนคงเหลือ':'stock','จุดเตือน':'reorder','บาร์โค้ด':'barcode'};
    const headers=matrix.shift().map(s=>aliases[s.trim()]||s.trim().toLowerCase());
    need(new Set(headers).size===headers.length,'CSV contains duplicate headers.');
    need(['sku','name','price','cost','stock','reorder'].every(h=>headers.includes(h)),'Required CSV headers: sku,name,price,cost,stock,reorder (optional: barcode).');
    need(headers.every(h=>['sku','name','price','cost','stock','reorder','barcode'].includes(h)),'CSV contains an unknown header. Use the template.');
    const seen=new Set(),codes=new Set();
    const rows=matrix.map((values,i)=>{
      const raw=Object.fromEntries(headers.map((h,j)=>[h,(values[j]??'').trim()]));
      try{
        need(values.length===headers.length,'Column count does not match the header.');
        const sku=str(raw.sku,'SKU',60),name=str(raw.name,'Product');
        need(!seen.has(sku.toLowerCase()),'Duplicate SKU in CSV.');seen.add(sku.toLowerCase());
        need(!get('SELECT id FROM products WHERE sku=?',sku),'SKU already exists. Import only adds new products; edit existing products separately.',409);
        const code=validateProduct({...raw,sku});
        if(code){need(!codes.has(code.toLowerCase()),'Duplicate barcode in CSV.');codes.add(code.toLowerCase());}
        need(/^\d+$/.test(raw.stock)&&/^\d+$/.test(raw.reorder),'Stock and reorder must be whole numbers.');
        const item={sku,name,barcode:code,price:money(raw.price,'Price'),cost:money(raw.cost,'Cost'),stock:integer(Number(raw.stock),'Stock'),reorder:integer(Number(raw.reorder),'Reorder')};
        return {row:i+2,item,raw,error:null};
      }catch(e){return {row:i+2,raw,error:e.message};}
    });
    for(const row of rows){if(row.item?.barcode && rows.some(other=>other!==row&&other.raw.sku.toLowerCase()===row.item.barcode.toLowerCase()))row.error='Barcode conflicts with another SKU in CSV.';}
    const valid=rows.every(r=>!r.error);
    const snapshot=all('SELECT id,sku,barcode,version FROM products ORDER BY id');
    const token=crypto.createHmac('sha256',secret).update(JSON.stringify({text,user:user.id,snapshot})).digest('hex');
    return {rows,valid,token:valid?token:null,count:rows.length};
  }
  function mutate(user,url,data){
    if(!['/api/import/preview','/api/import/commit','/api/sales'].includes(url))return null;
    role(user,'admin','staff');
    if(url.startsWith('/api/import/')){
      const result=preview(data.csv,user);
      if(url.endsWith('/preview'))return result;
      need(result.valid,'Correct CSV errors before importing.');
      need(typeof data.token==='string'&&result.token===data.token,'Products changed or preview expired. Preview the CSV again.',409);
      for(const {item:p} of result.rows){const r=run('INSERT INTO products(sku,name,barcode,price,cost,stock,reorder) VALUES(?,?,?,?,?,?,?)',p.sku,p.name,p.barcode,p.price,p.cost,p.stock,p.reorder);movement(user,Number(r.lastInsertRowid),p.stock,'CSV opening stock');}
      audit(user,'products.imported','products',String(result.count));return {count:result.count};
    }
    const p=get('SELECT * FROM products WHERE id=?',integer(data.product_id,'Product ID',1));
    need(p&&p.active,'Product not found or archived.',404);
    need(data.version===p.version,'Product changed. Refresh and confirm again.',409);
    const qty=integer(data.quantity,'Quantity',1,100000);
    need(p.stock>=qty,'Insufficient stock.',409);
    const d=date(data.date);need(d<=businessDay(),'Sale date cannot be in the future.');
    need(p.price>0&&p.price*qty<=100000000000,'Sale total must be positive and within the supported limit.');
    const r=run('INSERT INTO sales(product_id,product_name,sku,quantity,price,total,date,created,user_id,note) VALUES(?,?,?,?,?,?,?,?,?,?)',p.id,p.name,p.sku,qty,p.price,p.price*qty,d,new Date().toISOString(),user.id,str(data.note||'','Note',300,true));
    run('UPDATE products SET stock=stock-?,version=version+1 WHERE id=?',qty,p.id);
    movement(user,p.id,-qty,`Sale #${r.lastInsertRowid}`);audit(user,'sale.recorded',r.lastInsertRowid);
    return {id:Number(r.lastInsertRowid),total:p.price*qty};
  }
  function overview(days=7){
    need([7,30].includes(days),'Choose 7 or 30 days.');
    const end=businessDay();const shift=n=>new Date(Date.parse(end+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
    const start=shift(1-days),previousStart=shift(1-days*2);
    const records=all(`SELECT date,total FROM sales WHERE date>=? AND date<=? UNION ALL SELECT issued AS date,subtotal AS total FROM invoices WHERE status<>'void' AND issued>=? AND issued<=?`,previousStart,end,previousStart,end);
    const series=Array.from({length:days},(_,i)=>({date:shift(i-days+1),total:0}));let current=0,previous=0;
    for(const r of records){if(r.date>=start){current+=r.total;series.find(s=>s.date===r.date).total+=r.total;}else previous+=r.total;}
    return {days,start,end,previousStart,current,previous,percent:previous?Math.round((current-previous)/previous*1000)/10:null,direction:current>previous?'up':current<previous?'down':'flat',series,sales:all('SELECT s.*,u.name user_name FROM sales s JOIN users u ON u.id=s.user_id ORDER BY s.date DESC,s.id DESC LIMIT 100'),businessDay:end};
  }
  return {mutate,overview,validateProduct};
}
module.exports={stockAPI,parseCSV};
