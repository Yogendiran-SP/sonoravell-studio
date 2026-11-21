'use strict';
Object.assign(SW, (() => {
  const {clone,uid,clip,clamp,splitClip,automationValue,quantize,songEnd}=SW;
  const noteKeys=Object.freeze({
    KeyA:0,KeyW:1,KeyS:2,KeyE:3,KeyD:4,KeyF:5,KeyT:6,KeyG:7,
    KeyY:8,KeyH:9,KeyU:10,KeyJ:11,KeyK:12,KeyO:13,KeyL:14,KeyP:15,Semicolon:16,Quote:17
  });
  const effectCategories={
    EQ:['Spectrum EQ','Parametric EQ','Low Cut','Low Pass','High Shelf','Low Shelf','Band Pass','Notch','Three-Band EQ'],
    Dynamics:['Compressor','Limiter','Parallel Compressor'],
    Space:['Echo','Room Reverb','Slap Delay','Hall Reverb'],
    Modulation:['Chorus','Tremolo','Flanger','Phaser','Auto Pan'],
    Color:['Guitar Pedalboard','Drive','Soft Clipper','Bit Reducer','Cabinet Filter'],
    Utility:['Utility Gain','Stereo Width','Polarity']
  };
  const presets={
    'Vocal cleanup':[['Low Cut',{frequency:82}],['Parametric EQ',{frequency:350,gain:-2.5,q:1.2}],['Compressor',{threshold:-21,ratio:3.1}]],
    'Vocal space':[['Echo',{time:.125,feedback:.2,mix:.13}],['Room Reverb',{mix:.18}]],
    'Guitar cabinet':[['Drive',{amount:.47}],['Cabinet Filter',{high:4100,low:83}]],
    'Mix safety':[['High Shelf',{frequency:8500,gain:.8}],['Limiter',{threshold:-2.5}]]
  };
  const gridModes={straight:1,triplet:2/3,dotted:1.5};
  function shiftClip(c,offset){
    const copy=clone(c);
    copy.id=uid();
    copy.start=clamp(c.start+offset,0,99999);
    copy.notes.forEach(n=>n.id=uid());
    return copy;
  }
  function sliceClip(c,from,to){
    const start=Math.max(c.start,from), end=Math.min(c.start+c.length,to);
    if(end-start<.001) return null;
    const tmp=clone(c);
    const left=splitClip(tmp,start);
    const result=left||tmp;
    splitClip(result,end);
    result.id=uid();
    result.notes.forEach(n=>n.id=uid());
    return result;
  }
  function deleteRange(p,from,to,trackId,ripple=false){
    if(to-from<.001) return;
    const delta=to-from;
    if(!ripple&&!trackId) return;
    for(const t of p.tracks){
      if(!ripple&&t.id!==trackId) continue;
      t.clips=t.clips.flatMap(c=>{
        if(c.start>=to){
          if(ripple&&!c.locked) c.start-=delta;
          return [c];
        }
        if(c.start+c.length<=from||c.locked) return [c];
        const before=sliceClip(c,0,from), after=sliceClip(c,to,c.start+c.length);
        if(after&&ripple) after.start-=delta;
        return [before,after].filter(Boolean);
      });
    }
    if(!ripple) return;
    const shift=at=>at>=to?at-delta:Math.min(at,from);
    p.markers=p.markers.filter(m=>m.at<from||m.at>=to).map(m=>({...m,at:shift(m.at)}));
    SW.rippleGlobalTracks?.(p,from,to);
    p.loopStart=shift(p.loopStart);
    p.loopEnd=Math.max(p.loopStart+.001,shift(p.loopEnd));
    for(const t of [...p.tracks,p.master]){
      for(const [key,pts] of Object.entries(t.lanes)){
        if(!pts.length) continue;
        const tail=pts.filter(pt=>pt.at>to).map(pt=>({...pt,at:shift(pt.at)}));
        t.lanes[key]=[...pts.filter(pt=>pt.at<from),{at:from,value:automationValue(pts,to,0)},...tail];
      }
    }
  }
  function mergeNotes(items){
    const start=items.reduce((n,c)=>Math.min(n,c.start),Infinity);
    const end=items.reduce((n,c)=>Math.max(n,c.start+c.length),0);
    const joined=clip('midi',start,end-start,items[0].name+' merged');
    joined.name=joined.name.slice(0,120);
    joined.notes=items.flatMap(c=>c.muted?[]:c.notes.filter(n=>!n.muted).map(n=>({...n,id:uid(),start:n.start+c.start-start})));
    for(const c of items.filter(item=>!item.muted).sort((a,b)=>a.start-b.start)){
      for(const [key,points] of Object.entries(c.expression||{})){
        for(const point of points)SW.setExpression(joined,key,c.start-start+point.at,point.value);
        if(key==='cc64'&&points.at(-1)?.value>=64)SW.setExpression(joined,key,c.start-start+c.length,0);
      }
    }
    return joined;
  }
  function noteEdit(notes,length,operation,{step=.25,strength=1,semitones=0,velocity=.8,seed=7651}={}){
    const snap=step||.25;
    const shift=delta=>{
      for(const n of notes) n.start=clamp(n.start+delta,0,Math.max(0,length-n.length));
    };
    function random(){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      return seed/4294967296-.5;
    }
    const first=notes.reduce((at,n)=>Math.min(at,n.start),Infinity);
    const end=notes.reduce((at,n)=>Math.max(at,n.start+n.length),0);
    for(const n of notes){
      const maxStart=Math.max(0,length-n.length);
      switch(operation){
        case 'quantize': n.start=clamp(n.start+(quantize(n.start,snap)-n.start)*strength,0,maxStart);break;
        case 'legato': {
          const next=notes.reduce((at,k)=>k.start>n.start+.0001?Math.min(at,k.start):at,length);
          n.length=Math.max(.001,next-n.start);
          break;
        }
        case 'staccato': n.length=Math.max(.001,n.length*.5);break;
        case 'fixed-length': n.length=Math.max(.001,Math.min(snap,length-n.start));break;
        case 'velocity': n.velocity=velocity;break;
        case 'accent': n.velocity=clamp(n.velocity*1.25,1/127,1);break;
        case 'humanize':
          n.start=clamp(n.start+random()*.04,0,maxStart);
          n.velocity=clamp(n.velocity+random()*.13,1/127,1);
          break;
        case 'transpose': n.pitch=clamp(n.pitch+semitones,0,127);break;
        case 'reverse': n.start=clamp(first+end-n.start-n.length,0,maxStart);break;
        case 'mute': n.muted=!n.muted;break;
      }
    }
    if(operation==='nudge-left') shift(-snap);
    if(operation==='nudge-right') shift(snap);
  }
  function markerRanges(p,kind,ids,selection){
    const markers=[...p.markers].sort((a,b)=>a.at-b.at);
    const range=(from,to,name)=>({from,to,name});
    switch(kind){
      case 'loop':return [range(p.loopStart,p.loopEnd,'Loop')];
      case 'selection':return selection?[range(selection.from,selection.to,'Selection')]:[];
      case 'markers':{
        const a=markers.find(m=>m.id===ids[0]),b=markers.find(m=>m.id===ids[1]);
        return a&&b&&a.at<b.at?[range(a.at,b.at,a.name+' – '+b.name)]:[];
      }
      case 'each':return markers.slice(0,-1).map((m,i)=>range(m.at,markers[i+1].at,m.name)).filter(r=>r.to>r.from);
      case 'bounds':{
        const a=markers.find(m=>m.name.toLowerCase()==='start'),b=markers.find(m=>m.name.toLowerCase()==='end');
        return [range(a?.at??0,b?.at??songEnd(p),'Session bounds')].filter(r=>r.to>r.from);
      }
      default:{
        const all=p.tracks.flatMap(t=>t.clips);
        if(!all.length) return [];
        return [range(all.reduce((a,c)=>Math.min(a,c.start),Infinity),all.reduce((a,c)=>Math.max(a,c.start+c.length),0),'Session')];
      }
    }
  }
  function speakerChannels(buffer,layout){
    const [left,right=left]=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
    const data=arr=>({numberOfChannels:arr.length,sampleRate:buffer.sampleRate,length:buffer.length,getChannelData:i=>arr[i]});
    if(layout==='mono') return [['',data([left.map((v,i)=>(v+right[i])*.5)])]];
    if(layout==='split') return [[' L',data([left])],[' R',data([right])]];
    return [['',buffer]];
  }
  function applyPeak(buffer,db){
    let peak=0;
    const arrays=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
    for(const data of arrays) for(const v of data) peak=Math.max(peak,Math.abs(v));
    const gain=SW.db(db)/peak;
    if(peak>0&&Number.isFinite(gain)) for(const data of arrays) for(let i=0;i<data.length;i++) data[i]*=gain;
  }
  function locatorText(position,meter){
    const ticks=Math.round(position*960);
    const beat=Math.floor(ticks/960);
    return String(1+Math.floor(beat/meter)).padStart(3,'0')+'.'+(1+beat%meter)+'.'+String(ticks%960).padStart(3,'0');
  }
  function parseLocator(text,meter){
    const match=/^(\d{1,6})(?:[.:](\d{1,2})(?:[.:](\d{1,3}))?)?$/.exec(text.trim());
    if(!match) return null;
    const bar=Number(match[1]),beat=Number(match[2]??1),tick=Number(match[3]??0);
    if(bar<1||beat<1||beat>meter||tick>=960)return null;
    const position=(bar-1)*meter+beat-1+tick/960;
    return position<=100000?position:null;
  }
  return {locatorText,parseLocator,noteKeys,effectCategories,presets,gridModes,shiftClip,sliceClip,deleteRange,mergeNotes,noteEdit,markerRanges,speakerChannels,applyPeak};
})());
