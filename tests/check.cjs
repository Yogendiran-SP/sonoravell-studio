'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = path.join(__dirname,'../src');
function load(file,env){
  vm.runInContext(fs.readFileSync(path.join(source,file),'utf8'),env,{filename:file});
}
const env = vm.createContext({console,structuredClone,TextEncoder,TextDecoder,btoa,atob,Blob,crypto,URL,URLSearchParams});
for(const name of ['model','arrangement','formats','spatial','keyscheme','studio-panels','patch','patch-panel','audio','plugin-visuals','workflows','note-editor','settings','midi-expression','track-icons','editor-actions']) load(name+'.js',env);
const T=env.SW;

class Param {
  value=0;
  events=[];
  setValueAtTime(v,t){assert.ok(Number.isFinite(v+t)&&t>=0);this.events.push([v,t]);return this;}
  setTargetAtTime(v,t,g){assert.ok(Number.isFinite(v+t+g));return this;}
  cancelScheduledValues(t){assert.ok(Number.isFinite(t));return this;}
  linearRampToValueAtTime(v,t){return this.setValueAtTime(v,t);}
  exponentialRampToValueAtTime(v,t){assert.ok(v>0);return this.setValueAtTime(v,t);}
}
class AudioNode {
  gain=new Param(); pan=new Param(); frequency=new Param(); Q=new Param(); delayTime=new Param(); positionX=new Param(); positionY=new Param(); positionZ=new Param();
  attack=new Param(); threshold=new Param(); ratio=new Param(); release=new Param(); knee=new Param(); playbackRate=new Param(); detune=new Param();
  connected=[];
  connect(other){assert.ok(other instanceof AudioNode||other instanceof Param);this.connected.push(other);return other;}
  addEventListener(){}
  disconnect(){}
  start(t=0,o=0){assert.ok(t>=0&&o>=0);}
  stop(t=0){assert.ok(t>=0);this.stoppedAt=t;}
}
class Context {
  sampleRate=48000; currentTime=0; destination=new AudioNode();
  createBuffer(count,length,sampleRate){
    const data=Array.from({length:count},()=>new Float32Array(length));
    return {numberOfChannels:count,length,sampleRate,duration:length/sampleRate,getChannelData:i=>data[i]};
  }
}
for(const type of ['Gain','Panner','StereoPanner','Analyser','BiquadFilter','DynamicsCompressor','Delay','Convolver','WaveShaper','Oscillator','ChannelSplitter','ChannelMerger','BufferSource']){
  Context.prototype['create'+type]=()=>new AudioNode();
}

function verifyStockDevices(){
  const session=T.demo(), track=session.tracks[0], context=new Context();
  const eq=T.effect('Spectrum EQ'), pedal=T.effect('Guitar Pedalboard');
  T.addEffect(track,eq);T.addEffect(track,pedal);
  eq.params.lcOn=1;eq.params.lcFreq=72;eq.params.midGain=6;eq.params.output=-3;
  pedal.params.driveOrder=2;pedal.params.cabOrder=1;
  assert.equal(T.pedalOrder(pedal)[1][1],'Cabinet Filter');
  assert.equal(T.pedalOrder(pedal)[2][1],'Drive');
  assert.ok(!Object.hasOwn(T.laneSpecs(track),'fx:'+pedal.id+':driveOrder'));
  assert.ok(Object.hasOwn(T.laneSpecs(track),'fx:'+pedal.id+':drive_amount'));
  const graph=T.buildGraph(context,session,true);
  const processors=graph.tracks.get(track.id).processors, equalizer=processors.get(eq.id), board=processors.get(pedal.id);
  assert.equal(equalizer.filters.length,6);
  assert.equal(equalizer.filters[0].type,'highpass');
  assert.equal(equalizer.filters[0].frequency.value,72);
  assert.equal(equalizer.output.gain.value,T.db(-3));
  assert.equal(board.input.connected[0].type,'highpass','processing order must match the pedalboard');
  assert.ok(board.params.drive_amount);
  assert.equal(board.params.echo_time,undefined,'the bypassed delay is outside the signal path');
  graph.stop();
  const roundtrip=T.decodeProject(T.encodeProject(session,new Map())).p;
  assert.equal(roundtrip.tracks[0].fx.at(-1).params.driveOrder,2);
  const invalid=T.clone(session);invalid.tracks[0].fx.at(-1).params.driveOrder=1;
  assert.throws(()=>T.validateProject(invalid),/effect parameters/);
  const handles=T.pluginHandles('eq',eq);
  assert.equal(handles.length,7);
  const peak=handles.find(point=>point.key==='mid'), cut=handles.find(point=>point.key==='lc');
  const start=T.handlePosition('eq',peak,eq.params,T.fx[eq.type],24);
  const moved=T.handleValues('eq',peak,[start[0]+.08,start[1]-.1],eq.params,T.fx[eq.type],24);
  assert.ok(moved.midFreq>eq.params.midFreq&&moved.midGain>6);
  assert.deepEqual(Object.keys(T.handleValues('eq',cut,start,eq.params,T.fx[eq.type],24)),['lcFreq']);
  const simulatedFilters=[{getFrequencyResponse(_frequencies,mag){mag.fill(2);}}];
  const response=T.frequencyResponse(eq,{filters:simulatedFilters});
  assert.ok(Math.abs(response[0]-(20*Math.log10(2)-3))<1e-6);
  eq.bypass=true;
  assert.ok(T.frequencyResponse(eq,{filters:simulatedFilters}).every(value=>value===0));
  console.log('Spectrum EQ filter graph and point mapping, pedal order and bypass, and project round-trip passed.');
}

async function verify(){
  verifyStockDevices();
  {
    const a=T.note(61,.5,1,.5), b=T.note(69,1.75,.5,.85), partForEdit=T.clip('midi',0,4,'Phrase');
    partForEdit.notes=[a,b];
    const moved=T.moveNotes(partForEdit.notes,4,-4,100);
    assert.equal(moved[0].start,0);
    assert.equal(moved[1].start,1.25);
    assert.equal(moved[1].pitch,127);
    assert.equal(moved[1].pitch-moved[0].pitch,b.pitch-a.pitch);
    const trim=T.trimNotes(partForEdit.notes,4,3,'left');
    assert.ok(trim.every(n=>n.length>0));
    assert.equal(trim[0].start+trim[0].length,a.start+a.length);
    const pasted=T.pasteNotes(partForEdit.notes,4,1);
    assert.equal(pasted[0].start,1);
    assert.equal(pasted[1].start,2.25);
    assert.notEqual(pasted[0].id,a.id);
    const noteSplit=T.processPianoNotes(partForEdit,[a.id],'split',{at:1});
    assert.equal(noteSplit.notes.length,3);
    assert.equal(noteSplit.notes[1].length,.5);
    assert.equal(noteSplit.selection.length,2);
    assert.equal(a.length,1);
    const scaled=T.processPianoNotes(partForEdit,[a.id],'scale',{root:0,scale:'major'});
    assert.equal(scaled.notes[0].pitch,60);
    assert.equal(scaled.notes[1].pitch,b.pitch);
    assert.equal(T.processPianoNotes(partForEdit,[b.id],'swing',{grid:.25,swing:.5}).notes[1].start,1.8125);
    assert.equal(T.processPianoNotes(partForEdit,[b.id],'quantize-end',{grid:.5}).notes[1].length,.75);
  }
  assert.equal(T.locatorText(5.5,4),'002.2.480');
  assert.equal(T.parseLocator('002.2.480',4),5.5);
  assert.equal(T.parseLocator('12',3),33);
  assert.equal(T.parseLocator('003:2:240',3),7.25);
  assert.equal(T.parseLocator('001.4.000',3),null);
  assert.equal(T.parseLocator('001.1.960',4),null);
  assert.equal(T.locatorText(3.99999,4),'002.1.000');
  const macroProject=T.demo(), macroTrack=macroProject.tracks[0], part=macroTrack.clips[0];
  assert.equal(T.trackIcon(macroTrack),'keys');
  assert.equal(T.trackIcon({...macroTrack,instrument:'Drums'}),'drums');
  assert.equal(T.trackIcon(T.channel('Lead vocal','audio',0)),'waveform');
  macroTrack.icon='grand';
  assert.equal(T.decodeProject(T.encodeProject(macroProject,new Map())).p.tracks[0].icon,'grand');
  const scope={track:macroTrack.id,part:part.id,clips:[part.id],notes:[],cursor:0,grid:.25};
  const originalVelocity=part.notes[0].velocity;
  const output=T.applyMacro(macroProject,{name:'Shape performance',scope:'notes',steps:[
    {id:'note-transpose',value:12},{id:'note-velocity',value:80}]},scope);
  assert.equal(output.project.tracks[0].clips[0].notes[0].pitch,part.notes[0].pitch+12);
  assert.equal(output.project.tracks[0].clips[0].notes[0].velocity,80/127);
  assert.equal(part.notes[0].velocity,originalVelocity);
  assert.throws(()=>T.applyMacro(macroProject,{name:'Atomic',scope:'events',steps:[
    {id:'event-mute'},{id:'audio-gain',value:1}]},scope),/audio event/);
  assert.equal(Boolean(part.muted),false);
  assert.throws(()=>T.validateMacro({name:'Invalid',scope:'notes',steps:[{id:'note-transpose',value:1.5}]}),/out of range/);
  assert.ok(T.eventMenu('audio').flatMap(([,rows])=>rows).some(([id])=>id==='normalize'));
  assert.ok(!T.eventMenu('part').flatMap(([,rows])=>rows).some(([id])=>id==='normalize'));
  const defaults=T.preferences();
  assert.equal(defaults.autosave,true);
  assert.equal(defaults.newTempo,112);
  const settings=T.readPreferenceProfile(JSON.parse('{"format":"soundweave-preferences","version":1,"settings":{"velocity":340,"recordChannels":"2","inputDevice":"test-input","inputAutoGain":true,"density":"invalid","__proto__":{"autosave":false}}}'));
  assert.equal(settings.velocity,127);
  assert.equal(settings.density,'normal');
  assert.equal(settings.autosave,true);
  assert.equal(T.recordingConstraints(settings,'track-input').deviceId.exact,'track-input');
  assert.equal(T.recordingConstraints(settings,'').channelCount.ideal,2);
  assert.equal(T.recordingConstraints(settings,'').autoGainControl,true);
  assert.throws(()=>T.readPreferenceProfile({format:'soundweave-preferences',version:2,settings:{}}));
  assert.throws(()=>T.readPreferenceProfile({format:'soundweave-preferences',version:1,settings:[]}));
  const p=T.demo();
  T.validateProject(p);
  const arranged=T.clone(p);
  const lyric={id:T.uid(),at:2,length:4,name:'Breathe again'};
  const section={id:T.uid(),at:6,length:8,name:'Chorus'};
  const chord={id:T.uid(),at:8,length:2,name:'C♯m7'};
  const tempo={id:T.uid(),at:12,name:'116 BPM',bpm:116};
  const signature={id:T.uid(),at:14,name:'6/8 · D minor',meter:6,denominator:8,key:'D minor'};
  arranged.globalTracks={lyrics:[lyric],arranger:[section],chords:[chord],tempo:[tempo],signature:[signature]};
  const portable=T.decodeProject(T.encodeProject(arranged,new Map())).p;
  assert.equal(portable.globalTracks.lyrics[0].name,'Breathe again');
  assert.equal(T.activeGlobalEntry([section,lyric],7).name,'Chorus');
  assert.equal(T.activeGlobalEntry([lyric],6),null);
  assert.deepEqual([...T.loopBounds('draw',0,0,4,8)],[4,8]);
  assert.deepEqual([...T.loopBounds('move',4,8,1,8)],[0,4]);
  assert.deepEqual([...T.loopBounds('move',4,8,100000,4)],[99996,100000]);
  assert.equal(T.loopBounds('left',4,8,9)[1],8);
  assert.equal(T.loopBounds('right',4,8,3)[0],4);
  assert.equal(T.arrangeEntryBounds('right',lyric,7,6).length,5);
  T.deleteRange(arranged,4,9,undefined,true);
  assert.equal(arranged.globalTracks.lyrics[0].length,2);
  assert.equal(arranged.globalTracks.arranger[0].at,4);
  assert.equal(arranged.globalTracks.arranger[0].length,5);
  assert.equal(arranged.globalTracks.chords[0].at,4);
  assert.equal(arranged.globalTracks.chords[0].length,1);
  assert.equal(arranged.globalTracks.tempo[0].at,7);
  assert.equal(arranged.globalTracks.signature[0].at,9);
  T.validateProject(arranged);
  arranged.globalTracks.tempo[0].bpm=900;
  assert.throws(()=>T.validateProject(arranged),/global track event/);
  assert.equal(T.decodeProject(T.encodeProject(p,new Map())).p.name,p.name);
  const legacy=JSON.parse(T.encodeProject(p,new Map()));
  assert.equal(legacy.format,'Sonoravell');
  legacy.format='Soundweave';
  assert.equal(T.decodeProject(JSON.stringify(legacy)).p.name,p.name);
  assert.equal(T.songEnd(p),32);
  const track=p.tracks[0], original=track.clips[0];
  const copy=T.shiftClip(original,4);
  assert.equal(copy.start,4);
  assert.notEqual(copy.notes[0].id,original.notes[0].id);
  const sliced=T.sliceClip(original,1,3);
  assert.equal(sliced.start,1);
  assert.equal(sliced.length,2);
  assert.ok(sliced.notes.every(n=>n.start>=0&&n.start+n.length<=2));
  const joined=T.mergeNotes([original,copy]);
  assert.equal(joined.length,8);
  assert.equal(joined.notes.length,original.notes.length*2);
  const editable=joined.notes[0];
  T.noteEdit([editable],joined.length,'transpose',{semitones:12});
  assert.equal(editable.pitch,original.notes[0].pitch+12);
  T.noteEdit([editable],joined.length,'fixed-length',{step:.125});
  assert.equal(editable.length,.125);

  const split=T.splitClip(original,2);
  assert.equal(split.start,2);
  track.clips.push(split);
  const otherTrack=p.tracks[1], before=otherTrack.clips.length;
  T.deleteRange(p,2,4,track.id,false);
  assert.equal(otherTrack.clips.length,before);
  T.deleteRange(p,4,8,track.id,true);
  assert.equal(T.songEnd(p),28);
  assert.equal(p.markers[1].at,4);
  T.validateProject(p);

  const bus=p.tracks.find(t=>t.type==='bus'), out=T.channel('Second bus','bus',2);
  p.tracks.push(out);
  out.sends=[{to:bus.id,level:-10,pre:true,mute:false}];
  assert.equal(T.validRoute(p,bus.id,out.id,'send'),false);
  bus.sends=[{to:out.id,level:-10,pre:false,mute:false}];
  assert.throws(()=>T.validateProject(p),/routing cycle/);
  bus.sends=[];
  out.solo=true;
  track.soloSafe=true;
  assert.ok(T.audibility(p).has(track.id));
  T.validateProject(p);

  const ranges=T.markerRanges(p,'each',[],null);
  assert.deepEqual(Array.from(ranges,r=>[r.from,r.to]),[[0,4],[4,12],[12,28]]);
  const markers=p.markers;
  assert.equal(T.markerRanges(p,'markers',[markers[1].id,markers[2].id],null)[0].to,12);
  const mid=T.midi(p), read=T.parseMidi(mid.buffer);
  assert.equal(read.tracks.length,4);
  assert.ok(read.tracks.some(t=>t.drum));
  assert.throws(()=>T.parseMidi(mid.slice(0,13).buffer));

  const expressionProject=T.project(), expressionTrack=T.channel('Expression','midi',0);
  const expressionClip=T.clip('midi',0,4,'Part');
  expressionProject.tracks.push(expressionTrack);
  expressionTrack.clips.push(expressionClip);
  expressionClip.notes.push(T.note(60,0,.5,.8));
  for(const [key,at,value] of [['cc64',0,127],['cc64',2,0],['bend',0,0],['bend',1,8191],['cc1',.25,90],
    ['cc11',0,95],['cc74',.5,80],['cc91',.5,52],['inst:reverb',0,.35],['inst:cutoff',0,800],['inst:attack',0,.05]]){
    T.setExpression(expressionClip,key,at,value);
  }
  assert.equal(T.sustainedEnd(expressionClip,.5),2);
  assert.equal(T.pointValue(expressionClip.expression.bend,.5,0),4095.5);
  const fullPart=T.clone(expressionClip), after=T.splitClip(expressionClip,.75);
  assert.equal(after.expression.cc64[0].value,127);
  assert.equal(after.expression.bend[0].value,6143.25);
  assert.equal(after.expression.bend[1].at,.25);
  assert.equal(expressionClip.expression.bend.at(-1).at,.75);
  assert.equal(T.mergeNotes([expressionClip,after]).expression.cc64.at(-1).at,2);
  expressionTrack.clips=[fullPart];
  const persisted=T.decodeProject(T.encodeProject(expressionProject,new Map())).p;
  assert.equal(persisted.tracks[0].clips[0].expression['inst:reverb'][0].value,.35);
  const expressionSmf=T.parseMidi(T.midi(expressionProject).buffer).tracks[0].expression;
  assert.equal(expressionSmf.cc64.find(point=>point.value===0).at,2);
  assert.equal(expressionSmf.bend.find(point=>point.value===8191).at,1);
  assert.equal(expressionSmf['inst:reverb'],undefined);
  const audio=new Context(), oscillators=[];
  audio.createOscillator=()=>{const o=new AudioNode();oscillators.push(o);return o;};
  const graphExpression=T.buildGraph(audio,expressionProject);
  T.schedule(graphExpression,new Map(),0,4,0);
  const played=oscillators.find(o=>o.detune.events.some(([value])=>value===200));
  assert.ok(played,'pitch bend reached oscillator detune');
  assert.ok(played.stoppedAt>=T.seconds(2,expressionProject.bpm),'pedal held the voice past note-off');
  assert.ok(graphExpression.tracks.get(expressionTrack.id).rack.reverb.targets[1].param.events.some(([value])=>value===.35));
  graphExpression.stop();
  const ctx=new Context();
  const fadeProject=T.project(), vocal=T.channel('Vocal','audio',0), event=T.clip('audio',0,4,'Take');
  const source=T.uid();
  Object.assign(event,{asset:source,sourceBpm:fadeProject.bpm,fadeIn:1,fadeOut:1,fadeInShape:'power',fadeOutShape:'slow'});
  fadeProject.assets[source]={name:'Test.wav',duration:T.seconds(4,fadeProject.bpm)};
  vocal.clips.push(event);fadeProject.tracks.push(vocal);
  T.validateProject(fadeProject);
  const studioAudio=new Context();
  const fadeGraph=T.buildGraph(studioAudio,fadeProject);
  const envelopes=[];
  studioAudio.createGain=()=>{const node=new AudioNode();envelopes.push(node.gain);return node;};
  const clipBuffer=studioAudio.createBuffer(1,Math.ceil(fadeProject.assets[source].duration*48000),48000);
  T.schedule(fadeGraph,new Map([[source,{buffer:clipBuffer}]]),.5,3.5,2);
  const envelope=envelopes.find(param=>param.events.length>20);
  assert.ok(envelope);
  assert.ok(Math.abs(envelope.events[0][0]-Math.SQRT1_2)<1e-6);
  assert.ok(Math.abs(envelope.events.at(-1)[0]-.25)<1e-6);
  assert.ok(envelope.events.every(([,at],i)=>!i||envelope.events[i-1][1]<=at));
  fadeGraph.stop();

  const b=ctx.createBuffer(2,481,48000);
  b.getChannelData(0)[1]=.8;
  b.getChannelData(1)[1]=-.2;
  const [[,mono]]=T.speakerChannels(b,'mono');
  assert.ok(Math.abs(mono.getChannelData(0)[1]-.3)<.0001);
  T.applyPeak(b,-1);
  assert.ok(Math.abs(b.getChannelData(0)[1]-T.db(-1))<.0001);
  const metadata=T.wav(mono,24,{dither:true,tags:{title:'Fixture',artist:'Test',bpm:104}});
  assert.equal(new DataView(metadata).getUint32(40,true),481*3);
  assert.match(Buffer.from(metadata).toString('latin1'),/INFOINAM/);
  assert.match(Buffer.from(metadata).toString('latin1'),/IBPM/);
  const zipped=await T.zip([['a.wav',metadata]]).arrayBuffer();
  assert.equal(new DataView(zipped).getUint32(0,true),0x04034b50);

  for(const name of Object.keys(T.fx)){
    const session=T.demo(), t=session.tracks[0], e=T.effect(name);
    t.fx=[e];
    for(const [key,spec] of Object.entries(T.fx[name])) t.lanes['fx:'+e.id+':'+key]=[{at:0,value:spec[2]},{at:1,value:spec[0]},{at:2,value:spec[1]}];
    const graph=T.buildGraph(ctx,session,true,t.id);
    T.schedule(graph,new Map(),0,3,0,{loop:true,click:true});
    const release=T.voice(graph,t,60,.8,0,120,new Map(),Infinity,true);
    assert.equal(typeof release,'function');release();
    graph.stop();
  }
  assert.equal(T.noteKeys.KeyA,0);
  assert.equal(T.noteKeys.KeyW,1);
  const studio=T.demo(), first=studio.tracks[0], cue=T.uid();
  studio.cues.push({id:cue,name:'Headphones',volume:-6,mute:false});
  studio.monitorCue=cue;
  first.cueSends=[{to:cue,pre:true,mute:false,level:-10,pan:.3,followPan:true}];
  first.spatial={...T.spatialDefaults,mode:'object',x:.2,y:-.5,z:.6};
  first.lanes['space:x']=[{at:0,value:-1},{at:2,value:1}];
  first.lanes['space:z']=[{at:0,value:0},{at:2,value:1}];
  T.validateProject(studio);
  const map=T.graphModel(studio);
  assert.ok(map.edges.some(e=>e.kind==='cue'&&e.to===cue+':cue'));
  assert.ok(map.edges.some(e=>e.kind==='monitor'&&e.from===cue+':out'));
  const top=T.speakerGains({...first.spatial,z:1});
  assert.ok(top.slice(0,8).every(x=>x===0));
  assert.ok(Math.abs(Math.hypot(...top)-1)<1e-7);
  assert.equal(T.speakerMask,0x2d63f);
  for(const [layout,output] of [['stereo',cue],['binaural','master'],['surround','master']]){
    const graph=T.buildGraph(ctx,studio,false,output,ctx.destination,layout);
    T.schedule(graph,new Map(),0,3,0,{});
    if(layout==='surround')assert.equal(graph.tracks.get(first.id).spatial.params.length,12);
    graph.stop();
  }
  assert.equal(T.dialValue(T.dialFraction(1000,20,20000,'Hz'),20,20000,1,'Hz'),1000);
  assert.equal(T.art('Utility Gain').x,100);
  assert.equal(T.convertKey('Ctrl+NumPad+'),'Ctrl+NumpadAdd');
  assert.equal(T.convertKey('Ctrl++'),'Ctrl++');
  assert.equal(T.convertKey('Alt+Left Arrow'),'Alt+ArrowLeft');
  const keys=T.remapStudioCommands([
    {category:'View',name:'Console',keys:['F9','Ctrl+M']},
    {category:'View',name:'Browser',keys:['F9']},
    {category:'Event',name:'Unknown Options',keys:['Alt+F10']}
  ],{mixer:['Mixer','F3'],browser:['Browser','F5'],edit:['Editor','Ctrl+M']},{});
  assert.equal(keys.bindings.mixer,'F9');
  assert.equal(keys.bindings.edit,'');
  assert.equal(keys.alternates[0].keys[0],'Ctrl+M');
  assert.equal(keys.conflicts.length,1);assert.equal(keys.skipped.length,1);
  const route=T.demo(), keysTrack=route.tracks[0], room=route.tracks.find(t=>t.type==='bus');
  const socket=(track,stage,port)=>({node:track.id+':'+stage,port});
  let wires=T.graphModel(route);
  const wire=wires.edges.find(e=>e.id==='output:'+keysTrack.id);
  assert.equal(wire.to,'master:in');
  T.detachWire(route,wire);
  assert.equal(keysTrack.out,'');
  let graph=T.buildGraph(ctx,route);
  assert.equal(graph.tracks.get(keysTrack.id).out.connected.length,0);
  graph.stop();
  const connected=T.patchConnect(route,socket(keysTrack,'out','route'),socket(room,'in','sum'));
  assert.equal(connected.tracks[0].out,room.id);
  assert.equal(route.tracks[0].out,'', 'a trial patch leaves the source project unchanged');
  const room2=T.channel('Submix','bus',9);room2.out=room.id;connected.tracks.push(room2);
  assert.throws(()=>T.patchConnect(connected,socket(room,'out','route'),socket(room2,'in','sum')),/feedback/);

  assert.throws(()=>T.patchConnect(connected,socket(keysTrack,'source','out'),socket(keysTrack,'trim','in')),/signal types/);
  const broken=connected.tracks[0];
  const serial=T.graphModel(connected).edges.find(e=>e.owner===broken.id&&e.serial?.from==='source');
  T.detachWire(connected,serial);
  graph=T.buildGraph(ctx,connected);
  assert.equal(graph.tracks.get(broken.id).source,null,'disconnected MIDI input stops instrument voices');
  graph.stop();
  const fixed=T.patchConnect(connected,socket(broken,'source','out'),socket(broken,'instrument','in'));
  const instrument=fixed.tracks[0];
  const effect=T.effect('Echo');
  T.addEffect(instrument,effect,{wire:{from:'trim',to:'pre'}});
  assert.ok(instrument.patch.some(e=>e.from==='trim'&&e.to==='fx:'+effect.id));
  assert.ok(instrument.patch.some(e=>e.from==='fx:'+effect.id&&e.to==='pre'));
  T.removeEffect(instrument,effect.id);
  assert.ok(instrument.patch.some(e=>e.from==='trim'&&e.to==='pre'));
  assert.throws(()=>T.patchConnect(fixed,socket(instrument,'post','out'),socket(instrument,'pre','in')),/loop/);
  const send=T.patchConnect(fixed,socket(instrument,'pre','send'),socket(room,'in','sum'));
  const pre=T.graphModel(send).edges.find(e=>e.routeKind==='send'&&e.owner===instrument.id&&e.kind==='pre');
  assert.ok(pre);
  const post=T.patchConnect(send,socket(instrument,'post','send'),socket(room2,'in','sum'),pre);
  assert.equal(post.tracks[0].sends[0].to,room2.id);
  assert.equal(post.tracks[0].sends[0].pre,false);
  const folder={id:T.uid(),name:'My Folder'};
  post.folders=[folder];T.setFolder(post,post.tracks[0],folder.id);
  const busForFolder=T.folderBus(post,folder);
  assert.equal(post.tracks[0].out,busForFolder.id);
  assert.ok(T.timelineTracks(post).every(t=>t.type!=='bus'));
  T.removeChannel(post,busForFolder.id);
  assert.equal(post.tracks[0].out,room.id);
  assert.equal(post.tracks[0].folder,folder.id);
  T.validateProject(post);
  const surround=T.wav(ctx.createBuffer(12,48,48000),24,{channelMask:T.speakerMask});
  const wave=new DataView(surround);
  assert.equal(wave.getUint16(20,true),0xfffe);
  assert.equal(wave.getUint16(22,true),12);
  assert.equal(wave.getUint32(40,true),T.speakerMask);
  assert.equal(wave.getUint32(64,true),48*12*3);
  if(process.env.SW_WAV_FIXTURE) fs.writeFileSync(process.env.SW_WAV_FIXTURE,Buffer.from(surround));
  console.log('Cue routing, spatial gains, 7.1.4 WAV header and key mapping passed.');
  console.log('Project/edit/export checks and scheduling test doubles for '+Object.keys(T.fx).length+' effects passed.');
}
verify().catch(e=>{console.error(e);process.exitCode=1;});
