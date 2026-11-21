'use strict';
const SW = globalThis.SW = {};
Object.assign(SW, (() => {
  const colors = ['#7ee2c4','#8faff9','#e0a8f3','#f6bc83','#f293a8','#b3d67b','#81cfe8','#c6b5f4'];
  const instruments = {
    Keys: ['triangle',.008,.65,2600,.22], Bass: ['sawtooth',.009,.2,540,.25],
    Pad: ['triangle',.22,.67,1350,.15], Lead: ['square',.012,.16,2100,.15],
    Pluck: ['triangle',.004,.12,3500,.24], Organ: ['sine',.012,.12,4300,.25],
    Strings: ['sawtooth',.15,.31,1600,.13], Drums: [], Sampler: []
  };
  const fx = {
    'Parametric EQ': {frequency:[40,16000,1200,1,'Hz'], gain:[-24,24,0,.1,'dB'], q:[.1,18,1,.1,'']},
    'Low Cut': {frequency:[20,18000,100,1,'Hz'], q:[.1,14,.7,.1,'']},
    'Low Pass': {frequency:[30,20000,4400,1,'Hz'], q:[.1,14,.7,.1,'']},
    'High Shelf': {frequency:[100,16000,4000,1,'Hz'], gain:[-24,24,0,.1,'dB']},
    'Compressor': {threshold:[-80,0,-19,1,'dB'], ratio:[1,20,4,.1,':1'], attack:[0,1,.015,.005,'s'], release:[.01,1,.2,.01,'s']},
    'Limiter': {threshold:[-40,0,-4,1,'dB'], release:[.01,1,.12,.01,'s']},
    'Echo': {time:[.01,1.8,.34,.01,'s'], feedback:[0,.9,.36,.01,''], mix:[0,1,.25,.01,'']},
    'Room Reverb': {mix:[0,1,.25,.01,'']},
    'Drive': {amount:[0,1,.25,.01,''], tone:[200,15000,3800,1,'Hz'], output:[0,1,.82,.01,'']},
    'Chorus': {rate:[.1,8,.65,.01,'Hz'], depth:[0,.009,.002,.0001,'s'], mix:[0,1,.35,.01,'']},
    'Tremolo': {rate:[.1,18,4,.1,'Hz'], depth:[0,1,.45,.01,'']},
    'Stereo Width': {width:[0,2,1,.01,'']},
    'Low Shelf': {frequency:[30,2500,150,1,'Hz'],gain:[-24,24,0,.1,'dB']},
    'Band Pass': {frequency:[40,16000,1200,1,'Hz'],q:[.1,18,1,.1,'']},
    'Notch': {frequency:[40,16000,1000,1,'Hz'],q:[.1,24,4,.1,'']},
    'Three-Band EQ': {low:[-24,24,0,.1,'dB'],mid:[-24,24,0,.1,'dB'],high:[-24,24,0,.1,'dB'],frequency:[120,6500,1200,1,'Hz']},
    'Parallel Compressor': {threshold:[-80,0,-24,1,'dB'],ratio:[1,20,5,.1,':1'],attack:[0,1,.025,.005,'s'],release:[.01,1,.2,.01,'s'],mix:[0,1,.5,.01,'']},
    'Hall Reverb': {mix:[0,1,.33,.01,'']},
    'Slap Delay': {time:[.028,.25,.098,.001,'s'],feedback:[0,.65,.16,.01,''],mix:[0,1,.22,.01,'']},
    'Flanger': {rate:[.05,10,.31,.01,'Hz'],depth:[0,.004,.003,.0001,'s'],feedback:[0,.85,.45,.01,''],mix:[0,1,.43,.01,'']},
    'Phaser': {rate:[.05,10,.39,.01,'Hz'],depth:[0,650,460,1,'Hz'],mix:[0,1,.45,.01,'']},
    'Auto Pan': {rate:[.05,15,.64,.01,'Hz'],depth:[0,1,.75,.01,'']},
    'Soft Clipper': {drive:[0,18,4,.1,'dB'],output:[-24,6,-3,.1,'dB']},
    'Bit Reducer': {mix:[0,1,.45,.01,''],drive:[0,18,0,.1,'dB']},
    'Cabinet Filter': {low:[35,600,93,1,'Hz'],high:[1600,9000,4600,1,'Hz'],presence:[-12,12,2,.1,'dB']},
    'Polarity': {gain:[-1,1,-1,2,'']},
    'Utility Gain': {gain:[-48,18,0,.1,'dB']}
  };
  const spectrumBands = [
    ['lc','Low cut','highpass',35,'#efae76'],
    ['ls','Low shelf','lowshelf',105,'#f8cb7e'],
    ['lm','Low mid','peaking',280,'#cddd80'],
    ['mid','Mid','peaking',1050,'#83dfbe'],
    ['hm','High mid','peaking',3300,'#80c5f5'],
    ['hs','High shelf','highshelf',8000,'#a4b6ff'],
    ['hc','High cut','lowpass',16000,'#d2a9ef']
  ];
  const pedalStages = [
    ['level','Utility Gain'],['drive','Drive'],['cab','Cabinet Filter'],['chorus','Chorus'],
    ['trem','Tremolo'],['echo','Echo'],['room','Room Reverb'],['comp','Compressor']
  ];
  const spectrumSpec=fx['Spectrum EQ']={};
  for(const [key,,type,frequency] of spectrumBands){
    spectrumSpec[key+'On']=[0,1,type==='highpass'||type==='lowpass'?0:1,1,''];
    spectrumSpec[key+'Freq']=[20,20000,frequency,1,'Hz'];
    if(['highpass','lowpass','peaking'].includes(type))spectrumSpec[key+'Q']=[.1,18,type==='peaking'?1:.7,.1,'Q'];
    if(!['highpass','lowpass'].includes(type))spectrumSpec[key+'Gain']=[-24,24,0,.1,'dB'];
  }
  spectrumSpec.output=[-24,18,0,.1,'dB'];
  const pedalSpec=fx['Guitar Pedalboard']={};
  for(const [index,[key,type]] of pedalStages.entries()){
    pedalSpec[key+'Order']=[0,pedalStages.length-1,index,1,''];
    pedalSpec[key+'On']=[0,1,key==='drive'||key==='cab'?1:0,1,''];
    for(const [param,spec] of Object.entries(fx[type]))pedalSpec[key+'_'+param]=spec;
  }
  const structuralFXParam=(type,key)=>type==='Spectrum EQ'&&key.endsWith('On')||
    type==='Guitar Pedalboard'&&/(?:Order|On)$/.test(key);
  const pedalOrder=e=>[...pedalStages].sort(([a],[b])=>e.params[a+'Order']-e.params[b+'Order']);
  function validEffectParams(type,params){
    if(!Object.hasOwn(fx,type)||!params||!Object.entries(fx[type]).every(([key,[min,max]])=>{
      const value=params[key];
      return Number.isFinite(value)&&value>=min&&value<=max&&(!structuralFXParam(type,key)||Number.isInteger(value));
    }))return false;
    return type!=='Guitar Pedalboard'||new Set(pedalStages.map(([key])=>params[key+'Order'])).size===pedalStages.length;
  }
  const clone = value => structuredClone(value);
  const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const db = n => 10 ** (n / 20);
  const quantize = (n, step) => step ? Math.round(n / step) * step : n;
  const seconds = (beats, bpm) => beats * 60 / bpm;
  const noteName = n => ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][n%12]+(Math.floor(n/12)-1);
  const project = () => ({version:1, name:'Untitled session', bpm:112, meter:4, loop:false, loopStart:0, loopEnd:16, click:false, markers:[], assets:{}, tracks:[], master:channel('Master','master',0)});
  function channel(name,type,index) {
    return {id:type==='master'?'master':uid(),name,type,color:colors[index%colors.length],volume:type==='master'?-.5:-6,pan:0,mute:false,solo:false,fx:[],clips:[],out:'master',send:'',sendLevel:-18,lanes:{},automation:'Read',instrument:'Keys',transpose:0,sample:null};
  }
  const clip = (type,start,length,name) => ({id:uid(),name,type,start,length,offset:0,fadeIn:0,fadeOut:0,gain:0,reverse:false,notes:[]});
  const note = (pitch,start,length,velocity=.78) => ({id:uid(),pitch,start,length,velocity});
  const effect = type => ({id:uid(),type,bypass:false,params:Object.fromEntries(Object.entries(fx[type]).map(([key,spec])=>[key,spec[2]]))});
  function songEnd(p) {
    return p.tracks.reduce((end,t)=>t.clips.reduce((last,c)=>Math.max(last,c.start+c.length),end),4);
  }
  function demo() {
    const p=project();
    p.name='After Hours'; p.bpm=104; p.loopEnd=16;
    const keys=channel('Electric Keys','midi',0); keys.volume=-7;
    const bass=channel('Sub Bass','midi',1); bass.instrument='Bass'; bass.volume=-7;
    const drums=channel('Drum Machine','midi',2); drums.instrument='Drums'; drums.volume=-8;
    const lead=channel('Glass Plucks','midi',3); lead.instrument='Pluck'; lead.volume=-10;
    const room=channel('Room Return','bus',4); room.volume=-11;
    const reverb=effect('Room Reverb'); reverb.params.mix=1; room.fx.push(reverb);
    const echo=effect('Echo'); echo.params.mix=.29; lead.fx.push(echo);
    keys.send=room.id; keys.sendLevel=-9;
    p.tracks=[keys,bass,drums,lead,room]; p.master.fx.push(effect('Limiter'));
    const chords=[[57,60,64,67],[53,57,60,64],[60,64,67,71],[55,59,62,65]];
    for(let bar=0;bar<8;bar++){
      const tones=chords[bar%4];
      const parts=[clip('midi',bar*4,4,['Am7','Fmaj7','Cmaj7','G7'][bar%4]),clip('midi',bar*4,4,'Bassline'),clip('midi',bar*4,4,'Pocket'),clip('midi',bar*4,4,'Glass motif')];
      for(const n of tones) parts[0].notes.push(note(n,0,1.8,.59),note(n,2.5,1.25,.48));
      for(const [at,i] of [[0,0],[.75,0],[1.5,0],[2.5,2],[3.25,0]]) parts[1].notes.push(note(tones[i]-12,at,.36,.72));
      for(const at of [0,1.5,2,3.25]) parts[2].notes.push(note(36,at,.3,.86));
      for(const at of [1,3]) parts[2].notes.push(note(38,at,.19,.68));
      for(let i=0;i<8;i++) parts[2].notes.push(note(i===7?46:42,i*.5,.12,i%2?.33:.46));
      for(const [at,i] of [[.5,2],[1.25,3],[2.25,1],[3,2]]) parts[3].notes.push(note(tones[i]+12,at,.29,.59));
      for(let i=0;i<3;i++) p.tracks[i].clips.push(parts[i]);
      if(bar>=2) lead.clips.push(parts[3]);
    }
    lead.lanes.volume=[{at:8,value:-18},{at:16,value:-10},{at:29,value:-10},{at:32,value:-19}];
    p.markers=[{id:uid(),at:0,name:'Intro'},{id:uid(),at:8,name:'Verse'},{id:uid(),at:16,name:'Hook'},{id:uid(),at:32,name:'Outro'}];
    const cueA={id:uid(),name:'Performer 1',volume:-6,mute:false},cueB={id:uid(),name:'Performer 2',volume:-7,mute:false};
    p.cues=[cueA,cueB];
    keys.cueSends=[{to:cueA.id,level:-9,pan:0,pre:true,followPan:false,mute:false}];
    bass.cueSends=[{to:cueA.id,level:-15,pan:0,pre:true,followPan:false,mute:false}];
    drums.cueSends=[{to:cueB.id,level:-10,pan:0,pre:true,followPan:false,mute:false}];
    lead.cueSends=[{to:cueB.id,level:-12,pan:0,pre:false,followPan:true,mute:false}];
    if(SW.spatialDefaults){
      keys.spatial={...SW.spatialDefaults,mode:'bed',x:-.44,y:-.71,z:.07,spread:.32};
      lead.spatial={...SW.spatialDefaults,mode:'object',x:.55,y:.17,z:.68,spread:.12};
    }
    return p;
  }
  function validRoute(p,from,to,kind) {
    if(!to || to==='master') return true;
    if(!p.tracks.some(t=>t.type==='bus'&&t.id===to)) return false;
    const visited=new Set();
    function reaches(id) {
      if(id===from) return true;
      if(visited.has(id)) return false;
      visited.add(id);
      const t=p.tracks.find(track=>track.id===id);
      return Boolean(t && [t.out,t.send,...(t.sends||[]).map(s=>s.to)].some(target=>target&&reaches(target)));
    }
    return !reaches(to) && (kind!=='send'||to!=='master');
  }
  function automationValue(points,at,fallback) {
    if(!points?.length) return fallback;
    if(at<=points[0].at) return points[0].value;
    const i=points.findIndex(point=>point.at>at);
    if(i<0) return points.at(-1).value;
    const a=points[i-1], b=points[i];
    return a.value+(b.value-a.value)*(at-a.at)/(b.at-a.at);
  }
  function splitClip(c,at) {
    const cut=at-c.start;
    if(cut<.001||cut>c.length-.001) return null;
    const right={...clone(c),id:uid(),start:at,length:c.length-cut,fadeIn:0};
    c.length=cut;
    c.fadeOut=0;
    c.fadeIn=Math.min(c.fadeIn,c.length);
    right.fadeOut=Math.min(right.fadeOut,right.length);
    if(c.type==='audio') right.offset+=cut;
    else {
      const source={...c,length:cut+right.length};
      if(source.expression){
        c.expression=SW.expressionSlice(source,0,cut);
        right.expression=SW.expressionSlice(source,cut,source.length);
      }
      right.notes=right.notes.filter(n=>n.start+n.length>cut).map(n=>({...n,id:uid(),start:Math.max(0,n.start-cut),length:n.start+n.length-Math.max(cut,n.start)}));
      c.notes=c.notes.filter(n=>n.start<cut).map(n=>({...n,length:Math.min(n.length,cut-n.start)}));
    }
    return right;
  }
  function laneSpecs(t) {
    const lanes={volume:['Volume',-60,6,.1,'dB'],pan:['Pan',-1,1,.01,''],trim:['Input trim',-24,24,.1,'dB']};
    if(t.type!=='master'&&SW.spatialSpecs){
      for(const [key,spec] of Object.entries(SW.spatialSpecs)) lanes['space:'+key]=spec;
    }
    for(const e of t.fx) for(const [key,spec] of Object.entries(fx[e.type])){
      if(!structuralFXParam(e.type,key))lanes['fx:'+e.id+':'+key]=[e.type+' · '+key,...spec.slice(0,2),spec[3],spec[4]];
    }
    return lanes;
  }
  function laneValue(t,key) {
    if(key==='volume'||key==='pan'||key==='trim') return t[key]??0;
    if(key.startsWith('space:')) return SW.position(t)[key.slice(6)];
    const [,id,param]=key.split(':');
    return t.fx.find(e=>e.id===id)?.params[param] ?? 0;
  }
  function setLaneValue(t,key,value) {
    if(key==='volume'||key==='pan'||key==='trim') t[key]=value;
    else if(key.startsWith('space:')) {t.spatial=SW.position(t);t.spatial[key.slice(6)]=value;}
    else {
      const [,id,param]=key.split(':');
      const e=t.fx.find(e=>e.id===id);
      if(e) e.params[param]=value;
    }
  }
  const fadeShapes=Object.freeze({linear:'Linear',power:'Equal power',slow:'Slow rise',fast:'Fast rise',smooth:'S-curve'});
  function fadeLevel(shape,position){
    const x=clamp(position,0,1);
    switch(shape){
      case 'power':return Math.sin(x*Math.PI/2);
      case 'slow':return x*x;
      case 'fast':return 1-(1-x)**2;
      case 'smooth':return x*x*(3-2*x);
      default:return x;
    }
  }
  return {fadeShapes,fadeLevel,colors,instruments,fx,spectrumBands,pedalStages,pedalOrder,structuralFXParam,validEffectParams,
    clone,uid,clamp,db,quantize,seconds,noteName,project,channel,clip,note,effect,songEnd,demo,validRoute,automationValue,splitClip,laneSpecs,laneValue,setLaneValue};
})());
