// The preview's controls (wheel zoom, right-drag pan, left-click poke, reset) with a stand-in character kind.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run({app,getSettings,getState,report}){
 const settings=getSettings();let loaded=false;
 for(let i=0;i<160;i++){try{loaded=await settings.webContents.executeJavaScript('!!window.desktopSettingsTest&&!!window.desktopWorkflowTest');}catch{}if(loaded)break;await sleep(125);}
 assert(loaded,'預覽介面沒有完成初始化');
 const checks=await settings.webContents.executeJavaScript(`(()=>{try{
  const check=(value,message)=>{if(!value)throw Error(message);};
  const removed=['zoom','vertical','poke','reset','import','folder','save','remove','model-info','files','directory'];
  check(removed.every(id=>!document.getElementById(id)),'舊功能控制項仍在 DOM');
  check(![...document.querySelectorAll('h2')].some(e=>['預覽','角色庫'].includes(e.textContent.trim())),'舊功能區仍存在');
  check(!window.playerFailed,'啟動發生錯誤');
  check(document.getElementById('character')&&document.getElementById('download-form'),'下載或角色切換不見了');
  // The character menu lists characters by their label's tag in natural order; within a tag, and untagged (last), as added.
  registerCharacterKind('test-b',{label:e=>'[X] '+e.name});registerCharacterKind('test-a',{label:e=>'[B] '+e.name});
  loadLibrary([{id:'1',extension:'test-b',name:'x'},{id:'2',kind:'local',folder:'1',name:'l',files:{}},{id:'3',extension:'test-a',name:'y',english:'Y'},{id:'4',extension:'test-b',name:'z'},{id:'5',extension:'none',name:'plain'},{id:'6',kind:'local',folder:'2',name:'m',files:{}}]);
  const order=[...document.getElementById('character').options].map(o=>o.textContent).join('|');
  check(order==='[B] y · Y|[L] l|[L] m|[X] x|[X] z|plain','角色選單沒有依標籤排列：'+order);
  loadLibrary([]);characterKinds.delete('test-a');characterKinds.delete('test-b');
  const calls={pokes:0};
  const viewer={scale:0,x:0,y:0,setTransform(scale,x,y){Object.assign(this,{scale,x,y});},poke(){calls.pokes++;return {};},base:()=>({scale:0.1,x:0,y:-25}),unload(){},sync(){}};
  activeKind=viewer;currentKey='test';placePreview();
  ready=true;busy=false;previewControls.reset();
  const canvas=document.getElementById('viewer-canvas'),rect=canvas.getBoundingClientRect();
  const x=Math.round(rect.left+rect.width*.67),y=Math.round(rect.top+rect.height*.43),ratio=rect.height/600;
  const world=()=>({x:(x-rect.left-rect.width/2-viewer.x*ratio)/(viewer.scale*ratio),y:(y-rect.top-rect.height/2-viewer.y*ratio)/(viewer.scale*ratio)});
  const wheel=delta=>{const e=new WheelEvent('wheel',{deltaY:delta,clientX:x,clientY:y,bubbles:true,cancelable:true});canvas.dispatchEvent(e);return e;};
  const pointer=(target,type,button,buttons,px=x,py=y,id=42)=>target.dispatchEvent(new PointerEvent(type,{button,buttons,clientX:px,clientY:py,pointerId:id,bubbles:true,cancelable:true}));
  const anchor=world();check(wheel(-160).defaultPrevented,'滾輪沒有阻止頁面捲動');check(previewControls.state().zoom>1,'滾輪沒有放大');
  const after=world();check(Math.abs(anchor.x-after.x)<1e-7&&Math.abs(anchor.y-after.y)<1e-7,'縮放沒有維持滑鼠所在模型位置 '+JSON.stringify({anchor,after}));
  wheel(160);check(Math.abs(previewControls.state().zoom-1)<1e-10,'滾輪沒有縮小');
  const old={x:viewer.x,y:viewer.y};pointer(canvas,'pointerdown',2,2);pointer(canvas,'pointermove',-1,2,x+55,y-28);pointer(window,'pointerup',2,0,x+55,y-28);
  check(Math.abs(viewer.x-old.x-55/ratio)<1e-8&&Math.abs(viewer.y-old.y+28/ratio)<1e-8,'右鍵拖曳座標不正確');
  check(!previewControls.state().dragging,'放開右鍵後仍在拖曳');check(calls.pokes===0,'右鍵拖曳誤觸點擊反應');
  const menu=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});canvas.dispatchEvent(menu);check(menu.defaultPrevented,'預覽出現瀏覽器右鍵選單');
  canvas.dispatchEvent(new MouseEvent('click',{button:2,bubbles:true}));check(calls.pokes===0,'右鍵點擊誤觸反應');
  canvas.dispatchEvent(new MouseEvent('click',{button:0,bubbles:true}));check(calls.pokes===1,'左鍵沒有播放一次反應');
  wheel(-100000);check(previewControls.state().zoom===4,'放大上限錯誤');wheel(100000);check(previewControls.state().zoom===.25,'縮小下限錯誤');
  pointer(canvas,'pointerdown',2,2);window.dispatchEvent(new Event('blur'));check(!previewControls.state().dragging,'視窗失焦後拖曳未結束');
  pointer(canvas,'pointerdown',2,2);pointer(window,'pointercancel',2,0);check(!previewControls.state().dragging,'取消指標後拖曳未結束');
  previewControls.reset();busy=true;const blocked=wheel(-160);check(!blocked.defaultPrevented&&previewControls.state().zoom===1,'載入時仍修改預覽');
  pointer(canvas,'pointerdown',2,2);check(!previewControls.state().dragging,'載入時仍開始拖曳');
  canvas.dispatchEvent(new MouseEvent('click',{button:0,bubbles:true}));check(calls.pokes===1,'載入時誤觸互動');
  busy=false;wheel(-160);pointer(canvas,'pointerdown',2,2);pointer(canvas,'pointermove',-1,2,x+40,y+30);pointer(window,'pointerup',2,0,x+40,y+30);
  check(previewControls.state().zoom>1&&previewControls.state().panX!==0,'預覽沒有被移動');
  $('desktop-reset').click();const reset=previewControls.state();
  check(reset.zoom===1&&reset.panX===0&&reset.panY===0&&viewer.scale===baseScale&&viewer.x===baseX&&viewer.y===baseY,'找回角色沒有讓預覽歸位');
  ready=false;currentKey='';activeKind=null;
  return {panelsRemoved:true,wheelZoom:true,cursorAnchor:true,rightDrag:true,rightDragDoesNotPoke:true,leftClick:true,zoomLimits:true,blurAndCancelRelease:true,busyGuard:true,resetButtonResetsPreview:true,roles:library.size};
 }catch(error){return {testError:error.stack||String(error)};}})()`);
 assert(!checks.testError,checks.testError);
 assert.equal(checks.roles,0);assert.equal(getState().library.length,0);
 // Without a character the show/hide switch and lock are off; with characters they are covered by the character test.
 assert.deepEqual(await settings.webContents.executeJavaScript('[$("desktop-visible").hidden,$("desktop-visible").checked,$("desktop-lock").hidden]'),[true,false,true]);
 checks.visibilitySwitchIdle=true;
 fs.mkdirSync(path.dirname(report),{recursive:true});
 fs.writeFileSync(path.join(path.dirname(report),'settings.png'),(await settings.webContents.capturePage()).toPNG());
 fs.writeFileSync(report,JSON.stringify({ok:true,...checks},null,2));app.exit(0);
}
module.exports={run};
