const {contextBridge,ipcRenderer}=require('electron');

const PLATFORM=process.platform;
const VERSION='6.8.5';

const api={
  available:true,
  platform:PLATFORM,
  version:VERSION,
  ping:()=>ipcRenderer.invoke('acord-desktop-ping'),
  setHostEnabled:enabled=>ipcRenderer.invoke('acord-shared-control-host',!!enabled),
  getPrimaryDisplaySource:()=>ipcRenderer.invoke('acord-shared-control-primary-source'),
  injectInput:event=>ipcRenderer.send('acord-shared-control-input',event),
  releaseAll:()=>ipcRenderer.send('acord-shared-control-input',{type:'release-all'})
};

try{
  contextBridge.exposeInMainWorld('AcordDesktopControl',api);
}catch(error){
  console.error('Acord Desktop preload: falha ao expor bridge principal',error);
}

// Canal redundante: se a propriedade exposta pelo contextBridge não estiver
// disponível por alguma diferença do Chromium/Electron, a página continua
// conseguindo falar com o preload sem liberar Node.js no renderer.
window.addEventListener('message',async event=>{
  if(event.source!==window || !event.data || event.data.__acordDesktopBridgeRequest!==true) return;
  const {id,action,payload={}}=event.data;
  try{
    let result={ok:true};
    if(action==='setHostEnabled') result=await ipcRenderer.invoke('acord-shared-control-host',!!payload.enabled);
    else if(action==='getPrimaryDisplaySource') result=await ipcRenderer.invoke('acord-shared-control-primary-source');
    else if(action==='injectInput'){ ipcRenderer.send('acord-shared-control-input',payload.event); return; }
    else if(action==='releaseAll'){ ipcRenderer.send('acord-shared-control-input',{type:'release-all'}); return; }
    else throw new Error('Ação de bridge não reconhecida');
    if(id) window.postMessage({__acordDesktopBridgeReply:true,id,result},'*');
  }catch(error){
    if(id) window.postMessage({__acordDesktopBridgeReply:true,id,error:String(error?.message||error)},'*');
  }
});

window.postMessage({__acordDesktopBridgeReady:true,platform:PLATFORM,version:VERSION},'*');
