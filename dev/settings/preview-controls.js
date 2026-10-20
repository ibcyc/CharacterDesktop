function createPreviewControls(canvas,{isReady,getBase,apply,onPoke,minZoom=.25,maxZoom=4}){
 const MIN_ZOOM=minZoom,MAX_ZOOM=maxZoom;
 let zoom=1,panX=0,panY=0,drag=null;
 function transform(){const base=getBase();apply({scale:base.scale*zoom,x:base.x+panX,y:base.y+panY});}
 function finish(){
  const previous=drag;drag=null;canvas.classList.remove('panning');
  if(previous&&canvas.hasPointerCapture?.(previous.id))canvas.releasePointerCapture(previous.id);
 }
 canvas.addEventListener('wheel',event=>{
  if(!isReady())return;event.preventDefault();
  const rect=canvas.getBoundingClientRect(),base=getBase(),ratio=rect.height/600;
  if(!ratio)return;
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?rect.height:1);
  const next=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,zoom*Math.exp(-delta*.0015))),factor=next/zoom;
  const anchorX=event.clientX-rect.left,anchorY=event.clientY-rect.top;
  const centerX=rect.width/2+(base.x+panX)*ratio,centerY=rect.height/2+(base.y+panY)*ratio;
  panX=(anchorX-(anchorX-centerX)*factor-rect.width/2)/ratio-base.x;
  panY=(anchorY-(anchorY-centerY)*factor-rect.height/2)/ratio-base.y;
  zoom=next;transform();
 },{passive:false});
 canvas.addEventListener('contextmenu',event=>event.preventDefault());
 canvas.addEventListener('pointerdown',event=>{
  if(event.button!==2||!isReady())return;event.preventDefault();finish();
  drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.classList.add('panning');
  try{canvas.setPointerCapture(event.pointerId);}catch{/* synthetic events may have no active pointer */}
 });
 canvas.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  if(!isReady()||!(event.buttons&2)){finish();return;}
  const height=canvas.getBoundingClientRect().height;if(!height)return;
  panX+=(event.clientX-drag.x)*600/height;panY+=(event.clientY-drag.y)*600/height;
  drag.x=event.clientX;drag.y=event.clientY;event.preventDefault();transform();
 });
 const release=event=>{if(drag&&event.pointerId===drag.id)finish();};
 window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);
 canvas.addEventListener('lostpointercapture',release);window.addEventListener('blur',finish);
 canvas.addEventListener('click',event=>{if(event.button===0&&isReady())onPoke(event);});
 return {reset(){finish();zoom=1;panX=0;panY=0;transform();},state:()=>({zoom,panX,panY,dragging:!!drag})};
}
