const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const root=__dirname;
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const fail=message=>{throw new Error(message)};
execFileSync(process.execPath,['--check',path.join(root,'main.js')],{stdio:'pipe'});
const pkg=JSON.parse(read('package.json'));
if(pkg.version!=='6.8.3') fail('Versão desktop incorreta.');
for(const file of ['main.js','loading.html','fallback.html','icon-512.png','icon.ico','preload.js','shared-control-host.js','control-host.ps1']){
  if(!fs.existsSync(path.join(root,file))) fail('Arquivo desktop ausente: '+file);
}
const main=read('main.js');
for(const marker of ['AcordDesktop/6.8.3','__ACORD_DESKTOP_SHELL__','preload-error','loading.html','nodeIntegration:false','contextIsolation:true','sandbox:true','webSecurity:true',"appendSwitch('force-color-profile','srgb')","appendSwitch('disable-direct-composition-video-overlays')",'acord-shared-control-primary-source',"types:['screen']",'electronScreen.getPrimaryDisplay']){
  if(!main.includes(marker)) fail('Proteção/boot desktop ausente: '+marker);
}
const preload=read('preload.js');
for(const marker of ['AcordDesktopControl','acord-shared-control-host','acord-shared-control-input','acord-shared-control-primary-source','getPrimaryDisplaySource','releaseAll','__acordDesktopBridgeRequest','__acordDesktopBridgeReady']){
  if(!preload.includes(marker)) fail('Ponte desktop do Controle compartilhado ausente: '+marker);
}
const shared=read('shared-control-host.js');
const helper=read('control-host.ps1');
for(const marker of ['SetCursorPos','mouse_event','keybd_event','Release-All']){
  if(!helper.includes(marker)) fail('Helper nativo do Controle compartilhado ausente: '+marker);
}
for(const marker of ['acord-shared-control-host','acord-shared-control-input']){
  if(!shared.includes(marker)) fail('Módulo desktop do Controle compartilhado ausente: '+marker);
}
for(const marker of ['preload.js','control-host.ps1','shared-control-host.js']){
  if(!main.includes(marker) && !read('package.json').includes(marker) && !shared.includes(marker)) fail('Integração desktop ausente: '+marker);
}

if(!main.includes('setDisplayMediaRequestHandler')) fail('Handler moderno de captura de tela ausente.');
if(!main.includes("types:['screen']")) fail('Seleção automática do monitor principal ausente.');
if(!main.includes("grant.audio='loopback'")) fail('Áudio de sistema do compartilhamento automático ausente.');
console.log(JSON.stringify({ok:true,version:pkg.version},null,2));
