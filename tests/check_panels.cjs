'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

class Node extends EventTarget {
  constructor(doc,id=''){
    super();this.ownerDocument=doc;this.id=id;this.dataset={};this.children=[];
    const values=new Set();
    this.classList={add:key=>values.add(key),remove:key=>values.delete(key),contains:key=>values.has(key)};
  }
  append(...nodes){
    for(const node of nodes){
      if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);
      this.children.push(node);node.parent=this;node.adopt(this.ownerDocument);
    }
  }
  adopt(doc){this.ownerDocument=doc;for(const child of this.children)child.adopt(doc);}
  before(node){const parent=this.parent;parent.children.splice(parent.children.indexOf(this),0,node);node.parent=parent;}
  replaceWith(node){
    if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);
    const parent=this.parent;parent.children.splice(parent.children.indexOf(this),1,node);
    node.parent=parent;node.adopt(parent.ownerDocument);this.parent=null;
  }
  findById(id){return this.id===id?this:this.children.map(node=>node.findById(id)).find(Boolean);}
  setPointerCapture(id){this.captured=id;}
  requestFullscreen(){this.ownerDocument.fullscreenElement=this;return Promise.resolve();}
}

class Doc extends EventTarget {
  head=new Node(this);
  body=new Node(this);
  fullscreenElement=null;
  createComment(){return new Node(this);}
  getElementById(id){return this.body.findById(id);}
  querySelectorAll(){return [];}
  exitFullscreen(){this.fullscreenElement=null;return Promise.resolve();}
}

class Win extends EventTarget {
  constructor(doc){super();this.document=doc;doc.defaultView=this;}
  focus(){this.focused=true;}
  close(){this.closed=true;this.dispatchEvent(new Event('pagehide'));}
}

async function verify(){
  const document=new Doc(), window=new Win(document), SW={clamp:(v,l,h)=>Math.max(l,Math.min(h,v))};
  const detached=[];
  window.open=()=>{const child=new Win(new Doc());detached.push(child);return child;};
  const context=vm.createContext({SW,document,window,AbortController});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/panel-windows.js'),'utf8'),context);
  const region=new Node(document,'lower-panel'), mixer=new Node(document,'mixer');
  document.body.append(region);region.append(mixer);
  let changes=0, edits=0;
  const panels=SW.createPanelWindows({status:message=>{throw Error(message);},onChange:()=>changes++});
  panels.listen(document,'change',()=>edits++);
  panels.detach(region,'Mixer');
  const child=detached[0];
  assert.equal(region.ownerDocument,child.document);
  assert.equal(panels.get('mixer'),mixer);
  assert.equal(child.focused,true);
  child.document.dispatchEvent(new Event('change'));
  assert.equal(edits,1);
  await panels.fullscreen(region);
  assert.equal(child.document.fullscreenElement,region);
  await panels.fullscreen(region);
  assert.equal(child.document.fullscreenElement,null);
  child.close();
  assert.equal(region.ownerDocument,document);
  assert.equal(document.getElementById('mixer'),mixer);
  assert.equal(changes,2);
  child.document.dispatchEvent(new Event('change'));
  assert.equal(edits,1);
  const grip=new Node(document);
  let current=300;
  SW.bindPanelResize(grip,'y',()=>current,value=>current=value,()=>[110,500]);
  const pointer=(type,clientY)=>grip.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{button:0,clientY,pointerId:1}));
  pointer('pointerdown',410);pointer('pointermove',290);
  assert.equal(current,420);
  pointer('lostpointercapture',290);pointer('pointermove',110);
  assert.equal(current,420);
  console.log('Detachment, reattachment, fullscreen and panel resizing passed using DOM test doubles.');
}

verify().catch(error=>{console.error(error);process.exitCode=1;});
