'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {acquireLock}=require('./lock');
const {openDatabase}=require('./database');
const filename=path.resolve(process.env.DB_PATH||path.join(__dirname,'../../data/business.sqlite'));
function check(source){
  const db=new DatabaseSync(source,{readOnly:true});
  try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup failed integrity check.');
    const version=db.prepare('PRAGMA user_version').get().user_version;
    if(![1,2].includes(version))throw new Error('Backup schema version is not supported.');
    if(version===2){db.prepare('SELECT barcode FROM products LIMIT 1').get();db.prepare('SELECT * FROM sales LIMIT 1').get();}
    for(const t of ['settings','users','sessions','contacts','products','invoices','invoice_lines','payments','purchases','purchase_lines','expenses','movements','audit','requests'])db.prepare(`SELECT * FROM ${t} LIMIT 1`).get();
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup contains broken references.');
  }finally{db.close();}
}
function main(){
  const cmd=process.argv[2],source=process.argv[3];
  if(!['backup','restore'].includes(cmd))throw new Error('Use npm run backup, or npm run restore -- path/to/backup.sqlite --confirm');
  if(cmd==='restore'&&(!source||!process.argv.includes('--confirm')))throw new Error('Stop the server. Restore replaces current records. Run npm run restore -- path/to/backup.sqlite --confirm');
  const release=acquireLock(filename);
  try{
    if(cmd==='backup'){
      if(!fs.existsSync(filename))throw new Error('No business database exists yet. Complete setup first.');
      const dir=path.join(path.dirname(filename),'backups');fs.mkdirSync(dir,{recursive:true,mode:0o700});
      const out=path.join(dir,`business-${Date.now()}.sqlite`);const db=openDatabase(filename);try{db.prepare('VACUUM INTO ?').run(out);}finally{db.close();}fs.chmodSync(out,0o600);check(out);console.log(`Backup saved: ${out}`);
    }else{
      const input=path.resolve(source);if(input===filename)throw new Error('Choose a backup file, not the active database.');check(input);
      // Work on a copy; remove authenticated sessions before the restored database becomes active.
      fs.mkdirSync(path.dirname(filename),{recursive:true});
      const stage=filename+`.restore-${Date.now()}`;fs.copyFileSync(input,stage,fs.constants.COPYFILE_EXCL);fs.chmodSync(stage,0o600);
      const candidate=new DatabaseSync(stage);try{candidate.exec('PRAGMA journal_mode=DELETE; DELETE FROM sessions;');candidate.prepare('INSERT INTO audit(date,user_id,action,entity,detail) VALUES(?,NULL,?,?,?)').run(new Date().toISOString(),'database.restored','database','Offline maintenance restore');}finally{candidate.close();}
      check(stage);
      let previous=null;
      if(fs.existsSync(filename)){
        const db=new DatabaseSync(filename);try{const result=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(result.busy)throw new Error('Database is busy. Stop all server processes.');db.exec('PRAGMA journal_mode=DELETE;');}finally{db.close();}
        previous=filename+`.before-restore-${Date.now()}`;fs.renameSync(filename,previous);
      }
      try{fs.renameSync(stage,filename);}catch(e){if(previous)fs.renameSync(previous,filename);throw e;}
      console.log(`Restored: ${filename}`);if(previous)console.log(`Previous database retained: ${previous}`);console.log('Restart the server and sign in. All previous sessions were invalidated.');
    }
  }finally{release();}
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={check};
