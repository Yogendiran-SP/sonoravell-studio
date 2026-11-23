'use strict';
(() => {
  const {clamp,clone,uid,project,demo,channel,clip,note,effect,fx,instruments,noteName,songEnd,seconds,quantize,splitClip,laneSpecs,laneValue,setLaneValue,validRoute}=SW;
  const $=id=>document.getElementById(id)||panels.get(id);
  const sharedContext=document.getElementById('context-menu');
  const all=selector=>[...document.querySelectorAll(selector),...panels.query(selector)];
  const find=selector=>document.querySelector(selector)||panels.query(selector)[0];
  const esc=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=(n,d=2)=>Number(n.toFixed(d)).toString();
  const option=(value,text,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(text)+'</option>';
  const button=(action,label,title=label,extra='')=>'<button type="button" data-action="'+action+'" title="'+esc(title)+'" '+extra+'>'+esc(label)+'</button>';
  const select=(key,label,options)=>'<label>'+label+'<select data-change="'+key+'" aria-label="'+esc(label)+'">'+options+'</select></label>';
  const field=(key,label,value,min,max,step=.01)=>{
    const numeric=min!==undefined;
    return '<label>'+label+'<input aria-label="'+esc(label)+'" data-change="'+key+'" type="'+(numeric?'number':'text')+'" value="'+esc(value)+'" '+(numeric?'min="'+min+'" max="'+max+'" step="'+step+'"':'maxlength="120"')+'></label>';
  };
  let prefs=SW.preferences(readSettings('sw-preferences',{}));
  const blankSession=()=>({...project(),bpm:prefs.newTempo,meter:prefs.newMeter,loopEnd:prefs.newMeter*4});
  let workspacePages=null, sessionViews=null;
  let p=prefs.startup==='blank'?blankSession():demo(), media=new Map(), trackId=p.tracks[0]?.id||'master', clipId=p.tracks[0]?.clips[0]?.id||null, noteId=null, tab=prefs.initialPanel==='browser'?'mixer':prefs.initialPanel, autoKey='volume';
  let dockOpen=true,browserOpen=prefs.initialPanel==='browser',dockHeight=0,browserWidth=360;
  let playhead=0, zoom=prefs.defaultZoom, snap=prefs.defaultSnap==='bar'?'bar':Number(prefs.defaultSnap), ctx, live, recorder, pendingRecord=null, armed=new Set(), monitoring=new Set(), sampleTarget, lastSave, saveTimer, busy=false, revision=0;
  let midiAccess, inputTarget=null, rollChanged=true, rollTop=83, panelCollapsed=false, isDirty=false, history=[], redo=[], gesture, previewGraph, previewTimer;
  const heldMidi=new Map(), hardwareControls=new Map(), pedalVoices=new Map();
  let midiTake=null, finishingRecord=false, writeTick=0, currentOverride=new Map();
  let updatedSave=Promise.resolve(), dbPromise;
  const frames=new Float32Array(256);
  const audioMonitors=new Map(), mutedMidiMonitors=new Set();
  let monitorGraph=null, monitorFrame=0;
  let pickedTracks=new Set([trackId]),picked=new Set(),notePicked=new Set(),editRange=null,editTool='arrow',gridMode='straight',quantizeStrength=100,sceneId='';
  let multiClipboard=[], mixerWide=prefs.defaultWide,mixerDevices=prefs.defaultDevices, mixerFilter='all', showHidden=false, mixerPeak=new Map();
  let qwerty=prefs.keyboardOn,qOctave=prefs.octave,qVelocity=prefs.velocity;
  const keyboardHeld=new Map();
  const toolsList={arrow:'Arrow',range:'Range',split:'Split',erase:'Erase',draw:'Draw',mute:'Mute',bend:'Stretch',listen:'Listen'};
  const isEditing=()=>busy||pendingRecord||recorder||midiTake;
  const currentTrack=()=>SW.findTrack(p,trackId)||p.master;
  const foundClip=(id=clipId)=>p.tracks.flatMap(t=>t.clips.map(c=>({t,c}))).find(row=>row.c.id===id);
  const activeClip=()=>foundClip()?.c;
  let editorPart=null;
  function editorRow(){
    const t=currentTrack(), selected=foundClip();
    if(selected?.t===t)return selected;
    const previous=t.clips.find(c=>c.id===editorPart);
    const c=previous||t.clips.find(c=>c.start<=playhead&&playhead<c.start+c.length)||
      t.clips.reduce((first,c)=>!first||c.start<first.start?c:first,null);
    return c?{t,c}:null;
  }
  const editorClip=()=>editorRow()?.c;
  const globalKinds=SW.globalTrackKinds;
  const visibleGlobals=new Set([].concat(readSettings('sw-global-tracks',['markers'])).filter(kind=>Object.hasOwn(globalKinds,kind)));
  let globalEditor=null, globalContext=null;
  let verticalZoom=clamp(Number(readSettings('sw-track-zoom',0))||0,-90,140), mixerScroll=0;
  const trackHeight=()=>clamp(({compact:57,tall:100}[prefs.density]||68)+verticalZoom,44,190);
  const globalEnd=()=>Object.keys(globalKinds).reduce((end,kind)=>SW.globalEntries(p,kind).reduce((last,item)=>
    Math.max(last,item.at+(item.length||0)+1),end),0);
  const total=()=>Math.min(100000,Math.ceil(Math.max(8*p.meter,songEnd(p)+2,p.loopEnd+1,playhead+1,globalEnd())/p.meter)*p.meter);
  const step=()=>snap==='bar'?p.meter:snap*SW.gridModes[gridMode];
  const sn=n=>quantize(n,step());
  const status=(value,error=false)=>{$('status').textContent=value;$('status').classList.toggle('error',error);};
  const report=e=>{
    const message=e.message||String(e);
    status(message,true);
    if($('preferences-dialog')?.open) $('preferences-save').textContent=message;
    console.warn(e);
  };
  const run=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(report);
  const round=n=>Number(n.toFixed(7));
  function valueStatus(owner,label,value,unit=''){
    const reading=typeof value==='number'?fmt(value,4):String(value);
    return (owner?owner+' · ':'')+label+' '+reading+(unit?' '+unit:'');
  }
  const typeLabel=t=>({folder:'Folder',midi:'Instrument',audio:'Audio',bus:'Bus',master:'Output'}[t.type]);
  function download(content,name,type='application/octet-stream'){
    const url=URL.createObjectURL(content instanceof Blob?content:new Blob([content],{type}));
    const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  function database(){
    if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB){reject(Error('Browser storage is unavailable.'));return;}
      const request=indexedDB.open('soundweave-studio',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    return dbPromise;
  }
  async function saveLocal(){
    const db=await database(), version=revision, snapshot=clone(p);
    const data=new Map(Object.keys(snapshot.assets).filter(id=>media.has(id)).map(id=>[id,media.get(id).bytes]));
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('workspace','readwrite');
      const store=tx.objectStore('workspace');
      store.put({snapshot,data,id:workspacePages.sessionId()},'session');
      store.put({snapshot,data},'document:'+workspacePages.sessionId());
      tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);
    });
    if(revision===version){lastSave=version;$('save-state').textContent='Autosaved locally';}
  }
  function autosave(){
    clearTimeout(saveTimer);
    if(!prefs.autosave){$('save-state').textContent='Autosave off';return;}
    $('save-state').textContent='Saving locally…';
    saveTimer=setTimeout(()=>{
      updatedSave=updatedSave.catch(()=>{}).then(saveLocal).catch(()=>{$('save-state').textContent='Autosave unavailable · use Save';});
    },prefs.autosaveDelay*1000);
  }
  function before(){return clone(p);}
  function commit(previous, message, restart=true){
    if(previous){
      history.push(previous);if(history.length>65) history.shift();
      redo=[];
    }
    for(const id of audioMonitors.keys())if(channelById(id)?.type!=='audio')releaseAudioMonitor(id);
    if(restart){
      if(live&&!recorder&&!midiTake)rebuildPlayback();
      else if(!live)syncAudioMonitors(true);
    }
    revision++;isDirty=true;
    workspacePages?.sessionChanged();
    autosave();render();
    if(message) status(message);
  }
  function edit(fn,message,restart=true){
    const previous=before();
    fn();
    commit(previous,message,restart);
  }
  function undoEdit(reverse=false){
    if(recorder||pendingRecord||midiTake||busy) return;
    const source=reverse?redo:history, target=reverse?history:redo;
    if(!source.length) return;
    target.push(before());p=source.pop();
    cleanSelection();commit(null,reverse?'Redid edit':'Undid edit');
  }
  function cleanSelection(){
    if(trackId!=='master'&&!p.tracks.some(t=>t.id===trackId)) trackId=p.tracks[0]?.id||'master';
    if(!foundClip()) clipId=null;
    picked=new Set([...picked].filter(id=>foundClip(id)));
    pickedTracks=new Set([...pickedTracks].filter(id=>SW.findTrack(p,id)));
    if(noteId||notePicked.size){
      const ids=new Set((editorClip()?.notes||[]).map(n=>n.id));
      if(!ids.has(noteId))noteId=null;
      notePicked=new Set([...notePicked].filter(id=>ids.has(id)));
    }
    if(!pickedTracks.size)pickedTracks.add(trackId);
    armed=new Set([...armed].filter(id=>p.tracks.some(t=>t.id===id&&['audio','midi'].includes(t.type))));
    monitoring=new Set([...monitoring].filter(id=>p.tracks.some(t=>t.id===id&&t.type==='audio')));
  }
  async function swap(next,raw=new Map(),message,canSwap=()=>true){
    const loaded=new Map();
    if(raw.size){
      const context=ctx||(ctx=SW.audioContext());
      for(const [id,bytes] of raw){
        const buffer=await context.decodeAudioData(bytes.slice(0));
        const mismatch=Math.abs(next.assets[id].duration-buffer.duration);
        if(mismatch>.05) throw Error('Embedded audio duration differs from the saved session.');
        loaded.set(id,{bytes,buffer});
      }
    }
    if(!canSwap()) return;
    replaceSession(next,loaded,message);
  }
  function replaceSession(next,loaded,message){
    closeAudioMonitors();mutedMidiMonitors.clear();stopPlayback(false);stopPreview();reference.clear();releaseKeyboard();
    mixerScroll=0;globalEditor=null;globalContext=null;
    const view=$('dock').querySelector('.mixer-viewport');
    if(view)view.scrollLeft=0;
    multiClipboard=[];noteClipboard=[];focusedClipboard.clear();editorFocus=null;pickedTracks.clear();picked.clear();notePicked.clear();mixerPeak.clear();editRange=null;editorPart=null;p=next;media=loaded;history=[];redo=[];armed.clear();monitoring.clear();playhead=0;
    const first=SW.timelineTracks(p)[0];
    trackId=first?.id||'master';pickedTracks=new Set([trackId]);clipId=first?.clips[0]?.id||null;noteId=null;
    autoKey='volume';rollChanged=true;revision++;isDirty=false;autosave();render();
    if(message)status(message);
  }
  async function restore(){
    const initial=revision;
    try{
      const db=await database();
      const stored=await new Promise((resolve,reject)=>{
        const req=db.transaction('workspace').objectStore('workspace').get('session');
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      if(stored&&revision===initial&&!busy){
        SW.validateProject(stored.snapshot);
        let restored=false;
        await swap(stored.snapshot,stored.data,'Restored local session',()=>{
          if(revision!==initial||isEditing())return false;
          if(stored.id)workspacePages.restoreSessionId(stored.id);
          restored=true;
          return true;
        });
        if(restored){workspacePages.sessionChanged();workspacePages.draw();}
      }
    }catch{$('save-state').textContent='Autosave unavailable · use Save';}
  }
  function selectTrack(id,renderNow=true,add=false){
    const oldClip=activeClip();
    const oldTrack=trackId;
    if(add){
      if(pickedTracks.has(id))pickedTracks.delete(id);else pickedTracks.add(id);
    }else pickedTracks=new Set([id]);
    trackId=add&&!pickedTracks.has(id)&&pickedTracks.size?[...pickedTracks].at(-1):id;
    id=trackId;
    if(oldTrack!==id||foundClip()?.t.id!==id){
      clipId=null;noteId=null;picked.clear();notePicked.clear();rollChanged=true;
    }
    if(oldTrack!==id){editorPart=null;editPage='notes';editRange=null;showRange();}
    if(oldTrack!==id&&!Object.hasOwn(laneSpecs(currentTrack()),autoKey)) autoKey='volume';
    if(renderNow){renderSelections();renderInspector();if(tab!=='mixer'||oldClip!==activeClip()) renderDock();renderKeys();}
  }
  function selectClip(t,c,renderNow=true){
    if(clipId!==c.id){rollChanged=true;noteId=null;notePicked.clear();}
    trackId=t.id;clipId=c.id;editorPart=c.id;picked=new Set([c.id]);pickedTracks=new Set([t.id]);
    if(renderNow){renderSelections();renderInspector();if(tab!=='mixer') renderDock();}
  }
  function renderSelections(){
    all('[data-track]').forEach(el=>el.classList.toggle('selected',pickedTracks.has(el.dataset.track)));
    all('[data-clip]').forEach(el=>{el.classList.toggle('selected',el.dataset.clip===clipId);el.classList.toggle('picked',picked.has(el.dataset.clip));});
  }
  function reflectPanels(){
    const lower=$('lower-workspace'), browser=$('browser-workspace');
    const popped=panels.detached(lower), browserPopped=panels.detached(browser);
    document.body.classList.toggle('dock-popped',popped);
    document.body.classList.toggle('dock-collapsed',!dockOpen);
    document.body.classList.toggle('browser-open',browserOpen&&!browserPopped);
    $('dock').hidden=!dockOpen;
    browser.hidden=!browserOpen;
    const browserEdge=$('browser-edge'),toggleBrowser=$('toggle-browser');
    browserEdge.hidden=browserOpen&&!browserPopped;
    toggleBrowser.setAttribute('aria-expanded',browserOpen);
    const browserAction=browserPopped?'Focus detached Browser (F5)':'Show Browser (F5)';
    toggleBrowser.setAttribute('aria-label',browserAction);toggleBrowser.title=browserAction;
    $('dock-detach').textContent=popped?'Dock panel':'Detach';
    $('browser-detach').textContent=browserPopped?'Dock panel':'Detach';
    for(const el of all('[data-tab]')){
      const active=dockOpen&&el.dataset.tab===tab;
      el.classList.toggle('active',active);el.setAttribute('aria-pressed',active);
    }
    panels.sync();
  }
  const rememberedEditorModes=new Map();
  let browserFullscreen=false;
  function openLastFullscreen(panel,wanted){
    if(panelIsFullscreen(panel)===wanted)return;
    run(async()=>{
      await panels.fullscreen(panel,wanted);
      toggleWindowLabels();resizeDockView();
    })();
  }
  function saveEditorMode(){
    const panel=$('lower-workspace');
    rememberedEditorModes.set(tab,{
      fullscreen:panelIsFullscreen(panel),
      height:dockHeight,
      expanded:document.body.classList.contains('dock-expanded')
    });
  }
  function applyEditorMode(){
    const mode=rememberedEditorModes.get(tab)||{height:0,expanded:tab==='routing'};
    dockHeight=mode.height;
    document.body.classList.toggle('dock-custom',Boolean(dockHeight));
    document.body.classList.toggle('dock-expanded',Boolean(mode.expanded));
    if(dockHeight)document.body.style.setProperty('--lower-custom',dockHeight+'px');
    if(dockHeight)$('dock-resize').setAttribute('aria-valuenow',Math.round(dockHeight));
    return Boolean(mode.fullscreen);
  }
  function setTab(name,toggleOpen=false){
    if(name==='browser'||name==='media'){
      const panel=$('browser-workspace'),wasOpen=browserOpen;
      browserOpen=!(toggleOpen&&browserOpen);
      if(browserOpen){refreshLocal(false);panels.focus(panel);}
      else {
        browserFullscreen=panelIsFullscreen(panel);
        panels.closeFullscreen(panel);panels.attach(panel);
      }
      reflectPanels();renderBrowserPanel();
      if(browserOpen&&!wasOpen)openLastFullscreen(panel,browserFullscreen);
      return;
    }
    name=name==='piano'?'edit':name;
    const wasOpen=dockOpen,switching=tab!==name,panel=$('lower-workspace');
    const hide=toggleOpen&&dockOpen&&!switching;
    if(wasOpen&&(switching||hide))saveEditorMode();
    if(hide){
      dockOpen=false;
      panels.closeFullscreen(panel);panels.attach(panel);
      reflectPanels();return;
    }
    dockOpen=true;tab=name;rollChanged=true;
    const changeMode=switching||!wasOpen;
    const fullscreen=changeMode?applyEditorMode():false;
    panels.focus(panel);reflectPanels();renderDock();
    if(changeMode)openLastFullscreen(panel,fullscreen);
    if(tab==='routing'&&immersiveEditor())patchPanel.fit();
  }
  const panelIsFullscreen=panel=>panel.classList.contains('panel-maximized')||panel.ownerDocument?.fullscreenElement===panel;
  const immersiveEditor=()=>panelIsFullscreen($('lower-workspace'))||panels.detached($('lower-workspace'));
  function toggleWindowLabels(){
    for(const [panel,control] of [['lower-workspace','dock-full'],['browser-workspace','browser-full']]){
      const full=panelIsFullscreen($(panel)), el=$(control);
      el.textContent=full?'Exit fullscreen':'Fullscreen';
      el.setAttribute('aria-pressed',full);
    }
  }
  let previousDockSize='', fullRouting=false;
  function resizeDockView(){
    const dock=$('dock');
    if(!dockOpen||!dock.clientWidth||!dock.clientHeight)return;
    const large=immersiveEditor(), key=[dock.clientWidth,dock.clientHeight,large,tab].join(':');
    if(key===previousDockSize)return;
    if(gesture)return;
    previousDockSize=key;
    if(tab==='routing'){
      patchPanel.resize();
      if(large&&!fullRouting)patchPanel.fit();
    }
    if(tab==='edit'||tab==='automation'||tab==='mixer') renderDock(false);
    fullRouting=large&&tab==='routing';
  }
  function bindWorkspace(){
    const lower=$('lower-workspace'), browser=$('browser-workspace');
    $('dock-detach').onclick=()=>panels.detach(lower,'Editors and mixer');
    $('browser-detach').onclick=()=>panels.detach(browser,'Browser');
    $('dock-full').onclick=run(async()=>{await panels.fullscreen(lower);toggleWindowLabels();resizeDockView();});
    $('browser-full').onclick=run(async()=>{await panels.fullscreen(browser);toggleWindowLabels();});
    $('browser-hide').onclick=()=>setTab('browser',true);
    $('toggle-browser').onclick=()=>setTab('browser');
    toggleWindowLabels();
    panels.listen(document,'fullscreenchange',()=>{toggleWindowLabels();resizeDockView();});
    if(typeof ResizeObserver==='function')new ResizeObserver(resizeDockView).observe($('dock'));
    SW.bindPanelResize($('dock-resize'),'y',()=>lower.getBoundingClientRect().height,size=>{
      dockHeight=size;document.body.classList.add('dock-custom');
      document.body.style.setProperty('--lower-custom',size+'px');
      $('dock-resize').setAttribute('aria-valuenow',Math.round(size));
    },()=>[tab==='mixer'?310:118,Math.max(tab==='mixer'?310:140,innerHeight*.67)]);
    SW.bindPanelResize($('browser-resize'),'x',()=>browser.getBoundingClientRect().width,size=>{
      browserWidth=size;document.body.style.setProperty('--browser-width',browserWidth+'px');
      $('browser-resize').setAttribute('aria-valuenow',Math.round(size));
    },()=>[190,Math.max(230,innerWidth*.56)]);
    window.addEventListener('pagehide',()=>{closeAudioMonitors();releaseKeyboard();panels.close();});
  }
  function render(){
    cleanSelection();
    if(!workspacePages||workspacePages.page()==='session')document.title=p.name+' — Sonoravell Studio';
    $('bpm').value=p.bpm;$('meter').value=p.meter;
    renderLocators();
    $('track-count').textContent=SW.timelineTracks(p).length+' tracks';
    $('clip-count').textContent=p.tracks.reduce((sum,t)=>sum+t.clips.length,0)+' clips';
    $('zoom-display').textContent=zoom+' px/beat';
    $('loop').setAttribute('aria-pressed',p.loop);$('click').setAttribute('aria-pressed',p.click);
    $('undo').disabled=!history.length;$('redo').disabled=!redo.length;
    renderArrangement();renderInspector();renderDock();renderKeys();updateTransport();updatePosition();
    sessionViews?.draw();
    if(studioPlugin&&$('plugin-dialog').open)renderPlugin();
    if(studioSpatial&&$('spatial-dialog').open)renderSpatial();
  }
  let iconTrack=null;
  function trackIconButton(t){
    const icon=SW.trackIcon(t), gray=t.type==='audio'&&!t.icon?' track-icon-neutral':'';
    return '<button type="button" class="track-icon-button'+gray+'" data-action="track-icon" title="'+
      esc('Change icon · '+t.name)+'" aria-label="'+esc('Change icon for '+t.name)+'">'+SW.trackIconMarkup(icon)+'</button>';
  }
  function openTrackIcons(t){
    if(!t||isEditing())return;
    iconTrack=t.id;
    $('track-icon-title').textContent='Track icon · '+t.name;
    const options=[['auto','Automatic',SW.trackIcon({...t,icon:undefined})],
      ...Object.entries(SW.trackIcons).map(([key,[name]])=>[key,name,key])];
    $('track-icon-options').innerHTML=options.map(([key,name,icon])=>'<button type="button" data-action="track-icon-set" data-key="'+key+
      '" aria-pressed="'+(key===(t.icon||'auto'))+'">'+SW.trackIconMarkup(icon)+'<span>'+esc(name)+'</span></button>').join('');
    window.focus?.();
    if(!$('track-icon-dialog').open)$('track-icon-dialog').showModal();
  }
  function monitorButton(t){
    const midi=t.type==='midi'&&!t.instrumentOnly, audio=t.type==='audio';
    if(!audio&&!midi)return '';
    const title=audio?'Listen to audio input (use headphones)':'Listen to live MIDI instrument input';
    const active=audio?monitoring.has(t.id):t.sourceInput!=='off'&&!mutedMidiMonitors.has(t.id);
    return '<button type="button" class="monitor-button" data-action="record-monitor" aria-pressed="'+active+
      '" aria-label="'+esc('Listen to '+t.name)+'" title="'+title+'">'+SW.trackIconMarkup('speaker')+'</button>';
  }
  function renderArrangement(){
    const grid=$('arrange-grid'), span=total(), width=span*zoom;
    grid.dataset.tool=editTool;
    grid.style.gridTemplateColumns='var(--head) '+width+'px';
    grid.style.setProperty('--beat',zoom+'px');
    grid.style.setProperty('--meter',p.meter);
    grid.style.setProperty('--row',trackHeight()+'px');
    const interval=Math.max(p.meter,Math.ceil(span/400/p.meter)*p.meter);
    let html='<div class="track-title">Tracks</div><div class="ruler" data-ruler aria-label="Timeline ruler">'+loopMarkup();
    for(let b=0;b<span;b+=interval)html+='<span class="bar-mark" style="left:'+b*zoom+'px">'+(1+b/p.meter)+'</span>';
    html+='<span class="playline"></span></div>'+renderGlobalTracks();
    const timeline=SW.timelineTracks(p), folders=SW.folders(p);
    const trackIndexes=new Map(timeline.map((t,i)=>[t.id,i+1]));
    const renderRow=(t,grouped)=>{
      const selected=pickedTracks.has(t.id);
      let row=`<div class="track-head ${selected?'selected':''} ${grouped?'folder-member':''}" tabindex="0" draggable="true" data-track="${t.id}" style="--track:${t.color}"><span class="stripe"></span><div class="track-meta"><div class="track-caption">${trackIconButton(t)}<strong title="${esc(t.name)}">${prefs.trackNumbers?'<span class="track-index">'+trackIndexes.get(t.id)+'</span>':''}${esc(t.name)}</strong></div><div class="controls">`;
      row+=toggle('mute','M','Mute',t.mute)+toggle('solo','S','Solo',t.solo);
      row+=toggle('arm','●','Record arm',armed.has(t.id),'class="record"')+monitorButton(t);
      row+=`<label class="track-volume"><input type="range" min="-60" max="6" step=".1" value="${t.volume}" data-param="volume" data-owner="${t.id}" aria-label="${esc(t.name)} volume" title="${esc(t.name)} · ${fmt(t.volume,1)} dB"></label></div></div><div class="track-meter" data-track-meter="${t.id}" role="meter" aria-label="${esc(t.name)} peak level in dBFS" aria-valuemin="-60" aria-valuemax="0" aria-valuenow="-60" title="Peak level"><span></span></div></div><div class="lane ${t.type} ${selected?'selected':''}" data-track="${t.id}" data-lane="${t.id}">`;
      for(const c of t.clips){
        row+=`<div class="event event-${c.type} ${c.id===clipId?'selected':''} ${picked.has(c.id)?'picked':''} ${c.muted?'muted':''} ${c.locked?'locked':''}" tabindex="0" aria-label="${esc(c.name)}" data-clip="${c.id}" style="left:${c.start*zoom}px;width:${c.length*zoom}px;--track:${t.color}"><span class="event-title">${esc(c.name)}</span><canvas aria-hidden="true"></canvas><span class="edge left" data-edge="left"></span><span class="edge right" data-edge="right"></span>${c.type==='audio'?waveOverlay(c):''}</div>`;
      }
      return row+'<span class="playline"></span></div>';
    };
    if(!timeline.length&&!folders.length)html+='<div class="track-head"></div><div class="lane"><div class="arrange-empty">Add a track or drop audio or MIDI here.</div><span class="playline"></span></div>';
    const renderedFolders=new Set();
    const renderFolder=folder=>{
      renderedFolders.add(folder.id);
      const members=timeline.filter(t=>t.folder===folder.id);
      const bus=SW.findTrack(p,folder.bus);
      html+=`<div class="track-head folder-head" data-folder="${folder.id}" tabindex="0"${folder.color?' style="--track:'+folder.color+'"':''}><span class="stripe"></span><div class="track-meta"><div class="controls">${toggle('folder-collapse',folder.collapsed?'▸':'▾','Expand or collapse folder',folder.collapsed)}<strong>${esc(folder.name)}</strong><small>${members.length}</small></div><div class="controls">${button('folder-bus',bus?'Mixer bus':'+ Bus')}${button('folder-rename','Rename')}${button('folder-remove','×','Remove folder')}</div></div></div>`;
      html+=`<div class="lane folder-lane" data-folder="${folder.id}"><span>${bus?'Bus · '+esc(bus.name):'Drop track headers here'}</span><span class="playline"></span></div>`;
      if(!folder.collapsed)for(const t of members)html+=renderRow(t,true);
    };
    for(const t of timeline){
      const folder=folders.find(f=>f.id===t.folder);
      if(!folder)html+=renderRow(t,false);
      else if(!renderedFolders.has(folder.id))renderFolder(folder);
    }
    for(const folder of folders)if(!renderedFolders.has(folder.id))renderFolder(folder);
    grid.innerHTML=html;
    for(const item of grid.querySelectorAll('[data-clip]')){
      const row=foundClip(item.dataset.clip);
      paintClip(item.querySelector('canvas'),row.c,row.t.color,undefined,Math.max(16,trackHeight()-34));
    }
    showRange();
  }
  function paintClip(canvas,c,color,width,height=33){
    const w=width||Math.min(1500,Math.max(2,Math.ceil(c.length*zoom))), h=height;
    canvas.width=w;canvas.height=h;
    const g=canvas.getContext('2d');
    g.fillStyle=color;g.strokeStyle=color;g.globalAlpha=.85;
    if(c.type==='midi'){
      if(!c.notes.length) return;
      const low=c.notes.reduce((bottom,n)=>Math.min(bottom,n.pitch),127);
      const high=c.notes.reduce((top,n)=>Math.max(top,n.pitch),0);
      const lo=low-1, hi=high+1;
      for(const n of c.notes){
        const x=n.start/c.length*w, y=2+(hi-n.pitch)/(hi-lo)*(h-4);
        g.fillRect(x,y,Math.max(1,n.length/c.length*w),2);
      }
      return;
    }
    const entry=media.get(c.asset);
    if(!entry) return;
    const b=entry.buffer, first=b.getChannelData(0), second=b.numberOfChannels>1?b.getChannelData(1):null;
    const from=seconds(c.offset,c.sourceBpm)*b.sampleRate,length=seconds(c.length,c.sourceBpm)*b.sampleRate;
    g.beginPath();
    for(let x=0;x<w;x++){
      const a=Math.floor(from+x/w*length), end=Math.min(b.length,Math.ceil(from+(x+1)/w*length));
      const stride=Math.max(1,Math.floor((end-a)/30));
      let min=0,max=0;
      for(let j=a;j<end;j+=stride){
        const index=c.reverse?first.length-1-j:j;
        const v=first[index],r=second?.[index]??v;
        min=Math.min(min,v,r);max=Math.max(max,v,r);
      }
      g.moveTo(x+.5,h*.5-min*h*.46);g.lineTo(x+.5,h*.5-max*h*.46);
    }
    g.stroke();
  }
  function toggle(action,label,title,value,extra=''){
    return button(action,label,title,'aria-pressed="'+Boolean(value)+'" '+extra);
  }
  function heading(title,body){return '<section class="inspect-section"><h3>'+esc(title)+'</h3>'+body+'</section>';}
  function renderInspector(){
    const t=currentTrack(), c=activeClip();
    let html='<div class="track-icon-inspector">'+trackIconButton(t)+'<span>'+esc(SW.trackIcons[SW.trackIcon(t)][0])+'</span></div>'+field('track-name','Name',t.name);
    const trackColors=SW.colors.map((color,i)=>option(color,['Mint','Blue','Orchid','Amber','Rose','Lime','Cyan','Lavender'][i],t.color));
    if(!SW.colors.includes(t.color))trackColors.unshift(option(t.color,'Custom · '+t.color,t.color));
    html+=select('track-color','Color',trackColors.join(''));
    if(SW.timelineTrack(t))html+=select('track-folder','Folder',[option('','Unfiled',t.folder||''),...SW.folders(p).map(f=>option(f.id,f.name,t.folder))].join(''));
    if(t.id!=='master')html+='<div class="actions">'+button('up-track','↑','Move track up')+button('down-track','↓','Move track down')+
      button('duplicate-track','Duplicate','Duplicate track')+button('remove-track','Remove','Remove track')+'</div>';
    let view=heading(typeLabel(t),html);
    view+=heading('Input',channelInput(t)+field('trim','Input trim (dB)',t.trim??0,-24,24,.1)+
      '<div class="actions">'+toggle('mix-mono','Mono','Sum input to mono',t.mono)+toggle('mix-polarity','Ø','Invert polarity',t.polarity)+'</div>');
    view+=heading('Presets',select('channel-preset','FX chain',[option('','Choose preset',''),...Object.keys(SW.presets).map(name=>option(name,name))].join('')));
    const sends=t.id==='master'?'<small class="muted-text">Master feeds the monitor output.</small>':
      sendControls(t)+cueFields(t);
    view+=heading('Sends',sends);
    view+=heading('Pre-fader',button('show-patch','Open pre-fader tap','View the Pre-fader node in Signal Flow'));
    view+=heading('Fader',sourceFader(t,'volume','Level (dB)',-60,6,.1)+
      select('automation-mode','Automation',['Off','Read','Touch','Latch','Write'].map(mode=>option(mode,mode,t.automation)).join(''))+
      '<div class="actions">'+toggle('mute','Mute','Mute channel',t.mute)+(t.id!=='master'?toggle('solo','Solo','Solo channel',t.solo)+toggle('mix-safe','Solo safe','Solo safe',t.soloSafe):'')+'</div>');
    view+=heading('Post-fader',sourceFader(t,'pan','Pan',-1,1,.01)+
      (t.id==='master'?'':button('open-spatial','Spatial panner')));
    if(t.id==='master'){
      view+=heading('Output',select('monitor-cue','Monitor',
        [option('__off','Disconnected',p.monitorDisconnected?'__off':null),option('','Main',p.monitorDisconnected?null:p.monitorCue||''),...SW.cueSettings(p).map(c=>option(c.id,c.name,p.monitorDisconnected?null:p.monitorCue))].join('')));
    }else{
      const buses=p.tracks.filter(row=>row.type==='bus'&&validRoute(p,t.id,row.id,'out'));
      view+=heading('Output',select('out','Route to',[option('','Disconnected',t.out),option('master','Master',t.out),...buses.map(row=>option(row.id,row.name,t.out))].join('')));
    }
    if(c){
      let event=field('clip-name','Name',c.name)+field('clip-start','Start (beat)',fmt(c.start+1,4),1,100000,.01)+field('clip-length','Length (beats)',fmt(c.length,4),.001,100000,.01);
      if(c.type==='audio'){
        const max=Math.max(0,c.length-.001), asset=p.assets[c.asset];
        event+=field('clip-offset','Offset (beats)',fmt(c.offset,4),0,Math.max(0,asset.duration*c.sourceBpm/60-c.length),.01);
        event+=field('clip-gain','Gain (dB)',c.gain,-60,24,.1);
        event+=field('fade-in','Fade in (beats)',c.fadeIn,0,max,.01)+field('fade-out','Fade out (beats)',c.fadeOut,0,max,.01);
      }
      event+='<div class="actions">'+button('split','Split','Split at playhead')+button('duplicate-clip','Duplicate','Duplicate clip')+button('delete-clip','Delete','Delete clip');
      event+=c.type==='audio'?toggle('reverse','Reverse','Reverse clip',c.reverse)+button('normalize','Normalize','Normalize peak to −1 dBFS'):button('edit-notes','Edit notes','Open piano roll');
      event+='</div>';view+=heading('Clip',event);
    }
    const body=t.fx.map((e,i)=>{
      let head='<div class="fx-card" tabindex="0" data-fx="'+e.id+'"><header><strong>'+esc(e.type)+'</strong>';
      head+=button('gear-editor','Edit','Open '+e.type+' controls')+toggle('fx-bypass','⏻','Bypass '+e.type,e.bypass)+button('fx-up','↑','Move effect up',i?'':'disabled')+button('fx-down','↓','Move effect down',i<t.fx.length-1?'':'disabled')+button('fx-remove','×','Remove '+e.type)+'</header>';
      for(const [key,spec] of Object.entries(fx[e.type])){
        if(SW.structuralFXParam(e.type,key)||e.type==='Spectrum EQ'&&key!=='output'||e.type==='Guitar Pedalboard')continue;
        const id='fx:'+e.id+':'+key;
        head+=`<label><button type="button" class="fx-param" data-action="show-lane" data-key="${id}" title="Edit ${esc(key)} automation">${esc(key)}</button><input type="range" aria-label="${esc(e.type+' '+key)}" data-param="${id}" data-owner="${t.id}" min="${spec[0]}" max="${spec[1]}" step="${spec[3]}" value="${e.params[key]}"><output>${fmt(e.params[key],4)} ${spec[4]}</output></label>`;
      }
      return head+'</div>';
    }).join('');
    view+=heading('Insert effects','<div class="actions">'+button('fx-bypass-all','Bypass all')+button('fx-copy','Copy')+button('fx-paste','Paste')+'</div>'+body+'<select class="full" aria-label="Add insert effect" data-change="add-fx"><option value="">+ Add insert</option>'+Object.keys(fx).map(key=>option(key,key)).join('')+'</select>');
    $('inspector').innerHTML=view;
  }
  function renderDock(includeBrowser=true){
    if(includeBrowser)renderBrowserPanel();
    if(!dockOpen) return;
    const dock=$('dock'), previousEditor=dock.querySelector('.editor-content');
    const left=previousEditor?.scrollLeft||0, top=previousEditor?.scrollTop||0;
    const rackScroll=new Map([...dock.querySelectorAll('.console-rack[data-rack-key]')].map(el=>[el.dataset.rackKey,el.querySelector('.console-rack-list')?.scrollTop]));
    if(dock.dataset.view==='mixer')mixerScroll=dock.querySelector('.mixer-viewport')?.scrollLeft??mixerScroll;
    dock.dataset.view=tab;
    dock.classList.toggle('patch-dock',tab==='routing');
    if(tab==='mixer'){
      dock.innerHTML=renderMixer();
      const view=dock.querySelector('.mixer-viewport');
      if(view)view.scrollLeft=mixerScroll;
    }
    if(tab==='routing'){
      dock.innerHTML=patchPanel.render();
      patchPanel.mount();
    }
    if(tab==='edit'){
      dock.innerHTML=renderEdit();
      const wave=$('editor-wave');
      if(wave){
        const width=immersiveEditor()?Math.min(2400,dock.clientWidth||900):900;
        const height=immersiveEditor()?Math.max(140,dock.clientHeight-157):87;
        paintClip(wave,editorClip(),currentTrack().color,width,height);
      }
    }
    if(tab==='automation') dock.innerHTML=renderAutomation();
    for(const el of dock.querySelectorAll('.console-rack[data-rack-key]')){
      const scroll=rackScroll.get(el.dataset.rackKey);
      if(scroll)el.querySelector('.console-rack-list').scrollTop=scroll;
    }
    if(tab==='edit'){
      const editor=dock.querySelector('.editor-content');
      if(editor){
        editor.scrollLeft=left;
        const velocity=dock.querySelector('.velocity-track');
        if(velocity){
          velocity.scrollLeft=left;
          editor.addEventListener('scroll',()=>{velocity.scrollLeft=editor.scrollLeft;},{passive:true});
        }
        if(rollChanged&&editPage==='notes'&&editorClip()?.type==='midi'){
          const notes=editorClip().notes;
          const middle=notes.length?Math.round(notes.reduce((sum,n)=>sum+n.pitch,0)/notes.length):60;
          editor.scrollTop=Math.max(0,20+(rollTop-middle)*16-editor.clientHeight/2);
          rollChanged=false;
        }else editor.scrollTop=top;
      }
    }
    updatePosition();
  }
  function renderBrowserPanel(){
    if(!browserOpen)return;
    const region=$('browser-content'),top=region.scrollTop;region.innerHTML=renderBrowser();region.scrollTop=top;
  }
  const consolePresets=readSettings('sw-console-presets',[]);
  const acceptedConsolePresets=Array.isArray(consolePresets)?consolePresets.filter(item=>
    typeof item?.name==='string'&&item.name.length<=80&&item.name.length>0&&Array.isArray(item.chain)&&item.chain.length<=64&&
    item.chain.every(entry=>typeof entry?.bypass==='boolean'&&SW.validEffectParams(entry.type,entry.params))).slice(0,64):[];

  function consoleSelect(key,label,options){
    return '<select data-change="'+key+'" aria-label="'+esc(label)+'" title="'+esc(label)+'">'+options+'</select>';
  }
  function consoleInput(t){
    if(t.type==='audio') return button('inputs',t.inputDevice?t.inputLabel||'Assigned input':'Default audio input','Choose hardware recording input');
    if(t.type==='midi') return consoleSelect('source-input','MIDI input for '+t.name,[
      ['all','All MIDI inputs'],['qwerty','Computer keyboard'],['external','Hardware MIDI'],['off','No live input']
    ].map(([id,label])=>option(id,label,t.sourceInput||'all')).join(''));
    const inputs=p.tracks.filter(row=>row.out===t.id||SW.sendList(row).some(send=>send.to===t.id)).map(row=>row.name);
    return button('show-patch',inputs.length?inputs.length+(inputs.length===1?' channel':' channels'):'No connected channels',
      inputs.length?'Edit incoming routes · '+inputs.join(', '):'Connect inputs in Signal Flow');
  }
  function consoleOutput(t){
    if(t.id==='master'){
      const active=p.monitorDisconnected?'__off':p.monitorCue||'';
      return consoleSelect('monitor-cue','Monitor output',[
        option('','Main monitor',active), ...SW.cueSettings(p).map(c=>option(c.id,c.name,active)),option('__off','Disconnected',active)
      ].join(''));
    }
    return consoleSelect('out','Output for '+t.name,[option('','Disconnected',t.out),option('master','Master',t.out),
      ...p.tracks.filter(row=>row.type==='bus'&&validRoute(p,t.id,row.id,'out')).map(row=>option(row.id,row.name,t.out))
    ].join(''));
  }
  const openRacks=new Set(), openSendRows=new Set();
  const rackId=(scope,track,section)=>scope+':'+track+':'+section;
  function iconPicker(action,label,icon,options,attribute='data-change'){
    return '<span class="icon-picker" title="'+esc(label)+'"><span aria-hidden="true">'+icon+'</span>'+
      '<select '+attribute+'="'+action+'" aria-label="'+esc(label)+'">'+option('','', '')+options+'</select></span>';
  }
  function compactDial(t,key,label){
    const spec=laneSpecs(t)[key];
    return knob('mix',key,label,laneValue(t,key),spec,t.id,0,false,true);
  }
  function compactSendRows(t,scope){
    const legacy=t.send?[{id:'legacy',to:t.send,level:t.sendLevel,pre:false,mute:false}]:[];
    const sends=[...legacy,...(t.sends||[]).map((s,i)=>({...s,id:'aux:'+i}))];
    const cues=SW.cueSends(t).map((s,i)=>({...s,id:'cue:'+i}));
    return [...sends,...cues].map(s=>{
      const [kind,index]=s.id.split(':');
      const isCue=kind==='cue',isLegacy=kind==='legacy';
      const target=isCue?SW.cueSettings(p).find(row=>row.id===s.to):SW.findTrack(p,s.to);
      const name=target?.name||'Disconnected';
      const key=rackId(scope,t.id,s.id), open=openSendRows.has(key);
      const slider=knob('route',s.id+':level',name+' send level',s.level,['Level',-60,6,.1,'dB'],t.id,-18,false,true);
      const available=isCue?SW.cueSettings(p).filter(row=>row.id===s.to||!SW.cueSends(t).some(send=>send.to===row.id&&send.pre===s.pre)):
        p.tracks.filter(row=>row.type==='bus'&&validRoute(p,t.id,row.id,'send')&&(row.id===s.to||!SW.sendList(t).some(send=>send.to===row.id&&send.pre===s.pre)));
      const routeSelect=consoleSelect(isCue?'cue-target':isLegacy?'send':'aux-target','Destination for '+name,[
        ...(isLegacy?[option('','Disconnect',null)]:[]),...available.map(row=>option(row.id,row.name,s.to))
      ].join(''));
      const details=open?'<div class="compact-send-detail">'+routeSelect+
        (isCue?knob('route',s.id+':pan',name+' cue pan',s.pan,['Pan',-1,1,.01,''],t.id,0,false,true)+
          toggle('cue-follow','Link pan','Follow channel pan',s.followPan):'')+
        (isLegacy?button('legacy-send-remove','×','Disconnect send'):button(isCue?'cue-remove':'send-remove','×','Remove send'))+'</div>':'';
      const tap=isLegacy?'<span class="send-tap" title="Post-fader">Post</span>':
        toggle(isCue?'cue-pre':'send-pre',s.pre?'Pre':'Post','Toggle pre or post fader',s.pre)+
        toggle(isCue?'cue-mute':'send-mute','⏻','Toggle send',!s.mute);
      return '<div class="compact-send" tabindex="0" '+(isLegacy?'data-legacy-send':(isCue?'data-cue-route':'data-send')+'="'+index+'"')+'>'+
        '<div class="compact-send-line">'+button('send-row-toggle',open?'▾':'▸','Expand '+name+' send','aria-expanded="'+open+'" data-rack-key="'+esc(key)+'" data-rack-parent="'+esc(rackId(scope,t.id,'sends'))+'"')+
        '<span class="compact-send-name" title="'+esc(name)+'">'+esc(name)+'</span>'+slider+tap+'</div>'+details+'</div>';
    }).join('');
  }
  function consoleRacks(t,scope='mixer'){
    const label=esc(t.name);
    const inserts=t.fx.map(e=>'<div class="console-insert" tabindex="0" data-fx="'+e.id+'">'+toggle('fx-bypass','⏻',e.bypass?'Enable '+e.type:'Bypass '+e.type,!e.bypass)+
      button('gear-editor',e.type,'Open '+e.type+' editor','class="console-insert-name"')+button('fx-remove','×','Remove '+e.type)+'</div>').join('');
    const presetOptions=[...Object.keys(SW.presets).map(name=>option('factory:'+name,name)),
      ...acceptedConsolePresets.map((preset,i)=>option('user:'+i,preset.name+' · User')),...(t.fx.length?[option('save','Store FX chain…')]:[])].join('');
    const effectOptions=Object.keys(fx).map(name=>option(name,name)).join('');
    const buses=p.tracks.filter(row=>row.type==='bus'&&validRoute(p,t.id,row.id,'send')&&!SW.sendList(t).some(send=>send.to===row.id&&!send.pre));
    const cues=SW.cueSettings(p).filter(row=>!SW.cueSends(t).some(send=>send.to===row.id&&send.pre));
    const sendOptions=(buses.length?'<optgroup label="Bus sends">'+buses.map(row=>option('bus:'+row.id,row.name)).join('')+'</optgroup>':'')+
      (cues.length?'<optgroup label="Cue sends">'+cues.map(row=>option('cue:'+row.id,row.name)).join('')+'</optgroup>':'');
    const insertsTools=toggle('fx-bypass-all','⏻','Toggle all inserts',t.fx.some(e=>!e.bypass),t.fx.length?'':'disabled')+
      iconPicker('console-preset','FX chain presets for '+t.name,'⌄',presetOptions)+iconPicker('add-fx','Add insert to '+t.name,'+',effectOptions);
    const sendsTools=t.id==='master'?'':sendOptions?iconPicker('console-send-add','Add send to '+t.name,'+',sendOptions):'<button type="button" disabled title="No available bus or cue outputs">+</button>';
    const rack=(kind,title,count,tools,items)=>{
      const key=rackId(scope,t.id,kind),open=openRacks.has(key);
      return '<section class="console-rack" data-rack="'+kind+'" data-rack-key="'+esc(key)+'" data-rack-open="'+open+'" aria-label="'+title+' for '+label+'">'+
        '<header>'+button('rack-toggle',open?'▾':'▸',(open?'Collapse ':'Expand ')+title,
          'aria-expanded="'+open+'" data-rack-key="'+esc(key)+'"')+'<strong>'+title+'</strong><small>'+count+'</small>'+tools+'</header>'+
        '<div class="console-rack-list"'+(open?' tabindex="0" aria-label="'+title+' list"':'')+'>'+(items||'<span class="rack-empty" aria-hidden="true">—</span>')+'</div></section>';
    };
    return '<div class="console-racks">'+rack('inserts','Inserts',t.fx.length,insertsTools,inserts)+
      rack('sends','Sends',SW.sendList(t).length+SW.cueSends(t).length,sendsTools,compactSendRows(t,scope))+'</div>';
  }
  function renderConsoleStrip(t){
    const label=esc(t.name), master=t.id==='master', instrument=t.type==='midi', recordable=instrument&&!t.instrumentOnly||t.type==='audio';
    const index=master?'Main':t.instrumentOnly?'Loaded':String(p.tracks.indexOf(t)+1);
    const instrumentPicker=instrument?'<div class="console-instrument">'+(!t.instrumentDisabled?gearArt(t.instrument,true):'')+consoleSelect('instrument','Instrument for '+t.name,[
      ...(t.instrumentDisabled?[option('','Choose instrument','')]:[]),
      ...Object.keys(instruments).map(name=>option(name,name,t.instrumentDisabled?'':t.instrument))
    ].join(''))+(t.instrumentDisabled?'':button('gear-inst','Edit','Open the instrument editor'))+
      (!t.instrumentDisabled&&t.instrument==='Sampler'?button('load-sample','Load','Load sampler audio'):'')+'</div>':'';
    const mixButtons=toggle('mute','M','Mute '+t.name,t.mute)+(master?'':toggle('solo','S','Solo '+t.name+' (Alt-click for exclusive solo)',t.solo))+
      (recordable?toggle('arm','●','Record arm '+t.name,armed.has(t.id),'class="record"')+monitorButton(t):'')+
      (mixerWide?toggle('mix-mono','Mono','Sum input to mono',t.mono)+(master?'':toggle('mix-safe','Safe','Solo safe',t.soloSafe)+
        toggle('mix-hide',t.hidden?'Show':'Hide','Show or hide console channel',t.hidden)):'');
    return `<div class="strip console-strip ${mixerWide?'large':''} ${pickedTracks.has(t.id)?'selected':''} ${t.type}" tabindex="0" data-track="${t.id}" style="--track:${t.color}">
      <div class="console-io"><label><span>In</span>${consoleInput(t)}</label><label><span>Out</span>${consoleOutput(t)}</label>${instrumentPicker}</div>
      <div class="console-input-tools">${compactDial(t,'trim','Gain')}${compactDial(t,'pan','Pan')}${toggle('mix-polarity','Ø','Invert input polarity (phase flip)',t.polarity)}</div>
      ${consoleRacks(t)}
      <div class="controls mix-buttons">${mixButtons}</div>
      <div class="fader-row console-fader">
        <div class="console-scale" aria-hidden="true"><span style="--tick:0%">+6</span><span style="--tick:9.1%">0</span><span style="--tick:27.3%">−12</span><span style="--tick:63.6%">−36</span><span style="--tick:100%">−60</span></div>
        <input type="range" min="-60" max="6" step=".1" aria-label="${label} volume" data-param="volume" data-owner="${t.id}" value="${t.volume}">
        <div class="meter" title="Peak meter" data-meter="${t.id}"><span></span></div>
      </div>
      <div class="console-level">${sourceFader(t,'volume','dB',-60,6,.1)}<output class="strip-meter-values" data-peak="${t.id}">Peak —</output></div>
      <div class="console-auto" data-automation-active="${t.automation!=='Off'}">${consoleSelect('automation-mode','Automation for '+t.name,['Off','Read','Touch','Latch','Write'].map(mode=>option(mode,'Auto · '+mode,t.automation)).join(''))}</div>
      <footer class="console-name"><label class="channel-color" title="Channel color"><input type="color" data-change="track-color" aria-label="Color for ${label}" value="${t.color}"></label>
        <div class="console-identity">${trackIconButton(t)}<span class="console-index">${index}</span></div>
        <input type="text" class="console-channel-name" data-change="track-name" aria-label="Channel name for ${label}" title="Double-click to rename ${label}" maxlength="120" value="${label}" readonly>
      </footer></div>`;
  }
  function consolePreset(id){
    const name=id.startsWith('factory:')?id.slice(8):null;
    if(name&&Object.hasOwn(SW.presets,name))return {name,chain:SW.presets[name].map(([type,params])=>({type,params,bypass:false}))};
    if(id.startsWith('user:'))return acceptedConsolePresets[Number(id.slice(5))];
  }
  function applyConsolePreset(t,chain){
    for(const current of [...t.fx])SW.removeEffect(t,current.id);
    for(const entry of chain){
      const insert=effect(entry.type);
      Object.assign(insert.params,entry.params);
      insert.bypass=entry.bypass;
      SW.addEffect(t,insert);
    }
  }
  function loadConsolePreset(t,id){
    const preset=consolePreset(id);
    if(preset)edit(()=>applyConsolePreset(t,preset.chain),'Loaded FX chain '+preset.name);
  }
  function saveConsolePreset(t){
    if(!t.fx.length)return;
    if(t.fx.length>64){status('Save up to 64 inserts in one FX chain.',true);return;}
    const name=prompt('FX chain name',t.name+' chain')?.trim().slice(0,80);
    if(!name)return;
    const item={name,chain:t.fx.map(({type,bypass,params})=>({type,bypass,params:clone(params)}))};
    const same=acceptedConsolePresets.findIndex(row=>row.name===name);
    if(same>=0)acceptedConsolePresets[same]=item;
    else if(acceptedConsolePresets.length<64)acceptedConsolePresets.push(item);
    else {status('The user FX chain collection is full.',true);return;}
    remember('sw-console-presets',acceptedConsolePresets);
    renderDock();status('Saved FX chain '+name);
  }
  function renderMixer(){
    const tracks=[...p.tracks,p.master].filter(t=>{
      if(mixerFilter==='hidden') return t.hidden;
      return !t.hidden&&(mixerFilter==='all'||t.type===mixerFilter||t.id==='master');
    });
    const filters=[['all','All'],['audio','Audio'],['midi','Instrument'],['bus','Bus'],['hidden','Hidden']];
    const scenes=p.mixScenes||[];
    if(!scenes.some(s=>s.id===sceneId)) sceneId=scenes[0]?.id||'';
    const controls=[['mixer-size',mixerWide?'Standard strips':'Wide strips'],['mixer-dim','Toggle dim solo'],['mixer-unmute','Unmute all'],
      ['mixer-unsolo','Unsolo all'],['mixer-peak','Reset peaks'],['fx-bus','Add FX return'],['mixer-add-bus','Add bus'],['mixer-devices','Toggle devices'],
      ['save-scene','Save scene'],...(sceneId?[['recall-scene','Recall scene'],['delete-scene','Delete scene']]:[])];
    const tools='<div class="editor-toolbar mixer-tools"><strong>Console</strong>'+
      select('mixer-filter','Channels',filters.map(([key,name])=>option(key,name,mixerFilter)).join(''))+
      select('mixer-action','Actions',[option('','Choose…',''),...controls.map(([key,name])=>option(key,name))].join(''))+
      select('mixer-scene','Scene',scenes.length?scenes.map(s=>option(s.id,s.name,sceneId)).join(''):option('','No scenes',''))+'</div>';
    return '<div class="mix-console">'+tools+deviceShelf()+'<div class="mixer-viewport" tabindex="0" role="region" aria-label="Mixer channels, scroll sideways">'+
      '<div class="mixer">'+tracks.map(renderConsoleStrip).join('')+'</div></div></div>';
  }
  let noteTools='arrow', noteInspectorOpen=true, velocityLaneOpen=true;
  let pianoRoot=0, pianoScale='chromatic', pianoSnapScale=false, pianoGrid='inherit', pianoSwing=55;
  function notesGrid(){
    return pianoGrid==='inherit'?step():Number(pianoGrid);
  }
  function noteTime(at,free=false){
    const grid=notesGrid();
    return free||!grid?at:quantize(at,grid);
  }
  function notePitch(pitch){
    return pianoSnapScale?SW.scalePitch(pitch,pianoRoot,pianoScale):clamp(Math.round(pitch),0,127);
  }
  function exactNotes(c){
    return c.notes.filter(n=>notePicked.has(n.id)||n.id===noteId);
  }
  function chooseNotes(ids,anchor=ids.at(-1)||null){
    notePicked=new Set(ids);noteId=anchor;
  }
  function pianoMetrics(c){
    const fitted=immersiveEditor()?($('dock').clientWidth-59)/c.length:0;
    const scale=Math.min(800,Math.max(48,zoom,fitted));
    return {scale,width:Math.max(130,c.length*scale)};
  }
  function renderPianoControls(c){
    const buttons=['arrow','draw','split','erase','mute','listen'].map(key=>
      toggle('note-tool',toolsList[key],toolsList[key]+' note tool'+(commandKey('tool-'+key)?' ('+commandKey('tool-'+key)+')':''),noteTools===key,'data-key="'+key+'"')).join('');
    const grid=[['inherit','Follow arrangement'],['0','Free'],['.125','1/32'],['.25','1/16'],['.5','1/8'],['1','1/4'],['2','1/2']];
    const mode=select('piano-grid','Note grid',grid.map(([id,label])=>option(id,label,pianoGrid)).join(''));
    const scales=select('piano-scale','Scale',Object.entries(SW.pianoScales).map(([id,[label]])=>option(id,label,pianoScale)).join(''));
    const roots=select('piano-root','Root',Array.from({length:12},(_,id)=>option(String(id),noteName(id).replace(/-?\d+$/,''),String(pianoRoot))).join(''));
    return '<div class="piano-toolbar editor-toolbar" data-note-tools aria-label="Piano roll tools">'+buttons+
      '<span class="piano-separator"></span>'+mode+roots+scales+toggle('note-scale-snap','Scale snap','Constrain new and dragged pitches to the scale',pianoSnapScale)+
      toggle('note-inspector','Properties','Show selected note properties',noteInspectorOpen)+
      toggle('note-velocity-lane','Velocity lane','Show the velocity lane',velocityLaneOpen)+'</div>'+
      (noteInspectorOpen?renderSelectedNoteProps(c):'');
  }
  function renderSelectedNoteProps(c){
    const group=exactNotes(c), n=group.find(item=>item.id===noteId)||group[0];
    if(!n)return '<div class="piano-properties" data-note-tools><span>Select notes to edit their properties.</span></div>';
    const prop=(key,label,value,min,max,step)=>field('note-prop-'+key,label,value,min,max,step);
    return '<div class="piano-properties" data-note-tools><strong>'+group.length+' '+(group.length===1?'note':'notes')+'</strong>'+
      prop('pitch','Pitch',n.pitch,0,127,1)+prop('start','Start beat',fmt(n.start+1,5),1,c.length+1,'any')+
      prop('length','Beats',fmt(n.length,5),.001,c.length,'any')+
      prop('velocity','Velocity',Math.round(n.velocity*127),1,127,1)+
      toggle('note-prop-mute','Mute','Mute or unmute selected notes',group.every(n=>n.muted))+
      (c.locked?'<span class="muted-text">Part locked</span>':'')+'</div>';
  }
  function renderVelocityLane(c){
    const {scale,width}=pianoMetrics(c);
    const values=c.notes.map(n=>{
      const selected=notePicked.has(n.id)||n.id===noteId, value=Math.round(n.velocity*127);
      return `<button type="button" data-velocity-note="${n.id}" class="velocity-bar ${selected?'selected':''}"
        aria-label="${esc(noteName(n.pitch))} velocity ${value}" title="${esc(noteName(n.pitch))} · velocity ${value}"
        style="left:${n.start*scale}px;height:${Math.max(4,n.velocity*100)}%;width:${clamp(n.length*scale,6,12)}px"></button>`;
    }).join('');
    return `<div class="piano-velocity" data-note-tools><strong>Velocity</strong>
      <div class="velocity-track" aria-label="Piano roll velocity lane"><div class="velocity-grid" style="width:${width}px;--beat:${scale}px">${values}</div></div></div>`;
  }
  function setNoteProperty(property,raw){
    const c=editorClip(), value=Number(raw);
    if(c?.type!=='midi'||c.locked||!String(raw).trim()||!Number.isFinite(value))return;
    const group=exactNotes(c), anchor=group.find(n=>n.id===noteId)||group[0];
    if(!anchor)return;
    let updates;
    if(property==='pitch')updates=SW.moveNotes(group,c.length,0,clamp(Math.round(value),0,127)-anchor.pitch);
    if(property==='start')updates=SW.moveNotes(group,c.length,value-1-anchor.start);
    if(property==='length')updates=group.map(n=>({...n,length:clamp(value,Math.min(.001,n.length),Math.max(Math.min(.001,n.length),c.length-n.start))}));
    if(property==='velocity')updates=group.map(n=>({...n,velocity:clamp(Math.round(value),1,127)/127}));
    if(!updates||!updates.some((n,i)=>n[property]!==group[i][property]))return;
    const actual=updates.find(n=>n.id===anchor.id);
    const reading=property==='start'?fmt(actual.start+1,5):property==='pitch'?noteName(actual.pitch):
      property==='velocity'?Math.round(actual.velocity*127):fmt(actual.length,5)+' beats';
    edit(()=>updates.forEach((n,i)=>Object.assign(group[i],n)),valueStatus(currentTrack().name,property[0].toUpperCase()+property.slice(1),reading));
    find('[data-change="note-prop-'+property+'"]')?.focus({preventScroll:true});
  }
  function pianoAction(el){
    const {action,key}=el.dataset;
    if(action==='note-tool')noteTools=key;
    else if(action==='note-scale-snap')pianoSnapScale=!pianoSnapScale;
    else if(action==='note-inspector')noteInspectorOpen=!noteInspectorOpen;
    else if(action==='note-velocity-lane')velocityLaneOpen=!velocityLaneOpen;
    else if(action==='note-prop-mute'){
      const c=editorClip(), notes=c?.type==='midi'&&!c.locked?exactNotes(c):[];
      if(!notes.length)return true;
      const mute=notes.some(n=>!n.muted);
      edit(()=>notes.forEach(n=>n.muted=mute),(mute?'Muted ':'Unmuted ')+notes.length+' notes');return true;
    }else return false;
    editorFocus={kind:'notes'};
    renderDock(false);return true;
  }
  function renderPiano(){
    const c=editorClip();
    if(!c||c.type!=='midi') return '<p class="empty">Double-click an instrument clip to open its notes.</p>';
    const maxPitch=c.notes.length?c.notes.reduce((high,n)=>Math.max(high,n.pitch),0):64;
    const minPitch=c.notes.length?c.notes.reduce((low,n)=>Math.min(low,n.pitch),127):48;
    rollTop=Math.min(127,Math.max(60,maxPitch+3));
    const low=Math.max(0,Math.min(48,minPitch-6));
    const {scale,width}=pianoMetrics(c), rows=rollTop-low+1;
    const rulerStep=Math.max(1,Math.ceil(c.length/220),scale<70?2:1);
    let ruler='<div class="piano-ruler" style="width:'+(width+59)+'px"><strong>Beat</strong><div>';
    for(let at=0;at<c.length;at+=rulerStep)ruler+='<span style="left:'+at*scale+'px">'+fmt(at+1)+'</span>';
    let html=ruler+'</div></div><div class="piano-layout"><div class="keys">';
    for(let pitch=rollTop;pitch>=low;pitch--){
      const name=noteName(pitch);
      html+=`<div class="key ${name.includes('♯')?'dark':''} ${pitch%12===0?'c':''}" role="button" tabindex="0" data-action="audition-note" data-pitch="${pitch}" aria-label="Play ${name}">${name}</div>`;
    }
    const grid=notesGrid()||1;
    html+=`</div><div class="roll" tabindex="0" aria-label="Piano roll" data-roll data-low="${low}" data-note-tool="${noteTools}" data-scale="${scale}" style="width:${width}px;height:${rows*16}px;--beat:${scale}px;--meter:${p.meter};--note-grid:${grid*scale}px">`;
    for(let pitch=rollTop;pitch>=low;pitch--){
      const marked=pianoScale!=='chromatic'&&SW.inScale(pitch,pianoRoot,pianoScale);
      html+='<span class="pitch-row '+(noteName(pitch).includes('♯')?'dark ':'')+(marked?'in-scale':'')+
        '" style="top:'+(rollTop-pitch)*16+'px"></span>';
    }
    for(const n of c.notes){
      html+=`<span tabindex="0" class="pnote ${n.id===noteId||notePicked.has(n.id)?'selected':''} ${n.muted?'muted':''} ${SW.inScale(n.pitch,pianoRoot,pianoScale)?'':'outside-scale'}" data-note="${n.id}" title="${noteName(n.pitch)} · Velocity ${Math.round(n.velocity*127)}" style="left:${n.start*scale}px;top:${(rollTop-n.pitch)*16+1}px;width:${n.length*scale}px;opacity:${.46+n.velocity*.54}"><i data-edge="left"></i><i data-edge="right"></i></span>`;
    }
    return html+'<span class="playline" data-piano-playline></span></div></div>';
  }
  function renderAutomation(){
    const t=currentTrack(), specs=laneSpecs(t);
    if(!Object.hasOwn(specs,autoKey)) autoKey='volume';
    const dock=$('dock'), large=immersiveEditor(), span=total();
    const scale=Math.max(zoom,large?(dock.clientWidth-6)/span:0);
    const spec=specs[autoKey], [,min,max]=spec, points=t.lanes[autoKey]||[], width=Math.max(390,Math.ceil(span*scale)), height=large?Math.max(158,dock.clientHeight-49):158, back=height-17;
    const y=v=>10+(max-v)/(max-min)*(back-10), x=at=>Math.min(width-2,Math.max(2,at*scale));
    const options=Object.entries(specs).map(([key,param])=>option(key,param[0],autoKey)).join('');
    let path=points.length?`M0,${y(points[0].value)} `+points.map(n=>`L${x(n.at)},${y(n.value)}`).join(' ')+` L${width},${y(points.at(-1).value)}`:`M0,${y(laneValue(t,autoKey))} H${width}`;
    let grid='';
    for(let i=0;i<total();i+=Math.max(p.meter,Math.ceil(total()/300/p.meter)*p.meter)){
      grid+=`<line x1="${x(i)}" y1="0" x2="${x(i)}" y2="${height}" stroke="#344458"/><text x="${x(i)+4}" y="${height-5}" fill="#94a4b5" font-size="10">${1+i/p.meter}</text>`;
    }
    for(let i=0;i<=4;i++){
      const value=min+(max-min)*i/4;
      grid+=`<line x1="0" y1="${y(value)}" x2="${width}" y2="${y(value)}" stroke="#2b394a"/>`;
    }
    return `<div class="automation-wrap"><div class="editor-toolbar"><strong>${esc(t.name)}</strong><label>Parameter <select data-change="auto-lane" aria-label="Automation parameter">${options}</select></label>${button('add-auto-point','Add at playhead','Add point at playhead')}${button('clear-lane','Clear','Clear automation lane',points.length?'':'disabled')}<span class="muted-text">${esc(fmt(min,4)+' to '+fmt(max,4)+' '+spec[4])}</span></div>
    <div class="automation-viewport"><svg class="envelope" data-envelope data-scale="${scale}" data-back="${back}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="${esc(spec[0])} automation">${grid}<path d="${path}" fill="none" stroke="#7ee2c4" stroke-width="1.6"/>${points.map((n,i)=>`<circle class="point" data-point="${i}" tabindex="0" cx="${x(n.at)}" cy="${y(n.value)}" r="5"><title>Beat ${fmt(n.at+1)} · ${fmt(n.value,4)} ${esc(spec[4])}</title></circle>`).join('')}<line data-auto-playline x1="0" y1="0" x2="0" y2="${height}" stroke="#fff" pointer-events="none"/></svg></div></div>`;
  }
  let highlightedPoolAsset=null;
  function renderMedia(){
    const rows=Object.entries(p.assets);
    if(!rows.length) return '<p class="empty">Imported audio and new recordings appear here.</p>';
    return '<table class="media-table"><thead><tr><th>Audio source</th><th>Duration</th><th>Actions</th></tr></thead><tbody>'+rows.map(([id,a])=>`<tr data-asset="${id}" tabindex="0" class="${id===highlightedPoolAsset?'pool-highlight':''}"><td>${esc(a.name)}</td><td>${fmt(a.duration)} s</td><td>${button('preview-asset','Preview')}${button('place-asset','Place at playhead')}${button('remove-asset','Remove')}</td></tr>`).join('')+'</tbody></table>';
  }
  function allClips(){return p.tracks.flatMap(t=>t.clips.map(c=>({t,c})));}
  function selectedClips(){return picked.size?allClips().filter(({c})=>picked.has(c.id)):foundClip()?[foundClip()]:[];}
  function selectMany(rows){
    const first=rows[0];
    if(first) selectClip(first.t,first.c,false);
    else {clipId=null;noteId=null;notePicked.clear();}
    picked=new Set(rows.map(row=>row.c.id));
    renderSelections();renderInspector();renderDock();
  }
  function selectionRange(){
    if(editRange) return editRange;
    const rows=selectedClips();
    if(!rows.length) return null;
    return {from:Math.min(...rows.map(({c})=>c.start)),to:Math.max(...rows.map(({c})=>c.start+c.length)),t:rows[0].t.id};
  }
  const fadeSides=[['fadeIn','Fade in'],['fadeOut','Fade out']];
  function fadePath(c,key,length=c[key]){
    const endpoint=1000*clamp(length/c.length,0,1), left=key==='fadeIn';
    if(endpoint<=0)return '';
    const samples=Array.from({length:25},(_,i)=>{
      const pos=i/24;
      return (left?pos*endpoint:1000-pos*endpoint)+','+(100-99*SW.fadeLevel(c[key+'Shape'],pos));
    });
    return 'M'+samples.join(' L')+' L'+(left?endpoint:1000-endpoint)+',100 Z';
  }
  function waveOverlay(c){
    const limit=c.locked?' disabled':'';
    return '<svg class="wave-fades" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">'+
      fadeSides.map(([key])=>`<path data-fade-path="${key}" d="${fadePath(c,key)}"></path>`).join('')+'</svg>'+
      fadeSides.map(([key,label])=>`<button type="button" data-fade-handle="${key}" role="slider" aria-label="${label} duration in milliseconds" aria-valuemin="0" aria-valuemax="${Math.round(seconds(Math.max(0,c.length-c[key==='fadeIn'?'fadeOut':'fadeIn']),p.bpm)*1000)}" aria-valuenow="${Math.round(seconds(c[key],p.bpm)*1000)}" title="${label}. Drag, or use arrow keys." style="--fade-edge:${100*clamp(c[key]/c.length,0,1)}%"${limit}><span aria-hidden="true">${key==='fadeIn'?'◢':'◣'}</span></button>`).join('');
  }
  function waveEditor(c){
    const limit=c.locked?' disabled':'';
    const shapeOptions=key=>Object.entries(SW.fadeShapes).map(([id,name])=>option(id,name,c[key+'Shape']||'linear')).join('');
    const value=(kind,label,value,min,max,step)=>`<label>${label}<input type="number" data-change="${kind}" aria-label="${label}" value="${fmt(value,4)}" min="${min}" max="${max}" step="${step}"${limit}></label>`;
    return '<div class="wave-editor"><div class="wave-surface"><canvas id="editor-wave" aria-label="Audio waveform. Click to position playhead"></canvas>'+
      waveOverlay(c)+
      '</div><div class="wave-controls">'+fadeSides.map(([key,label])=>`<div>${value('wave-'+key,label+' (ms)',seconds(c[key],p.bpm)*1000,0,Math.ceil(seconds(c.length,p.bpm)*1000),'any')}
      <select data-change="wave-${key}Shape" aria-label="${label} curve"${limit}>${shapeOptions(key)}</select></div>`).join('')+
      value('wave-gain','Event gain (dB)',c.gain,-60,24,.1)+'</div></div>';
  }
  function fadeDuration(c,key,value){
    const other=key==='fadeIn'?'fadeOut':'fadeIn';
    return Math.min(Math.max(0,c.length-c[other]),round(Math.max(0,value)));
  }
  function setWaveFade(c,key,duration){
    const next=fadeDuration(c,key,duration);
    if(!c.locked&&next!==c[key])edit(()=>{c[key]=next;},
      valueStatus(c.name,key==='fadeIn'?'Fade in':'Fade out',seconds(next,p.bpm)*1000,'ms'));
  }
  function waveFadeKey(event){
    const grip=event.target.closest?.('[data-fade-handle]');
    if(!grip||isEditing())return false;
    const container=grip.closest('[data-clip]');
    const c=container?foundClip(container.dataset.clip)?.c:editorClip();
    if(c?.type!=='audio'||c.locked)return false;
    const key=grip.dataset.fadeHandle, step=(event.shiftKey?50:5)*p.bpm/60000;
    const amount={ArrowRight:step,ArrowUp:step,ArrowLeft:-step,ArrowDown:-step,Home:-c.length,End:c.length}[event.key];
    if(amount===undefined)return false;
    event.preventDefault();setWaveFade(c,key,c[key]+amount);
    find((container?'[data-clip="'+c.id+'"] ':'.wave-surface ')+'[data-fade-handle="'+key+'"]')?.focus({preventScroll:true});
    return true;
  }
  function actionButtons(entries){
    return entries.map(([id,label])=>'<button type="button" data-cmd="'+id+'">'+esc(label)+'</button>').join('');
  }
  let editPage='notes', expressionKey='velocity';
  const expressionMark=(key,spec,value)=>key==='bend'?fmt((value<0?value/8192:value/8191)*SW.instrumentSettings(currentTrack()).bendRange,2)+' st':
    key==='cc64'?(value>=64?'Down':'Up'):fmt(value,4)+(spec[4]?' '+spec[4]:'');
  function renderExpression(c,t){
    const specs=SW.expressionSpecs(t);
    if(!Object.hasOwn(specs,expressionKey)) expressionKey='velocity';
    const key=expressionKey, spec=specs[key], [,min,max,increment]=spec;
    const lane=c.expression?.[key]||[], selected=selectedNotes(c);
    const at=clamp(playhead-c.start,0,c.length), width=Math.max(460,c.length*48,immersiveEditor()?$('dock').clientWidth-34:0);
    const drawX=beat=>clamp(beat/c.length*100,0,100);
    const drawY=value=>100-(value-min)/(max-min)*100;
    const points=key==='velocity'?c.notes.map(n=>({at:n.start,value:Math.round(n.velocity*127),id:n.id})):lane;
    const mode=['attack','decay','release','sustain','root','start','pitch','noise','tune','bendRange','vibrato','level'].includes(key.slice(5))&&key.startsWith('inst:')?'Applied on note-on':
      key==='velocity'?'Per-note value':key==='cc64'?'On or off · channel-wide':'Channel-wide';
    const noteNames=new Map(c.notes.map(n=>[n.id,SW.noteName(n.pitch)]));
    const marks=points.map(point=>'<button type="button" class="expression-dot'+(point.id?' velocity-dot':'')+'" data-expression-at="'+point.at+'"'+
      (point.id?' data-expression-note="'+point.id+'"':'')+' style="--point-x:'+drawX(point.at)+'%;--point-y:'+drawY(point.value)+
      '%" aria-label="'+esc(spec[0]+' '+point.value+' at beat '+fmt(point.at+1,4))+'" title="'+esc((point.id?noteNames.get(point.id)+' · ':'')+spec[0]+' '+point.value)+'"></button>').join('');
    const spans=c.notes.map(n=>'<span class="expression-note-span'+(selected.includes(n)?' selected':'')+'" style="left:'+drawX(n.start)+'%;width:'+drawX(n.length)+'%" title="'+esc(SW.noteName(n.pitch)+' · beat '+fmt(n.start+1,4))+'"></span>').join('');
    const noteButtons=c.notes.map(n=>'<button type="button" data-expression-at="'+n.start+'" data-expression-note="'+n.id+'" aria-pressed="'+
      (notePicked.has(n.id)||noteId===n.id)+'" title="'+esc(noteNames.get(n.id)+' · beat '+fmt(n.start+1,4))+'">'+esc(noteNames.get(n.id))+
      ' <small>'+fmt(n.start+1,3)+'</small></button>').join('');
    const axes='<span class="expression-cursor" data-expression-cursor style="left:'+drawX(at)+'%"></span>';
    const getValue=beat=>SW.pointValue(lane,beat,spec[5]??0,key==='cc64');
    const cursorValue=()=>selected[0]&&key==='velocity'?Math.round(selected[0].velocity*127):getValue(at);
    const noteRows=selected.map(n=>{
      const start=key==='velocity'?Math.round(n.velocity*127):getValue(n.start);
      const change=key==='velocity'?[]:lane.filter(pt=>pt.at>n.start&&pt.at<Math.min(c.length,n.start+n.length));
      const values=change.map(pt=>expressionMark(key,spec,pt.value));
      const startLabel=expressionMark(key,spec,start);
      return '<li><strong>'+esc(noteName(n.pitch))+'</strong> · beat '+fmt(n.start+1,4)+' · '+esc(startLabel)+
        (values.length?' → '+esc(values.slice(0,4).join(' → '))+(values.length>4?' …':''):'')+'</li>';
    }).join('');
    const options=Object.entries(specs).map(([id,details])=>option(id,(id.startsWith('inst:')?t.instrument+' · ':'')+details[0],key)).join('');
    const rows=lane.map((point,i)=>'<tr tabindex="0" data-expression-delete="'+i+'"><td>'+fmt(point.at+1,7)+'</td><td><input type="number" aria-label="Point '+(i+1)+' value" data-change="expression-value" data-expression-index="'+i+'" min="'+min+'" max="'+max+'" step="'+increment+'" value="'+point.value+'"></td>'+
      '<td>'+button('expression-remove','Remove','Remove this point','data-expression-index="'+i+'"')+'</td></tr>').join('');
    return '<section class="expression-editor"><div class="editor-toolbar">'+select('expression-lane','Lane',options)+
      '<span class="muted-text">'+esc(mode)+'</span>'+button('gear-inst','Instrument controls')+'</div>'+
      '<div class="expression-plot-scroll"><div class="expression-plot" data-expression-plot style="width:'+width+'px;--part-beat:'+drawX(1)+'%">'+spans+axes+marks+'</div></div>'+
      '<nav class="expression-note-choices" aria-label="Notes in this part">'+noteButtons+'</nav>'+
      '<div class="expression-fields"><label>Clip beat <input id="expression-time" type="number" min="1" max="'+(1+c.length)+'" step="any" value="'+fmt(at+1,7)+'"></label>'+
      '<label>'+esc(spec[0])+' <input id="expression-number" type="number" min="'+min+'" max="'+max+'" step="'+increment+'" value="'+fmt(cursorValue(),7)+'"></label>'+
      (key==='velocity'?button('expression-set','Apply to selected notes','Apply velocity to selected notes',selected.length?'':'disabled'):
        button('expression-set','Add / update point')+button('expression-at-note','At selected note','Add a point at the start of each selected note',selected.length?'':'disabled')+button('expression-clear','Clear lane','Remove all points in this lane',lane.length?'':'disabled'))+
      '</div><div class="expression-selection"><strong>Selected notes · '+selected.length+'</strong>'+
      (noteRows?'<ul>'+noteRows+'</ul>':'<p>Choose a note in the piano roll or timeline to inspect its values.</p>')+'</div>'+
      (rows?'<table class="browser-table expression-table"><thead><tr><th>Clip beat</th><th>Value</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>':'')+'</section>';
  }
  function expressionAction(el){
    const action=el.dataset.action;
    if(!action?.startsWith('expression-'))return false;
    if(action==='expression-page'){
      editPage=el.dataset.key;rollChanged=false;
      editorFocus=editPage==='notes'||expressionKey==='velocity'?{kind:'notes'}:
        {kind:'expression',clip:editorClip()?.id,lane:expressionKey};
      renderDock();return true;
    }
    const c=editorClip();
    if(c?.type!=='midi'||c.locked)return true;
    const key=expressionKey, lane=c.expression?.[key]||[];
    const value=$('expression-number')?.valueAsNumber;
    const at=($('expression-time')?.valueAsNumber??NaN)-1;
    if(action==='expression-clear'&&lane.length){edit(()=>{delete c.expression[key];},'Cleared MIDI automation lane');return true;}
    if(action==='expression-remove'){
      const i=Number(el.dataset.expressionIndex);
      if(lane[i])edit(()=>lane.splice(i,1),'Removed MIDI automation point');
      return true;
    }
    if(!Number.isFinite(value)){status('Enter a numeric automation value.',true);return true;}
    if(key==='velocity'){
      const notes=selectedNotes(c);
      if(notes.length)edit(()=>{for(const n of notes)n.velocity=clamp(Math.round(value),1,127)/127;},'Set note velocity');
    }else if(action==='expression-at-note'){
      const notes=selectedNotes(c);
      if(notes.length)edit(()=>{for(const n of notes)SW.setExpression(c,key,n.start,value);},'Added automation at note starts');
    }else if(Number.isFinite(at)){
      edit(()=>SW.setExpression(c,key,at,value),'Edited MIDI automation');
    }
    return true;
  }
  function expressionClick(event){
    const plot=event.target.closest('[data-expression-plot]');
    const point=event.target.closest('[data-expression-at]');
    if((!plot&&!point)||isEditing())return false;
    const c=editorClip();
    if(c?.type!=='midi')return true;
    if(point){
      const id=point.dataset.expressionNote;
      if(id){
        if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey)notePicked.clear();
        if(notePicked.has(id)){notePicked.delete(id);noteId=null;}
        else {notePicked.add(id);noteId=id;}
        renderDock();
      }else{
        const at=Number(point.dataset.expressionAt);
        $('expression-time').value=fmt(at+1,7);
        $('expression-number').value=c.expression?.[expressionKey]?.find(row=>row.at===at)?.value??0;
      }
      return true;
    }
    if(expressionKey==='velocity'||c.locked)return true;
    const rect=plot.getBoundingClientRect();
    const raw=c.length*(event.clientX-rect.left)/rect.width;
    const at=clamp(event.altKey?raw:sn(raw+c.start)-c.start,0,c.length);
    const [,min,max]=SW.expressionSpecs(currentTrack())[expressionKey];
    const value=max-(max-min)*(event.clientY-rect.top)/rect.height;
    edit(()=>SW.setExpression(c,expressionKey,at,value),'Added MIDI automation point');
    return true;
  }

  let macroList=[];
  for(const row of [].concat(readSettings('sw-macros',[])).slice(0,100)){
    try{macroList.push(SW.validateMacro(row));}catch{}
  }
  let macroDraft=null, macroChoice='', macroPage='events', arrangerMacros=false, editorMacros=false, editorControls=false;
  const macros=()=>[...SW.factoryMacros,...macroList];
  const editorPage=()=>editorClip()?.type==='midi'?'notes':editorClip()?.type==='audio'?'audio':'events';
  function macroToolbar(page){
    const scope=page==='events'?macroPage:page;
    const pages=page==='events'?select('macro-page','Page',Object.entries(SW.macroPages).map(([id,name])=>option(id,name,scope)).join('')):'';
    return '<div class="macro-toolbar">'+pages+
      select('macro-run','Macro',[option('','Run macro…',''),...macros().filter(item=>item.scope===scope).map(item=>option(item.id,item.name))].join(''))+
      button('macro-open','Organizer','Open Macro Organizer')+'</div>';
  }
  function redrawMacroToolbars(){
    $('arranger-macros').hidden=!arrangerMacros;
    if(arrangerMacros)$('arranger-macros').innerHTML=macroToolbar('events');
    $('macro-arrange-toggle').setAttribute('aria-pressed',arrangerMacros);
    if(tab==='edit')renderDock(false);
  }
  function openMacroOrganizer(){
    macroChoice='';macroDraft=null;renderMacroOrganizer();
    window.focus?.();
    if(!$('macro-dialog').open)$('macro-dialog').showModal();
  }
  function renderMacroOrganizer(){
    const list=[option('','Choose a macro',''),...macros().map(m=>option(m.id,SW.macroPages[m.scope]+' · '+m.name,macroChoice))].join('');
    const selected=macros().find(m=>m.id===macroChoice);
    const draft=macroDraft;
    const listActions=button('macro-new','New')+(selected?
      button('macro-edit',SW.factoryMacros.includes(selected)?'Duplicate':'Edit')+
      (SW.factoryMacros.includes(selected)?'':button('macro-delete','Delete'))+button('macro-run-current','Run'):'');
    const rows=(draft?.steps||[]).map((entry,i)=>{
      const operation=SW.macroOperations[entry.id];
      const range=operation.range;
      return '<li data-macro-index="'+i+'"><strong>'+esc(operation.label)+'</strong>'+
        (range?'<label><input type="number" aria-label="'+esc(operation.label+' value')+'" data-change="macro-value" min="'+range[0]+'" max="'+range[1]+'" step="'+range[3]+'" value="'+entry.value+'">'+esc(operation.unit)+'</label>':'')+
        button('macro-up','↑','Move command up',i===0?'disabled':'')+button('macro-down','↓','Move command down',i===draft.steps.length-1?'disabled':'')+
        button('macro-remove','×','Remove command')+'</li>';
    }).join('');
    const form=draft?'<div class="macro-draft">'+field('macro-name','Name',draft.name)+
      select('macro-scope','Page',Object.entries(SW.macroPages).map(([id,name])=>option(id,name,draft.scope)).join(''))+
      select('macro-add-step','Add command',[option('','Choose command…',''),...Object.entries(SW.macroOperations).filter(([,op])=>op.scope.includes(draft.scope)).map(([key,op])=>option(key,op.label))].join(''))+
      '<ol>'+rows+'</ol><div class="controls">'+button('macro-save','Save macro','Save macro','class="accent"')+button('macro-cancel','Cancel')+'</div></div>':'';
    $('macro-body').innerHTML='<div class="macro-organizer"><div class="macro-library">'+select('macro-select','Macros',list)+
      '<div class="controls">'+listActions+'</div></div>'+form+
      '<div class="macro-transfer">'+button('macro-import','Import JSON…')+button('macro-export','Export user macros')+'</div><p id="macro-message" role="status"></p></div>';
  }
  function applyMacroToSelection(macro){
    if(isEditing())return;
    const original=p, scope=macro.scope;
    const active=tab==='edit'&&scope!=='events'?editorClip():activeClip();
    const clips=selectedClips().map(({c})=>c.id);
    if(!clips.length&&scope==='audio'&&active?.type==='audio')clips.push(active.id);
    try{
      const result=SW.applyMacro(p,macro,{track:trackId,part:active?.id,clips,notes:[...notePicked],cursor:playhead,grid:step()});
      if(result.changed){
        SW.validateProject(result.project);p=result.project;
      }
      if(scope==='notes'&&active?.type==='midi'){
        notePicked=new Set(result.notes);noteId=result.notes.at(-1)||null;
      }else if(scope!=='notes'){
        const rows=allClips().filter(({c})=>result.clips.includes(c.id));
        selectMany(rows);
      }
      if(result.changed)commit(original,'Ran '+macro.name);
      else {render();status('Ran '+macro.name+' · no project changes');}
      if($('macro-dialog').open)$('macro-dialog').close();
    }catch(error){
      p=original;
      if($('macro-dialog').open)$('macro-message').textContent=error.message;
      else status(error.message,true);
    }
  }
  function macroInput(el){
    const {change:key}=el.dataset,str=el.value;
    switch(key){
      case 'macro-run': {
        const item=macros().find(m=>m.id===str);
        el.value='';if(item)applyMacroToSelection(item);return true;
      }
      case 'macro-page':macroPage=str;redrawMacroToolbars();return true;
      case 'macro-select':macroChoice=str;macroDraft=null;renderMacroOrganizer();return true;
      case 'macro-name':if(macroDraft)macroDraft.name=str;return true;
      case 'macro-scope':
        if(macroDraft&&Object.hasOwn(SW.macroPages,str)){
          macroDraft.scope=str;macroDraft.steps=macroDraft.steps.filter(step=>SW.macroOperations[step.id].scope.includes(str));renderMacroOrganizer();
        }
        return true;
      case 'macro-add-step':
        if(macroDraft&&macroDraft.steps.length<32&&Object.hasOwn(SW.macroOperations,str)&&SW.macroOperations[str].scope.includes(macroDraft.scope)){
          const range=SW.macroOperations[str].range;
          macroDraft.steps.push(range?{id:str,value:range[2]}:{id:str});renderMacroOrganizer();
        }
        return true;
      case 'macro-value': {
        const row=macroDraft?.steps[Number(el.closest('[data-macro-index]')?.dataset.macroIndex)];
        if(row){
          const [min,max,,increment]=SW.macroOperations[row.id].range;
          if(str.trim()&&Number.isFinite(Number(str)))row.value=clamp(round(Math.round(Number(str)/increment)*increment),min,max);
          el.value=row.value;
        }
        return true;
      }
    }
    return false;
  }
  function macroAction(el){
    const action=el.dataset.action;
    if(!action.startsWith('macro-'))return false;
    const selected=macros().find(m=>m.id===macroChoice);
    if(action==='macro-open'){openMacroOrganizer();return true;}
    if(action==='macro-toggle-editor'){editorMacros=!editorMacros;redrawMacroToolbars();return true;}
    if(action==='macro-import'){$('macro-file').click();return true;}
    if(action==='macro-export'){
      download(JSON.stringify({format:'Sonoravell Macros',version:1,macros:macroList},null,2),'Sonoravell macros.json','application/json');return true;
    }
    if(action==='macro-run-current'){if(selected)applyMacroToSelection(selected);return true;}
    if(action==='macro-new')macroDraft={id:uid(),name:'',scope:tab==='edit'?editorPage():macroPage,steps:[]};
    if(action==='macro-edit'&&selected){
      macroDraft=clone(selected);
      if(SW.factoryMacros.includes(selected)){macroDraft.id=uid();macroDraft.name=(macroDraft.name+' copy').slice(0,70);}
    }
    if(action==='macro-cancel')macroDraft=null;
    if(action==='macro-delete'&&selected&&!SW.factoryMacros.includes(selected)&&confirm('Delete macro '+selected.name+'?')){
      macroList=macroList.filter(item=>item.id!==selected.id);macroChoice='';macroDraft=null;remember('sw-macros',macroList);redrawMacroToolbars();
    }
    if(action==='macro-save'&&macroDraft){
      try{
        const item=SW.validateMacro(macroDraft), index=macroList.findIndex(m=>m.id===item.id);
        if(index>=0)macroList[index]=item;
        else if(macroList.length<100)macroList.push(item);
        else throw Error('The macro library has reached 100 entries.');
        macroChoice=item.id;macroDraft=null;remember('sw-macros',macroList);redrawMacroToolbars();
      }catch(error){$('macro-message').textContent=error.message;return true;}
    }
    if(macroDraft&&['macro-remove','macro-up','macro-down'].includes(action)){
      const index=Number(el.closest('[data-macro-index]')?.dataset.macroIndex),steps=macroDraft.steps;
      if(steps[index]){
        const next=index+(action==='macro-up'?-1:1);
        if(action==='macro-remove')steps.splice(index,1);
        else if(steps[next])[steps[index],steps[next]]=[steps[next],steps[index]];
      }
    }
    renderMacroOrganizer();return true;
  }

  function renderEdit(){
    const c=editorClip(), r=editRange, t=currentTrack();
    const events=[['split','Split'],['duplicate','Duplicate'],['repeat','Repeat…'],['mute-event','Mute'],['lock-event','Lock'],['nudge-left','Nudge ←'],['nudge-right','Nudge →'],['align','Align to cursor'],['quantize','Quantize'],['merge','Merge / bounce'],['export-selection','Export selection']];
    const ranges=[['range-loop','Range to loop'],['split-range','Split range'],['trim-range','Crop to range'],['delete-range','Delete range'],['delete-time','Delete time']];
    const selection=[['all','Select all'],['select-track','All on track'],['select-muted','Select muted'],['invert-selection','Invert selection'],['clear-selection','Clear selection']];
    const noteCommands=[['note-all','Select all notes'],['note-up-oct','+ Octave'],['note-down-oct','− Octave'],['note-legato','Legato'],['note-staccato','Staccato'],['note-length','Grid length'],['note-velocity','Set velocity…'],['note-humanize','Humanize'],['note-reverse','Reverse notes'],['note-mute','Mute notes']];
    const audioCommands=[['reverse','Reverse'],['normalize','Normalize'],['fade-both','Auto fades'],['reset-fades','Clear fades'],['slip-left','Slip ←'],['slip-right','Slip →'],['crossfade','Crossfade overlaps'],['detect-stops','Split at silence']];
    const parts=c?select('editor-part',c.type==='audio'?'Event':'Part',[...t.clips].sort((a,b)=>a.start-b.start)
      .map(row=>option(row.id,row.name+' · '+SW.locatorText(row.start,p.meter),c.id)).join('')):'';
    let editor='<div class="editor-toolbar edit-header"><strong title="'+esc(t.name)+'">'+esc(t.name)+'</strong>'+parts+'<span class="spacer"></span>'+
      (c?.type==='midi'?toggle('expression-page','Notes','Show notes',editPage==='notes','data-key="notes"')+
      toggle('expression-page','MIDI Automation','Show note and instrument automation',editPage==='expression','data-key="expression"'):'')+
      button('editor-action-menu','Action ▾','Open editor actions')+
      toggle('editor-controls','Controls','Show or hide detailed editing controls',editorControls,'aria-expanded="'+editorControls+'"')+
      toggle('macro-toggle-editor','Macros','Show or hide editor macros',editorMacros)+'</div>';
    if(editorMacros)editor+=macroToolbar(editorPage());
    if(editorControls){
      editor+='<div class="edit-controls-inside"><div class="editor-actions">'+actionButtons(events)+'</div>'+
        '<div class="edit-range-fields">'+field('range-from','Range start',fmt((r?.from??playhead)+1,4),1,100000,.01)+field('range-to','Range end',fmt((r?.to??playhead+p.meter)+1,4),1,100000,.01)+actionButtons(ranges)+'</div>'+
        '<div class="editor-actions">'+actionButtons(selection)+'</div>'+
        (c?'<div class="editor-actions">'+actionButtons(c.type==='midi'?noteCommands:audioCommands)+(c.type==='midi'?selectGrid():'')+'</div>':'')+'</div>';
    }
    const content=c?.type==='midi'?(editPage==='expression'?renderExpression(c,currentTrack()):renderPiano()):
      c?.type==='audio'?waveEditor(c):'<p class="empty">'+(t.type==='midi'?
      'This track has no instrument parts. Double-click its lane to create one, or press Record.':
      t.type==='audio'?'This track has no audio events. Drop audio on its lane or press Record.':'Select an audio or instrument track in the arrangement.')+'</p>';
    const piano=c?.type==='midi'&&editPage==='notes';
    return '<div class="edit-view">'+editor+(piano?renderPianoControls(c):'')+'<div class="editor-content">'+content+'</div>'+
      (piano&&velocityLaneOpen?renderVelocityLane(c):'')+'</div>';
  }
  function selectGrid(){
    const marks=[['straight','Straight'],['triplet','Triplet'],['dotted','Dotted']];
    return '<label>Grid <select data-change="grid-mode" aria-label="Grid feel">'+marks.map(([key,label])=>option(key,label,gridMode)).join('')+'</select></label>'+field('quantize-strength','Strength %',quantizeStrength,1,100,1);
  }
  function syncToolModifier(event){
    const active=Boolean(event&&(event.ctrlKey||event.metaKey)&&!event.altKey);
    const grid=$('arrange-grid');
    grid.classList.toggle('ctrl-tool',active);
    grid.classList.toggle('alt-arrow',Boolean(event?.altKey));
  }
  function setTool(key){
    if(!Object.hasOwn(toolsList,key)) return;
    editTool=key;$('arrange-grid').dataset.tool=key;
    $('arrange-tools').innerHTML=Object.entries(toolsList).map(([id,label])=>button('tool',label,label+(commandKey('tool-'+id)?' ('+commandKey('tool-'+id)+')':''),'data-key="'+id+'" aria-pressed="'+(key===id)+'"')).join('');
  }
  function showRange(){
    for(const el of document.querySelectorAll('.range-shade')) el.remove();
    $('range-display').textContent=editRange?'Range '+fmt(editRange.from+1,3)+'–'+fmt(editRange.to+1,3):'';
    if(!editRange) return;
    const lane=document.querySelector('[data-lane="'+editRange.t+'"]');
    if(!lane) return;
    const el=document.createElement('span');el.className='range-shade';
    el.style.left=editRange.from*zoom+'px';el.style.width=(editRange.to-editRange.from)*zoom+'px';lane.append(el);
  }
  function editRangeAction(name){
    const r=selectionRange();
    if(!r||r.to-r.from<.001){status('Select a range in the arrangement first.',true);return;}
    if(name==='range-loop'){
      setTimelineLoop(SW.loopBounds('draw',0,0,r.to,r.from),true);return;
    }
    if(name==='delete-time'){
      edit(()=>{SW.deleteRange(p,r.from,r.to,r.t,true);editRange=null;picked.clear();},'Deleted time across the session');return;
    }
    if(name==='delete-range'){
      edit(()=>{SW.deleteRange(p,r.from,r.to,r.t);editRange=null;},'Deleted selected range');return;
    }
    const t=p.tracks.find(t=>t.id===r.t);
    if(!t) return;
    edit(()=>{
      t.clips=t.clips.flatMap(c=>{
        if(c.locked||c.start>=r.to||c.start+c.length<=r.from) return [c];
        if(name==='trim-range') return [SW.sliceClip(c,r.from,r.to)].filter(Boolean);
        const middle=splitClip(c,r.from)||c;
        const right=splitClip(middle,r.to);
        return [c,...(middle===c?[]:[middle]),...(right?[right]:[])];
      });
    },name==='trim-range'?'Cropped clips to range':'Split at range boundaries');
  }
  let editorFocus=null;
  function setEditorFocus(focus){
    const previous=editorFocus;
    if(previous?.kind==='global'&&previous.id!==focus.id)
      find('[data-global-id="'+previous.id+'"]')?.classList.remove('is-selected');
    editorFocus=focus;
    if(focus.kind==='global'&&focus.id)find('[data-global-id="'+focus.id+'"]')?.classList.add('is-selected');
  }
  const focusedClipboard=new Map();
  function readEditorFocus(target){
    if(!target?.closest)return null;
    const el=target.closest('[data-global-id]');
    if(el)return {kind:'global',lane:el.dataset.globalKind,id:el.dataset.globalId};
    const globalLane=target.closest('[data-global-lane]');
    if(globalLane)return {kind:'global',lane:globalLane.dataset.globalLane};
    const expression=target.closest('.expression-editor');
    if(expression){
      if(expressionKey==='velocity')return {kind:'notes',id:target.closest('[data-expression-note]')?.dataset.expressionNote};
      const at=target.closest('[data-expression-at]')?.dataset.expressionAt;
      const index=target.closest('[data-expression-delete]')?.dataset.expressionDelete;
      const c=editorClip(), pt=at!==undefined?Number(at):c?.expression?.[expressionKey]?.[Number(index)]?.at;
      return {kind:'expression',clip:c?.id,lane:expressionKey,at:pt};
    }
    if(target.closest('[data-roll],[data-note-tools],.piano-layout'))
      return {kind:'notes',id:target.closest('[data-note]')?.dataset.note||target.closest('[data-velocity-note]')?.dataset.velocityNote};
    const point=target.closest('[data-point]'), envelope=target.closest('[data-envelope],.automation-wrap');
    if(envelope){
      const t=currentTrack(), at=t.lanes[autoKey]?.[Number(point?.dataset.point)]?.at;
      return {kind:'automation',track:t.id,lane:autoKey,at};
    }
    const fxEl=target.closest('[data-fx]'), strip=target.closest('.console-strip');
    if(fxEl||strip||target.closest('.inspector'))return {kind:'insert',
      track:target.closest('[data-track]')?.dataset.track||currentTrack().id,id:fxEl?.dataset.fx};
    if(target.closest('.arrange-frame,.wave-editor,[data-clip],[data-lane],.track-head'))return {kind:'events'};
    return null;
  }
  function clipboardScope(target){
    const focus=readEditorFocus(target)||editorFocus;
    if(!focus)return {kind:'events'};
    if(['notes','expression'].includes(focus.kind)&&(!dockOpen||tab!=='edit'))return {kind:'events'};
    if(focus.kind==='automation'&&(!dockOpen||tab!=='automation'))return {kind:'events'};
    return focus;
  }
  function driveClipboard(operation,scope){
    const {kind,lane}=scope, paste=operation==='paste'||operation==='paste-original';
    if(kind==='events'){clipboardCommand(paste?'v':operation==='copy'?'c':'x',operation==='paste-original');return;}
    if(kind==='notes'){
      if(!paste)includeFocusedNote(scope);
      noteClipboardAction('note-'+operation);return;
    }
    let dest, item, label, apply, remove;
    const at=operation==='paste-original'?null:sn(playhead);
    if(kind==='global'){
      item=scope.id&&globalItem(lane,scope.id);label=globalKinds[lane]?.entry||'entry';
      apply=copy=>{
        if(copy.lane!==lane){status('Select the '+globalKinds[copy.lane].label+' lane to paste.',true);return;}
        const next={...copy.item,at:at===null?copy.item.at:clamp(at,0,100000-(copy.item.length||0))};
        const row=saveGlobalItem(lane,next);
        editorFocus={kind,lane,id:row.id};find('[data-global-id="'+row.id+'"]')?.focus({preventScroll:true});
      };
      remove=()=>deleteGlobalItem(lane,item);
    }else if(kind==='insert'){
      dest=channelById(scope.track)||currentTrack();
      item=dest.fx.find(e=>e.id===scope.id);label='insert';
      apply=copy=>{
        const insert={...clone(copy.item),id:uid()};
        edit(()=>SW.addEffect(dest,insert),'Pasted '+insert.type+' · '+dest.name);
        editorFocus={kind,track:dest.id,id:insert.id};
      };
      remove=()=>edit(()=>SW.removeEffect(dest,item.id),'Cut '+item.type+' · '+dest.name);
    }else if(kind==='automation'||kind==='expression'){
      const expr=kind==='expression', row=expr?foundClip(scope.clip)||editorRow():null;
      const owner=expr?row?.c:channelById(scope.track);
      const points=expr?owner?.expression?.[lane]:owner?.lanes?.[lane];
      item=points?.find(pt=>pt.at===scope.at);label=expr?'MIDI controller point':'automation point';
      const writable= Boolean(owner&&!owner.locked), spec=owner&&(expr?SW.expressionSpecs(row.t)[lane]:laneSpecs(owner)[lane]);
      apply=copy=>{
        if(!writable||!spec){status('Select an editable lane to paste.',true);return;}
        if(copy.lane!==lane){status('Select the matching automation parameter to paste.',true);return;}
        const beat=at===null?copy.item.at:expr?clamp(at-owner.start,0,owner.length):at;
        edit(()=>{
          if(expr)SW.setExpression(owner,lane,clamp(beat,0,owner.length),copy.item.value);
          else addPoint(owner,lane,beat,clamp(copy.item.value,spec[1],spec[2]));
        },'Pasted '+label);
        editorFocus={...scope,at:beat};
      };
      remove=()=>{if(writable)edit(()=>points.splice(points.indexOf(item),1),'Cut '+label);};
      if(!writable&&operation==='cut'){status('Unlock the part before cutting.',true);return;}
    }
    if(paste){
      const copy=focusedClipboard.get(kind);
      if(copy&&apply)apply(copy);
      else status('Copy a '+label+' in this editor first.',true);
    }else if(item){
      focusedClipboard.set(kind,{lane,item:clone(item)});
      if(operation==='cut')remove();
      else status('Copied '+label);
    }else status('Select a '+label+' first.',true);
  }
  function includeFocusedNote(scope){
    const c=editorClip();
    if(c&&scope.id&&c.notes.some(n=>n.id===scope.id)&&!notePicked.has(scope.id))chooseNotes([scope.id]);
  }
  function noteScopeCommand(id,target){
    const scope=clipboardScope(target);
    if(isEditing()||scope.kind!=='notes')return false;
    const mapped={all:'all','invert-selection':'invert-selection','select-muted':'select-muted',quantize:'quantize',
      split:'split','mute-event':'mute','nudge-left':'nudge-left','nudge-right':'nudge-right',delete:'delete'};
    if(Object.hasOwn(mapped,id)){
      if(!['all','invert-selection','select-muted'].includes(id))includeFocusedNote(scope);
      editNotes(mapped[id]);return true;
    }
    if(id==='duplicate'||id==='repeat'){includeFocusedNote(scope);noteClipboardAction('note-duplicate');return true;}
    if(id==='clear-selection'){chooseNotes([]);renderDock(false);focusNoteEditor();return true;}
    if(id.startsWith('tool-')){
      const key=id.slice(5);
      if(['arrow','draw','split','erase','mute','listen'].includes(key)){noteTools=key;renderDock(false);focusNoteEditor();return true;}
    }
    return false;
  }
  function clipboardCommand(key,original=false){
    if(key==='v'){
      if(!multiClipboard.length) return;
      const origin=Math.min(...multiClipboard.map(row=>row.c.start));
      const extent=Math.max(...multiClipboard.map(row=>row.c.start+row.c.length));
      const delta=original?0:clamp(sn(playhead)-origin,-origin,Math.max(-origin,100000-extent));
      edit(()=>{
        const base=currentTrack();
        const targets=new Map(), rows=[];
        for(const item of multiClipboard){
          if(item.c.type==='audio'&&!Object.hasOwn(p.assets,item.c.asset)) continue;
          if(!targets.has(item.t)){
            const existing=p.tracks.find(t=>t.id===item.t);
            targets.set(item.t,multiClipboard.every(it=>it.t===item.t)&&base.type===item.c.type&&SW.timelineTrack(base)?base:existing&&SW.timelineTrack(existing)?existing:addTrack(item.c.type));
          }
          const t=targets.get(item.t), c=SW.shiftClip(item.c,delta);
          t.clips.push(c);rows.push({t,c});
        }
        if(rows.length) selectMany(rows);
      },'Pasted events');return;
    }
    const range=editRange, cutting=key==='x';
    const rows=range?allClips().filter(({t,c})=>t.id===range.t&&c.start<range.to&&c.start+c.length>range.from):
      selectedClips();
    const eligible=rows.filter(({c})=>!cutting||!c.locked);
    const copied=eligible.flatMap(({t,c})=>{
      const part=range?SW.sliceClip(c,range.from,range.to):clone(c);
      return part?[{t:t.id,c:part}]:[];
    });
    if(!copied.length){status(cutting?'Select unlocked events to cut.':'Select events or a range to copy.',true);return;}
    multiClipboard=copied;
    if(cutting&&range)editRangeAction('delete-range');
    else if(cutting)removeSelected();
    status((cutting?'Cut ':'Copied ')+copied.length+' event(s)');
  }
  function removeSelected(){
    const ids=new Set(selectedClips().filter(({c})=>!c.locked).map(({c})=>c.id));
    if(!ids.size) return;
    edit(()=>{
      for(const t of p.tracks) t.clips=t.clips.filter(c=>!ids.has(c.id));
      picked.clear();clipId=null;noteId=null;
    },'Deleted '+ids.size+' event(s)');
  }
  function eventBatch(id,at=playhead){
    const rows=selectedClips().filter(({c})=>id==='lock-event'||!c.locked);
    if(!rows.length){status('Select an unlocked event first.',true);return;}
    const from=Math.min(...rows.map(({c})=>c.start)), to=Math.max(...rows.map(({c})=>c.start+c.length));
    if(id==='merge'){run(mergeSelected)(rows,from,to);return;}
    const requested=id==='repeat'?prompt('Number of copies','2'):'1';
    if(requested===null||!Number.isFinite(Number(requested))) return;
    const copies=clamp(Math.round(Number(requested)),1,32);
    edit(()=>{
      const created=[];
      const newMuted=rows.some(({c})=>!c.muted), newLocked=rows.some(({c})=>!c.locked);
      for(const {t,c} of rows){
        if(id==='split'){
          const right=splitClip(c,at);
          if(right){t.clips.push(right);created.push({t,c:right});}
        }
        if(id==='duplicate'||id==='repeat'){
          for(let i=1;i<=copies;i++){
            const cp=SW.shiftClip(c,(to-from)*i);
            t.clips.push(cp);created.push({t,c:cp});
          }
        }
        if(id==='lock-event') c.locked=newLocked;
        if(id==='mute-event') c.muted=newMuted;
        if(id==='nudge-left') c.start=Math.max(0,c.start-(step()||.25));
        if(id==='nudge-right') c.start=Math.min(99999,c.start+(step()||.25));
        if(id==='align') c.start=clamp(c.start+sn(playhead)-from,0,99999);
        if(id==='quantize') c.start=sn(c.start);
        if(c.type!=='audio') continue;
        if(id==='normalize') normalizeClip(c);
        if(id==='reverse'){c.offset=Math.max(0,clipLimit(c)-c.offset-c.length);c.reverse=!c.reverse;}
        if(id==='fade-both') c.fadeIn=c.fadeOut=Math.min(c.length/2,.05*p.bpm/60);
        if(id==='reset-fades') c.fadeIn=c.fadeOut=0;
        if(id==='slip-left'||id==='slip-right') c.offset=clamp(c.offset+(id==='slip-left'?-1:1)*(step()||.25),0,clipLimit(c)-c.length);
        if(id==='detect-stops') splitAtSilence(t,c);
      }
      if(id==='crossfade'){
        for(const t of new Set(rows.map(row=>row.t))){
          const sorted=[...t.clips].filter(c=>c.type==='audio'&&!c.locked).sort((a,b)=>a.start-b.start);
          for(let i=1;i<sorted.length;i++){
            const [left,right]=[sorted[i-1],sorted[i]];
            if(!rows.some(row=>row.c===left||row.c===right)) continue;
            const length=Math.min(left.start+left.length-right.start,right.length);
            if(length>0){left.fadeOut=Math.min(length,left.length-left.fadeIn);right.fadeIn=Math.min(length,right.length-right.fadeOut);}
          }
        }
      }
      if(created.length) selectMany(created);
    },'Edited '+rows.length+' event(s)');
  }
  function splitAtSilence(t,c){
    const source=media.get(c.asset)?.buffer;
    if(!source) return;
    const data=source.getChannelData(0), scale=source.sampleRate*60/c.sourceBpm;
    const hop=Math.max(1,Math.round(source.sampleRate*.02));
    const end=Math.min(data.length,Math.floor((c.offset+c.length)*scale));
    let silent=0, hot=false, piece=c;
    for(let i=Math.floor(c.offset*scale);i<end;i+=hop){
      let peak=0;
      for(let j=i;j<Math.min(end,i+hop);j+=4) peak=Math.max(peak,Math.abs(data[c.reverse?data.length-1-j:j]));
      if(peak<.012){silent+=hop;continue;}
      if(hot&&silent/source.sampleRate>.075){
        const right=splitClip(piece,c.start+i/scale-c.offset);
        if(right){t.clips.push(right);piece=right;}
      }
      hot=true;silent=0;
    }
  }
  async function mergeSelected(rows,from,to){
    const t=rows[0].t;
    if(rows.some(row=>row.t!==t)){status('Select events on one track to merge or bounce.',true);return;}
    if(t.type==='midi'){
      if(rows.length<2){status('Select at least two MIDI clips to merge.',true);return;}
      edit(()=>{
        const c=SW.mergeNotes(rows.map(row=>row.c));
        t.clips=t.clips.filter(c=>!rows.some(row=>row.c===c));t.clips.push(c);selectMany([{t,c}]);
      },'Merged MIDI events');return;
    }
    busy=true;
    try{
      const copied=clone(t);
      copied.clips=rows.map(row=>clone(row.c));
      Object.assign(copied,{volume:0,pan:0,trim:0,fx:[],patch:undefined,lanes:{},out:'master',send:'',sends:[],mute:false,solo:false,mono:false,polarity:false});
      const snapshot={...p,tracks:[copied],master:{...channel('Master','master',0),volume:0}};
      const result=await SW.renderAudio(snapshot,media,{from,to,tail:0});
      const entry={id:uid(),name:t.name+' bounce.wav',bytes:SW.wav(result,32),buffer:result};
      edit(()=>{
        registerAsset(entry);t.clips=t.clips.filter(c=>!rows.some(row=>row.c===c));
        const c=placeAsset(t,entry.id,from);c.length=to-from;
        selectMany([{t,c}]);
      },'Bounced selected audio events');
    }finally{busy=false;}
  }
  function selectedNotes(c){return notePicked.size?c.notes.filter(n=>notePicked.has(n.id)):noteId?c.notes.filter(n=>n.id===noteId):c.notes;}
  function editNotes(operation){
    const c=editorClip();
    if(c?.type!=='midi')return;
    if(operation==='all'||operation==='invert-selection'||operation==='select-muted'){
      const explicit=new Set(exactNotes(c).map(n=>n.id));
      chooseNotes(c.notes.filter(n=>operation==='all'||operation==='select-muted'&&n.muted||
        operation==='invert-selection'&&!explicit.has(n.id)).map(n=>n.id));
      renderDock(false);focusNoteEditor();return;
    }
    if(c.locked){status('Unlock the MIDI part before editing.',true);return;}
    const group=exactNotes(c);
    if(!group.length){status('Select notes first.',true);return;}
    let velocity=.8,semitones=0;
    if(operation==='velocity'||operation==='transpose'||operation==='swing'){
      const opts={velocity:['MIDI velocity (1–127)','100'],transpose:['Transpose by semitones (−127 to 127)','12'],
        swing:['Swing amount (0–100%)',String(pianoSwing)]}[operation];
      const result=prompt(...opts);
      if(result===null||!result.trim()||!Number.isFinite(Number(result)))return;
      if(operation==='velocity')velocity=clamp(Math.round(Number(result)),1,127)/127;
      if(operation==='transpose')semitones=clamp(Math.round(Number(result)),-127,127);
      if(operation==='swing')pianoSwing=clamp(Number(result),0,100);
    }
    if(['up-oct','down-oct','up-semi','down-semi'].includes(operation)){
      semitones={'up-oct':12,'down-oct':-12,'up-semi':1,'down-semi':-1}[operation];operation='transpose';
    }
    if(operation==='delete'){
      removeNotes(c,group,'Deleted');return;
    }
    const result=SW.processPianoNotes(c,group.map(n=>n.id),operation,{grid:notesGrid(),strength:quantizeStrength/100,
      semitones,velocity,root:pianoRoot,scale:pianoScale,at:clamp(playhead-c.start,0,c.length),swing:pianoSwing/100,seed:Date.now()});
    if(!result.changed){status('No notes changed.');return;}
    edit(()=>{c.notes=result.notes;chooseNotes(result.selection);},'Edited '+group.length+' '+(group.length===1?'note':'notes'));
    focusNoteEditor();
    if(['transpose','scale','invert'].includes(operation)&&noteId)
      find('[data-note="'+noteId+'"]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
  }
  function focusNoteEditor(){
    if(tab!=='edit')return;
    const target=noteId&&find('[data-note="'+noteId+'"]')||find('[data-roll]');
    target?.focus({preventScroll:true});
  }
  function removeNotes(c,rows,verb){
    if(!rows.length||c.locked)return;
    const ids=new Set(rows.map(n=>n.id));
    edit(()=>{c.notes=c.notes.filter(n=>!ids.has(n.id));chooseNotes([]);},verb+' '+rows.length+' '+(rows.length===1?'note':'notes'));
    focusNoteEditor();
  }
  const mediaFolderTypes=/\.(?:wav|aiff?|flac|ogg|oga|opus|mp3|m4a|mp4|aac|caf|webm|wma|alac|midi?)$/i;
  let sampleFolder=[], sampleFolderName='';
  let browserKind='effects', browserQuery='', onlyFavorites=false, host={}, hostLoading, browserPlugins=[], localSelection=[], copiedInserts=[];
  let favorites=new Set(readSettings('sw-favorites',[])), hiddenPlugins=new Set(readSettings('sw-hidden-plugins',[]));
  function readSettings(key,fallback){
    try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}
  }
  function remember(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
  const localHost=location.protocol==='http:'&&location.hostname==='127.0.0.1';
  async function localRequest(url,init={}){
    if(!prefs.localServices) throw Error('The launcher connection is disabled in Preferences.');
    if(url.startsWith('/api/native/')&&!prefs.nativePlugins) throw Error('Native offline plug-in processing is disabled in Preferences.');
    if(url.startsWith('/api/encode')&&!prefs.extendedEncoders) throw Error('Extended encoders are disabled in Preferences.');
    if(url==='/api/plugins'&&!prefs.scanSystem) throw Error('Installed plug-in scans are disabled in Preferences.');
    const response=await fetch(url,{...init,headers:{'X-Soundweave':'1',...init.headers}});
    if(!response.ok){
      const info=await response.json().catch(()=>({}));
      throw Error(info.error||'Local Sonoravell service returned '+response.status+'.');
    }
    return response;
  }
  async function refreshLocal(scan=false){
    if(!localHost||!prefs.localServices){
      if(scan) throw Error(!localHost?'Start the local launcher to scan installed plug-ins.':'The launcher connection is disabled in Preferences.');
      return;
    }
    if(!hostLoading){
      hostLoading=localRequest('/api/capabilities').then(r=>r.json()).then(data=>{launcher=data;syncServices();})
        .catch(error=>{hostLoading=null;throw error;});
    }
    try{await hostLoading;}
    catch(error){if(scan) throw error;return;}
    if(scan){
      const result=await (await localRequest('/api/plugins')).json();
      if(prefs.localServices&&prefs.scanSystem) browserPlugins=result.plugins;
      if(browserOpen) renderBrowserPanel();
    }
  }
  function pluginRows(){
    const needle=browserQuery.trim().toLowerCase();
    if(browserKind==='local'){
      const items=[...(prefs.localServices&&prefs.scanSystem?browserPlugins:[]),...localSelection];
      const seen=new Set();
      return items.filter(item=>{
        const key=item.kind+':'+item.name.toLowerCase();
        if(seen.has(key)) return false;
        seen.add(key);return !needle||[item.name,item.kind,item.vendor,item.path].some(v=>String(v||'').toLowerCase().includes(needle));
      });
    }
    const fxGroup=(type)=>Object.entries(SW.effectCategories).find(([,list])=>list.includes(type))?.[0]||'Effects';
    const types=browserKind==='effects'?Object.keys(fx):browserKind==='instruments'?Object.keys(instruments):Object.keys(SW.presets);
    return types.map(name=>({name,kind:browserKind==='effects'?fxGroup(name):browserKind==='instruments'?'Instrument':'FX chain',key:browserKind+':'+name}))
      .filter(item=>(showHidden||!hiddenPlugins.has(item.key))&&(!onlyFavorites||favorites.has(item.key))&&(!needle||(item.name+' '+item.kind).toLowerCase().includes(needle)));
  }
  function renderBrowser(){
    const navigation=[['effects','Effects'],['instruments','Instruments'],['presets','FX chains'],['pool','Pool'],['files','Files'],['library','Media folder'],['local','Local plug-ins']];
    let top='<div class="browser-head">'+navigation.map(([key,title])=>toggle('browser-kind',title,title,browserKind===key,'data-key="'+key+'"')).join('');
    if(!['pool','files'].includes(browserKind)) top+='<input type="search" class="browser-search" id="browser-search" placeholder="Search" aria-label="Search browser" value="'+esc(browserQuery)+'">';
    if(!['pool','files','local'].includes(browserKind)) top+=toggle('browser-favorites','★','Favorites only',onlyFavorites)+toggle('browser-hidden','Hidden','Show hidden plug-ins',showHidden);
    if(browserKind==='local') top+=button('plugin-scan','Scan system folders')+button('plugin-folder','Add folder…');
    if(browserKind==='files') top+=button('browser-import','Import file…');
    if(browserKind==='library') top+=button('choose-sample-folder','Choose folder…')+button('clear-sample-folder','Clear folder');
    top+='</div>';
    if(browserKind==='pool') return top+renderMedia();
    if(browserKind==='files') return top+'<p class="browser-info">Import audio or MIDI from disk, or drop files onto the arrangement.</p>'+renderMedia();
    return top+'<div id="browser-results">'+browserResults()+'</div>';
  }
  function browserResults(){
    if(browserKind==='library'){
      if(!sampleFolder.length) return '<p class="browser-info">Choose a folder with audio or MIDI files.</p>';
      const needle=browserQuery.trim().toLowerCase(), matches=sampleFolder.filter(row=>row.path.toLowerCase().includes(needle));
      return '<p class="browser-info">'+esc(sampleFolderName)+' · '+matches.length+' matching files (showing up to 250)</p>'+
        '<table class="browser-table"><thead><tr><th>File</th><th>Actions</th></tr></thead><tbody>'+
        matches.slice(0,250).map(({file,path,id})=>'<tr data-folder-file="'+id+'"><td>'+esc(path)+'</td><td>'+
        button('folder-file-import','Import at cursor')+(!/\.midi?$/i.test(file.name)?button('folder-file-sampler','Load in Sampler'):'')+
        '</td></tr>').join('')+'</tbody></table>';
    }
    const items=pluginRows();
    if(browserKind==='local'){
      if(!items.length) return '<p class="browser-info">Scan standard installation folders through the launcher, or select a plug-in folder here.</p>';
      const intro=host.native?'Native VST3/AU · offline effect and instrument rendering':'Install Pedalboard in the launcher’s Python for offline VST3/AU rendering.';
      return '<p class="browser-info">'+intro+'</p><div class="browser-device-grid">'+items.map(item=>{
        const key=esc(artworkKey(item));
        const controls=button('device-photo','Artwork','Choose device illustration','data-key="'+key+'"')+
          (deviceArtwork[artworkKey(item)]?button('device-photo-remove','Reset','Reset device illustration','data-key="'+key+'"'):'')+
          (item.id&&['VST3','Audio Unit'].includes(item.kind)?button('native-open','Open','Open plug-in controls','data-key="'+key+'"'):'');
        return '<article class="browser-device native-card">'+deviceCardArt(item,true)+'<div class="native-card-name"><strong>'+
          esc(item.name)+'</strong><small>'+esc(item.vendor||item.kind)+'</small></div><div class="controls">'+controls+'</div></article>';
      }).join('')+'</div>';
    }
    if(!items.length) return '<p class="browser-info">No matching items.</p>';
    return '<div class="browser-device-grid">'+items.map(item=>{
      const title=esc(item.name);
      return '<article draggable="true" data-item="'+title+'" class="browser-device"><div class="browser-item">'+gearArt(item.name,true)+
        '<div><strong>'+title+'</strong><small>'+esc(item.kind)+'</small></div></div><div class="controls">'+
        toggle('plugin-favorite',favorites.has(item.key)?'★':'☆','Favorite '+item.name,favorites.has(item.key))+
        toggle('plugin-hide',hiddenPlugins.has(item.key)?'Show':'Hide','Toggle visibility of '+item.name,hiddenPlugins.has(item.key))+
        button('plugin-insert',browserKind==='instruments'?'Load':'Add')+'</div></article>';
    }).join('')+'</div>';
  }
  function applyBrowserItem(kind,name,target,forceNew=false,patch={}){
    if(isEditing()) return;
    if(kind==='effects'&&!Object.hasOwn(fx,name)||kind==='instruments'&&!Object.hasOwn(instruments,name)||kind==='presets'&&!Object.hasOwn(SW.presets,name)) return;
    if(!['effects','instruments','presets'].includes(kind)) return;
    edit(()=>{
      if(kind==='instruments'){
        if(patch.strict&&target&&target.type!=='midi')throw Error('Drop instruments on an instrument track or empty arrangement space.');
        const t=!forceNew&&target?.type==='midi'?target:addTrack('midi');
        SW.placeInstrument(t,name,patch.parked);
        if(forceNew||t!==target) t.name=name;
        selectTrack(t.id,false);
      }else if(kind==='effects') SW.addEffect(target||currentTrack(),effect(name),patch);
      else for(const [type,settings] of SW.presets[name]){
        const e=effect(type);Object.assign(e.params,settings);SW.addEffect(target||currentTrack(),e,patch);
      }
    },'Loaded '+name);
  }
  function populateLocalFolder(files){
    const entries=new Map();
    const kinds={vst3:'VST3',vst:'VST2',dll:'VST2 candidate',component:'Audio Unit',clap:'CLAP',lv2:'LV2'};
    for(const file of files){
      const parts=(file.webkitRelativePath||file.name).split('/');
      const i=parts.findIndex(part=>Object.hasOwn(kinds,part.split('.').at(-1).toLowerCase()));
      if(i<0) continue;
      const name=parts[i], ext=name.split('.').at(-1).toLowerCase(), path=parts.slice(0,i+1).join('/');
      entries.set(path,{name:name.slice(0,-ext.length-1),kind:kinds[ext],path});
    }
    localSelection=[...entries.values()];
    browserKind='local';renderDock();status('Found '+localSelection.length+' plug-in file(s) or bundle(s)');
  }
  function channelSnapshot(t){
    return {id:t.id,volume:t.volume,pan:t.pan,trim:t.trim??0,mute:t.mute,solo:t.solo,
            mono:Boolean(t.mono),polarity:Boolean(t.polarity),fx:t.fx.map(e=>({id:e.id,bypass:e.bypass,params:clone(e.params)}))};
  }
  function storeScene(){
    const name=prompt('Mixer scene name','Scene '+((p.mixScenes?.length||0)+1))?.trim().slice(0,100);
    if(!name) return;
    edit(()=>{
      p.mixScenes??=[];
      const scene={id:uid(),name,channels:[...p.tracks,p.master].map(channelSnapshot)};
      p.mixScenes.push(scene);sceneId=scene.id;
    },'Saved mixer scene '+name,false);
  }
  function recallScene(){
    const scene=p.mixScenes?.find(row=>row.id===sceneId);
    if(!scene) return;
    edit(()=>{
      for(const t of [...p.tracks,p.master]){
        const saved=scene.channels.find(row=>row.id===t.id);
        if(!saved) continue;
        const {fx:inserts,id,...controls}=saved;
        for(const key of ['volume','pan','trim','mute','solo','mono','polarity']) t[key]=controls[key];
        for(const e of t.fx){
          const state=inserts.find(row=>row.id===e.id);
          if(state){
            e.bypass=Boolean(state.bypass);
            if(SW.validEffectParams(e.type,state.params))e.params=clone(state.params);
          }
        }
      }
    },'Recalled mixer scene '+scene.name);
  }
  function panelAction(el){
    const action=el.dataset.action, key=el.dataset.key;
    const target=[...p.tracks,p.master].find(t=>t.id===el.closest('[data-track]')?.dataset.track)||currentTrack();
    const name=el.closest('[data-item]')?.dataset.item;
    const id=browserKind+':'+name;
    if(action==='browser-kind'){browserKind=key;browserQuery='';renderDock();return true;}
    if(action==='browser-favorites'){onlyFavorites=!onlyFavorites;renderDock();return true;}
    if(action==='browser-hidden'){showHidden=!showHidden;renderDock();return true;}
    if(action==='plugin-favorite'||action==='plugin-hide'){
      const set=action==='plugin-favorite'?favorites:hiddenPlugins;
      if(set.has(id)) set.delete(id);else set.add(id);
      remember(action==='plugin-favorite'?'sw-favorites':'sw-hidden-plugins',[...set]);renderDock();return true;
    }
    if(action==='plugin-insert'){applyBrowserItem(browserKind,name,target);return true;}
    if(action==='plugin-folder'){$('plugin-folder').click();return true;}
    if(action==='plugin-scan'){
      if(!localHost) status('Use the localhost launcher for system folders, or add a folder here.',true);
      else {status('Scanning local plug-in folders…');run(async()=>{await refreshLocal(true);status('Found '+browserPlugins.length+' system plug-in(s)');})();}
      return true;
    }
    if(action==='choose-sample-folder'||action==='clear-sample-folder'){command(action);return true;}
    if(action==='folder-file-import'||action==='folder-file-sampler'){
      const item=sampleFolder.find(row=>row.id===Number(el.closest('[data-folder-file]')?.dataset.folderFile));
      if(item) run(async()=>{
        if(action==='folder-file-import'){await importFiles([item.file],sn(playhead));return;}
        busy=true;
        try{
          const entry=await decodeAsset(await item.file.arrayBuffer(),item.file.name);
          edit(()=>{
            const track=target.type==='midi'?target:addTrack('midi');
            registerAsset(entry);track.sample=entry.id;SW.placeInstrument(track,'Sampler');selectTrack(track.id,false);
          },'Loaded sampler audio from the linked folder');
        }finally{busy=false;}
      })();
      return true;
    }
    if(action==='browser-import'){command('import-media');return true;}
    if(action==='save-scene'){storeScene();return true;}
    if(action==='recall-scene'){recallScene();return true;}
    if(action==='delete-scene'){edit(()=>{p.mixScenes=p.mixScenes.filter(s=>s.id!==sceneId);},'Deleted mixer scene',false);return true;}
    if(action==='mixer-devices'){mixerDevices=!mixerDevices;renderDock();return true;}
    if(action==='mixer-add-bus'){edit(()=>addTrack('bus'),'Added mixer bus');return true;}
    if(action==='rack-toggle'||action==='send-row-toggle'){
      const set=action==='rack-toggle'?openRacks:openSendRows;
      const key=el.dataset.rackKey;
      if(set.has(key))set.delete(key);else {set.add(key);if(el.dataset.rackParent)openRacks.add(el.dataset.rackParent);}
      renderDock(false);return true;
    }
    if(action==='legacy-send-remove'){if(target.send)edit(()=>{target.send='';},'Disconnected send');return true;}
    if(action==='console-preset-save'){saveConsolePreset(target);return true;}
    if(action==='mixer-size'){mixerWide=!mixerWide;renderDock();return true;}
    if(action==='mixer-dim'){edit(()=>p.dimSolo=!p.dimSolo);return true;}
    if(action==='mixer-unmute'){edit(()=>{for(const t of [...p.tracks,p.master])t.mute=false;});return true;}
    if(action==='mixer-unsolo'){edit(()=>{for(const t of p.tracks)t.solo=false;});return true;}
    if(action==='mixer-peak'){mixerPeak.clear();updateMeters();return true;}
    if(action==='mix-hide'){edit(()=>target.hidden=!target.hidden);return true;}
    if(action==='mix-mono'){edit(()=>target.mono=!target.mono);return true;}
    if(action==='mix-polarity'){edit(()=>target.polarity=!target.polarity);return true;}
    if(action==='mix-safe'){edit(()=>target.soloSafe=!target.soloSafe);return true;}
    if(action==='mix-channel'){selectTrack(target.id);if(panelCollapsed)$('toggle-inspector').click();return true;}
    if(action==='fx-bypass-all'){edit(()=>{const next=target.fx.some(e=>!e.bypass);for(const e of target.fx)e.bypass=next;});return true;}
    if(action==='fx-copy'){copiedInserts=clone(target.fx);status('Copied '+copiedInserts.length+' insert(s)');return true;}
    if(action==='fx-paste'){
      if(copiedInserts.length) edit(()=>{for(const e of copiedInserts)SW.addEffect(target,{...clone(e),id:uid()});},'Pasted inserts');
      return true;
    }
    if(['send-pre','send-mute','send-remove'].includes(action)){
      const index=Number(el.closest('[data-send]').dataset.send);
      const route=target.sends?.[index];
      if(route&&action==='send-pre'&&SW.sendList(target).some(s=>s.to===route.to&&s.pre!==route.pre)){
        status('This bus already uses that tap.',true);return true;
      }
      if(route) edit(()=>{
        if(action==='send-remove')target.sends.splice(index,1);
        else if(action==='send-pre')route.pre=!route.pre;
        else route.mute=!route.mute;
      });
      return true;
    }
    if(action==='fx-bus'){
      edit(()=>{
        const from=currentTrack(), bus=addTrack('bus');
        bus.name='FX Return';bus.fx.push(effect('Room Reverb'));bus.fx[0].params.mix=1;
        if(from.type!=='master'){from.sends??=[];from.sends.push({to:bus.id,level:-12,pre:false,mute:false});}
      },'Created effects return');return true;
    }
    return false;
  }
  function sendControls(t){
    if(t.type==='master') return '';
    const buses=p.tracks.filter(row=>row.type==='bus'&&validRoute(p,t.id,row.id,'send'));
    const rows=(t.sends||[]).map((route,i)=>'<div class="send-row" data-send="'+i+'"><span title="'+esc(buses.find(t=>t.id===route.to)?.name||'Bus')+'">'+esc(buses.find(t=>t.id===route.to)?.name||'Bus')+'</span>'+
      '<input aria-label="Send gain" type="number" data-change="aux-level" min="-60" max="6" step=".1" value="'+route.level+'">'+
      toggle('send-pre','Pre','Pre-fader send',route.pre)+toggle('send-mute','M','Mute send',route.mute)+button('send-remove','×','Remove send')+'</div>').join('');
    const legacy=t.send?select('send','Existing send',[
      option('','Disconnect',null),...buses.map(row=>option(row.id,row.name,t.send))
    ].join(''))+field('send-level','Send level (dB)',t.sendLevel,-60,6,.1):'';
    return legacy+rows+select('add-send','Add send',[option('','Choose bus',''),...buses.map(row=>option(row.id,row.name))].join(''));
  }
  let studioPlugin=null, studioSpatial=null, graphLabel=null, dialDrag=null, movingSource=null;
  let graphDrag=null, draggedPedal=null, pluginPaintTime=-Infinity;
  const pluginProbe=SW.createPluginProbe();
  const pluginPlotOptions={range:24,source:'both'};
  const savedDeviceArt=readSettings('sw-device-art',{});
  let deviceArtwork=Object.fromEntries(Object.entries(savedDeviceArt||{})
    .filter(([,value])=>typeof value==='string'&&value.length<280000&&/^data:image\/(?:webp|png|jpeg);base64,[\w+/=]+$/.test(value)).slice(0,18));
  let artworkTarget=null;
  const artworkKey=item=>item.id||('folder:'+item.kind+':'+item.path);
  function deviceCardArt(item,thumb=false,knownInstrument=false){
    const image=deviceArtwork[artworkKey(item)];
    if(image)return '<img class="device-custom-art '+(thumb?'gear-thumb':'')+'" alt="" src="'+esc(image)+'">';
    return gearArt(knownInstrument||item.instrument?'Keys':'Utility Gain',thumb);
  }
  function chooseDeviceArt(key){
    const item=[...browserPlugins,...localSelection].find(row=>artworkKey(row)===key);
    if(item){artworkTarget=key;$('device-art-file').click();}
  }
  async function importDeviceArt(file,key){
    if(!file||!key)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>15000000)throw Error('Choose a PNG, JPEG, or WebP image under 15 MB.');
    const bitmap=await createImageBitmap(file);
    let image;
    try{
      const scale=Math.min(1,640/bitmap.width,380/bitmap.height);
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));
      canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      image=canvas.toDataURL('image/webp',.82);
    }finally{bitmap.close();}
    if(image.length>=280000)throw Error('The thumbnail is too large. Choose a smaller image.');
    const next={...deviceArtwork,[key]:image};
    if(Object.keys(next).length>18)throw Error('Clear a saved device image before adding another.');
    localStorage.setItem('sw-device-art',JSON.stringify(next));deviceArtwork=next;
    renderBrowserPanel();if(studioPlugin?.type==='native')renderNative();
    status('Saved device artwork');
  }
  function gearArt(name,thumb=false){
    const art=SW.art(name);
    return art?'<div aria-hidden="true" class="gear-art '+(thumb?'gear-thumb':'')+'" style="--gear-x:'+art.x+'%;--gear-y:'+art.y+'%"></div>':'';
  }
  function knob(kind,key,label,value,spec,owner,reset=value,face=false,compact=false){
    const [,min,max,step,unit]=spec;
    const degree=-135+SW.dialFraction(value,min,max,unit)*270;
    const data='data-gear-kind="'+kind+'" data-gear-key="'+esc(key)+'" data-owner="'+esc(owner)+'"';
    const number='<input '+data+' data-gear-value type="number" aria-label="'+esc(label)+' precise value" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'">';
    return '<div class="dial-cell '+(face?'face-dial':'')+(compact?' compact-dial':'')+'" data-dial><button type="button" class="rotary" role="slider" aria-label="'+esc(label)+'" aria-valuemin="'+min+'" aria-valuemax="'+max+'" aria-valuenow="'+value+'" '+
      data+' title="'+esc(label)+'" data-min="'+min+'" data-max="'+max+'" data-step="'+step+'" data-unit="'+esc(unit)+'" data-reset="'+reset+'" style="--dial-angle:'+degree+'deg"><span></span></button>'+
      '<strong>'+esc(label)+'</strong><div class="dial-value">'+number+'<span>'+esc(unit)+'</span></div></div>';
  }
  function displayKnob(el,value){
    const cell=el.closest('[data-dial]'), handle=cell?.querySelector('.rotary');
    const input=cell?.querySelector('[data-gear-value]');
    if(!handle||!input)return;
    const f=SW.dialFraction(value,Number(handle.dataset.min),Number(handle.dataset.max),handle.dataset.unit);
    handle.style.setProperty('--dial-angle',(-135+270*f)+'deg');
    handle.setAttribute('aria-valuenow',value);
    input.value=Number(value.toFixed(7));
  }
  function gearSurface(name,controls){
    return '<div class="gear-surface">'+gearArt(name)+'<div class="face-controls" aria-label="Controls on illustrated face">'+controls+'</div></div>';
  }
  function pluginOpen(t,e){
    studioPlugin=e?{track:t.id,id:e.id,type:'fx',band:'mid'}:{track:t.id,type:'inst'};
    renderPlugin();
    window.focus?.();
    if(!$('plugin-dialog').open)$('plugin-dialog').showModal();
  }
  function channelById(id){return p.tracks.find(t=>t.id===id)||(id==='master'?p.master:null);}
  function paramLabel(key){
    return ({q:'Q',mix:'Wet mix',frequency:'Frequency',amount:'Drive',time:'Delay time',attack:'Attack',release:'Release',
      threshold:'Threshold',ratio:'Ratio',width:'Width',gain:'Gain',tone:'Tone',depth:'Depth',feedback:'Feedback'})[key]||key[0].toUpperCase()+key.slice(1);
  }
  function stockDevice(){
    if(!studioPlugin||studioPlugin.type==='native')return null;
    const t=channelById(studioPlugin.track);
    const e=t?.fx.find(row=>row.id===studioPlugin.id);
    if(!t||studioPlugin.type==='fx'&&!e)return null;
    const defaults=e?null:SW.instrumentSettings({...t,synth:{}});
    const specs=e?fx[e.type]:Object.fromEntries(Object.entries(SW.instrumentSpecs(t.instrument)).map(([key,spec])=>
      [key,[spec[1],spec[2],defaults[key],spec[3],spec[4]]]));
    const mode=SW.pluginPlot(e,t.instrument);
    return {t,e,mode,specs,handles:SW.pluginHandles(mode,e),values:e?.params||SW.instrumentSettings(t)};
  }
  function stockDial(device,key,label=paramLabel(key)){
    const {t,e,specs,values}=device,spec=specs[key];
    return knob(e?'fx':'inst',e?'fx:'+e.id+':'+key:key,label,values[key],[key,spec[0],spec[1],spec[3],spec[4]],t.id,spec[2],true);
  }
  function plotHandle(device,handle){
    const [x,y]=SW.handlePosition(device.mode,handle,device.values,device.specs,pluginPlotOptions.range);
    return '<button type="button" class="device-plot-handle" data-plot-handle="'+handle.key+'" aria-label="'+esc(handle.label)+
      '" aria-pressed="'+(device.e?.type==='Spectrum EQ'&&studioPlugin.band===handle.key)+'" title="'+esc(handle.label)+
      '" style="left:'+x*100+'%;top:'+y*100+'%;--point-ink:'+handle.color+'"'+(!handle.on?' data-band-off':'')+'></button>';
  }
  function renderStockControls(device){
    const {e,handles,specs}=device;
    if(e?.type==='Spectrum EQ'){
      const bands=handles.map(handle=>'<button type="button" data-action="eq-select-band" data-key="'+handle.key+
        '" aria-pressed="'+(studioPlugin.band===handle.key)+'" style="--point-ink:'+handle.color+'">'+
        esc(handle.label)+(handle.on?'':' · Off')+'</button>').join('');
      const band=handles.find(handle=>handle.key===studioPlugin.band)||handles[0];
      return '<div class="eq-bands" role="group" aria-label="EQ bands">'+bands+'</div><div class="device-band-detail">'+
        toggle('eq-band-power',band.on?'Band on':'Band off','Toggle '+band.label,band.on,'data-key="'+band.key+'"')+
        '<div class="dial-grid" aria-label="Precision dial controls">'+stockDial(device,band.x,'Frequency')+
        (band.y?stockDial(device,band.y,'Gain'):'')+(band.q?stockDial(device,band.q,'Q'):'')+stockDial(device,'output','Output')+'</div></div>';
    }
    if(e?.type==='Guitar Pedalboard'){
      const ordered=SW.pedalOrder(e);
      return '<div class="pedal-board" aria-label="Pedalboard signal order">'+ordered.map(([key,type],index)=>{
        const active=Boolean(e.params[key+'On']);
        return '<section class="pedal-stomp" data-pedal="'+key+'" data-active="'+active+'">'+
          '<header draggable="true" data-pedal-grab="'+key+'" title="Drag to reorder">'+gearArt(type,true)+
          '<div><small>Slot '+(index+1)+'</small><b>'+esc(type)+'</b></div>'+
          '<div class="pedal-order">'+button('pedal-earlier','←','Move '+type+' earlier','data-key="'+key+'" '+(!index?'disabled':''))+
          button('pedal-later','→','Move '+type+' later','data-key="'+key+'" '+(index===ordered.length-1?'disabled':''))+'</div></header>'+
          '<div class="dial-grid" aria-label="Precision dial controls">'+Object.keys(fx[type]).map(param=>stockDial(device,key+'_'+param,paramLabel(param))).join('')+'</div>'+
          toggle('pedal-power',active?'Engaged':'Bypassed','Toggle '+type,active,'data-key="'+key+'" class="stomp-switch"')+'</section>';
      }).join('')+'</div>';
    }
    return '<div class="dial-grid" aria-label="Precision dial controls">'+Object.keys(specs).map(key=>stockDial(device,key,
      e?undefined:SW.instrumentSpecs(device.t.instrument)[key][0])).join('')+'</div>';
  }
  function renderPlugin(){
    if(studioPlugin?.type==='native'){renderNative();return;}
    const device=stockDevice();
    if(!device){if($('plugin-dialog').open)$('plugin-dialog').close();return;}
    const {t,e,mode,handles,values}=device;
    const name=e?.type||t.instrument;
    $('plugin-title').textContent=name+' · '+t.name;
    let toolbar='';
    if(e){
      toolbar='<div class="gear-toolbar" data-track="'+t.id+'" data-fx="'+e.id+'">'+
        toggle('fx-bypass-editor','Power','Toggle bypass',!e.bypass)+button('gear-play','Play / stop','Toggle session playback')+button('gear-reset','Reset parameters')+
        button('gear-copy-preset','Copy settings')+button('gear-paste-preset','Paste settings')+
        '<output id="plugin-meter" aria-label="Plug-in output peak">— dBFS</output>'+
        (['Compressor','Limiter','Parallel Compressor'].includes(e.type)?'<output id="plugin-reduction" aria-label="Gain reduction">— dB GR</output>':'')+'</div>';
    }else{
      const wave=t.instrument!=='Drums'&&t.instrument!=='Sampler'?
        '<label>Oscillator <select data-gear-wave>'+['sine','triangle','sawtooth','square'].map(w=>option(w,w,values.wave)).join('')+'</select></label>':'';
      toolbar='<div class="gear-toolbar" data-track="'+t.id+'">'+wave+button('gear-note','Play note','Audition the instrument')+
        button('gear-play','Play / stop','Toggle session playback')+button('gear-reset','Reset parameters')+
        (t.instrument==='Sampler'?button('load-sample',p.assets[t.sample]?.name||'Load sample…'):'')+
        '<output id="plugin-meter" aria-label="Channel output peak">— dBFS</output></div>';
    }
    const plotOptions=mode==='eq'?'<label>Spectrum <select id="eq-spectrum">'+
      [['both','In + Out'],['input','Input'],['output','Output'],['off','Off']].map(([key,label])=>option(key,label,pluginPlotOptions.source)).join('')+
      '</select></label><label>Scale <select id="eq-display-range">'+[6,12,24].map(n=>option(n,'±'+n+' dB',pluginPlotOptions.range)).join('')+'</select></label>':'';
    $('plugin-body').innerHTML='<div class="stock-device" data-track="'+t.id+'"'+(e?' data-fx="'+e.id+'"':'')+'>'+
      '<div class="device-toolbar">'+gearArt(name,true)+toolbar+'</div><div class="device-surface">'+
      '<div class="device-display-head"><strong>'+SW.plotTitles[mode]+'</strong>'+plotOptions+'</div>'+
      '<div class="device-plot '+(mode==='eq'?'eq-plot':'')+'" data-device-plot><canvas id="plugin-response" width="920" height="'+(mode==='eq'?280:198)+
      '" aria-label="'+SW.plotTitles[mode]+'"></canvas>'+handles.map(handle=>plotHandle(device,handle)).join('')+'</div>'+
      renderStockControls(device)+'</div></div>';
    drawPluginAnalysis(true);
  }
  function spatialOpen(t){
    studioSpatial=t.id;renderSpatial();
    window.focus?.();
    if(!$('spatial-dialog').open)$('spatial-dialog').showModal();
  }
  function padPosition(x,y){return {left:50+39*x,top:50+39*y};}
  function renderSpatial(){
    const t=channelById(studioSpatial);
    if(!t||t.id==='master') return;
    const config=SW.position(t);
    const active=padPosition(config.x,config.y);
    $('spatial-title').textContent='Spatial panner · '+t.name;
    const indicators=SW.speakers.filter(s=>s[0]!=='LFE').map(([name,x,y,z])=>{
      const at=padPosition(x*(z?.65:1),y*(z?.65:1));
      return '<span class="speaker '+(z?'height':'')+'" style="left:'+at.left+'%;top:'+at.top+'%">'+name+'</span>';
    }).join('');
    $('spatial-body').innerHTML='<div class="gear-toolbar"><label>Channel mode <select data-space-mode><option value="stereo">Stereo bed</option>'+
      option('bed','Surround bed source',config.mode)+option('object','Object source',config.mode)+'</select></label>'+
      '<label>Monitor <select data-monitor-mode>'+option('stereo','Stereo',p.spatialMonitor||'stereo')+option('binaural','Binaural headphones',p.spatialMonitor)+'</select></label></div>'+
      '<div class="spatial-shell"><div class="panner-map" data-space-pad role="group" aria-label="Drag to position the source">'+indicators+
      '<span class="listener">LISTENER</span><span class="object-dot" style="left:'+active.left+'%;top:'+active.top+'%"></span></div>'+
      '<div class="gear-controls"><div class="dial-grid">'+Object.entries(SW.spatialSpecs).map(([key,spec])=>
        knob('space','space:'+key,spec[0],config[key],spec,t.id,SW.spatialDefaults[key])).join('')+'</div>'+
      '<p class="muted-text">'+(t.out==='master'?'Main output · spatial render enabled':'Routed into a bus · position the bus for spatial output.')+'</p></div></div>';
    $('spatial-body').querySelector('[data-space-mode]').value=config.mode;
  }
  function cueFields(t){
    if(t.type==='master')return '';
    const tracks=SW.cueSettings(p);
    const rows=SW.cueSends(t).map((route,i)=>{
      const cue=tracks.find(c=>c.id===route.to);
      if(!cue)return '';
      return '<div class="cue-route" data-cue-route="'+i+'"><b>'+esc(cue.name)+'</b>'+
        field('cue-level','Level',route.level,-60,6,.1)+field('cue-pan','Pan',route.pan,-1,1,.01)+
        '<div class="controls">'+toggle('cue-pre','Pre','Pre-fader cue',route.pre)+toggle('cue-follow','Link pan','Follow channel pan',route.followPan)+
        toggle('cue-mute','Mute','Mute cue send',route.mute)+button('cue-remove','×','Remove cue send')+'</div></div>';
    }).join('');
    const spare=tracks.filter(c=>!SW.cueSends(t).some(s=>s.to===c.id));
    return rows+select('cue-add-send','Connect cue',[option('','Choose output',''),...spare.map(c=>option(c.id,c.name))].join(''));
  }
  let copiedKnobs=null;
  function movePedal(e,from,to){
    const order=SW.pedalOrder(e).map(([key])=>key);
    const source=order.indexOf(from), target=typeof to==='number'?source+to:order.indexOf(to);
    if(source<0||target<0||target>=order.length||source===target)return;
    order.splice(source,1);order.splice(target,0,from);
    edit(()=>order.forEach((key,index)=>e.params[key+'Order']=index),'Reordered guitar pedals');
  }
  function studioAction(el){
    const action=el.dataset.action, t=channelById(el.closest('[data-track]')?.dataset.track)||currentTrack();
    if(action==='track-icon'){openTrackIcons(t);return true;}
    if(action==='track-icon-set'){
      const selected=channelById(iconTrack), icon=el.dataset.key;
      if(selected&&(icon==='auto'||Object.hasOwn(SW.trackIcons,icon))&&(selected.icon||'auto')!==icon){
        edit(()=>{if(icon==='auto')delete selected.icon;else selected.icon=icon;},'Changed track icon',false);
      }
      $('track-icon-dialog').close();return true;
    }
    if(action==='keyscheme-apply'&&keyImportReport){
      keyMap=keyImportReport.bindings;
      keyAliases=Object.fromEntries(keyImportReport.alternates.map(item=>[item.id,item.keys]));
      remember('sw-keymap',keyMap);remember('sw-keymap-aliases',keyAliases);commandRows();
      $('keyscheme-report').close();status('Imported '+keyImportReport.mapped.length+' Studio One bindings');return true;
    }
    if(action==='device-photo'){chooseDeviceArt(el.dataset.key);return true;}
    if(action==='device-photo-remove'){
      const next={...deviceArtwork};
      delete next[el.dataset.key];
      try{localStorage.setItem('sw-device-art',JSON.stringify(next));deviceArtwork=next;renderBrowserPanel();}
      catch(error){report(error);}
      return true;
    }
    if(action==='native-open'){run(openNative)(el.dataset.key);return true;}
    if(action==='native-bake'){run(renderNativeEvent)();return true;}
    if(action==='native-save'&&nativePlugin){remember('sw-native-'+nativePlugin.item.id,nativePlugin.settings);status('Saved plug-in settings locally');return true;}
    if(action==='native-reset'&&nativePlugin){
      nativePlugin.settings=Object.fromEntries(nativePlugin.params.map(spec=>[spec.key,spec.value]));
      renderNative();return true;
    }
    if(action==='show-patch'){if(t&&t.id!==trackId)selectTrack(t.id,false);setTab('routing');return true;}
    if(action==='gear-play'){if(live)stopAction();else run(startPlayback)();return true;}
    if(action==='gear-note'){run(audition)(t,t.instrument==='Drums'?36:60);return true;}
    if(action==='gear-editor'){pluginOpen(t,t.fx.find(e=>e.id===el.closest('[data-fx]')?.dataset.fx));return true;}
    if(action==='gear-inst'){pluginOpen(t);return true;}
    if(['eq-select-band','eq-band-power','pedal-power','pedal-earlier','pedal-later'].includes(action)){
      const device=stockDevice(), key=el.dataset.key;
      if(!device?.e)return true;
      const {e}=device;
      if(e.type==='Spectrum EQ'&&device.handles.some(handle=>handle.key===key)){
        studioPlugin.band=key;
        if(action==='eq-select-band')renderPlugin();
        else if(action==='eq-band-power')edit(()=>e.params[key+'On']=1-e.params[key+'On'],'Toggled EQ band');
      }else if(e.type==='Guitar Pedalboard'&&SW.pedalStages.some(([stage])=>stage===key)){
        if(action==='pedal-power')edit(()=>e.params[key+'On']=1-e.params[key+'On'],'Toggled pedal');
        else if(action==='pedal-earlier'||action==='pedal-later')movePedal(e,key,action==='pedal-earlier'?-1:1);
      }
      $('plugin-body').querySelector('[data-action="'+action+'"][data-key="'+key+'"]')?.focus({preventScroll:true});
      return true;
    }
    if(action==='open-spatial'){if(t.id!=='master')spatialOpen(t);return true;}
    if(action==='cue-create'){
      if(SW.cueSettings(p).length>=16){status('A session supports up to 16 cue mixes.',true);return true;}
      const name=prompt('Cue mix name','Cue '+(SW.cueSettings(p).length+1))?.trim().slice(0,100);
      if(name)edit(()=>{
        const cue={id:uid(),name,volume:-6,mute:false};
        p.cues??=[];p.cues.push(cue);graphLabel=cue.id;
      },'Added cue output');return true;
    }
    if(action==='cue-output-mute'||action==='cue-output-patch'||action==='cue-delete'){
      const id=el.closest('[data-inline-cue]')?.dataset.inlineCue||graphLabel;
      const cue=SW.cueSettings(p).find(c=>c.id===id);
      if(cue)edit(()=>{
        if(action==='cue-output-mute')cue.mute=!cue.mute;
        else if(action==='cue-output-patch')cue.disconnected=!cue.disconnected;
        else{
          p.cues=p.cues.filter(c=>c!==cue);
          if(p.monitorCue===cue.id)p.monitorCue='';
          for(const key of Object.keys(p.flowPositions||{}))if(key.startsWith(cue.id+':'))delete p.flowPositions[key];
          for(const t of p.tracks)if(t.cueSends)t.cueSends=t.cueSends.filter(s=>s.to!==cue.id);
          graphLabel=null;
        }
      },undefined);
      return true;
    }
    if(['cue-pre','cue-follow','cue-mute','cue-remove'].includes(action)){
      const i=Number(el.closest('[data-cue-route]')?.dataset.cueRoute), route=t.cueSends?.[i];
      if(route&&action==='cue-pre'&&SW.cueSends(t).some(s=>s!==route&&s.to===route.to&&s.pre!==route.pre)){
        status('This cue already uses that tap.',true);return true;
      }
      if(route)edit(()=>{
        if(action==='cue-remove') t.cueSends.splice(i,1);
        else if(action==='cue-pre')route.pre=!route.pre;
        else if(action==='cue-follow')route.followPan=!route.followPan;
        else route.mute=!route.mute;
      });
      return true;
    }
    if(['fx-bypass-editor','gear-reset','gear-copy-preset','gear-paste-preset'].includes(action)){
      const e=t.fx.find(e=>e.id===studioPlugin?.id);
      if(action==='gear-copy-preset'&&e){copiedKnobs={type:e.type,settings:clone(e.params)};status('Copied '+e.type+' settings');}
      if(action==='gear-paste-preset'&&e&&copiedKnobs?.type===e.type)edit(()=>e.params=clone(copiedKnobs.settings));
      if(action==='fx-bypass-editor'&&e)edit(()=>e.bypass=!e.bypass);
      if(action==='gear-reset')edit(()=>{if(e)e.params=effect(e.type).params;else delete t.synth;});
      return true;
    }
    return false;
  }
  function knobNumeric(el,value,done){
    const cell=el.closest('[data-dial]'), handle=cell?.querySelector('.rotary');
    if(!handle||!Number.isFinite(value))return;
    const kind=handle.dataset.gearKind,key=handle.dataset.gearKey, owner=handle.dataset.owner;
    const low=Number(handle.dataset.min),high=Number(handle.dataset.max),unit=handle.dataset.unit,step=Number(handle.dataset.step);
    value=SW.dialValue(SW.dialFraction(value,low,high,unit),low,high,step,unit);
    displayKnob(handle,value);
    const panel=handle.closest('.paired-dials');
    if(panel)for(const other of panel.querySelectorAll('.rotary')){
      if(other!==handle&&other.dataset.gearKey===key&&other.dataset.owner===owner)displayKnob(other,value);
    }
    const input=cell.querySelector('[data-gear-value]');
    const active=handle.ownerDocument?.activeElement;
    const focus=active===handle?'handle':active===input?'input':null;
    if(done&&focus)queueMicrotask(()=>{
      const root=kind==='space'?$('spatial-body'):['mix','route','cue-output'].includes(kind)?$('dock'):$('plugin-body');
      const face=cell.classList.contains('face-dial');
      const current=[...root.querySelectorAll('.rotary')].find(node=>node.dataset.gearKind===kind&&node.dataset.gearKey===key&&node.dataset.owner===owner&&node.closest('[data-dial]').classList.contains('face-dial')===face);
      if(focus==='handle')current?.focus({preventScroll:true});
      else current?.closest('[data-dial]')?.querySelector('input')?.focus({preventScroll:true});
    });
    const label=handle.getAttribute?.('aria-label')||key;
    if(kind==='native'){
      if(nativePlugin){nativePlugin.settings[key]=value;if(done)status(valueStatus('',label,value,unit));}
      return;
    }
    if(kind==='cue-output'){
      const cue=SW.cueSettings(p).find(row=>row.id===owner);
      if(done&&cue&&!isEditing()&&cue.volume!==value)edit(()=>{cue.volume=value;},valueStatus(cue.name,'Level',value,'dB'));
      return;
    }
    const t=channelById(owner);
    if(!t||isEditing())return;
    if(kind==='route'){
      if(!done)return;
      const [type,index,field]=key.split(':');
      const route=type==='aux'?t.sends?.[Number(index)]:type==='cue'?t.cueSends?.[Number(index)]:null;
      if(route&&route[field]!==value)edit(()=>{route[field]=value;},valueStatus(t.name,label,value,unit));
      else if(key==='legacy:level'&&t.send&&t.sendLevel!==value)edit(()=>{t.sendLevel=value;},valueStatus(t.name,label,value,unit));
      return;
    }
    if(kind==='inst'){
      if((!paramEdit||paramEdit.el!==input)&&SW.instrumentSettings(t)[key]===value)return;
      if(!paramEdit||paramEdit.el!==input) paramEdit={el:input,previous:before()};
      t.synth??={};t.synth[key]=value;
      if(done){const previous=paramEdit.previous;paramEdit=null;commit(previous,valueStatus(t.name,label,value,unit));}
      else refreshDevicePlot();
      return;
    }
    input.dataset.owner=owner;input.dataset.param=key;
    changeParam(input,done);
    if(!done&&kind==='fx')refreshDevicePlot();
  }
  function focusDeviceHandle(key){$('plugin-body').querySelector('[data-plot-handle="'+key+'"]')?.focus({preventScroll:true});}
  function refreshDevicePlot(){
    const device=stockDevice();
    if(!device)return;
    for(const handle of device.handles){
      const el=$('plugin-body').querySelector('[data-plot-handle="'+handle.key+'"]');
      if(!el)continue;
      const [x,y]=SW.handlePosition(device.mode,handle,device.values,device.specs,pluginPlotOptions.range);
      el.style.left=x*100+'%';el.style.top=y*100+'%';
      el.toggleAttribute('data-band-off',!handle.on);
      el.title=handle.label+' · '+[handle.x,handle.y].filter(Boolean).map(key=>
        fmt(device.values[key],3)+' '+device.specs[key][4]).join(' / ');
    }
    drawPluginAnalysis(true);
  }
  function setPlotValues(device,changes){
    const {t,e}=device;
    for(const [key,value] of Object.entries(changes)){
      if(e){
        e.params[key]=value;
        for(const graph of new Set([live?.graph,monitorGraph,previewGraph]))if(graph?.tracks)
          SW.overrideParam(graph,t.id,'fx:'+e.id+':'+key,value);
      }else{
        t.synth??={};t.synth[key]=value;
      }
      const id=e?'fx:'+e.id+':'+key:key;
      const dial=$('plugin-body').querySelector('.rotary[data-gear-key="'+id+'"]');
      if(dial)displayKnob(dial,value);
    }
    refreshDevicePlot();
  }
  function plotStatus(device,handle,values){
    return device.t.name+' · '+handle.label+' · '+Object.entries(values).map(([key,value])=>
      fmt(value,4)+(device.specs[key][4]?' '+device.specs[key][4]:'')).join(' / ');
  }
  function commitPlotEdit(device,handle,values,previous,hadWrite=Boolean(automationTake)){
    const {t,e}=device;
    const message=plotStatus(device,handle,values);
    if(!e||!live||!['Touch','Latch','Write'].includes(t.automation)){commit(previous,message);return;}
    const initial=previous.tracks.find(row=>row.id===t.id)||previous.master;
    const original=initial.fx.find(row=>row.id===e.id)?.params;
    const changed=Object.entries(values).filter(([key,value])=>original?.[key]!==value);
    if(!changed.length)return;
    const at=positionAt(live);
    for(const [key,value] of changed){
      const name='fx:'+e.id+':'+key, id=writeKey(t,name);
      extendWrite(at,id);beginWrite(t,name,value,at);
      if(t.automation==='Touch'){automationTake.get(id).active=false;currentOverride.delete(id);}
    }
    // The drag previews base values before automation is written. Keep the pre-drag snapshot for Undo.
    if(!hadWrite)automationSnapshot=previous;
    if(t.automation==='Touch'&&![...automationTake.values()].some(row=>row.active)){finishWrite();rebuildPlayback();}
    status(message+' · '+t.automation);
  }
  function editPlotHandle(handle,operation){
    const device=stockDevice();
    const point=device?.handles.find(row=>row.key===handle.dataset.plotHandle);
    if(!point||isEditing())return;
    const changes=Object.fromEntries(Object.entries(operation(device,point)).filter(([key,value])=>device.values[key]!==value));
    if(!Object.keys(changes).length)return;
    const previous=before();
    if(device.e?.type==='Spectrum EQ')studioPlugin.band=point.key;
    setPlotValues(device,changes);commitPlotEdit(device,point,changes,previous);focusDeviceHandle(point.key);
  }
  function bindStudioControls(){
    for(const [id,target] of [['close-plugin','plugin-dialog'],['close-spatial','spatial-dialog'],['close-key-report','keyscheme-report']]){
      $(id).onclick=()=>$(target).close();
    }
    function cancelPlotDrag(){
      if(!graphDrag)return;
      const {device,previous,initial,changes}=graphDrag;
      graphDrag=null;
      if(!changes)return;
      setPlotValues(device,Object.fromEntries(Object.keys(changes).map(key=>[key,initial[key]])));
      if(!device.e)device.t.synth=previous.tracks.find(row=>row.id===device.t.id)?.synth;
    }
    $('plugin-dialog').addEventListener('close',()=>{
      cancelPlotDrag();studioPlugin=null;nativePlugin=null;pluginProbe.clear();draggedPedal=null;
    });
    $('spatial-dialog').addEventListener('close',()=>{studioSpatial=null;});
    panels.listen(document,'pointerdown',event=>{
      const handle=event.target.closest('.rotary'), pad=event.target.closest('[data-space-pad]');
      if(event.button!==0||isEditing())return;
      const graphHandle=event.target.closest('[data-plot-handle]');
      if(graphHandle){
        const device=stockDevice(), point=device?.handles.find(row=>row.key===graphHandle.dataset.plotHandle);
        if(!point)return;
        const rect=graphHandle.closest('[data-device-plot]').getBoundingClientRect();
        if(!rect.width||!rect.height)return;
        graphDrag={device,point,rect,id:event.pointerId,x:event.clientX,y:event.clientY,
          start:SW.handlePosition(device.mode,point,device.values,device.specs,pluginPlotOptions.range),
          previous:before(),initial:{...device.values},hadWrite:Boolean(automationTake)};
        graphHandle.focus({preventScroll:true});graphHandle.setPointerCapture?.(event.pointerId);
        event.preventDefault();return;
      }
      if(handle){
        const input=handle.closest('[data-dial]').querySelector('input');
        dialDrag={handle,y:event.clientY,value:Number(input.value),id:event.pointerId};
        event.preventDefault();handle.focus();return;
      }
      if(pad){
        const t=channelById(studioSpatial);
        if(!t)return;
        movingSource={pad,t,id:event.pointerId,previous:before()};
        moveSource(event);
        event.preventDefault();
      }
    });
    panels.listen(window,'pointermove',event=>{
      if(graphDrag?.id===event.pointerId&&studioPlugin){
        const {device,point,rect,start,x,y,initial}=graphDrag;
        const dx=event.clientX-x,dy=event.clientY-y;
        if(!graphDrag.changes&&Math.hypot(dx,dy)<3)return;
        const scale=event.shiftKey?.2:1;
        const changes=SW.handleValues(device.mode,point,[start[0]+dx*scale/rect.width,start[1]+dy*scale/rect.height],
          initial,device.specs,pluginPlotOptions.range);
        if(!Object.keys(changes).length)return;
        graphDrag.changes=changes;
        setPlotValues(device,changes);
        return;
      }
      if(movingSource?.id===event.pointerId)moveSource(event);
      if(dialDrag?.id!==event.pointerId)return;
      const {handle,y,value}=dialDrag;
      const {min,max,step,unit}=handle.dataset;
      const f=SW.dialFraction(value,Number(min),Number(max),unit)+(y-event.clientY)/(event.shiftKey?1450:145);
      knobNumeric(handle,SW.dialValue(f,Number(min),Number(max),Number(step),unit),false);
    });
    for(const type of ['pointerup','pointercancel']){
      panels.listen(window,type,event=>{
        if(graphDrag?.id===event.pointerId){
          const drag=graphDrag;
          const {device,point,previous,initial,changes,hadWrite}=drag;
          if(!studioPlugin||event.type==='pointercancel')cancelPlotDrag();
          else{
            if(device.e?.type==='Spectrum EQ')studioPlugin.band=point.key;
            if(changes&&Object.entries(changes).some(([key,value])=>initial[key]!==value))commitPlotEdit(device,point,changes,previous,hadWrite);
            else renderPlugin();
            focusDeviceHandle(point.key);
          }
          graphDrag=null;return;
        }
        if(movingSource?.id===event.pointerId){
          const {previous}=movingSource;movingSource=null;commit(previous,'Updated spatial position');
        }
        if(dialDrag?.id!==event.pointerId)return;
        const {handle,value}=dialDrag;dialDrag=null;
        if(event.type==='pointercancel'){
          knobNumeric(handle,value,false);paramEdit=null;return;
        }
        knobNumeric(handle,Number(handle.closest('[data-dial]').querySelector('input').value),true);
      });
    }
    panels.listen(document,'dblclick',event=>{
      const point=event.target.closest('[data-plot-handle]');
      if(point){
        editPlotHandle(point,(device,handle)=>Object.fromEntries([handle.x,handle.y].filter(Boolean).map(key=>[key,device.specs[key][2]])));
        return;
      }
      const handle=event.target.closest('.rotary');
      if(handle) knobNumeric(handle,Number(handle.dataset.reset),true);
    });
    panels.listen(document,'keydown',event=>{
      const numeric=event.target.closest?.('[data-gear-value]');
      if(numeric&&event.key==='Enter'&&numeric.value.trim()){
        event.preventDefault();knobNumeric(numeric,Number(numeric.value),true);return;
      }
      const point=event.target.closest?.('[data-plot-handle]');
      if(point&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key)){
        event.preventDefault();
        if(['Enter',' '].includes(event.key)){
          const device=stockDevice();
          if(device?.e?.type==='Spectrum EQ'){studioPlugin.band=point.dataset.plotHandle;renderPlugin();focusDeviceHandle(studioPlugin.band);}
          return;
        }
        editPlotHandle(point,(device,handle)=>{
          const horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight';
          const key=horizontal?handle.x:handle.y||handle.q;
          if(!key)return {};
          const spec=device.specs[key],sign=event.key==='ArrowLeft'||event.key==='ArrowDown'?-1:1;
          const value=spec[4]==='Hz'?device.values[key]*2**(sign*(event.shiftKey?1/3:1/24)):
            device.values[key]+sign*spec[3]*(event.shiftKey?10:1);
          return {[key]:clamp(Number(value.toFixed(spec[4]==='Hz'?0:6)),spec[0],spec[1])};
        });
        return;
      }
      const hand=event.target.closest?.('.rotary');
      const arrow={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1};
      if(!hand||!arrow[event.key]&&!['Home','End'].includes(event.key))return;
      event.preventDefault();
      const current=Number(hand.closest('[data-dial]').querySelector('input').value);
      const value=event.key==='Home'?Number(hand.dataset.min):event.key==='End'?Number(hand.dataset.max):
        current+arrow[event.key]*Number(hand.dataset.step)*(event.shiftKey?10:1);
      knobNumeric(hand,value,true);
    });
    panels.listen(document,'change',event=>{
      const el=event.target;
      if(el.id==='eq-spectrum'){pluginPlotOptions.source=el.value;drawPluginAnalysis(true);return;}
      if(el.id==='eq-display-range'){pluginPlotOptions.range=Number(el.value);refreshDevicePlot();return;}
      if(el.hasAttribute('data-gear-value')){
        if(el.value.trim()) knobNumeric(el,Number(el.value),true);
        else if(['mix','route','cue-output'].includes(el.dataset.gearKind))renderDock(false);
        else if(studioPlugin) renderPlugin();
        else if(studioSpatial) renderSpatial();
      }
      if(el.hasAttribute('data-gear-wave')){
        const t=channelById(studioPlugin?.track);if(t) edit(()=>{t.synth??={};t.synth.wave=el.value;});
      }
      if(el.hasAttribute('data-space-mode')){
        const t=channelById(studioSpatial);if(t) edit(()=>{t.spatial=SW.position(t);t.spatial.mode=el.value;});
      }
      if(el.hasAttribute('data-monitor-mode'))edit(()=>{p.spatialMonitor=el.value;});
    });
    const body=$('plugin-body');
    body.addEventListener('wheel',event=>{
      const point=event.target.closest('[data-plot-handle]');
      if(!point||!event.deltaY||isEditing())return;
      const device=stockDevice(), key=device?.handles.find(handle=>handle.key===point.dataset.plotHandle)?.q;
      if(!key)return;
      event.preventDefault();
      editPlotHandle(point,({values,specs})=>({[key]:clamp(Number((values[key]-Math.sign(event.deltaY)*specs[key][3]).toFixed(3)),specs[key][0],specs[key][1])}));
    },{passive:false});
    body.addEventListener('dragstart',event=>{
      const from=event.target.closest('[data-pedal-grab]')?.dataset.pedalGrab;
      if(!from||event.target.closest('button')||isEditing())return;
      draggedPedal=from;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',from);
    });
    body.addEventListener('dragover',event=>{
      if(draggedPedal&&event.target.closest('[data-pedal]')){event.preventDefault();event.dataTransfer.dropEffect='move';}
    });
    body.addEventListener('drop',event=>{
      const to=event.target.closest('[data-pedal]')?.dataset.pedal, device=stockDevice();
      if(!to||!draggedPedal||device?.e?.type!=='Guitar Pedalboard'||isEditing())return;
      event.preventDefault();const from=draggedPedal;draggedPedal=null;movePedal(device.e,from,to);
    });
    body.addEventListener('dragend',()=>{draggedPedal=null;});
  }
  function moveSource(event){
    const {pad,t}=movingSource,r=pad.getBoundingClientRect();
    const partial={x:round(clamp(((event.clientX-r.left)/r.width-.5)/.39,-1,1)),
                   y:round(clamp(((event.clientY-r.top)/r.height-.5)/.39,-1,1))};
    t.spatial={...SW.position(t),...partial};
    if(t.spatial.mode==='stereo')t.spatial.mode='object';
    const pos=padPosition(partial.x,partial.y), dot=pad.querySelector('.object-dot');
    dot.style.left=pos.left+'%';dot.style.top=pos.top+'%';
    for(const [key,value] of Object.entries(partial)){
      const el=$('spatial-body').querySelector('.rotary[data-gear-key="space:'+key+'"]');
      if(el)displayKnob(el,value);
      if(live)SW.overrideParam(live.graph,t.id,'space:'+key,value);
    }
  }
  function drawPluginAnalysis(force=false){
    const canvas=$('plugin-response'), device=canvas&&stockDevice();
    if(!device)return;
    const now=performance.now();
    if(!force&&now-pluginPaintTime<34)return;
    pluginPaintTime=now;
    const graph=live?.graph||monitorGraph||previewGraph;
    const signal=pluginProbe.read(graph,device.t.id,device.e);
    SW.paintPluginPlot(canvas,device.mode,device.e,device.values,device.specs,signal,
      {...pluginPlotOptions,sampleRate:ctx?.sampleRate||48000});
    const reduction=$('plugin-reduction'), compressor=signal?.processor?.reduction;
    if(reduction)reduction.value=Number.isFinite(compressor?.reduction)?fmt(-compressor.reduction,1)+' dB GR':'— dB GR';
    const output=$('plugin-meter');
    if(output&&device.e){
      let peak=0;
      for(const sample of signal?.left||[])peak=Math.max(peak,Math.abs(sample));
      for(const sample of signal?.stereoRight?signal.right:[])peak=Math.max(peak,Math.abs(sample));
      output.value=peak?fmt(20*Math.log10(peak),1)+' dBFS':'— dBFS';
    }
  }
  let nativePlugin=null;
  async function openNative(key){
    const item=browserPlugins.find(p=>p.id===key);
    if(!item||busy)return;
    if(!host.native){status('Install Pedalboard in the launcher’s Python to open this plug-in.',true);return;}
    status('Loading '+item.name+'…');
    busy=true;
    try{
      const response=await localRequest('/api/native/inspect?id='+encodeURIComponent(key));
      const data=await response.json();
      const saved=readSettings('sw-native-'+key,{});
      const settings=Object.fromEntries(data.parameters.map(p=>[p.key,Number.isFinite(saved[p.key])?clamp(saved[p.key],0,1):p.value]));
      item.instrument=data.instrument;nativePlugin={item,params:data.parameters,instrument:data.instrument,settings};
      studioPlugin={type:'native'};
      renderNative();
      if(!$('plugin-dialog').open)$('plugin-dialog').showModal();
      status('Opened '+item.name);
    }finally{busy=false;}
  }
  function renderNative(){
    const native=nativePlugin;
    if(!native)return;
    $('plugin-title').textContent=native.item.name;
    const params=native.params.map(spec=>knob('native',spec.key,spec.name,native.settings[spec.key],[spec.key,0,1,.0001,''],native.item.id,spec.value)).join('');
    $('plugin-body').innerHTML='<div class="native-editor"><div class="gear-toolbar"><strong>'+esc(native.item.kind)+' · '+(native.instrument?'Instrument':'Effect')+'</strong>'+
      button('native-bake','Render selected event')+button('native-save','Remember settings')+button('native-reset','Defaults')+
      button('device-photo','Artwork','Choose device illustration','data-key="'+esc(artworkKey(native.item))+'"')+
      '</div><div class="native-device-art">'+deviceCardArt(native.item,false,native.instrument)+'</div><div class="dial-grid">'+params+'</div><p class="muted-text">Parameter values run from 0 to 1. Rendering creates a new audio event.</p></div>';
  }
  async function renderNativeEvent(){
    const native=nativePlugin, row=foundClip();
    if(!native||!row||isEditing())return;
    const {c,t}=row;
    if(native.instrument!==(c.type==='midi'))throw Error(native.instrument?'Select a MIDI part for this instrument.':'Select an audio event for this effect.');
    const rate=48000, duration=seconds(c.length,p.bpm)+1.5;
    if(duration>180)throw Error('Select an event shorter than three minutes.');
    const params={id:native.item.id,values:native.settings,duration};
    const snapshot=clone(p);
    busy=true;
    try{
      let audio=new Uint8Array();
      if(native.instrument){
        params.notes=c.notes.filter(n=>!n.muted&&n.velocity>0&&n.start<c.length).map(n=>[
          clamp(n.pitch+t.transpose,0,127),clamp(Math.round(n.velocity*127),1,127),seconds(n.start,p.bpm),
          seconds(Math.min(c.length,n.start+n.length),p.bpm)
        ]);
        if(!params.notes.length)throw Error('The selected MIDI part has no playable notes.');
        params.controls=Object.entries(c.expression||{}).flatMap(([key,points])=>{
          if(!SW.encodeControl(key,0,0))return [];
          const events=points.map(({at,value})=>[seconds(at,p.bpm),...SW.encodeControl(key,value,0)]);
          if(key==='cc64'&&points.at(-1)?.value>=64)events.push([seconds(c.length,p.bpm),176,64,0]);
          return events;
        });
      }else{
        const track={...clone(t),volume:0,pan:0,trim:0,fx:[],patch:undefined,lanes:{},cueSends:[],send:'',sends:[],
          out:'master',mute:false,solo:false,mono:false,polarity:false,clips:[{...clone(c),muted:false}]};
        const session={...snapshot,tracks:[track],master:{...channel('Master','master',0),volume:0}};
        const input=await SW.renderAudio(session,media,{from:c.start,to:c.start+c.length,tail:1.5,rate});
        audio=SW.wav(input,32);
      }
      const metadata=new TextEncoder().encode(JSON.stringify(params));
      const header=new Uint8Array(4);new DataView(header.buffer).setUint32(0,metadata.length,true);
      status('Rendering '+native.item.name+'…');
      const response=await localRequest('/api/native/render',{
        method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Blob([header,metadata,audio])
      });
      const name=(t.name+' · '+native.item.name).slice(0,111);
      const asset=await decodeAsset(await response.arrayBuffer(),name+'.wav');
      edit(()=>{
        registerAsset(asset);
        const target=addTrack('audio');
        target.name=name;placeAsset(target,asset.id,c.start);
      },'Rendered '+native.item.name+' to audio');
      $('plugin-dialog').close();
    }finally{busy=false;}
  }
  function loopMarkup(){
    const {loopStart:a,loopEnd:b,loop}=p;
    const grip=(side,label,at)=>`<button type="button" class="loop-grip ${side}" data-loop-handle="${side}" title="${label}" aria-label="${label}" aria-valuemin="0" aria-valuemax="100000" aria-valuenow="${at}" role="slider"></button>`;
    return `<div class="loop-editor" data-loop-editor title="Drag to draw a loop range">
      <div class="loop-band" data-loop-window data-enabled="${loop}" style="--loop-left:${a*zoom}px;--loop-width:${(b-a)*zoom}px">
        <button type="button" class="loop-move" data-loop-handle="move" aria-label="Loop range" title="Drag to move range. Double-click to toggle looping."></button>
        ${grip('left','Left loop locator',a)}${grip('right','Right loop locator',b)}
      </div></div>`;
  }
  function setTimelineLoop([start,end],enabled=p.loop){
    if(isEditing()||start===p.loopStart&&end===p.loopEnd&&enabled===p.loop)return;
    edit(()=>{p.loopStart=start;p.loopEnd=end;p.loop=enabled;},
      (enabled?'Loop ':'Loop off · ')+SW.locatorText(start,p.meter)+' – '+SW.locatorText(end,p.meter));
  }
  function timelineBeat(surface,event){
    const raw=clamp((event.clientX-surface.getBoundingClientRect().left)/zoom,0,100000);
    return clamp(event.shiftKey?round(raw):sn(raw),0,100000);
  }
  function previewLoop(surface,[start,end],enabled){
    const band=surface.querySelector('[data-loop-window]');
    if(!band)return;
    band.style.setProperty('--loop-left',start*zoom+'px');
    band.style.setProperty('--loop-width',(end-start)*zoom+'px');
    band.dataset.enabled=String(enabled);
    band.querySelector('[data-loop-handle="left"]')?.setAttribute('aria-valuenow',start);
    band.querySelector('[data-loop-handle="right"]')?.setAttribute('aria-valuenow',end);
    $('loop-start').value=SW.locatorText(start,p.meter);
    $('loop-end').value=SW.locatorText(end,p.meter);
  }
  function timelineLoopKey(event){
    const handle=event.target.closest?.('[data-loop-handle]');
    if(!handle||event.ctrlKey||event.metaKey||event.altKey||isEditing())return false;
    const mode=handle.dataset.loopHandle;
    if((event.key==='Enter'||event.key===' ')&&mode==='move'){
      event.preventDefault();setTimelineLoop([p.loopStart,p.loopEnd],!p.loop);
      find('[data-loop-handle="move"]')?.focus({preventScroll:true});return true;
    }
    if(!['ArrowLeft','ArrowRight'].includes(event.key))return false;
    const delta=(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?1/16:step()||1/4);
    const start=p.loopStart,end=p.loopEnd,anchor=mode==='right'?end:start;
    event.preventDefault();
    setTimelineLoop(SW.loopBounds(mode,start,end,anchor+delta,anchor));
    find('[data-loop-handle="'+mode+'"]')?.focus({preventScroll:true});
    return true;
  }
  function globalItem(kind,id){
    return SW.globalEntries(p,kind).find(item=>item.id===id);
  }
  function renderGlobalTracks(){
    return Object.entries(globalKinds).filter(([kind])=>visibleGlobals.has(kind)).map(([kind,spec])=>{
      const entries=[...SW.globalEntries(p,kind)].sort((a,b)=>a.at-b.at);
      return `<div class="global-head" style="--lane-ink:${spec.color}"><span aria-hidden="true">${spec.glyph}</span>
        <strong>${spec.label}</strong>${button('global-add','Add','Add '+spec.entry+' at the playhead','data-kind="'+kind+'"')}</div>
        <div class="global-lane" data-global-lane="${kind}" aria-label="${spec.label} lane" style="--lane-ink:${spec.color}">${entries.map(item=>{
        const size=item.length?'width:'+item.length*zoom+'px':'';
        return `<button type="button" class="global-event ${spec.length?'span-event':'point-event'}${editorFocus?.kind==='global'&&editorFocus.id===item.id?' is-selected':''}" data-global-kind="${kind}" data-global-id="${item.id}"${kind==='markers'?' data-marker="'+item.id+'"':''}
          style="left:${item.at*zoom}px;${size}" title="${esc(item.name+' · '+SW.locatorText(item.at,p.meter))}"><span>${esc(item.name)}</span>${spec.length?'<i data-global-edge="left"></i><i data-global-edge="right"></i>':''}</button>`;
      }).join('')}<span class="playline"></span></div>`;
    }).join('');
  }
  const activeGlobals=new Map();
  function updateGlobalPosition(){
    for(const kind of ['arranger','chords','lyrics']){
      const lane=document.querySelector('[data-global-lane="'+kind+'"]');
      if(!lane){activeGlobals.delete(kind);continue;}
      const item=SW.activeGlobalEntry(SW.globalEntries(p,kind),playhead);
      const active=item?.id??null, old=activeGlobals.get(kind);
      if(old?.lane===lane&&old.id===active)continue;
      if(old?.id)old.lane.querySelector('[data-global-id="'+old.id+'"]')?.classList.remove('at-cursor');
      if(active)lane.querySelector('[data-global-id="'+active+'"]')?.classList.add('at-cursor');
      activeGlobals.set(kind,{lane,id:active});
    }
  }
  function showGlobalLane(kind,visible=true){
    if(visible)visibleGlobals.add(kind);
    else visibleGlobals.delete(kind);
    remember('sw-global-tracks',[...visibleGlobals]);renderArrangement();updatePosition();
  }
  function openGlobalEntry(kind,at,item){
    const spec=globalKinds[kind], dialog=$('global-entry-dialog');
    if(!spec||isEditing()||dialog.open)return;
    globalEditor={kind,id:item?.id};
    $('global-entry-title').textContent=(item?'Edit ':'Add ')+spec.entry;
    $('global-entry-label').textContent=kind==='chords'?'Chord symbol':spec.entry+' name';
    $('global-name-row').hidden=['lyrics','tempo','signature'].includes(kind);
    $('global-lyrics-row').hidden=kind!=='lyrics';
    $('global-length-row').hidden=!spec.length;
    $('global-tempo-row').hidden=kind!=='tempo';
    $('global-signature-row').hidden=kind!=='signature';
    const field=$('global-entry-name');
    field.value=item?.name||(kind==='markers'?'Marker '+(p.markers.length+1):'');
    field.placeholder=kind==='chords'?'e.g. Am7':'e.g. Chorus';
    $('global-entry-lyrics').value=item?.name||'';
    $('global-entry-at').value=SW.locatorText(clamp(at,0,spec.length?99999:100000),p.meter);
    $('global-entry-length').value=item?.length??(kind==='arranger'?p.meter*4:kind==='lyrics'?2:p.meter);
    $('global-entry-bpm').value=item?.bpm??p.bpm;
    $('global-entry-meter').value=item?.meter??p.meter;
    $('global-entry-denominator').value=item?.denominator??'4';
    $('global-entry-key').value=item?.key??'';
    $('global-entry-error').textContent='';
    dialog.showModal();
    const focus=kind==='lyrics'?$('global-entry-lyrics'):kind==='tempo'?$('global-entry-bpm'):
      kind==='signature'?$('global-entry-meter'):field;
    focus.focus();focus.select?.();
  }
  function saveGlobalItem(kind,item,oldId){
    const spec=globalKinds[kind];
    if(isEditing())throw Error('Finish the current edit or recording first.');
    if(!spec||!SW.validGlobalEntry(kind,item))throw Error('Enter a valid position and '+(spec?.entry.toLowerCase()||'event')+'.');
    const previous=SW.globalEntries(p,kind), old=oldId&&globalItem(kind,oldId);
    if(oldId&&!old)throw Error('This event has already been removed.');
    if(!old&&previous.length>=4096)throw Error('This lane already contains 4,096 events.');
    const next={...item,id:old?.id||uid()};
    if(!visibleGlobals.has(kind)){visibleGlobals.add(kind);remember('sw-global-tracks',[...visibleGlobals]);}
    edit(()=>{
      const updated=[...previous.filter(row=>row!==old),next].sort((a,b)=>a.at-b.at);
      if(kind==='markers')p.markers=updated;
      else (p.globalTracks??={})[kind]=updated;
    },(old?'Updated ':'Added ')+spec.entry.toLowerCase()+' · '+item.name,false);
    return next;
  }
  function deleteGlobalItem(kind,item){
    if(isEditing()||!item)return;
    if(editorFocus?.kind==='global'&&editorFocus.lane===kind&&editorFocus.id===item.id)editorFocus={kind:'global',lane:kind};
    edit(()=>{
      const items=SW.globalEntries(p,kind).filter(row=>row!==item);
      if(kind==='markers')p.markers=items;
      else (p.globalTracks??={})[kind]=items;
    },'Removed '+globalKinds[kind].entry.toLowerCase()+' · '+item.name,false);
  }
  function bindGlobalTracks(){
    $('global-tracks').onclick=()=>{
      const button=$('global-tracks');
      if(!sharedContext.hidden&&sharedContext.dataset.mode==='global-picker'){hideContext(true);return;}
      const rect=button.getBoundingClientRect();
      showContext(rect.left,rect.bottom,[['Global tracks',Object.entries(globalKinds).map(([kind,spec])=>
        ['@global-show-'+kind,(visibleGlobals.has(kind)?'✓  ':'')+spec.label])]],button.ownerDocument);
      sharedContext.dataset.mode='global-picker';
      button.setAttribute('aria-expanded','true');
    };
    $('global-entry-cancel').onclick=()=>$('global-entry-dialog').close();
    $('global-entry-form').addEventListener('submit',event=>{
      event.preventDefault();if(!globalEditor)return;
      const {kind,id}=globalEditor, spec=globalKinds[kind];
      const at=SW.parseLocator($('global-entry-at').value,p.meter);
      const item={at,name:(kind==='lyrics'?$('global-entry-lyrics'):$('global-entry-name')).value.trim()};
      if(spec.length)item.length=Number($('global-entry-length').value);
      if(kind==='tempo'){
        item.bpm=Number($('global-entry-bpm').value);item.name=fmt(item.bpm)+' BPM';
      }
      if(kind==='signature'){
        item.meter=Number($('global-entry-meter').value);
        item.denominator=Number($('global-entry-denominator').value);item.key=$('global-entry-key').value.trim();
        item.name=item.meter+'/'+item.denominator+(item.key?' · '+item.key:'');
      }
      try{
        const entry=saveGlobalItem(kind,item,id);
        $('global-entry-dialog').close();globalEditor=null;
        find('[data-global-id="'+entry.id+'"]')?.focus({preventScroll:true});
      }catch(error){$('global-entry-error').textContent=error.message;}
    });
  }
  function openGlobalMenu(target,x,y,owner){
    const lane=target.closest('[data-global-lane]'), el=target.closest('[data-global-id]');
    const range=target.closest('[data-loop-editor]');
    if(!lane&&!range)return false;
    if(isEditing())return true;
    if(range){
      showContext(x,y,[['Loop',[['loop',p.loop?'Disable loop':'Enable loop'],
        ['range-loop','Set loop from selected events or range']]]],owner);
      return true;
    }
    const kind=lane.dataset.globalLane, spec=globalKinds[kind], item=el&&globalItem(kind,el.dataset.globalId);
    setEditorFocus({kind:'global',lane:kind,id:item?.id});
    el?.focus({preventScroll:true});
    const at=item?.at??timelineBeat(lane,{clientX:x});
    globalContext={kind,at,id:item?.id};
    const rows=item?[['@global-edit','Edit '+spec.entry.toLowerCase()+'…'],['@global-locate','Locate'],
      ...(item.length?[['@global-loop','Loop this '+spec.entry.toLowerCase()]]:[]),
      ...(kind==='arranger'?[['@global-select','Select events in section']]:[]),
      ...(kind==='tempo'||kind==='signature'&&item.denominator===4?[['@global-apply','Apply to session']]:[]),
      ['@global-delete','Delete '+spec.entry.toLowerCase()]]:[['@global-edit','Add '+spec.entry.toLowerCase()+'…']];
    showContext(x,y,[[spec.label,rows]],owner);
    return true;
  }
  function globalTrackAction(el){
    const action=el.dataset.action;
    if(!action.startsWith('global-'))return false;
    if(action.startsWith('global-show-')){
      const kind=action.slice(12);
      if(Object.hasOwn(globalKinds,kind))showGlobalLane(kind,!visibleGlobals.has(kind));
      $('global-tracks').focus({preventScroll:true});return true;
    }
    if(isEditing())return true;
    const {kind,at,id}=globalContext||{};
    const item=kind&&id?globalItem(kind,id):null;
    if(action==='global-add')openGlobalEntry(el.dataset.kind,sn(playhead));
    if(action==='global-edit'&&kind)openGlobalEntry(kind,at,item);
    if(action==='global-locate'&&item)seek(item.at);
    if(action==='global-loop'&&item?.length)setTimelineLoop([item.at,item.at+item.length],true);
    if(action==='global-select'&&item?.length){
      const rows=allClips().filter(({c})=>c.start<item.at+item.length&&c.start+c.length>item.at);
      selectMany(rows);status(rows.length+' event(s) in '+item.name);
    }
    if(action==='global-delete'&&item)deleteGlobalItem(kind,item);
    if(action==='global-apply'&&item){
      if(kind==='tempo')edit(()=>{p.bpm=item.bpm;},valueStatus('','Tempo',item.bpm,'BPM'));
      else if(kind==='signature'&&item.denominator===4)edit(()=>{p.meter=item.meter;},valueStatus('','Time signature',item.meter+'/4'));
    }
    return true;
  }
  function startTimelineGesture(event,common){
    const target=event.target, surface=target.closest('[data-loop-editor]');
    const el=target.closest('[data-global-id]');
    if(!surface&&!el)return false;
    if(surface){
      const handle=target.closest('[data-loop-handle]'), mode=handle?.dataset.loopHandle||'draw';
      handle?.focus({preventScroll:true});
      (handle||surface).setPointerCapture?.(event.pointerId);
      gesture={...common,kind:'timeline-loop',surface,mode,anchor:timelineBeat(surface,event),start:p.loopStart,end:p.loopEnd};
    }else{
      const kind=el.dataset.globalKind,item=globalItem(kind,el.dataset.globalId);
      if(!item)return false;
      setEditorFocus({kind:'global',lane:kind,id:item.id});
      const lane=el.closest('[data-global-lane]');
      el.focus({preventScroll:true});el.setPointerCapture?.(event.pointerId);
      gesture={...common,kind:'global-event',which:kind,el,item,lane,anchor:timelineBeat(lane,event),mode:target.dataset.globalEdge||'move'};
    }
    event.preventDefault();
    return true;
  }
  function moveTimelineGesture(g,event){
    if(g.kind==='timeline-loop'){
      g.bounds=SW.loopBounds(g.mode,g.start,g.end,timelineBeat(g.surface,event),g.anchor);
      previewLoop(g.surface,g.bounds,g.mode==='draw'||p.loop);return true;
    }
    if(g.kind==='global-event'){
      g.value=SW.arrangeEntryBounds(g.mode,g.item,timelineBeat(g.lane,event),g.anchor);
      g.el.style.left=g.value.at*zoom+'px';
      if(g.value.length)g.el.style.width=g.value.length*zoom+'px';
      return true;
    }
    return false;
  }
  function finishTimelineGesture(g,event){
    if(g.kind==='timeline-loop'){
      if(event.type==='pointercancel')previewLoop(g.surface,[p.loopStart,p.loopEnd],p.loop);
      else if(g.bounds)setTimelineLoop(g.bounds,g.mode==='draw'||p.loop);
      else if(g.mode==='draw')seek(g.anchor);
      return true;
    }
    if(g.kind==='global-event'){
      if(event.type==='pointercancel'){renderArrangement();updatePosition();}
      else if(g.value&&(g.item.at!==g.value.at||g.item.length!==g.value.length)){
        noDoubleBefore=performance.now()+230;
        const entry=saveGlobalItem(g.which,{...g.item,...g.value},g.item.id);
        find('[data-global-id="'+entry.id+'"]')?.focus({preventScroll:true});
      }else seek(g.item.at);
      return true;
    }
    return false;
  }
  function renderLocators(){
    $('loop-start').value=SW.locatorText(p.loopStart,p.meter);
    $('loop-end').value=SW.locatorText(p.loopEnd,p.meter);
  }
  function setLocator(id,start){
    const input=$(id);
    input.addEventListener('change',()=>{
      if(isEditing()){renderLocators();return;}
      const at=SW.parseLocator(input.value,p.meter);
      if(at===null){renderLocators();status('Enter a valid bar.beat.tick locator.',true);return;}
      setTimelineLoop(SW.loopBounds(start?'left':'right',p.loopStart,p.loopEnd,at));
      renderLocators();
    });
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();input.blur();}
      if(event.key==='Escape'){event.preventDefault();renderLocators();input.blur();}
    });
  }
  function stepMarker(direction){
    if(isEditing())return;
    const points=p.markers.map(marker=>marker.at).sort((a,b)=>a-b);
    const target=direction<0?points.filter(at=>at<playhead-1e-5).at(-1)??0:
      points.find(at=>at>playhead+1e-5)??Math.max(playhead,songEnd(p));
    seek(target);
  }
  function updatePosition(){
    $('position').value=SW.locatorText(playhead,p.meter);
    sessionViews?.position(playhead);
    const ms=Math.floor(seconds(playhead,p.bpm)*1000);
    $('time').value=Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');
    document.querySelectorAll('#arrange-grid .playline').forEach(el=>el.style.left=playhead*zoom+'px');
    updateGlobalPosition();
    const roll=find('[data-roll]');
    if(roll&&editorClip()){
      const c=editorClip(), local=playhead-c.start, line=roll.querySelector('.playline');
      line.style.display=local>=0&&local<=c.length?'block':'none';line.style.left=local*Number(roll.dataset.scale)+'px';
    }
    const midiCursor=find('[data-expression-cursor]');
    if(midiCursor&&editorClip()?.type==='midi'){
      const c=editorClip();midiCursor.style.left=(clamp((playhead-c.start)/c.length,0,1)*100)+'%';
    }
    const line=find('[data-auto-playline]');
    if(line){const x=playhead*(Number(line.closest('[data-envelope]')?.dataset.scale)||zoom);line.setAttribute('x1',x);line.setAttribute('x2',x);}
  }
  function updateTransport(){
    const on=Boolean(live), recording=Boolean(recorder||midiTake||pendingRecord);
    $('play').classList.toggle('active',on);$('record').classList.toggle('active',recording);
    $('play').setAttribute('aria-pressed',on);$('record').setAttribute('aria-pressed',recording);
    $('audio-state').textContent=pendingRecord?'Waiting for input':finishingRecord?'Finishing take':recording?'Recording':on?ctx.sampleRate+' Hz · Playing':
      monitorGraph?ctx.sampleRate+' Hz · Monitoring':ctx?ctx.sampleRate+' Hz · Idle':'Audio idle';
  }
  let engineKey='', configuringAudio;
  async function ensureAudio(){
    const {sampleRate,latency,outputDevice}=prefs;
    const key=JSON.stringify([sampleRate,latency,outputDevice]);
    if(!live&&(!ctx||engineKey!==key)){
      if(!configuringAudio){
        configuringAudio=(async()=>{
          const next=SW.audioContext({latencyHint:latency,...(Number(sampleRate)?{sampleRate:Number(sampleRate)}:{})});
          try{
            await next.resume();
            if(outputDevice){
              if(!next.setSinkId) throw Error('This browser cannot select an audio output. Choose System default in Preferences.');
              await next.setSinkId(outputDevice);
            }
          }catch(e){await next.close().catch(()=>{});throw e;}
          stopPreview();
          const previous=ctx;
          if(previous){
            for(const [id,slot] of audioMonitors)if(slot.source)releaseAudioMonitor(id);
            syncAudioMonitors();
          }
          ctx=next;engineKey=key;
          if(previous&&previous.state!=='closed') previous.close().catch(()=>{});
        })().finally(()=>{configuringAudio=null;});
      }
      await configuringAudio;
    }
    if(ctx.state!=='running') await ctx.resume();
    return ctx;
  }
  let starting=false;
  async function startPlayback(){
    if(starting||live||busy) return;
    starting=true;
    try{await ensureAudio();if(starting) beginPlayback();}
    finally{starting=false;}
  }
  function beginPlayback(clock){
    const isRecording=Boolean(recorder||midiTake);
    const loop=p.loop&&!isRecording, end=loop?p.loopEnd:songEnd(p);
    let start=playhead;
    if(loop&&(start<p.loopStart||start>=p.loopEnd)) start=p.loopStart;
    if(!isRecording&&!loop&&start>=end) start=0;
    playhead=start;
    const graph=SW.buildGraph(ctx,p,true,p.monitorDisconnected?'__off':p.monitorCue||'master'), when=ctx.currentTime+.06;
    const until=Math.max(start,end);
    const beatSec=seconds(1,p.bpm);
    if(!automationTake){
      currentOverride=new Map();
      for(const t of [...p.tracks,p.master]) if(t.automation==='Write'){
        for(const key of Object.keys(t.lanes)){
          currentOverride.set(t.id+':'+key,laneValue(t,key));
          beginWrite(t,key,laneValue(t,key),start);
        }
      }
    }else{
      for(const [id, value] of currentOverride){
        const first=id.indexOf(':');
        SW.overrideParam(graph,id.slice(0,first),id.slice(first+1),value);
      }
    }
    SW.schedule(graph,media,start,until,when,{loop,click:p.click,overrides:currentOverride,chaseNotes:prefs.chaseNotes});
    const firstEnd=when+(until-start)*beatSec;
    live={graph,start,when,firstEnd,loop,loopStart:p.loopStart,loopEnd:p.loopEnd,end,beatSec,recording:isRecording,next:firstEnd,frame:0,timer:0,nextClick:Math.ceil(until),lastFrame:0};
    const state=live;syncAudioMonitors();
    if(clock) state.clock=clock;else startMidiClock(state);
    state.timer=setInterval(()=>fillPlayback(state),25);
    state.frame=requestAnimationFrame(time=>tickPlayback(state,time));
    updateTransport();
  }
  function fillPlayback(state){
    if(live!==state) return;
    fillMidiClock(state);
    if(state.loop){
      const duration=(state.loopEnd-state.loopStart)*state.beatSec;
      if(state.next<ctx.currentTime-.15) state.next+=Math.max(0,Math.floor((ctx.currentTime-state.next)/duration))*duration;
      while(state.next<ctx.currentTime+prefs.lookahead/1000){
        SW.schedule(state.graph,media,state.loopStart,state.loopEnd,state.next,{loop:true,click:p.click,overrides:currentOverride,chaseNotes:true});
        state.next+=duration;
      }
    }else if(state.recording&&p.click){
      const now=state.start+Math.max(0,ctx.currentTime-state.when)/state.beatSec;
      if(state.nextClick<now) state.nextClick=Math.ceil(now);
      if(state.nextClick<=now+.28/state.beatSec){
        const beat=state.nextClick++;
        SW.schedule(state.graph,new Map(),beat,beat+.01,state.when+(beat-state.start)*state.beatSec,{only:'__metronome',click:true,overrides:currentOverride});
      }
    }
  }
  function positionAt(state){
    const elapsed=Math.max(0,ctx.currentTime-state.when), position=state.start+elapsed/state.beatSec;
    if(state.loop&&position>=state.loopEnd) return state.loopStart+(position-state.loopEnd)%(state.loopEnd-state.loopStart);
    return state.recording?position:Math.min(position,state.end);
  }
  function tickPlayback(state,time){
    if(live!==state) return;
    playhead=positionAt(state);
    if(time-state.lastFrame>=23){
      updatePosition();updateMeters();reference.align(true);
      if(automationTake&&time-writeTick>=prefs.autoWriteInterval){writeTick=time;extendWrite(playhead);}
      state.lastFrame=time;
    }
    if(!state.loop&&!state.recording&&ctx.currentTime>=state.firstEnd) stopMidiClock(state);
    if(!state.loop&&!state.recording&&ctx.currentTime>=state.firstEnd+prefs.tail){
      stopPlayback();return;
    }
    state.frame=requestAnimationFrame(t=>tickPlayback(state,t));
  }
  function destroyPlayback(keepClock=false){
    if(!live) return;
    cancelAnimationFrame(live.frame);clearInterval(live.timer);
    if(!keepClock) stopMidiClock(live);
    live.graph.stop();live=null;
  }
  function stopPlayback(doWrite=true){
    starting=false;
    if(live) playhead=positionAt(live);
    destroyPlayback();
    if(doWrite) finishWrite();
    else clearWrites();
    syncAudioMonitors();updateTransport();updatePosition();updateMeters();reference.align(false);
  }
  function rebuildPlayback(){
    if(!live) return;
    playhead=positionAt(live);
    const clock=live.beatSec===seconds(1,p.bpm)?live.clock:null;
    destroyPlayback(Boolean(clock));
    beginPlayback(clock);
  }
  function seek(at){
    if(recorder||pendingRecord||midiTake) return;
    playhead=clamp(at,0,99999);
    if(live){destroyPlayback();beginPlayback();}
    updatePosition();reference.align(Boolean(live));
  }
  function updateMeters(){
    const displays=new Map(all('[data-meter]').map(el=>[el.dataset.meter,el]));
    const trackMeters=new Map(all('[data-track-meter]').map(el=>[el.dataset.trackMeter,el]));
    for(const t of [...p.tracks,p.master]){
      const id=t.id,el=displays.get(id), trackMeter=trackMeters.get(id);
      const analyzer=(recorder?.id===id?recorder.analyzer:null)||
        live?.graph.tracks.get(id)?.analyzer||monitorGraph?.tracks.get(id)?.analyzer||previewGraph?.tracks?.get(id)?.analyzer;
      let max=0;
      if(analyzer){analyzer.getFloatTimeDomainData(frames);for(const sample of frames)max=Math.max(max,Math.abs(sample));}
      const peak=prefs.holdPeaks?Math.max(mixerPeak.get(id)||0,max):max;mixerPeak.set(id,peak);
      const db=20*Math.log10(Math.max(1e-6,max)), scale=clamp((db+60)/60,0,1);
      if(trackMeter){
        trackMeter.firstElementChild.style.transform='scaleY('+scale+')';
        trackMeter.classList.toggle('clipped',peak>=.999);
        trackMeter.setAttribute('aria-valuenow',Math.round(clamp(db,-60,0)));
      }
      if(el){
        el.firstElementChild.style.transform='scaleY('+scale+')';
        el.classList.toggle('clipped',peak>=.999);
        const output=find('[data-peak="'+id+'"]');
        if(output)output.value=peak>0?'Peak '+fmt(20*Math.log10(peak),1):'Peak —';
      }
      if(tab==='routing')setGraphActivity(id,max);
      if(studioPlugin?.type==='inst'&&studioPlugin.track===id&&$('plugin-meter'))$('plugin-meter').value=max>0?fmt(20*Math.log10(max),1)+' dBFS':'— dBFS';
    }
    if(tab==='routing'){
      for(const cue of SW.cueSettings(p)){
        const analyzer=live?.graph.cueMeters.get(cue.id);
        let peak=0;
        if(analyzer){analyzer.getFloatTimeDomainData(frames);for(const sample of frames)peak=Math.max(peak,Math.abs(sample));}
        setGraphActivity(cue.id,peak);
      }
    }
    if(studioPlugin)drawPluginAnalysis();
  }
  function setGraphActivity(id,gain){
    for(const path of all('[data-flow-owner="'+id+'"]')){
      path.classList.toggle('flow-active',gain>.001&&!path.classList.contains('stopped'));
      path.style.strokeWidth=gain>.001?String(1.4+Math.min(1.2,gain*2)):'1.35';
    }
  }
  let previewMeterFrame=0;
  function previewMeters(){
    if(previewMeterFrame||!previewGraph||live)return;
    const repaint=()=>{
      previewMeterFrame=0;
      if(previewGraph&&!live){updateMeters();previewMeterFrame=requestAnimationFrame(repaint);}
    };
    previewMeterFrame=requestAnimationFrame(repaint);
  }
  function stopPreview(){
    clearTimeout(previewTimer);if(previewMeterFrame)cancelAnimationFrame(previewMeterFrame);previewMeterFrame=0;
    if(previewGraph) previewGraph.stop();
    previewGraph=null;
    if(!live)updateMeters();
  }
  async function audition(t,pitch,velocity=.77){
    await ensureAudio();
    if(live?.graph.tracks.has(t.id)){
      SW.voice(live.graph,t,pitch,velocity,ctx.currentTime+.013,.26,media);
      return;
    }
    if(!previewGraph||!previewGraph.tracks.has(t.id)){
      stopPreview();
      previewGraph=SW.buildGraph(ctx,{...p,tracks:p.tracks.map(row=>({...row,solo:row.id===t.id,mute:false})),master:{...p.master,mute:false}},true);
    }
    SW.voice(previewGraph,t,pitch,velocity,ctx.currentTime+.013,.29,media);previewMeters();
    clearTimeout(previewTimer);previewTimer=setTimeout(stopPreview,1100);
  }
  async function assetPreview(id){
    await ensureAudio();stopPreview();
    const source=ctx.createBufferSource(),gain=ctx.createGain();gain.gain.value=.65;
    source.buffer=media.get(id).buffer;source.connect(gain).connect(ctx.destination);
    previewGraph={stop:()=>{try{source.stop();}catch{}source.disconnect();gain.disconnect();}};
    source.start();
    previewTimer=setTimeout(stopPreview,Math.min(5000,source.buffer.duration*1000+50));
  }
  function addTrack(type){
    const count=p.tracks.filter(t=>t.type===type).length;
    const t=makeTrack(type,typeLabel({type})+' '+(count+1));
    selectTrack(t.id,false);return t;
  }
  function makeTrack(type,name){
    const t=channel(name,type,p.tracks.length);
    if(!prefs.autoColors) t.color=channel('Master','master',0).color;
    t.automation=prefs.defaultAutomation;
    if(prefs.autoLanes){addPoint(t,'volume',0,t.volume);addPoint(t,'pan',0,t.pan);}
    p.tracks.push(t);return t;
  }
  function newMidiClip(t,at){
    const c=clip('midi',clamp(at,0,99999),p.meter,'Instrument part');
    t.clips.push(c);selectClip(t,c,false);return c;
  }
  async function decodeAsset(bytes,name){
    const context=ctx||(ctx=SW.audioContext());
    const buffer=await context.decodeAudioData(bytes.slice(0));
    if(buffer.duration<=0||buffer.duration>86400) throw Error('Audio duration is outside the supported range.');
    return {id:uid(),name:name.slice(0,120),bytes,buffer};
  }
  function registerAsset(entry){
    p.assets[entry.id]={name:entry.name,duration:entry.buffer.duration};
    media.set(entry.id,entry);
  }
  function placeAsset(t,id,at){
    const a=p.assets[id];
    const c=clip('audio',clamp(at,0,99999),a.duration*p.bpm/60,a.name.replace(/\.[^.]+$/,''));
    c.asset=id;c.sourceBpm=p.bpm;
    t.clips.push(c);selectClip(t,c,false);return c;
  }
  const audioTrack=t=>t?.type==='audio'?t:addTrack('audio');
  async function importFiles(files,at=playhead,target=currentTrack()){
    if(!files.length||busy||pendingRecord) return;
    busy=true;
    const ok=[], fails=[];
    try{
      for(const file of files){
        try{
          const bytes=await file.arrayBuffer();
          const head=new Uint8Array(bytes,0,Math.min(bytes.byteLength,4));
          if((file.name&&/\.midi?$/i.test(file.name))||String.fromCharCode(...head)==='MThd'){
            const midi=SW.parseMidi(bytes);
            if(!midi.tracks.length) throw Error('MIDI file has no supported note or control events.');
            ok.push({midi});
          }else ok.push({entry:await decodeAsset(bytes,file.name)});
        }catch(e){fails.push(file.name+' ('+(e.message||'unsupported file')+')');}
      }
      if(ok.length){
        const prev=before();
        for(const [i,row] of ok.entries()){
          if(row.entry){
            registerAsset(row.entry);
            const t=audioTrack(i===0&&p.tracks.includes(target)?target:null);
            placeAsset(t,row.entry.id,at);
          }else{
            if(!p.tracks.some(t=>t.clips.length)) p.bpm=clamp(round(row.midi.bpm),30,320);
            for(const part of row.midi.tracks){
              const t=addTrack('midi');t.name=part.name;t.instrument=part.drum?'Drums':'Keys';
              const length=Math.max(.001,part.notes.reduce((max,n)=>Math.max(max,n.start+n.length),0),...Object.values(part.expression||{}).map(points=>points.at(-1)?.at||0));
              const c=clip('midi',at,Math.ceil(length/p.meter)*p.meter,part.name);
              c.notes=part.notes;if(part.expression)c.expression=part.expression;t.clips.push(c);selectClip(t,c,false);
            }
          }
        }
        commit(prev,'Imported '+ok.length+' file'+(ok.length===1?'':'s')+(ok.some(row=>row.midi?.tempoChanges)?' · MIDI tempo changes flattened':''));
      }
      if(fails.length) status((ok.length?'Imported '+ok.length+' · ':'')+'Could not import '+fails.join(', '),true);
    }finally{busy=false;}
  }
  function clipLimit(c){return c.type==='audio'?p.assets[c.asset].duration*c.sourceBpm/60:100000;}
  function setLength(c,length){
    c.length=clamp(length,Math.min(.001,clipLimit(c)-c.offset),clipLimit(c)-c.offset);
    if(c.type==='audio'){
      c.fadeIn=Math.min(c.fadeIn,c.length);c.fadeOut=Math.min(c.fadeOut,c.length-c.fadeIn);
    }else{
      if(c.expression)c.expression=SW.expressionSlice(c,0,c.length);
      c.notes=c.notes.filter(n=>n.start<c.length).map(n=>({...n,length:Math.min(n.length,c.length-n.start)}));
    }
  }
  function normalizeClip(c){
    const b=media.get(c.asset)?.buffer;
    if(!b) return;
    const scale=b.sampleRate*60/c.sourceBpm;
    const start=Math.floor(c.offset*scale), end=Math.min(b.length,Math.ceil((c.offset+c.length)*scale));
    let max=0;
    for(let ch=0;ch<b.numberOfChannels;ch++){
      const data=b.getChannelData(ch);
      for(let i=start;i<end;i++) max=Math.max(max,Math.abs(data[c.reverse?b.length-1-i:i]));
    }
    if(max>0) c.gain=clamp(-1-20*Math.log10(max),-60,24);
  }
  function duplicateTrack(t){
    const next=clone(t);
    next.id=uid();next.name=(next.name+' copy').slice(0,120);
    const mapping=new Map();
    for(const e of next.fx){const old=e.id;e.id=uid();mapping.set(old,e.id);}
    SW.renumberFX(next,mapping);
    next.lanes=Object.fromEntries(Object.entries(next.lanes).map(([key,points])=>{
      const [prefix,id,param]=key.split(':');
      return [prefix==='fx'?'fx:'+mapping.get(id)+':'+param:key,points];
    }));
    next.clips=next.clips.map(c=>({...c,id:uid(),notes:c.notes.map(n=>({...n,id:uid()}))}));
    p.tracks.splice(p.tracks.indexOf(t)+1,0,next);selectTrack(next.id,false);
  }
  function moveTrack(t,by){
    const i=p.tracks.indexOf(t), j=i+by;
    if(i>=0&&j>=0&&j<p.tracks.length) [p.tracks[i],p.tracks[j]]=[p.tracks[j],p.tracks[i]];
  }
  function addPoint(t,key,at,value){
    const points=t.lanes[key]??=[];
    const cleanAt=round(clamp(at,0,99999));
    const index=points.findIndex(pt=>Math.abs(pt.at-cleanAt)<1e-6);
    if(index>=0) points[index]={at:cleanAt,value};
    else points.push({at:cleanAt,value});
    points.sort((a,b)=>a.at-b.at);
  }
  let automationTake=null, automationSnapshot=null, writingChanged=false;
  const writeKey=(t,key)=>t.id+':'+key;
  function beginWrite(t,key,value,at){
    if(!automationTake){automationTake=new Map();automationSnapshot=before();}
    const id=writeKey(t,key);
    if(!automationTake.has(id)) automationTake.set(id,{t,key,last:at,value,active:true});
    const row=automationTake.get(id);
    row.active=true;row.value=value;
    currentOverride.set(id,value);
    addPoint(t,key,at,value);writingChanged=true;
  }
  function extendWrite(at,only){
    for(const [id,row] of automationTake||[]){
      if((only&&id!==only)||!row.active||at===row.last) continue;
      const from=row.last;
      if(at>from){
        row.t.lanes[row.key]=(row.t.lanes[row.key]||[]).filter(pt=>pt.at<=from||pt.at>=at);
      }
      addPoint(row.t,row.key,at,row.value);
      row.last=at;
    }
  }
  function clearWrites(){
    automationTake=null;automationSnapshot=null;writingChanged=false;currentOverride.clear();
  }
  function finishWrite(){
    if(!automationTake) return;
    extendWrite(playhead);
    const previous=automationSnapshot, changed=writingChanged;
    clearWrites();
    if(changed) commit(previous,'Wrote automation',false);
  }
  async function chooseInput(t=currentTrack()){
    if(t.type!=='audio')return;
    inputTarget=t.id;
    if(!navigator.mediaDevices?.getUserMedia) throw Error('Audio input requires a supported secure browser context.');
    let devices=await navigator.mediaDevices.enumerateDevices();
    if(!devices.some(d=>d.kind==='audioinput'&&d.label)){
      const access=await navigator.mediaDevices.getUserMedia({audio:true});
      access.getTracks().forEach(t=>t.stop());
      devices=await navigator.mediaDevices.enumerateDevices();
    }
    const dialog=$('input-dialog'), input=$('input-device');
    input.innerHTML=option('','Preferences default',t.inputDevice||'')+devices.filter(d=>d.kind==='audioinput'&&d.deviceId&&d.deviceId!=='default').map((d,i)=>option(d.deviceId,d.label||'Input '+(i+1),t.inputDevice)).join('');
    dialog.returnValue='';window.focus?.();dialog.showModal();
  }
  function recordError(error){
    const messages={
      NotAllowedError:'Audio input permission was denied. Allow the microphone in Chrome or Edge and in Windows Microphone privacy settings.',
      NotFoundError:'No audio input was found. Connect a microphone or audio interface, then choose the track input.',
      OverconstrainedError:'The saved audio input is unavailable. Choose another input from the track menu or Audio Setup.',
      NotReadableError:'The audio input could not be opened. Check the interface connection and close other apps using it exclusively.',
      SecurityError:'The browser blocked audio input. Open Sonoravell with Start-Sonoravell.cmd.'
    };
    return messages[error.name]?Error(messages[error.name],{cause:error}):error;
  }
  function releaseAudioMonitor(id){
    const slot=audioMonitors.get(id);
    if(!slot)return;
    audioMonitors.delete(id);monitoring.delete(id);
    slot.source?.disconnect();
    if(slot.rawSource!==slot.source)slot.rawSource?.disconnect();
    slot.stream?.getTracks().forEach(track=>track.stop());
  }
  function closeAudioMonitors(){
    for(const id of audioMonitors.keys())releaseAudioMonitor(id);
    monitoring.clear();syncAudioMonitors();
  }
  function syncAudioMonitors(rebuild=false){
    const ready=[...audioMonitors].filter(([,slot])=>slot.source);
    if(monitorGraph&&(live||rebuild||!ready.length)){monitorGraph.stop();monitorGraph=null;}
    if(ready.length&&!live&&!monitorGraph)
      monitorGraph=SW.buildGraph(ctx,p,true,p.monitorDisconnected?'__off':p.monitorCue||'master');
    const graph=live?.graph||monitorGraph;
    for(const [id,slot] of ready){
      const dest=graph?.tracks.get(id)?.source||null;
      if(slot.destination===dest)continue;
      if(slot.destination)slot.source.disconnect(slot.destination);
      if(dest)slot.source.connect(dest);
      slot.destination=dest;
    }
    if(monitorGraph&&!monitorFrame){
      const tick=()=>{
        monitorFrame=0;
        if(monitorGraph&&!live){updateMeters();monitorFrame=requestAnimationFrame(tick);}
      };
      monitorFrame=requestAnimationFrame(tick);
    }else if(!monitorGraph&&monitorFrame){cancelAnimationFrame(monitorFrame);monitorFrame=0;}
  }
  async function enableAudioMonitor(t){
    if(audioMonitors.has(t.id))return;
    const slot={destination:null};
    audioMonitors.set(t.id,slot);monitoring.add(t.id);
    render();
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Launch Sonoravell on localhost to use audio input monitoring.');
      await ensureAudio();
      if(audioMonitors.get(t.id)!==slot)return;
      const constraints=SW.recordingConstraints(prefs,t.inputDevice,t.recordChannels);
      const stream=await navigator.mediaDevices.getUserMedia({audio:constraints,video:false});
      if(audioMonitors.get(t.id)!==slot){stream.getTracks().forEach(track=>track.stop());return;}
      slot.stream=stream;slot.constraints=JSON.stringify(constraints);
      const track=stream.getAudioTracks()[0];
      if(!track)throw Error('The selected device returned no audio input.');
      slot.rawSource=slot.source=ctx.createMediaStreamSource(stream);
      if(t.recordChannels===1&&ctx.createGain){
        const mono=ctx.createGain();mono.channelCount=1;mono.channelCountMode='explicit';
        slot.source.connect(mono);slot.source=mono;
      }
      track.addEventListener('ended',()=>{
        if(audioMonitors.get(t.id)!==slot)return;
        releaseAudioMonitor(t.id);syncAudioMonitors();render();
        status('Input disconnected · '+t.name,true);
      },{once:true});
      syncAudioMonitors();if(recorder?.id===t.id)monitorTake(recorder);
      render();status('Listening to '+t.name);
    }catch(error){
      if(audioMonitors.get(t.id)!==slot)return;
      releaseAudioMonitor(t.id);syncAudioMonitors();render();throw recordError(error);
    }
  }
  function toggleMonitor(t){
    if(t.type==='midi'&&!t.instrumentOnly){
      if(t.sourceInput==='off'){status('Select a MIDI input for '+t.name+' first.',true);return;}
      if(mutedMidiMonitors.delete(t.id))status('Listening to '+t.name);
      else{
        mutedMidiMonitors.add(t.id);releaseKeyboard();
        status('Input monitoring off · '+t.name);
      }
      render();return;
    }
    if(t.type!=='audio')return;
    if(monitoring.has(t.id)){
      monitoring.delete(t.id);releaseAudioMonitor(t.id);syncAudioMonitors();
      if(recorder?.id===t.id)monitorTake(recorder);
      render();status('Input monitoring off · '+t.name);return;
    }
    monitoring.add(t.id);
    if(recorder?.id===t.id){monitorTake(recorder);render();status('Listening to '+t.name);return;}
    run(enableAudioMonitor)(t);
  }
  function closeInput(take){
    try{take?.input?.close();}
    finally{take?.stream?.getTracks().forEach(track=>track.stop());}
  }
  function monitorTake(take){
    if(!take?.input||take.finishing)return;
    if(take.monitor)take.input.source.disconnect(take.monitor);
    take.monitor=monitoring.has(take.id)&&!audioMonitors.get(take.id)?.source?live?.graph.tracks.get(take.id)?.source:null;
    if(take.monitor)take.input.source.connect(take.monitor);
  }
  async function beginRecord(){
    if(recorder||midiTake||pendingRecord){stopAction();return;}
    if(busy||starting)return;
    const selected=currentTrack(), candidates=p.tracks.filter(row=>SW.timelineTrack(row)&&armed.has(row.id));
    const recordable=SW.timelineTrack(selected);
    const t=armed.has(selected.id)?selected:candidates.length===1?candidates[0]:
      !candidates.length&&recordable?selected:null;
    if(!t){status(candidates.length?'Select an armed track to record.':'Select or arm an audio or instrument track first.',true);return;}
    if(t.type==='midi'&&t.sourceInput==='off'){status('Enable MIDI input for '+t.name+' first.',true);return;}
    if(t.type==='midi'&&t.sourceInput==='external'&&!midiAccess?.inputs.size){
      status('Enable MIDI In and connect a MIDI device, or select QWERTY as the track input.',true);return;
    }
    if(t.type==='audio'&&!navigator.mediaDevices?.getUserMedia){
      throw Error('Open Sonoravell with Start-Sonoravell.cmd in Chrome or Edge to enable audio input.');
    }
    const request={start:live?positionAt(live):playhead};
    pendingRecord=request;updateTransport();
    let take;
    try{
      await ensureAudio();
      if(pendingRecord!==request)return;
      if(t.type==='audio'){
        take={id:t.id,start:request.start,sourceBpm:p.bpm,offset:prefs.recordOffset/1000*p.bpm/60};
        const audio=SW.recordingConstraints(prefs,t.inputDevice,t.recordChannels), slot=audioMonitors.get(t.id);
        take.stream=slot?.constraints===JSON.stringify(audio)&&slot.stream?.clone?slot.stream.clone():
          await navigator.mediaDevices.getUserMedia({audio,video:false});
        if(pendingRecord!==request){closeInput(take);return;}
        const streamTrack=take.stream.getAudioTracks()[0];
        if(!streamTrack)throw Error('The selected device returned no audio input.');
        const channels=clamp(t.recordChannels||Number(prefs.recordChannels)||streamTrack.getSettings().channelCount||1,1,2);
        take.input=await SW.captureInput(ctx,take.stream,channels,Number(prefs.recordBitrate)*1000);
        take.analyzer=take.input.analyzer;
        if(pendingRecord!==request){closeInput(take);return;}
        streamTrack.addEventListener('ended',()=>{
          if(recorder===take){status('Audio input disconnected. Finishing the captured take…',true);run(finishAudioTake)(take);}
        },{once:true});
      }
      releaseKeyboard();stopPreview();
      if(live){
        request.start=positionAt(live);stopPlayback();
        if(take)take.start=request.start;
      }
      playhead=request.start;
      if(t.type==='audio')recorder=take;
      else{
        if(t.sourceInput==='qwerty'||!midiAccess?.inputs.size)setKeyboard(true);
        midiTake={id:t.id,start:request.start,notes:[]};heldMidi.clear();
      }
      beginPlayback();
      if(take){take.input.start(live.when);monitorTake(take);}
      armed.add(t.id);selectTrack(t.id,false);render();
      status('Recording '+(take?'audio':'MIDI')+' into '+t.name+' · Stop or press R to finish');
    }catch(error){
      if(take)closeInput(take);
      if(pendingRecord!==request)return;
      if(recorder&&recorder===take){recorder=null;stopPlayback(false);}
      if(midiTake){midiTake=null;stopPlayback(false);}
      throw recordError(error);
    }finally{
      if(pendingRecord===request){pendingRecord=null;updateTransport();}
    }
  }
  async function finishAudioTake(take){
    if(take.finishing)return;
    take.finishing=true;finishingRecord=true;
    const pending=take.input.stop();
    stopPlayback();
    status('Finishing audio take…');
    try{
      const buffer=await pending;
      const target=channelById(take.id);
      if(target?.type!=='audio')throw Error('The recorded audio track is unavailable.');
      if(!buffer.length||buffer.duration>86400)throw Error('Audio duration is outside the supported range.');
      const name='Recording '+new Date().toLocaleTimeString().replace(/:/g,'-')+'.wav';
      const entry={id:uid(),name,buffer,bytes:SW.wav(buffer,24)};
      const prev=before();
      registerAsset(entry);
      const c=placeAsset(target,entry.id,take.start+take.offset);
      c.sourceBpm=take.sourceBpm;c.length=buffer.duration*take.sourceBpm/60;
      commit(prev,'Recorded '+fmt(buffer.duration)+' s into '+target.name,false);
    }finally{
      recorder=null;finishingRecord=false;closeInput(take);syncAudioMonitors();updateTransport();updateMeters();
      const target=channelById(take.id);
      if(target&&monitoring.has(take.id)&&!audioMonitors.has(take.id))run(enableAudioMonitor)(target);
    }
  }
  function stopRecording(){
    if(recorder){run(finishAudioTake)(recorder);return;}
    if(!midiTake) return;
    const take=midiTake, now=live?positionAt(live):playhead;
    for(const token of heldMidi.keys()) endMidiNote(token,now);
    releaseKeyboard();
    heldMidi.clear();midiTake=null;stopPlayback();
    const t=p.tracks.find(row=>row.id===take.id);
    if(!t||!take.notes.length&&!take.expression){status('MIDI take contains no notes or controls.');return;}
    const prev=before();
    const length=Math.max(take.notes.reduce((end,n)=>Math.max(end,n.start+n.length),.25),now-take.start);
    const c=clip('midi',take.start,length,'Recorded MIDI');
    c.notes=take.notes;if(take.expression)c.expression=take.expression;t.clips.push(c);selectClip(t,c,false);commit(prev,'Recorded MIDI take');
  }
  async function enableMidi(){
    if(!navigator.requestMIDIAccess) throw Error('Web MIDI is unavailable. Open Sonoravell on localhost in Chrome or Edge.');
    if(!midiAccess){
      midiAccess=await navigator.requestMIDIAccess({sysex:false});
      const attach=()=>{
        const connected=new Set(midiAccess.inputs.keys());
        const deviceOf=key=>key.slice(5,key.lastIndexOf(':'));
        for(const id of [...keyboardHeld.keys()]) if(id.startsWith('midi:')&&!connected.has(deviceOf(id.slice(0,id.lastIndexOf(':'))))) midiInputStop(id,true);
        for(const key of hardwareControls.keys())if(!connected.has(deviceOf(key))){
          for(const voice of pedalVoices.get(key)||[])voice.release?.();
          pedalVoices.delete(key);hardwareControls.delete(key);
        }
        for(const input of midiAccess.inputs.values()) input.onmidimessage=receiveMidi;
        preferenceWindow.refresh();
      };
      midiAccess.onstatechange=attach;attach();
    }
    status(midiAccess.inputs.size?midiAccess.inputs.size+' MIDI input(s) enabled':'MIDI enabled · no devices detected');
    $('midi-in').setAttribute('aria-pressed','true');
  }
  function endMidiNote(token,at){
    const down=heldMidi.get(token);
    if(!down) return;
    heldMidi.delete(token);
    if(!midiTake) return;
    const start=prefs.quantizeRecord?sn(down.at):down.at;
    midiTake.notes.push(note(down.pitch,Math.max(0,start-midiTake.start),Math.max(.015,at-down.at),down.velocity));
  }
  function receiveMidi(event){
    const [key,pitch,velocity]=event.data;
    const source=event.currentTarget?.id||'device', inputChannel=(key&15)+1;
    const type=key>>4, token='midi:'+source+':'+(inputChannel-1)+':'+pitch;
    if(workspacePages.page()!=='session'){
      if((!prefs.midiInput||source===prefs.midiInput)&&(!Number(prefs.midiChannel)||inputChannel===Number(prefs.midiChannel)))
        workspacePages.midi(token,type,pitch,velocity);
      return;
    }
    if(type===8||type===9&&!velocity){midiInputStop(token);return;}
    if(prefs.midiInput&&source!==prefs.midiInput||Number(prefs.midiChannel)&&inputChannel!==Number(prefs.midiChannel)) return;
    const track=keyTarget();
    if(!track||['off','qwerty'].includes(track.sourceInput))return;
    if(type===9){midiInputStop(token);midiInputStart(token,pitch,velocity/127,track);return;}
    const control=SW.midiControl(key,pitch,velocity);
    if(!control)return;
    const [lane,value]=control, sourceKey=token.slice(0,token.lastIndexOf(':'));
    const current=hardwareControls.get(sourceKey)||{};
    current[lane]=value;hardwareControls.set(sourceKey,current);
    if(midiTake){
      const now=live?positionAt(live):playhead;
      SW.setExpression(midiTake,lane,Math.max(0,now-midiTake.start),value);
    }
    for(const voice of [...keyboardHeld.values(),...(pedalVoices.get(sourceKey)||[])]){
      if(voice.sourceKey===sourceKey)voice.release?.control?.(lane,value);
    }
    if(lane==='cc64'&&value<64){
      for(const voice of pedalVoices.get(sourceKey)||[])voice.release?.();
      pedalVoices.delete(sourceKey);
      if(!keyboardHeld.size&&!pedalVoices.size&&previewGraph)previewTimer=setTimeout(stopPreview,1200);
    }
  }
  function stopAction(){
    if(pendingRecord){
      pendingRecord=null;stopPlayback();status('Recording cancelled.');return;
    }
    if(recorder||midiTake) stopRecording();
    else stopPlayback();
  }
  const exportNames={wav:'Wave',aiff:'AIFF',caf:'CAF',flac:'FLAC',m4a:'M4A · AAC',alac:'M4A · ALAC',ogg:'Ogg Vorbis',opus:'Opus',mp3:'MP3'};
  const compressedExport=new Set(['m4a','ogg','opus','mp3']);
  function updateExportUI(){
    const mode=$('export-format').value, range=$('export-range').value;
    const surround=$('export-layout').value==='surround';
    if(surround){
      $('export-codecs').value='wav';$('export-processing').value='offline';$('export-output').value='master';
      $('export-loudness').checked=false;
    }
    const format=$('export-codecs').value||'wav';
    const compressed=compressedExport.has(format);
    for(const el of document.querySelectorAll('.audio-export')) el.hidden=mode==='midi';
    const visible=(id,when)=>$(id).hidden=!when;
    visible('marker-from-row',range==='markers');visible('marker-to-row',range==='markers');
    visible('export-dry-row',mode==='stems');
    visible('export-bits-row',mode!=='midi'&&!compressed);
    visible('export-bitrate-row',mode!=='midi'&&compressed);
    visible('export-vbr-row',mode!=='midi'&&['mp3','opus','ogg'].includes(format));
    visible('export-peak-row',mode!=='midi'&&$('export-peak').checked);
    visible('export-loudness-row',mode!=='midi'&&!surround&&Boolean(host.formats?.length));
    const loudness=mode!=='midi'&&$('export-loudness').checked&&Boolean(host.formats?.length);
    visible('export-lufs-row',loudness);visible('export-ceiling-row',loudness);
    visible('stem-sources',mode==='stems');
    $('export-output').disabled=mode==='stems'||surround;
    $('export-codecs').disabled=surround;
    $('export-processing').disabled=surround;
    $('export-bits').querySelector('[value="32"]').disabled=['flac','alac'].includes(format);
    if($('export-bits').selectedOptions[0]?.disabled) $('export-bits').value='24';
    $('export-rate').disabled=format==='opus';
    $('export-peak').disabled=loudness;
    $('export-folder').disabled=typeof window.showDirectoryPicker!=='function';
    const ranges=SW.markerRanges(p,range,[$('export-from').value,$('export-to').value],selectionRange());
    const duration=ranges.reduce((sum,r)=>sum+seconds(r.to-r.from,p.bpm),0);
    $('export-hint').textContent=ranges.length?fmt(duration)+' s across '+ranges.length+' range(s) · '+(host.formats?.length?'Extended encoder available':'Browser Wave/MIDI · launch with FFmpeg for other formats'):'No time range available.';
  }
  function renderStemSources(all){
    const mode=$('stem-mode').value;
    const sources=p.tracks.filter(t=>mode==='channels'||t.clips.length>0).filter(t=>t.type==='bus'||t.clips.length);
    $('stem-checks').innerHTML=sources.map(t=>'<label><input type="checkbox" value="'+t.id+'" '+((all??!t.mute)?'checked':'')+'> '+esc(t.name)+(t.mute?' (muted)':'')+'</label>').join('');
  }
  function openExport(mode,range){
    if(isEditing()) return;
    const dlg=$('export-dialog');
    if(dlg.open) return;
    const updateCodecs=()=>{
      const preferred=$('export-codecs').value||'wav';
      const available=['wav',...(host.formats||[]).filter(code=>code!=='wav')];
      $('export-codecs').innerHTML=available.map(code=>option(code,exportNames[code],preferred)).join('');
      updateExportUI();
    };
    $('export-name').value=p.name;
    $('export-artist').value=p.artist||'';
    $('export-rate').value=prefs.exportRate;$('export-bits').value=prefs.exportDepth;$('export-tail').value=prefs.exportTail;
    if(mode){$('export-format').value=mode;$('export-range').value=range||'song';}
    const markers=[...p.markers].sort((a,b)=>a.at-b.at);
    $('export-from').innerHTML=markers.map((m,i)=>option(m.id,m.name,i===0?m.id:null)).join('');
    $('export-to').innerHTML=markers.map((m,i)=>option(m.id,m.name,i===markers.length-1?m.id:null)).join('');
    $('export-output').innerHTML=[option('master','Master','master'),...p.tracks.filter(t=>t.type==='bus').map(t=>option(t.id,t.name)),...SW.cueSettings(p).map(c=>option(c.id,c.name+' · cue'))].join('');
    renderStemSources();updateCodecs();dlg.returnValue='';dlg.showModal();
    refreshLocal(false).then(()=>{if(dlg.open) updateCodecs();});
  }
  async function encodedAudio(audio,settings,name,bpm,metadata={}){
    const tags={title:name,artist:settings.artist,bpm:settings.tempo?String(bpm):'',...metadata};
    if(settings.format==='wav'&&!settings.loudness){
      return {bytes:SW.wav(audio,settings.bits,{dither:settings.dither,tags,channelMask:settings.layout==='surround'?SW.speakerMask:0}),type:'audio/wav',ext:'wav'};
    }
    const args=new URLSearchParams({
      format:settings.format,bits:settings.bits,rate:settings.rate,bitrate:settings.bitrate,
      vbr:settings.vbr?'1':'0',loudness:settings.loudness?'1':'0',lufs:settings.lufs,
      ceiling:settings.ceiling,dither:settings.dither?'1':'0',...tags
    });
    const answer=await localRequest('/api/encode?'+args,{method:'POST',headers:{'Content-Type':'audio/wav'},body:SW.wav(audio,32)});
    return {bytes:await answer.arrayBuffer(),type:answer.headers.get('Content-Type')||'application/octet-stream',ext:settings.format==='alac'?'m4a':settings.format};
  }
  async function exportSession(folder){
    if(isEditing()) return;
    const mode=$('export-format').value, base=SW.cleanName($('export-name').value||p.name), snapshot=clone(p);
    const ranges=SW.markerRanges(snapshot,$('export-range').value,[$('export-from').value,$('export-to').value],selectionRange());
    if(!ranges.length) throw Error('Choose a range that contains time.');
    const files=[];
    const addFile=(name,bytes,type)=>files.push({name,bytes,type});
    const deliver=async ()=>{
      if(folder){
        for(const file of files){
          const dot=file.name.lastIndexOf('.');
          let candidate=file.name,index=2;
          while(true){
            try{await folder.getFileHandle(candidate);candidate=file.name.slice(0,dot)+' ('+(index++)+')'+file.name.slice(dot);}
            catch(error){if(error.name==='NotFoundError')break;throw error;}
          }
          const handle=await folder.getFileHandle(candidate,{create:true});
          const stream=await handle.createWritable();
          try{await stream.write(file.bytes);await stream.close();}catch(e){await stream.abort().catch(()=>{});throw e;}
        }
      }else if(files.length===1&&mode!=='stems'){
        const file=files[0];download(file.bytes,file.name,file.type);
      }else download(SW.zip(files.map(({name,bytes})=>[name,bytes])),base+(mode==='stems'?' stems':'')+'.zip');
    };
    busy=true;
    try{
      if(mode==='midi'){
        for(const [i,r] of ranges.entries()){
          const section=clone(snapshot);
          for(const t of section.tracks) t.clips=t.clips.filter(c=>!c.muted).map(c=>SW.sliceClip(c,r.from,r.to)).filter(Boolean).map(c=>({...c,start:c.start-r.from}));
          if(!section.tracks.some(t=>t.type==='midi'&&t.clips.some(c=>c.notes.some(n=>!n.muted)||Object.keys(c.expression||{}).some(key=>SW.encodeControl(key,0,0)&&c.expression[key].length)))) continue;
          addFile(base+(ranges.length>1?' '+(i+1)+' '+SW.cleanName(r.name):'')+'.mid',SW.midi(section),'audio/midi');
        }
        if(!files.length) throw Error('No MIDI notes in the chosen range.');
        await deliver();status('Exported '+files.length+' MIDI file(s)');return;
      }
      const settings={
        format:$('export-codecs').value,bits:Number($('export-bits').value),rate:Number($('export-rate').value),
        tail:clamp(Number($('export-tail').value)||0,0,30),bitrate:Number($('export-bitrate').value),vbr:$('export-vbr').checked,
        layout:$('export-layout').value,loudness:$('export-loudness').checked&&Boolean(host.formats?.length),
        lufs:clamp(Number($('export-lufs').value),-36,-5),ceiling:clamp(Number($('export-ceiling').value),-9,0),
        dither:$('export-dither').checked,artist:$('export-artist').value,tempo:$('export-tempo').checked,
        dry:$('export-dry').checked&&mode==='stems',processing:$('export-processing').value,output:$('export-output').value||'master',
        bypass:$('export-bypass').checked,peak:$('export-peak').checked,peakDb:clamp(Number($('export-peak-db').value),-24,0)
      };
      if(settings.layout==='surround'&&(settings.format!=='wav'||settings.processing==='realtime'))throw Error('7.1.4 requires offline Wave export.');
      if(settings.layout==='surround'&&mode==='stems')throw Error('Use Mixdown for 7.1.4 PCM. Channel stems remain mono or stereo.');
      if(settings.layout==='surround'&&$('export-reimport').checked)throw Error('Use stereo or binaural for re-importing a mix into this session.');
      if(settings.format==='opus') settings.rate=48000;
      if(settings.format==='mp3'&&settings.rate>48000) throw Error('For MP3, select 44.1 or 48 kHz.');
      if(settings.format==='m4a'&&settings.rate>96000) throw Error('For AAC, select up to 96 kHz.');
      const selected=new Set([...$('stem-checks').querySelectorAll('input:checked')].map(el=>el.value));
      const sources=mode==='stems'?snapshot.tracks.filter(t=>selected.has(t.id)):[null];
      if(!sources.length) throw Error('Select at least one stem source.');
      const duration=ranges.reduce((sum,r)=>sum+seconds(r.to-r.from,snapshot.bpm)+settings.tail,0);
      if(duration*settings.rate*(settings.layout==='surround'?48:8)*sources.length>380e6) throw Error('Choose a shorter range, fewer tracks, or a lower sample rate.');
      const addTracks=$('export-reimport').checked, created=[];
      if(settings.bypass||settings.dry) for(const e of snapshot.master.fx)e.bypass=true;
      if(mode==='stems') snapshot.dimSolo=false;
      let index=0;
      for(const [i,r] of ranges.entries()){
        for(const [j,source] of sources.entries()){
          const session=clone(snapshot);
          let output=settings.output,only;
          if(source){
            const target=session.tracks.find(t=>t.id===source.id);
            for(const t of session.tracks){t.solo=t.id===target.id;t.soloSafe=false;}
            const channelExport=$('stem-mode').value==='channels';
            if(channelExport) output=target.id;
            else only=target.id;
            if(settings.dry){
              output=target.id;
              for(const e of target.fx)e.bypass=true;target.lanes={};target.trim=0;target.volume=0;target.pan=0;target.polarity=false;
              if(target.type!=='bus') only=target.id;
              if(target.type==='bus')for(const t of session.tracks)for(const e of t.fx)e.bypass=true;
            }
          }
          status('Rendering '+(++index)+' / '+(ranges.length*sources.length));
          const render=settings.processing==='realtime'?SW.renderRealtime:SW.renderAudio;
          const layout=settings.layout==='surround'?'surround':settings.layout==='binaural'?'binaural':'stereo';
          const rendered=await render(session,media,{from:r.from,to:r.to,tail:settings.tail,rate:settings.rate,only,output,layout});
          if(settings.peak&&!settings.loudness) SW.applyPeak(rendered,settings.peakDb);
          const name=base+(ranges.length>1?' '+(i+1)+' '+SW.cleanName(r.name):'')+(source?' '+String(j+1).padStart(2,'0')+' '+SW.cleanName(source.name):'');
          for(const [suffix,audio] of SW.speakerChannels(rendered,settings.layout)){
            const encoded=await encodedAudio(audio,settings,name+suffix,snapshot.bpm);
            const file=SW.cleanName(name+suffix)+'.'+encoded.ext;
            addFile(file,encoded.bytes,encoded.type);
            if(addTracks){
              try{created.push({start:r.from,entry:await decodeAsset(encoded.bytes,file)});}
              catch{created.push({start:r.from,entry:await decodeAsset(SW.wav(audio,32),SW.cleanName(name+suffix)+'.wav')});}
            }
          }
        }
      }
      await deliver();
      if(created.length) edit(()=>{
        for(const {entry,start} of created){registerAsset(entry);placeAsset(addTrack('audio'),entry.id,start);}
      },undefined);
      status('Exported '+files.length+' audio file(s)');
    }finally{busy=false;}
  }
  function saveProject(copyName){
    if(recorder||pendingRecord||midiTake||busy) return;
    const data=SW.encodeProject(p,media);
    const copy=typeof copyName==='string';
    download(data,SW.cleanName(copy?copyName:p.name)+'.sonoravell','application/json');
    if(!copy){isDirty=false;workspacePages.sessionChanged();workspacePages.writeSession();}
    status(copy?'Saved portable copy':'Saved portable project');
  }
  function addChannelSend(t,id,cue){
    if(!id||t.type==='master')return;
    const existing=cue?SW.cueSends(t):SW.sendList(t);
    const valid=cue?SW.cueSettings(p).some(row=>row.id===id):id!=='master'&&validRoute(p,t.id,id,'send');
    if(!valid||existing.some(send=>send.to===id&&send.pre===cue)||cue&&existing.length>=16)return;
    edit(()=>{
      if(cue){(t.cueSends??=[]).push({to:id,level:-12,pan:0,pre:true,followPan:false,mute:false});}
      else {(t.sends??=[]).push({to:id,level:-18,pre:false,mute:false});}
    },cue?'Added cue send':'Added bus send');
  }
  function changeValue(el){
    if(macroInput(el))return;
    if(busy||pendingRecord||recorder||midiTake) {render();return;}
    const key=el.dataset.change,t=channelById(el.closest('[data-track]')?.dataset.track)||currentTrack(),c=activeClip();
    if(key.startsWith('note-prop-')){setNoteProperty(key.slice(10),el.value);return;}
    if(key.startsWith('piano-')){
      if(key==='piano-root')pianoRoot=clamp(Number(el.value)||0,0,11);
      if(key==='piano-scale'&&Object.hasOwn(SW.pianoScales,el.value))pianoScale=el.value;
      if(key==='piano-grid')pianoGrid=el.value;
      editorFocus={kind:'notes'};renderDock(false);find('[data-change="'+key+'"]')?.focus({preventScroll:true});return;
    }
    if(key==='editor-part'){
      const part=t.clips.find(row=>row.id===el.value);
      if(part){
        clipId=null;picked.clear();editorPart=el.value;noteId=null;notePicked.clear();rollChanged=true;
        editorFocus=part.type==='midi'?(editPage==='notes'||expressionKey==='velocity'?{kind:'notes'}:
          {kind:'expression',clip:part.id,lane:expressionKey}):{kind:'events'};
        renderSelections();renderInspector();renderDock(false);
        find('[data-change="editor-part"]')?.focus({preventScroll:true});
      }
      return;
    }
    const str=el.value,n=Number(str);
    if(el.type==='number'&&(!str.trim()||!Number.isFinite(n))){render();return;}
    if(key.startsWith('wave-')){
      const part=editorClip(), param=key.slice(5);
      if(part?.type!=='audio'||part.locked)return;
      if(param==='gain'&&Number.isFinite(n))edit(()=>{part.gain=clamp(n,-60,24);},valueStatus(part.name,'Event gain',clamp(n,-60,24),'dB'));
      if(['fadeIn','fadeOut'].includes(param)&&Number.isFinite(n))setWaveFade(part,param,n*p.bpm/60000);
      if(['fadeInShape','fadeOutShape'].includes(param)&&Object.hasOwn(SW.fadeShapes,str))
        edit(()=>{part[param]=str;},valueStatus(part.name,param==='fadeInShape'?'Fade in curve':'Fade out curve',SW.fadeShapes[str]));
      return;
    }
    if(key==='expression-lane'){
      expressionKey=str;editorFocus=str==='velocity'?{kind:'notes'}:{kind:'expression',clip:editorClip()?.id,lane:str};
      renderDock();find('[data-change="expression-lane"]')?.focus({preventScroll:true});return;
    }
    if(key==='expression-value'){
      const part=editorClip(),point=part?.expression?.[expressionKey]?.[Number(el.dataset.expressionIndex)];
      if(point&&!part.locked)edit(()=>SW.setExpression(part,expressionKey,point.at,n),'Edited MIDI automation value');
      return;
    }
    if(key==='mixer-scene'){sceneId=str;return;}
    if(key==='mixer-filter'){
      mixerFilter=str;
      const view=$('dock').querySelector('.mixer-viewport');
      if(view)view.scrollLeft=0;
      mixerScroll=0;renderDock();return;
    }
    if(key==='mixer-action'){if(str)doAction({dataset:{action:str},closest:()=>null});el.value='';return;}
    if(key==='monitor-cue'){edit(()=>{p.monitorCue=str==='__off'?'':str;p.monitorDisconnected=str==='__off';});return;}
    if(key==='channel-preset'){if(str)applyBrowserItem('presets',str,t);return;}
    if(key==='console-preset'){
      el.value='';
      if(str==='save')saveConsolePreset(t);else loadConsolePreset(t,str);
      return;
    }
    if(key==='console-send-add'){
      const split=str.indexOf(':'), kind=str.slice(0,split), id=str.slice(split+1);
      el.value='';
      if(kind==='cue')addChannelSend(t,id,true);
      if(kind==='bus')addChannelSend(t,id,false);
      return;
    }
    if(key==='aux-target'||key==='cue-target'){
      const isCue=key==='cue-target', route=isCue?t.cueSends?.[Number(el.closest('[data-cue-route]')?.dataset.cueRoute)]:
        t.sends?.[Number(el.closest('[data-send]')?.dataset.send)];
      if(!route||route.to===str)return;
      const routes=isCue?SW.cueSends(t):SW.sendList(t);
      const target=isCue?SW.cueSettings(p).some(s=>s.id===str):str!=='master'&&validRoute(p,t.id,str,'send');
      if(target&&!routes.some(s=>s.to===str&&s.pre===route.pre))edit(()=>{route.to=str;},'Changed send destination');
      else el.value=route.to;
      return;
    }
    if(key==='track-folder'){edit(()=>SW.setFolder(p,t,str),'Moved track');return;}
    if(key==='monitor-spatial'){edit(()=>p.spatialMonitor=str);return;}
    if(key==='cue-name'||key==='cue-volume'){
      const cue=SW.cueSettings(p).find(cue=>cue.id===graphLabel);
      if(cue)edit(()=>{if(key==='cue-name')cue.name=str.trim()||'Cue';else cue.volume=clamp(n,-60,6);});
      return;
    }
    if(key==='cue-add-send'||key==='add-send'){addChannelSend(t,str,key==='cue-add-send');return;}
    if(key==='cue-level'||key==='cue-pan'){
      const route=t.cueSends?.[Number(el.closest('[data-cue-route]')?.dataset.cueRoute)];
      if(route)edit(()=>{if(key==='cue-level')route.level=clamp(n,-60,6);else route.pan=clamp(n,-1,1);});
      return;
    }
    if(key==='grid-mode'){gridMode=str;renderDock();return;}
    if(key==='quantize-strength'){quantizeStrength=clamp(n,1,100);return;}
    if(key==='range-from'||key==='range-to'){
      if(!editRange) editRange={from:playhead,to:playhead+p.meter,t:currentTrack().id};
      if(key==='range-from') editRange.from=clamp(n-1,0,editRange.to-.001);
      else editRange.to=clamp(n-1,editRange.from+.001,99999);
      showRange();renderDock();return;
    }
    if(key.startsWith('clip-')||key==='fade-in'||key==='fade-out'){
      if(c?.locked){status('Unlock the event before editing it.',true);renderInspector();return;}
    }
    if(key==='auto-lane'){autoKey=str;renderDock();return;}
    if(key==='add-fx'&&!Object.hasOwn(fx,str)) return;
    if(key==='automation-mode'&&automationTake) finishWrite();
    const prev=before();
    switch(key){
      case 'source-input':t.sourceInput=str;break;
      case 'track-name':if(!str.trim()||str.trim()===t.name){el.value=t.name;return;}t.name=str.trim().slice(0,120);break;
      case 'track-color':if(!/^#[0-9a-f]{6}$/i.test(str)||str===t.color)return;t.color=str;break;
      case 'instrument':if(str)SW.placeInstrument(t,str);break;
      case 'trim':t.trim=clamp(n,-24,24);break;
      case 'aux-level': {
        const route=t.sends?.[Number(el.closest('[data-send]').dataset.send)];
        if(route) route.level=clamp(n,-60,6);
        break;
      }
      case 'transpose':t.transpose=clamp(Math.round(n),-36,36);break;
      case 'out':if(t.id==='master'||str===t.out||!validRoute(p,t.id,str,'out')){el.value=t.out;return;}t.out=str;break;
      case 'send':if(str!=='master'&&validRoute(p,t.id,str,'send'))t.send=str;break;
      case 'send-level':t.sendLevel=clamp(n,-60,6);break;
      case 'automation-mode':t.automation=str;break;
      case 'add-fx':SW.addEffect(t,effect(str));break;
      case 'clip-name':if(c)c.name=str.trim()||'Clip';break;
      case 'clip-start':if(c)c.start=clamp(n-1,0,99999);break;
      case 'clip-length':if(c)setLength(c,clamp(n,.001,100000));break;
      case 'clip-offset':if(c)c.offset=clamp(n,0,Math.max(0,clipLimit(c)-c.length));break;
      case 'clip-gain':if(c)c.gain=clamp(n,-60,24);break;
      case 'fade-in':if(c)c.fadeIn=clamp(n,0,c.length-c.fadeOut);break;
      case 'fade-out':if(c)c.fadeOut=clamp(n,0,c.length-c.fadeIn);break;
      case 'velocity': {
        const target=c?.notes.find(row=>row.id===noteId);
        if(target) target.velocity=clamp(Math.round(n),1,127)/127;
        break;
      }
      default:return;
    }
    const selectLabel=el.selectedOptions?.[0]?.textContent||str;
    const changed={
      'source-input':['MIDI input',selectLabel],'track-name':['Renamed to',t.name],'track-color':['Color',t.color],
      instrument:['Instrument',t.instrument],trim:['Input gain',t.trim,'dB'],transpose:['Transpose',t.transpose,'semitones'],
      out:['Output',channelById(t.out)?.name||'Disconnected'],send:['Send to',channelById(t.send)?.name||'Disconnected'],
      'send-level':['Send level',t.sendLevel,'dB'],'automation-mode':['Automation',t.automation],'add-fx':['Inserted',str],
      'clip-name':['Renamed event to',c?.name],'clip-start':['Event start',c?SW.locatorText(c.start,p.meter):''],
      'clip-length':['Event length',c?.length,'beats'],'clip-offset':['Event offset',c?.offset,'beats'],
      'clip-gain':['Event gain',c?.gain,'dB'],'fade-in':['Fade in',c?seconds(c.fadeIn,p.bpm)*1000:0,'ms'],
      'fade-out':['Fade out',c?seconds(c.fadeOut,p.bpm)*1000:0,'ms'],'velocity':['Velocity',c?.notes.find(row=>row.id===noteId)?.velocity]
    }[key];
    commit(prev,changed?valueStatus(t.name,...changed):valueStatus(t.name,'Send level',n,'dB'));
  }
  function removeTracks(t,includeInstrument=false){
    if(t.id==='master'||t.instrumentOnly&&!includeInstrument)return;
    const ids=new Set(pickedTracks.has(t.id)?pickedTracks:[t.id]);
    const removed=p.tracks.filter(row=>ids.has(row.id)&&(includeInstrument||!row.instrumentOnly));
    const retained=includeInstrument?[]:removed.filter(row=>row.type==='midi'&&!row.instrumentDisabled);
    const description=(removed.length===1?t.name:removed.length+' selected tracks')+
      (retained.length?'? '+retained.length+' instrument(s) will stay in the Mixer.':' and all associated events?');
    if(!removed.length||!confirm('Remove '+description))return;
    const order=SW.timelineTrack(t)?SW.timelineTracks(p):p.tracks;
    const index=order.indexOf(t);
    const next=order.slice(index+1).find(row=>!ids.has(row.id))||order.slice(0,index).reverse().find(row=>!ids.has(row.id));
    edit(()=>{
      for(const row of removed){
        armed.delete(row.id);
        if(!retained.includes(row)){SW.removeChannel(p,row.id);continue;}
        const output=row.out;
        SW.setFolder(p,row,'');row.out=output;
        row.clips=[];row.instrumentOnly=true;
      }
      selectTrack(next?.id||SW.timelineTracks(p)[0]?.id||'master',false);
      clipId=null;editorPart=null;noteId=null;picked.clear();notePicked.clear();
      editRange=null;rollChanged=true;
    },(removed.length===1?'Removed '+t.name:'Removed '+removed.length+' tracks')+
      (retained.length?' · Kept '+retained.length+' instrument(s) loaded':''));
    find('.track-head[data-track="'+trackId+'"]')?.focus({preventScroll:true});
  }
  function doAction(el,event){
    const action=el.dataset.action;
    if(!action) return;
    if(globalTrackAction(el))return;
    if(!isEditing()&&pianoAction(el))return;
    if(macroAction(el)||editorToolAction(el))return;
    if(action==='record-monitor'){
      const t=channelById(el.closest('[data-track]')?.dataset.track)||currentTrack();
      toggleMonitor(t);return;
    }
    if(isEditing()) return;
    if(action==='tool'){setTool(el.dataset.key);return;}
    if(expressionAction(el)||folderAction(el)||studioAction(el)||panelAction(el)) return;
    const selected=currentTrack(), found=foundClip(), asset=el.closest('[data-asset]')?.dataset.asset;
    const owner=el.closest('[data-track]')?.dataset.track,t=[...p.tracks,p.master].find(row=>row.id===owner)||selected;
    const e=t.fx.find(row=>row.id===el.closest('[data-fx]')?.dataset.fx);
    const c=found?.c;
    switch(action){
      case 'mute':edit(()=>{t.mute=!t.mute;},t.name+(t.mute?' · Unmuted':' · Muted'));return;
      case 'solo':edit(()=>{
        const active=!t.solo;
        if(event?.altKey) for(const row of p.tracks) row.solo=false;
        t.solo=active;
      },t.name+(t.solo?' · Solo off':' · Solo on'));return;
      case 'arm':
        if(!SW.timelineTrack(t))return;
        if(event?.altKey){armed.clear();armed.add(t.id);selectTrack(t.id,false);}
        else if(armed.has(t.id)) armed.delete(t.id);
        else {armed.add(t.id);selectTrack(t.id,false);}
        render();status(armed.has(t.id)?'Armed '+t.name:'Disarmed '+t.name);return;
      case 'show-inserts':selectTrack(t.id);$('inspector').querySelector('[data-change=add-fx]')?.scrollIntoView({block:'nearest'});return;
      case 'up-track':case 'down-track':edit(()=>moveTrack(t,action==='up-track'?-1:1));return;
      case 'duplicate-track':edit(()=>duplicateTrack(t),'Duplicated track');return;
      case 'remove-track':removeTracks(t);return;
      case 'remove-track-complete':removeTracks(t,true);return;
      case 'track-edit':setTab('edit');return;
      case 'track-rename':{
        const name=prompt('Track name',t.name)?.trim().slice(0,120);
        if(name&&name!==t.name)edit(()=>{t.name=name;},'Renamed track');
        return;
      }
      case 'inputs':chooseInput(t).catch(error=>report(recordError(error)));return;
      case 'load-sample':sampleTarget=t.id;$('sample-file').click();return;
      case 'split':eventBatch('split');return;
      case 'duplicate-clip':eventBatch('duplicate');return;
      case 'delete-clip':removeSelected();return;
      case 'reverse':eventBatch('reverse');return;
      case 'normalize':eventBatch('normalize');return;
      case 'edit-notes':setTab('piano');return;
      case 'fx-bypass':if(e)edit(()=>{e.bypass=!e.bypass;},t.name+' · '+e.type+(e.bypass?' enabled':' bypassed'));return;
      case 'fx-up':case 'fx-down':if(e)edit(()=>{
        const i=t.fx.indexOf(e),j=i+(action==='fx-up'?-1:1);
        if(j>=0&&j<t.fx.length){
          const other=t.fx[j];SW.renumberFX(t,new Map([[e.id,other.id],[other.id,e.id]]));
          [t.fx[i],t.fx[j]]=[other,e];
        }
      });return;
      case 'fx-remove':if(e)edit(()=>{
        SW.removeEffect(t,e.id);
      },t.name+' · Removed '+e.type);return;
      case 'show-lane':autoKey=el.dataset.key;setTab('automation');return;
      case 'audition-note':audition(t,Number(el.dataset.pitch)).catch(report);return;
      case 'quantize':editNotes('quantize');return;
      case 'note-up':editNotes('up-semi');return;
      case 'note-down':editNotes('down-semi');return;
      case 'del-note':if(noteId||notePicked.size)editNotes('delete');return;
      case 'add-auto-point': {
        const value=SW.automationValue(t.lanes[autoKey],playhead,laneValue(t,autoKey));
        edit(()=>addPoint(t,autoKey,sn(playhead),value),'Added automation point');return;
      }
      case 'clear-lane':edit(()=>{delete t.lanes[autoKey];},'Cleared automation lane');return;
      case 'preview-asset':assetPreview(asset).catch(report);return;
      case 'place-asset':edit(()=>placeAsset(audioTrack(t),asset,sn(playhead)),'Placed audio');return;
      case 'remove-asset':
        if(p.tracks.some(row=>row.sample===asset||row.clips.some(c=>c.asset===asset))||SW.ideaUsesAsset(p,asset)){
          status('Remove events or sampler assignments that use this source first.',true);return;
        }
        edit(()=>{delete p.assets[asset];},'Removed audio source');return;
    }
  }
  let paramEdit;
  function changeParam(el,done){
    const t=[...p.tracks,p.master].find(row=>row.id===el.dataset.owner),key=el.dataset.param;
    if(!t) return;
    if(busy){if(done) render();return;}
    const spec=laneSpecs(t)[key];
    if(!spec||!String(el.value).trim()||!Number.isFinite(Number(el.value))){if(done)render();return;}
    const val=clamp(Number(el.value),spec[1],spec[2]), id=writeKey(t,key);
    if((!paramEdit||paramEdit.el!==el)&&laneValue(t,key)===val)return;
    if(!paramEdit||paramEdit.el!==el) paramEdit={el,previous:before()};
    const writing=Boolean(live&&['Touch','Latch','Write'].includes(t.automation));
    const row=automationTake?.get(id);
    if(writing){
      const at=positionAt(live);
      if(row) extendWrite(at,id);
      beginWrite(t,key,val,at);
      automationTake.get(id).last=at;
      setLaneValue(t,key,val);
    }else setLaneValue(t,key,val);
    if(live||monitorGraph||previewGraph?.tracks)SW.overrideParam(live?.graph||monitorGraph||previewGraph,t.id,key,val);
    if(['volume','pan','trim'].includes(key)){
      for(const peer of all('[data-owner="'+t.id+'"][data-param="'+key+'"]')){
        if(peer!==el)peer.value=fmt(val,4);
        if(peer.closest?.('.track-volume'))peer.title=t.name+' · '+fmt(val,1)+' dB';
      }
      for(const knob of all('.rotary[data-gear-kind="mix"][data-owner="'+t.id+'"][data-gear-key="'+key+'"]'))displayKnob(knob,val);
    }else if(key.startsWith('fx:')&&el.nextElementSibling?.tagName==='OUTPUT') el.nextElementSibling.value=fmt(val,4)+' '+spec[4];
    if(done){
      const previous=paramEdit.previous;
      const focusedVolume=el.type==='range'&&key==='volume'&&el.ownerDocument?.activeElement===el;
      const region=el.closest?.('.track-volume')?'.track-volume':'.console-fader';
      paramEdit=null;
      if(writing){
        if(t.automation==='Touch'){
          automationTake.get(id).active=false;
          currentOverride.delete(id);
          if(![...automationTake.values()].some(row=>row.active)) finishWrite();
          if(live) rebuildPlayback();
        }
        status(valueStatus(t.name,spec[0],val,spec[4])+' · '+t.automation);
      }else commit(previous,valueStatus(t.name,spec[0],val,spec[4]),true);
      if(focusedVolume)find(region+' [data-owner="'+t.id+'"][data-param="volume"]')?.focus({preventScroll:true});
    }
  }
  function pianoPointer(roll,event){
    const rect=roll.getBoundingClientRect(), scale=Number(roll.dataset.scale);
    return {x:clamp(event.clientX-rect.left,0,rect.width),y:clamp(event.clientY-rect.top,0,rect.height),
      at:(event.clientX-rect.left)/scale,pitch:clamp(rollTop-Math.floor((event.clientY-rect.top)/16),Number(roll.dataset.low),rollTop)};
  }
  function paintPianoSelection(){
    for(const el of all('.pnote,[data-velocity-note]'))el.classList.toggle('selected',notePicked.has(el.dataset.note||el.dataset.velocityNote));
    const properties=find('.piano-properties'), c=editorClip();
    if(properties&&c)properties.outerHTML=renderSelectedNoteProps(c);
  }
  function startPianoGesture(event,common){
    const target=event.target, roll=target.closest('[data-roll]'), vel=target.closest('[data-velocity-note]');
    if(!roll&&!vel)return false;
    const c=editorClip();
    if(c?.type!=='midi')return true;
    editorFocus={kind:'notes'};
    const node=target.closest('.pnote'), n=c.notes.find(row=>row.id===(vel?.dataset.velocityNote||node?.dataset.note));
    const add=Boolean(event.ctrlKey||event.metaKey||event.shiftKey);
    if(n&&add&&!event.altKey){
      const ids=new Set(exactNotes(c).map(item=>item.id));
      if(ids.has(n.id))ids.delete(n.id);else ids.add(n.id);
      chooseNotes([...ids]);paintPianoSelection();(node||vel).focus({preventScroll:true});event.preventDefault();return true;
    }
    if(n&&!notePicked.has(n.id))chooseNotes([n.id],n.id);
    if(n)noteId=n.id;
    const group=exactNotes(c);
    if(!c.locked&&n&&!vel&&['split','erase','mute'].includes(noteTools)){
      if(noteTools==='erase')removeNotes(c,group,'Erased');
      if(noteTools==='mute')editNotes('mute');
      if(noteTools==='split'){
        const pointer=pianoPointer(roll,event);
        const result=SW.processPianoNotes(c,group.map(row=>row.id),'split',{at:noteTime(pointer.at,event.shiftKey)});
        if(result.changed)edit(()=>{c.notes=result.notes;chooseNotes(result.selection);},'Split notes');
        focusNoteEditor();
      }
      event.preventDefault();return true;
    }
    if(n&&!vel&&noteTools==='listen'){audition(currentTrack(),n.pitch,n.velocity).catch(report);paintPianoSelection();return true;}
    if(c.locked&&!n)return true;
    if(c.locked&&n){paintPianoSelection();(node||vel).focus({preventScroll:true});return true;}
    if(vel&&n){
      gesture={...common,kind:'note-velocity',c,n,group,grid:vel.closest('.velocity-grid')};
      vel.focus({preventScroll:true});vel.setPointerCapture?.(event.pointerId);
    }else if(n){
      gesture={...common,kind:'piano-note',c,n,roll,group,edge:target.dataset.edge,copy:event.altKey&&!target.dataset.edge,el:node};
      node.focus({preventScroll:true});node.setPointerCapture?.(event.pointerId);
    }else if(noteTools==='arrow'||noteTools==='draw'){
      const point=pianoPointer(roll,event);
      if(point.at>c.length+.001)return true;
      const base=add?group.map(row=>row.id):[];
      gesture={...common,kind:noteTools==='arrow'?'piano-select':'piano-draw',c,roll,point,base,
        at:noteTime(point.at,event.shiftKey),pitch:notePitch(point.pitch)};
      roll.focus({preventScroll:true});roll.setPointerCapture?.(event.pointerId);
    }else return true;
    paintPianoSelection();
    event.preventDefault();
    return true;
  }
  function updateVelocityGesture(g,event){
    const rect=g.grid.getBoundingClientRect(), velocity=clamp((rect.bottom-event.clientY)/Math.max(1,rect.height),1/127,1);
    const delta=velocity-g.n.velocity;
    g.updates=g.group.map(n=>({...n,velocity:Math.round(clamp(n.velocity+delta,1/127,1)*127)/127}));
    for(const n of g.updates){
      const el=g.grid.querySelector('[data-velocity-note="'+n.id+'"]');
      if(el)el.style.height=Math.max(4,n.velocity*100)+'%';
    }
  }
  function drawNoteShape(g,event){
    const end=pianoPointer(g.roll,event), grid=notesGrid()||.25;
    const length=Math.min(grid,g.c.length), from=clamp(g.at,0,Math.max(0,g.c.length-length));
    const to=g.moved?clamp(noteTime(end.at,event.shiftKey),0,g.c.length):from+length;
    const start=Math.min(from,to);
    return {start,length:Math.min(g.c.length-start,Math.max(Math.min(.001,g.c.length-start),Math.abs(to-from)||length)),pitch:g.pitch};
  }
  function movePianoGesture(g,event){
    if(g.kind==='note-velocity'){updateVelocityGesture(g,event);return true;}
    if(g.kind==='piano-note'){
      const scale=Number(g.roll.dataset.scale), dt=(event.clientX-g.x)/scale, n=g.n;
      const source=g.edge==='right'?n.start+n.length:n.start;
      const delta=noteTime(source+dt,event.shiftKey)-source;
      const pitch=notePitch(n.pitch-(event.clientY-g.y)/16);
      g.updates=g.edge?SW.trimNotes(g.group,g.c.length,delta,g.edge):SW.moveNotes(g.group,g.c.length,delta,pitch-n.pitch);
      for(const item of g.updates){
        const el=g.roll.querySelector('[data-note="'+item.id+'"]');
        if(!el)continue;
        el.style.left=item.start*scale+'px';el.style.top=(rollTop-item.pitch)*16+1+'px';el.style.width=item.length*scale+'px';
      }
      return true;
    }
    if(g.kind==='piano-select'||g.kind==='piano-draw'){
      const point=pianoPointer(g.roll,event), scale=Number(g.roll.dataset.scale);
      let box;
      if(g.kind==='piano-select'){
        const x=Math.min(g.point.x,point.x), y=Math.min(g.point.y,point.y);
        box={x,y,w:Math.abs(g.point.x-point.x),h:Math.abs(g.point.y-point.y)};
        const ids=g.c.notes.filter(n=>n.start*scale<=x+box.w&&(n.start+n.length)*scale>=x&&
          (rollTop-n.pitch)*16<=y+box.h&&(rollTop-n.pitch+1)*16>=y).map(n=>n.id);
        chooseNotes([...new Set([...g.base,...ids])]);paintPianoSelection();
      }else{
        const n=drawNoteShape(g,event);
        box={x:n.start*scale,y:(rollTop-n.pitch)*16,w:n.length*scale,h:16};
      }
      if(!g.ghost){
        g.ghost=g.roll.ownerDocument.createElement('span');g.ghost.className='piano-gesture '+(g.kind==='piano-draw'?'draw':'');
        g.roll.append(g.ghost);
      }
      Object.assign(g.ghost.style,{left:box.x+'px',top:box.y+'px',width:box.w+'px',height:box.h+'px'});
      return true;
    }
    return false;
  }
  function finishPianoGesture(g,event){
    if(!['note-velocity','piano-note','piano-select','piano-draw'].includes(g.kind))return false;
    g.ghost?.remove();
    if(event.type==='pointercancel'){renderDock(false);focusNoteEditor();return true;}
    if(g.kind==='piano-select'){
      if(!g.moved){
        chooseNotes(g.base);paintPianoSelection();
        seek(g.c.start+clamp(g.at,0,g.c.length));
      }
      return true;
    }
    if(g.kind==='piano-draw'){
      const shape=drawNoteShape(g,event);
      if(shape.length>.000001)addPianoNote(g.c,shape);
      return true;
    }
    if(g.kind==='note-velocity'&&!g.updates)updateVelocityGesture(g,event);
    const results=g.updates;
    if(results&&results.some((n,i)=>['start','length','pitch','velocity'].some(key=>n[key]!==g.group[i][key]))){
      const copied=g.copy?results.map(n=>({...n,id:uid()})):null;
      edit(()=>{
        if(copied){g.c.notes.push(...copied);chooseNotes(copied.map(n=>n.id));}
        else results.forEach((n,i)=>Object.assign(g.group[i],n));
      },g.kind==='note-velocity'?'Velocity '+Math.round(results.find(n=>n.id===g.n.id).velocity*127):
        copied?'Copied notes':g.edge?'Resized notes':'Moved notes');
      focusNoteEditor();
    }else{
      renderDock(false);focusNoteEditor();
      if(g.kind!=='note-velocity')audition(currentTrack(),g.n.pitch,g.n.velocity).catch(report);
    }
    return true;
  }
  function addPianoNote(c,shape){
    const added=note(shape.pitch,shape.start,shape.length);
    edit(()=>{c.notes.push(added);chooseNotes([added.id]);},'Added '+noteName(added.pitch));
    focusNoteEditor();audition(currentTrack(),added.pitch).catch(report);
  }
  function velocityLaneKey(event){
    const id=event.target.closest?.('[data-velocity-note]')?.dataset.velocityNote;
    if(!id||!['ArrowUp','ArrowDown'].includes(event.key)||event.ctrlKey||event.altKey||event.metaKey||isEditing())return false;
    const c=editorClip(), n=c?.notes.find(n=>n.id===id);
    if(!n||c.locked)return false;
    event.preventDefault();
    if(!notePicked.has(id))chooseNotes([id]);else noteId=id;
    setNoteProperty('velocity',Math.round(n.velocity*127)+(event.key==='ArrowUp'?1:-1)*(event.shiftKey?8:1));
    find('[data-velocity-note="'+id+'"]')?.focus({preventScroll:true});return true;
  }
  function startGesture(event){
    if(event.button!==0||isEditing()) return;
    const target=event.target, eventEl=target.closest('[data-clip]');
    const lane=target.closest('[data-lane]'), envelope=target.closest('[data-envelope]');
    const focus=readEditorFocus(target);if(focus)setEditorFocus(focus);
    const t=p.tracks.find(row=>row.id===lane?.dataset.lane);
    const additive=event.ctrlKey||event.metaKey;
    syncToolModifier(event);
    const tool=editTool==='range'&&event.altKey?'arrow':editTool==='arrow'&&additive&&!event.altKey?'range':editTool;
    const common={x:event.clientX,y:event.clientY,pointer:event.pointerId};
    if(startTimelineGesture(event,common)||startPianoGesture(event,common))return;
    const grip=target.closest('[data-fade-handle]');
    if(grip){
      const c=eventEl?foundClip(eventEl.dataset.clip)?.c:editorClip(), key=grip.dataset.fadeHandle;
      if(!c||c.locked)return;
      grip.focus({preventScroll:true});
      gesture={...common,kind:'fade',c,key,grip,surface:eventEl||grip.closest('.wave-surface'),length:c[key]};
      grip.setPointerCapture?.(event.pointerId);
    }else if(t&&tool==='range'){
      const at=pointerBeat(lane,event);
      if(editTool==='range')selectTrack(t.id,false);
      editRange={from:at,to:at,t:t.id};
      const temporary=editTool==='arrow';
      showRange();gesture={...common,kind:'range',lane,t,at,temporary,
        toggleEvent:temporary&&eventEl?foundClip(eventEl.dataset.clip):null};
    }else if(t&&tool==='listen'){
      const token={...common,kind:'listen'};
      gesture=token;run(listenAt)(t,pointerBeat(lane,event),token);
    }else if(t&&tool==='draw'&&t.type==='midi'&&!eventEl){
      gesture={...common,kind:'draw',lane,t,at:pointerBeat(lane,event)};
    }else if(eventEl){
      const {t,c}=foundClip(eventEl.dataset.clip);
      if((additive||event.shiftKey)&&!event.altKey&&tool==='arrow'){
        const rows=selectedClips();
        selectMany(picked.has(c.id)?rows.filter(row=>row.c!==c):[...rows,{t,c}]);
        event.preventDefault();return;
      }
      if(!picked.has(c.id)) selectClip(t,c,false);
      else {clipId=c.id;trackId=t.id;}
      renderSelections();renderInspector();
      if(c.locked){if(tab==='edit')renderDock();return;}
      if(['split','erase','mute'].includes(tool)){
        if(tool==='split'){
          const at=pointerBeat(lane,event);
          edit(()=>{const right=splitClip(c,at);if(right){t.clips.push(right);selectClip(t,right,false);}},'Split event at pointer');
        }
        if(tool==='erase'){selectClip(t,c,false);removeSelected();}
        if(tool==='mute')eventBatch('mute-event');
        event.preventDefault();return;
      }
      const edge=target.dataset.edge;
      const slip=c.type==='audio'&&(event.ctrlKey||event.metaKey)&&event.altKey&&!edge;
      gesture={...common,kind:'clip',el:eventEl,t,c,edge,start:c.start,length:c.length,offset:c.offset,
               slip,stretch:tool==='bend'&&edge==='right',copy:event.altKey&&!edge&&!slip,group:!edge&&!slip?selectedClips().filter(row=>!row.c.locked):[]};
    }else if(envelope){
      const point=target.closest('[data-point]'), t=currentTrack(), param=autoKey, index=point?Number(point.dataset.point):null;
      point?.focus({preventScroll:true});
      gesture={...common,kind:'point',el:point,envelope,t,param,index};
    }
    if(gesture){
      event.preventDefault();
      if(!['listen','fade','range'].includes(gesture.kind)) gesture.snapshot=before();
    }
  }
  async function listenAt(t,at,token){
    await ensureAudio();
    if(gesture!==token) return;
    if(live) stopPlayback();
    stopPreview();
    const session={...p,dimSolo:false,tracks:p.tracks.map(row=>({...row,solo:row.id===t.id,soloSafe:false}))};
    previewGraph=SW.buildGraph(ctx,session);
    SW.schedule(previewGraph,media,at,Math.min(songEnd(p),at+p.meter*64),ctx.currentTime+.015);previewMeters();
  }
  function moveGesture(event){
    const g=gesture;
    if(!g||event.pointerId!==g.pointer) return;
    const dx=event.clientX-g.x, dy=event.clientY-g.y;
    if(Math.abs(dx)+Math.abs(dy)>3) g.moved=true;
    if(!g.moved) return;
    if(moveTimelineGesture(g,event)||movePianoGesture(g,event))return;
    if(g.kind==='fade'){
      const delta=dx/Math.max(1,g.surface.getBoundingClientRect().width)*g.c.length;
      g.next=fadeDuration(g.c,g.key,g.length+(g.key==='fadeIn'?delta:-delta));
      g.grip.style.setProperty('--fade-edge',100*g.next/g.c.length+'%');
      g.grip.setAttribute('aria-valuenow',Math.round(seconds(g.next,p.bpm)*1000));
      g.surface.querySelector('[data-fade-path="'+g.key+'"]').setAttribute('d',fadePath(g.c,g.key,g.next));
      return;
    }
    if(g.kind==='range'||g.kind==='draw'){
      const now=pointerBeat(g.lane,event);
      g.now=now;
      editRange={from:Math.min(g.at,now),to:Math.max(g.at,now),t:g.t.id};showRange();return;
    }
    if(g.kind==='clip'){
      const {c}=g, min=Math.min(.125,g.length), delta=dx/zoom;
      if(g.slip){g.nowOffset=clamp(sn(g.offset+delta),0,clipLimit(c)-g.length);return;}
      if(g.stretch){
        const low=c.type==='audio'?g.length*30/c.sourceBpm:min;
        const high=c.type==='audio'?g.length*320/c.sourceBpm:99999;
        g.nowStart=g.start;g.nowLength=clamp(sn(g.start+g.length+delta)-g.start,Math.max(min,low),high);
      }else if(g.edge==='left'){
        const left=clamp(sn(g.start+delta),c.type==='audio'?Math.max(0,g.start-g.offset):0,g.start+g.length-min);
        g.nowStart=left;g.nowLength=g.start+g.length-left;
      }else if(g.edge==='right'){
        g.nowStart=g.start;g.nowLength=clamp(sn(g.start+g.length+delta)-g.start,min,clipLimit(c)-c.offset);
      }else{
        g.nowStart=clamp(sn(g.start+delta),0,99999);g.nowLength=g.length;
      }
      g.el.style.left=g.nowStart*zoom+'px';g.el.style.width=g.nowLength*zoom+'px';
    }else if(g.kind==='point'&&g.el){
      const pt=envelopePosition(g,event.clientX,event.clientY);
      g.el.setAttribute('cx',Math.max(2,pt.at*Number(g.envelope.dataset.scale)));g.el.setAttribute('cy',pt.y);
    }
  }
  function envelopePosition(g,cx,cy){
    const rect=g.envelope.getBoundingClientRect(), spec=laneSpecs(g.t)[g.param];
    const [,min,max,step]=spec;
    const bottom=Number(g.envelope.dataset.back), scale=Number(g.envelope.dataset.scale);
    const y=clamp(cy-rect.top,10,bottom), at=clamp(sn((cx-rect.left)/scale),0,99999);
    const v=clamp(quantize(max-(y-10)/(bottom-10)*(max-min),step),min,max);
    return {at,value:round(v),y:10+(max-v)/(max-min)*(bottom-10)};
  }
  let noDoubleBefore=0;
  function finishGesture(event){
    const g=gesture;
    if(!g||event.pointerId!==g.pointer) return;
    gesture=null;
    queueMicrotask(resizeDockView);
    if(finishTimelineGesture(g,event)||finishPianoGesture(g,event))return;
    if(g.kind==='listen'){stopPreview();return;}
    if(event.type==='pointercancel'){if(g.kind==='range'||g.kind==='draw')editRange=null;render();return;}
    if(g.kind==='fade'){
      if(g.next!==undefined){
        setWaveFade(g.c,g.key,g.next);
        const scope=g.surface.classList.contains('wave-surface')?'.wave-surface ':'[data-clip="'+g.c.id+'"] ';
        find(scope+'[data-fade-handle="'+g.key+'"]')?.focus({preventScroll:true});
      }
      return;
    }
    if(g.kind==='range'){
      if(!g.moved){
        editRange=null;
        if(g.toggleEvent){
          const row=g.toggleEvent, rows=selectedClips();
          selectMany(rows.some(({c})=>c.id===row.c.id)?rows.filter(({c})=>c.id!==row.c.id):[...rows,row]);
        }else if(!g.temporary)seek(g.at);
      }else if(g.temporary){
        const range=editRange;
        selectTrack(g.t.id,false);editRange=range;renderSelections();renderInspector();
      }
      showRange();if(tab==='edit')renderDock();return;
    }
    if(g.kind==='draw'){
      const at=Math.min(g.at,g.now??g.at), end=Math.max(g.at,g.now??g.at);
      edit(()=>{
        const c=newMidiClip(g.t,at);
        c.length=end>at?end-at:p.meter;editRange=null;
      },'Drew instrument part');return;
    }
    if(g.kind==='clip'){
      if(!g.moved){
        if(tab!=='mixer') renderDock();
        return;
      }
      noDoubleBefore=performance.now()+230;
      const {c,t}=g;
      if(g.slip&&g.nowOffset!==undefined){c.offset=g.nowOffset;commit(g.snapshot,'Slipped audio source');return;}
      if(g.stretch&&g.nowLength){
        const factor=g.nowLength/g.length;
        if(c.type==='audio'){c.sourceBpm*=factor;c.offset*=factor;c.fadeIn*=factor;c.fadeOut*=factor;}
        else{
          for(const n of c.notes){n.start*=factor;n.length*=factor;}
          for(const lane of Object.values(c.expression||{}))for(const point of lane)point.at*=factor;
        }
        c.length=g.nowLength;commit(g.snapshot,'Stretched event');return;
      }
      if(!g.edge&&g.nowStart!==undefined&&g.group.length){
        const delta=g.nowStart-g.start, target=(event.target?.ownerDocument||document).elementFromPoint(event.clientX,event.clientY)?.closest('[data-lane]');
        const next=p.tracks.find(row=>row.id===target?.dataset.lane&&row.type===t.type);
        const rows=[];
        for(const row of g.group){
          const destination=g.group.length===1&&next?next:row.t;
          const part=g.copy?SW.shiftClip(row.c,delta):row.c;
          if(g.copy)destination.clips.push(part);
          else {
            part.start=clamp(part.start+delta,0,99999);
            if(destination!==row.t){row.t.clips=row.t.clips.filter(item=>item!==part);destination.clips.push(part);}
          }
          rows.push({t:destination,c:part});
        }
        selectMany(rows);commit(g.snapshot,g.copy?'Copied event(s)':'Moved event(s)');return;
      }
      if(g.nowStart!==undefined){
        if(g.edge==='left'){
          const delta=g.nowStart-c.start;
          if(c.type==='audio') c.offset=Math.max(0,c.offset+delta);
          else{
            if(c.expression)c.expression=SW.expressionSlice(c,Math.max(0,delta),g.length);
            if(delta<0)for(const points of Object.values(c.expression||{}))for(const pt of points)pt.at-=delta;
            c.notes=c.notes.filter(n=>n.start+n.length>delta).map(n=>({...n,start:Math.max(0,n.start-delta),length:n.start+n.length-Math.max(delta,n.start)}));
          }
        }
        c.start=g.nowStart;setLength(c,g.nowLength);
      }
      if(!g.edge){
        const target=(event.target?.ownerDocument||document).elementFromPoint(event.clientX,event.clientY)?.closest('[data-lane]');
        const next=p.tracks.find(row=>row.id===target?.dataset.lane&&row.type===t.type);
        if(next&&next!==t){t.clips=t.clips.filter(row=>row!==c);next.clips.push(c);selectClip(next,c,false);}
      }
      commit(g.snapshot,g.edge?'Trimmed clip':'Moved clip');
    }else if(g.kind==='point'){
      const pt=envelopePosition(g,event.clientX,event.clientY);
      if(g.index!==null&&!g.moved) return;
      if(g.index!==null) g.t.lanes[g.param].splice(g.index,1);
      addPoint(g.t,g.param,pt.at,pt.value);
      commit(g.snapshot,'Updated automation envelope');
      const index=g.t.lanes[g.param]?.findIndex(point=>point.at===pt.at);
      if(index>=0)find('[data-point="'+index+'"]')?.focus({preventScroll:true});
    }
  }
  function keyTarget(){
    if(midiTake) return p.tracks.find(t=>t.id===midiTake.id);
    const t=currentTrack();
    return t.type==='midi'&&!t.instrumentOnly?t:p.tracks.find(row=>row.type==='midi'&&!row.instrumentOnly&&armed.has(row.id));
  }
  function renderKeys(){
    $('qwerty-panel').hidden=!qwerty;
    $('qwerty').setAttribute('aria-pressed',qwerty);
    $('keys-route').textContent=keyTarget()?.name||'Select an instrument';
    $('key-octave').value='C'+qOctave;
    $('key-velocity').value=qVelocity;$('key-vel-label').value=qVelocity;
    const keys=Object.entries(SW.noteKeys).map(([key,offset])=>{
      const pitch=12*(qOctave+1)+offset, label=key.replace('Key','').replace('Semicolon',';').replace('Quote',"'");
      const name=SW.noteName(pitch);
      return '<button type="button" data-key-pad="'+key+'" class="'+(name.includes('♯')?'black ':'')+(keyboardHeld.has(key)?'active':'')+'" aria-label="'+esc(name+' ('+label+')')+'">'+esc(label)+'</button>';
    });
    $('key-pads').innerHTML=keys.join('');
  }
  function setKeyboard(on){
    if(!on) releaseKeyboard();
    qwerty=on;renderKeys();
  }
  function midiInputStart(id,pitch,velocity,track=keyTarget()){
    if(!track||track.type!=='midi') return;
    const input=track.sourceInput||'all';
    const hardware=id.startsWith('midi:');
    if(input==='off'||input==='qwerty'&&hardware||input==='external'&&!hardware)return;
    const sourceKey=hardware?id.slice(0,id.lastIndexOf(':')):null;
    if(midiTake){
      const at=live?positionAt(live):playhead;
      if(hardware){
        for(const [key,value] of Object.entries(hardwareControls.get(sourceKey)||{}))
          if(!midiTake.expression?.[key]?.length&&value!==SW.midiLanes[key][5])SW.setExpression(midiTake,key,0,value);
      }
      endMidiNote(id,at);
      heldMidi.set(id,{pitch,at,velocity});
    }
    const state={release:null,sourceKey,sustain:track.instrument!=='Drums'};
    keyboardHeld.set(id,state);
    const pad=Object.hasOwn(SW.noteKeys,id)?document.querySelector('[data-key-pad="'+id+'"]'):null;
    if(pad)pad.classList.add('active');
    if(mutedMidiMonitors.has(track.id))return;
    ensureAudio().then(()=>{
      if(keyboardHeld.get(id)!==state) return;
      const existing=live?.graph||monitorGraph;
      let graph=existing?.tracks.has(track.id)?existing:null;
      if(!graph){
        clearTimeout(previewTimer);
        if(!previewGraph?.tracks?.has(track.id)){
          stopPreview();
          const audible={...p,tracks:p.tracks.map(t=>({...t,solo:t.id===track.id,mute:false})),master:{...p.master,mute:false},dimSolo:false};
          previewGraph=SW.buildGraph(ctx,audible,true);
        }
        graph=previewGraph;
      }
      state.release=SW.voice(graph,track,pitch,velocity,ctx.currentTime+.012,120,media,Infinity,true);previewMeters();
      if(hardware)for(const [key,value] of Object.entries(hardwareControls.get(sourceKey)||{}))state.release?.control?.(key,value);
    }).catch(report);
  }
  function midiInputStop(id,force=false){
    const at=live?positionAt(live):playhead;
    endMidiNote(id,at);
    const state=keyboardHeld.get(id);
    keyboardHeld.delete(id);
    if(state?.release&&state.sustain&&!force&&hardwareControls.get(state.sourceKey)?.cc64>=64){
      if(!pedalVoices.has(state.sourceKey))pedalVoices.set(state.sourceKey,new Set());
      pedalVoices.get(state.sourceKey).add(state);
    }else state?.release?.();
    const pad=Object.hasOwn(SW.noteKeys,id)?document.querySelector('[data-key-pad="'+id+'"]'):null;
    if(pad)pad.classList.remove('active');
    if(!keyboardHeld.size&&!pedalVoices.size&&previewGraph) previewTimer=setTimeout(stopPreview,1200);
  }
  function releaseKeyboard(){
    for(const id of [...keyboardHeld.keys()]) midiInputStop(id,true);
    for(const voices of pedalVoices.values())for(const voice of voices)voice.release?.();
    pedalVoices.clear();
    if(!keyboardHeld.size&&previewGraph)previewTimer=setTimeout(stopPreview,1200);
  }
  function keyboardNote(code){
    const offset=SW.noteKeys[code];
    if(offset===undefined||keyboardHeld.has(code)) return;
    midiInputStart(code,clamp(12*(qOctave+1)+offset,0,127),qVelocity/127);
  }
  const commandList={
    ...Object.fromEntries(['notes','audio','part'].flatMap(scope=>SW.eventMenu(scope)).flatMap(([,rows])=>
      rows.map(([id,label])=>[id,[label,'']]))),
    'macro-organizer':['Macro Organizer…',''],'arrange-macros':['Arrangement Macro Toolbar',''],
    'demo':['Open demo',''],'save-copy':['Save a copy…',''],'import-video':['Import video reference…',''],'export-midi':['Export MIDI',''],
    'session-setup':['Session Setup…',''],'session-io':['Audio I/O Setup…',''],'marker':['Add named marker…',''],
    'insert-track':['Insert Track…','T'],'add-folder':['Add folder track',''],'add-fx':['Add FX return',''],'track-duplicate':['Duplicate track',''],'track-remove':['Remove track and retain instrument…','Shift+T'],'track-remove-complete':['Remove track and instrument…','Alt+Shift+T'],
    'track-icon':['Track icon…',''],'track-arm':['Record arm',''],'track-mute':['Mute channel',''],'track-solo':['Solo channel',''],'stop':['Stop',''],'video-panel':['Video reference',''],
    'focus-arrange':['Focus arrangement',''],'detach-panel':['Detach / dock lower panel',''],'fullscreen-panel':['Fullscreen lower panel',''],
    'detach-browser':['Detach / dock Browser',''],'fullscreen-browser':['Fullscreen Browser',''],'fullscreen':['Full screen',''],'reset-layout':['Reset workspace layout',''],
    'preferences':['Preferences…','Ctrl+,'],'settings-audio':['Audio Setup…',''],'settings-midi':['External Devices…',''],'settings-keys':['Keyboard Shortcuts…',''],
    'import-keys':['Import keyboard shortcuts…',''],'export-keys':['Export keyboard shortcuts…',''],'browse-local-plugins':['Local plug-ins',''],
    'choose-sample-folder':['Choose audio and MIDI folder…',''],'clear-sample-folder':['Clear linked media folder',''],
    'browse-samples':['Browse linked media',''],'browse-instruments':['Browse built-in instruments',''],
    'help':['Sonoravell shortcut guide',''],'online-reference':['Fender Studio Pro reference ↗',''],'workflow-tutorial':['Settings tutorial ↗',''],'about':['About Sonoravell',''],
    'transport':['Play / stop','Space'],'home':['Locate session start','Home'],'record':['Record','R'],
    'snap-toggle':['Toggle snapping','N'],'loop':['Toggle loop','L'],'click':['Toggle metronome','C'],'edit':['Open Edit','F2'],
    'routing':['Open signal flow','F6'],'end':['Locate session end','End'],'zoom-fit':['Fit timeline to contents','Shift+F'],
    'zoom-in':['Zoom in','Ctrl+='],'zoom-out':['Zoom out','Ctrl+-'],
    'zoom-vertical-in':['Increase track height','Alt+='],'zoom-vertical-out':['Decrease track height','Alt+-'],'import-media':['Import file','Ctrl+Shift+O'],
    'add-instrument':['Add instrument track',''],'add-audio':['Add audio track',''],'add-bus':['Add bus channel',''],
    'new':['New Document…','Ctrl+N'],'mixer':['Open Mixer','F3'],'inspector':['Toggle Inspector','F4'],'browser':['Open Browser','F5'],
    'audio-batch':['Audio Batch Converter…',''],
    'show-start':['Start',''],'show-session':['Session',''],'show-mastering':['Mastering',''],'show-live':['Show',''],
    'quick-switch':['Quick Switch…',''],'add-to-mastering':['Add to Mastering Project',''],'add-to-show':['Add to Show',''],
    'launcher-view':['Launcher','B'],'scratch-view':['Scratch Pads',''],'patterns-view':['Pattern Editor',''],
    'score-view':['Score Editor',''],'lyrics-view':['Lyrics Display',''],'channel-view':['Channel Overview',''],'monitor-view':['Performance Monitor',''],
    'automation':['Open Automation','A'],'keyboard':['Toggle QWERTY MIDI','CapsLock'],
    'export':['Export mixdown','Ctrl+E'],'export-stems':['Export stems','Ctrl+Shift+E'],
    'export-selection':['Export selection','Ctrl+Alt+E'],
    'save':['Save Document','Ctrl+S'],'open':['Open Document…','Ctrl+O'],'find':['Find command','Ctrl+K'],
    'undo':['Undo','Ctrl+Z'],'redo':['Redo','Ctrl+Shift+Z'],'copy':['Copy events','Ctrl+C'],
    'cut':['Cut events','Ctrl+X'],'paste':['Paste at cursor','Ctrl+V'],'paste-original':['Paste at original position','Ctrl+Shift+V'],
    'all':['Select all events','Ctrl+A'],'select-track':['Select events on track','Ctrl+Shift+A'],
    'select-muted':['Select muted events',''],'invert-selection':['Invert event selection','Ctrl+I'],
    'clear-selection':['Clear selection','Escape'],'delete':['Delete focused item or selection','Delete'],
    'split':['Split at cursor','S'],'duplicate':['Duplicate event','D'],'repeat':['Repeat events','Ctrl+D'],
    'merge':['Merge MIDI events / bounce audio','G'],'lock-event':['Toggle event lock','Ctrl+L'],
    'mute-event':['Toggle event mute','M'],'nudge-left':['Nudge selection left','ArrowLeft'],'nudge-right':['Nudge selection right','ArrowRight'],
    'align':['Align events to cursor','Ctrl+G'],'quantize':['Quantize events or notes','Q'],
    'range-loop':['Set loop from range','Shift+L'],'split-range':['Split at range boundaries','Ctrl+Alt+X'],
    'trim-range':['Crop events to range',''],'delete-range':['Delete selected range',''],
    'delete-time':['Ripple delete range across tracks','Ctrl+Shift+Delete'],'reverse':['Reverse audio events',''],
    'normalize':['Normalize event gain',''],'fade-both':['Create short fades','F'],'reset-fades':['Clear fades',''],
    'slip-left':['Slip audio left','Alt+ArrowLeft'],'slip-right':['Slip audio right','Alt+ArrowRight'],
    'crossfade':['Crossfade overlapping events','X'],'detect-stops':['Split audio at silence boundaries',''],
    'note-all':['Select all notes in part','Ctrl+Alt+A'],'note-up-semi':['Transpose note +1','ArrowUp'],
    'note-down-semi':['Transpose note −1','ArrowDown'],'note-up-oct':['Transpose note +12','Shift+ArrowUp'],
    'note-down-oct':['Transpose note −12','Shift+ArrowDown'],'note-legato':['Legato',''],
    'note-staccato':['Staccato',''],'note-length':['Apply note grid length',''],'note-velocity':['Set velocity',''],
    'note-split':['Split selected notes at the playhead','Shift+S'],'note-quantize-end':['Quantize note ends','Alt+Q'],
    'note-scale':['Apply selected scale','Alt+K'],'note-trim-overlaps':['Trim same-pitch overlaps',''],
    'note-humanize':['Humanize selected notes','H'],'note-reverse':['Reverse selected notes',''],'note-mute':['Mute notes',''],
    ...Object.fromEntries(Object.entries(toolsList).map(([id,label],i)=>['tool-'+id,[label+' tool',String(i+1)]]))
  };
  let keyMap=readSettings('sw-keymap',{}), keyAliases=readSettings('sw-keymap-aliases',{}), rebinding=null, keyImportReport=null;
  function commandKey(id){
    if(id==='delete')return 'Delete';
    const key=Object.hasOwn(keyMap,id)?keyMap[id]:commandList[id][1];
    return key==='Delete'?commandList[id][1]:key;
  }
  function keyChord(event){
    let key=event.key;
    if(key===' ') key='Space';
    else if(key.length===1) key=key.toUpperCase();
    if(key==='Backspace') key='Delete';
    if(/^Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal)$/.test(event.code))key=event.code;
    const shift=event.shiftKey&&(!/^[^A-Z0-9]$/.test(key)||key==='='||key==='-');
    return [event.ctrlKey||event.metaKey?'Ctrl':'',event.altKey?'Alt':'',shift?'Shift':'',key].filter(Boolean).join('+');
  }
  function commandRows(){
    setTool(editTool);
    $('snap-toggle').title='Toggle snapping'+(commandKey('snap-toggle')?' ('+commandKey('snap-toggle')+')':'');
    $('insert-track').title='Insert Track'+(commandKey('insert-track')?' ('+commandKey('insert-track')+')':'');
    const query=$('command-search').value.trim().toLowerCase();
    $('commands').innerHTML=Object.entries(commandList).filter(([id,[name]])=>!query||(name+' '+commandKey(id)).toLowerCase().includes(query)).map(([id,[name]])=>
      '<div class="command-row"><button type="button" data-cmd="'+id+'">'+esc(name)+'</button><kbd>'+esc([commandKey(id),...(keyAliases[id]||[]).filter(key=>key!=='Delete')].filter(Boolean).join(' / ')||'—')+'</kbd><button class="bind-key" type="button" data-bind="'+id+'"'+(id==='delete'?' disabled title="Delete is reserved for the focused item"':'')+'>'+(rebinding===id?'Press shortcut…':'Change')+'</button></div>'
    ).join('');
  }
  function command(id,target){
    if(!Object.hasOwn(commandList,id)) return;
    if(id==='delete'&&target?.closest?.('#context-menu'))target=contextFocus;
    hideContext();
    const modal=$('command-dialog');
    if(modal.open&&id!=='find') modal.close();
    if(workspacePages.commands(id))return;
    if(workspacePages.page()!=='session'&&!workspacePages.available(id))return;
    const companionView=id.endsWith('-view')&&id.slice(0,-5);
    if(companionView){sessionViews.open(companionView);return;}
    const insertType={'insert-track':'','add-audio':'audio','add-instrument':'midi','add-folder':'folder'}[id];
    if(insertType!==undefined){openInsertTrack(insertType||undefined);return;}
    if(id==='track-remove'||id==='track-remove-complete'){
      if(isEditing())return;
      const folder=target?.closest?.('.folder-head[data-folder]');
      if(folder)folderAction({dataset:{action:'folder-remove'},closest:()=>folder});
      else removeTracks(channelById(target?.closest?.('[data-track]')?.dataset.track)||currentTrack(),id==='track-remove-complete');
      return;
    }
    if(id==='snap-toggle'){toggleSnap();return;}
    if(id==='import-media'){if(!isEditing())$('import-files').click();return;}
    if(id==='marker'){openGlobalEntry('markers',sn(playhead));return;}
    const direct={transport:'play',home:'back',record:'record',loop:'loop',click:'click',inspector:'toggle-inspector',
      'import-video':'video-file','import-keys':'shortcut-file','export-keys':'keymap-export',stop:'stop',help:'help'};
    if(Object.hasOwn(direct,id)){$(direct[id]).click();return;}
    if(['edit','mixer','browser','automation','routing'].includes(id)){setTab(id,true);return;}
    if(id==='add-bus'){if(!isEditing())edit(()=>addTrack('bus'),'Added mixer bus');return;}
    const trackAction={'add-fx':'fx-bus','track-duplicate':'duplicate-track','track-arm':'arm','track-mute':'mute','track-solo':'solo'}[id];
    if(trackAction){if(menuAvailable(id))doAction({dataset:{action:trackAction},closest:()=>null});return;}
    if(id==='save-copy'){
      if(!isEditing()){const name=prompt('Name for the portable copy',p.name+' copy')?.trim();if(name)run(saveProject)(name);}
      return;
    }
    if(id==='macro-organizer'){openMacroOrganizer();return;}
    if(id==='arrange-macros'){arrangerMacros=!arrangerMacros;redrawMacroToolbars();return;}
    if(id==='track-icon'){openTrackIcons(currentTrack());return;}
    if(id==='session-setup'||id==='session-io'){openSessionSetup(id==='session-io');return;}
    if(id==='preferences'||id.startsWith('settings-')){
      const category={'settings-audio':'audio','settings-midi':'external','settings-keys':'general'}[id];
      preferenceWindow.open(category,id==='settings-keys'?'keys':undefined);
      if(category==='audio'&&navigator.mediaDevices?.enumerateDevices)run(refreshDevices)();
      return;
    }
    const browse={'browse-samples':'library','browse-local-plugins':'local','browse-instruments':'instruments'}[id];
    if(browse){browserKind=browse;browserQuery='';setTab('browser');return;}
    if(id==='choose-sample-folder'){$('sample-folder').click();return;}
    if(id==='clear-sample-folder'){
      sampleFolder=[];sampleFolderName='';if(browserOpen&&browserKind==='library')renderBrowserPanel();preferenceWindow.refresh();return;
    }
    if(id==='video-panel'){if(reference.visible())reference.hide();else reference.show();return;}
    if(['detach-panel','fullscreen-panel','detach-browser','fullscreen-browser'].includes(id)){
      const browser=id.endsWith('-browser');
      if(browser)setTab('browser');else setTab(tab);
      const panel=$(browser?'browser-workspace':'lower-workspace');
      if(id.startsWith('detach'))panels.detach(panel,browser?'Browser':'Editors and mixer');
      else run(async()=>{await panels.fullscreen(panel);toggleWindowLabels();resizeDockView();})();
      return;
    }
    if(id==='focus-arrange'){$('arrange-scroll').focus();return;}
    if(id==='fullscreen'){
      if(document.fullscreenElement) run(()=>document.exitFullscreen())();
      else if(document.documentElement.requestFullscreen) run(()=>document.documentElement.requestFullscreen())();
      return;
    }
    if(id==='reset-layout'){
      if(panelCollapsed) $('toggle-inspector').click();
      panels.close();
      panels.closeFullscreen($('lower-workspace'));panels.closeFullscreen($('browser-workspace'));
      rememberedEditorModes.clear();browserFullscreen=false;
      dockHeight=0;browserWidth=360;browserOpen=false;
      document.body.style.setProperty('--browser-width','360px');
      document.body.classList.remove('dock-expanded','dock-custom');
      mixerWide=prefs.defaultWide;mixerDevices=prefs.defaultDevices;mixerFilter='all';
      verticalZoom=0;remember('sw-track-zoom',0);
      const mixer=$('dock').querySelector('.mixer-viewport');
      if(mixer)mixer.scrollLeft=0;
      mixerScroll=0;renderArrangement();updatePosition();
      if(reference.visible())reference.hide();
      setTool('arrow');setTab(prefs.initialPanel==='browser'?'mixer':prefs.initialPanel);if(prefs.initialPanel==='browser')setTab('browser');$('arrange-scroll').focus();return;
    }
    if(id==='about'){alert('Sonoravell Studio 1.0.2\nBrowser-based audio and MIDI workstation');return;}
    if(id==='online-reference'||id==='workflow-tutorial'){
      window.open(id==='online-reference'?'https://www.fender.com/pages/fender-studio-pro-specs-resources':'https://www.youtube.com/watch?v=NrYnI-r1cdI','_blank','noopener');return;
    }
    if(id==='end'){seek(songEnd(p));return;}
    if(id==='zoom-vertical-in'||id==='zoom-vertical-out'){
      const old=trackHeight(), change=id==='zoom-vertical-in'?12:-12;
      const preferred=({compact:57,tall:100}[prefs.density]||68);
      verticalZoom=clamp(old+change,44,190)-preferred;
      if(old!==trackHeight()){
        const view=$('arrange-scroll'), fixed=43+visibleGlobals.size*27;
        const top=view.scrollTop;
        remember('sw-track-zoom',verticalZoom);renderArrangement();updatePosition();
        if(top>fixed)view.scrollTop=fixed+(top-fixed)*trackHeight()/old;
      }
      status(valueStatus('','Track height',trackHeight(),'px'));return;
    }
    if(id.startsWith('zoom-')){
      const control=$('zoom');
      const fit=($('arrange-scroll').clientWidth-210)/Math.max(1,songEnd(p));
      control.value=clamp(id==='zoom-fit'?fit:id==='zoom-in'?zoom*1.21:zoom/1.21,Number(control.min),Number(control.max));
      control.dispatchEvent(new Event('input'));return;
    }
    if(id==='find'){
      if(!modal.open){rebinding=null;$('command-search').value='';commandRows();modal.showModal();$('command-search').focus();}
      return;
    }
    if(id==='keyboard'){setKeyboard(!qwerty);status(qwerty?'QWERTY MIDI on':'QWERTY MIDI off');return;}
    if(id==='save'){run(saveProject)();return;}
    if(id==='undo'||id==='redo'){undoEdit(id==='redo');return;}
    if(id.startsWith('export')){
      openExport(id==='export-stems'?'stems':id==='export-midi'||id==='export-selection'&&activeClip()?.type==='midi'?'midi':'wav',id==='export-selection'?'selection':undefined);
      return;
    }
    if(isEditing()) return;
    if(['cut','copy','paste','paste-original'].includes(id)){driveClipboard(id,clipboardScope(target));return;}
    if(noteScopeCommand(id,target))return;
    if(eventCommand(id))return;
    if(id.startsWith('tool-')){setTool(id.slice(5));return;}
    if(id==='clear-selection'){
      if(editorFocus?.kind==='global'){$('arrange-scroll').focus();setEditorFocus({kind:'events'});}
      editRange=null;picked.clear();notePicked.clear();clipId=null;noteId=null;render();return;
    }
    if(['all','select-track','select-muted','invert-selection'].includes(id)){
      const previous=new Set(selectedClips().map(({c})=>c.id));
      selectMany(allClips().filter(({t,c})=>id==='all'||id==='select-track'&&t.id===trackId||id==='select-muted'&&c.muted||id==='invert-selection'&&!previous.has(c.id)));return;
    }
    if(id==='delete'){
      if(isEditing()||deleteFocused(target))return;
      if(editRange) editRangeAction('delete-range');
      else removeSelected();
      return;
    }
    if(id.startsWith('note-')){
      const op=id.slice(5);
      if(target)includeFocusedNote(clipboardScope(target));
      editNotes(op==='length'?'fixed-length':op);return;
    }
    if(id.includes('range')||id==='delete-time'){editRangeAction(id);return;}
    eventBatch(id);
  }
  let contextBeat=null, contextFocus=null, noteClipboard=[];
  function editorToolAction(el){
    const action=el.dataset.action;
    if(action==='editor-controls'){editorControls=!editorControls;renderDock(false);return true;}
    if(action==='editor-action-menu'){
      const rect=el.getBoundingClientRect(), row=editorRow();
      if(row?.c.type==='audio'&&activeClip()!==row.c){selectClip(row.t,row.c,false);renderSelections();renderInspector();}
      contextBeat=playhead;
      if(editorPage()==='notes')editorFocus={kind:'notes'};
      else editorFocus={kind:'events'};
      showContext(rect.left,rect.bottom,SW.eventMenu(editorClip()?.type==='audio'?'audio':editorPage()==='notes'?'notes':'events'),el.ownerDocument);
      return true;
    }
    return false;
  }
  function noteClipboardAction(id){
    const c=editorClip();
    if(c?.type!=='midi'){status('Open an instrument part first.',true);return;}
    if(id!=='note-copy'&&c.locked){status('Unlock the MIDI part before editing.',true);return;}
    const notes=exactNotes(c);
    if(id==='note-cut'||id==='note-copy'){
      if(!notes.length){status('Select notes first.',true);return;}
      noteClipboard=notes.map(n=>clone(n));
      if(id==='note-copy'){status('Copied '+notes.length+' note(s)');return;}
    }
    if(id==='note-delete'||id==='note-cut'){
      removeNotes(c,notes,id==='note-cut'?'Cut':'Deleted');return;
    }
    const duplicate=id==='note-duplicate', original=id==='note-paste-original', copies=duplicate?notes:noteClipboard;
    if(!copies.length){status(duplicate?'Select notes to duplicate.':'Copy notes before pasting.',true);return;}
    const first=copies.reduce((min,n)=>Math.min(min,n.start),Infinity);
    const last=copies.reduce((max,n)=>Math.max(max,n.start+n.length),0);
    const at=original?first:duplicate?last:clamp(noteTime(playhead-c.start),0,c.length);
    const length=Math.min(100000-c.start,Math.max(c.length,at+last-first));
    if(at+last-first>length+1e-7){status('The notes exceed the session timeline.',true);return;}
    const created=SW.pasteNotes(copies,length,at,original);
    if(!created.length){status('The notes do not fit in this part.',true);return;}
    edit(()=>{
      c.length=length;c.notes.push(...created);chooseNotes(created.map(n=>n.id));
    },(duplicate?'Duplicated ':'Pasted ')+created.length+' note(s)');
    focusNoteEditor();
  }
  function eventCommand(id){
    if(id==='event-delete'){removeSelected();return true;}
    if(id==='event-loop'){editRangeAction('range-loop');return true;}
    if(id==='event-split-click'){eventBatch('split',contextBeat??playhead);return true;}
    if(id==='open-event-editor'||id==='event-open-expression'){
      if(activeClip()){
        editPage=id==='event-open-expression'?'expression':'notes';setTab('edit');
      }
      return true;
    }
    if(id==='event-find-pool'){
      const c=activeClip();
      if(c?.type==='audio'){
        highlightedPoolAsset=c.asset;browserKind='pool';setTab('browser');
        $('browser-content').querySelector('[data-asset="'+c.asset+'"]')?.scrollIntoView({block:'nearest'});
      }
      return true;
    }
    if(id==='event-rename'||id==='event-gain'){
      const rows=selectedClips().filter(({c})=>!c.locked&&(id!=='event-gain'||c.type==='audio'));
      if(!rows.length)return true;
      const value=prompt(id==='event-gain'?'Event gain in dB (−60 to +24)':'Name for selected events',String(id==='event-gain'?rows[0].c.gain:rows[0].c.name));
      if(value===null||!value.trim()||id==='event-gain'&&!Number.isFinite(Number(value)))return true;
      edit(()=>{for(const {c} of rows){if(id==='event-gain')c.gain=clamp(Number(value),-60,24);else c.name=value.trim().slice(0,120);}},
        id==='event-gain'?'Adjusted event gain':'Renamed events');
      return true;
    }
    if(id.startsWith('part-')){
      const rows=selectedClips().filter(({c})=>c.type==='midi'&&!c.locked);
      if(!rows.length)return true;
      const op=id.slice(5), asks=op==='transpose'||op==='velocity';
      const raw=asks?prompt(op==='transpose'?'Transpose in semitones':'Part velocity (1–127)',op==='transpose'?'12':'100'):'0';
      if(raw===null||!raw.trim()||!Number.isFinite(Number(raw)))return true;
      const value=Math.round(Number(raw));
      edit(()=>{for(const {c} of rows)SW.noteEdit(c.notes,c.length,op,{step:step(),strength:quantizeStrength/100,
        semitones:clamp(value,-48,48),velocity:clamp(value,1,127)/127,seed:Date.now()});},'Edited instrument parts');
      return true;
    }
    if(['note-copy','note-cut','note-paste','note-paste-original','note-duplicate','note-delete'].includes(id)){noteClipboardAction(id);return true;}
    return false;
  }
  function openObjectMenu(target,x,y,owner){
    if(openGlobalMenu(target,x,y,owner))return true;
    const n=target.closest('[data-note]'), event=target.closest('[data-clip]'), wave=target.closest('.wave-surface');
    const head=target.closest('.track-head[data-track],.console-strip[data-track]');
    if(head){
      if(isEditing())return true;
      openTrackMenu(head,x,y,owner);return true;
    }
    if(n&&editorClip()?.type==='midi'){
      editorFocus={kind:'notes'};noteId=n.dataset.note;
      if(!notePicked.has(noteId))notePicked=new Set([noteId]);
      showContext(x,y,SW.eventMenu('notes'),owner);return true;
    }
    if(event||wave&&editorClip()?.type==='audio'){
      editorFocus={kind:'events'};
      const row=event?foundClip(event.dataset.clip):editorRow();
      if(!row)return false;
      const rect=(event||wave).getBoundingClientRect();
      contextBeat=row.c.start+clamp((x-rect.left)/Math.max(1,rect.width),0,1)*row.c.length;
      if(!picked.has(row.c.id)||clipId!==row.c.id){
        const group=picked.has(row.c.id)?new Set(picked):null;
        selectClip(row.t,row.c,false);
        if(group)picked=group;
        renderSelections();renderInspector();
      }
      showContext(x,y,SW.eventMenu(row.c.type==='audio'?'audio':'part'),owner);return true;
    }
    return false;
  }

  function openTrackMenu(head,x,y,owner){
    const t=channelById(head.dataset.track);
    if(!t)return;
    if(!pickedTracks.has(t.id)||t.id!==trackId){
      const group=pickedTracks.has(t.id)?new Set(pickedTracks):null;
      selectTrack(t.id,false);
      if(group)pickedTracks=group;
      renderSelections();renderInspector();renderKeys();
      if(tab==='edit')renderDock(false);
    }
    const playable=SW.timelineTrack(t);
    const labels=[
      ['Track',[['@track-rename','Rename track…'],['@track-icon','Choose track icon…'],
        ...(playable?[['@track-edit','Open track in Edit'],['select-track','Select all track events']]:[])]],
      ['Channel',[
        ...(playable?[['track-arm',armed.has(t.id)?'Disarm recording':'Arm for recording']]:[]),
        ...(t.type==='audio'?[['@inputs','Choose recording input…']]:[]),
        ...(playable?[['@record-monitor',(t.type==='audio'?monitoring.has(t.id):!mutedMidiMonitors.has(t.id))?
          'Disable input monitoring':'Enable input monitoring']]:[]),
        ['track-mute',t.mute?'Unmute':'Mute'],
        ...(t.id!=='master'?[['track-solo',t.solo?'Unsolo':'Solo']]:[]),['automation','Toggle Automation view']]],
      ...(t.id!=='master'?[['Manage',[['track-duplicate','Duplicate track'],
        ...(!t.instrumentOnly?[['track-remove',t.type==='midi'||pickedTracks.size>1?'Remove track(s), keep instruments…':'Remove track…']]:[]),
        ...((t.type==='midi'||pickedTracks.size>1)?[['track-remove-complete',t.instrumentOnly?'Remove loaded instrument…':'Remove track(s) and instruments…']]:[])
      ]]]:[])
    ];
    showContext(x,y,labels,owner);
  }
  const menuGlyphs={
    'track-rename':'✎','track-icon':'◇','track-edit':'▤','select-track':'▣','track-arm':'●',inputs:'↳',
    'track-mute':'M','track-solo':'S','record-monitor':'◖',automation:'⌁','track-duplicate':'⧉','track-remove':'×','track-remove-complete':'×',
    cut:'✂',copy:'⧉','paste-original':'▣',repeat:'↻',split:'✂',duplicate:'⧉',reverse:'⇄',normalize:'↥',
    'event-gain':'↕','event-delete':'×','event-rename':'✎','event-loop':'⟲','export-selection':'⇥',
    'event-split-click':'✂','mute-event':'M','lock-event':'⬒','open-event-editor':'▤','event-find-pool':'⊙',
    'event-open-expression':'⌁','fade-both':'◢','reset-fades':'⊘',crossfade:'⋈','detect-stops':'⋮',
    'slip-left':'←','slip-right':'→',merge:'⇉',
    'global-edit':'✎','global-locate':'↦','global-loop':'⟲','global-select':'▣','global-delete':'×','global-apply':'↳',
    'part-quantize':'▥','part-transpose':'↕','part-velocity':'▂','part-humanize':'♧',
    'note-cut':'✂','note-copy':'⧉','note-paste':'▣','note-duplicate':'⧉','note-delete':'×',
    'note-quantize':'▥','note-velocity':'▂','note-up-oct':'↑','note-down-oct':'↓','note-legato':'⌒',
    'note-staccato':'♪','note-length':'↔','note-humanize':'♧','note-reverse':'⇄','note-mute':'M'
  };
  function contextButtons(rows){
    return rows.map(([id,label])=>{
      const action=id.startsWith('@'), key=action?id.slice(1):id;
      const keyboardCommand={'note-cut':'cut','note-copy':'copy','note-paste':'paste','note-paste-original':'paste-original',
        'note-duplicate':'repeat','note-delete':'delete','note-quantize':'quantize','note-all':'all',
        'note-invert-selection':'invert-selection','note-mute':'mute-event','global-delete':'delete'}[key]||key;
      const shortcut=Object.hasOwn(commandList,keyboardCommand)?commandKey(keyboardCommand):'';
      return '<button type="button" '+(action?'data-action':'data-cmd')+'="'+key+'"><span class="context-icon" aria-hidden="true">'+
        (menuGlyphs[key]||globalKinds[key.slice(12)]?.glyph||'◇')+'</span><span>'+esc(label)+'</span>'+
        (shortcut?'<kbd>'+esc(shortcut)+'</kbd>':'')+'</button>';
    }).join('');
  }
  function hideContext(restoreFocus=false){
    const menu=sharedContext;
    if(!menu||menu.hidden)return;
    menu.hidden=true;delete menu.dataset.mode;
    $('global-tracks').setAttribute('aria-expanded','false');
    if(menu.ownerDocument!==document)document.body.append(menu);
    if(restoreFocus===true)contextFocus?.focus({preventScroll:true});
    contextFocus=null;
  }
  function showContext(x,y,items,owner=document){
    const menu=sharedContext;
    contextFocus=owner.activeElement;
    (owner.fullscreenElement||owner.body).append(menu);
    const viewport=owner.defaultView||window;
    menu.innerHTML=items.map(([heading,rows])=>'<section class="context-section"><strong>'+esc(heading)+'</strong>'+contextButtons(rows)+'</section>').join('');menu.hidden=false;
    menu.style.left=Math.max(4,Math.min(x,viewport.innerWidth-menu.offsetWidth-6))+'px';
    menu.style.top=Math.max(4,Math.min(y,viewport.innerHeight-menu.offsetHeight-6))+'px';
    menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function bindKeys(){
    $('qwerty').onclick=()=>setKeyboard(!qwerty);
    $('octave-down').onclick=()=>{qOctave=Math.max(0,qOctave-1);renderKeys();};
    $('octave-up').onclick=()=>{qOctave=Math.min(8,qOctave+1);renderKeys();};
    $('key-velocity').oninput=e=>{qVelocity=Number(e.target.value);$('key-vel-label').value=qVelocity;};
    $('key-pads').addEventListener('pointerdown',event=>{
      const el=event.target.closest('[data-key-pad]');
      if(!el||event.button!==0) return;
      el.setPointerCapture(event.pointerId);keyboardNote(el.dataset.keyPad);
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture']){
      $('key-pads').addEventListener(type,event=>{const id=event.target.dataset.keyPad;if(id)midiInputStop(id);});
    }
    $('command-search').oninput=commandRows;
    $('command-search').addEventListener('keydown',event=>{
      if(event.key!=='Enter') return;
      event.preventDefault();$('commands').querySelector('[data-cmd]')?.click();
    });
    $('keymap-reset').onclick=()=>{keyMap={};keyAliases={};rebinding=null;remember('sw-keymap',keyMap);remember('sw-keymap-aliases',keyAliases);commandRows();};
    $('keymap-export').onclick=()=>download(JSON.stringify(keyMap,null,2),'Sonoravell shortcuts.json','application/json');
    $('keymap-import').onclick=()=>$('shortcut-file').click();
    $('shortcut-file').onchange=run(async e=>{
      const file=e.target.files[0];e.target.value='';
      if(!file) return;
      const parsed=await SW.readKeyFile(file);
      if(parsed.rows){
        const report=SW.remapStudioCommands(parsed.rows,commandList,keyMap);
        keyImportReport=report;
        const changes=report.mapped.map(row=>'<tr><td>'+esc(row.name)+'</td><td>'+esc(row.key||'Cleared')+'</td></tr>').join('');
        const list=(title,items)=>items?.length?'<details><summary>'+esc(title)+' ('+items.length+')</summary><ul>'+
          items.map(item=>'<li>'+esc((item.category?item.category+' · ':'')+item.name+(item.key?' · '+item.key:''))+'</li>').join('')+'</ul></details>':'';
        $('key-report-body').innerHTML='<div class="key-report"><p>'+report.mapped.length+' mapped · '+report.skipped.length+
          ' unmatched · '+report.conflicts.length+' conflicts</p><div class="key-report-table"><table class="browser-table"><tbody>'+changes+
          '</tbody></table></div>'+list('Unmatched commands or keys',report.skipped)+list('Conflicting bindings',report.conflicts)+
          '<footer>'+button('keyscheme-apply','Apply keymap','Apply imported shortcuts',report.mapped.length?'class="accent"':'disabled')+'</footer></div>';
        $('keyscheme-report').showModal();
        return;
      }
      const obj=parsed.json;
      if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('Select a shortcut map.');
      const seen=new Set();
      const accepted={};
      for(const [key,value] of Object.entries(obj)){
        if(!Object.hasOwn(commandList,key)||typeof value!=='string'||value.length>48||value&&!SW.convertKey(value)) throw Error('Invalid shortcut map.');
        accepted[key]=value?SW.convertKey(value):'';
      }
      for(const key of Object.keys(commandList)){
        const chord=accepted[key]??commandList[key][1];
        if(chord&&seen.has(chord)) throw Error('A shortcut is assigned to more than one command.');
        if(chord) seen.add(chord);
      }
      keyMap=accepted;keyAliases={};remember('sw-keymap',keyMap);remember('sw-keymap-aliases',keyAliases);commandRows();
    });
    panels.listen(document,'keyup',event=>{
      syncToolModifier(event);workspacePages.releaseNote(event.code);if(keyboardHeld.has(event.code))midiInputStop(event.code);
    });
    panels.listen(document,'pointermove',syncToolModifier);
    panels.listen(window,'blur',()=>syncToolModifier());
    panels.listen(window,'blur',releaseKeyboard);
    panels.listen(document,'visibilitychange',()=>{if(document.hidden)releaseKeyboard();});
    panels.listen(document,'keydown',event=>{
      syncToolModifier(event);
      if(event.defaultPrevented||event.isComposing||event.target.closest?.('#track-window'))return;
      if(timelineLoopKey(event)||waveFadeKey(event)||velocityLaneKey(event))return;
      if(event.repeat) return;
      const target=event.target, editing=target.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
      if(studioMenu.handleKey(event)){event.preventDefault();return;}
      if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){
        const rect=target.getBoundingClientRect();
        if(openObjectMenu(target,rect.left,rect.bottom,target.ownerDocument)){event.preventDefault();return;}
      }
      if(!sharedContext.hidden&&target.closest('#context-menu')){
        const menuItems=[...sharedContext.querySelectorAll('button:not(:disabled)')];
        if(event.key==='Escape'){event.preventDefault();hideContext(true);return;}
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
          event.preventDefault();
          const index=menuItems.indexOf(target);
          menuItems[(index+(event.key==='ArrowDown'?1:-1)+menuItems.length)%menuItems.length]?.focus();
          return;
        }
      }
      if(event.key==='Escape'&&target.ownerDocument?.querySelector('.panel-maximized')){panels.closeFullscreen(target.ownerDocument.querySelector('.panel-maximized'));toggleWindowLabels();resizeDockView();return;}
      const chord=keyChord(event);
      if($('keyscheme-report').open)return;
      if($('command-dialog').open){
        if(!rebinding) return;
        if(['Control','Alt','Meta','Shift'].includes(event.key)) return;
        event.preventDefault();
        if(event.key==='Escape'){rebinding=null;commandRows();return;}
        if(chord==='Delete'){status('Delete is reserved for the focused item.',true);return;}
        const old=Object.keys(commandList).find(id=>id!==rebinding&&commandKey(id)===chord);
        if(old) keyMap[old]='';
        delete keyAliases[rebinding];
        for(const id of Object.keys(keyAliases))keyAliases[id]=keyAliases[id].filter(key=>key!==chord);
        keyMap[rebinding]=chord;rebinding=null;remember('sw-keymap',keyMap);remember('sw-keymap-aliases',keyAliases);commandRows();return;
      }
      if(editing||target.closest?.('.rotary')&&/^(Arrow|Home$|End$)/.test(event.key)) return;
      const dialog=document.querySelector('dialog[open]');
      if(dialog){
        if(['plugin-dialog','session-view-dialog'].includes(dialog.id)&&!graphDrag&&!dialDrag&&['Ctrl+Z','Ctrl+Shift+Z','Ctrl+Y'].includes(chord)){
          event.preventDefault();undoEdit(chord!=='Ctrl+Z');return;
        }
        if(chord==='Delete'&&target.closest?.('[data-action="macro-delete"]')){
          event.preventDefault();doAction(target.closest('[data-action="macro-delete"]'));
        }
        return;
      }
      const id=Object.keys(commandList).find(key=>commandKey(key)===chord)||
        Object.keys(commandList).find(key=>keyAliases[key]?.includes(chord));
      if(workspacePages.keys(event,id,chord))return;
      if(chord==='Delete'){
        event.preventDefault();
        if(dockOpen&&tab==='routing'&&target.closest?.('#lower-workspace')&&patchPanel.key(event,true))return;
        command('delete',target);
        return;
      }
      if(!id&&(chord==='Ctrl+Z'||chord==='Ctrl+Shift+Z')){event.preventDefault();undoEdit(chord==='Ctrl+Shift+Z');return;}
      if(id==='undo'||id==='redo'){event.preventDefault();command(id,target);return;}
      if(dockOpen&&tab==='routing'&&target.closest?.('#lower-workspace')&&patchPanel.key(event,id==='delete')){
        event.preventDefault();return;
      }
      if(id==='snap-toggle'&&!canUseSnap(target))return;
      if(id&&noteScopeCommand(id,target)){event.preventDefault();return;}
      if(id?.startsWith('note-')&&clipboardScope(target).kind==='notes'&&!isEditing()){
        event.preventDefault();command(id,target);return;
      }
      if(id==='keyboard'||id==='delete'){
        event.preventDefault();command(id,target);return;
      }
      const keyTrack=keyTarget();
      if(qwerty&&keyTrack&&!keyTrack.instrumentDisabled&&!['off','external'].includes(keyTrack.sourceInput)&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey){
        if(Object.hasOwn(SW.noteKeys,event.code)){event.preventDefault();keyboardNote(event.code);return;}
        if(event.code==='KeyZ'||event.code==='KeyX'){
          qOctave=clamp(qOctave+(event.code==='KeyZ'?-1:1),0,8);renderKeys();return;
        }
        if(event.code==='KeyC'||event.code==='KeyV'){
          qVelocity=clamp(qVelocity+(event.code==='KeyC'?-8:8),1,127);renderKeys();return;
        }
      }
      if(chord==='Space'&&target.matches('button')) return;
      if(id){event.preventDefault();command(id,target);return;}
      if(event.key==='Enter'&&target.matches('[data-action],[data-track],[data-clip]')){event.preventDefault();target.click();}
    });
  }
  let lastSnapGrid='.5';
  function setSnap(value,announce=false){
    const grid=$('snap');
    snap=value==='bar'?'bar':Number(value);
    if(snap)lastSnapGrid=String(value);
    grid.value=String(value);
    $('snap-toggle').setAttribute('aria-pressed',Boolean(snap));
    if(announce)status(snap?'Snap on · '+(grid.selectedOptions[0]?.textContent||value):'Snap off');
  }
  function toggleSnap(){
    if(!isEditing())setSnap(snap?'0':lastSnapGrid,true);
  }
  function canUseSnap(target){
    return !target.closest?.('.inspector,#browser-workspace,.transport,#context-menu,.studio-menu,.studio-menu-popup')&&
      (!target.closest?.('#lower-workspace')||['edit','automation'].includes(tab));
  }
  const focusedRemoval=[
    ['[data-send]','send-remove'],['[data-cue-route]','cue-remove'],
    ['[data-legacy-send]','legacy-send-remove'],['[data-asset]','remove-asset'],
    ['[data-inline-cue]','cue-delete']
  ];
  function deleteFocused(target){
    const action=target?.closest?.('[data-action]');
    if(['delete-scene','cue-delete','clear-lane','macro-delete'].includes(action?.dataset.action)){
      doAction(action);return true;
    }
    for(const [selector,action] of focusedRemoval){
      const el=target?.closest?.(selector);
      if(!el)continue;
      doAction({dataset:{action},closest:selector=>el.closest(selector)});
      return true;
    }
    const direct=readEditorFocus(target);
    if(!direct&&(target?.closest?.('#browser-workspace,#lower-workspace,#context-menu,.transport,[data-loop-editor]')))return true;
    const scope=clipboardScope(target);
    switch(scope.kind){
      case 'global': {
        if(scope.id&&visibleGlobals.has(scope.lane))deleteGlobalItem(scope.lane,globalItem(scope.lane,scope.id));
        return true;
      }
      case 'notes':
        includeFocusedNote(scope);noteClipboardAction('note-delete');return true;
      case 'expression':case 'automation': {
        const expression=scope.kind==='expression', owner=expression?foundClip(scope.clip)?.c:channelById(scope.track);
        const points=expression?owner?.expression?.[scope.lane]:owner?.lanes?.[scope.lane];
        const index=points?.findIndex(point=>point.at===scope.at)??-1;
        if(index>=0&&!owner.locked){
          editorFocus={...scope,at:undefined};
          edit(()=>points.splice(index,1),expression?'Removed MIDI controller point':'Removed automation point');
        }
        return true;
      }
      case 'insert': {
        const track=channelById(scope.track), insert=track?.fx.find(e=>e.id===scope.id);
        if(insert){editorFocus={kind:'insert',track:track.id};edit(()=>SW.removeEffect(track,insert.id),track.name+' · Removed '+insert.type);}
        return true;
      }
    }
    // A channel header is never an implicit request to remove a track or its events.
    if(target?.closest?.('.track-head,.console-strip,[data-track]:not([data-lane])')&&!target.closest('[data-clip]'))return true;
    const event=target?.closest?.('[data-clip]'), row=event&&foundClip(event.dataset.clip);
    if(row&&!editRange&&!selectedClips().some(({c})=>c===row.c))selectClip(row.t,row.c,false);
    return false;
  }
  function setSessionControl(id,fn,restart=true){
    $(id).addEventListener('change',()=>{
      if(busy||pendingRecord||recorder||midiTake){render();return;}
      const value=$(id).value;
      if($(id).type==='number'&&(!value||!Number.isFinite(Number(value)))){render();return;}
      const previous=before();fn(value);
      commit(previous,id==='bpm'?valueStatus('','Tempo',p.bpm,'BPM'):valueStatus('','Time signature',p.meter+'/4'),restart);
    });
  }
  function pointerBeat(el,event){
    const raw=(event.clientX-el.getBoundingClientRect().left)/zoom;
    return clamp(event.shiftKey&&editTool==='range'?raw:sn(raw),0,99999);
  }
  function bind(){
    $('device-art-file').onchange=run(async event=>{
      const file=event.target.files[0], target=artworkTarget;
      event.target.value='';artworkTarget=null;
      await importDeviceArt(file,target);
    });
    $('macro-arrange-toggle').onclick=()=>command('arrange-macros');
    $('macro-file').onchange=run(async event=>{
      const file=event.target.files[0];event.target.value='';
      if(!file)return;
      try{
        if(file.size>300000)throw Error('Macro file is too large.');
        const data=JSON.parse(await file.text());
        if(!['Sonoravell Macros','Soundweave Macros'].includes(data.format)||data.version!==1||!Array.isArray(data.macros)||macroList.length+data.macros.length>100)
          throw Error('Choose a Sonoravell macro library with up to 100 combined entries.');
        const items=data.macros.map(item=>({...SW.validateMacro(item),id:uid()}));
        macroList.push(...items);remember('sw-macros',macroList);
        renderMacroOrganizer();redrawMacroToolbars();$('macro-message').textContent='Imported '+items.length+' macros.';
      }catch(error){$('macro-message').textContent=error.message;}
    });
    $('meter').innerHTML=Array.from({length:11},(_,i)=>option(i+2,(i+2)+'/4',4)).join('');
    $('open-file').onchange=run(async e=>{const file=e.target.files[0];e.target.value='';await workspacePages.openPortable(file);});
    $('export-dialog').querySelector('form').addEventListener('submit',async event=>{
      if(event.submitter?.id!=='confirm-export') return;
      event.preventDefault();
      if(isEditing()) return;
      let folder;
      try{
      if($('export-folder').checked&&!$('export-folder').disabled){
        try{folder=await window.showDirectoryPicker({mode:'readwrite'});}
        catch(e){if(e.name==='AbortError')return;throw e;}
      }
      const keep=$('export-stay').checked;
      $('confirm-export').disabled=true;
        await exportSession(folder);
        if(!keep) $('export-dialog').close();
      }catch(e){report(e);}finally{$('confirm-export').disabled=false;}
    });
    for(const id of ['export-format','export-range','export-from','export-to','export-codecs','export-peak','export-loudness','export-layout']){
      $(id).addEventListener('change',updateExportUI);
    }
    $('stem-mode').onchange=()=>renderStemSources();
    $('stem-all').onclick=()=>renderStemSources(true);
    $('stem-none').onclick=()=>renderStemSources(false);
    $('help').onclick=()=>$('help-dialog').showModal();
    $('input-dialog').addEventListener('close',()=>{if($('input-dialog').returnValue==='set'){
      const t=SW.findTrack(p,inputTarget), control=$('input-device');
      if(t&&!isEditing())edit(()=>{
        if(control.value){t.inputDevice=control.value;t.inputLabel=control.selectedOptions[0]?.textContent||'';}
        else{delete t.inputDevice;delete t.inputLabel;}
      },t.name+' · Input '+(control.selectedOptions[0]?.textContent||'Default'),false);
      if(t&&audioMonitors.has(t.id)&&!isEditing()){
        releaseAudioMonitor(t.id);monitoring.add(t.id);run(enableAudioMonitor)(t);
      }
    }});
    $('back').onclick=()=>{if(!isEditing())seek(0);};
    $('previous-marker').onclick=()=>stepMarker(-1);
    $('next-marker').onclick=()=>stepMarker(1);
    $('back-bar').onclick=()=>{if(!isEditing())seek(playhead-p.meter);};
    $('forward-bar').onclick=()=>{if(!isEditing())seek(playhead+p.meter);};
    $('loop-selection').onclick=()=>command('range-loop');
    $('audio-device').onclick=()=>command('settings-audio');
    $('stop').onclick=stopAction;
    $('play').onclick=run(()=>live||recorder||midiTake||pendingRecord?stopAction():startPlayback());
    $('record').onclick=run(beginRecord);
    $('click').onclick=()=>{if(!busy)edit(()=>{p.click=!p.click;},p.click?'Metronome off':'Metronome on');};
    $('loop').onclick=()=>{if(!busy&&!recorder&&!midiTake)edit(()=>{p.loop=!p.loop;},p.loop?'Loop off':'Loop on');};
    $('midi-in').onclick=run(enableMidi);
    $('undo').onclick=()=>undoEdit();$('redo').onclick=()=>undoEdit(true);
    bindInsertTrack();
    $('import-files').onchange=run(async e=>{const files=[...e.target.files];e.target.value='';await importFiles(files,sn(playhead));});
    $('sample-file').onchange=run(async e=>{
      const file=e.target.files[0];e.target.value='';
      const target=sampleTarget;
      if(!file||busy||recorder||midiTake||pendingRecord) return;
      busy=true;
      try{
        const entry=await decodeAsset(await file.arrayBuffer(),file.name);
        const t=p.tracks.find(row=>row.id===target);
        if(!t) return;
        edit(()=>{registerAsset(entry);t.sample=entry.id;SW.placeInstrument(t,'Sampler');},'Loaded sampler audio');
      }finally{busy=false;}
    });
    $('toggle-inspector').onclick=()=>{
      panelCollapsed=!panelCollapsed;
      document.body.classList.toggle('inspector-closed',panelCollapsed);
      const inspector=$('toggle-inspector'), label=panelCollapsed?'Show Inspector (F4)':'Hide Inspector (F4)';
      inspector.textContent=panelCollapsed?'›':'‹';inspector.title=label;
      inspector.setAttribute('aria-expanded',!panelCollapsed);inspector.setAttribute('aria-label',label);
    };
    bindGlobalTracks();
    $('snap-toggle').onclick=toggleSnap;
    $('snap').onchange=()=>setSnap($('snap').value,true);
    $('zoom').oninput=()=>{
      const old=zoom, grid=$('arrange-scroll'), anchor=grid.scrollLeft/old;
      zoom=Number($('zoom').value);renderArrangement();if(tab!=='mixer')renderDock();updatePosition();
      grid.scrollLeft=anchor*zoom;$('zoom-display').textContent=zoom+' px/beat';
    };
    setSessionControl('bpm',value=>{p.bpm=clamp(Number(value),30,320);});
    setSessionControl('meter',value=>{p.meter=clamp(Math.round(Number(value)),2,12);});
    setLocator('loop-start',true);setLocator('loop-end',false);
    panels.listen(document,'click',event=>{
      const target=event.target, action=target.closest('[data-action]');
      const cmd=target.closest('[data-cmd]'), bind=target.closest('[data-bind]');
      if(!target.closest('#context-menu')&&target.id!=='global-tracks')hideContext();
      const focus=readEditorFocus(target);
      if(focus)setEditorFocus(focus);
      if(expressionClick(event))return;
      if(cmd){
        const row=cmd.closest('.edit-controls-inside')&&editorRow();
        if(row&&cmd.dataset.cmd!=='quantize'&&!/^(note-|all$|select-|invert-selection$|clear-selection$|.*range)/.test(cmd.dataset.cmd)&&
          activeClip()!==row.c){selectClip(row.t,row.c,false);renderSelections();renderInspector();}
        command(cmd.dataset.cmd);return;
      }
      if(bind){rebinding=bind.dataset.bind;commandRows();return;}
      if(action){if(target.closest('#context-menu'))hideContext();doAction(action,event);return;}
      if(target.id==='editor-wave'){
        const rect=target.getBoundingClientRect(), c=editorClip();
        if(c)seek(c.start+(event.clientX-rect.left)/rect.width*c.length);
        return;
      }
      const tabButton=target.closest('[data-tab]');
      if(tabButton){setTab(tabButton.dataset.tab,true);return;}
      if(target.closest('input,select,[data-note],[data-envelope],[data-roll]')) return;
      const annotation=target.closest('[data-global-id]');
      if(annotation){
        const item=globalItem(annotation.dataset.globalKind,annotation.dataset.globalId);
        if(item)seek(item.at);
        return;
      }
      if(target.closest('[data-loop-editor]'))return;
      const ruler=target.closest('[data-ruler]');
      if(ruler){
        if(event.shiftKey&&!busy&&!pendingRecord&&!recorder&&!midiTake){
          const at=pointerBeat(ruler,event);
          setTimelineLoop(SW.loopBounds('draw',0,0,at,playhead),true);
        }else seek(pointerBeat(ruler,event));
        return;
      }
      const eventEl=target.closest('[data-clip]');
      if(eventEl){return;}
      const track=target.closest('[data-track]');
      if(track?.matches('[data-lane]')&&prefs.locateEmpty&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&editTool==='arrow'&&!isEditing())
        seek(pointerBeat(track,event));
      if(track)selectTrack(track.dataset.track,true,event.ctrlKey||event.metaKey);
    });
    panels.listen(document,'dblclick',event=>{
      if(performance.now()<noDoubleBefore||isEditing()) return;
      const roll=event.target.closest('[data-roll]');
      if(roll&&noteTools==='arrow'&&!event.target.closest('[data-note]')){
        const c=editorClip();
        if(!c||c.locked)return;
        const point=pianoPointer(roll,event), length=Math.min(c.length,notesGrid()||.25);
        if(point.at<=c.length)addPianoNote(c,{pitch:notePitch(point.pitch),start:clamp(noteTime(point.at,event.shiftKey),0,c.length-length),length});
        return;
      }
      const type=event.target.closest('[data-loop-window]');
      if(type){setTimelineLoop([p.loopStart,p.loopEnd],!p.loop);return;}
      const annotation=event.target.closest('[data-global-lane]');
      if(annotation){
        const target=event.target.closest('[data-global-id]');
        const kind=annotation.dataset.globalLane, item=target&&globalItem(kind,target.dataset.globalId);
        openGlobalEntry(kind,item?.at??pointerBeat(annotation,event),item);return;
      }
      const name=event.target.closest('.console-channel-name');
      if(name){name.readOnly=false;name.select();return;}
      const slider=event.target.closest('[data-param]');
      if(slider&&['volume','pan'].includes(slider.dataset.param)){
        slider.value='0';changeParam(slider,true);return;
      }
      const eventEl=event.target.closest('[data-clip]');
      if(eventEl){
        const row=foundClip(eventEl.dataset.clip);
        if(row&&editTool==='arrow'){selectClip(row.t,row.c,false);setTab('edit');}
        return;
      }
      const lane=event.target.closest('[data-lane]');
      const t=p.tracks.find(row=>row.id===lane?.dataset.lane);
      if(t?.type==='midi'&&editTool==='arrow'){
        edit(()=>newMidiClip(t,pointerBeat(lane,event)),'Created instrument clip');setTab('piano');
      }
    });
    panels.listen(document,'contextmenu',event=>{
      const pt=event.target.closest('[data-point]');
      if(openObjectMenu(event.target,event.clientX,event.clientY,event.target.ownerDocument)){event.preventDefault();return;}
      if(!pt||isEditing())return;
      event.preventDefault();
      const t=currentTrack();
      if(t.lanes[autoKey]?.[Number(pt.dataset.point)])
        edit(()=>t.lanes[autoKey].splice(Number(pt.dataset.point),1),'Removed automation point');
    });
    panels.listen(document,'focusout',event=>{
      const name=event.target.closest?.('.console-channel-name');
      if(name)name.readOnly=true;
    });
    panels.listen(document,'keydown',event=>{
      const name=event.target.closest?.('.console-channel-name');
      if(!name)return;
      if(event.key==='Enter'){
        event.preventDefault();
        if(name.readOnly){name.readOnly=false;name.select();}
        else name.blur();
      }
      if(event.key==='Escape'){event.preventDefault();name.value=channelById(name.closest('[data-track]')?.dataset.track)?.name||'';name.blur();}
    });
    panels.listen(document,'change',event=>{
      const t=event.target;
      if(t.dataset.change) changeValue(t);
      if(t.dataset.param&&!t.hasAttribute('data-gear-value')) changeParam(t,true);
    });
    panels.listen(document,'input',event=>{
      if(event.target.dataset.param&&!event.target.hasAttribute('data-gear-value'))changeParam(event.target,false);
      if(event.target.id==='browser-search'&&browserOpen){
        browserQuery=event.target.value;$('browser-results').innerHTML=browserResults();
      }
    });
    $('plugin-folder').onchange=e=>{populateLocalFolder(e.target.files);e.target.value='';};
    const dragFormat='application/x-soundweave-plugin';
    const trackFormat='application/x-soundweave-tracks';
    panels.listen(document,'dragstart',event=>{
      const header=event.target.closest('.track-head[data-track][draggable]');
      if(header){
        const ids=pickedTracks.has(header.dataset.track)?[...pickedTracks]:[header.dataset.track];
        event.dataTransfer.setData(trackFormat,JSON.stringify(ids));
        event.dataTransfer.effectAllowed='move';return;
      }
      const mixer=event.target.closest('[data-mixer-grab]');
      if(mixer){
        const value=$('mixer-pick-device').value, at=value.indexOf(':');
        event.dataTransfer.setData(dragFormat,JSON.stringify({kind:value.slice(0,at),name:value.slice(at+1)}));
        event.dataTransfer.effectAllowed='copy';return;
      }
      const row=event.target.closest('[data-item][draggable]');
      if(!row) return;
      event.dataTransfer.setData(dragFormat,JSON.stringify({kind:browserKind,name:row.dataset.item}));
      event.dataTransfer.effectAllowed='copy';
    });
    $('dock').addEventListener('dragover',event=>{
      if(event.target.closest('.strip')&&event.dataTransfer.types.includes(dragFormat))event.preventDefault();
    });
    $('dock').addEventListener('drop',run(event=>{
      const row=event.target.closest('.strip');
      if(!row||!event.dataTransfer.types.includes(dragFormat))return;
      event.preventDefault();
      const item=JSON.parse(event.dataTransfer.getData(dragFormat));
      applyBrowserItem(item.kind,item.name,SW.findTrack(p,row.dataset.track),false,{strict:true});
    }));
    panels.listen(document,'focusin',event=>{
      const focus=readEditorFocus(event.target);if(focus)setEditorFocus(focus);
    });
    panels.listen(document,'pointerdown',startGesture);
    panels.listen(window,'pointermove',moveGesture);
    panels.listen(window,'pointerup',finishGesture);panels.listen(window,'pointercancel',finishGesture);
    const arrange=$('arrange-scroll');
    arrange.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes(trackFormat)&&e.target.closest('[data-folder]')){e.preventDefault();e.dataTransfer.dropEffect='move';}
      else if(e.dataTransfer.types.includes('Files')||e.dataTransfer.types.includes(dragFormat)){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
    arrange.addEventListener('drop',run(async e=>{
      e.preventDefault();
      if(recorder||midiTake||pendingRecord) return;
      const lane=e.target.closest('[data-lane]'), head=e.target.closest('.track-head[data-track]');
      const target=SW.findTrack(p,lane?.dataset.lane||head?.dataset.track);
      const folder=e.target.closest('[data-folder]')?.dataset.folder;
      if(e.dataTransfer.types.includes(trackFormat)){
        const ids=JSON.parse(e.dataTransfer.getData(trackFormat));
        if(folder&&Array.isArray(ids))edit(()=>{
          for(const id of ids){const t=SW.findTrack(p,id);if(t)SW.setFolder(p,t,folder);}
        },'Moved tracks into folder');
        return;
      }
      if(e.dataTransfer.types.includes(dragFormat)){
        const item=JSON.parse(e.dataTransfer.getData(dragFormat));
        applyBrowserItem(item.kind,item.name,target,!target,{strict:true});
      }else await importFiles([...e.dataTransfer.files],lane?pointerBeat(lane,e):sn(playhead),target);
    }));
    bindKeys();bindStudioControls();patchPanel.bind();setTool('arrow');
    window.addEventListener('beforeunload',event=>{
      if(revision!==lastSave&&isDirty||workspacePages.dirty()){event.preventDefault();event.returnValue='';}
    });
  }
  let insertGeneration=0, generatedTrackName='';
  function setInsertTrackType(){
    const type=$('insert-type').value, folder=type==='folder', audio=type==='audio';
    $('insert-format-row').hidden=$('insert-device-row').hidden=!audio;
    $('insert-source-row').hidden=$('insert-instrument-row').hidden=type!=='midi';
    $('insert-output-row').hidden=$('insert-fx-row').hidden=folder;
    $('insert-folder-row').hidden=!folder||![...pickedTracks].some(id=>SW.timelineTrack(channelById(id)||p.master));
    const name=$('insert-name');
    if(!name.value||name.value===generatedTrackName)
      name.value=generatedTrackName=typeLabel({type})+' '+((folder?SW.folders(p).length:p.tracks.filter(t=>t.type===type&&SW.timelineTrack(t)).length)+1);
    updateInsertInstrument();
  }
  function updateInsertInstrument(){
    const reused=$('insert-type').value==='midi'&&$('insert-instrument').value.startsWith('retained:');
    const count=$('insert-count');
    if(reused)count.value='1';
    count.readOnly=reused;
  }
  async function listTrackInputs(generation){
    const devices=await navigator.mediaDevices?.enumerateDevices?.()||[];
    if(generation!==insertGeneration)return;
    const input=$('insert-device'),previous=input.value;
    input.innerHTML=option('','Audio Setup default',previous)+devices.filter(d=>d.kind==='audioinput'&&d.deviceId&&d.deviceId!=='default')
      .map((d,i)=>option(d.deviceId,d.label||'Input '+(i+1),previous)).join('');
  }
  function openInsertTrack(type='audio'){
    if(isEditing())return;
    const panel=$('track-window'), dialog=$('track-insert-dialog');
    if(panels.detached(panel)){panels.focus(panel);return;}
    const generation=++insertGeneration;
    $('insert-type').value=type;
    $('insert-name').value='';
    $('insert-count').value='1';
    $('insert-format').value='1';$('insert-source').value='all';$('insert-group').checked=false;
    $('insert-color').value=channel('New','audio',p.tracks.length).color;
    $('insert-auto-color').checked=prefs.autoColors;
    $('insert-color').disabled=prefs.autoColors;
    $('insert-instrument').innerHTML=Object.keys(instruments).map(name=>option(name,name,'Keys')).join('')+
      p.tracks.filter(t=>t.instrumentOnly&&!t.instrumentDisabled).map(t=>option('retained:'+t.id,t.name+' · Loaded')).join('');
    $('insert-instrument').value='Keys';
    $('insert-device').innerHTML=option('','Audio Setup default','');$('insert-device').value='';
    $('insert-output').innerHTML=option('master','Master','master')+p.tracks.filter(t=>t.type==='bus').map(t=>option(t.id,t.name)).join('');
    $('insert-output').value='master';
    $('insert-fx').innerHTML=option('','None','')+Object.keys(SW.presets).map(name=>option('factory:'+name,name)).join('')+
      acceptedConsolePresets.map((preset,i)=>option('user:'+i,preset.name+' · User')).join('');
    $('insert-fx').value='';
    $('insert-message').textContent='';setInsertTrackType();
    if(!dialog.open&&!panels.detach(panel,'Insert Track',{width:510,height:382}))dialog.showModal();
    $('insert-name').focus();$('insert-name').select?.();
    listTrackInputs(generation).catch(()=>{});
  }
  function closeInsertTrack(){
    insertGeneration++;
    panels.attach($('track-window'));
    if($('track-insert-dialog').open)$('track-insert-dialog').close();
    $('insert-track').focus({preventScroll:true});
  }
  function insertTracks(spec){
    const {type,color,autoColor,group}=spec, count=Number(spec.count), name=spec.name.trim().slice(0,100);
    if(isEditing())throw Error('Finish recording or the current edit before inserting tracks.');
    if(!['folder','midi','audio'].includes(type)||!name||!Number.isInteger(count)||count<1||count>64||
      (!autoColor&&!/^#[0-9a-f]{6}$/i.test(color)))throw Error('Enter a track name, a valid color and a count from 1 to 64.');
    const folder=type==='folder';
    if(folder&&SW.folders(p).length+count>256)throw Error('A project can contain up to 256 folders.');
    if(!folder&&spec.output!=='master'&&channelById(spec.output)?.type!=='bus')throw Error('The selected output bus is unavailable.');
    const retained=type==='midi'&&spec.instrument.startsWith('retained:')?channelById(spec.instrument.slice(9)):null;
    if(type==='midi'&&!Object.hasOwn(instruments,spec.instrument)&&(!retained?.instrumentOnly||retained.instrumentDisabled||count!==1))
      throw Error('Select an available instrument or attach one loaded instrument at a time.');
    if(retained&&!validRoute(p,retained.id,spec.output,'out'))throw Error('This output would create a feedback loop.');
    const previous=before(), selected=[...pickedTracks], created=[], preset=spec.preset?consolePreset(spec.preset):null;
    for(let i=0;i<count;i++){
      const label=count===1?name:name+' '+(i+1);
      const shade=autoColor?channel(label,'audio',folder?SW.folders(p).length:p.tracks.length).color:color;
      if(folder){
        const row={id:uid(),name:label,collapsed:false,color:shade};
        (p.folders??=[]).push(row);
        if(i===0&&group)for(const id of selected){const t=channelById(id);if(t)SW.setFolder(p,t,row.id);}
        created.push(row);continue;
      }
      const t=retained||makeTrack(type,label);
      t.name=label;t.color=shade;t.out=spec.output;
      if(retained)delete t.instrumentOnly;
      if(type==='midi'){
        t.sourceInput=['all','qwerty','external','off'].includes(spec.source)?spec.source:'all';
        if(!retained)SW.placeInstrument(t,spec.instrument);
      }else{
        t.recordChannels=spec.format==='2'?2:1;t.mono=t.recordChannels===1;
        if(spec.device){t.inputDevice=spec.device;t.inputLabel=spec.deviceLabel||'Assigned input';}
      }
      if(preset)applyConsolePreset(t,preset.chain);
      created.push(t);
    }
    if(!folder){
      selectTrack(created[0].id,false);
      pickedTracks=new Set(created.map(t=>t.id));
    }
    commit(previous,'Inserted '+(count===1?name:count+' '+typeLabel({type}).toLowerCase()+' tracks · '+name));
    return created;
  }
  function bindInsertTrack(){
    $('insert-track').onclick=()=>openInsertTrack();
    $('insert-type').onchange=setInsertTrackType;
    $('insert-instrument').onchange=updateInsertInstrument;
    $('insert-auto-color').onchange=()=>{$('insert-color').disabled=$('insert-auto-color').checked;};
    $('insert-cancel').onclick=closeInsertTrack;
    $('insert-form').addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();closeInsertTrack();}
    });
    $('insert-form').addEventListener('submit',event=>{
      event.preventDefault();
      const device=$('insert-device');
      try{
        insertTracks({name:$('insert-name').value,count:$('insert-count').value,type:$('insert-type').value,
          color:$('insert-color').value,autoColor:$('insert-auto-color').checked,format:$('insert-format').value,
          device:device.value,deviceLabel:device.selectedOptions[0]?.textContent,source:$('insert-source').value,
          instrument:$('insert-instrument').value,output:$('insert-output').value,preset:$('insert-fx').value,group:$('insert-group').checked});
        closeInsertTrack();
      }catch(error){$('insert-message').textContent=error.message;}
    });
  }
  function folderAction(el){
    const folder=SW.folders(p).find(f=>f.id===el.closest('[data-folder]')?.dataset.folder);
    if(!folder)return false;
    switch(el.dataset.action){
      case 'folder-collapse':
        edit(()=>folder.collapsed=!folder.collapsed,undefined,false);return true;
      case 'folder-bus':
        if(folder.bus){selectTrack(folder.bus);setTab('mixer');}
        else edit(()=>{const bus=SW.folderBus(p,folder);selectTrack(bus.id,false);},'Routed '+folder.name+' to a mixer bus');
        return true;
      case 'folder-rename': {
        const name=prompt('Folder name',folder.name)?.trim().slice(0,100);
        if(name)edit(()=>{folder.name=name;const bus=SW.findTrack(p,folder.bus);if(bus)bus.name=name;},'Renamed folder',false);
        return true;
      }
      case 'folder-remove':
        edit(()=>{
          for(const t of SW.timelineTracks(p))if(t.folder===folder.id)SW.setFolder(p,t,'');
          p.folders=p.folders.filter(f=>f.id!==folder.id);
        },'Ungrouped tracks');return true;
    }
    return false;
  }
  function channelInput(t){
    if(t.type==='audio')return button('inputs',t.inputLabel||'System default input','Choose recording input');
    if(t.type==='midi'){
      return (!t.instrumentDisabled?'<div class="inspector-device-picture">'+gearArt(t.instrument,true)+'<strong>'+esc(t.instrument)+'</strong></div>':'')+select('source-input','MIDI source',[
        ['all','QWERTY + hardware'],['qwerty','QWERTY'],['external','Hardware MIDI'],['off','No live input']
      ].map(([id,label])=>option(id,label,t.sourceInput||'all')).join(''))+
      select('instrument','Instrument',(t.instrumentDisabled?'<option value="" selected>Choose instrument</option>':'')+
        Object.keys(instruments).map(name=>option(name,name,t.instrumentDisabled?null:t.instrument)).join(''))+
      (t.instrumentDisabled?'':button('gear-inst','Open instrument'))+field('transpose','Transpose',t.transpose,-36,36,1)+
      (t.instrument==='Sampler'?button('load-sample',p.assets[t.sample]?.name||'Load sampler audio'):'');
    }
    const incoming=p.tracks.filter(row=>row.out===t.id||SW.sendList(row).some(send=>send.to===t.id));
    return '<small class="muted-text">'+esc(incoming.length?incoming.map(row=>row.name).join(', '):'No connected channels')+'</small> '+button('show-patch','Edit connections');
  }
  function companionCue(){
    const cue=SW.cueSettings(p).find(c=>c.id===graphLabel);
    if(!cue)return '';
    return '<div class="route-detail">'+field('cue-name','Cue name',cue.name)+field('cue-volume','Cue fader',cue.volume,-60,6,.1)+
      toggle('cue-output-mute','Mute','Mute cue output',cue.mute)+button('cue-delete','Remove cue')+'</div>';
  }
  function sourceFader(t,key,label,min,max,step){
    return '<label>'+label+'<input type="number" aria-label="'+esc(label)+'" min="'+min+'" max="'+max+'" step="'+step+'" data-owner="'+t.id+'" data-param="'+key+'" value="'+laneValue(t,key)+'"></label>';
  }
  function deviceShelf(){
    if(!mixerDevices)return '';
    const entries=[...Object.keys(fx).map(name=>['effects',name]),...Object.keys(instruments).map(name=>['instruments',name])];
    return '<div class="patch-palette mixer-device-bar"><label>Device <select id="mixer-pick-device">'+entries.map(([kind,value])=>option(kind+':'+value,value)).join('')+'</select></label>'+
      '<button type="button" draggable="true" data-mixer-grab title="Drag onto a mixer channel or arrangement track">Drag device</button></div>';
  }
  let launcher={}, audioDevices=[];
  const reference=SW.createReferenceVideo({
    video:$('reference-video'),window:$('video-window'),title:$('video-name'),readout:$('video-time'),
    preferences:()=>prefs, location:()=>seconds(playhead,p.bpm), active:()=>Boolean(live),report
  });

  function applyPreferences(old,initial=false){
    const body=document.body;
    body.dataset.skinAccent=prefs.accent;body.dataset.trackDensity=prefs.density;
    const appearance={
      'high-contrast':prefs.contrast,'hide-event-names':!prefs.eventNames,
      'hide-grid':!prefs.barGrid,'hide-console-colors':!prefs.consoleColors,'lane-crosshair':prefs.crosshair,'touch-targets':prefs.touchTargets
    };
    for(const [name,on] of Object.entries(appearance)) body.classList.toggle(name,on);
    const audioExt='.wav,.aif,.aiff,.mp3,.m4a,.mp4,.aac,.flac,.ogg,.oga,.opus,.caf,.webm,.wma,.alac';
    $('import-files').accept=prefs.importTypes==='midi'?'.mid,.midi':(audioExt+(prefs.importTypes==='all'?',.mid,.midi':'')+',audio/*');
    if(initial||old.defaultSnap!==prefs.defaultSnap){
      setSnap(prefs.defaultSnap);
    }
    if(initial||old.defaultZoom!==prefs.defaultZoom) zoom=Number($('zoom').value=prefs.defaultZoom);
    if(old.octave!==prefs.octave) qOctave=prefs.octave;
    if(old.velocity!==prefs.velocity) qVelocity=prefs.velocity;
    if(old.keyboardOn!==prefs.keyboardOn) setKeyboard(prefs.keyboardOn);
    if(old.defaultWide!==prefs.defaultWide) mixerWide=prefs.defaultWide;
    if(old.defaultDevices!==prefs.defaultDevices) mixerDevices=prefs.defaultDevices;
    if(old.holdPeaks!==prefs.holdPeaks) mixerPeak.clear();
    if(old.autosave!==prefs.autosave||old.autosaveDelay!==prefs.autosaveDelay) autosave();
    if(old.midiInput!==prefs.midiInput||old.midiChannel!==prefs.midiChannel){
      for(const id of [...keyboardHeld.keys()]) if(id.startsWith('midi:')) midiInputStop(id,true);
      for(const voices of pedalVoices.values())for(const voice of voices)voice.release?.();
      pedalVoices.clear();hardwareControls.clear();
    }
    if(live&&(old.midiOutput!==prefs.midiOutput||old.midiClock!==prefs.midiClock)){
      stopMidiClock(live);startMidiClock(live);
    }
    if(old.scanSystem&&!prefs.scanSystem) browserPlugins=[];
    syncServices();
    if(old.localServices!==prefs.localServices&&prefs.localServices) run(refreshLocal)();
    if(old.videoFollow&&!prefs.videoFollow) $('reference-video').pause();
    reference.align(Boolean(live));
    if(!initial) render();
    const audioChanged=['sampleRate','latency','outputDevice'].some(id=>old[id]!==prefs[id]);
    $('preferences-save').textContent=audioChanged?'Audio device settings apply at the next start.':'Changes apply immediately.';
  }
  function storePreferences(next){
    const previous=prefs;
    prefs=next;
    let stored=true;
    try{localStorage.setItem('sw-preferences',JSON.stringify(prefs));}
    catch{stored=false;}
    applyPreferences(previous);
    if(!stored) $('preferences-save').textContent='Browser storage unavailable. Settings apply for this visit.';
  }
  function syncServices(){
    host=prefs.localServices?{
      ...launcher,formats:prefs.extendedEncoders?launcher.formats||[]:[],
      native:prefs.nativePlugins&&Boolean(launcher.native)
    }:{};
  }
  function availableDevices(id){
    const kinds={inputDevice:'audioinput',outputDevice:'audiooutput'};
    const devices=kinds[id]?audioDevices.filter(item=>item.kind===kinds[id]):
      [...((id==='midiInput'?midiAccess?.inputs:midiAccess?.outputs)?.values()||[])];
    const defaultName={inputDevice:'System default',outputDevice:'System default',midiInput:'All enabled inputs',midiOutput:'None'}[id];
    return [['',defaultName],...devices.filter(dev=>dev.deviceId!==''&&dev.deviceId!=='default'&&dev.state!=='disconnected')
      .map((dev,i)=>[dev.deviceId??dev.id,dev.label||dev.name||'Device '+(i+1)])];
  }
  async function refreshDevices(authorize=false){
    const devices=navigator.mediaDevices;
    if(!devices?.enumerateDevices) throw Error('Audio device discovery needs a supported browser and a local page.');
    if(authorize){
      const stream=await devices.getUserMedia({audio:true});
      try{audioDevices=await devices.enumerateDevices();}
      finally{stream.getTracks().forEach(track=>track.stop());}
    }else audioDevices=await devices.enumerateDevices();
    preferenceWindow.refresh();
  }
  async function chooseOutput(){
    const devices=navigator.mediaDevices;
    if(!devices?.selectAudioOutput) throw Error('This browser lists available outputs in the Playback output menu. Additional devices may require OS or browser permission.');
    const selected=await devices.selectAudioOutput();
    audioDevices=[...audioDevices.filter(device=>device.deviceId!==selected.deviceId),selected];
    storePreferences({...prefs,outputDevice:selected.deviceId});preferenceWindow.refresh();
  }
  function preferenceDetails(page){
    if(page==='device'&&prefs.outputDevice&&!audioDevices.some(item=>item.deviceId===prefs.outputDevice)) return 'The preferred output is currently unavailable. Choose System default if playback cannot start.';
    if(page==='device'||page==='processing'){
      if(!ctx) return 'Open playback to see the active engine rate and reported latency.';
      const latency=Number.isFinite(ctx.baseLatency)?' · '+fmt(ctx.baseLatency*1000,1)+' ms base latency':'';
      const output=Number.isFinite(ctx.outputLatency)?' · '+fmt(ctx.outputLatency*1000,1)+' ms output latency':'';
      return 'AudioContext · '+ctx.sampleRate+' Hz'+latency+output;
    }
    if(page==='midi-devices'||page==='sync') return midiAccess?
      midiAccess.inputs.size+' input(s) · '+midiAccess.outputs.size+' output(s) detected':'Enable MIDI devices to see connected ports.';
    if(page==='network'||page==='services') return !prefs.localServices?'Launcher connection disabled in Preferences.':
      !localHost?'Standalone browser mode. Start-Sonoravell.cmd enables optional local services.':
      'Local launcher · '+(host.formats?.length?'FFmpeg ready':'extended encoders unavailable')+' · '+(host.native?'native offline host ready':'native offline host unavailable');
    if(page==='user-data') return 'Projects save as .sonoravell files. Browser recovery and preferences are stored separately for this app origin.';
    if(page==='sound-sets'||page==='instruments') return sampleFolder.length?sampleFolder.length+' files linked from '+sampleFolderName+'.':'No linked sample folder.';
    if(page==='keys') return 'Ctrl+Z and Ctrl+Shift+Z remain available for undo and redo. Ctrl+click toggles selection.';
    return '';
  }
  const preferenceWindow=SW.createPreferenceWindow({
    dialog:$('preferences-dialog'),nav:$('preferences-nav'),tabs:$('preferences-tabs'),body:$('preferences-body'),profile:$('preferences-profile'),
    read:()=>prefs,selectSetting:(id,value)=>storePreferences({...prefs,[id]:value}),devices:availableDevices,details:preferenceDetails,action:preferenceAction,esc
  });
  function preferenceAction(id){
    const dialog=$('preferences-dialog');
    switch(id){
      case 'export-profile':
        download(JSON.stringify({format:'sonoravell-preferences',version:1,settings:prefs},null,2),'Sonoravell preferences.json','application/json');return;
      case 'import-profile':$('preferences-file').click();return;
      case 'reset-profile':
        if(confirm('Reset Sonoravell preferences to their default values?')){
          storePreferences(SW.preferences());preferenceWindow.refresh();
        }
        return;
      case 'refresh-audio':run(refreshDevices)();return;
      case 'allow-input':run(refreshDevices)(true);return;
      case 'choose-output':run(chooseOutput)();return;
      case 'enable-midi':run(enableMidi)();return;
      case 'scan-plugins':run(async()=>{await refreshLocal(true);status('Found '+browserPlugins.length+' installed plug-in(s).');})();return;
      case 'check-services':run(async()=>{await refreshLocal();preferenceWindow.refresh();})();return;
      case 'plugin-folder':$('plugin-folder').click();return;
      case 'choose-sample-folder':case 'clear-sample-folder':command(id);return;
    }
    dialog.close();command(id);
  }
  function startMidiClock(state){
    const port=prefs.midiClock&&prefs.midiOutput?midiAccess?.outputs.get(prefs.midiOutput):null;
    if(!port||port.state==='disconnected') return;
    state.clock={port,next:Math.max(ctx.currentTime,state.when),started:false};
    fillMidiClock(state);
  }
  function stopMidiClock(state){
    const clock=state.clock;
    if(!clock) return;
    state.clock=null;
    try{clock.port.clear();if(clock.started)clock.port.send([0xfc]);}catch{}
  }
  function fillMidiClock(state){
    const clock=state.clock;
    if(!clock) return;
    const now=ctx.currentTime, interval=state.beatSec/24;
    const limit=state.loop||state.recording?now+.09:Math.min(now+.09,state.firstEnd);
    if(clock.next<now) clock.next+=Math.ceil((now-clock.next)/interval)*interval;
    try{
      while(clock.next<limit){
        const when=performance.now()+Math.max(0,(clock.next-ctx.currentTime)*1000);
        if(!clock.started){clock.port.send([0xfa],when);clock.started=true;}
        clock.port.send([0xf8],when);
        clock.next+=interval;
      }
    }catch(e){state.clock=null;report(e);}
  }
  function setupPage(io){
    $('setup-io').hidden=!io;$('setup-general').hidden=io;
    $('setup-general-tab').setAttribute('aria-pressed',!io);$('setup-io-tab').setAttribute('aria-pressed',io);
  }
  function openSessionSetup(io){
    if(isEditing()) return;
    const dialog=$('session-setup-dialog');
    if(dialog.open){setupPage(io);return;}
    $('setup-name').value=p.name;$('setup-bpm').value=p.bpm;$('setup-artist').value=p.artist||'';
    $('setup-meter').innerHTML=Array.from({length:11},(_,i)=>option(i+2,(i+2)+'/4',p.meter)).join('');
    $('setup-layout').innerHTML=[option('stereo','Stereo',p.spatialMonitor||'stereo'),option('binaural','Binaural headphones',p.spatialMonitor)].join('');
    const current=p.monitorDisconnected?'__off':p.monitorCue||'';
    $('setup-monitor').innerHTML=[option('','Main',current),...SW.cueSettings(p).map(c=>option(c.id,c.name,current)),option('__off','Disconnected',current)].join('');
    $('setup-input').disabled=currentTrack().type!=='audio';setupPage(io);dialog.showModal();
  }
  function bindShell(){
    for(const id of ['preferences-close','preferences-done']) $(id).onclick=()=>$('preferences-dialog').close();
    $('preferences-file').onchange=run(async event=>{
      const file=event.target.files[0];event.target.value='';
      if(!file) return;
      if(file.size>1000000) throw Error('Preferences files must be smaller than 1 MB.');
      storePreferences(SW.readPreferenceProfile(JSON.parse(await file.text())));
      preferenceWindow.refresh();status('Imported Sonoravell preferences');
    });
    $('sample-folder').onchange=event=>{
      const files=[...event.target.files];event.target.value='';
      if(!files.length) return;
      sampleFolderName=(files[0].webkitRelativePath||files[0].name).split('/')[0];
      sampleFolder=files.filter(file=>mediaFolderTypes.test(file.name)).slice(0,2000)
        .map((file,id)=>({file,id,path:file.webkitRelativePath||file.name}));
      if($('preferences-dialog').open) preferenceWindow.refresh();else command('browse-samples');
      status('Linked '+sampleFolder.length+' audio or MIDI file(s)');
    };
    $('video-file').onchange=event=>{
      const file=event.target.files[0];event.target.value='';
      if(file) reference.load(file);
    };
    $('video-open').onclick=()=>$('video-file').click();
    $('video-close').onclick=reference.hide;
    $('video-play').onclick=reference.togglePlayback;
    $('video-prev').onclick=()=>reference.step(-1);
    $('video-next').onclick=()=>reference.step(1);
    $('video-clear').onclick=reference.clear;
    $('setup-general-tab').onclick=()=>setupPage(false);$('setup-io-tab').onclick=()=>setupPage(true);
    $('setup-input').onclick=()=>{$('session-setup-dialog').close();run(chooseInput)();};
    $('setup-patch').onclick=()=>{$('session-setup-dialog').close();setTab('routing');};
    $('session-setup-dialog').querySelector('form').addEventListener('submit',event=>{
      if(event.submitter?.value!=='apply') return;
      event.preventDefault();if(isEditing()) return;
      const monitor=$('setup-monitor').value;
      const name=$('setup-name').value.trim()||'Untitled session', bpm=Number($('setup-bpm').value);
      if(!Number.isFinite(bpm)||bpm<30||bpm>320){setupPage(false);$('setup-bpm').reportValidity();return;}
      edit(()=>{
        p.name=name;p.bpm=bpm;p.meter=Number($('setup-meter').value);p.artist=$('setup-artist').value.trim();
        p.spatialMonitor=$('setup-layout').value;p.monitorCue=monitor==='__off'?'':monitor;p.monitorDisconnected=monitor==='__off';
      },'Updated session setup');
      $('session-setup-dialog').close();
    });
  }
  function menuAvailable(id){
    const available=workspacePages?.available(id);
    if(available!==undefined)return available;
    const restricted=isEditing();
    if(id==='undo'||id==='redo') return !restricted&&(id==='undo'?history:redo).length>0;
    if(id==='fullscreen') return Boolean(document.fullscreenElement||document.documentElement?.requestFullscreen);
    if(['track-duplicate','track-remove','track-remove-complete','track-solo','track-arm'].includes(id))
      return !restricted&&trackId!=='master'&&(id!=='track-arm'||['audio','midi'].includes(currentTrack().type));
    if(id==='delete'){
      if(restricted)return false;
      const scope=clipboardScope();
      if(scope.kind==='global')return Boolean(scope.id&&visibleGlobals.has(scope.lane)&&globalItem(scope.lane,scope.id));
      if(scope.kind==='insert')return Boolean(channelById(scope.track)?.fx.some(e=>e.id===scope.id));
      if(scope.kind==='automation'||scope.kind==='expression')return scope.at!==undefined;
      if(scope.kind==='notes')return Boolean(noteId||notePicked.size||scope.id);
      return Boolean(editRange||selectedClips().length);
    }
    if(['paste','paste-original','copy','cut'].includes(id)){
      const scope=clipboardScope(), paste=id.startsWith('paste');
      if(restricted)return false;
      if(scope.kind==='notes')return paste?Boolean(noteClipboard.length):Boolean(editorClip()&&exactNotes(editorClip()).length);
      if(scope.kind!=='events')return paste?focusedClipboard.has(scope.kind):Boolean(scope.id||scope.at!==undefined);
      return paste?Boolean(multiClipboard.length):Boolean(editRange||selectedClips().length);
    }
    if(['split','duplicate','repeat','merge','quantize','align','mute-event','lock-event','nudge-left','nudge-right'].includes(id))
      return !restricted&&(selectedClips().length>0||Boolean(editRange));
    if(['normalize','reverse','detect-stops','fade-both','crossfade','reset-fades','slip-left','slip-right'].includes(id))
      return !restricted&&selectedClips().some(({c})=>c.type==='audio');
    if(['split-range','trim-range','delete-time','range-loop'].includes(id)) return !restricted&&Boolean(selectionRange());
    if(/^(?:new|demo|open|save|import-|export|session-|add-|track-|marker)/.test(id)) return !restricted;
    if(id==='stop') return Boolean(live||recorder||midiTake||starting||pendingRecord);
    return true;
  }
  function menuChecked(id){
    return {transport:Boolean(live),record:Boolean(recorder||midiTake||pendingRecord),loop:p.loop,click:p.click,inspector:!panelCollapsed,
      'snap-toggle':Boolean(snap),keyboard:qwerty,edit:dockOpen&&tab==='edit',mixer:dockOpen&&tab==='mixer',browser:browserOpen,automation:dockOpen&&tab==='automation',routing:dockOpen&&tab==='routing',
      'track-arm':armed.has(trackId),'track-mute':Boolean(currentTrack().mute),'track-solo':Boolean(currentTrack().solo),
      'video-panel':reference.visible(),'arrange-macros':arrangerMacros}[id];
  }

  const panels=SW.createPanelWindows({status,onChange:()=>{hideContext();reflectPanels();toggleWindowLabels();}});
  function graphTrackControls(t,open){
    const summary='<span>'+esc(typeLabel(t))+' · '+t.fx.length+' FX · '+(SW.sendList(t).length+SW.cueSends(t).length)+' sends</span>';
    const controls='<div class="patch-node-mix">'+compactDial(t,'trim','Gain')+compactDial(t,'pan','Pan')+compactDial(t,'volume','Level')+
      toggle('mute','M','Mute channel',t.mute)+toggle('mix-polarity','Ø','Invert input polarity',t.polarity)+'</div>';
    const routing=open?'<div class="patch-node-io">'+consoleInput(t)+consoleOutput(t)+
      (t.type==='midi'&&!t.instrumentDisabled?button('gear-inst',t.instrument,'Open instrument'):'')+'</div>':'';
    return '<div class="patch-node-body">'+summary+controls+routing+(open?consoleRacks(t,'graph'):'')+'</div>';
  }
  function graphCueControls(id,open){
    const cue=SW.cueSettings(p).find(row=>row.id===id);
    if(!cue)return '';
    return '<div class="patch-node-body" data-inline-cue="'+esc(id)+'"><span>Cue output'+(cue.disconnected?' · Disconnected':'')+'</span>'+
      '<div class="patch-node-mix">'+knob('cue-output','volume','Level',cue.volume,['Level',-60,6,.1,'dB'],id,0,false,true)+
      toggle('cue-output-mute','M','Mute cue output',cue.mute)+
      toggle('cue-output-patch','↔','Enable the cue signal path',!cue.disconnected)+'</div>'+
      (open?'<button type="button" data-patch-action="cue-editor">Cue settings</button>':'')+'</div>';
  }
  const patchPanel=SW.createPatchPanel({
    trackControls:graphTrackControls,cueControls:graphCueControls,
    listenWindow:(...args)=>panels.listen(window,...args),
    getProject:()=>p,getTrack:currentTrack,selectTrack,edit,refresh:renderDock,status,busy:isEditing,dock:$('dock'),esc,
    replace(next,message){const snapshot=before();p=next;commit(snapshot,message);},
    inspect:()=>{renderInspector();renderSelections();},
    openDevice:(t,id)=>pluginOpen(t,id?t.fx.find(e=>e.id===id):undefined),
    openSpatial:spatialOpen,
    openCue(id){graphLabel=id;renderDock();},
    cueDetail:companionCue,
    addTrack:type=>edit(()=>addTrack(type),'Added '+typeLabel({type}).toLowerCase()),
    addCue:()=>studioAction({dataset:{action:'cue-create'},closest:()=>null}),
    device:(...values)=>{try{applyBrowserItem(...values);}catch(error){report(error);}}
  });
  const studioMenu=SW.createStudioMenu({
    container:$('studio-menu'),popup:$('studio-menu-popup'),commands:commandList,shortcut:commandKey,
    execute:command,available:menuAvailable,checked:menuChecked,esc
  });
  async function storedWorkspace(key,value){
    const db=await database(), write=value!==undefined;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('workspace',write?'readwrite':'readonly'), store=tx.objectStore('workspace');
      const request=write?store.put(value,key):store.get(key);
      tx.oncomplete=()=>resolve(request.result);
      tx.onabort=tx.onerror=()=>reject(tx.error||request.error);
    });
  }
  workspacePages=SW.createWorkspacePages({
    $,status,report,download,command,read:readSettings,remember,settings:()=>prefs,
    put:storedWorkspace,get:storedWorkspace,canSwitch:()=>!isEditing(),audio:ensureAudio,enableMidi,
    decoder:()=>ctx||(ctx=SW.audioContext()),decode:decodeAsset,
    session:()=>({project:p,media,history,redo,dirty:isDirty,position:playhead,track:trackId,clip:clipId}),
    setSession(snapshot){
      replaceSession(snapshot.project,snapshot.media);
      ({history=[],redo=[],dirty:isDirty=false,position:playhead=0}=snapshot);
      if(snapshot.track)trackId=snapshot.track;
      if(snapshot.clip)clipId=snapshot.clip;
      render();
    },
    saveSession:saveProject,
    leaveSession(){
      if(isEditing())return false;
      stopPlayback();stopPreview();releaseKeyboard();closeAudioMonitors();reference.hide();
      panels.close();
      panels.closeFullscreen($('lower-workspace'));panels.closeFullscreen($('browser-workspace'));
      for(const id of ['plugin-dialog','spatial-dialog','session-setup-dialog'])if($(id).open)$(id).close();
      return true;
    },
    enterSession:render,
    async renderSession(){
      const snapshot=clone(p), source=media;
      const end=snapshot.tracks.reduce((max,t)=>t.clips.reduce((last,c)=>Math.max(last,c.start+c.length),max),0);
      if(!end)throw Error('The Session has no events to render.');
      const buffer=await SW.renderAudio(snapshot,source,{from:0,to:end,rate:48000,tail:prefs.tail,layout:'stereo'});
      return {id:uid(),buffer,bytes:SW.wav(buffer,24),name:snapshot.name,source:snapshot.name};
    },
    formats:()=>Object.fromEntries(Object.entries(exportNames).filter(([format])=>format==='wav'||host.formats?.includes(format))),
    encode:(audio,settings,tags)=>encodedAudio(audio,{...settings,artist:tags.artist,layout:'stereo',bitrate:320},tags.title,null,tags)
  });
  sessionViews=SW.createSessionViews({
    $,esc,edit,status,report,project:()=>p,selected:selectedClips,track:currentTrack,editor:editorRow,
    position:()=>playhead,seek,busy:isEditing,stop:stopPreview,
    async preview(snapshot,length){
      await ensureAudio();
      if(!$('session-view-dialog').open)return;
      stopPlayback();stopPreview();
      previewGraph=SW.buildGraph(ctx,snapshot,true);
      const when=ctx.currentTime+.028;
      try{SW.schedule(previewGraph,media,0,length,when);}
      catch(error){stopPreview();throw error;}
      previewMeters();previewTimer=setTimeout(stopPreview,(SW.seconds(length,snapshot.bpm)+prefs.tail)*1000+50);
    },
    channelView(){
      const t=currentTrack();
      return '<div class="session-view-toolbar" data-track="'+t.id+'"><strong>'+esc(t.name)+'</strong>'+
        consoleInput(t)+consoleOutput(t)+compactDial(t,'trim','Input Trim')+compactDial(t,'pan','Pan')+
        compactDial(t,'volume','Level')+toggle('mute','Mute','Mute channel',t.mute)+
        toggle('mix-polarity','Polarity','Invert input polarity',t.polarity)+
        '<div class="session-channel-racks">'+consoleRacks(t,'overview')+'</div></div>';
    },
    monitorView(){
      const audioBytes=[...media.values()].reduce((sum,entry)=>sum+(entry.bytes?.byteLength||0),0);
      return '<div class="session-view-toolbar"><strong>Audio engine</strong><span>'+esc(preferenceDetails('processing'))+
        '</span><span>'+fmt(audioBytes/1048576,1)+' MiB of source audio</span></div>'+
        '<div class="session-monitor-channels">'+[...p.tracks,p.master].map(t=>
          '<section data-track="'+t.id+'"><strong>'+esc(t.name)+'</strong><span>'+t.clips.length+' events</span>'+
          t.fx.map(e=>'<span data-fx="'+e.id+'">'+toggle('fx-bypass',e.type,'Toggle bypass',e.bypass)+'</span>').join('')+'</section>').join('')+'</div>';
    }
  });
  bind();bindShell();bindWorkspace();workspacePages.bind();sessionViews.bind();applyPreferences(prefs,true);setTab(tab);render();
  if(prefs.startup==='start')workspacePages.switchPage('start');
  else workspacePages.draw();
  if(!prefs.autosave) $('save-state').textContent='Autosave off';
  if(prefs.startup==='restore'||prefs.startup==='start') restore();
})();
