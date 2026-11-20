(function (SW) {
  const operations={
    'select-track':{label:'Select all events on current track',scope:['events','audio']},
    'event-snap':{label:'Snap event starts to grid',scope:['events','audio']},
    'event-align':{label:'Align earliest event to cursor',scope:['events','audio']},
    'event-split':{label:'Split at cursor',scope:['events','audio']},
    'event-duplicate':{label:'Duplicate selection',scope:['events','audio']},
    'event-mute':{label:'Mute events',scope:['events','audio']},
    'event-unmute':{label:'Unmute events',scope:['events','audio']},
    'loop-selection':{label:'Set loop to selection',scope:['events','audio']},
    'audio-gain':{label:'Adjust audio gain',scope:['events','audio'],range:[-24,24,0,.1],unit:'dB'},
    'audio-fade':{label:'Apply short fades',scope:['events','audio'],range:[1,500,10,1],unit:'ms'},
    'audio-clear-fades':{label:'Clear fades',scope:['events','audio']},
    'audio-reverse':{label:'Toggle reverse',scope:['events','audio']},
    'note-select-all':{label:'Select all notes in part',scope:['notes']},
    'note-quantize':{label:'Quantize note starts',scope:['notes'],range:[0,100,100,1],unit:'%'},
    'note-transpose':{label:'Transpose notes',scope:['notes'],range:[-48,48,12,1],unit:'semitones'},
    'note-velocity':{label:'Set note velocity',scope:['notes'],range:[1,127,100,1],unit:'MIDI'},
    'note-legato':{label:'Make notes legato',scope:['notes']},
    'note-staccato':{label:'Make notes staccato',scope:['notes']},
    'note-humanize':{label:'Humanize note timing and velocity',scope:['notes']},
    'note-mute':{label:'Toggle mute on notes',scope:['notes']}
  };
  const pages={events:'Arrangement',notes:'Note Editor',audio:'Audio Editor'};
  const factory=[
    {id:'tight-loop',name:'Snap and loop',scope:'events',steps:[{id:'event-snap'},{id:'loop-selection'}]},
    {id:'copy-at-cursor',name:'Duplicate and align',scope:'events',steps:[{id:'event-duplicate'},{id:'event-align'}]},
    {id:'level-fades',name:'Lower gain and add fades',scope:'audio',steps:[{id:'audio-gain',value:-3},{id:'audio-fade',value:10}]},
    {id:'note-cleanup',name:'Quantize and even out notes',scope:'notes',steps:[{id:'note-quantize',value:85},{id:'note-velocity',value:100}]},
    {id:'note-octave',name:'Octave up and legato',scope:'notes',steps:[{id:'note-transpose',value:12},{id:'note-legato'}]}
  ];
  function validateMacro(input){
    if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>70||
       !Object.hasOwn(pages,input.scope)||!Array.isArray(input.steps)||!input.steps.length||input.steps.length>32)
      throw Error('Give the macro a name and add between 1 and 32 commands.');
    const steps=input.steps.map(step=>{
      const op=Object.hasOwn(operations,step?.id)?operations[step.id]:null;
      if(!op||!op.scope.includes(input.scope))throw Error('A macro contains a command unavailable on its page.');
      if(!op.range)return {id:step.id};
      const [min,max,initial]=op.range;
      const value=step.value??initial;
      if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||Number.isInteger(op.range[3])&&!Number.isInteger(value))
        throw Error('A command value is out of range.');
      return {id:step.id,value};
    });
    return {id:typeof input.id==='string'&&/^[\w-]{1,80}$/.test(input.id)?input.id:SW.uid(),name:input.name.trim(),scope:input.scope,steps};
  }
  function applyMacro(source,raw,state,seed=Date.now()){
    const macro=validateMacro(raw);
    const p=SW.clone(source), track=p.tracks.find(t=>t.id===state.track);
    const part=track?.clips.find(c=>c.id===state.part), targetIds=new Set(state.clips), noteIds=new Set(state.notes);
    const cursor=SW.clamp(state.cursor,0,99999), step=state.grid||.25;
    let changed=false;
    function targets(){
      return p.tracks.flatMap(t=>t.clips.filter(c=>targetIds.has(c.id)&&!c.locked&&(macro.scope!=='audio'||c.type==='audio')).map(c=>({t,c})));
    }
    for(const {id,value} of macro.steps){
      if(id.startsWith('note-')){
        if(part?.type!=='midi'||part.locked)throw Error('Select an unlocked instrument part.');
        if(id==='note-select-all'){for(const n of part.notes)noteIds.add(n.id);continue;}
        const notes=noteIds.size?part.notes.filter(n=>noteIds.has(n.id)):part.notes;
        if(!notes.length)throw Error('Select notes or open an instrument part that contains notes.');
        const previous=JSON.stringify(notes);
        SW.noteEdit(notes,part.length,id.slice(5),{step,strength:id==='note-quantize'?value/100:1,semitones:value,velocity:value/127,seed});
        changed||=JSON.stringify(notes)!==previous;
        continue;
      }
      if(id==='select-track'){targetIds.clear();for(const c of track?.clips||[])targetIds.add(c.id);continue;}
      const rows=targets(), editable=id.startsWith('audio-')?rows.filter(({c})=>c.type==='audio'):rows;
      if(!editable.length)throw Error(id.startsWith('audio-')?'Select an unlocked audio event.':'Select an unlocked event or instrument part.');
      const left=Math.min(...editable.map(({c})=>c.start));
      const right=Math.max(...editable.map(({c})=>c.start+c.length));
      if(id==='loop-selection'){
        const range=SW.clamp(right,0,100000);
        if(range<=left)throw Error('The selection is outside the loop range.');
        changed||=!p.loop||p.loopStart!==left||p.loopEnd!==range;
        p.loop=true;p.loopStart=left;p.loopEnd=range;continue;
      }
      if(id==='event-split'||id==='event-duplicate'){
        const additions=[];
        for(const {t,c} of editable){
          const next=id==='event-split'?SW.splitClip(c,cursor):SW.shiftClip(c,right-left);
          if(next){t.clips.push(next);additions.push(next);}
        }
        if(!additions.length)throw Error('Place the cursor inside an event to split it.');
        targetIds.clear();for(const c of additions)targetIds.add(c.id);
        changed=true;continue;
      }
      for(const {c} of editable){
        const before=[c.start,c.fadeIn,c.fadeOut,c.gain,Boolean(c.muted),Boolean(c.reverse)];
        if(id==='event-align')c.start=SW.clamp(cursor+c.start-left,0,99999);
        if(id==='event-snap')c.start=SW.clamp(SW.quantize(c.start,step),0,99999);
        if(id==='event-mute'||id==='event-unmute')c.muted=id==='event-mute';
        if(id==='audio-gain')c.gain=SW.clamp(c.gain+value,-60,24);
        if(id==='audio-fade')c.fadeIn=c.fadeOut=Math.min(c.length/2,value*p.bpm/60000);
        if(id==='audio-clear-fades')c.fadeIn=c.fadeOut=0;
        if(id==='audio-reverse'){
          const available=p.assets[c.asset].duration*c.sourceBpm/60;
          c.offset=Math.max(0,available-c.offset-c.length);c.reverse=!c.reverse;
        }
        changed||=before.some((v,i)=>v!==[c.start,c.fadeIn,c.fadeOut,c.gain,Boolean(c.muted),Boolean(c.reverse)][i]);
      }
    }
    return {project:p,clips:[...targetIds],notes:[...noteIds],changed};
  }
  function eventMenu(scope){
    const common=[['cut','Cut'],['copy','Copy'],['paste-original','Paste at original position'],['event-delete','Delete event']];
    const timing=[['event-rename','Rename…'],['split','Split at cursor'],['event-split-click','Split at pointer'],['duplicate','Duplicate'],['repeat','Repeat…'],['event-loop','Set loop to selection'],['mute-event','Mute / unmute'],['lock-event','Lock / unlock']];
    if(scope==='notes')return [
      ['Edit',[['note-cut','Cut notes'],['note-copy','Copy notes'],['note-paste','Paste notes'],
        ['note-paste-original','Paste at original beat'],['note-duplicate','Duplicate notes'],['note-delete','Delete notes']]],
      ['Selection',[['note-all','Select all notes'],['note-invert-selection','Invert selection'],['note-select-muted','Select muted notes']]],
      ['Pitch',[['note-transpose','Transpose by semitones…'],['note-up-oct','Up one octave'],['note-down-oct','Down one octave'],
        ['note-scale','Apply scale'],['note-invert','Invert melody']]],
      ['Timing',[['note-quantize','Quantize starts'],['note-quantize-end','Quantize ends'],['note-swing','Apply swing…'],
        ['note-split','Split at playhead'],['note-legato','Legato'],['note-staccato','Staccato'],['note-length','Set to grid length'],
        ['note-trim-overlaps','Trim same-pitch overlaps']]],
      ['Performance',[['note-velocity','Set velocity…'],['note-accent','Accent notes'],['note-humanize','Humanize'],
        ['note-reverse','Reverse notes'],['note-mute','Mute notes']]]
    ];
    const commands=scope==='events'?[]:scope==='audio'?
      [['Audio Functions',[['open-event-editor','Open Audio Editor'],['event-gain','Set event gain…'],['normalize','Normalize'],['reverse','Reverse'],['fade-both','Create short fades'],['reset-fades','Clear fades'],['crossfade','Crossfade overlaps'],['detect-stops','Split at silence'],['slip-left','Slip left'],['slip-right','Slip right'],['merge','Bounce selection'],['event-find-pool','Select in Pool']]]]:
      [['Instrument Part',[['open-event-editor','Open Note Editor'],['event-open-expression','Open MIDI Automation'],['part-quantize','Quantize note starts'],['part-transpose','Transpose part…'],['part-velocity','Set part velocity…'],['part-humanize','Humanize part'],['merge','Merge parts']]]];
    return [['Edit',common],['Event',timing],...commands,['Export',[['export-selection',scope==='audio'?'Export audio selection…':'Export MIDI selection…']]]];
  }
  Object.assign(SW,{macroOperations:operations,macroPages:pages,factoryMacros:factory,validateMacro,applyMacro,eventMenu});
})(SW);
