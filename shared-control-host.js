const path=require('path');
const {spawn}=require('child_process');

let sharedControlProcess=null;
let sharedControlEnabled=false;

function stopSharedControlHost(){
  sharedControlEnabled=false;
  if(sharedControlProcess){
    try{sharedControlProcess.stdin.write(JSON.stringify({type:'release-all'})+'\n')}catch{}
    try{sharedControlProcess.kill()}catch{}
    sharedControlProcess=null;
  }
}

function ensureSharedControlHost(){
  if(process.platform!=='win32') return null;
  if(sharedControlProcess && !sharedControlProcess.killed) return sharedControlProcess;
  try{
    sharedControlProcess=spawn('powershell.exe',[
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-File',path.join(__dirname,'control-host.ps1')
    ],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    sharedControlProcess.on('exit',()=>{sharedControlProcess=null;sharedControlEnabled=false});
    sharedControlProcess.stderr?.on('data',data=>console.warn('Controle compartilhado:',String(data||'').trim()));
    return sharedControlProcess;
  }catch(error){
    console.error('Controle compartilhado indisponível:',error);
    sharedControlProcess=null;
    sharedControlEnabled=false;
    return null;
  }
}

function validSharedControlInput(value){
  if(!value || typeof value!=='object') return null;
  const type=String(value.type||'');
  if(type==='pointer-move'){
    const x=Number(value.x),y=Number(value.y);
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    return {type,x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};
  }
  if(type==='pointer-button') return {type,button:Math.max(0,Math.min(2,Number(value.button)||0)),down:!!value.down};
  if(type==='wheel') return {type,deltaY:Math.max(-1200,Math.min(1200,Number(value.deltaY)||0))};
  if(type==='key'){
    const code=String(value.code||'').slice(0,32);
    if(!/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|Enter|Escape|Backspace|Tab|Arrow(?:Left|Up|Right|Down)|Home|End|PageUp|PageDown|Insert|Delete|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote)$/.test(code))return null;
    return {type,code,down:!!value.down};
  }
  if(type==='release-all') return {type};
  return null;
}

function setSharedControlHostEnabled(enabled){
  if(process.platform!=='win32') return {ok:false,error:'Controle compartilhado do host requer Windows'};
  if(!enabled){stopSharedControlHost();return {ok:true,enabled:false}}
  const helper=ensureSharedControlHost();
  if(!helper) return {ok:false,error:'Não foi possível iniciar o controle do Windows'};
  sharedControlEnabled=true;
  return {ok:true,enabled:true};
}

function injectSharedControlInput(payload){
  if(!sharedControlEnabled) return {ok:false,error:'Controle compartilhado inativo'};
  const envelope=payload&&typeof payload==='object'&&payload.event?payload:{event:payload,permissions:{mouse:true,keyboard:true,gamepad:false}};
  const safe=validSharedControlInput(envelope.event);
  if(!safe) return {ok:false,error:'Entrada inválida'};
  const permissions=envelope.permissions&&typeof envelope.permissions==='object'?envelope.permissions:{};
  if((safe.type==='pointer-move'||safe.type==='pointer-button'||safe.type==='wheel')&&permissions.mouse!==true) return {ok:false,error:'Mouse não autorizado'};
  if(safe.type==='key'&&permissions.keyboard!==true) return {ok:false,error:'Teclado não autorizado'};
  if(safe.type==='gamepad') return {ok:false,error:'Gamepad ainda não disponível'};
  const helper=ensureSharedControlHost();
  if(!helper?.stdin?.writable) return {ok:false,error:'Helper do Windows indisponível'};
  try{helper.stdin.write(JSON.stringify(safe)+'\\n');return {ok:true}}
  catch{return {ok:false,error:'Falha ao enviar comando ao Windows'}}
}

function registerSharedControl({ipcMain,isTrustedAcordSender}){
  ipcMain.handle('acord-shared-control-host',(event,enabled)=>{
    if(!isTrustedAcordSender(event)) return {ok:false,error:'Origem não autorizada'};
    return setSharedControlHostEnabled(!!enabled);
  });

  ipcMain.on('acord-shared-control-input',(event,payload)=>{
    if(!isTrustedAcordSender(event)) return;
    injectSharedControlInput(payload);
  });
}

module.exports={registerSharedControl,stopSharedControlHost,validSharedControlInput,setSharedControlHostEnabled,injectSharedControlInput};
