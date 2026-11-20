'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const env=vm.createContext({console,structuredClone,crypto,performance});
for(const file of ['model','spatial','patch','patch-panel']){
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file+'.js'),'utf8'),env);
}
const S=env.SW;
let p=S.demo();
const keys=p.tracks[0],bus=p.tracks.find(t=>t.type==='bus');
const events={};
const panelWindow={};
let picked=null;
const style={};
const world={style,getBoundingClientRect:()=>({left:0,top:0})};
const wires={innerHTML:''},ghost={innerHTML:''};
let trackNodes=[];
const attrs={};
const canvas={
  clientWidth:720,clientHeight:370,style:{},isConnected:true,
  querySelector(selector){
    if(selector==='.patch-world')return world;
    if(selector==='.patch-wires')return wires;
    if(selector==='.patch-ghost')return ghost;
    if(selector.startsWith('[data-patch-node='))return trackNodes.find(node=>selector.includes(node.dataset.patchNode));
    return null;
  },
  querySelectorAll(selector){return selector==='[data-patch-node]'?trackNodes:[];},
  getBoundingClientRect:()=>({left:0,top:0}),focus(){},setPointerCapture(){},
  setAttribute(key,value){attrs[key]=value;}
};
const dock={
  ownerDocument:{elementFromPoint:()=>picked},querySelector:selector=>selector==='[data-patch-view]'?canvas:null,
  addEventListener(type,fn){events[type]=fn;}
};
let html='';
const panel=S.createPatchPanel({
  listenWindow:(type,fn)=>{panelWindow[type]=fn;},getProject:()=>p,getTrack:()=>p.tracks[0],
  selectTrack(){},inspect(){},dock,edit:fn=>{fn();refresh();},replace:next=>{p=next;refresh();},
  refresh,status:message=>{throw Error(message);},busy:()=>false,trackControls:()=>'<span>Channel controls</span>',
  cueControls:()=>'<span>Cue controls</span>',cueDetail:()=>'',esc:String
});
function refresh(){
  html=panel.render();
  trackNodes=[...html.matchAll(/data-patch-node="([^"]+)"/g)].map(([,id])=>({
    dataset:{patchNode:id},style:{},offsetHeight:96,classList:{toggle(){}}
  }));
  panel.mount();
}
const noClick={closest(selector){return selector==='[data-patch-view]'?canvas:null;}};
function event(target=noClick,overrides={}){
  return {target,button:0,clientX:20,clientY:20,pointerId:1,preventDefault(){},...overrides};
}
function nodeTarget(id){
  return {closest(selector){
    if(selector==='[data-patch-view]')return canvas;
    if(selector==='[data-patch-node]')return trackNodes.find(node=>node.dataset.patchNode===id);
    return null;
  }};
}
function portTarget(id,key,side){
  const target=nodeTarget(id);
  const port={dataset:{patchPort:key},classList:{contains:expected=>side===expected},closest:target.closest};
  return {closest:selector=>selector==='[data-patch-port]'?port:target.closest(selector)};
}
panel.bind();
refresh();
const keysNode=keys.id+':track';
assert.equal(trackNodes.filter(node=>node.dataset.patchNode.startsWith(keys.id+':')).length,1);
assert.match(html,/Channel controls/);

const from=portTarget(keysNode,'route','out'), to=portTarget(bus.id+':track','sum','in');
assert.equal(panel.key({target:from,key:'Enter'}),true);
assert.equal(panel.key({target:to,key:'Enter'}),true);
assert.equal(p.tracks[0].out,bus.id);
assert.match(wires.innerHTML,new RegExp('data-patch-wire="output:'+keys.id));

const beforePan=parseFloat(trackNodes.find(node=>node.dataset.patchNode===keysNode).style.left);
events.pointerdown(event(noClick,{button:1}));
panelWindow.pointermove(event(noClick,{clientX:16000,clientY:8000}));
panelWindow.pointerup(event());
assert.equal(parseFloat(trackNodes.find(node=>node.dataset.patchNode===keysNode).style.left),beforePan+15980);
assert.ok(Math.abs(parseFloat(canvas.style.backgroundPosition))<21);

const node=nodeTarget(keysNode);
events.pointerdown(event(node));
panelWindow.pointermove(event(node,{clientX:-40500,clientY:-110}));
panelWindow.pointerup(event(node));
assert.ok(p.flowPositions[keysNode].x<-30000);
assert.ok(p.flowPositions[keysNode].y<0);
assert.equal(attrs.width,undefined);
panel.fit();
assert.match(style.transform,/scale\(/);

const openStage={dataset:{patchAction:'stage-view'},closest:selector=>node.closest(selector)};
events.click(event({closest:selector=>selector==='[data-patch-action]'?openStage:null}));
assert.ok(trackNodes.some(row=>row.dataset.patchNode===keys.id+':trim'));
assert.ok(!trackNodes.some(row=>row.dataset.patchNode.startsWith(bus.id+':')));
console.log('Channel projection, keyboard rewiring, unbounded pan, negative node positions and the internal patch passed.');
