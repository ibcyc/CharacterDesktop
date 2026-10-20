// Windows keeps this preference in the current user's login items, outside portable Data.
function createStartup(app,{name='CharacterDesktop',exe=process.execPath,supported=process.platform==='win32'&&app.isPackaged}={}){
 const args=['--autostart'];
 function get(){
  if(!supported)return {supported:false,enabled:false};
  const info=app.getLoginItemSettings({path:exe,args});
  return {supported:true,enabled:!!info.launchItems?.some(item=>item.name===name&&item.scope==='user'&&item.enabled&&item.path.toLowerCase()===exe.toLowerCase())};
 }
 function set(enabled){
  if(typeof enabled!=='boolean')throw Error('開機啟動設定必須是開或關。');
  if(!supported)throw Error('請使用 Windows 封裝版設定開機啟動。');
  app.setLoginItemSettings({name,path:exe,args,openAtLogin:enabled,enabled});
  const value=get();
  if(value.enabled!==enabled)throw Error('無法更新開機啟動，請檢查 Windows 的啟動應用程式設定。');
  return value;
 }
 return {get,set};
}
module.exports={createStartup};
