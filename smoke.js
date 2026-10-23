const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const fail=message=>{throw new Error(message)};
execFileSync(process.execPath,['--check',path.join(root,'main.js')],{stdio:'pipe'});
const pkg=JSON.parse(read('package.json'));
if(pkg.version!=='6.5.0') fail('Versão desktop incorreta.');
for(const file of ['main.js','loading.html','fallback.html','icon-512.png','icon.ico','preload.js','control-host.ps1']){
  if(!fs.existsSync(path.join(root,file))) fail('Arquivo desktop ausente: '+file);
}
const main=read('main.js');
for(const marker of ['AcordDesktop/6.5.0','loading.html','nodeIntegration:false','contextIsolation:true','sandbox:true','webSecurity:true',"appendSwitch('force-color-profile','srgb')","appendSwitch('disable-direct-composition-video-overlays')"]){
  if(!main.includes(marker)) fail('Proteção/boot desktop ausente: '+marker);
}
const preload=read('preload.js');
for(const marker of ['AcordDesktopControl','acord-shared-control-host','acord-shared-control-input','releaseAll']){
  if(!preload.includes(marker)) fail('Ponte desktop do Controle compartilhado ausente: '+marker);
}
const helper=read('control-host.ps1');
for(const marker of ['SetCursorPos','mouse_event','keybd_event','Release-All']){
  if(!helper.includes(marker)) fail('Helper nativo do Controle compartilhado ausente: '+marker);
}
for(const marker of ['acord-shared-control-host','acord-shared-control-input','preload.js','control-host.ps1']){
  if(!main.includes(marker) && !read('package.json').includes(marker)) fail('Integração desktop do Controle compartilhado ausente: '+marker);
}
console.log(JSON.stringify({ok:true,version:pkg.version},null,2));
