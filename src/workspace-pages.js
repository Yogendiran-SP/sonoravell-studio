'use strict';
Object.assign(SW, (() => {
  const {workspaceNames,workspaceSuffix,workspaceTemplates,workspaceViews,clamp,clone,uid}=SW;
  function createWorkspacePages(api){
    const {$,status,report}=api;
    const root=$('workspace-content'), nav=$('workspace-nav');
    const records=new Map(), sessions=new Map(), active={mastering:null,show:null};
    const transfers=[];
    const existing=api.read('sw-recent-documents',[]);
    let recent=Array.isArray(existing)?existing.filter(row=>row&&typeof row.id==='string'&&/^[\w-]{1,100}$/.test(row.id)&&
      typeof row.name==='string'&&Object.hasOwn(workspaceSuffix,row.kind)&&Number.isFinite(row.at)&&row.at>=0&&row.at<8.64e15).slice(0,40):[];
    const savedProfile=api.read('sw-workspace-profile',{});
    const profile={artist:String(savedProfile?.artist||'').slice(0,120),venue:String(savedProfile?.venue||'').slice(0,120)};
    let page='session', sessionId=uid(), filter='all', search='', newType='blank', pending=false, fileIntent=null;
    let focusedRow=false, playback=null, position=0, generation=0, audition=null, auditionTimer=0;
    const monitors=new Map();
    const showNotes=new Map();
    let showVideo=null;
    const reportError=error=>report(error);
    const time=workspaceViews.time;
    const record=()=>records.get(active[page]);
    const item=state=>state?.doc.items.find(row=>row.id===state.selected);
    const selectedPlayer=state=>state?.doc.players?.find(row=>row.id===state.player);
    const storedKey=id=>'document:'+id;
    function markRecent(id,name,kind){
      const row=recent.find(row=>row.id===id);
      recent=[{id,name,kind,at:Date.now(),pinned:row?.pinned||false},...recent.filter(other=>other.id!==id)].slice(0,40);
      api.remember('sw-recent-documents',recent);
    }
    function orderedRecent(){
      return [...recent].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.at-a.at);
    }
    function trackTransfer(label,state){
      const row={label,state};
      transfers.unshift(row);
      transfers.length=Math.min(transfers.length,25);
      return row;
    }
    function drawWaveforms(state){
      root.querySelectorAll('canvas[data-ws-wave]').forEach(canvas=>{
        const data=state.media.get(canvas.dataset.wsWave)?.buffer;
        const graphic=data&&canvas.getContext('2d');
        if(!graphic)return;
        const {width,height}=canvas, lo=Number(canvas.dataset.wsFrom), hi=Number(canvas.dataset.wsTo);
        const samples=data.getChannelData(0), middle=height/2;
        graphic.clearRect(0,0,width,height);graphic.strokeStyle='#a4ddd0';graphic.beginPath();
        for(let x=0;x<width;x++){
          const from=Math.min(samples.length-1,Math.floor(data.sampleRate*(lo+(hi-lo)*x/width)));
          const to=Math.min(samples.length,Math.ceil(data.sampleRate*(lo+(hi-lo)*(x+1)/width)));
          const step=Math.max(1,Math.floor((to-from)/32));
          let min=0,max=0;
          for(let index=from;index<to;index+=step){min=Math.min(min,samples[index]);max=Math.max(max,samples[index]);}
          graphic.moveTo(x,middle-max*middle);graphic.lineTo(x,middle-min*middle);
        }
        graphic.stroke();
      });
    }
    function draw(){
      const previousVideo=root.querySelector('[data-ws-show-video]');
      if(previousVideo&&!previousVideo.paused)previousVideo.pause();
      root.hidden=page==='session';
      document.body.dataset.workspace=page;
      for(const button of nav.querySelectorAll('[data-workspace]')){
        if(button.dataset.workspace===page)button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
      }
      if(page==='session'){
        clearVideo();
        document.title=api.session().project.name+' — Sonoravell Studio';
        return;
      }
      if(page==='start'){
        clearVideo();
        root.innerHTML=workspaceViews.start({recents:orderedRecent(),filter,profile,search,activity:transfers});
        document.title='Start — Sonoravell Studio';
        return;
      }
      const state=record();
      if(!state)return;
      const scroll=root.firstElementChild?.scrollTop||0;
      const args={...state,selectedPlayer:state.player,playing:Boolean(playback),playback:{position,playing:Boolean(playback)},monitors};
      root.innerHTML=workspaceViews[page](args);
      if(root.firstElementChild)root.firstElementChild.scrollTop=scroll;
      document.title=state.doc.name+' — '+workspaceNames[page]+' · Sonoravell Studio';
      if(page==='mastering')drawWaveforms(state);
      const video=root.querySelector('[data-ws-show-video]'), media=item(state)?.video;
      if(video&&media&&state.media.has(media.asset)){
        if(showVideo?.id!==media.asset){
          clearVideo();
          const url=URL.createObjectURL(new Blob([state.media.get(media.asset).bytes],{type:media.mime}));
          showVideo={id:media.asset,url};
        }
        video.src=showVideo.url;
        video.addEventListener('loadedmetadata',updatePlayback,{once:true});
        video.addEventListener('error',()=>status('The browser could not decode this Show video.',true),{once:true});
      }else clearVideo();
      updatePlayback();
    }
    function keep(state){
      const files=new Map([...SW.workspaceAssets(state.doc),...SW.workspaceVideos(state.doc)].map(([id])=>[id,state.media.get(id)?.bytes]));
      const data={document:clone(state.doc),files};
      markRecent(state.doc.id,state.doc.name,state.doc.kind);
      api.put(storedKey(state.doc.id),data).catch(()=>{
        if(state===record())status('Browser storage unavailable. Use Save for a portable file.',true);
      });
    }
    function install(doc,media=new Map()){
      const state={doc,media,selected:doc.items[0]?.id,player:doc.players?.[0]?.id,history:[],redo:[],
        dirty:false,perform:false,performTab:'controls'};
      records.set(doc.id,state);active[doc.kind]=doc.id;
      return state;
    }
    function syncSelection(state){
      if(!item(state))state.selected=state.doc.items[0]?.id;
      if(!selectedPlayer(state))state.player=state.doc.players?.[0]?.id;
    }
    function change(state,edit,{redraw=true,stop=false}={}){
      if(!state||pending)return;
      const previous=clone(state.doc);
      edit(state.doc);
      try{SW.validateWorkspaceDocument(state.doc);}
      catch(error){state.doc=previous;throw error;}
      state.history.push(previous);
      if(state.history.length>40)state.history.shift();
      state.redo=[];state.dirty=true;state.stats=null;syncSelection(state);
      if(stop)stopPlayback(false);
      keep(state);syncMonitors();
      if(redraw)draw();
    }
    function undo(reverse=false){
      const state=record();
      if(!state||pending)return;
      const source=reverse?state.redo:state.history,target=reverse?state.history:state.redo;
      if(!source.length)return;
      stopPlayback(false);target.push(state.doc);state.doc=source.pop();state.stats=null;state.dirty=true;
      syncSelection(state);keep(state);syncMonitors();draw();
    }
    function stopPreview(){
      clearTimeout(auditionTimer);
      if(audition){audition.stop();audition=null;}
    }
    function clearVideo(){
      if(!showVideo)return;
      URL.revokeObjectURL(showVideo.url);showVideo=null;
    }
    function releaseNote(id){
      const note=showNotes.get(id);
      if(!note)return;
      showNotes.delete(id);note.release?.();
      if(!showNotes.size&&audition){clearTimeout(auditionTimer);auditionTimer=setTimeout(stopPreview,1200);}
    }
    function releaseNotes(){for(const id of showNotes.keys())releaseNote(id);}
    function closeMonitor(id){
      const slot=monitors.get(id);
      if(!slot)return;
      monitors.delete(id);
      slot.stream?.getTracks().forEach(track=>track.stop());
      slot.source?.disconnect();slot.gain?.disconnect();
    }
    function syncMonitors(){
      const state=page==='show'?record():null;
      for(const [id,slot] of monitors){
        const player=state?.doc.players.find(row=>row.id===id);
        if(!player){closeMonitor(id);continue;}
        const patch=SW.playerPatch(player,item(state));
        slot.gain?.gain.setTargetAtTime(patch.mute?0:SW.db(patch.gain),slot.context.currentTime,.015);
      }
    }
    async function monitor(player){
      if(monitors.has(player.id)){closeMonitor(player.id);draw();return;}
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Open the localhost launcher to monitor audio input.');
      const state=record(), slot={};
      monitors.set(player.id,slot);draw();
      try{
        const context=await api.audio();
        const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
        if(monitors.get(player.id)!==slot||state!==record()){stream.getTracks().forEach(track=>track.stop());return;}
        const source=context.createMediaStreamSource(stream), gain=context.createGain();
        gain.gain.value=0;
        Object.assign(slot,{context,stream,source,gain});
        source.connect(gain).connect(context.destination);syncMonitors();
      }catch(error){closeMonitor(player.id);draw();throw error;}
    }
    function switchPage(next,{initialize=true}={}){
      if(next===page){draw();return true;}
      if(pending||!api.canSwitch())return false;
      if(page==='session'&&!api.leaveSession())return false;
      stopPlayback(false);stopPreview();clearVideo();focusedRow=false;position=0;
      for(const id of monitors.keys())closeMonitor(id);
      if(initialize&&['mastering','show'].includes(next)&&!active[next]){
        const doc=SW.createWorkspaceDocument(next,next==='mastering'?'Untitled Mastering Project':'Untitled Show',profile.artist);
        if(next==='show')doc.venue=profile.venue;
        install(doc);keep(records.get(doc.id));
      }
      page=next;
      if(next==='session')api.enterSession();
      draw();
      return true;
    }
    function sessionChanged(id=sessionId){
      markRecent(id,api.session().project.name,'session');
    }
    function retainSession(){
      const snapshot=api.session();
      if(recent.some(row=>row.id===sessionId)||snapshot.dirty){
        sessions.set(sessionId,snapshot);sessionChanged();
      }
    }
    function activateSession(snapshot,id){
      retainSession();
      sessionId=id;
      api.setSession(snapshot);
      switchPage('session');
      sessionChanged();
      writeSession();
      draw();
    }
    function writeSession(){
      const snapshot=api.session();
      const data=new Map(Object.keys(snapshot.project.assets).map(id=>[id,snapshot.media.get(id)?.bytes]));
      return api.put(storedKey(sessionId),{snapshot:clone(snapshot.project),data}).catch(()=>{});
    }
    async function loadAudio(raw,durations,videos=new Map()){
      const media=new Map();
      if(!raw.size)return media;
      const context=durations.size?await api.decoder():null;
      for(const [key,bytes] of raw){
        if(!(bytes instanceof ArrayBuffer))throw Error('Missing audio bytes for a source.');
        if(videos.has(key)){media.set(key,{bytes});continue;}
        const buffer=await context.decodeAudioData(bytes.slice(0));
        if(Math.abs(buffer.duration-durations.get(key))>.05)throw Error('A source length differs from the document.');
        media.set(key,{bytes,buffer});
      }
      return media;
    }
    async function openRecent(id){
      const row=recent.find(candidate=>candidate.id===id);
      if(!row)return;
      if(row.kind==='session'&&id===sessionId){switchPage('session');return;}
      if(row.kind==='session'&&sessions.has(id)){activateSession(sessions.get(id),id);return;}
      if(records.has(id)){active[row.kind]=id;switchPage(row.kind);position=0;stopPlayback();return;}
      pending=true;
      let next;
      try{
        const data=await api.get(storedKey(id));
        if(!data)throw Error('This document has no browser copy. Open its portable file.');
        if(row.kind==='session'){
          const p=SW.validateProject(data.snapshot);
          next={project:p,media:await loadAudio(data.data,new Map(Object.entries(p.assets).map(([key,value])=>[key,value.duration])))};
        }else{
          const {document:doc,files}=data;
          SW.validateWorkspaceDocument(doc);
          next={doc,media:await loadAudio(files,SW.workspaceAssets(doc),SW.workspaceVideos(doc))};
        }
      }finally{pending=false;}
      if(next.project)activateSession(next,id);
      else{install(next.doc,next.media);switchPage(next.doc.kind);position=0;stopPlayback();}
    }
    async function openPortable(file){
      if(!file||pending||!api.canSwitch())return;
      const activity=trackTransfer('Open '+file.name,'Reading');
      let next;
      pending=true;
      try{
        if(file.size>480_000_000)throw Error('Open a workspace file under 480 MB.');
        const value=JSON.parse(await file.text());
        if(value?.format==='Sonoravell Workspace'){
          const {doc,raw}=SW.decodeWorkspaceDocument(value);
          const media=await loadAudio(raw,SW.workspaceAssets(doc),SW.workspaceVideos(doc));
          next={doc,media};
        }else{
          const {p,raw}=SW.decodeProject(value);
          const media=await loadAudio(raw,new Map(Object.entries(p.assets).map(([key,a])=>[key,a.duration])));
          next={project:p,media};
        }
        activity.state='Opened';
      }catch(error){activity.state='Failed';throw error;}
      finally{pending=false;}
      if(next.project)activateSession(next,uid());
      else{
        if(records.has(next.doc.id))next.doc.id=uid();
        const state=install(next.doc,next.media);keep(state);switchPage(next.doc.kind);position=0;stopPlayback();
      }
      status('Opened '+file.name);
    }
    function newDialog(template){
      if(!api.canSwitch()||pending)return;
      newType=Object.hasOwn(workspaceTemplates,template)?template:'blank';
      const settings=api.settings();
      $('workspace-template').innerHTML=Object.entries(workspaceTemplates).map(([key,[kind,label]])=>
        '<option value="'+key+'">'+workspaceNames[kind]+' · '+label+'</option>').join('');
      $('workspace-template').value=newType;
      $('workspace-new-name').value='';
      $('workspace-new-tempo').value=settings.newTempo;
      $('workspace-new-meter').value=settings.newMeter;
      $('workspace-new-artist').value=profile.artist;
      setupDialog();
      $('workspace-new').showModal();
      $('workspace-new-name').focus();
    }
    function setupDialog(){
      newType=$('workspace-template').value;
      const [kind,,description]=workspaceTemplates[newType]||workspaceTemplates.blank;
      $('workspace-session-fields').hidden=kind!=='session';
      $('workspace-new-description').textContent=description;
      $('workspace-new-name').placeholder=kind==='mastering'?'Untitled Mastering Project':'Untitled '+workspaceNames[kind];
    }
    function createFromDialog(){
      if(pending||!api.canSwitch())return;
      const [kind]=workspaceTemplates[newType]||workspaceTemplates.blank;
      const name=$('workspace-new-name').value.trim()||$('workspace-new-name').placeholder;
      const artist=$('workspace-new-artist').value.trim().slice(0,100);
      const tempo=Number($('workspace-new-tempo').value),meter=Number($('workspace-new-meter').value);
      if(kind==='session'&&(!Number.isFinite(tempo)||tempo<30||tempo>320||!Number.isInteger(meter)||meter<2||meter>12))throw Error('Enter a tempo from 30 to 320 and a meter from 2 to 12.');
      $('workspace-new').close();
      if(kind==='session'){
        activateSession({project:SW.createSessionTemplate(newType,name,tempo,meter,artist),media:new Map()},uid());
      }else{
        const doc=SW.createWorkspaceDocument(kind,name,artist);
        if(kind==='show')doc.venue=profile.venue;
        const state=install(doc);keep(state);switchPage(kind);
        position=0;stopPlayback();
      }
      status('Created '+name);
    }
    function quickSwitch(){
      const current=api.session().project;
      const rows=[
        {id:sessionId,name:current.name,kind:'session'},
        ...[...sessions].filter(([id])=>id!==sessionId).map(([id,state])=>({id,name:state.project.name,kind:'session'})),
        ...[...records].map(([id,state])=>({id,name:state.doc.name,kind:state.doc.kind}))
      ];
      $('workspace-switch-list').innerHTML=workspaceViews.recentRows(rows.map(row=>({...row,at:Date.now(),pinned:false})),{pins:false});
      $('workspace-switch').showModal();
    }
    function save(){
      if(page==='session')return api.saveSession();
      const state=record();
      if(!state||pending)return;
      const data=SW.encodeWorkspaceDocument(state.doc,state.media);
      api.download(data,SW.cleanName(state.doc.name)+workspaceSuffix[state.doc.kind],'application/json');
      state.dirty=false;keep(state);status('Saved '+state.doc.name);
    }
    function updatePlayback(){
      const dial=root.querySelector('[data-ws-seek]'), clock=root.querySelector('[data-ws-clock]');
      if(dial&&document.activeElement!==dial)dial.value=position;
      if(clock)clock.value=time(position);
      const video=root.querySelector('[data-ws-show-video]');
      if(video?.readyState>=1){
        const target=Math.min(position,video.duration||position);
        if(Math.abs(video.currentTime-target)>.14)video.currentTime=target;
        if(playback&&playback.context.currentTime>=playback.when&&target<video.duration){
          if(video.paused&&!video.playAttempt){
            video.playAttempt=true;video.play().catch(()=>{}).finally(()=>{video.playAttempt=false;});
          }
        }else if(!video.paused)video.pause();
      }
      const meter=root.querySelector('[data-ws-meter]'), peak=root.querySelector('[data-ws-peak]');
      if(!meter||!peak)return;
      const signal=playback?.graph.tracks.get('master')?.analyzer;
      let level=-Infinity;
      if(signal){
        signal.getFloatTimeDomainData(playback.samples);
        let max=0;for(const value of playback.samples)max=Math.max(max,Math.abs(value));
        if(max)level=20*Math.log10(max);
      }
      meter.value=clamp(level,-72,0);peak.value=(Number.isFinite(level)?level.toFixed(1):'−∞')+' dBFS';
    }
    function stopPlayback(refresh=true){
      generation++;
      releaseNotes();
      if(playback){
        cancelAnimationFrame(playback.frame);clearTimeout(playback.timer);
        playback.graph.stop();playback=null;
      }
      if(refresh)draw();
    }
    function itemStep(state,step){
      if(!state||!step)return;
      const next=state.doc.items[state.doc.items.findIndex(row=>row.id===state.selected)+step];
      if(next)selectRow(state,next.id,true);
    }
    function selectRow(state,id,continuePlaying){
      if(!state.doc.items.some(row=>row.id===id))return;
      const wasPlaying=Boolean(playback);
      state.selected=id;state.stats=null;focusedRow=true;position=0;
      if(state.doc.kind==='mastering'){
        position=SW.masteringLayout(state.doc.items).find(row=>row.item.id===id)?.start||0;
      }
      if(wasPlaying&&continuePlaying)run(()=>startPlayback(position));
      else stopPlayback();
      syncMonitors();
      root.querySelector('[data-ws-action="select-row"][data-ws-id="'+id+'"]')?.focus({preventScroll:true});
    }
    function nextShowAction(state,current,section,count){
      if(section){
        if(section.mode==='stop')return;
        if(section.mode==='loop'||section.mode==='repeat'&&count>1){
          run(()=>startPlayback(section.start,{section,repeats:count-1}));return;
        }
        const following=current.sections.filter(row=>row.start>=section.end&&row.mode!=='skip').sort((a,b)=>a.start-b.start)[0];
        if(following){run(()=>startPlayback(following.start,{section:following,repeats:following.loops}));return;}
        if(section.end<current.length){run(()=>startPlayback(section.end));return;}
      }
      if(current.mode==='loop'){run(()=>startPlayback(0));return;}
      if(current.mode==='continue'){
        const next=state.doc.items[state.doc.items.indexOf(current)+1];
        if(next){state.selected=next.id;syncMonitors();run(()=>startPlayback(0,{pause:next.pause}));}
      }
    }
    async function startPlayback(from=position,{only,section,repeats=0,pause=0}={}){
      const state=record();
      if(!state||pending)return;
      const current=item(state), show=state.doc.kind==='show';
      if(show&&!current)return;
      const program=show?SW.showProgram(state.doc,current):SW.masteringProgram(state.doc,only);
      if(!program.length)return;
      const end=section?.end||program.length;
      const start=from>=end?0:Math.max(0,from);
      stopPlayback(false);
      const token=generation, context=await api.audio();
      if(token!==generation||state!==record())return;
      const graph=SW.buildGraph(context,program.composition,true);
      const when=context.currentTime+.035+pause;
      try{SW.schedule(graph,state.media,start,end,when);}
      catch(error){graph.stop();throw error;}
      const transport={context,graph,when,start,end,samples:new Float32Array(256)};
      position=start;playback=transport;
      const tick=()=>{
        if(playback!==transport)return;
        position=clamp(start+context.currentTime-when,start,end);
        updatePlayback();transport.frame=requestAnimationFrame(tick);
      };
      transport.frame=requestAnimationFrame(tick);
      transport.timer=setTimeout(()=>{
        if(playback!==transport)return;
        position=end;stopPlayback();
        if(show)nextShowAction(state,current,section,repeats);
      },Math.max(0,(when-context.currentTime+end-start)*1000));
      draw();
    }
    async function auditionPlayer(player){
      const state=record(), current=item(state);
      if(!player||player.type!=='virtual')return;
      const context=await api.audio();
      if(state!==record())return;
      const program=SW.showProgram(state.doc,current||SW.showItem('Audition'));
      const t=program.composition.tracks.find(track=>track.id===player.id);
      const graph=playback?.graph||SW.buildGraph(context,program.composition);
      if(!playback){
        stopPreview();audition=graph;auditionTimer=setTimeout(stopPreview,1300);
      }
      SW.voice(graph,t,t.instrument==='Drums'?36:60,.8,context.currentTime+.02,.35,state.media);
    }
    async function startNote(id,pitch,velocity){
      const state=record();
      if(page!=='show'||!state||showNotes.has(id))return;
      const player=state.doc.players.find(row=>row.id===state.player&&row.type==='virtual')||
        state.doc.players.find(row=>row.type==='virtual');
      if(!player)return;
      const pendingNote={};
      showNotes.set(id,pendingNote);
      try{
        const context=await api.audio();
        if(showNotes.get(id)!==pendingNote||record()!==state)return;
        clearTimeout(auditionTimer);
        const program=SW.showProgram(state.doc,item(state)||SW.showItem('Live'));
        const t=program.composition.tracks.find(row=>row.id===player.id);
        if(t.mute){releaseNote(id);return;}
        if(!playback&&!audition)audition=SW.buildGraph(context,program.composition);
        const graph=playback?.graph||audition;
        if(!graph?.tracks.get(t.id)?.source){releaseNote(id);return;}
        SW.overrideParam(graph,t.id,'volume',t.volume);
        pendingNote.release=SW.voice(graph,t,pitch,velocity,context.currentTime+.02,60,state.media,Infinity,true);
      }catch(error){releaseNote(id);throw error;}
    }
    function midi(id,type,pitch,velocity){
      if(page!=='show')return false;
      if(type===8||type===9&&!velocity)releaseNote(id);
      else if(type===9)run(()=>startNote(id,pitch,velocity/127));
      return true;
    }
    function updatePlayer(state,player){
      const patch=SW.playerPatch(player,item(state));
      const node=playback?.graph.tracks.get(player.id);
      if(node){
        SW.overrideParam(playback.graph,player.id,'volume',patch.gain);
        node.out.gain.setTargetAtTime(patch.mute?0:1,playback.context.currentTime,.015);
      }
      syncMonitors();
    }
    function addAsset(state,entry,playerId){
      const duration=entry.buffer.duration, name=entry.name.replace(/\.[^.]+$/,'').slice(0,120)||'Imported Audio';
      state.media.set(entry.id,entry);
      if(state.doc.kind==='mastering'){
        const track=SW.masteringTrack(entry.id,name,duration,entry.source||'');
        state.doc.items.push(track);state.selected=track.id;
      }else if(playerId&&item(state)){
        const selected=item(state);
        selected.slots[playerId]={asset:entry.id,duration};selected.length=Math.max(selected.length,duration);
      }else{
        let player=state.doc.players.find(player=>player.type==='backing');
        if(!player){
          if(state.doc.players.length>=32)throw Error('Remove an unused Player before adding a backing track.');
          player=SW.showPlayer('backing','Backing Tracks');state.doc.players.push(player);
        }
        const next=SW.showItem(name,entry.id,player.id,Math.max(.01,duration));
        next.slots[player.id].duration=duration;
        state.doc.items.push(next);state.selected=next.id;
      }
    }
    async function importAudio(files,playerId){
      const state=record();
      if(!state||!files.length||pending)return;
      const max=playerId?1:SW.workspaceEntryLimit-state.doc.items.length;
      if(max<=0)throw Error('This document has reached its track limit.');
      const entries=[],failures=[];
      const job=trackTransfer('Import '+Math.min(files.length,max)+' audio file(s)','Decoding');
      pending=true;
      try{
        for(const file of files.slice(0,max)){
          try{
            if(file.size>280_000_000)throw Error('File exceeds 280 MB.');
            entries.push(await api.decode(await file.arrayBuffer(),file.name));
          }catch(error){failures.push(file.name);}
        }
      }finally{pending=false;}
      job.state=entries.length?'Imported '+entries.length:'Failed';
      if(entries.length)change(state,()=>entries.forEach(entry=>addAsset(state,entry,playerId)),{stop:true});
      status(failures.length?'Imported '+entries.length+' · Could not decode '+failures.join(', '):'Imported '+entries.length+' audio file(s)',!entries.length);
    }
    async function importVideo(file){
      const state=record(), current=item(state);
      if(page!=='show'||!current||!file||pending)return;
      const types={'mp4':'video/mp4','webm':'video/webm','ogv':'video/ogg','mov':'video/quicktime'};
      const mime=types[file.name.split('.').at(-1).toLowerCase()];
      if(!mime||file.size>150_000_000)throw Error('Choose an MP4, WebM, OGV, or MOV video under 150 MB.');
      pending=true;
      let bytes;
      try{bytes=await file.arrayBuffer();}
      finally{pending=false;}
      const asset=uid();
      state.media.set(asset,{bytes});
      change(state,()=>{current.video={asset,name:file.name.slice(0,120),mime};});
    }
    async function fromSession(destination=page){
      if(pending||!api.canSwitch())return;
      if(!['mastering','show'].includes(destination))return;
      if(!api.session().project.tracks.some(track=>track.clips.length))throw Error('Add audio or MIDI to the Session first.');
      if(destination!==page&&!switchPage(destination))return;
      const state=record();
      if(state.doc.items.length>=SW.workspaceEntryLimit)throw Error('This document has reached its track limit.');
      const job=trackTransfer('Render current Session','Rendering');
      pending=true;
      let entry;
      try{entry=await api.renderSession();job.state='Rendered';}
      catch(error){job.state='Failed';throw error;}
      finally{pending=false;}
      change(state,()=>addAsset(state,entry),{stop:true});
      status('Added '+entry.name+' to '+workspaceNames[destination]);
    }
    async function analyze(state,id){
      const program=SW.masteringProgram(state.doc,id);
      if(!program.length||pending)return;
      pending=true;
      try{
        const buffer=await SW.renderAudio(program.composition,state.media,{from:0,to:program.length,rate:state.doc.rate,tail:0});
        state.stats=SW.levelStats(buffer);
      }finally{pending=false;}
      draw();
    }
    function releaseDialog(){
      const state=record();
      if(page!=='mastering'||!state?.doc.items.length||pending)return;
      $('workspace-release-rate').value=state.doc.rate;
      $('workspace-release-bits').value=state.doc.bits;
      $('workspace-release-format').innerHTML=Object.entries(api.formats()).map(([key,name])=>'<option value="'+key+'">'+name+'</option>').join('');
      $('workspace-release').showModal();
    }
    async function exportRelease(){
      const state=record();
      if(page!=='mastering'||!state?.doc.items.length||pending)return;
      const rate=Number($('workspace-release-rate').value),bits=Number($('workspace-release-bits').value),format=$('workspace-release-format').value;
      const dither=$('workspace-release-dither').checked, doc=clone(state.doc);
      const job=trackTransfer('Digital Release · '+doc.name,'Rendering');
      if(![44100,48000,96000].includes(rate)||![16,24,32].includes(bits)||!Object.hasOwn(api.formats(),format))throw Error('Select an available export format.');
      pending=true;stopPlayback(false);$('workspace-release-submit').disabled=true;
      try{
        const files=[], metadata={album:doc.album,artist:doc.artist,tracks:[]};
        for(const [index,track] of doc.items.entries()){
          job.state='Rendering '+(index+1)+' of '+doc.items.length;
          status('Digital Release · '+job.state);
          const {composition,length}=SW.masteringProgram(doc,track.id);
          const audio=await SW.renderAudio(composition,state.media,{from:0,to:length,rate,tail:0});
          const artist=track.artist||doc.artist, tags={title:track.name,album:doc.album,artist,comment:track.comment};
          const result=await api.encode(audio,{rate,bits,format,dither},tags);
          const name=String(index+1).padStart(2,'0')+' - '+SW.cleanName(track.name)+'.'+result.ext;
          files.push([name,result.bytes]);
          metadata.tracks.push({...tags,file:name,index:index+1,gapBefore:track.gap,seconds:length});
        }
        files.push(['Release metadata.json',new TextEncoder().encode(JSON.stringify(metadata,null,2))]);
        api.download(await SW.zip(files),SW.cleanName(doc.album||doc.name)+' - Digital Release.zip','application/zip');
        job.state='Exported '+doc.items.length+' tracks';
        $('workspace-release').close();status(job.state);
      }catch(error){job.state='Failed';throw error;}
      finally{$('workspace-release-submit').disabled=false;pending=false;draw();}
    }
    function batchDialog(){
      if(pending||!api.canSwitch())return;
      $('batch-format').innerHTML=Object.entries(api.formats()).map(([key,name])=>'<option value="'+key+'">'+name+'</option>').join('');
      $('batch-input').value='';
      $('batch-dialog').showModal();
    }
    async function convertBatch(){
      const files=[...$('batch-input').files].slice(0,128);
      const rate=Number($('batch-rate').value),bits=Number($('batch-resolution').value),format=$('batch-format').value;
      if(!files.length||pending||!api.canSwitch())return;
      if(![44100,48000,96000].includes(rate)||![16,24,32].includes(bits)||!Object.hasOwn(api.formats(),format))throw Error('Choose a supported batch output.');
      const job=trackTransfer('Audio Batch Converter','Converting');
      const outputs=[],failed=[];
      pending=true;$('batch-submit').disabled=true;
      try{
        for(const [index,file] of files.entries()){
          status('Audio Batch Converter · '+(index+1)+' / '+files.length);
          try{
            if(file.size>280_000_000)throw Error('File exceeds 280 MB.');
            const source=await api.decode(await file.arrayBuffer(),file.name), media=new Map([[source.id,source]]);
            const name=file.name.replace(/\.[^.]+$/,'').slice(0,120);
            const project=SW.createWorkspaceDocument('mastering','Batch');
            project.items.push(SW.masteringTrack(source.id,name,source.buffer.duration));
            const {composition,length}=SW.masteringProgram(project);
            const audio=await SW.renderAudio(composition,media,{to:length,rate,tail:0});
            const output=await api.encode(audio,{rate,bits,format,dither:$('batch-dither').checked},{title:name});
            outputs.push([String(index+1).padStart(2,'0')+' - '+SW.cleanName(name)+'.'+output.ext,output.bytes]);
          }catch(error){failed.push(file.name+' · '+error.message);}
        }
        if(outputs.length)api.download(SW.zip(outputs),'Converted Audio.zip','application/zip');
        job.state=outputs.length+' converted'+(failed.length?' · '+failed.length+' failed':'');
        if(!failed.length)$('batch-dialog').close();
        status(failed.length?job.state+' · '+failed.join(' | '):job.state,Boolean(failed.length));
      }finally{pending=false;$('batch-submit').disabled=false;if(page==='start')draw();}
    }
    function removeRow(state,id){
      const index=state.doc.items.findIndex(row=>row.id===id);
      if(index<0)return;
      change(state,doc=>{
        doc.items.splice(index,1);state.selected=doc.items[Math.min(index,doc.items.length-1)]?.id;
        position=0;
      },{stop:true});
    }
    function fieldChange(input){
      let key=input.dataset.wsField;
      if(!key)return;
      const value=input.value.trim();
      if(key==='profile-name'||key==='profile-venue'){
        profile[key==='profile-name'?'artist':'venue']=value.slice(0,120);api.remember('sw-workspace-profile',profile);return;
      }
      const state=record(), row=item(state), player=selectedPlayer(state);
      if(!state||pending)return;
      const doc=state.doc, numeric=input.type==='number';
      if(numeric&&(!value||!Number.isFinite(Number(value)))){draw();return;}
      const next=numeric?clamp(Number(value),Number(input.min),Number(input.max)):value;
      let object=doc;
      if(key.startsWith('track-')||key.startsWith('item-')){object=row;key=key.slice(key.indexOf('-')+1);}
      else if(key.startsWith('section-')){
        object=row?.sections?.find(section=>section.id===input.closest('[data-ws-section]')?.dataset.wsSection);
        key=key.slice(8);
      }else if(key.startsWith('player-')||key.startsWith('patch-')){
        if(key==='patch-id'&&row&&player){
          change(state,()=>{if(next)row.patches[player.id]=next;else delete row.patches[player.id];});
          updatePlayer(state,player);return;
        }
        object=key.startsWith('player-')?player:player&&SW.playerPatch(player,row);
        key=key.slice(key.indexOf('-')+1);
      }
      if(!object||!Object.hasOwn(object,key)||object[key]===next)return;
      const newValue=['meter','loops'].includes(key)?Math.round(next):next;
      change(state,()=>{
        object[key]=key==='name'&&!next?object.name:newValue;
        if(doc.kind==='mastering'&&object===row)SW.normalizeMasterTrack(row);
        if(doc.kind==='show'&&row){
          row.sections=row.sections.filter(section=>section.start<row.length||section===object);
          for(const section of row.sections){
            section.start=clamp(section.start,0,Math.max(0,row.length-.01));
            section.end=clamp(section.end,Math.min(row.length,section.start+.01),row.length);
          }
        }
      },{redraw:false,stop:doc.kind==='mastering'||['length','start','end'].includes(key)});
      if(player)updatePlayer(state,player);
      requestAnimationFrame(draw);
    }
    const run=fn=>Promise.resolve().then(fn).catch(reportError);
    function action(button){
      const {wsAction:act,wsId:id,wsKey:key}=button.dataset,state=record(),row=item(state);
      if(pending)return;
      if(act==='new'||act==='new-template'){newDialog(key);return;}
      if(act==='open'){$('open-file').click();return;}
      if(act==='session') {switchPage('session');return;}
      if(act==='demo'){activateSession({project:SW.demo(),media:new Map()},uid());return;}
      if(act==='save'){save();return;}
      if(act==='quick-switch'){quickSwitch();return;}
      if(act==='start-filter'){filter=key;draw();return;}
      if(act==='open-recent'){if($('workspace-switch').open)$('workspace-switch').close();return openRecent(id);}
      if(act==='pin-recent'){
        const row=recent.find(row=>row.id===id);
        if(row){row.pinned=!row.pinned;api.remember('sw-recent-documents',recent);draw();}
        return;
      }
      if(act==='audio-setup'||act==='external-devices'||act==='preferences'||act==='help'){
        api.command({'audio-setup':'settings-audio','external-devices':'settings-midi'}[act]||act);return;
      }
      if(!state)return;
      const player=state.doc.players?.find(player=>player.id===id);
      switch(act){
        case 'from-session':return fromSession();
        case 'select-row':selectRow(state,id,page==='show');break;
        case 'row-up':case 'row-down':change(state,doc=>SW.moveWorkspaceRow(doc.items,id,act==='row-up'?-1:1),{stop:true});break;
        case 'remove-row':removeRow(state,id);break;
        case 'analyze':return analyze(state,id);
        case 'audition-row':return startPlayback(0,{only:id});
        case 'digital-release':releaseDialog();break;
        case 'play':if(playback)stopPlayback();else return startPlayback();break;
        case 'home':position=0;if(playback)return startPlayback(0);updatePlayback();break;
        case 'previous-item':itemStep(state,-1);break;
        case 'next-item':itemStep(state,1);break;
        case 'import-audio':case 'load-slot':
          fileIntent=act==='load-slot'?id:null;
          $('workspace-audio-file').multiple=!fileIntent;$('workspace-audio-file').click();break;
        case 'import-show-video':$('workspace-video-file').click();break;
        case 'remove-show-video':if(row?.video)change(state,()=>delete row.video);break;
        case 'enable-midi':return api.enableMidi();
        case 'add-player':
          if(state.doc.players.length>=32)throw Error('A Show supports up to 32 Players.');
          change(state,doc=>{
            const next=SW.showPlayer(key,SW.showPlayerTypes[key]+' '+(doc.players.length+1));
            doc.players.push(next);state.player=next.id;
          });
          break;
        case 'select-player':if(player){state.player=player.id;draw();}break;
        case 'player-mute':
          if(player){
            change(state,()=>{const patch=SW.playerPatch(player,row);patch.mute=!patch.mute;});
            updatePlayer(state,player);
          }
          break;
        case 'audition-player':return auditionPlayer(player);
        case 'monitor':if(player?.type==='real')return monitor(player);break;
        case 'remove-player':
          if(player)change(state,doc=>{
            doc.players=doc.players.filter(other=>other!==player);
            for(const row of doc.items){delete row.slots[id];delete row.patches[id];}
          },{stop:true});
          break;
        case 'add-item':
          if(state.doc.items.length>=SW.workspaceEntryLimit)throw Error('The Setlist has reached its item limit.');
          change(state,doc=>{const row=SW.showItem('Item '+(doc.items.length+1));doc.items.push(row);state.selected=row.id;position=0;},{stop:true});
          break;
        case 'save-patch':
          if(row&&player&&player.patches.length<SW.workspaceEntryLimit){
            const current=SW.playerPatch(player,row),patch={id:uid(),name:'Patch '+(player.patches.length+1),instrument:current.instrument,gain:current.gain,mute:current.mute};
            change(state,()=>{player.patches.push(patch);row.patches[id]=patch.id;});
          }
          break;
        case 'remove-patch':
          if(player)change(state,doc=>{
            player.patches=player.patches.filter(patch=>patch.id!==key);
            for(const row of doc.items)if(row.patches[id]===key)delete row.patches[id];
          });
          break;
        case 'assign-patch':
          if(player&&row){
            change(state,()=>{if(key==='default')delete row.patches[id];else row.patches[id]=key;});
            updatePlayer(state,player);
          }
          break;
        case 'add-section':
          if(row&&row.sections.length<SW.workspaceEntryLimit){
            const start=clamp(position,0,Math.max(0,row.length-.01));
            change(state,()=>row.sections.push(SW.showSection('Section '+(row.sections.length+1),start,Math.min(row.length,start+8))));
          }
          break;
        case 'remove-section':
          if(row)change(state,()=>{row.sections=row.sections.filter(section=>section.id!==id);});break;
        case 'section-jump': {
          const section=row?.sections.find(section=>section.id===id);
          if(section)return startPlayback(section.start,{section,repeats:section.loops});
          break;
        }
        case 'performance':
          state.perform=!state.perform;draw();break;
        case 'perform-tab':
          state.performTab=key;draw();break;
      }
    }
    function bind(){
      nav.addEventListener('click',event=>{
        const next=event.target.closest('[data-workspace]')?.dataset.workspace;
        if(Object.hasOwn(workspaceNames,next))switchPage(next);
        else{const button=event.target.closest('[data-ws-action]');if(button)run(()=>action(button));}
      });
      for(const area of [root,$('workspace-switch-list')]){
        area.addEventListener('click',event=>{
          const control=event.target.closest('[data-ws-action]');
          if(control)run(()=>action(control));
        });
      }
      root.addEventListener('input',event=>{
        if(event.target.id==='workspace-search'){
          search=event.target.value;const list=$('workspace-recent-list');
          if(list)list.innerHTML=workspaceViews.recentRows(orderedRecent().filter(row=>(filter==='all'||row.kind===filter)&&
            row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())));
        }
      });
      root.addEventListener('change',event=>{
        if(event.target.hasAttribute('data-ws-seek')){
          position=Number(event.target.value);if(playback)run(()=>startPlayback(position));else updatePlayback();
        }else if(event.target.dataset.wsField)run(()=>fieldChange(event.target));
      });
      root.addEventListener('focusin',event=>{focusedRow=Boolean(event.target.closest('[data-ws-row]'));});
      root.addEventListener('dragover',event=>{
        if(record()&&[...event.dataTransfer.types].includes('Files'))event.preventDefault();
      });
      root.addEventListener('drop',event=>{
        if(!record()||!event.dataTransfer.files.length)return;
        event.preventDefault();run(()=>importAudio([...event.dataTransfer.files]));
      });
      $('workspace-audio-file').onchange=event=>{
        const files=[...event.target.files],player=fileIntent;
        event.target.value='';fileIntent=null;run(()=>importAudio(files,player));
      };
      $('workspace-video-file').onchange=event=>{
        const file=event.target.files[0];event.target.value='';run(()=>importVideo(file));
      };
      $('workspace-template').onchange=setupDialog;
      $('workspace-new-close').onclick=()=>$('workspace-new').close();
      $('workspace-new-form').addEventListener('submit',event=>{event.preventDefault();run(createFromDialog);});
      $('workspace-switch-close').onclick=()=>$('workspace-switch').close();
      $('workspace-release-close').onclick=()=>$('workspace-release').close();
      $('workspace-release-form').addEventListener('submit',event=>{event.preventDefault();run(exportRelease);});
      $('batch-close').onclick=()=>$('batch-dialog').close();
      $('batch-form').addEventListener('submit',event=>{event.preventDefault();run(convertBatch);});
      window.addEventListener('pagehide',()=>{
        stopPlayback(false);stopPreview();clearVideo();for(const id of monitors.keys())closeMonitor(id);
      });
      window.addEventListener('blur',releaseNotes);
    }
    function commands(id){
      if(id==='audio-batch'){batchDialog();return true;}
      if(id==='new'){newDialog();return true;}
      if(id==='open'){if(!pending&&api.canSwitch())$('open-file').click();return true;}
      if(id==='show-start'){switchPage('start');return true;}
      if(id==='show-session'){switchPage('session');return true;}
      if(id==='show-mastering'){switchPage('mastering');return true;}
      if(id==='show-live'){switchPage('show');return true;}
      if(id==='quick-switch'){quickSwitch();return true;}
      if(id==='add-to-mastering'||id==='add-to-show'){run(()=>fromSession(id==='add-to-mastering'?'mastering':'show'));return true;}
      if(id==='demo'){activateSession({project:SW.demo(),media:new Map()},uid());return true;}
      if(page==='session')return false;
      if(id==='save'){run(save);return true;}
      if(id==='undo'||id==='redo'){undo(id==='redo');return true;}
      if(id==='delete'){const state=record();if(focusedRow&&item(state))removeRow(state,state.selected);return true;}
      if(id==='transport'){if(playback)stopPlayback();else run(()=>startPlayback());return true;}
      if(id==='stop'){stopPlayback();return true;}
      if(id==='export'&&page==='mastering'){releaseDialog();return true;}
      return false;
    }
    function available(id){
      if(id==='audio-batch')return !pending&&api.canSwitch();
      if(['new','open','demo','show-start','show-session','show-mastering','show-live','quick-switch'].includes(id))return !pending&&api.canSwitch();
      if(id==='add-to-mastering'||id==='add-to-show')return !pending&&api.canSwitch()&&api.session().project.tracks.some(track=>track.clips.length);
      if(page==='session')return undefined;
      if(['help','about','online-reference','workflow-tutorial','preferences','settings-audio','settings-midi','settings-keys','find','fullscreen'].includes(id))return true;
      const state=record();
      if(id==='undo'||id==='redo')return !pending&&Boolean(state?.[id==='undo'?'history':'redo'].length);
      if(['transport','stop','save','delete'].includes(id))return !pending&&Boolean(state);
      if(id==='export')return !pending&&page==='mastering'&&Boolean(state?.doc.items.length);
      return false;
    }
    function keys(event,id,chord){
      if(page==='session')return false;
      if(event.defaultPrevented)return true;
      if(page==='show'&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.shiftKey&&Object.hasOwn(SW.noteKeys,event.code)&&
        record()?.doc.players.some(player=>player.type==='virtual')){
        event.preventDefault();run(()=>startNote(event.code,60+SW.noteKeys[event.code],.78));return true;
      }
      if(event.key==='Escape'&&page==='show'&&record()?.perform){
        record().perform=false;draw();event.preventDefault();return true;
      }
      if(!event.target.matches('button,textarea,input,select')&&chord==='Space'){
        commands('transport');event.preventDefault();return true;
      }
      if(chord==='Delete'&&record()){
        const row=event.target.closest?.('[data-ws-row]');
        if(row||focusedRow&&item(record())){
          removeRow(record(),row?.dataset.wsRow||record().selected);event.preventDefault();
        }
        return true;
      }
      if(id&&available(id)){api.command(id);event.preventDefault();}
      return true;
    }
    return {bind,draw,switchPage,commands,available,keys,openPortable,writeSession,sessionChanged,midi,releaseNote,
      dirty:()=>[...records.values()].some(row=>row.dirty)||[...sessions].some(([id,row])=>id!==sessionId&&row.dirty),
      page:()=>page,sessionId:()=>sessionId,
      restoreSessionId:id=>{if(typeof id==='string'&&/^[\w-]{1,100}$/.test(id))sessionId=id;}};
  }
  return {createWorkspacePages};
})());
