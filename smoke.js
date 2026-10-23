const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const fail=message=>{throw new Error(message)};
execFileSync(process.execPath,['--check',path.join(root,'main.js')],{stdio:'pipe'});
const pkg=JSON.parse(read('package.json'));
if(pkg.version!=='6.4.2') fail('Versão desktop incorreta.');
for(const file of ['main.js','loading.html','fallback.html','icon-512.png','icon.ico']){
  if(!fs.existsSync(path.join(root,file))) fail('Arquivo desktop ausente: '+file);
}
const main=read('main.js');
for(const marker of ['AcordDesktop/6.4.2','loading.html','nodeIntegration:false','contextIsolation:true','sandbox:true','webSecurity:true',"appendSwitch('force-color-profile','srgb')","appendSwitch('disable-direct-composition-video-overlays')"]){
  if(!main.includes(marker)) fail('Proteção/boot desktop ausente: '+marker);
}
console.log(JSON.stringify({ok:true,version:pkg.version},null,2));
