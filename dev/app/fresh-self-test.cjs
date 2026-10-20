// First launch of the app alone (no extension): no characters, everything that needs one hidden, bad input refused.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run({app,getPets,getSettings,getState,dataRoot,report}){
 const settings=getSettings();let ready=false;
 for(let i=0;i<160;i++){try{ready=await settings.webContents.executeJavaScript('!!window.desktopSettingsTest&&!!window.desktopWorkflowTest');}catch{}if(ready)break;await sleep(125);}
 assert(ready,'首次使用介面未啟動');
 const state=getState(),summary=await settings.webContents.executeJavaScript('window.desktopSettingsTest.summary()');
 assert.equal(state.library.length,0);assert.equal(summary.roles,0);assert.equal(summary.activeId,'');assert.equal(state.selection.characterId,'');
 assert.equal(await settings.webContents.executeJavaScript('document.getElementById("download-url").value'),'');
 assert.equal(settings.getTitle(),'CharacterDesktop v'+app.getVersion(),'視窗標題未顯示版本號');
 assert.equal(await settings.webContents.executeJavaScript('typeof anime?.animate==="function"&&!window.playerFailed'),true,'anime.js 未載入或介面發生錯誤');
 // Without a character every character control is hidden; the store rejects bad input.
 assert.deepEqual(await settings.webContents.executeJavaScript(`['character-field','expression-field','tuning-field','tuning-options','download-toggle','download-cancel'].map(id=>$(id).hidden)`),[true,true,true,true,true,true]);
 assert.equal(await settings.webContents.executeJavaScript(`window.desktopAPI.setCharacterOptions('999',{a:1})`),null,'未知角色的設定未被拒絕');
 assert.equal(await settings.webContents.executeJavaScript(`window.desktopAPI.setMirror('999',true)`),false,'未知角色的鏡像未被拒絕');
 assert.equal(await settings.webContents.executeJavaScript(`window.desktopAPI.setTuning('999',{breath:1})`),null,'未知角色的細部調整未被拒絕');
 assert.deepEqual(getState().characters,{},'沒有角色時不應有角色設定');
 assert.equal(await settings.webContents.executeJavaScript(`window.desktopAPI.rememberExpression('999','3')`),false,'未知角色的表情設定未被拒絕');
 assert.equal(await settings.webContents.executeJavaScript(`window.desktopAPI.resetCharacter('999')`),false,'未知角色的重設未被拒絕');
 // Until the first character arrives the hint above the preview and the desktop panel are hidden.
 assert.deepEqual(await settings.webContents.executeJavaScript(`[$('status').hidden,$('desktop-panel').hidden]`),[true,true],'沒有角色時提示與右側面板應隱藏');
 // Opacity runs from 1% to 100% (limits are unit-tested). Without a character the desktop controls are off and nothing is on the desktop.
 assert.equal(await settings.webContents.executeJavaScript(`$('desktop-opacity').min`),'1');
 assert.deepEqual(await settings.webContents.executeJavaScript(`[$('desktop-visible').hidden,$('desktop-lock').hidden,$('layers').children.length,$('layers-field').hidden]`),[true,true,0,true]);
 assert.equal((await settings.webContents.executeJavaScript(`window.desktopAPI.setOptions({visible:true,opacity:5})`)).visible,false,'沒有角色時不應顯示任何角色');
 assert.deepEqual(getPets(),[],'沒有角色時不應建立桌面視窗');
 const disk=JSON.parse(fs.readFileSync(path.join(dataRoot,'settings.json'),'utf8'));
 for(const key of ['downloadRoot','lastDownloadFolder','storageVersion'])assert(!(key in disk)&&!(key in state.download),'舊版下載資料夾設定未移除：'+key);
 assert(!fs.existsSync(path.join(dataRoot,'Characters')),'不應建立 Characters 資料夾');
 // Without extensions: the file button only, nothing to download from, and the sources popup lists Local alone.
 assert.deepEqual(await settings.webContents.executeJavaScript(`$('sources-toggle').click();[!$('local-toggle').hidden,$('download-toggle').hidden,$('sources-panel').hidden,$('sources-panel').textContent]`),
  [true,true,false,'Local使用者的圖片：Data\\LocalExtension沒有安裝擴充功能']);
 const refused=await settings.webContents.executeJavaScript(`window.desktopAPI.download('https://example.com/character')`);
 assert(!refused.ok&&/沒有可以下載/.test(refused.message),'沒有擴充功能時不應下載：'+JSON.stringify(refused));
 assert.deepEqual(await settings.webContents.executeJavaScript(`window.desktopAPI.extensionPages('settings')`),[],'不應有擴充功能');
 fs.writeFileSync(report,JSON.stringify({ok:true,roles:0,selectedCharacter:'',urlFieldEmpty:true,petHidden:true,oldSettingsDropped:true,noCharactersFolder:true,noExtensions:true},null,2));app.exit(0);
}
module.exports={run};
