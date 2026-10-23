const { app, BrowserWindow, session, shell, desktopCapturer, Notification } = require('electron');
const path = require('path');

let autoUpdater=null;
try{
  ({autoUpdater}=require('electron-updater'));
}catch(error){
  console.warn('Atualizador automático indisponível:',error?.message||error);
}

const ACORD_ORIGIN='https://d2-camera.bozzidavi.workers.dev';
const ACORD_URL=ACORD_ORIGIN+'/?desktop=1&app=6.3';
const ACORD_FALLBACK_URL=ACORD_ORIGIN+'/?desktop=1&app=6.3&fallback=1';
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
  if(!app.isPackaged || !autoUpdater) return;

  autoUpdater.autoDownload=true;
  autoUpdater.autoInstallOnAppQuit=true;

  autoUpdater.on('update-available',info=>{
    notify('Acord','Atualização '+String(info?.version||'nova')+' disponível.');
  });

  autoUpdater.on('update-downloaded',info=>{
    notify('Acord atualizado','A versão '+String(info?.version||'nova')+' será instalada ao fechar o aplicativo.');
  });

  autoUpdater.on('error',error=>{
    console.warn('Atualizador do Acord:',error?.message||error);
  });

  const check=()=>autoUpdater.checkForUpdatesAndNotify().catch(()=>{});
  setTimeout(check,12000);
  setInterval(check,UPDATE_CHECK_MS);
}

async function clearOnlyUiCaches(){
  const ses=session.defaultSession;

  try{await ses.clearCache()}catch{}

  // Preserva cookies e localStorage da conta. Só remove SW/cache de interface.
  try{
    await ses.clearStorageData({
      origin:ACORD_ORIGIN,
      storages:['serviceworkers','cachestorage']
    });
  }catch{}
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
    icon:path.join(__dirname,'icon.ico'),
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
    win.webContents.getUserAgent()+' AcordDesktop/6.3'
  );

  win.webContents.on('will-attach-webview',event=>event.preventDefault());

  win.webContents.setWindowOpenHandler(({url})=>{
    openExternalSafe(url);
    return {action:'deny'};
  });

  win.webContents.on('will-navigate',(event,url)=>{
    if(isAcordUrl(url)) return;
    if(url.startsWith('file://')) return;
    event.preventDefault();
    openExternalSafe(url);
  });

  let retries=0;
  let watchdog=null;

  const showLocalFallback=async()=>{
    clearTimeout(watchdog);
    try{
      await win.loadFile(path.join(__dirname,'fallback.html'));
    }catch(error){
      console.error('Fallback do Acord:',error);
    }
  };

  const verifyRenderedUi=async()=>{
    try{
      const state=await win.webContents.executeJavaScript(`
        (() => {
          const login=document.getElementById('login');
          const app=document.getElementById('appShell');
          const visible=el=>{
            if(!el)return false;
            const s=getComputedStyle(el);
            const r=el.getBoundingClientRect();
            return s.display!=='none' && s.visibility!=='hidden' && Number(s.opacity||1)>0 && r.width>0 && r.height>0;
          };
          return {
            hasLogin:!!login,
            hasApp:!!app,
            loginVisible:visible(login),
            appVisible:visible(app),
            bootReady:!!window.__ACORD_BOOT_READY
          };
        })()
      `);

      if(
        !state ||
        (!state.hasLogin && !state.hasApp) ||
        (!state.loginVisible && !state.appVisible)
      ){
        if(retries<1){
          retries++;
          await win.loadURL(ACORD_FALLBACK_URL+'&t='+Date.now());
        }else{
          await showLocalFallback();
        }
      }
    }catch{
      if(retries<1){
        retries++;
        win.loadURL(ACORD_FALLBACK_URL+'&t='+Date.now()).catch(showLocalFallback);
      }else{
        showLocalFallback();
      }
    }
  };

  win.webContents.on('did-finish-load',()=>{
    clearTimeout(watchdog);

    // The window is shown only after an actual document loaded.
    if(!win.isVisible()) win.show();

    watchdog=setTimeout(verifyRenderedUi,1800);
  });

  win.webContents.on('did-fail-load',(_event,_code,_description,_url,isMainFrame)=>{
    if(!isMainFrame) return;

    if(retries<1){
      retries++;
      setTimeout(()=>{
        win.loadURL(ACORD_FALLBACK_URL+'&retry=1&t='+Date.now()).catch(showLocalFallback);
      },700);
    }else{
      showLocalFallback();
    }
  });

  // Never leave an invisible window forever.
  setTimeout(()=>{
    if(!win.isVisible()) win.show();
  },3500);

  await win.loadURL(ACORD_URL+'&t='+Date.now()).catch(async()=>{
    await showLocalFallback();
  });

  return win;
}

app.whenReady().then(async()=>{
  await clearOnlyUiCaches();

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
      callback(
        isAcordUrl(webContents.getURL()) &&
        [
          'media',
          'notifications',
          'fullscreen',
          'pointerLock',
          'clipboard-sanitized-write',
          'display-capture'
        ].includes(permission)
      );
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