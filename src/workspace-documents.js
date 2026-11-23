'use strict';
Object.assign(SW, (() => {
  const {clamp,uid}=SW;
  const workspaceNames={start:'Start',session:'Session',mastering:'Mastering',show:'Show'};
  const workspaceSuffix={session:'.sonoravell',mastering:'.sonoravell-master',show:'.sonoravell-show'};
  const modes={continue:'Continue',stop:'Stop at End',loop:'Loop',repeat:'Loop and Continue',skip:'Skip'};
  const templates={
    blank:['session','Record and Mix','An empty timeline for audio and MIDI.'],
    band:['session','Full Band','A recording layout with vocals, guitar, bass, keys and a drum bus.'],
    guitar:['session','Guitar','An audio track with Guitar Pedalboard and a separate backing track.'],
    beats:['session','Produce Beats','Drum Machine, Bass, Keys and Lead instrument tracks.'],
    content:['session','Create Content','Music and voiceover tracks for editing against picture.'],
    mastering:['mastering','Master and Release','Sequence mixdowns and prepare a Digital Release.'],
    show:['show','Rehearse and Perform','Prepare a Setlist and backing, virtual and real instrument Players.']
  };
  const playerTypes={backing:'Backing Track',virtual:'Virtual Instrument',real:'Real Instrument'};
  const masteringChains={none:'None',clean:'Clean EQ',warm:'Warm Glue',limit:'Peak Limiter'};
  const entryLimit=128;
  function createSessionTemplate(template,name,bpm,meter,artist=''){
    const p=SW.project();
    Object.assign(p,{name,bpm,meter,artist,loopEnd:meter*4});
    const track=(name,type='audio',instrument='Keys',inserts=[])=>{
      const t=SW.channel(name,type,p.tracks.length);
      t.instrument=instrument;
      for(const fx of inserts)SW.addEffect(t,SW.effect(fx));
      p.tracks.push(t);
      return t;
    };
    switch(template){
      case 'band': {
        track('Lead Vocals','audio','Keys',['Low Cut','Compressor']);
        track('Guitar 1','audio','Keys',['Guitar Pedalboard']);
        track('Guitar 2');track('Bass');track('Keys','midi');
        const drums=track('Drum Bus','bus');
        p.folders=[{id:uid(),name:'Drums',bus:drums.id}];
        for(const name of ['Kick','Snare','Overheads']){
          const t=track(name);t.folder=p.folders[0].id;t.out=drums.id;t.folderOut='master';
        }
        break;
      }
      case 'guitar':
        track('Guitar','audio','Keys',['Guitar Pedalboard']);track('Backing Track');
        break;
      case 'beats':
        track('Drum Machine','midi','Drums');track('Bass','midi','Bass');track('Keys','midi');track('Lead','midi','Lead');
        break;
      case 'content':
        track('Music / FX');track('Voiceover 1','audio','Keys',['Low Cut','Compressor']);
        track('Voiceover 2','audio','Keys',['Low Cut','Compressor']);
        break;
    }
    return p;
  }
  function createWorkspaceDocument(kind,name,artist=''){
    const common={version:1,kind,id:uid(),name,artist};
    if(kind==='mastering')return {...common,album:name,items:[],volume:0,chain:'none',rate:48000,bits:24};
    if(kind==='show')return {...common,venue:'',items:[],players:[showPlayer('backing','Backing Tracks')]};
    throw Error('Choose a Mastering Project or Show.');
  }
  function masteringTrack(asset,name,duration,source=''){
    return {id:uid(),asset,name,artist:'',comment:'',source,duration,start:0,end:duration,fadeIn:0,fadeOut:0,gap:0,gain:0,chain:'none'};
  }
  function showPlayer(type,name){
    return {id:uid(),type,name,gain:0,mute:false,instrument:'Keys',patches:[]};
  }
  function showItem(name,asset,player,length=60){
    return {id:uid(),name,mode:'continue',tempo:120,meter:4,length,pause:0,slots:asset?{[player]:{asset,duration:length}}:{},
      patches:{},sections:[],lyrics:''};
  }
  function showSection(name,start,end){return {id:uid(),name,start,end,mode:'continue',loops:2};}
  function moveWorkspaceRow(rows,id,step){
    const index=rows.findIndex(row=>row.id===id),next=index+step;
    if(index<0||next<0||next>=rows.length)return false;
    const [row]=rows.splice(index,1);
    rows.splice(next,0,row);
    return true;
  }
  function normalizeMasterTrack(item,minDuration=.01){
    const minimum=Math.min(item.duration,minDuration);
    item.start=clamp(item.start,0,item.duration-minimum);
    item.end=clamp(item.end,item.start+minimum,item.duration);
    const length=item.end-item.start;
    item.fadeIn=clamp(item.fadeIn,0,length);
    item.fadeOut=clamp(item.fadeOut,0,length-item.fadeIn);
    return item;
  }
  function masteringLayout(items){
    let cursor=0;
    return items.map(item=>{
      const start=cursor+item.gap,end=start+item.end-item.start;
      cursor=end;
      return {item,start,end};
    });
  }
  function applyMasteringChain(t,key){
    if(key==='clean'){
      const low=SW.effect('Low Cut');low.params.frequency=34;SW.addEffect(t,low);
      const eq=SW.effect('Parametric EQ');Object.assign(eq.params,{frequency:260,gain:-1.5,q:1});SW.addEffect(t,eq);
    }else if(key==='warm'){
      const comp=SW.effect('Compressor');Object.assign(comp.params,{threshold:-18,ratio:2,attack:.025,release:.2});SW.addEffect(t,comp);
      const high=SW.effect('High Shelf');Object.assign(high.params,{frequency:6500,gain:-1.2});SW.addEffect(t,high);
    }else if(key==='limit'){
      const limit=SW.effect('Limiter');limit.params.threshold=-1;SW.addEffect(t,limit);
    }
  }
  function programAudio(t,asset,name,duration,{position=0,offset=0,length=duration,gain=0,fadeIn=0,fadeOut=0}={}){
    const c=SW.clip('audio',position,length,name);
    Object.assign(c,{asset,sourceBpm:60,offset,gain,fadeIn,fadeOut,fadeInShape:'power',fadeOutShape:'power'});
    t.clips.push(c);
  }
  function masteringProgram(doc,only){
    const composition=SW.project();
    Object.assign(composition,{name:doc.name,bpm:60});
    composition.master.volume=doc.volume;
    applyMasteringChain(composition.master,doc.chain);
    const layout=masteringLayout(only?doc.items.filter(item=>item.id===only).map(item=>({...item,gap:0})):doc.items);
    for(const [index,{item,start,end}] of layout.entries()){
      const t=SW.channel(item.name,'audio',index);
      t.volume=0;
      applyMasteringChain(t,item.chain);
      programAudio(t,item.asset,item.name,item.duration,{position:start,offset:item.start,length:end-start,
        gain:item.gain,fadeIn:item.fadeIn,fadeOut:item.fadeOut});
      composition.assets[item.asset]={name:item.name,duration:item.duration};
      composition.tracks.push(t);
    }
    return {composition,length:layout.at(-1)?.end||0};
  }
  function playerPatch(player,item){
    const patch=player.patches.find(patch=>patch.id===item?.patches[player.id]);
    return patch||player;
  }
  function showProgram(doc,item){
    const composition=SW.project();
    Object.assign(composition,{name:item.name,bpm:60});
    composition.master.volume=0;
    for(const [index,player] of doc.players.entries()){
      const patch=playerPatch(player,item);
      const t=SW.channel(player.name,player.type==='virtual'?'midi':'audio',index);
      Object.assign(t,{id:player.id,volume:patch.gain,mute:patch.mute,instrument:patch.instrument||player.instrument});
      const source=item.slots[player.id];
      if(player.type==='backing'&&source){
        programAudio(t,source.asset,item.name,source.duration,{length:Math.min(source.duration,item.length)});
        composition.assets[source.asset]={name:item.name,duration:source.duration};
      }
      composition.tracks.push(t);
    }
    return {composition,length:item.length};
  }
  function workspaceAssets(doc){
    const list=doc.kind==='mastering'?doc.items:doc.items.flatMap(item=>Object.values(item.slots));
    return new Map(list.map(item=>[item.asset,item.duration]));
  }
  const workspaceVideos=doc=>new Map(doc.kind==='show'?doc.items.filter(item=>item.video).map(item=>[item.video.asset,item.video.mime]):[]);
  function validateWorkspaceDocument(doc){
    function check(condition,label){if(!condition)throw Error('Invalid workspace document: '+label+'.');}
    const range=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
    const str=(s,max=120)=>typeof s==='string'&&s.length<=max;
    const id=s=>typeof s==='string'&&/^[\w-]{1,100}$/.test(s)&&!Object.hasOwn(Object.prototype,s)&&s!=='prototype';
    const unique=(array)=>Array.isArray(array)&&array.length<=entryLimit&&array.every(row=>id(row?.id))&&new Set(array.map(row=>row.id)).size===array.length;
    const order=['continue','stop','loop'];
    check(doc?.version===1&&['mastering','show'].includes(doc.kind)&&id(doc.id)&&str(doc.name)&&doc.name.trim()&&str(doc.artist),'header');
    check(unique(doc.items),'items');
    if(doc.kind==='mastering'){
      check(str(doc.album)&&range(doc.volume,-60,6)&&Object.hasOwn(masteringChains,doc.chain)&&[44100,48000,96000].includes(doc.rate)&&[16,24,32].includes(doc.bits),'master settings');
      for(const item of doc.items){
        check(id(item.asset)&&str(item.name)&&item.name.trim()&&str(item.artist)&&str(item.comment,250)&&str(item.source,200),'track metadata');
        check(range(item.duration,.000001,86400)&&range(item.start,0,item.duration)&&range(item.end,item.start,item.duration)&&item.end>item.start,'trim range');
        check(range(item.fadeIn,0,item.end-item.start)&&range(item.fadeOut,0,item.end-item.start-item.fadeIn+1e-8)&&range(item.gap,0,60)&&
          range(item.gain,-60,12)&&Object.hasOwn(masteringChains,item.chain),'track processing');
      }
    }else{
      check(str(doc.venue)&&unique(doc.players)&&doc.players.length<=32,'players');
      const playable=player=>range(player.gain,-60,6)&&typeof player.mute==='boolean'&&Object.hasOwn(SW.instruments,player.instrument);
      for(const player of doc.players){
        check(str(player.name)&&player.name.trim()&&Object.hasOwn(playerTypes,player.type)&&playable(player)&&unique(player.patches),'player');
        check(player.patches.every(patch=>str(patch.name)&&patch.name.trim()&&playable(patch)),'patches');
      }
      for(const item of doc.items){
        check(str(item.name)&&item.name.trim()&&order.includes(item.mode)&&range(item.length,.01,86400)&&range(item.pause,0,600)&&range(item.tempo,30,320)&&
          Number.isInteger(item.meter)&&range(item.meter,2,12)&&str(item.lyrics,12000),'setlist item');
        check(item.slots&&typeof item.slots==='object'&&!Array.isArray(item.slots)&&item.patches&&typeof item.patches==='object'&&!Array.isArray(item.patches),'player assignments');
        for(const [key,source] of Object.entries(item.slots)){
          check(doc.players.some(player=>player.id===key&&player.type==='backing')&&id(source?.asset)&&range(source.duration,.000001,86400),'backing track slot');
        }
        for(const [key,patch] of Object.entries(item.patches)){
          check(doc.players.some(player=>player.id===key&&player.patches.some(p=>p.id===patch)),'patch assignment');
        }
        check(unique(item.sections)&&item.sections.every(section=>str(section.name)&&Object.hasOwn(modes,section.mode)&&
          range(section.start,0,item.length)&&range(section.end,section.start,item.length)&&section.end>section.start&&
          Number.isInteger(section.loops)&&range(section.loops,1,99)),'sections');
        check(item.video===undefined||id(item.video?.asset)&&str(item.video.name)&&
          ['video/mp4','video/webm','video/ogg','video/quicktime'].includes(item.video.mime),'video track');
      }
    }
    const referenced=doc.kind==='mastering'?doc.items:doc.items.flatMap(item=>Object.values(item.slots));
    const durations=workspaceAssets(doc);
    check(referenced.every(row=>durations.get(row.asset)===row.duration),'conflicting source durations');
    check([...workspaceVideos(doc).keys()].every(key=>!durations.has(key)),'conflicting audio and video source IDs');
    return doc;
  }
  function encodeWorkspaceDocument(doc,media){
    validateWorkspaceDocument(doc);
    return JSON.stringify({format:'Sonoravell Workspace',document:doc,media:Object.fromEntries([...workspaceAssets(doc),...workspaceVideos(doc)].map(([id])=>{
      if(!media.has(id))throw Error('The workspace contains missing audio.');
      return [id,SW.bytesToBase64(media.get(id).bytes)];
    }))});
  }
  function decodeWorkspaceDocument(data){
    const {document:doc,media}=data||{};
    if(data?.format!=='Sonoravell Workspace'||!media||typeof media!=='object')throw Error('Choose a Sonoravell Mastering Project or Show.');
    validateWorkspaceDocument(doc);
    const raw=new Map([...workspaceAssets(doc),...workspaceVideos(doc)].map(([id])=>{
      if(!Object.hasOwn(media,id)||typeof media[id]!=='string')throw Error('The workspace is missing embedded audio.');
      return [id,SW.base64ToBytes(media[id])];
    }));
    return {doc,raw};
  }
  function levelStats(buffer){
    let peak=0, squares=0;
    for(let channel=0;channel<buffer.numberOfChannels;channel++){
      const samples=buffer.getChannelData(channel);
      for(const sample of samples){peak=Math.max(peak,Math.abs(sample));squares+=sample*sample;}
    }
    const db=value=>value>0?20*Math.log10(value):-Infinity;
    return {peak:db(peak),rms:db(Math.sqrt(squares/Math.max(1,buffer.numberOfChannels*buffer.length)))};
  }
  return {workspaceNames,workspaceSuffix,workspaceTemplates:templates,workspaceEntryLimit:entryLimit,showModes:modes,showPlayerTypes:playerTypes,
    masteringChains,createSessionTemplate,createWorkspaceDocument,masteringTrack,showPlayer,showItem,showSection,playerPatch,
    moveWorkspaceRow,normalizeMasterTrack,masteringLayout,masteringProgram,showProgram,workspaceAssets,
    workspaceVideos,validateWorkspaceDocument,encodeWorkspaceDocument,decodeWorkspaceDocument,levelStats};
})());
