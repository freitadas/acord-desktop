const { app, BrowserWindow, session, shell, desktopCapturer } = require('electron');

const ACORD_ORIGIN='https://d2-camera.bozzidavi.workers.dev';
const ACORD_URL=ACORD_ORIGIN+'/?desktop=1';

function isAcordUrl(value=''){
  try{
    return new URL(value).origin===ACORD_ORIGIN;
  }catch{
    return false;
  }
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
      webSecurity:true
    }
  });

  win.webContents.setUserAgent(
    win.webContents.getUserAgent()+' AcordDesktop/5.4'
  );

  win.webContents.setWindowOpenHandler(({url})=>{
    if(isAcordUrl(url)){
      return {action:'allow'};
    }

    shell.openExternal(url).catch(()=>{});
    return {action:'deny'};
  });

  win.webContents.on('will-navigate',(event,url)=>{
    if(!isAcordUrl(url)){
      event.preventDefault();
      shell.openExternal(url).catch(()=>{});
    }
  });

  win.once('ready-to-show',()=>win.show());

  await win.loadURL(ACORD_URL);
}

app.whenReady().then(async()=>{
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

          callback({
            video:sources[0],
            audio:'loopback'
          });
        }catch{
          callback({});
        }
      },
      {useSystemPicker:true}
    );
  }

  await createWindow();

  app.on('activate',async()=>{
    if(BrowserWindow.getAllWindows().length===0){
      await createWindow();
    }
  });
});

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin'){
    app.quit();
  }
});
