'use strict';
Object.assign(SW, (() => {
  const {clamp,quantize,uid}=SW;
  const noteMinimum=.001;
  const pianoScales=Object.freeze({
    chromatic:['Chromatic',[0,1,2,3,4,5,6,7,8,9,10,11]],major:['Major',[0,2,4,5,7,9,11]],
    minor:['Natural minor',[0,2,3,5,7,8,10]],harmonic:['Harmonic minor',[0,2,3,5,7,8,11]],
    dorian:['Dorian',[0,2,3,5,7,9,10]],mixolydian:['Mixolydian',[0,2,4,5,7,9,10]],
    majorPent:['Major pentatonic',[0,2,4,7,9]],minorPent:['Minor pentatonic',[0,3,5,7,10]],
    blues:['Blues',[0,3,5,6,7,10]]
  });
  const inScale=(pitch,root,scale)=>(pianoScales[scale]||pianoScales.chromatic)[1].includes((pitch-root+120)%12);
  function scalePitch(value,root,scale){
    const pitch=clamp(Math.round(value),0,127);
    for(let d=0;d<12;d++){
      if(pitch-d>=0&&inScale(pitch-d,root,scale))return pitch-d;
      if(pitch+d<=127&&inScale(pitch+d,root,scale))return pitch+d;
    }
    return pitch;
  }
  function moveNotes(group,span,delta,pitches=0){
    let minAt=-span,maxAt=span,minPitch=-127,maxPitch=127;
    for(const n of group){
      minAt=Math.max(minAt,-n.start);
      maxAt=Math.min(maxAt,span-n.start-n.length);
      minPitch=Math.max(minPitch,-n.pitch);maxPitch=Math.min(maxPitch,127-n.pitch);
    }
    const dt=clamp(delta,minAt,Math.max(minAt,maxAt)), dp=clamp(Math.round(pitches),minPitch,maxPitch);
    return group.map(n=>({...n,start:Math.max(0,n.start+dt),pitch:n.pitch+dp}));
  }
  function trimNotes(group,span,delta,edge){
    if(!group.length)return [];
    let low=-span,high=span;
    for(const n of group){
      const minimum=Math.min(noteMinimum,n.length);
      if(edge==='left'){
        low=Math.max(low,-n.start);high=Math.min(high,n.length-minimum);
      }else{
        low=Math.max(low,minimum-n.length);high=Math.min(high,span-n.start-n.length);
      }
    }
    const amount=clamp(delta,low,Math.max(low,high));
    return group.map(n=>edge==='left'?{...n,start:Math.max(0,n.start+amount),length:n.length-amount}:
      {...n,length:n.length+amount});
  }
  function pasteNotes(group,span,position,original=false){
    if(!group.length)return [];
    const first=group.reduce((at,n)=>Math.min(at,n.start),Infinity);
    const end=group.reduce((at,n)=>Math.max(at,n.start+n.length),0);
    // Keep the rhythm of the whole phrase and reject pastes that cannot fit in the destination part.
    if(end-first>span+1e-7)return [];
    const at=original?first:clamp(position,0,Math.max(0,span-(end-first)));
    if(at+end-first>span+1e-7)return [];
    return group.map(n=>({...n,id:uid(),start:at+(n.start-first)}));
  }
  function processPianoNotes(clip,selected,action,options={}){
    const picked=new Set(selected), group=clip.notes.filter(n=>picked.has(n.id));
    const grid=options.grid||.25, strength=options.strength??1;
    const root=options.root??0, scale=options.scale||'chromatic', at=options.at??0;
    let selection=selected, edits=new Map();
    if(action==='split'){
      for(const n of group){
        const end=n.start+n.length;
        if(at<=n.start+noteMinimum||at>=end-noteMinimum)continue;
        const right={...n,id:uid(),start:at,length:end-at};
        edits.set(n.id,[{...n,length:at-n.start},right]);
      }
      selection=group.flatMap(n=>edits.get(n.id)?.map(note=>note.id)||[n.id]);
    }else if(action==='nudge-left'||action==='nudge-right'){
      const result=moveNotes(group,clip.length,action==='nudge-left'?-grid:grid);
      for(const n of result)edits.set(n.id,[n]);
    }else{
      const anchor=[...group].sort((a,b)=>a.start-b.start||a.pitch-b.pitch)[0]?.pitch??0;
      const nextByPitch=new Map();
      if(action==='trim-overlaps'){
        const last=new Map();
        for(const n of [...clip.notes].sort((a,b)=>b.start-a.start)){
          const next=last.get(n.pitch);
          if(next!==undefined)nextByPitch.set(n.id,next);
          last.set(n.pitch,n.start);
        }
      }
      const copies=group.map(n=>({...n}));
      if(action==='quantize-end'||action==='swing'||action==='scale'||action==='invert'||action==='trim-overlaps'){
        for(const n of copies){
          const min=Math.min(noteMinimum,n.length), max=clip.length-n.start;
          if(action==='quantize-end'){
            const end=n.start+n.length, snapped=quantize(end,grid);
            n.length=clamp(end+(snapped-end)*strength-n.start,min,Math.max(min,max));
          }
          if(action==='swing'){
            const cell=Math.round(n.start/grid);
            const target=cell*grid+(cell%2?grid*.5*(options.swing??.55):0);
            n.start=clamp(n.start+(target-n.start)*strength,0,Math.max(0,clip.length-n.length));
          }
          if(action==='scale')n.pitch=scalePitch(n.pitch,root,scale);
          if(action==='invert')n.pitch=clamp(2*anchor-n.pitch,0,127);
          if(action==='trim-overlaps'){
            const next=nextByPitch.get(n.id);
            if(next>n.start&&next<n.start+n.length)n.length=Math.max(min,next-n.start);
          }
        }
      }else SW.noteEdit(copies,clip.length,action,{step:grid,strength,semitones:options.semitones,velocity:options.velocity,seed:options.seed});
      for(const n of copies)edits.set(n.id,[n]);
    }
    let changed=false;
    const notes=clip.notes.flatMap(n=>{
      const update=edits.get(n.id);
      if(!update)return [n];
      changed||=update.length!==1||['start','pitch','length','velocity','muted'].some(key=>n[key]!==update[0][key]);
      return update;
    });
    return {notes,selection,changed};
  }
  return {pianoScales,inScale,scalePitch,moveNotes,trimNotes,pasteNotes,processPianoNotes};
})());
