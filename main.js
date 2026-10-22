const { app, BrowserWindow, session, shell, desktopCapturer, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');

const ACORD_ORIGIN='https://d2-camera.bozzidavi.workers.dev';
const ACORD_URL=ACORD_ORIGIN+'/?desktop=1&app=6.2';
const UPDATE_CHECK_MS=1000*60*60*6;

function parseUrl(value=''){
  try{return new URL(value)}catch{return null}
}

function isAcordUrl(value=''){
  const url=parseUrl(value);
  return !!url && url.origin===ACORD_ORIGIN;
}

function canOpenExternal(value=''){
  const url=parseUrl(value);
  return !!url && ['https:','mailto:'].includes(url.protocol);
}

function openExternalSafe(value=''){
  if(!canOpenExternal(value)) return false;
  shell.openExternal(value).catch(()=>{});
  return true;
}

function notify(title,body){
  try{
    if(Notification.isSupported()){
      new Notification({title,body}).show();
    }
  }catch{}
}

function setupUpdater(){
  if(!app.isPackaged) return;

  autoUpdater.autoDownload=true;
  autoUpdater.autoInstallOnAppQuit=true;

  autoUpdater.on('update-available',info=>{
    notify('Acord','Atualização '+String(info?.version||'nova')+' disponível. Baixando em segundo plano.');
  });

  autoUpdater.on('update-downloaded',info=>{
    notify('Acord atualizado','A versão '+String(info?.version||'nova')+' será instalada quando você fechar o aplicativo.');
  });

  autoUpdater.on('error',error=>{
    console.warn('Atualizador do Acord:',error?.message||error);
  });

  const check=()=>autoUpdater.checkForUpdatesAndNotify().catch(()=>{});
  setTimeout(check,12000);
  setInterval(check,UPDATE_CHECK_MS);
}

async function clearStaleUiCaches(){
  const ses=session.defaultSession;
  try{await ses.clearCache()}catch(error){console.warn('Cache HTTP:',error?.message||error)}
  try{
    await ses.clearStorageData({
      origin:ACORD_ORIGIN,
      storages:['serviceworkers','cachestorage']
    });
  }catch(error){console.warn('Cache do app:',error?.message||error)}
}

async function createWindow(){
  const win=new BrowserWindow({
    width:1360,
    height:860,
    minWidth:900,
    minHeight:600,
    title:'Acord',
    autoHideMenuBar:true,
    backgroundColor:'#07110e',
    show:false,
    icon:__dirname+'/icon.ico',
    webPreferences:{
      nodeIntegration:false,
      contextIsolation:true,
      sandbox:true,
      webSecurity:true,
      allowRunningInsecureContent:false,
      webviewTag:false
    }
  });

  win.webContents.setUserAgent(
    win.webContents.getUserAgent()+' AcordDesktop/6.2'
  );

  win.webContents.on('will-attach-webview',event=>event.preventDefault());

  win.webContents.setWindowOpenHandler(({url})=>{
    openExternalSafe(url);
    return {action:'deny'};
  });

  win.webContents.on('will-navigate',(event,url)=>{
    if(isAcordUrl(url)) return;
    event.preventDefault();
    openExternalSafe(url);
  });

  win.webContents.on('render-process-gone',(_event,details)=>{
    console.warn('Renderizador reiniciado:',details?.reason||'desconhecido');
  });

  let retried=false;
  win.webContents.on('did-fail-load',(_event,errorCode,errorDescription,validatedURL,isMainFrame)=>{
    if(!isMainFrame || retried) return;
    retried=true;
    console.warn('Falha ao carregar Acord:',errorCode,errorDescription,validatedURL);
    setTimeout(()=>win.loadURL(ACORD_URL+'&retry=1').catch(()=>{}),1200);
  });

  win.once('ready-to-show',()=>win.show());
  await win.loadURL(ACORD_URL);
  return win;
}

app.whenReady().then(async()=>{
  await clearStaleUiCaches();

  session.defaultSession.setPermissionCheckHandler(
    (_webContents,permission,requestingOrigin)=>{
      if(!isAcordUrl(requestingOrigin)) return false;
      return [
        'media',
        'notifications',
        'fullscreen',
        'pointerLock',
        'clipboard-sanitized-write',
        'display-capture'
      ].includes(permission);
    }
  );

  session.defaultSession.setPermissionRequestHandler(
    (webContents,permission,callback)=>{
      const allowed=isAcordUrl(webContents.getURL()) && [
        'media',
        'notifications',
        'fullscreen',
        'pointerLock',
        'clipboard-sanitized-write',
        'display-capture'
      ].includes(permission);
      callback(allowed);
    }
  );

  if(session.defaultSession.setDisplayMediaRequestHandler){
    session.defaultSession.setDisplayMediaRequestHandler(
      async(_request,callback)=>{
        try{
          const sources=await desktopCapturer.getSources({
            types:['screen','window'],
            thumbnailSize:{width:1,height:1}
          });
          callback({video:sources[0],audio:'loopback'});
        }catch{
          callback({});
        }
      },
      {useSystemPicker:true}
    );
  }

  await createWindow();
  setupUpdater();

  app.on('activate',async()=>{
    if(BrowserWindow.getAllWindows().length===0){
      await createWindow();
    }
  });
});

app.on('web-contents-created',(_event,contents)=>{
  contents.on('will-attach-webview',event=>event.preventDefault());
});

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin') app.quit();
});
