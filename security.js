const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const fail=message=>{throw new Error(message)};
const main=read('main.js');
const preload=read('preload.js');
const workflow=read('.github/workflows/publicar-windows.yml');
const must=(source,marker,label=marker)=>{if(!source.includes(marker))fail('Proteção ausente: '+label)};

for(const marker of [
  'nodeIntegration:false','contextIsolation:true','sandbox:true','webSecurity:true',
  "permissions.mouse!==true","permissions.keyboard!==true",
  "safe.type==='gamepad'","isTrustedAcordSender(event)"
]) must(main,marker);
for(const marker of ['contextBridge.exposeInMainWorld','AcordDesktopControl']) must(preload,marker);
for(const marker of ['WINDOWS_CSC_LINK','WINDOWS_CSC_KEY_PASSWORD','Get-AuthenticodeSignature']) must(workflow,marker);

console.log(JSON.stringify({ok:true,desktopSecurity:true,version:'6.6.0'},null,2));
