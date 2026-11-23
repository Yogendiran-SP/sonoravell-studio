const path=require('node:path'), fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
class Element {
  style={setProperty(){}};dataset={};classList={
    values:new Set(),
    contains(name){return this.values.has(name);},
    toggle(name,on=!this.contains(name)){if(on)this.add(name);else this.remove(name);return on;},
    add(name){this.values.add(name);},remove(name){this.values.delete(name);}
  };
  value='';hidden=false;scrollLeft=0;scrollTop=0;clientHeight=250;clientWidth=650;
  constructor(id=''){this.id=id;this.events={};this.innerHTML='';}
  addEventListener(key,fn){this.events[key]=fn;}
  click(){return this.onclick?.({target:this});}
  setPointerCapture(){}
  closest(sel){return Object.keys(this.dataset).some(key=>sel==='[data-'+key.replace(/[A-Z]/g,char=>'-'+char.toLowerCase())+']')?this:null;}
  matches(){return false;}
  pause(){}
  contains(){return false;}
  hasAttribute(){return false;}
  setAttribute(){}
  focus(){}
  remove(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
  getBoundingClientRect(){return {top:0,left:0,bottom:25,width:400,height:400};}
  querySelector(){return new Element();}
  querySelectorAll(selector){
    if(this.id==='studio-menu'&&selector==='[data-menu]') return [...this.innerHTML.matchAll(/data-menu="(\d+)"/g)].map(([,i])=>Object.assign(new Element(),{dataset:{menu:i}}));
    return [];
  }
  get selectedOptions(){return [{textContent:'1/8'}];}
  getContext(){return {beginPath(){},moveTo(){},lineTo(){},stroke(){},fillRect(){}};}
}
const sources=path.resolve(__dirname,'../src')+path.sep, html=fs.readFileSync(sources+'index.html','utf8');
const elements=Object.fromEntries([...html.matchAll(/ id="([a-z-]+)"/g)].map(([,id])=>[id,new Element(id)]));
const get=id=>elements[id]||null;
const prefs=new Map([['sw-preferences',JSON.stringify({startup:'demo'})],['sw-keymap',JSON.stringify({'track-remove':'Delete',delete:''})]]),documentHandlers=new Map();
const document={
  getElementById:get,querySelectorAll(){return [];},querySelector(){return null;},
  addEventListener(type,handler){
    if(!documentHandlers.has(type))documentHandlers.set(type,[]);
    documentHandlers.get(type).push(handler);
  },createElement(){return new Element();},body:new Element()
};
for(const el of Object.values(elements)) el.ownerDocument=document;
document.body.append=el=>{el.ownerDocument=document;};
const context=vm.createContext({
  console,queueMicrotask,TextEncoder,TextDecoder,crypto,URL,URLSearchParams,Blob,btoa,atob,structuredClone,performance,
  document,window:{addEventListener(){},open:()=>null},navigator:{},innerWidth:1200,innerHeight:768,location:{protocol:'file:',hostname:''},
  localStorage:{getItem:k=>prefs.get(k),setItem:(k,v)=>prefs.set(k,v)},setTimeout:()=>0,clearTimeout(){},
  confirm:()=>true,prompt:()=>null,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setInterval:()=>1,clearInterval(){}
});
for(const source of ['model','arrangement','spatial','keyscheme','studio-panels','patch','patch-panel','audio','plugin-visuals','recording','formats','workflows','note-editor','settings','studio-shell','reference-video','panel-windows','midi-expression','track-icons','editor-actions','workspace-documents','workspace-views','workspace-pages','session-views']){
  vm.runInContext(fs.readFileSync(sources+source+'.js','utf8'),context,{filename:source+'.js'});
}
const app=fs.readFileSync(sources+'app.js','utf8').replace("if(prefs.startup==='restore'||prefs.startup==='start') restore();",
  'globalThis.probe={workspace:workspacePages,setTab,chooseNotes,driveClipboard,setNoteProperty,editNotes,showGlobalLane,openGlobalEntry,saveGlobalItem,trackHeight,startGesture,moveGesture,finishGesture,zoom:()=>zoom,ensureAudio,enableAudioMonitor,toggleMonitor,insertTracks,canUseSnap,changeParam,getSnap:()=>snap,selectTrack,selectedClips,editorClip,openTrackMenu,syncToolModifier,removeTracks,beginRecord,finishAudioTake,stopAction,stopRecording,midiInputStart,midiInputStop,registerAsset,seek,recorder:()=>recorder,getMedia:()=>media,command,selectMany,doAction,changeValue,openObjectMenu,applyMacroToSelection,knobNumeric,resizeDockView,position:()=>playhead,allClips,renderKeys,setKeyboard,applyBrowserItem,pluginOpen,spatialOpen,getProject:()=>p,getPreferences:()=>prefs};');
vm.runInContext(app,context,{filename:'app.js'});
const probe=context.probe;
assert.equal(document.title,'After Hours — Sonoravell Studio');
assert.doesNotMatch(html,/id="(?:dock-size|new|save|export)"/);
assert.match(get('studio-menu').innerHTML,/role="menuitem"[^>]*>File/);
assert.match(get('studio-menu').innerHTML,/>Window</);
const activateMenu=i=>get('studio-menu').events.click({target:Object.assign(new Element(),{dataset:{menu:String(i)}})});
for(let i=0;i<11;i++){
  activateMenu(i);
  assert.match(get('studio-menu-popup').innerHTML,/data-menu-command/);
}
activateMenu(1);
assert.match(get('studio-menu-popup').innerHTML,/data-menu-command="undo" disabled/);
assert.match(get('studio-menu-popup').innerHTML,/Ctrl\+Z/);
activateMenu(9);
get('studio-menu-popup').events.click({target:Object.assign(new Element(),{dataset:{menuCommand:'preferences'}})});
assert.equal(get('preferences-dialog').open,true);
assert.match(get('preferences-nav').innerHTML,/Advanced/);
const category=id=>get('preferences-nav').events.click({target:Object.assign(new Element(),{dataset:{preferenceCategory:id}})});
const page=id=>get('preferences-tabs').events.click({target:Object.assign(new Element(),{dataset:{preferencePage:id}})});
category('advanced');
assert.match(get('preferences-tabs').innerHTML,/Synchronization/);
assert.match(get('preferences-tabs').innerHTML,/Video/);
category('general');
page('appearance');
const change=(id,type,value)=>get('preferences-body').events.change({target:{
  dataset:{setting:id},type,...(type==='number'?{valueAsNumber:value}:type==='checkbox'?{checked:value}:{value})
}});
change('density','select-one','compact');
assert.equal(document.body.dataset.trackDensity,'compact');
change('trackNumbers','checkbox',true);
assert.match(get('arrange-grid').innerHTML,/track-index">1</);
assert.equal(JSON.parse(prefs.get('sw-preferences')).density,'compact');
category('locations');
assert.match(get('preferences-tabs').innerHTML,/Sound Sets/);
assert.match(get('preferences-tabs').innerHTML,/Instrument Library/);
page('files');
change('exportRate','select-one','96000');
get('preferences-dialog').close();
probe.command('session-io');
assert.equal(get('session-setup-dialog').open,true);
assert.equal(get('setup-io').hidden,false);
assert.match(get('setup-monitor').innerHTML,/Performer 1/);
get('session-setup-dialog').close();
probe.command('settings-keys');
assert.match(get('preferences-body').innerHTML,/keyscheme/);
get('preferences-dialog').close();
assert.doesNotMatch(get('arrange-grid').innerHTML,/Room Return/);
assert.match(get('inspector').innerHTML,/<h3>Input<\/h3>/);
assert.match(get('inspector').innerHTML,/<h3>Post-fader<\/h3>/);
probe.command('edit');
assert.doesNotMatch(get('dock').innerHTML,/Range start/);
probe.doAction({dataset:{action:'editor-controls'}});
assert.match(get('dock').innerHTML,/Range start/);
probe.doAction({dataset:{action:'editor-controls'}});
assert.doesNotMatch(get('dock').innerHTML,/Range start/);
assert.match(get('dock').innerHTML,/MIDI Automation/);
const fixture=probe.getProject().tracks[0].clips[0], eventElement=new Element();
eventElement.dataset.clip=fixture.id;
assert.equal(probe.openObjectMenu(eventElement,80,40,document),true);
assert.match(get('context-menu').innerHTML,/Quantize note starts/);
assert.doesNotMatch(get('context-menu').innerHTML,/Normalize/);
const eventNote=new Element();
eventNote.dataset.note=fixture.notes[0].id;
assert.equal(probe.openObjectMenu(eventNote,85,45,document),true);
assert.match(get('context-menu').innerHTML,/Quantize ends/);
probe.command('macro-organizer');
probe.doAction({dataset:{action:'macro-new'}});
probe.changeValue({dataset:{change:'macro-name'},value:'Notes at 77'});
probe.changeValue({dataset:{change:'macro-add-step'},value:'note-velocity'});
probe.changeValue({dataset:{change:'macro-value'},value:'77',closest:()=>({dataset:{macroIndex:'0'}})});
probe.doAction({dataset:{action:'macro-save'}});
const userMacro=JSON.parse(prefs.get('sw-macros'))[0];
assert.equal(userMacro.steps[0].value,77);
probe.applyMacroToSelection(userMacro);
assert.equal(probe.getProject().tracks[0].clips[0].notes[0].velocity,77/127);
probe.command('undo');
probe.doAction(Object.assign(new Element(),{dataset:{action:'expression-page',key:'expression'}}));
assert.match(get('dock').innerHTML,/Sustain pedal · CC64/);
assert.match(get('dock').innerHTML,/Reverb mix/);
assert.match(get('dock').innerHTML,/Delay feedback/);
probe.command('edit');
assert.equal(get('dock').hidden,true);
probe.command('edit');
assert.equal(get('dock').hidden,false);
probe.command('mixer');
assert.match(get('dock').innerHTML,/Console/);
assert.match(get('dock').innerHTML,/class="mixer-viewport"[^>]*role="region"/);
assert.match(get('dock').innerHTML,/class="fader-row console-fader"/);
assert.match(get('arrange-grid').innerHTML,/data-track-meter=/);
assert.match(get('dock').innerHTML,/>In<\/span>/);
assert.match(get('dock').innerHTML,/data-change="out"/);
assert.match(get('dock').innerHTML,/<strong>Inserts<\/strong>/);
assert.match(get('dock').innerHTML,/<strong>Sends<\/strong>/);
assert.match(get('dock').innerHTML,/class="console-channel-name" data-change="track-name"/);
assert.match(get('dock').innerHTML,/scroll sideways/);
assert.doesNotMatch(get('dock').innerHTML,/class="console-paging"/);
assert.match(get('dock').innerHTML,/Room Return/);
assert.match(get('dock').innerHTML,/Channel name for Master/);
assert.match(get('dock').innerHTML,/type="color" data-change="track-color"/);
assert.doesNotMatch(get('dock').innerHTML,/data-param="trim" value="undefined"/);
assert.match(get('dock').innerHTML,/Invert input polarity/);
assert.match(get('dock').innerHTML,/data-gear-kind="mix" data-gear-key="trim"/);
assert.match(get('dock').innerHTML,/data-gear-kind="mix" data-gear-key="pan"/);
assert.match(get('dock').innerHTML,/data-rack="inserts"[^>]*data-rack-open="false"/);
assert.match(get('dock').innerHTML,/<header>[^]*?data-change="console-preset"/);
const mixerFirst=probe.getProject().tracks[0];
const title={dataset:{action:'rack-toggle',rackKey:'mixer:'+mixerFirst.id+':sends'},closest:()=>null};
probe.doAction(title);
assert.match(get('dock').innerHTML,/data-rack="sends"[^>]*data-rack-open="true"/);
probe.doAction(title);
const dial={
  dataset:{gearKind:'mix',gearKey:'trim',owner:mixerFirst.id,min:'-24',max:'24',step:'.1',unit:'dB'},
  style:{setProperty(){}},setAttribute(){},ownerDocument:document,
  closest(selector){return selector==='[data-dial]'?cell:null;}
};
const dialInput={dataset:{},value:'0'};
const cell={querySelector(selector){return selector==='.rotary'?dial:dialInput;}};
probe.knobNumeric(dial,5.3,true);
assert.equal(mixerFirst.trim,5.3);
probe.command('undo');
assert.equal(probe.getProject().tracks[0].trim??0,0);
const mixerTarget=probe.getProject().tracks[1];
const owner=Object.assign(new Element(),{dataset:{track:mixerTarget.id}});
probe.changeValue({dataset:{change:'source-input'},value:'qwerty',closest:()=>owner});
probe.doAction({dataset:{action:'track-icon'},closest:()=>owner});
assert.match(get('track-icon-options').innerHTML,/Grand piano/);
probe.doAction({dataset:{action:'track-icon-set',key:'grand'},closest:()=>null});
assert.equal(mixerTarget.icon,'grand');
assert.equal(mixerTarget.sourceInput,'qwerty');
probe.changeValue({dataset:{change:'track-name'},value:'Bass DI',closest:()=>owner});
probe.changeValue({dataset:{change:'track-color'},type:'color',value:'#123abc',closest:()=>owner});
assert.equal(mixerTarget.name,'Bass DI');
assert.equal(mixerTarget.color,'#123abc');
const bus=probe.getProject().tracks.find(track=>track.type==='bus');
probe.changeValue({dataset:{change:'out'},value:bus.id,closest:()=>owner});
assert.equal(mixerTarget.out,bus.id);
probe.changeValue({dataset:{change:'add-fx'},value:'Parametric EQ',closest:()=>owner});
const oldInsert=mixerTarget.fx.at(-1).id;
probe.changeValue({dataset:{change:'console-preset'},value:'factory:Vocal space',closest:()=>owner});
assert.deepEqual(Array.from(mixerTarget.fx,entry=>entry.type),['Echo','Room Reverb']);
assert.ok(!mixerTarget.fx.some(entry=>entry.id===oldInsert));
context.prompt=()=> 'Keys Space';
probe.doAction({dataset:{action:'console-preset-save'},closest:()=>owner});
assert.equal(JSON.parse(prefs.get('sw-console-presets'))[0].chain.length,2);
assert.match(get('dock').innerHTML,/Keys Space · User/);
context.prompt=()=>null;
probe.command('undo');
assert.equal(probe.getProject().tracks.find(track=>track.id===mixerTarget.id).fx.at(-1).id,oldInsert);
assert(!html.includes('data-tab="browser"'));
assert(html.indexOf('class="transport transport-bottom"')>html.indexOf('</main>'));
assert.equal(get('browser-edge').hidden,false);
get('toggle-browser').click();
assert.match(get('browser-content').innerHTML,/Parametric EQ/);
assert.equal(get('browser-workspace').hidden,false);
assert.match(get('dock').innerHTML,/Console/);
assert.equal(get('browser-edge').hidden,true);
get('browser-hide').click();
assert.equal(get('browser-workspace').hidden,true);
assert.equal(get('browser-edge').hidden,false);
probe.command('browser');
assert.equal(get('browser-workspace').hidden,false);
probe.command('browser');
assert.equal(get('browser-workspace').hidden,true);
assert.equal(get('loop-start').value,'001.1.000');
get('loop-start').value='002.2.480';
get('loop-start').events.change();
assert.equal(probe.getProject().loopStart,5.5);
get('loop-end').value='bad';
get('loop-end').events.change();
assert.equal(get('loop-end').value,'005.1.000');
get('back-bar').click();
assert.equal(probe.position(),0);
get('forward-bar').click();
assert.equal(probe.position(),4);
probe.command('automation');
assert.match(get('dock').innerHTML,/ data-back="141"/);
get('lower-workspace').classList.add('panel-maximized');
get('dock').clientWidth=1700;
get('dock').clientHeight=630;
probe.resizeDockView();
assert.match(get('dock').innerHTML,/height="581"/);
get('lower-workspace').classList.remove('panel-maximized');
probe.resizeDockView();
assert.match(get('dock').innerHTML,/height="158"/);
probe.command('mixer');
assert.match(get('dock').innerHTML,/Console/);
probe.applyBrowserItem('effects','Parametric EQ',probe.getProject().tracks[0]);
assert.equal(probe.getProject().tracks[0].fx.at(-1).type,'Parametric EQ');
const t=probe.getProject().tracks[0];
probe.pluginOpen(t,t.fx.at(-1));
assert.match(get('plugin-body').innerHTML,/class="rotary"/);
assert.match(get('plugin-body').innerHTML,/precise value/);
assert.match(get('plugin-body').innerHTML,/face-dial/);
assert.match(get('plugin-body').innerHTML,/Precision dial controls/);
get('plugin-dialog').close();
probe.spatialOpen(t);
assert.match(get('spatial-body').innerHTML,/TFR/);
get('spatial-dialog').close();
probe.command('routing');
assert.match(get('dock').innerHTML,/Signal flow/);
assert.match(get('dock').innerHTML,/Room Return/);
assert.match(get('dock').innerHTML,/patch-port/);
assert.match(get('dock').innerHTML,/patch-preview|patch-ghost/);
probe.setKeyboard(true);
assert.equal(get('qwerty-panel').hidden,false);
assert.match(get('key-pads').innerHTML,/C4 \(A\)/);
probe.selectMany(probe.allClips().slice(0,2));
probe.command('mute-event');
assert.equal(probe.allClips()[0].c.muted,true);
assert.equal(probe.allClips()[1].c.muted,true);
get('export-range').value='song';
probe.command('export');
assert.equal(get('export-dialog').open,true);
assert.equal(get('export-format').value,'wav');
assert.equal(get('export-rate').value,'96000');
assert.match(get('export-output').innerHTML,/Room Return/);
async function verifyDisplayModes(){
  get('export-dialog').close();
  const panel=get('lower-workspace'), browser=get('browser-workspace');
  document.exitFullscreen=async()=>{document.fullscreenElement=null;};
  for(const el of [panel,browser])el.requestFullscreen=async()=>{document.fullscreenElement=el;};
  probe.setTab('mixer');
  const grip=get('dock-resize');
  const pointer=(type,clientY)=>grip.events[type]({button:0,clientY,pointerId:1,preventDefault(){}});
  pointer('pointerdown',480);pointer('pointermove',420);pointer('lostpointercapture',420);
  assert.ok(document.body.classList.contains('dock-custom'));
  await get('dock-full').click();
  assert.equal(document.fullscreenElement,panel);
  probe.command('mixer');
  assert.equal(document.fullscreenElement,null);
  assert.equal(get('dock').hidden,true);
  probe.command('mixer');
  await Promise.resolve();await Promise.resolve();
  assert.equal(get('dock').hidden,false);
  assert.equal(document.fullscreenElement,panel);
  assert.ok(document.body.classList.contains('dock-custom'));
  probe.command('edit');
  await Promise.resolve();await Promise.resolve();
  assert.equal(document.fullscreenElement,null);
  assert.equal(document.body.classList.contains('dock-custom'),false);
  probe.command('mixer');
  await Promise.resolve();await Promise.resolve();
  assert.equal(document.fullscreenElement,panel);
  await get('dock-full').click();
  await get('toggle-browser').click();
  await get('browser-full').click();
  assert.equal(document.fullscreenElement,browser);
  get('browser-hide').click();
  assert.equal(document.fullscreenElement,null);
  get('toggle-browser').click();
  await Promise.resolve();await Promise.resolve();
  assert.equal(document.fullscreenElement,browser);
  console.log('Mixer knobs, routing, responsive views, and per-view fullscreen and dock size restoration passed using DOM test doubles.');
}
async function verifyTrackEditingAndRecording(){
  const T=context.SW, project=probe.getProject(), instrument=project.tracks[1];
  await document.exitFullscreen();
  probe.setTab('edit');
  probe.seek(0);
  probe.selectTrack(instrument.id);
  assert.match(get('dock').innerHTML,/data-roll/);
  assert.equal(probe.selectedClips().length,0);
  assert.equal(probe.editorClip(),instrument.clips[0]);
  probe.syncToolModifier({ctrlKey:true});
  assert.ok(get('arrange-grid').classList.contains('ctrl-tool'));
  probe.syncToolModifier({ctrlKey:false});
  assert.ok(!get('arrange-grid').classList.contains('ctrl-tool'));

  const audio=T.channel('Test microphone','audio',6);
  audio.inputDevice='';
  project.tracks.push(audio);
  T.validateProject(project);
  probe.selectTrack(audio.id);
  assert.match(get('dock').innerHTML,/no audio events/);
  const audioContext={sampleRate:48000,state:'running',currentTime:0,resume:async()=>{}};
  T.audioContext=()=>audioContext;
  T.buildGraph=()=>({stop(){},tracks:new Map(),cueMeters:new Map()});
  T.schedule=()=>{};
  let stopped=0, closed=0, when;
  const track={stop(){stopped++;},getSettings:()=>({channelCount:1}),addEventListener(){}};
  const device={getAudioTracks:()=>[track],getTracks:()=>[track]};
  const samples=new Float32Array(4800).fill(.37);
  const buffer={sampleRate:48000,numberOfChannels:1,length:4800,duration:.1,getChannelData:()=>samples};
  T.captureInput=async()=>({start(at){when=at;},stop:async()=>buffer,close(){closed++;}});
  let allowInput;
  context.navigator.mediaDevices={getUserMedia:()=>new Promise(resolve=>{allowInput=resolve;})};
  const cancelled=probe.beginRecord();
  while(!allowInput)await Promise.resolve();
  probe.stopAction();
  allowInput(device);
  await cancelled;
  assert.equal(stopped,1);
  assert.equal(probe.recorder(),undefined);
  assert.equal(audio.clips.length,0);

  context.navigator.mediaDevices.getUserMedia=async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});};
  await assert.rejects(probe.beginRecord(),/permission was denied/);
  assert.equal(get('audio-state').textContent,'48000 Hz · Idle');

  context.navigator.mediaDevices.getUserMedia=async()=>device;
  probe.seek(3);
  await probe.beginRecord();
  assert.equal(when,.06);
  assert.equal(probe.recorder().id,audio.id);
  audioContext.currentTime=.18;
  await probe.finishAudioTake(probe.recorder());
  assert.equal(stopped,2);
  assert.equal(closed,1);
  assert.equal(audio.clips[0].start,3);
  assert.equal(audio.clips[0].sourceBpm,project.bpm);
  assert.match(get('dock').innerHTML,/Audio waveform/);
  probe.selectTrack(instrument.id);
  probe.selectTrack(audio.id);
  assert.equal(probe.selectedClips().length,0);
  assert.equal(probe.editorClip(),audio.clips[0]);
  assert.match(get('arrange-grid').innerHTML,/data-fade-handle="fadeIn"/);
  probe.changeValue({dataset:{change:'wave-fadeIn'},value:'35',type:'number',closest:()=>null});
  probe.changeValue({dataset:{change:'wave-fadeInShape'},value:'power',closest:()=>null});
  assert.ok(audio.clips[0].fadeIn>0);
  const decoded=T.decodeProject(T.encodeProject(project,probe.getMedia()));
  const reopened=decoded.p.tracks.find(t=>t.id===audio.id).clips[0];
  assert.equal(reopened.fadeInShape,'power');
  assert.match(Buffer.from(decoded.raw.get(reopened.asset)).toString('ascii',0,4),/RIFF/);

  probe.openTrackMenu({dataset:{track:audio.id}},75,60,document);
  assert.match(get('context-menu').innerHTML,/context-icon/);
  assert.match(get('context-menu').innerHTML,/Choose recording input/);
  probe.selectTrack(instrument.id,true,true);
  assert.equal(probe.selectedClips().length,0);
  probe.removeTracks(instrument,true);
  assert.ok(!probe.getProject().tracks.some(t=>t.id===audio.id||t.id===instrument.id));
  probe.command('undo');
  assert.ok(probe.getProject().tracks.some(t=>t.id===audio.id));
  const restored=probe.getProject().tracks.find(t=>t.id===instrument.id);
  probe.selectTrack(restored.id);
  probe.doAction({dataset:{action:'arm'},closest:()=>null});
  const before=restored.clips.length;
  audioContext.currentTime=1;
  await probe.beginRecord();
  audioContext.currentTime=1.12;
  probe.midiInputStart('KeyA',60,.75);
  audioContext.currentTime=1.25;
  probe.midiInputStop('KeyA');
  probe.stopRecording();
  assert.equal(restored.clips.length,before+1);
  assert.equal(restored.clips.at(-1).notes[0].pitch,60);
  console.log('Track selection, modifier cursor, waveform fades, undoable track deletion, cancellation, and Audio/MIDI take persistence passed.');
}
function press(target,key,flags={}){
  const event={target,key,code:key.length===1?'Key'+key.toUpperCase():key,...flags,preventDefault(){this.defaultPrevented=true;}};
  for(const handler of documentHandlers.get('keydown'))handler(event);
  return event;
}
async function verifyStudioControls(){
  const T=context.SW, base=probe.getProject(), bus=base.tracks.find(t=>t.type==='bus');
  const spec={name:'Vocal',type:'audio',count:2,autoColor:false,color:'#3388ff',format:'2',source:'all',
    output:bus?.id||'master',instrument:'Keys',device:'microphone',deviceLabel:'My mic',group:false};
  get('insert-track').click();
  assert.ok(get('track-insert-dialog').open);
  assert.equal(get('insert-type').value,'audio');
  get('insert-type').value='folder';get('insert-type').onchange();
  assert.equal(get('insert-format-row').hidden,true);
  get('insert-cancel').click();
  const [audio,other]=probe.insertTracks(spec);
  assert.equal(audio.recordChannels,2);
  assert.equal(audio.out,spec.output);
  assert.equal(audio.inputDevice,'microphone');
  assert.equal(other.name,'Vocal 2');
  assert.equal(audio.color,'#3388ff');
  const [folder]=probe.insertTracks({...spec,name:'Vocals',type:'folder',count:1,group:true});
  assert.equal(audio.folder,folder.id);
  assert.equal(other.folder,folder.id);
  T.validateProject(base);
  const [midi]=probe.insertTracks({...spec,name:'Synth',type:'midi',count:1,instrument:'Pad',device:''});
  T.addEffect(midi,T.effect('Echo'));
  const retainedId=midi.id;
  probe.setKeyboard(true);
  probe.selectTrack(midi.id);
  assert.equal(press(get('arrange-grid'),'T',{shiftKey:true}).defaultPrevented,true);
  assert.equal(midi.instrumentOnly,true);
  assert.equal(midi.fx[0].type,'Echo');
  assert.ok(!T.timelineTracks(base).includes(midi));
  assert.match(T.encodeProject(base,probe.getMedia()),/instrumentOnly/);
  const [restored]=probe.insertTracks({...spec,name:'Reused',type:'midi',count:1,instrument:'retained:'+retainedId});
  assert.equal(restored.id,retainedId);
  assert.equal(restored.instrumentOnly,undefined);
  assert.equal(restored.instrument,'Pad');

  const trackHeader=new Element();
  trackHeader.dataset.track=restored.id;
  trackHeader.ownerDocument=document;
  trackHeader.closest=sel=>sel.includes('.track-head')?trackHeader:null;
  press(trackHeader,'Delete');
  assert.equal(T.findTrack(base,retainedId),restored);
  press(trackHeader,'T',{shiftKey:true,altKey:true});
  assert.equal(T.findTrack(base,retainedId),undefined);

  assert.equal(probe.getSnap(),.5);
  press(get('arrange-grid'),'n');
  assert.equal(probe.getSnap(),0);
  const field=new Element();
  field.matches=sel=>sel.includes('input');
  press(field,'n');
  assert.equal(probe.getSnap(),0);
  press(get('arrange-grid'),'n');
  assert.equal(probe.getSnap(),.5);
  probe.selectTrack(audio.id);
  probe.changeParam({dataset:{owner:audio.id,param:'volume'},value:'-3.2'},true);
  assert.match(get('status').textContent,/Vocal 1 ·.*-3.2 dB/);

  let requested=0,stopped=0,connections=0,disconnections=0;
  const node={connect(){connections++;},disconnect(){disconnections++;}};
  T.buildGraph=()=>({stop(){},tracks:new Map([[audio.id,{source:{}}]]),cueMeters:new Map()});
  // The active context is the recording fixture. Configure its monitor source.
  const ctx=await probe.ensureAudio();
  ctx.createMediaStreamSource=()=>node;
  const input={stop(){stopped++;},addEventListener(){},getSettings(){return {channelCount:2};}};
  const stream={getTracks:()=>[input],getAudioTracks:()=>[input]};
  context.navigator.mediaDevices.getUserMedia=async ({audio})=>{
    requested++;assert.equal(audio.deviceId.exact,'microphone');assert.equal(audio.channelCount.ideal,2);return stream;
  };
  await probe.enableAudioMonitor(audio);
  assert.equal(requested,1);
  assert.equal(connections,1);
  assert.match(get('status').textContent,/Listening to Vocal 1/);
  probe.stopAction();
  assert.equal(stopped,0,'Stop keeps the explicitly enabled input available');
  probe.toggleMonitor(audio);
  assert.equal(stopped,1);
  assert.equal(disconnections,1);
  assert.match(get('status').textContent,/monitoring off/i);
  T.validateProject(base);
  console.log('Insert Track form, batch routing, retained instruments, scoped deletion and snap, values, and idle audio monitoring passed.');
}
function verifyTimelineControls(){
  const T=context.SW, grid=get('arrange-grid');
  assert.doesNotMatch(html,/id="import"/);
  assert.match(html,/id="import-files"/);
  assert.match(grid.innerHTML,/class="track-volume"/);
  assert.match(grid.innerHTML,/data-loop-handle="left"/);
  assert.match(grid.innerHTML,/data-loop-handle="right"/);
  const before=probe.trackHeight();
  press(grid,'=',{altKey:true});
  assert.equal(probe.trackHeight(),before+12);
  press(grid,'-',{altKey:true});
  assert.equal(probe.trackHeight(),before);

  get('global-tracks').click();
  assert.match(get('context-menu').innerHTML,/Global tracks/);
  assert.match(get('context-menu').innerHTML,/global-show-lyrics/);
  probe.doAction({dataset:{action:'global-show-lyrics'}});
  assert.match(grid.innerHTML,/data-global-lane="lyrics"/);
  probe.openGlobalEntry('lyrics',4);
  get('global-entry-lyrics').value='And we sing together';
  get('global-entry-length').value='4';
  get('global-entry-form').events.submit({preventDefault(){}});
  assert.equal(get('global-entry-dialog').open,false);
  assert.match(grid.innerHTML,/And we sing together/);
  const lyric=probe.getProject().globalTracks.lyrics[0];
  assert.equal(lyric.at,4);
  assert.equal(lyric.length,4);
  assert.equal(T.decodeProject(T.encodeProject(probe.getProject(),probe.getMedia())).p.globalTracks.lyrics[0].name,lyric.name);
  probe.doAction({dataset:{action:'global-show-lyrics'}});
  assert.doesNotMatch(grid.innerHTML,/And we sing together/);
  probe.doAction({dataset:{action:'global-show-lyrics'}});
  assert.match(grid.innerHTML,/And we sing together/);
  const lyricNode=Object.assign(new Element(),{dataset:{globalKind:'lyrics',globalId:lyric.id}});
  lyricNode.closest=sel=>sel.includes('[data-global-id]')?lyricNode:null;
  press(lyricNode,'Delete');
  assert.equal(probe.getProject().globalTracks.lyrics.length,0);
  probe.command('undo');
  assert.equal(probe.getProject().globalTracks.lyrics[0].id,lyric.id);

  const marker=probe.saveGlobalItem('markers',{at:6,name:'Delete me'});
  const markerNode=Object.assign(new Element(),{dataset:{globalKind:'markers',globalId:marker.id}});
  for(const handler of documentHandlers.get('focusin'))handler({target:markerNode});
  const tracks=probe.getProject().tracks.length;
  press(document.body,'Delete');
  assert.ok(!probe.getProject().markers.some(entry=>entry.id===marker.id),'Delete targets the selected marker after focus loss');
  assert.equal(probe.getProject().tracks.length,tracks,'an imported track binding cannot take over Delete');
  probe.command('undo');
  assert.ok(probe.getProject().markers.some(entry=>entry.id===marker.id));

  const p=probe.getProject(), initial=p.loopEnd, surface=new Element();
  surface.closest=sel=>sel==='[data-loop-editor]'?surface:null;
  const down={target:surface,button:0,clientX:4*probe.zoom(),clientY:8,pointerId:7,preventDefault(){}};
  const up={...down,clientX:12*probe.zoom(),type:'pointerup'};
  probe.startGesture(down);probe.moveGesture(up);probe.finishGesture(up);
  assert.equal(p.loopStart,4);
  assert.equal(p.loopEnd,12);
  assert.equal(p.loop,true);
  assert.equal(get('loop-start').value,T.locatorText(4,p.meter));
  assert.equal(get('loop-end').value,T.locatorText(12,p.meter));
  const right=Object.assign(new Element(),{dataset:{loopHandle:'right'}});
  press(right,'ArrowRight');
  assert.equal(p.loopEnd,12.5);
  probe.command('undo');assert.equal(probe.getProject().loopEnd,12);
  probe.command('undo');assert.equal(probe.getProject().loopEnd,initial);
  console.log('Global track entry, visibility, persistence and deletion, loop drag and locators, volume control, and vertical zoom passed.');
}
function verifyPianoEditorAndClipboard(){
  const T=context.SW, p=probe.getProject(), t=p.tracks.find(t=>t.type==='midi'&&t.clips.length);
  probe.selectTrack(t.id);
  probe.setTab('edit');
  probe.doAction({dataset:{action:'expression-page',key:'notes'},closest:()=>null});
  const c=probe.editorClip(), before=c.notes.length;
  assert.match(get('dock').innerHTML,/Piano roll tools/);
  assert.match(get('dock').innerHTML,/Piano roll velocity lane/);
  assert.match(html,/Insert Track<\/button>/);
  assert.match(html,/Global Tracks<\/button>/);
  const roll=new Element();
  roll.closest=selector=>selector.includes('[data-roll]')?roll:null;
  const first=c.notes[0];
  probe.chooseNotes([first.id]);probe.setNoteProperty('velocity','101');
  assert.equal(first.velocity,101/127);
  probe.chooseNotes(c.notes.slice(0,2).map(n=>n.id));
  const notes=c.notes.slice(0,2).map(n=>({...n}));
  press(roll,'c',{ctrlKey:true});
  assert.match(get('status').textContent,/Copied 2 note/);
  press(roll,'x',{ctrlKey:true});assert.equal(c.notes.length,before-2);
  probe.seek(c.start+.5);
  press(roll,'v',{ctrlKey:true});assert.equal(c.notes.length,before);
  assert.equal(c.notes.at(-1).pitch,notes.at(-1).pitch);
  assert.equal(c.notes.at(-1).start-c.notes.at(-2).start,notes.at(-1).start-notes.at(-2).start);
  assert.equal(c.notes.at(-2).start,.5);
  assert.notEqual(c.notes.at(-2).id,notes[0].id);
  const pasted=c.notes.at(-2);
  const pitch=pasted.pitch;
  press(roll,'ArrowUp',{shiftKey:true});
  assert.equal(c.notes.find(n=>n.id===pasted.id).pitch,pitch+12);
  probe.chooseNotes(c.notes.slice(-2).map(n=>n.id));press(roll,'d',{ctrlKey:true});assert.equal(c.notes.length,before+2);

  const textField=new Element();textField.matches=sel=>sel.includes('textarea');
  assert.notEqual(press(textField,'x',{ctrlKey:true}).defaultPrevented,true);
  const ids=c.notes.map(n=>n.id);
  c.locked=true;
  press(roll,'x',{ctrlKey:true});
  assert.deepEqual([...c.notes.map(n=>n.id)],[...ids]);
  c.locked=false;

  const clipCount=t.clips.length;
  probe.selectMany([{t,c}]);
  const mainView=new Element();
  mainView.closest=sel=>sel.includes('.arrange-frame')?mainView:null;
  press(mainView,'c',{ctrlKey:true});
  press(mainView,'v',{ctrlKey:true});
  assert.equal(t.clips.length,clipCount+1);
  assert.match(get('status').textContent,/Pasted events/);
  assert.equal(c.notes.length,before+2);

  const insert=T.effect('Echo');
  T.addEffect(t,insert);
  probe.driveClipboard('cut',{kind:'insert',track:t.id,id:insert.id});
  assert.ok(!t.fx.some(e=>e.id===insert.id));
  probe.driveClipboard('paste',{kind:'insert',track:t.id});
  assert.equal(t.fx.at(-1).type,insert.type);
  assert.notEqual(t.fx.at(-1).id,insert.id);

  t.lanes.pan=[{at:0,value:.4}];
  probe.driveClipboard('cut',{kind:'automation',track:t.id,lane:'pan',at:0});
  probe.seek(1);
  probe.driveClipboard('paste',{kind:'automation',track:t.id,lane:'pan'});
  assert.equal(t.lanes.pan[0].at,1);
  assert.equal(t.lanes.pan[0].value,.4);

  const active=probe.editorClip();
  T.setExpression(active,'bend',0,500);
  probe.driveClipboard('cut',{kind:'expression',clip:active.id,lane:'bend',at:0});
  probe.driveClipboard('paste-original',{kind:'expression',clip:active.id,lane:'bend'});
  assert.equal(active.expression.bend[0].value,500);
  T.validateProject(p);
  console.log('Piano properties and selection shortcuts, scoped note and event clipboards, inserts, automation, and MIDI controller points passed.');
}
async function verifyWorkspaceViews(){
  const original=probe.getProject(), root=get('workspace-content');
  const title=document.title;
  assert.equal(probe.workspace.switchPage('start'),true);
  assert.match(root.innerHTML,/Recent Files/);
  assert.match(root.innerHTML,/Create|Record and Mix/);
  assert.equal(document.title,'Start — Sonoravell Studio');
  probe.command('show-mastering');
  assert.match(root.innerHTML,/Track Column/);
  assert.match(root.innerHTML,/Digital Release/);
  assert.equal(probe.getProject(),original,'Mastering must keep the Session open');
  probe.command('show-live');
  assert.match(root.innerHTML,/Setlist Inspector/);
  assert.match(root.innerHTML,/Performance View/);
  assert.equal(probe.getProject(),original,'Show must keep the Session open');
  probe.command('quick-switch');
  assert.equal(get('workspace-switch').open,true);
  assert.match(get('workspace-switch-list').innerHTML,/Untitled Mastering Project/);
  get('workspace-switch-close').click();
  probe.command('show-session');
  assert.equal(document.title,title);
  assert.equal(root.hidden,true);
  probe.command('launcher-view');
  assert.match(get('session-view-body').innerHTML,/Launch/);
  assert.equal(probe.getProject().launcher.scenes.length,8);
  get('session-view-close').click();
  for(const [command,markup] of [['scratch-view',/Scratch Pad/],['score-view',/Select an Instrument Part|clef/],
    ['patterns-view',/Select an Instrument Track|Insert Pattern/],['lyrics-view',/Add lyric|session-lyrics/],
    ['monitor-view',/Audio engine/],['channel-view',/Input Trim/]]){
    probe.command(command);
    assert.match(get('session-view-body').innerHTML,markup,command);
    get('session-view-close').click();
  }
  press(document.body,'n',{ctrlKey:true});
  assert.equal(get('workspace-new').open,true);
  get('workspace-new-name').value='Regression session';
  get('workspace-new-form').events.submit({preventDefault(){}});
  await Promise.resolve();
  assert.equal(probe.getProject().name,'Regression session');
  assert.equal(probe.getProject().tracks.length,0);
  assert.notEqual(probe.getProject(),original);
  probe.command('quick-switch');
  assert.ok(get('workspace-switch-list').innerHTML.includes(original.name));
  get('workspace-switch-close').click();
  console.log('Four workspace pages, New Document, Quick Switch, and seven Session companion views passed using DOM test doubles.');
}
verifyDisplayModes().then(verifyTrackEditingAndRecording).then(verifyStudioControls).then(verifyTimelineControls)
  .then(verifyPianoEditorAndClipboard).then(verifyWorkspaceViews).catch(error=>{console.error(error);process.exitCode=1;});
