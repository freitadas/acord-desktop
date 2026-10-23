const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('AcordDesktopControl',{
  available:true,
  platform:process.platform,
  setHostEnabled:enabled=>ipcRenderer.invoke('acord-shared-control-host',!!enabled),
  injectInput:event=>ipcRenderer.send('acord-shared-control-input',event),
  releaseAll:()=>ipcRenderer.send('acord-shared-control-input',{type:'release-all'})
});
