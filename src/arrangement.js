'use strict';
Object.assign(SW, (() => {
  const globalTrackKinds=Object.freeze({
    markers:{label:'Markers',entry:'Marker',glyph:'⚑',color:'#69bca6',length:false},
    arranger:{label:'Arranger',entry:'Section',glyph:'▤',color:'#dba76c',length:true},
    chords:{label:'Chords',entry:'Chord',glyph:'♯',color:'#83b9ef',length:true},
    lyrics:{label:'Lyrics',entry:'Lyric',glyph:'¶',color:'#c2a1e7',length:true},
    tempo:{label:'Tempo guides',entry:'Tempo guide',glyph:'◴',color:'#db8c9b',length:false},
    signature:{label:'Signature guides',entry:'Signature guide',glyph:'♮',color:'#a8c68c',length:false}
  });
  const timelineLimit=100000;
  const loopMinimum=.001;
  function globalEntries(project,kind){
    if(kind==='markers')return project.markers;
    return Object.hasOwn(globalTrackKinds,kind)?project.globalTracks?.[kind]||[]:[];
  }
  function validGlobalEntry(kind,item){
    const spec=globalTrackKinds[kind];
    if(!spec||!item||!Number.isFinite(item.at)||item.at<0||item.at>timelineLimit)return false;
    if(typeof item.name!=='string'||!item.name.trim()||item.name.length>240)return false;
    if(spec.length&&(!Number.isFinite(item.length)||item.length<loopMinimum-1e-8||item.at+item.length>timelineLimit+1e-8))return false;
    if(kind==='tempo')return Number.isFinite(item.bpm)&&item.bpm>=30&&item.bpm<=320;
    if(kind==='signature')return Number.isInteger(item.meter)&&item.meter>=2&&item.meter<=12&&
      [2,4,8,16].includes(item.denominator)&&typeof item.key==='string'&&item.key.length<=32;
    return true;
  }
  function loopBounds(mode,start,end,at,anchor=start){
    const span=end-start;
    switch(mode){
      case 'left':return [SW.clamp(at,0,end-loopMinimum),end];
      case 'right':return [start,SW.clamp(at,start+loopMinimum,timelineLimit)];
      case 'move':{
        const left=SW.clamp(start+at-anchor,0,timelineLimit-span);
        return [left,left+span];
      }
      default:{
        const left=Math.min(at,anchor,timelineLimit-loopMinimum);
        return [left,Math.max(left+loopMinimum,at,anchor)];
      }
    }
  }
  function arrangeEntryBounds(mode,item,at,anchor){
    if(mode!=='move'){
      const [start,end]=loopBounds(mode,item.at,item.at+item.length,at);
      return {at:start,length:end-start};
    }
    return {at:SW.clamp(item.at+at-anchor,0,timelineLimit-(item.length||0)),...(item.length?{length:item.length}:{})};
  }
  function activeGlobalEntry(entries,at){
    let current=null;
    for(const item of entries)if(item.at<=at&&(!item.length||at<item.at+item.length)&&(!current||item.at>=current.at))current=item;
    return current;
  }
  function rippleGlobalTracks(p,from,to){
    if(!p.globalTracks)return;
    const shift=at=>at>=to?at-(to-from):Math.min(at,from);
    for(const [kind,entries] of Object.entries(p.globalTracks)){
      p.globalTracks[kind]=entries.flatMap(item=>{
        if(!item.length)return item.at>=from&&item.at<to?[]:[{...item,at:shift(item.at)}];
        const at=shift(item.at),length=shift(item.at+item.length)-at;
        return length>=loopMinimum?[{...item,at,length}]:[];
      });
    }
  }
  return {globalTrackKinds,globalEntries,validGlobalEntry,loopBounds,arrangeEntryBounds,activeGlobalEntry,rippleGlobalTracks};
})());
