'use strict';
const fs=require('node:fs');
const path=require('node:path');
function acquireLock(filename){
  const lock=filename+'.lock';fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  try{fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')throw new Error(`Database is in use, or a previous process stopped unexpectedly. Stop the server first. If no ZetaCaros process is running, remove ${lock} and retry.`);throw e;}
  let released=false;return ()=>{if(!released){released=true;fs.unlinkSync(lock);}};
}
module.exports={acquireLock};
