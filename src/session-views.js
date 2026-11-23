'use strict';
Object.assign(SW, (() => {
  const {clamp,clone,uid}=SW;
  const freshScenes=()=>Array.from({length:8},(_,i)=>({id:uid(),name:'Scene '+(i+1),cells:{}}));
  function ideaClip(source,start=source.start){
    const clip=clone(source);
    clip.id=uid();clip.start=start;
    for(const note of clip.notes)note.id=uid();
    return clip;
  }
  function ideaProgram(project,groups){
    const p=clone(project);
    delete p.launcher;delete p.scratchPads;
    p.click=false;p.loop=false;
    for(const track of p.tracks)track.clips=[];
    let cursor=0;
    for(const group of groups){
      const length=group.length?Math.max(...group.map(row=>row.clip.start+row.clip.length)):0;
      for(const row of group){
        const track=p.tracks.find(t=>t.id===row.track&&t.type===row.clip.type);
        if(track)track.clips.push(ideaClip(row.clip,row.clip.start+cursor));
      }
      cursor+=length;
    }
    return {project:p,length:cursor};
  }
  function validSessionIdeas(p){
    if(p.launcher===undefined&&p.scratchPads===undefined)return true;
    const id=value=>typeof value==='string'&&/^[\w-]{1,100}$/.test(value)&&!Object.hasOwn(Object.prototype,value)&&value!=='prototype';
    const named=value=>id(value?.id)&&typeof value.name==='string'&&value.name.trim()&&value.name.length<=120;
    const validArray=(rows,max)=>Array.isArray(rows)&&rows.length<=max&&rows.every(named)&&new Set(rows.map(row=>row.id)).size===rows.length;
    const tracks=new Map(p.tracks.map(track=>[track.id,track]));
    const groups=[];
    if(p.launcher!==undefined){
      const {scenes,playlist}=p.launcher||{};
      if(!validArray(scenes,32)||!Array.isArray(playlist)||playlist.length>128||!playlist.every(scene=>scenes.some(row=>row.id===scene)))return false;
      for(const scene of scenes){
        if(!scene.cells||typeof scene.cells!=='object'||Array.isArray(scene.cells))return false;
        groups.push(Object.entries(scene.cells).map(([track,clip])=>({track,clip})));
      }
    }
    if(p.scratchPads!==undefined){
      if(!validArray(p.scratchPads,24))return false;
      for(const pad of p.scratchPads){
        if(!Array.isArray(pad.events)||pad.events.length>512)return false;
        groups.push(pad.events);
      }
    }
    for(const row of groups.flat()){
      const track=tracks.get(row?.track),c=row?.clip;
      if(!track||!c||!id(c.id)||track.type!==c.type||!['audio','midi'].includes(c.type)||typeof c.name!=='string'||
        !Number.isFinite(c.start)||c.start<0||c.start>100000||!Number.isFinite(c.length)||c.length<=0||c.length>100000||
        !Number.isFinite(c.offset)||c.offset<0||!Number.isFinite(c.gain)||c.gain< -60||c.gain>24||
        !Array.isArray(c.notes))return false;
      if(c.type==='audio'&&(!Object.hasOwn(p.assets,c.asset)||!Number.isFinite(c.sourceBpm)||c.sourceBpm<30||c.sourceBpm>320||
        c.offset+c.length>p.assets[c.asset].duration*c.sourceBpm/60+.002))return false;
      if(c.type==='midi'&&(!c.notes.every(n=>id(n?.id)&&Number.isInteger(n.pitch)&&n.pitch>=0&&n.pitch<=127&&Number.isFinite(n.start)&&n.start>=0&&
        Number.isFinite(n.length)&&n.length>0&&Number.isFinite(n.velocity)&&n.velocity>=0&&n.velocity<=1)||
        Object.entries(c.expression||{}).some(([key,lane])=>{
          const spec=SW.expressionSpec(key);
          return !spec||!Array.isArray(lane)||!lane.every((point,index)=>Number.isFinite(point?.at)&&point.at>=0&&point.at<=c.length+1e-7&&
            Number.isFinite(point.value)&&point.value>=spec[1]&&point.value<=spec[2]&&(!index||lane[index-1].at<point.at));
        })))return false;
    }
    return true;
  }
  function purgeTrackIdeas(p,id){
    for(const scene of p.launcher?.scenes||[])delete scene.cells[id];
    for(const pad of p.scratchPads||[])pad.events=pad.events.filter(row=>row.track!==id);
  }
  function ideaUsesAsset(p,id){
    return Boolean(p.launcher?.scenes.some(scene=>Object.values(scene.cells).some(clip=>clip.asset===id))||
      p.scratchPads?.some(pad=>pad.events.some(row=>row.clip.asset===id)));
  }
  function notationStep(pitch){return Math.floor(pitch/12)*7+[0,0,1,1,2,3,3,4,4,5,5,6][pitch%12];}
  function createSessionViews(api){
    const {esc,edit,status,report,$}=api;
    const dialog=$('session-view-dialog'),body=$('session-view-body');
    let view='',padId='',activeNote='',steps=16,pattern=new Map(),octave=60;
    const titles={launcher:'Launcher',scratch:'Scratch Pads',patterns:'Pattern Editor',score:'Score Editor',lyrics:'Lyrics Display',channel:'Channel Overview',monitor:'Performance Monitor'};
    const button=(action,label,data='',pressed)=>'<button type="button" data-session-view-action="'+action+'" '+data+
      (pressed===undefined?'':' aria-pressed="'+pressed+'"')+'>'+esc(label)+'</button>';
    const input=(key,label,value,opts='')=>'<label>'+esc(label)+'<input data-session-view-field="'+key+'" value="'+esc(value)+'" '+opts+'></label>';
    const field=(key,label,value,min,max,step='any')=>input(key,label,value,'type="number" min="'+min+'" max="'+max+'" step="'+step+'"');
    const group=(label,contents)=>'<section class="session-view-group"><h3>'+esc(label)+'</h3>'+contents+'</section>';
    const run=fn=>Promise.resolve().then(fn).catch(report);
    const sceneRows=scene=>Object.entries(scene?.cells||{}).map(([track,clip])=>({track,clip}));
    const takeRows=()=>api.selected().filter(({c})=>!c.locked);
    function launcher(p){
      const {scenes,playlist}=p.launcher;
      const tracks=SW.timelineTracks(p).filter(t=>t.type==='midi'||t.type==='audio');
      const heads=scenes.map(scene=>{
        return '<th data-scene="'+scene.id+'">'+input('scene-name','Name',scene.name,'maxlength="120"')+'<div class="ws-actions">'+
          button('play-scene','Launch','title="Launch scene"')+button('insert-scene','Insert','title="Insert Scene into Session"')+
          button('queue-scene','Queue','title="Add scene to Playlist"')+button('remove-scene','×','title="Remove scene"')+'</div></th>';
      }).join('');
      const rows=tracks.map(track=>'<tr><th scope="row">'+esc(track.name)+'</th>'+scenes.map(scene=>{
        const c=scene.cells[track.id], data='data-scene="'+scene.id+'" data-idea-track="'+track.id+'"';
        return '<td '+data+'>'+ (c?button('play-cell',c.name,'title="Launch cell"'):'<span class="muted-text">Empty</span>')+
          button('set-cell',c?'Replace':'Capture','title="Capture the selected event on this track"')+
          (c?button('remove-cell','×','title="Remove cell"'):'')+'</td>';
      }).join('')+'</tr>').join('');
      const queued=playlist.map((id,index)=>'<li>'+esc(scenes.find(scene=>scene.id===id)?.name)+
        button('remove-queue','×','data-index="'+index+'" title="Remove from Playlist"')+'</li>').join('');
      return '<div class="session-view-toolbar">'+button('add-scene','Add Scene')+button('stop','Stop Preview')+'</div>'+
        '<p class="session-view-info">Select an event in the arrangement, then capture it into its track’s cell. Launch one cell or the whole scene.</p>'+
        '<div class="launcher-grid"><table><thead><tr><th>Tracks</th>'+heads+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
        group('Playlist','<ol class="session-view-queue">'+queued+'</ol><div class="ws-actions">'+
          button('play-playlist','Play Playlist')+button('insert-playlist','Insert Playlist into Session')+'</div>');
    }
    function scratch(p){
      const pads=p.scratchPads||[], selected=pads.find(row=>row.id===padId)||pads[0];
      padId=selected?.id||'';
      const tabs=pads.map(pad=>button('select-pad',pad.name,'data-pad="'+pad.id+'"',pad.id===padId)).join('');
      const rows=(selected?.events||[]).map(({track,clip})=>'<li data-idea-id="'+clip.id+'"><strong>'+esc(clip.name)+'</strong>'+
        '<span>'+esc(SW.findTrack(p,track)?.name)+'</span>'+field('pad-at','Beat offset',clip.start,0,99999)+
        '<span>'+Number(clip.length.toFixed(3))+' beats</span>'+button('remove-idea','×','title="Remove scratch event"')+'</li>').join('');
      return '<div class="session-view-toolbar">'+button('add-pad','Add Scratch Pad')+tabs+'</div>'+
        (selected?'<div class="session-view-toolbar">'+input('pad-name','Name',selected.name,'maxlength="120"')+
          button('capture-pad','Copy Selection')+button('play-pad','Play Scratch Pad')+button('stop','Stop Preview')+
          button('insert-pad','Insert at Playhead')+button('remove-pad','Remove Scratch Pad')+'</div><ul class="scratch-list">'+rows+'</ul>':
          '<p class="session-view-info">Add a Scratch Pad to collect copied events for an alternate arrangement.</p>');
    }
    function patternPitches(track){
      return track.instrument==='Drums'?[36,38,42,46]:[octave,octave+2,octave+4,octave+7,octave+9,octave+12];
    }
    function patterns(){
      const track=api.track();
      if(track?.type!=='midi')return '<p class="session-view-info">Select an Instrument Track in the Session to create a pattern.</p>';
      const pitches=patternPitches(track);
      return '<div class="session-view-toolbar">'+field('steps','Steps',steps,4,64,1)+
        (track.instrument==='Drums'?'':field('octave','Root note',octave,12,108,1))+button('capture-pattern','Read Selected Part')+
        button('play-pattern','Play Pattern')+button('stop','Stop Preview')+button('insert-pattern','Insert Pattern at Playhead')+'</div>'+
        '<div class="launcher-grid"><table class="step-grid"><thead><tr><th>Pitch</th>'+
        Array.from({length:steps},(_,i)=>'<th>'+String(i+1)+'</th>').join('')+'</tr></thead><tbody>'+
        pitches.map(pitch=>'<tr><th>'+esc(({36:'Kick',38:'Snare',42:'Closed Hat',46:'Open Hat'})[pitch]&&track.instrument==='Drums'?
          ({36:'Kick',38:'Snare',42:'Closed Hat',46:'Open Hat'})[pitch]:SW.noteName(pitch))+'</th>'+
          Array.from({length:steps},(_,i)=>'<td>'+button('step',pattern.has(pitch+':'+i)?'●':'·',
            'aria-label="'+esc(SW.noteName(pitch)+' step '+(i+1))+'" data-pitch="'+pitch+'" data-step="'+i+'"',pattern.has(pitch+':'+i))+'</td>').join('')+'</tr>').join('')+
        '</tbody></table></div>';
    }
    function patternClip(track){
      const clip=SW.clip('midi',0,steps/4,'Pattern');
      for(const pitch of patternPitches(track))for(let step=0;step<steps;step++){
        const velocity=pattern.get(pitch+':'+step);
        if(velocity)clip.notes.push(SW.note(pitch,step/4,.25,velocity));
      }
      return clip;
    }
    function score(){
      const row=api.editor();
      if(row?.c.type!=='midi')return '<p class="session-view-info">Select an Instrument Part in the Session to edit its notation.</p>';
      const part=row.c, selected=part.notes.find(note=>note.id===activeNote);
      const pitches=part.notes.map(note=>note.pitch).sort((a,b)=>a-b),clef=pitches[Math.floor(pitches.length/2)]<58?'Bass':'Treble';
      const reference=notationStep(clef==='Bass'?50:71);
      const count=Math.max(4,Math.ceil(part.length/api.project().meter)*api.project().meter);
      const ink=part.notes.filter(note=>note.start<part.length).slice(0,600).map(note=>{
        const step=reference-notationStep(note.pitch),top=65+clamp(step,-9,13)*7;
        const sharp=[1,3,6,8,10].includes(note.pitch%12),stem=note.length<4;
        return '<button type="button" class="score-note'+(stem?' has-stem':'')+(sharp?' has-sharp':'')+(note.length>=2?' half':'')+
          '" data-session-view-action="choose-note" data-idea-id="'+note.id+'" title="'+esc(SW.noteName(note.pitch)+' · '+note.length+' beats')+
          '" style="left:'+(7+92*(note.start/count))+'%;top:'+top+'px" aria-pressed="'+(note.id===activeNote)+'"><span class="sr-only">'+
          esc(SW.noteName(note.pitch))+'</span></button>';
      }).join('');
      return '<div class="session-view-toolbar"><strong>'+esc(part.name)+' · '+clef+' clef</strong>'+button('add-note','Add Note')+
        (selected?button('delete-note','Delete Note'):'')+'</div><div class="score-scroll"><div class="score-sheet" style="min-width:'+
        Math.min(3200,Math.max(480,count*64))+'px"><span class="score-clef">'+(clef==='Bass'?'𝄢':'𝄞')+'</span>'+ink+'</div></div>'+
        (selected?'<div class="session-view-toolbar">'+field('score-pitch','Pitch (MIDI)',selected.pitch,0,127,1)+
        field('score-at','Beat offset',selected.start,0,Math.max(0,part.length-.001))+field('score-length','Duration in beats',selected.length,.001,part.length)+
        field('score-velocity','Velocity',Math.round(selected.velocity*127),1,127,1)+'</div>':'');
    }
    function lyrics(p){
      const rows=SW.globalEntries(p,'lyrics');
      return rows.length?'<div class="session-view-toolbar"><button type="button" data-action="gear-play">Play / Stop</button></div><div class="session-lyrics">'+
        rows.map(row=>button('locate-lyric',row.name,'data-beat="'+row.at+'"')).join('')+'</div>':
        '<p class="session-view-info">Add lyric entries to the Lyrics Track in the Session.</p>';
    }
    function draw(){
      if(!view||!dialog.open)return;
      const p=api.project();
      $('session-view-title').textContent=titles[view];
      body.innerHTML=({launcher:()=>p.launcher?launcher(p):'',scratch:()=>scratch(p),patterns,score,
        lyrics:()=>lyrics(p),channel:api.channelView,monitor:api.monitorView})[view]();
      position(api.position());
    }
    function position(beat){
      if(view!=='lyrics'||!dialog.open)return;
      const active=SW.globalEntries(api.project(),'lyrics').findLast(row=>row.at<=beat&&beat<row.at+row.length);
      for(const button of body.querySelectorAll('[data-beat]'))button.setAttribute('aria-current',String(Number(button.dataset.beat)===active?.at));
    }
    function open(name){
      if(api.busy()||!Object.hasOwn(titles,name))return;
      if(view!==name&&name==='patterns'){steps=16;pattern=new Map();}
      view=name;
      if(name==='launcher'&&!api.project().launcher)
        edit(()=>{api.project().launcher={scenes:freshScenes(),playlist:[]};},'Created Launcher',false);
      if(!dialog.open)dialog.showModal();
      draw();
    }
    function apply(groups,insert){
      const result=ideaProgram(api.project(),groups);
      if(!result.length){status('Capture an event first.',true);return;}
      if(!insert)return api.preview(result.project,result.length);
      const start=api.position();
      if(start+result.length>100000)throw Error('The insertion exceeds the Session timeline.');
      edit(()=>{
        for(const track of result.project.tracks){
          const t=SW.findTrack(api.project(),track.id);
          if(t)for(const c of track.clips){c.start+=start;t.clips.push(c);}
        }
      },'Inserted into the Session timeline');
      dialog.close();
    }
    function playOrInsert(action,p,scene,track,pad){
      if(action.endsWith('-scene'))return apply([sceneRows(scene)],action.startsWith('insert-'));
      if(action==='play-cell')return apply([sceneRows(scene).filter(row=>row.track===track)],false);
      if(action.endsWith('-playlist'))return apply(p.launcher.playlist.map(id=>sceneRows(p.launcher.scenes.find(row=>row.id===id))),action.startsWith('insert-'));
      if(action.endsWith('-pad'))return apply([pad?.events||[]],action.startsWith('insert-'));
      const target=api.track();
      if(target?.type==='midi'){
        const clip=patternClip(target);
        if(clip.notes.length)return apply([[{track:target.id,clip}]],action.startsWith('insert-'));
      }
      status('Add some steps before playing.',true);
    }
    function perform(el){
      const p=api.project(), action=el.dataset.sessionViewAction, scene=p.launcher?.scenes.find(row=>row.id===el.closest('[data-scene]')?.dataset.scene);
      const track=el.closest('[data-idea-track]')?.dataset.ideaTrack;
      const pad=p.scratchPads?.find(row=>row.id===padId), part=api.editor()?.c;
      if(api.busy())return;
      if(action==='stop'){api.stop();return;}
      if(action.startsWith('play-')||action.startsWith('insert-'))return playOrInsert(action,p,scene,track,pad);
      if(action==='select-pad'){padId=el.dataset.pad;draw();return;}
      if(action==='step'){
        const key=el.dataset.pitch+':'+el.dataset.step;
        if(pattern.has(key))pattern.delete(key);else pattern.set(key,.8);
        el.textContent=pattern.has(key)?'●':'·';el.setAttribute('aria-pressed',pattern.has(key));return;
      }
      if(action==='capture-pattern'&&part?.type==='midi'){
        steps=clamp(Math.ceil(part.length*4),4,64);pattern=new Map();
        for(const note of part.notes)pattern.set(note.pitch+':'+Math.round(note.start*4),note.velocity);
        draw();return;
      }
      if(action==='choose-note'){
        activeNote=el.dataset.ideaId;draw();
        body.querySelector('[data-idea-id="'+activeNote+'"]')?.focus({preventScroll:true});return;
      }
      if(action==='locate-lyric'){api.seek(Number(el.dataset.beat));return;}
      if(action==='set-cell'){
        const captured=takeRows().find(row=>row.t.id===track)?.c;
        if(!captured||!scene){status('Select an event on this track before capturing to a cell.',true);return;}
        edit(()=>{scene.cells[track]=ideaClip(captured,0);},'Captured Launcher Cell',false);return;
      }
      if(action==='capture-pad'){
        const rows=takeRows();
        if(!rows.length||!pad){status('Select events to copy to the Scratch Pad.',true);return;}
        const start=Math.min(...rows.map(({c})=>c.start));
        edit(()=>{pad.events=rows.slice(0,512).map(({t,c})=>({track:t.id,clip:ideaClip(c,c.start-start)}));},'Copied events to Scratch Pad',false);
        return;
      }
      edit(()=>{
        if(action==='add-scene'&&p.launcher.scenes.length<32)p.launcher.scenes.push({id:uid(),name:'Scene '+(p.launcher.scenes.length+1),cells:{}});
        else if(action==='queue-scene'&&scene&&p.launcher.playlist.length<128)p.launcher.playlist.push(scene.id);
        else if(action==='remove-queue')p.launcher.playlist.splice(Number(el.dataset.index),1);
        else if(action==='remove-scene'&&scene){
          p.launcher.scenes=p.launcher.scenes.filter(row=>row!==scene);
          p.launcher.playlist=p.launcher.playlist.filter(id=>id!==scene.id);
        }else if(action==='remove-cell'&&scene&&track)delete scene.cells[track];
        else if(action==='add-pad'&&(p.scratchPads||[]).length<24){
          p.scratchPads??=[];const next={id:uid(),name:'Scratch Pad '+(p.scratchPads.length+1),events:[]};p.scratchPads.push(next);padId=next.id;
        }else if(action==='remove-pad'&&pad)p.scratchPads=p.scratchPads.filter(row=>row!==pad);
        else if(action==='remove-idea'&&pad)pad.events=pad.events.filter(row=>row.clip.id!==el.closest('[data-idea-id]')?.dataset.ideaId);
        else if(action==='add-note'&&part?.type==='midi'&&!part.locked){
          const start=clamp(api.position()-part.start,0,Math.max(0,part.length-.001));
          const note=SW.note(60,start,Math.min(1,part.length-start));part.notes.push(note);activeNote=note.id;
        }else if(action==='delete-note'&&part?.type==='midi'&&!part.locked)part.notes=part.notes.filter(note=>note.id!==activeNote);
      },'Updated '+titles[view],false);
    }
    function changeField(el){
      const p=api.project(), key=el.dataset.sessionViewField, value=el.value.trim();
      if(api.busy()||!value)return;
      if(key==='steps'||key==='octave'){
        if(!Number.isFinite(Number(value)))return;
        if(key==='steps')steps=clamp(Math.round(Number(value)),4,64);else octave=clamp(Math.round(Number(value)),12,108);
        draw();return;
      }
      const scene=p.launcher?.scenes.find(row=>row.id===el.closest('[data-scene]')?.dataset.scene),pad=p.scratchPads?.find(row=>row.id===padId);
      const part=api.editor()?.c, note=part?.notes.find(row=>row.id===activeNote), number=Number(value);
      edit(()=>{
        if(key==='scene-name'&&scene)scene.name=value.slice(0,120);
        else if(key==='pad-name'&&pad)pad.name=value.slice(0,120);
        else if(key==='pad-at'&&pad&&Number.isFinite(number)){
          const row=pad.events.find(row=>row.clip.id===el.closest('[data-idea-id]')?.dataset.ideaId);
          if(row)row.clip.start=clamp(number,0,99999);
        }else if(key.startsWith('score-')&&note&&!part.locked&&Number.isFinite(number)){
          const property=key.slice(6);
          if(property==='pitch')note.pitch=clamp(Math.round(number),0,127);
          if(property==='at')note.start=clamp(number,0,Math.max(0,part.length-note.length));
          if(property==='length')note.length=clamp(number,.001,part.length-note.start);
          if(property==='velocity')note.velocity=clamp(Math.round(number),1,127)/127;
        }
      },'Updated '+titles[view]);
    }
    function bind(){
      $('session-view-close').onclick=()=>dialog.close();
      dialog.addEventListener('close',()=>{api.stop();view='';});
      body.addEventListener('click',event=>{
        const button=event.target.closest('[data-session-view-action]');
        if(button)run(()=>perform(button));
      });
      body.addEventListener('change',event=>{
        if(event.target.dataset.sessionViewField)run(()=>changeField(event.target));
      });
      body.addEventListener('keydown',event=>{
        if(event.key!=='Delete'||event.target.matches('input,select,textarea')||api.busy())return;
        const rows={launcher:'[data-idea-track]',scratch:'[data-idea-id]',score:'[data-idea-id]'};
        if(!Object.hasOwn(rows,view))return;
        const row=event.target.closest(rows[view]);
        if(!row)return;
        const action={launcher:'remove-cell',scratch:'remove-idea',score:'delete-note'}[view];
        const button=row.querySelector('[data-session-view-action="'+action+'"]');
        if(view==='score')activeNote=row.dataset.ideaId;
        if(!button&&view!=='score')return;
        event.preventDefault();run(()=>perform(button||{dataset:{sessionViewAction:action},closest:()=>null}));
      });
    }
    return {open,draw,position,bind};
  }
  return {createSessionViews,validSessionIdeas,purgeTrackIdeas,ideaUsesAsset,ideaClip,ideaProgram,notationStep};
})());
