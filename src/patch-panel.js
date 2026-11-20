'use strict';
SW.createPatchPanel=function createPatchPanel(api){
  const {listenWindow=(...args)=>window.addEventListener(...args),getProject,getTrack,selectTrack,edit,replace,refresh,status,busy,dock,esc}=api;
  const width=154,height=96,channelWidth=220;
  const cameras={track:{x:0,y:0,scale:1},stage:{x:0,y:0,scale:1}};
  const expanded=new Set();
  let stageOwner=null;
  const camera=()=>stageOwner?cameras.stage:cameras.track;
  const nodeWidth=n=>n.kind==='channel'||n.kind==='channel-cue'?channelWidth:width;
  const dragType='application/x-soundweave-plugin';
  const colors={signal:'#658096',midi:'#e7a06c',output:'#78dec6',pre:'#efbc79',post:'#bdb0ff',cue:'#86afff',monitor:'#e5e8a7'};
  let nodes=new Set(),wires=new Set(),gesture=null,pending=null,focused=false,palette=false,layout,dom,afterClick=0;
  const attr=value=>esc(String(value));
  const button=(action,text,extra='')=>'<button type="button" data-patch-action="'+action+'" '+extra+'>'+esc(text)+'</button>';
  function model(){
    const p=getProject(), foundTrack=getTrack();
    if(stageOwner&&!SW.findTrack(p,stageOwner))stageOwner=null;
    let graph=stageOwner?SW.graphModel(p):SW.channelGraphModel(p);
    if(stageOwner){
      const stageNodes=graph.nodes.filter(n=>n.owner===stageOwner);
      const ids=new Set(stageNodes.map(n=>n.id));
      graph={nodes:stageNodes,edges:graph.edges.filter(e=>ids.has(e.from)&&ids.has(e.to))};
    }
    const all=new Map(graph.nodes.map(n=>[n.id,n]));
    const active=focused?new Set([foundTrack.id,...graph.edges.filter(e=>all.get(e.from).owner===foundTrack.id||all.get(e.to).owner===foundTrack.id).flatMap(e=>[all.get(e.from).owner,all.get(e.to).owner])]):null;
    nodes=new Set([...nodes].filter(id=>all.has(id)));
    wires=new Set([...wires].filter(id=>graph.edges.some(e=>e.id===id)));
    return {graph,all,active};
  }
  function basePosition(n){
    return stageOwner?{x:32+n.column*204,y:46}:
      {x:32+n.column*310,y:28+n.row*256};
  }
  function positions(graph){
    const saved=getProject().flowPositions||{};
    return new Map(graph.nodes.map(n=>[n.id,saved[n.id]||basePosition(n)]));
  }
  function point(id,port,view=layout){
    const node=view.all.get(id), p=view.pos.get(id);
    if(!node||!p)return null;
    const socket=node.ports.find(s=>s.key===port);
    if(!socket)return null;
    const i=node.ports.filter(s=>s.side===socket.side).indexOf(socket);
    const viewCam=camera();
    return {x:p.x-viewCam.x+(socket.side==='out'?nodeWidth(node):0),y:p.y-viewCam.y+30+i*15,side:socket.side};
  }
  function curve(a,b){
    const distance=Math.abs(b.x-a.x), bent=b.x<a.x;
    const bow=Math.max(40,Math.min(225,distance*.54+Math.abs(b.y-a.y)*.13));
    const first=bent?Math.max(72,bow):bow;
    const dirA=a.side==='in'?-1:1,dirB=b.side==='out'?1:-1;
    return 'M'+a.x+','+a.y+' C'+(a.x+dirA*first)+','+a.y+' '+(b.x+dirB*first)+','+b.y+' '+b.x+','+b.y;
  }
  function wireSVG(){
    const markers='<defs>'+Object.entries(colors).map(([kind,fill])=>
      '<marker id="arrow-'+kind+'" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" fill="'+fill+'"/></marker>').join('')+'</defs>';
    return markers+layout.graph.edges.map(edge=>{
      const a=point(edge.from,edge.fromPort),b=point(edge.to,edge.toPort);
      if(!a||!b)return '';
      const path=curve(a,b), selected=wires.has(edge.id);
      const dim=layout.active&&(!layout.active.has(layout.all.get(edge.from).owner)||!layout.active.has(layout.all.get(edge.to).owner));
      const dashed=['cue','pre','midi'].includes(edge.kind)?'stroke-dasharray="5 4"':'';
      const show=edge.disabled||dim?'.26':'1';
      const title=layout.all.get(edge.from).label+' → '+layout.all.get(edge.to).label+(edge.label?' · '+edge.label:'');
      return '<g data-patch-wire="'+attr(edge.id)+'" class="patch-cable '+(selected?'wire-selected':'')+'" opacity="'+show+'">'+
        '<path class="patch-hit" d="'+path+'"><title>'+esc(title)+'</title></path>'+
        '<path data-flow-owner="'+attr(edge.owner||'')+'" class="patch-line '+(edge.disabled?'stopped':'')+'" d="'+path+'" stroke="'+colors[edge.kind]+'" marker-end="url(#arrow-'+edge.kind+')" '+dashed+'/></g>';
    }).join('');
  }
  function nodeHTML(n){
    const pos=layout.pos.get(n.id);
    const selected=nodes.has(n.id), viewCam=camera();
    const ports=n.ports.map(port=>{
      const list=n.ports.filter(s=>s.side===port.side);
      return '<button type="button" class="patch-port '+port.side+'" data-patch-port="'+port.key+'" data-port-type="'+port.type+'" style="top:'+
        (30+list.indexOf(port)*15)+'px" aria-label="'+attr(n.label+' '+port.label)+'" title="'+attr(port.label)+'"></button>';
    }).join('');
    const channel=n.kind==='channel'||n.kind==='channel-cue';
    const isExpanded=expanded.has(n.id);
    const detail=channel?button('node-expand',isExpanded?'▾':'▸','aria-label="'+(isExpanded?'Collapse':'Expand')+' '+attr(n.label)+'" aria-expanded="'+isExpanded+'"'):'';
    const track=n.kind==='channel'?SW.findTrack(getProject(),n.owner):null;
    const inside=track?api.trackControls(track,isExpanded):n.kind==='channel-cue'?api.cueControls(n.owner,isExpanded):'<small>'+esc(n.sub||'')+'</small>';
    return '<div class="patch-node '+n.kind+' '+(selected?'chosen':'')+' '+(layout.active&&!layout.active.has(n.owner)?'muted-node':'')+'" data-patch-node="'+attr(n.id)+'"'+
      (track?' data-track="'+attr(track.id)+'"':'')+' tabindex="0" aria-label="'+attr(n.label)+'" style="left:'+(pos.x-viewCam.x)+'px;top:'+(pos.y-viewCam.y)+'px">'+
      '<header data-patch-grip>'+detail+'<strong>'+esc(n.label)+'</strong>'+
      (track?button('stage-view','↳','aria-label="Edit internal patch for '+attr(n.label)+'" title="Edit internal patch"'):'')+
      '</header>'+inside+ports+'</div>';
  }
  const selectedWire=()=>layout?.graph.edges.find(e=>wires.size===1&&wires.has(e.id));
  function wireControls(){
    const edge=selectedWire();
    if(!edge)return wires.size||nodes.size?'<div class="patch-actions"><span>'+wires.size+' wire(s) · '+nodes.size+' node(s)</span>'+button('remove','Delete selection')+'</div>':'';
    const detail=SW.getRoute(getProject(),edge);
    const level=detail?
      '<label>Level <input type="number" min="-60" max="6" step=".1" data-patch-level value="'+detail.level+'"> dB</label>'+
      button('wire-mute',detail.mute?'Unmute':'Mute')+
      '<label>Tap <select data-patch-tap><option value="pre" '+(detail.pre?'selected':'')+'>Pre-fader</option><option value="post" '+(!detail.pre?'selected':'')+'>Post-fader</option></select></label>':'';
    return '<div class="patch-actions"><strong>'+esc(layout.all.get(edge.from).label)+' → '+esc(layout.all.get(edge.to).label)+'</strong>'+level+
      button('rewire','Reconnect')+button('remove','Disconnect')+'</div>';
  }
  function render(){
    const current=model();
    layout={...current,pos:positions(current.graph)};
    const tracks=[...getProject().tracks,getProject().master];
    const options=tracks.map(t=>'<option value="'+attr(t.id)+'" '+(getTrack().id===t.id?'selected':'')+'>'+esc(t.name)+'</option>').join('');
    const toolbar='<div class="editor-toolbar route-tools"><strong>Signal flow</strong>'+button('palette',palette?'Hide nodes':'+ Node',palette?'aria-pressed="true"':'')+
      button('zoom-out','−')+button('zoom-in','+')+button('fit','Fit')+button('focus','Channel focus','aria-pressed="'+focused+'"')+
      (stageOwner?button('track-view','← Channels')+button('reset','Reset channel patch'):button('fit-origin','Home'))+button('layout','Reset positions')+
      '<label>Monitor format <select data-change="monitor-spatial"><option value="stereo">Stereo</option><option value="binaural" '+(getProject().spatialMonitor==='binaural'?'selected':'')+'>Binaural</option></select></label></div>';
    const paletteHTML=palette?'<div class="patch-palette"><label>Target <select data-patch-target>'+options+'</select></label>'+
      button('audio','Audio track')+button('instrument','Instrument track')+button('bus','Bus')+button('cue','Cue output')+
      '<label>Device <select data-patch-device><optgroup label="Effects">'+Object.keys(SW.fx).map(name=>'<option value="'+attr('effects:'+name)+'">'+esc(name)+'</option>').join('')+
      '</optgroup><optgroup label="Instruments">'+Object.keys(SW.instruments).map(name=>'<option value="'+attr('instruments:'+name)+'">'+esc(name)+'</option>').join('')+
      '</optgroup></select></label>'+button('insert','Add & connect')+button('park','Add unconnected')+
      '<button type="button" class="patch-grab-device" draggable="true" title="Drag the selected device onto a node or a wire">Drag device</button></div>':'';
    return toolbar+paletteHTML+api.cueDetail()+'<div id="patch-actions">'+wireControls()+'</div>'+
      '<div class="patch-viewport" tabindex="0" aria-label="Signal flow canvas" data-patch-view><div class="patch-bounds"><div class="patch-world">'+
      '<svg class="patch-wires" aria-label="Audio and MIDI wires">'+wireSVG()+'</svg><svg class="patch-ghost" aria-hidden="true"></svg>'+
      layout.graph.nodes.map(nodeHTML).join('')+'</div></div></div>';
  }
  function mount(){
    const view=dock.querySelector('[data-patch-view]');
    if(!view)return;
    dom={view,world:view.querySelector('.patch-world'),bound:view.querySelector('.patch-bounds'),svg:view.querySelector('.patch-wires'),ghost:view.querySelector('.patch-ghost')};
    if(!dom.world)return;
    resize();
    drawPending();
  }
  function resize(){
    if(!dom?.world||!layout)return;
    const viewCam=camera();
    dom.world.style.transform='scale('+viewCam.scale+')';
    const grid=Math.max(7,21*viewCam.scale);
    dom.view.style.backgroundSize=grid+'px '+grid+'px';
    dom.view.style.backgroundPosition=(-viewCam.x*viewCam.scale%grid)+'px '+(-viewCam.y*viewCam.scale%grid)+'px';
    for(const el of dom.view.querySelectorAll('[data-patch-node]')){
      const pos=layout.pos.get(el.dataset.patchNode);
      if(!pos)continue;
      el.style.left=(pos.x-viewCam.x)+'px';el.style.top=(pos.y-viewCam.y)+'px';
    }
    dom.svg.innerHTML=wireSVG();drawPending();
  }
  function updateSelection(){
    if(!dom?.view?.isConnected)return;
    for(const el of dom.view.querySelectorAll('[data-patch-node]'))el.classList.toggle('chosen',nodes.has(el.dataset.patchNode));
    for(const el of dom.view.querySelectorAll('[data-patch-wire]'))el.classList.toggle('wire-selected',wires.has(el.dataset.patchWire));
    const tools=dock.querySelector('#patch-actions');
    if(tools)tools.innerHTML=wireControls();
  }
  function canvasPoint(event){
    const rect=dom.world.getBoundingClientRect();
    const viewCam=camera();
    return {x:(event.clientX-rect.left)/viewCam.scale,y:(event.clientY-rect.top)/viewCam.scale};
  }
  function endpoint(el){
    if(!el)return null;
    return {node:el.closest('[data-patch-node]').dataset.patchNode,port:el.dataset.patchPort,
      side:el.classList.contains('in')?'in':'out'};
  }
  const sourceOf=e=>({node:e.from,port:e.fromPort,side:'out'});
  const destinationOf=e=>({node:e.to,port:e.toPort,side:'in'});
  function assemble(a,b){
    if(!a||!b||a.side===b.side)throw Error('Connect an output socket to an input socket.');
    return a.side==='out'?[a,b]:[b,a];
  }
  function setZoom(value,event){
    if(!dom?.view)return;
    const cam=camera(), old=cam.scale, rect=dom.view.getBoundingClientRect();
    const x=event?event.clientX-rect.left:dom.view.clientWidth/2;
    const y=event?event.clientY-rect.top:dom.view.clientHeight/2;
    cam.scale=SW.clamp(value,.025,3);
    cam.x+=x/old-x/cam.scale;cam.y+=y/old-y/cam.scale;
    resize();
  }
  function fit(){
    if(!dom?.view?.clientWidth||!dom.view.clientHeight||!layout.pos.size)return;
    const bounds={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};
    for(const [id,pos] of layout.pos){
      const el=dom.view.querySelector('[data-patch-node="'+id+'"]');
      bounds.left=Math.min(bounds.left,pos.x);bounds.top=Math.min(bounds.top,pos.y);
      bounds.right=Math.max(bounds.right,pos.x+nodeWidth(layout.all.get(id)));
      bounds.bottom=Math.max(bounds.bottom,pos.y+(el?.offsetHeight||height));
    }
    const cam=camera(), w=dom.view.clientWidth,h=dom.view.clientHeight,pad=26;
    const contentWidth=bounds.right-bounds.left,contentHeight=bounds.bottom-bounds.top;
    cam.scale=SW.clamp(Math.min(Math.max(1,w-2*pad)/contentWidth,Math.max(1,h-2*pad)/contentHeight),.025,1.6);
    cam.x=(bounds.left+bounds.right)/2-w/(2*cam.scale);
    cam.y=(bounds.top+bounds.bottom)/2-h/(2*cam.scale);
    resize();
  }
  function drawPending(event){
    if(!dom?.ghost)return;
    const link=gesture?.kind==='wire'&&gesture.moved?gesture:pending;
    if(!link){dom.ghost.innerHTML='';return;}
    const a=point(link.fixed.node,link.fixed.port);
    const target=link.target&&point(link.target.node,link.target.port);
    const b=target||(event?canvasPoint(event):link.pointer?canvasPoint(link.pointer):a);
    if(a&&b)dom.ghost.innerHTML='<path class="patch-preview" d="'+curve(a,{...b,side:link.fixed.side==='out'?'in':'out'})+'" stroke="'+(link.bad?'#ff9b92':'#aeffe5')+'"/>';
  }
  function actual(port){
    const n=layout.all.get(port.node);
    return n?.ports.find(p=>p.key===port.port)?.actual||port;
  }
  function changeConnection(fixed,other,old){
    try{
      const [source,target]=assemble(fixed,other);
      const p=SW.patchConnect(getProject(),actual(source),actual(target),old);
      if(old)wires.delete(old.id);
      pending=null;
      replace(p,old?'Reconnected wire':'Connected wire');
      return true;
    }catch(error){status(error.message,true);return false;}
  }
  function removeSelected(includeInstrument=true){
    const live=model();
    const selected=live.graph.edges.filter(edge=>wires.has(edge.id));
    const effects=live.graph.nodes.filter(n=>nodes.has(n.id)&&(n.kind==='effect'||includeInstrument&&n.kind==='instrument'));
    if(!selected.length&&!effects.length){status(includeInstrument?'Select a wire, effect, or instrument to remove.':'Select a wire or effect to delete.',true);return;}
    const order=[...selected].sort((a,b)=>(b.index??-1)-(a.index??-1));
    edit(()=>{
      const p=getProject();
      for(const edge of order)SW.detachWire(p,edge);
      for(const n of effects){
        const t=SW.findTrack(p,n.owner);
        if(n.kind==='instrument')SW.removeInstrument(t);
        else SW.removeEffect(t,n.stage.slice(3));
        if(p.flowPositions)delete p.flowPositions[n.id];
      }
      nodes.clear();wires.clear();pending=null;
    },'Removed '+(selected.length+effects.length)+' graph item(s)');
  }
  function select(keys,id,add){
    if(!add){nodes.clear();wires.clear();keys.add(id);}
    else if(keys.has(id))keys.delete(id);
    else keys.add(id);
    updateSelection();
  }
  function updateRoute(edge,operation,value){
    if(!edge?.routeKind)return;
    if(operation==='tap'){
      const source={node:edge.owner+':'+(value==='pre'?'pre':'post'),port:'send',side:'out'};
      changeConnection(source,destinationOf(edge),edge);return;
    }
    edit(()=>{
      const p=getProject(),t=SW.findTrack(p,edge.owner);
      let route=SW.getRoute(p,edge);
      if(!route)return;
      if(edge.index<0&&edge.routeKind==='send'){
        if(operation==='level'){t.sendLevel=value;return;}
        t.send='';t.sends??=[];t.sends.push(route);
      }
      if(operation==='level')route.level=value;
      else route.mute=!route.mute;
    },'Updated send');
  }
  function nodeAction(n){
    if(!n)return;
    const t=SW.findTrack(getProject(),n.owner);
    if(t){
      selectTrack(t.id,false);api.inspect();
      if(n.kind==='effect')api.openDevice(t,n.stage.slice(3));
      else if(n.kind==='instrument')api.openDevice(t);
      else if(n.kind==='channel'){if(expanded.has(n.id))expanded.delete(n.id);else expanded.add(n.id);refresh();}
      else if(n.kind==='pan'&&t.id!=='master')api.openSpatial(t);
      else status(n.label+' selected');
    }else if(n.kind==='cue'||n.kind==='cueout'||n.kind==='channel-cue')api.openCue(n.owner);
  }
  function paletteChoice(){
    const value=dock.querySelector('[data-patch-device]')?.value;
    const id=dock.querySelector('[data-patch-target]')?.value;
    const at=value?.indexOf(':')??-1;
    return at<0?null:{kind:value.slice(0,at),name:value.slice(at+1),target:id};
  }
  function addDevice(item,parked=false,edge=null,target=null){
    const t=SW.findTrack(getProject(),target||edge?.owner||item.target);
    if(target&&!t){status('Drop the device on an audio, instrument, bus, or master channel.',true);return;}
    if(edge&&(!edge.serial||item.kind!=='effects')){
      status('Drop an audio effect onto an internal audio wire, or drop the device on a channel node.',true);return;
    }
    api.device(item.kind,item.name,t||getTrack(),false,{parked,wire:edge?.serial});
  }
  function action(event){
    const el=event.target.closest('[data-patch-action]');
    if(!el)return;
    if(busy())return;
    const what=el.dataset.patchAction;
    if(what==='palette'){palette=!palette;refresh();}
    if(what==='zoom-in')setZoom(camera().scale*1.2);
    if(what==='zoom-out')setZoom(camera().scale/1.2);
    if(what==='fit')fit();
    if(what==='focus'){focused=!focused;refresh();}
    if(what==='fit-origin'){Object.assign(camera(),{x:0,y:0,scale:1});resize();}
    if(what==='layout')edit(()=>{
      const positions=getProject().flowPositions;
      if(positions)for(const id of layout.all.keys())delete positions[id];
      Object.assign(camera(),{x:0,y:0,scale:1});
    },'Reset graph positions',false);
    if(what==='node-expand'||what==='stage-view'||what==='track-view'){
      const id=el.closest('[data-patch-node]')?.dataset.patchNode;
      if(what==='node-expand'){
        if(expanded.has(id))expanded.delete(id);else expanded.add(id);
      }else{
        stageOwner=what==='track-view'?null:layout.all.get(id)?.owner;
        if(stageOwner){selectTrack(stageOwner,false);api.inspect();}
        nodes.clear();wires.clear();pending=null;
      }
      refresh();
      if(what==='stage-view')fit();
    }
    if(what==='reset'){const t=SW.findTrack(getProject(),stageOwner)||getTrack();if(t.patch!==undefined)edit(()=>delete t.patch,'Restored '+t.name+' serial wiring');}
    if(what==='remove')removeSelected();
    if(what==='audio'||what==='instrument'||what==='bus')api.addTrack(what==='instrument'?'midi':what);
    if(what==='cue')api.addCue();
    if(what==='cue-editor'){const n=layout.all.get(el.closest('[data-patch-node]')?.dataset.patchNode);if(n)api.openCue(n.owner);}
    if(what==='insert'||what==='park'){
      const item=paletteChoice();
      if(item)addDevice(item,what==='park');
    }
    if(what==='wire-mute')updateRoute(selectedWire(),'mute');
    if(what==='rewire'){
      const edge=selectedWire();
      if(edge){pending={fixed:sourceOf(edge),old:edge,target:destinationOf(edge)};drawPending();}
    }
  }
  function begin(event){
    const view=event.target.closest('[data-patch-view]');
    if(!view||busy()||event.button!==0&&event.button!==1)return;
    if(event.button===0&&event.target.closest('input, select, label, summary, button:not([data-patch-port])'))return;
    if(pending&&event.button===0){
      const other=endpoint(event.target.closest('[data-patch-port]'));
      const linked=other&&changeConnection(pending.fixed,other,pending.old);
      if(!linked&&!other){pending=null;drawPending();}
      event.preventDefault();return;
    }
    const port=endpoint(event.target.closest('[data-patch-port]')), wire=event.target.closest('[data-patch-wire]'), node=event.target.closest('[data-patch-node]');
    const from={x:event.clientX,y:event.clientY,id:event.pointerId,add:event.ctrlKey||event.metaKey};
    if(event.button===1){
      gesture={kind:'pan',...from,left:camera().x,top:camera().y};
    }else if(port){
      const existing=layout.graph.edges.filter(e=>e.to===port.node&&e.toPort===port.port);
      const old=port.side==='in'&&existing.length===1?existing[0]:null;
      gesture={kind:'wire',...from,fixed:old?sourceOf(old):port,old};
    }else if(wire){
      const old=layout.graph.edges.find(e=>e.id===wire.dataset.patchWire);
      if(old)gesture={kind:'wire',...from,fixed:event.altKey?destinationOf(old):sourceOf(old),old,fromWire:true};
    }else if(node){
      const key=node.dataset.patchNode;
      const group=nodes.has(key)?[...nodes]:[key];
      gesture={kind:'node',...from,key,group,initial:new Map(group.map(id=>[id,{...layout.pos.get(id)}]))};
    }else {
      gesture={kind:'pan',...from,left:camera().x,top:camera().y,clear:true};
    }
    if(gesture){event.preventDefault();view.setPointerCapture?.(event.pointerId);view.focus({preventScroll:true});}
  }
  function move(event){
    if(pending&&dom?.view?.isConnected){pending.pointer=event;pending.target=endpoint(dock.ownerDocument.elementFromPoint(event.clientX,event.clientY)?.closest('[data-patch-port]'));drawPending(event);}
    const g=gesture;
    if(!g||g.id!==event.pointerId||!dom?.view?.isConnected)return;
    const dx=event.clientX-g.x,dy=event.clientY-g.y;
    if(!g.moved&&Math.hypot(dx,dy)<4)return;
    g.moved=true;
    const cam=camera();
    if(g.kind==='pan'){cam.x=g.left-dx/cam.scale;cam.y=g.top-dy/cam.scale;resize();}
    if(g.kind==='node'){
      for(const [id,initial] of g.initial){
        const pos={x:initial.x+dx/cam.scale,y:initial.y+dy/cam.scale};
        layout.pos.set(id,pos);
      }
      resize();
    }
    if(g.kind==='wire'){
      const el=dock.ownerDocument.elementFromPoint(event.clientX,event.clientY)?.closest('[data-patch-port]'),target=endpoint(el);
      dom.view.querySelector('.socket-hover')?.classList.remove('socket-hover');
      if(el)el.classList.add('socket-hover');
      g.target=target;g.pointer=event;g.bad=target&&target.side===g.fixed.side;
      drawPending(event);
    }
  }
  function finish(event){
    const g=gesture;
    if(!g||g.id!==event.pointerId)return;
    gesture=null;
    if(event.type==='pointercancel'){pending=null;refresh();return;}
    if(g.kind==='wire'){
      if(!g.moved){
        if(g.old){select(wires,g.old.id,g.add);return;}
        pending={fixed:g.fixed};drawPending();return;
      }
      const target=endpoint(dock.ownerDocument.elementFromPoint(event.clientX,event.clientY)?.closest('[data-patch-port]'));
      if(target){if(!changeConnection(g.fixed,target,g.old))refresh();}
      else if(g.old){
        edit(()=>SW.detachWire(getProject(),g.old),'Disconnected wire');wires.clear();updateSelection();
      }else refresh();
    }
    if(g.kind==='node'){
      if(g.moved){
        const moved=[...g.initial.keys()].map(id=>[id,layout.pos.get(id)]);
        edit(()=>{
          const p=getProject();
          p.flowPositions??={};
          for(const [id,pos] of moved)p.flowPositions[id]={x:Math.round(pos.x),y:Math.round(pos.y)};
        },'Moved graph node(s)',false);
      }else if(performance.now()-afterClick<330&&nodes.has(g.key)&&nodes.size===1&&!g.add){
        nodeAction(layout.all.get(g.key));afterClick=0;
      }else{
        select(nodes,g.key,g.add);afterClick=performance.now();
        const owner=layout.all.get(g.key).owner;
        if(SW.findTrack(getProject(),owner)){selectTrack(owner,false);api.inspect();}
      }
    }
    if(g.kind==='pan'&&!g.moved&&g.clear){nodes.clear();wires.clear();pending=null;updateSelection();drawPending();}
  }
  function drop(event){
    if(!event.dataTransfer.types.includes(dragType)||!event.target.closest('[data-patch-view]')||busy())return;
    event.preventDefault();
    try{
      const item=JSON.parse(event.dataTransfer.getData(dragType));
      const wire=event.target.closest('[data-patch-wire]');
      const edge=wire&&layout.graph.edges.find(e=>e.id===wire.dataset.patchWire);
      const target=event.target.closest('[data-patch-node]');
      addDevice(item,false,stageOwner?edge:null,target&&layout.all.get(target.dataset.patchNode).owner||edge?.owner);
    }catch(error){status(error.message,true);}
  }
  function bind(){
    dock.addEventListener('click',action);
    dock.addEventListener('pointerdown',begin);
    listenWindow('pointermove',move);
    listenWindow('pointerup',finish);
    listenWindow('pointercancel',finish);
    dock.addEventListener('wheel',event=>{
      if(!event.target.closest('[data-patch-view]')||event.target.closest('input,select,.patch-node-body'))return;
      event.preventDefault();
      const cam=camera(), lines=event.deltaMode===1?16:event.deltaMode===2?dom.view.clientHeight:1;
      if(event.ctrlKey||event.metaKey)setZoom(cam.scale*Math.exp(-event.deltaY*lines/550),event);
      else {
        cam.x+=(event.deltaX+(event.shiftKey?event.deltaY:0))*lines/cam.scale;
        cam.y+=(event.shiftKey?0:event.deltaY)*lines/cam.scale;
        resize();
      }
    },{passive:false});
    dock.addEventListener('change',event=>{
      if(event.target.hasAttribute('data-patch-level')&&event.target.value.trim()&&Number.isFinite(Number(event.target.value))){
        updateRoute(selectedWire(),'level',SW.clamp(Number(event.target.value),-60,6));
      }else if(event.target.hasAttribute('data-patch-tap'))updateRoute(selectedWire(),'tap',event.target.value);
    });
    dock.addEventListener('dragstart',event=>{
      if(event.target.closest('.patch-grab-device')){
        const item=paletteChoice();
        if(item){event.dataTransfer.setData(dragType,JSON.stringify(item));event.dataTransfer.effectAllowed='copy';}
      }
    });
    dock.addEventListener('dragover',event=>{
      if(event.target.closest('[data-patch-view]')&&event.dataTransfer.types.includes(dragType))event.preventDefault();
    });
    dock.addEventListener('drop',drop);
    dock.addEventListener('contextmenu',event=>{
      if(!event.target.closest('[data-patch-view]')||event.target.closest('input,button,select,.patch-node-body'))return;
      event.preventDefault();
      const wire=event.target.closest('[data-patch-wire]');
      if(wire)select(wires,wire.dataset.patchWire,event.ctrlKey);
      else {palette=true;refresh();}
    });
  }
  function key(event,deleteCommand=event.key==='Delete'||event.key==='Backspace'){
    if((event.key==='Enter'||event.key===' ')&&event.target.closest('[data-patch-port]')&&!busy()){
      const port=endpoint(event.target.closest('[data-patch-port]'));
      if(pending)changeConnection(pending.fixed,port,pending.old);
      else {pending={fixed:port};drawPending();}
      return true;
    }
    if(event.key==='Escape'){
      pending=null;nodes.clear();wires.clear();updateSelection();drawPending();return true;
    }
    if(deleteCommand&&(nodes.size||wires.size)){
      if(!busy())removeSelected(false);return true;
    }
    if(event.shiftKey&&(event.key==='A'||event.key==='a')){
      palette=true;refresh();return true;
    }
    return false;
  }
  return {render,mount,bind,key,resize,fit};
};
