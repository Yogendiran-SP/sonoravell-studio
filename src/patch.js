'use strict';
Object.assign(SW, (() => {
  const findTrack=(p,id)=>id==='master'?p.master:p.tracks.find(t=>t.id===id);
  const folders=p=>p.folders||[];
  const timelineTrack=t=>t.type==='audio'||t.type==='midi'&&!t.instrumentOnly;
  const timelineTracks=p=>p.tracks.filter(timelineTrack);
  const fxKey=id=>'fx:'+id;
  const baseStages=['in','trim','pre','fader','pan','post','out'];
  const stages=t=>[
    ...(t.type==='audio'?['source']:t.type==='midi'?['source',...(t.instrumentDisabled?[]:['instrument'])]:[]),
    ...baseStages.slice(0,2),...t.fx.map(e=>fxKey(e.id)),...baseStages.slice(2)
  ];
  function stagePorts(t,stage){
    return {
      in:stage==='source'?null:stage==='instrument'?'midi':'audio',
      out:stage==='out'?null:stage==='source'&&t.type==='midi'?'midi':'audio'
    };
  }
  function serialEdges(t){
    if(t.patch!==undefined)return t.patch;
    const keys=stages(t);
    return keys.slice(1).map((to,i)=>({from:keys[i],to}));
  }
  function validSerial(t,links){
    if(!Array.isArray(links))return false;
    const keys=new Set(stages(t)), incoming=new Set(), outgoing=new Map();
    if(links.length>=keys.size)return false;
    for(const edge of links){
      if(!edge||typeof edge!=='object')return false;
      const {from,to}=edge;
      if(!keys.has(from)||!keys.has(to)||from===to||incoming.has(to)||outgoing.has(from))return false;
      const source=stagePorts(t,from).out, dest=stagePorts(t,to).in;
      if(!source||source!==dest)return false;
      incoming.add(to);outgoing.set(from,to);
    }
    for(const key of outgoing.keys()){
      const visited=new Set();
      let cursor=key;
      while(outgoing.has(cursor)){
        if(visited.has(cursor))return false;
        visited.add(cursor);cursor=outgoing.get(cursor);
      }
    }
    return true;
  }
  function renumberFX(t,mapping){
    if(!t.patch)return;
    const mapped=k=>k.startsWith('fx:')?fxKey(mapping.get(k.slice(3))||k.slice(3)):k;
    t.patch=t.patch.map(({from,to})=>({from:mapped(from),to:mapped(to)}));
  }
  function addEffect(t,e,{wire,parked=false}={}){
    const previous=serialEdges(t);
    if(!wire&&!parked&&t.patch===undefined){t.fx.push(e);return e;}
    if(wire&&!previous.some(link=>link.from===wire.from&&link.to===wire.to))throw Error('This wire has changed.');
    const edge=wire||(!parked&&previous.find(link=>link.to==='pre'));
    const at=edge&&t.fx.findIndex(fx=>fxKey(fx.id)===edge.to);
    if(wire&&stagePorts(t,wire.from).out!=='audio')throw Error('An audio effect needs an audio wire.');
    if(Number.isInteger(at)&&at>=0)t.fx.splice(at,0,e);
    else t.fx.push(e);
    t.patch=edge?previous.flatMap(link=>link.from===edge.from&&link.to===edge.to?
      [{from:edge.from,to:fxKey(e.id)},{from:fxKey(e.id),to:edge.to}]:[link]):previous;
    return e;
  }
  function removeEffect(t,effectId){
    const key=fxKey(effectId), links=t.patch;
    if(links){
      const a=links.find(e=>e.to===key),b=links.find(e=>e.from===key);
      t.patch=links.filter(e=>e.to!==key&&e.from!==key);
      if(a&&b)t.patch.push({from:a.from,to:b.to});
    }
    t.fx=t.fx.filter(e=>e.id!==effectId);
    for(const automation of Object.keys(t.lanes))if(automation.startsWith(key+':'))delete t.lanes[automation];
  }
  function placeInstrument(t,name,parked=false){
    const disabled=t.instrumentDisabled;
    const previous=serialEdges(t);
    if(t.instrument!==name)delete t.synth;
    t.instrument=name;delete t.instrumentDisabled;
    if(parked){
      t.patch=previous.filter(e=>e.from!=='source'||e.to!=='instrument');
      if(disabled&&!t.patch.some(e=>e.to==='in'))t.patch.push({from:'instrument',to:'in'});
    }
    else if(disabled&&t.patch!==undefined){
      const links=[...previous,{from:'source',to:'instrument'}];
      if(!links.some(e=>e.to==='in'))links.push({from:'instrument',to:'in'});
      t.patch=links;
    }
  }
  function removeInstrument(t){
    if(t.type!=='midi')return;
    t.patch=serialEdges(t).filter(e=>e.from!=='instrument'&&e.to!=='instrument');
    t.instrumentDisabled=true;
  }
  function graphModel(p){
    const nodes=[],edges=[];
    const vertex=(owner,stage,kind,label,sub,ports,row,column)=>{
      const id=owner+':'+stage;
      nodes.push({id,owner,stage,kind,label,sub,ports,row,column});return id;
    };
    const link=(id,from,fromPort,to,toPort,kind,label='',disabled=false,data={})=>
      edges.push({id,from,fromPort,to,toPort,kind,label,disabled,...data});
    for(const [row,t] of [...p.tracks,p.master].entries()){
      const id=t.id, keys=stages(t), prefix=key=>id+':'+key;
      const meta={
        source:[t.type==='midi'?'MIDI events':'Audio events',t.sourceInput||'Timeline'],
        instrument:[t.instrument,'Instrument'],
        in:[t.name,t.type==='bus'?'Bus input':t.type==='master'?'Master input':'Channel input'],
        trim:['Input trim',(t.trim??0)+' dB'],
        pre:['Pre-fader','Send tap'],
        fader:['Fader',t.volume.toFixed(1)+' dB'],
        pan:[SW.position(t).mode==='stereo'?'Pan':'Spatial panner',t.pan===0?'Center':t.pan.toFixed(2)],
        post:['Post-fader','Send tap'],out:[t.type==='master'?'Main output':'Output',t.mute?'Muted':t.out||t.type==='master'?'':'Disconnected']
      };
      for(const [column,stage] of keys.entries()){
        const effect=stage.startsWith('fx:')?t.fx.find(e=>fxKey(e.id)===stage):null;
        const [label,sub]=effect?[effect.type,effect.bypass?'Bypassed':'Insert']:meta[stage];
        const type=stagePorts(t,stage), ports=[];
        if(type.in)ports.push({key:'in',side:'in',type:type.in,label:'Signal input'});
        if(type.out)ports.push({key:'out',side:'out',type:type.out,label:'Signal output'});
        if(stage==='in'&&['bus','master'].includes(t.type))ports.push({key:'sum',side:'in',type:'route',label:'Channel sum'});
        if(['pre','post'].includes(stage))ports.push({key:'send',side:'out',type:'send',label:stage==='pre'?'Pre-fader send':'Post-fader send'});
        if(stage==='fader')ports.push({key:'cue',side:'out',type:'cue',label:'Post-fader cue'});
        if(stage==='out')ports.push({key:t.type==='master'?'monitor':'route',side:'out',type:t.type==='master'?'monitor':'route',label:t.type==='master'?'Monitor feed':'Channel output'});
        vertex(id,stage,effect?'effect':stage==='in'?t.type:stage,label,sub,ports,row,column);
      }
      for(const {from,to} of serialEdges(t)){
        link('signal:'+id+':'+from+'>'+to,prefix(from),'out',prefix(to),'in',
          stagePorts(t,from).out==='midi'?'midi':'signal','',''===t.out&&to==='out',{owner:id,serial:{from,to}});
      }
      if(id==='master')continue;
      if(t.out)link('output:'+id,prefix('out'),'route',t.out+':in','sum','output','Direct output',t.mute,{owner:id});
      SW.sendList(t).forEach((route,i)=>{
        const index=route.legacy?-1:i-(t.send?1:0);
        link('send:'+id+':'+index,prefix(route.pre?'pre':'post'),'send',route.to+':in','sum',route.pre?'pre':'post',
          route.level+' dB',route.mute,{owner:id,routeKind:'send',index});
      });
      SW.cueSends(t).forEach((route,index)=>{
        link('cue:'+id+':'+index,prefix(route.pre?'pre':route.postTap?'post':'fader'),route.pre||route.postTap?'send':'cue',route.to+':cue','sum','cue',
          route.level+' dB',route.mute,{owner:id,routeKind:'cue',index});
      });
    }
    const far=Math.max(8,...nodes.map(n=>n.column))+1;
    for(const [i,cue] of SW.cueSettings(p).entries()){
      const row=p.tracks.length+1+i;
      vertex(cue.id,'cue','cue',cue.name,'Cue sum',[
        {key:'sum',side:'in',type:'route',label:'Cue sends'},{key:'out',side:'out',type:'cue-bus',label:'Cue sum output'}
      ],row,1);
      vertex(cue.id,'out','cueout','Cue output',cue.volume.toFixed(1)+' dB',[
        {key:'in',side:'in',type:'cue-bus',label:'Cue output input'},{key:'monitor',side:'out',type:'monitor',label:'Monitor feed'}
      ],row,3);
      if(!cue.disconnected)link('cuebus:'+cue.id,cue.id+':cue','out',cue.id+':out','in','cue','',cue.mute,{owner:cue.id,cueBus:true});
    }
    vertex('device','out','device','Monitor',p.monitorDisconnected?'Disconnected':p.monitorCue?'Cue selected':p.spatialMonitor==='binaural'?'Binaural headphones':'Stereo',[
      {key:'in',side:'in',type:'monitor',label:'Monitor input'}
    ],p.tracks.length,far);
    if(!p.monitorDisconnected)link('monitor',(p.monitorCue||'master')+':out','monitor','device:out','in','monitor','Monitor',false,{owner:p.monitorCue||'master'});
    const ids=new Set(nodes.map(n=>n.id));
    return {nodes,edges:edges.filter(e=>ids.has(e.from)&&ids.has(e.to))};
  }
  function channelGraphModel(p){
    const full=graphModel(p), projections=new Map();
    const nodes=[];
    const port=(node,key,side,type,label,actualNode,actualPort)=>{
      node.ports.push({key,side,type,label,actual:{node:actualNode,port:actualPort}});
      projections.set(actualNode+'|'+actualPort,{node:node.id,port:key});
    };
    const add=(owner,stage,kind,label,column,row)=>({id:owner+':'+stage,owner,stage,kind,label,column,row,ports:[]});
    let row=0;
    for(const t of [...p.tracks,p.master]){
      const id=t.id;
      const n=add(id,'track','channel',t.name,t.type==='master'?2:t.type==='bus'?1:0,t.type==='master'?0:row++);
      if(t.type==='bus'||t.type==='master') port(n,'sum','in','route','Channel sum',id+':in','sum');
      if(t.type==='master') port(n,'monitor','out','monitor','Monitor feed',id+':out','monitor');
      else {
        port(n,'route','out','route','Direct output',id+':out','route');
        port(n,'pre','out','send','Pre-fader send',id+':pre','send');
        port(n,'post','out','send','Post-pan send',id+':post','send');
        port(n,'cue','out','cue','Post-fader cue',id+':fader','cue');
      }
      nodes.push(n);
    }
    for(const [i,cue] of SW.cueSettings(p).entries()){
      const n=add(cue.id,'cue','channel-cue',cue.name,2,i+1);
      port(n,'sum','in','route','Cue sends',cue.id+':cue','sum');
      port(n,'monitor','out','monitor','Monitor feed',cue.id+':out','monitor');
      nodes.push(n);
    }
    const device=full.nodes.find(n=>n.kind==='device');
    nodes.push({...device,column:3,row:0});
    projections.set('device:out|in',{node:'device:out',port:'in'});
    const edges=full.edges.flatMap(edge=>{
      const a=projections.get(edge.from+'|'+edge.fromPort),b=projections.get(edge.to+'|'+edge.toPort);
      return a&&b?[{...edge,from:a.node,fromPort:a.port,to:b.node,toPort:b.port}]:[];
    });
    return {nodes,edges};
  }
  function splitNode(id){
    const at=id.indexOf(':');
    return [id.slice(0,at),id.slice(at+1)];
  }
  function getRoute(p,wire){
    const t=findTrack(p,wire.owner);
    if(wire.routeKind==='cue')return t?.cueSends?.[wire.index];
    if(wire.routeKind==='send'){
      if(wire.index===-1)return t?.send?{to:t.send,level:t.sendLevel,pre:false,mute:false}:undefined;
      return t?.sends?.[wire.index];
    }
    return undefined;
  }
  function detachWire(p,wire){
    if(wire.id==='monitor'){p.monitorDisconnected=true;return;}
    if(wire.cueBus){
      const c=SW.cueSettings(p).find(c=>c.id===wire.owner);
      if(c)c.disconnected=true;
      return;
    }
    const t=findTrack(p,wire.owner);
    if(!t)return;
    if(wire.serial){
      t.patch=serialEdges(t).filter(e=>e.from!==wire.serial.from||e.to!==wire.serial.to);
    }else if(wire.routeKind==='cue')t.cueSends.splice(wire.index,1);
    else if(wire.routeKind==='send'){
      if(wire.index===-1)t.send='';
      else t.sends.splice(wire.index,1);
    }else if(wire.kind==='output')t.out='';
  }
  function patchConnect(p,source,dest,replaced=null){
    const copy=SW.clone(p);
    const [owner,from]=splitNode(source.node),[target,to]=splitNode(dest.node);
    const sourceTrack=findTrack(copy,owner),destinationTrack=findTrack(copy,target);
    const cue=SW.cueSettings(copy).find(c=>c.id===target),fromCue=SW.cueSettings(copy).find(c=>c.id===owner);
    const preserved=replaced&&getRoute(copy,replaced);
    if(source.node===dest.node)throw Error('Choose a different node.');
    if(replaced)detachWire(copy,replaced);
    if(source.port==='out'&&dest.port==='in'&&sourceTrack&&owner===target){
      const valid=stages(sourceTrack);
      if(!valid.includes(from)||!valid.includes(to))throw Error('This channel stage is unavailable.');
      const links=serialEdges(sourceTrack);
      const next=[...links.filter(e=>e.from!==from&&e.to!==to),{from,to}];
      if(!validSerial(sourceTrack,next))throw Error('These sockets have different signal types or would create a loop.');
      sourceTrack.patch=next;
      return copy;
    }
    if(source.port==='monitor'&&dest.node==='device:out'&&dest.port==='in'&&from==='out'&&(owner==='master'||fromCue)){
      copy.monitorCue=owner==='master'?'':owner;copy.monitorDisconnected=false;
      return copy;
    }
    if(source.port==='out'&&dest.port==='in'&&cue&&cue===fromCue&&from==='cue'&&to==='out'){
      cue.disconnected=false;return copy;
    }
    if(!sourceTrack||owner==='master'||dest.port!=='sum')throw Error('These sockets cannot be connected.');
    if(source.port==='route'&&from==='out'&&to==='in'&&destinationTrack&&['master','bus'].includes(destinationTrack.type)){
      if(!SW.validRoute(copy,owner,target,'out'))throw Error('This connection would create feedback.');
      sourceTrack.out=target;return copy;
    }
    const pre=from==='pre'&&source.port==='send';
    const post=(from==='post'&&source.port==='send')||(from==='fader'&&source.port==='cue');
    if(!pre&&!post)throw Error('Connect a send tap to a bus or cue input.');
    if(cue&&to==='cue'){
      sourceTrack.cueSends??=[];
      if(sourceTrack.cueSends.some(s=>s.to===target&&s.pre===pre))throw Error('This cue already has that send.');
      if(sourceTrack.cueSends.length>=16)throw Error('This channel already has 16 cue sends.');
      sourceTrack.cueSends.push({level:-12,pan:0,followPan:false,mute:false,...preserved,to:target,pre,postTap:from==='post'});
      return copy;
    }
    if(source.port!=='send'||to!=='in'||destinationTrack?.type!=='bus')throw Error('Choose a compatible bus or cue destination.');
    if(!SW.validRoute(copy,owner,target,'send'))throw Error('This connection would create feedback.');
    if(SW.sendList(sourceTrack).some(s=>s.to===target&&s.pre===pre))throw Error('This bus already has that send.');
    sourceTrack.sends??=[];
    sourceTrack.sends.push({level:-18,mute:false,...preserved,to:target,pre});
    return copy;
  }
  function setFolder(p,t,folderId){
    if(!timelineTrack(t))return;
    const previous=folders(p).find(f=>f.id===t.folder);
    if(folderId===previous?.id)return;
    if(previous?.bus&&t.out===previous.bus){
      const route=t.folderOut??'master';
      t.out=SW.validRoute(p,t.id,route,'out')?route:'master';
    }
    delete t.folderOut;
    const folder=folders(p).find(f=>f.id===folderId);
    if(folder){
      t.folder=folder.id;
      if(folder.bus&&SW.validRoute(p,t.id,folder.bus,'out')){
        t.folderOut=t.out;t.out=folder.bus;
      }
    }else delete t.folder;
  }
  function folderBus(p,folder){
    if(folder.bus)return findTrack(p,folder.bus);
    const members=timelineTracks(p).filter(t=>t.folder===folder.id);
    const outputs=new Set(members.map(t=>t.out));
    const bus=SW.channel(folder.name,'bus',p.tracks.length);
    if(outputs.size===1)bus.out=outputs.values().next().value;
    p.tracks.push(bus);folder.bus=bus.id;
    for(const t of members){t.folderOut=t.out;t.out=bus.id;}
    return bus;
  }
  function removeChannel(p,id){
    const folder=folders(p).find(f=>f.bus===id);
    if(folder)delete folder.bus;
    p.tracks=p.tracks.filter(t=>t.id!==id);
    for(const key of Object.keys(p.flowPositions||{}))if(key.startsWith(id+':'))delete p.flowPositions[key];
    for(const t of p.tracks){
      if(t.out===id){
        const restore=folder&&t.folder===folder.id?(t.folderOut??'master'):'master';
        t.out=SW.validRoute(p,t.id,restore,'out')?restore:'master';
      }
      if(t.folderOut===id||folder&&t.folder===folder.id)delete t.folderOut;
      if(t.send===id)t.send='';
      if(t.sends)t.sends=t.sends.filter(s=>s.to!==id);
    }
  }
  return {findTrack,folders,timelineTrack,timelineTracks,stages,stagePorts,serialEdges,validSerial,renumberFX,addEffect,removeEffect,placeInstrument,removeInstrument,
    graphModel,channelGraphModel,getRoute,detachWire,patchConnect,setFolder,folderBus,removeChannel};
})());
