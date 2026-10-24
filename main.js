const { app, BrowserWindow, session, shell, desktopCapturer, Notification, ipcMain, screen: electronScreen, protocol } = require('electron');
const path = require('path');
const {registerSharedControl,stopSharedControlHost,setSharedControlHostEnabled,injectSharedControlInput}=require('./shared-control-host');

// Ponte de emergência independente do preload. O esquema só existe dentro do Acord Desktop.
protocol.registerSchemesAsPrivileged([{
  scheme:'acord-native',
  privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}
}]);

// Windows/Chromium: mantém a captura e a reprodução em SDR/sRGB e evita
// overlays de vídeo que podem provocar dominante verde em screen share.
if(process.platform==='win32'){
  app.commandLine.appendSwitch('force-color-profile','srgb');
  app.commandLine.appendSwitch('disable-direct-composition-video-overlays');
}

let autoUpdater=null;
try{
  ({autoUpdater}=require('electron-updater'));
}catch(error){
  console.warn('Atualizador automático indisponível:',error?.message||error);
}

const ACORD_ORIGIN='https://d2-camera.bozzidavi.workers.dev';
const ACORD_URL=ACORD_ORIGIN+'/?desktop=1&app=6.8.4';
const ACORD_FALLBACK_URL=ACORD_ORIGIN+'/?desktop=1&app=6.8.4&fallback=1';
const UPDATE_CHECK_MS=1000*60*60*6;

function isTrustedAcordSender(event){
  try{
    const url=event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    return isAcordUrl(url);
  }catch{return false}
}

registerSharedControl({ipcMain,isTrustedAcordSender});

ipcMain.handle('acord-desktop-ping',event=>isTrustedAcordSender(event)?{ok:true,available:true,platform:process.platform,version:'6.8.4'}:{ok:false,error:'Origem não autorizada'});

ipcMain.handle('acord-shared-control-primary-source',async event=>{
  if(!isTrustedAcordSender(event)) return {ok:false,error:'Origem não autorizada'};
  if(process.platform!=='win32') return {ok:false,error:'Captura automática requer Windows'};
  try{
    const sources=await desktopCapturer.getSources({
      types:['screen'],
      thumbnailSize:{width:0,height:0},
      fetchWindowIcons:false
    });
    if(!sources.length) return {ok:false,error:'Nenhum monitor disponível para captura'};
    const primaryId=String(electronScreen.getPrimaryDisplay()?.id??'');
    const source=sources.find(item=>String(item.display_id||'')===primaryId) || sources[0];
    return {
      ok:true,
      id:String(source.id||''),
      name:String(source.name||'Monitor principal').slice(0,120),
      displayId:String(source.display_id||'')
    };
  }catch(error){
    console.error('Falha ao localizar monitor principal:',error);
    return {ok:false,error:'Não foi possível acessar o monitor principal'};
  }
});


function parseUrl(value=''){
  try{return new URL(value)}catch{return null}
}

function isAcordUrl(value=''){
  const url=parseUrl(value);
  return !!url && url.origin===ACORD_ORIGIN;
}

function nativeBridgeCorsHeaders(){
  return {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':ACORD_ORIGIN,
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'Cache-Control':'no-store'
  };
}

function nativeBridgeResponse(payload,status=200){
  return new Response(JSON.stringify(payload),{status,headers:nativeBridgeCorsHeaders()});
}

function nativeBridgeRequestTrusted(request){
  try{
    const origin=String(request.headers.get('origin')||'');
    const referrer=String(request.referrer||request.headers.get('referer')||'');
    return origin===ACORD_ORIGIN || referrer.startsWith(ACORD_ORIGIN+'/') || BrowserWindow.getAllWindows().some(win=>!win.isDestroyed()&&isAcordUrl(win.webContents.getURL()));
  }catch{return false}
}

async function registerNativeProtocolBridge(){
  try{await protocol.unhandle('acord-native')}catch{}
  protocol.handle('acord-native',async request=>{
    if(request.method==='OPTIONS') return new Response('',{status:204,headers:nativeBridgeCorsHeaders()});
    if(!nativeBridgeRequestTrusted(request)) return nativeBridgeResponse({ok:false,error:'Origem não autorizada'},403);
    try{
      const url=new URL(request.url);
      const action=(url.hostname+url.pathname).replace(/^\/+|\/+$/g,'');
      if(action==='control/ping') return nativeBridgeResponse({ok:true,available:true,platform:process.platform,version:'6.8.4'});
      if(action==='control/host'){
        const body=request.method==='POST'?await request.json().catch(()=>({})):{};
        return nativeBridgeResponse(setSharedControlHostEnabled(!!body.enabled));
      }
      if(action==='control/input'){
        const body=request.method==='POST'?await request.json().catch(()=>({})):{};
        return nativeBridgeResponse(injectSharedControlInput(body));
      }
      if(action==='control/release') return nativeBridgeResponse(injectSharedControlInput({event:{type:'release-all'},permissions:{mouse:true,keyboard:true}}));
      if(action==='control/primary'){
        const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0},fetchWindowIcons:false});
        if(!sources.length) return nativeBridgeResponse({ok:false,error:'Nenhum monitor disponível'});
        const primaryId=String(electronScreen.getPrimaryDisplay()?.id??'');
        const source=sources.find(item=>String(item.display_id||'')===primaryId)||sources[0];
        return nativeBridgeResponse({ok:true,id:String(source.id||''),name:String(source.name||'Monitor principal').slice(0,120),displayId:String(source.display_id||'')});
      }
      return nativeBridgeResponse({ok:false,error:'Ação desconhecida'},404);
    }catch(error){
      console.error('Ponte nativa alternativa:',error);
      return nativeBridgeResponse({ok:false,error:'Falha na ponte nativa'},500);
    }
  });
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
      webviewTag:false,
      safeDialogs:true,
      backgroundThrottling:false,
      preload:path.join(__dirname,'preload.js')
    }
  });

  win.webContents.setUserAgent(
    win.webContents.getUserAgent()+' AcordDesktop/6.8.4'
  );

  win.webContents.on('will-attach-webview',event=>event.preventDefault());

  win.webContents.on('preload-error',(_event,preloadPath,error)=>{
    console.error('Acord Desktop preload error:',preloadPath,error);
  });

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
  let fallbackOpening=false;

  const showLocalFallback=async()=>{
    if(fallbackOpening || win.isDestroyed()) return;
    fallbackOpening=true;
    clearTimeout(watchdog);
    try{
      await win.loadFile(path.join(__dirname,'fallback.html'));
      if(!win.isVisible()) win.show();
    }catch(error){
      console.error('Fallback do Acord:',error);
    }finally{
      fallbackOpening=false;
    }
  };

  const verifyRenderedUi=async()=>{
    if(win.isDestroyed() || !isAcordUrl(win.webContents.getURL())) return;
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
            bootReady:!!window.__ACORD_BOOT_READY,
            appReady:!!window.__ACORD_APP_READY,
            diagnostics:window.__ACORD_DIAGNOSTICS?.snapshot?.().slice(-8)||[]
          };
        })()
      `);

      if(
        !state ||
        (!state.hasLogin && !state.hasApp) ||
        (!state.loginVisible && !state.appVisible)
      ){
        console.warn('Acord UI não renderizada:',state);
        if(retries<1){
          retries++;
          await win.loadURL(ACORD_FALLBACK_URL+'&retry=ui&t='+Date.now());
        }else{
          await showLocalFallback();
        }
      }
    }catch(error){
      console.warn('Falha ao verificar interface do Acord:',error?.message||error);
      if(retries<1){
        retries++;
        win.loadURL(ACORD_FALLBACK_URL+'&retry=verify&t='+Date.now()).catch(showLocalFallback);
      }else{
        showLocalFallback();
      }
    }
  };

  const armNavigationWatchdog=()=>{
    clearTimeout(watchdog);
    watchdog=setTimeout(()=>{
      if(!win.isDestroyed() && isAcordUrl(win.webContents.getURL())){
        verifyRenderedUi();
      }else if(!win.isDestroyed()){
        showLocalFallback();
      }
    },15000);
  };

  win.webContents.on('did-start-navigation',(_event,_url,_isInPlace,isMainFrame)=>{if(isMainFrame)stopSharedControlHost()});

  win.webContents.on('did-finish-load',()=>{
    const current=win.webContents.getURL();
    if(!win.isVisible()) win.show();

    if(isAcordUrl(current)){
      // Marcador não privilegiado para a UI reconhecer inequivocamente o shell Electron.
      // As ações privilegiadas continuam passando somente pelo preload/IPC validado.
      win.webContents.executeJavaScript(
        "window.__ACORD_DESKTOP_SHELL__={available:true,platform:'win32',version:'6.8.4'};"
      ).catch(()=>{});
      clearTimeout(watchdog);
      watchdog=setTimeout(verifyRenderedUi,3200);
    }
  });

  win.webContents.on('did-fail-load',(_event,_code,_description,_url,isMainFrame)=>{
    if(!isMainFrame || fallbackOpening) return;
    clearTimeout(watchdog);

    if(retries<1){
      retries++;
      setTimeout(()=>{
        armNavigationWatchdog();
        win.loadURL(ACORD_FALLBACK_URL+'&retry=network&t='+Date.now()).catch(showLocalFallback);
      },700);
    }else{
      showLocalFallback();
    }
  });

  win.on('unresponsive',()=>{
    console.warn('Janela do Acord não está respondendo.');
  });

  // Mostra uma tela local imediatamente; assim o usuário nunca vê uma janela vazia
  // enquanto a página remota, a sessão e os scripts são carregados.
  try{
    await win.loadFile(path.join(__dirname,'loading.html'));
  }catch(error){
    console.warn('Tela inicial local indisponível:',error?.message||error);
  }
  if(!win.isVisible()) win.show();

  armNavigationWatchdog();
  try{
    await win.loadURL(ACORD_URL+'&t='+Date.now());
  }catch{
    await showLocalFallback();
  }

  win.on('closed',stopSharedControlHost);

  return win;
}

app.whenReady().then(async()=>{
  await registerNativeProtocolBridge();
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
      async(request,callback)=>{
        try{
          if(!isAcordUrl(request?.securityOrigin||'')){
            callback(null);
            return;
          }
          const sources=await desktopCapturer.getSources({
            types:['screen'],
            thumbnailSize:{width:0,height:0},
            fetchWindowIcons:false
          });
          if(!sources.length){callback(null);return}
          const primaryId=String(electronScreen.getPrimaryDisplay()?.id??'');
          const primary=sources.find(item=>String(item.display_id||'')===primaryId) || sources[0];
          const grant={video:primary};
          if(request?.audioRequested) grant.audio='loopback';
          callback(grant);
        }catch(error){
          console.error('Falha ao autorizar captura de tela:',error);
          callback(null);
        }
      }
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

app.on('before-quit',stopSharedControlHost);

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin') app.quit();
});