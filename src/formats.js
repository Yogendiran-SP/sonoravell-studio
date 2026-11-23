'use strict';
Object.assign(SW, (() => {
  const {clamp,validRoute,instruments}=SW;
  const encode = new TextEncoder();
  function wav(buffer,bits=24,{dither=false,tags={},channelMask=0}={}) {
    const channels=buffer.numberOfChannels, bytes=bits/8, size=buffer.length*channels*bytes;
    const fields={title:'INAM',artist:'IART',album:'IPRD',comment:'ICMT',bpm:'IBPM'};
    const items=Object.entries(fields).filter(([key])=>tags[key]).map(([key,code])=>[code,encode.encode(String(tags[key]).slice(0,200)+'\0')]);
    const infoSize=items.length?4+items.reduce((sum,[,value])=>sum+8+value.length+value.length%2,0):0;
    const padding=size%2, metadata=infoSize?8+infoSize:0;
    const extended=channels>2||channelMask!==0;
    const dataStart=extended?68:44;
    const out=new ArrayBuffer(dataStart+size+padding+metadata), view=new DataView(out);
    function tag(at,str){ for(let i=0;i<str.length;i++) view.setUint8(at+i,str.charCodeAt(i)); }
    tag(0,'RIFF');view.setUint32(4,out.byteLength-8,true);tag(8,'WAVE');tag(12,'fmt ');
    view.setUint32(16,extended?40:16,true);view.setUint16(20,extended?0xfffe:bits===32?3:1,true);view.setUint16(22,channels,true);
    view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*bytes,true);
    view.setUint16(32,channels*bytes,true);view.setUint16(34,bits,true);
    if(extended){
      view.setUint16(36,22,true);view.setUint16(38,bits,true);view.setUint32(40,channelMask,true);
      const guid=[bits===32?3:1,0,0,0,0,0,0x10,0,0x80,0,0,0xaa,0,0x38,0x9b,0x71];
      new Uint8Array(out,44,16).set(guid);
    }
    tag(dataStart-8,'data');view.setUint32(dataStart-4,size,true);
    const data=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));
    let seed=71023;
    const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let frame=0, at=dataStart;frame<buffer.length;frame++) for(let c=0;c<channels;c++,at+=bytes) {
      const value=data[c][frame];
      if(bits===32){ view.setFloat32(at,value,true); continue; }
      const s=clamp(value+(dither?(noise()-noise())/2**(bits-1):0),-1,1);
      const n=Math.round(s*(s<0?2**(bits-1):2**(bits-1)-1));
      if(bits===16) view.setInt16(at,n,true);
      else {view.setUint8(at,n&255);view.setUint8(at+1,(n>>8)&255);view.setUint8(at+2,(n>>16)&255);}
    }
    if(infoSize){
      let at=dataStart+size+padding;
      tag(at,'LIST');view.setUint32(at+4,infoSize,true);tag(at+8,'INFO');at+=12;
      for(const [code,value] of items){
        tag(at,code);view.setUint32(at+4,value.length,true);
        new Uint8Array(out,at+8,value.length).set(value);
        at+=8+value.length+value.length%2;
      }
    }
    return out;
  }
  function bytesToBase64(bytes) {
    const data=new Uint8Array(bytes);
    if(data.toBase64) return data.toBase64();
    let str='';
    for(let i=0;i<data.length;i+=0x8000) str+=String.fromCharCode(...data.subarray(i,i+0x8000));
    return btoa(str);
  }
  function base64ToBytes(str) {
    if(Uint8Array.fromBase64) return Uint8Array.fromBase64(str).buffer;
    return Uint8Array.from(atob(str),ch=>ch.charCodeAt(0)).buffer;
  }
  function encodeProject(p,media) {
    const keys=Object.keys(p.assets);
    return JSON.stringify({format:'Sonoravell',project:p,media:Object.fromEntries(keys.map(id=>{
      const entry=media.get(id);
      if(!entry) throw Error('Missing audio: '+p.assets[id].name);
      return [id,bytesToBase64(entry.bytes)];
    }))});
  }
  function validateProject(p) {
    const finite=(n,lo,hi)=>Number.isFinite(n)&&n>=lo&&n<=hi;
    const name=s=>typeof s==='string'&&s.length<=512;
    const id=s=>typeof s==='string'&&/^[\w-]{1,100}$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
    const assertion=(condition,msg)=>{if(!condition) throw Error('Invalid session: '+msg);};
    assertion(p?.version===1&&name(p.name)&&finite(p.bpm,30,320)&&Number.isInteger(p.meter)&&finite(p.meter,2,12),'version, name or tempo');
    assertion(p.artist===undefined||typeof p.artist==='string'&&p.artist.length<=100,'session artist');
    assertion(finite(p.loopStart,0,100000)&&finite(p.loopEnd,p.loopStart+.001,100000),'loop range');
    assertion(p.assets&&typeof p.assets==='object'&&!Array.isArray(p.assets)&&Array.isArray(p.tracks)&&Array.isArray(p.markers)&&p.master?.id==='master','session structure');
    for(const [key,a] of Object.entries(p.assets)) assertion(id(key)&&name(a?.name)&&finite(a.duration,.000001,86400),'audio metadata');
    const ids=new Set();
    const checkId=(value)=>{assertion(id(value)&&!ids.has(value),'duplicate or invalid identifier');ids.add(value);};
    const cueIds=new Set();
    if(p.cues!==undefined){
      assertion(Array.isArray(p.cues)&&p.cues.length<=16,'cue outputs');
      for(const cue of p.cues){
        checkId(cue.id);cueIds.add(cue.id);
        assertion(name(cue.name)&&finite(cue.volume,-60,6),'cue configuration');
      }
    }
    assertion(!p.monitorCue||cueIds.has(p.monitorCue),'missing cue monitor');
    assertion(p.spatialMonitor===undefined||['stereo','binaural'].includes(p.spatialMonitor),'monitor format');
    const folderIds=new Set();
    if(p.folders!==undefined){
      assertion(Array.isArray(p.folders)&&p.folders.length<=256,'folders');
      const buses=new Set();
      for(const folder of p.folders){
        checkId(folder.id);folderIds.add(folder.id);
        assertion(name(folder.name)&&(!folder.bus||p.tracks.some(t=>t.type==='bus'&&t.id===folder.bus)&&!buses.has(folder.bus)),'folder bus or name');
        if(folder.bus)buses.add(folder.bus);
        assertion(folder.color===undefined||/^#[0-9a-f]{6}$/i.test(folder.color),'folder color');
      }
    }
    if(p.flowPositions!==undefined){
      assertion(p.flowPositions&&!Array.isArray(p.flowPositions)&&typeof p.flowPositions==='object','signal flow positions');
      for(const [key,pos] of Object.entries(p.flowPositions)){
        assertion(/^[a-zA-Z0-9_:-]{1,220}$/.test(key)&&finite(pos?.x,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)&&finite(pos?.y,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),'signal flow position');
      }
    }
    for(const m of p.markers){checkId(m.id);assertion(finite(m.at,0,100000)&&name(m.name),'marker');}
    if(p.globalTracks!==undefined){
      assertion(p.globalTracks&&typeof p.globalTracks==='object'&&!Array.isArray(p.globalTracks),'global tracks');
      for(const [kind,items] of Object.entries(p.globalTracks)){
        assertion(kind!=='markers'&&Object.hasOwn(SW.globalTrackKinds,kind)&&Array.isArray(items)&&items.length<=4096,'global track');
        for(const item of items){
          assertion(SW.validGlobalEntry(kind,item),'global track event');
          checkId(item.id);
        }
      }
    }
    for(const t of [p.master,...p.tracks]) {
      checkId(t.id);
      assertion(t.icon===undefined||Object.hasOwn(SW.trackIcons||{},t.icon),'track icon');
      assertion(name(t.name)&&/^#[0-9a-f]{6}$/i.test(t.color)&&finite(t.volume,-60,6)&&finite(t.pan,-1,1)&&['Off','Read','Touch','Latch','Write'].includes(t.automation),'channel parameters');
      assertion((t===p.master?t.type==='master':['audio','midi','bus'].includes(t.type))&&Array.isArray(t.fx)&&Array.isArray(t.clips)&&t.lanes&&typeof t.lanes==='object'&&Object.hasOwn(instruments,t.instrument)&&finite(t.transpose,-36,36),'channel structure');
      assertion(typeof t.out==='string'&&typeof t.send==='string'&&finite(t.sendLevel,-60,6)&&(!t.sample||Object.hasOwn(p.assets,t.sample)),'channel routing or sample');
      assertion(t.trim===undefined||finite(t.trim,-24,24),'input trim');
      assertion(t.sends===undefined||Array.isArray(t.sends)&&t.sends.every(s=>id(s?.to)&&finite(s.level,-60,6)),'aux sends');
      if(t.synth){
        const controls=SW.instrumentSpecs(t.instrument);
        assertion(typeof t.synth==='object'&&Object.entries(t.synth).every(([key,value])=>{
          if(key==='wave') return ['sine','triangle','sawtooth','square'].includes(value);
          const spec=controls[key];
          return spec&&finite(value,spec[1],spec[2]);
        }),'instrument controls');
      }
      if(t.spatial){
        assertion(['stereo','bed','object'].includes(t.spatial.mode),'spatial mode');
        for(const [key,spec] of Object.entries(SW.spatialSpecs)) assertion(finite(t.spatial[key],spec[1],spec[2]),'spatial field');
      }
      if(t.cueSends!==undefined){
        assertion(Array.isArray(t.cueSends)&&t.cueSends.length<=16&&t.cueSends.every(s=>cueIds.has(s?.to)&&finite(s.level,-60,6)&&finite(s.pan,-1,1)),'cue sends');
      }
      for(const e of t.fx){
        checkId(e.id);
        assertion(SW.validEffectParams(e.type,e.params),'effect parameters');
      }
      assertion(t.instrumentDisabled===undefined||t.type==='midi'&&typeof t.instrumentDisabled==='boolean','instrument state');
      assertion(t.instrumentOnly===undefined||t.type==='midi'&&t.instrumentOnly===true&&!t.clips.length&&!t.folder,'retained instrument state');
      assertion(t.recordChannels===undefined||t.type==='audio'&&[1,2].includes(t.recordChannels),'recording channels');
      assertion(t.patch===undefined||SW.validSerial(t,t.patch),'channel patch has a cycle or incompatible port');
      assertion(!t.folder||folderIds.has(t.folder)&&(t.type==='audio'||t.type==='midi'),'folder membership');
      assertion(t.folderOut===undefined||typeof t.folderOut==='string','folder output');
      assertion(t.inputDevice===undefined||t.inputDevice===''||name(t.inputDevice),'input device');
      assertion(t.sourceInput===undefined||name(t.sourceInput),'input source');
      const specs=SW.laneSpecs(t);
      for(const [key,points] of Object.entries(t.lanes)){
        assertion(Object.hasOwn(specs,key)&&Array.isArray(points),'automation lane');
        for(let i=0;i<points.length;i++){
          const pt=points[i];
          assertion(finite(pt?.at,0,100000)&&finite(pt?.value,specs[key][1],specs[key][2])&&(!i||pt.at>points[i-1].at),'automation point');
        }
      }
      for(const c of t.clips){
        checkId(c.id);
        assertion(c.type===t.type&&['audio','midi'].includes(c.type)&&name(c.name)&&finite(c.start,0,100000)&&finite(c.length,.000001,100000)&&finite(c.offset,0,100000)&&finite(c.fadeIn,0,100000)&&finite(c.fadeOut,0,100000)&&finite(c.gain,-60,24)&&Array.isArray(c.notes),'clip');
        if(c.type==='audio') {
          assertion(Object.hasOwn(p.assets,c.asset)&&finite(c.sourceBpm,30,320),'clip audio source');
          for(const key of ['fadeInShape','fadeOutShape'])
            assertion(c[key]===undefined||Object.hasOwn(SW.fadeShapes,c[key]),'clip fade shape');
          assertion(c.offset+c.length<=p.assets[c.asset].duration*c.sourceBpm/60+.002,'clip source bounds');
        }
        if(c.expression!==undefined){
          assertion(c.type==='midi'&&c.expression&&typeof c.expression==='object'&&!Array.isArray(c.expression),'MIDI expression');
          for(const [key,points] of Object.entries(c.expression)){
            const spec=SW.expressionSpec(key);
            assertion(spec&&Array.isArray(points)&&points.length<=100000,'MIDI expression lane');
            assertion(points.every((point,i)=>finite(point?.at,0,c.length+1e-7)&&finite(point?.value,spec[1],spec[2])&&(!i||point.at>points[i-1].at)),'MIDI expression point');
          }
        }
        for(const n of c.notes){
          checkId(n.id);
          assertion(Number.isInteger(n.pitch)&&finite(n.pitch,0,127)&&finite(n.start,0,100000)&&finite(n.length,.000001,100000)&&finite(n.velocity,0,1),'MIDI note');
        }
      }
    }
    for(const t of p.tracks) assertion(validRoute(p,t.id,t.out,'out')&&(!t.send||(t.send!=='master'&&validRoute(p,t.id,t.send,'send')))&&(t.sends||[]).every(s=>s.to!=='master'&&validRoute(p,t.id,s.to,'send')),'routing cycle or missing bus');
    if(p.mixScenes!==undefined){
      assertion(Array.isArray(p.mixScenes)&&p.mixScenes.length<=256,'mixer scenes');
      for(const scene of p.mixScenes){
        checkId(scene.id);
        assertion(name(scene.name)&&Array.isArray(scene.channels),'mixer scene structure');
        for(const t of scene.channels){
          assertion(id(t.id)&&finite(t.volume,-60,6)&&finite(t.pan,-1,1)&&finite(t.trim,-24,24)&&Array.isArray(t.fx),'mixer scene channel');
          for(const e of t.fx){
            assertion(id(e.id)&&e.params&&typeof e.params==='object'&&Object.values(e.params).every(Number.isFinite),'mixer scene insert');
          }
        }
      }
    }
    assertion(!SW.validSessionIdeas||SW.validSessionIdeas(p),'Launcher or Scratch Pad');
    return p;
  }
  function decodeProject(input) {
    const obj=typeof input==='string'?JSON.parse(input):input;
    if(!['Sonoravell','Soundweave'].includes(obj?.format)||!obj.media||typeof obj.media!=='object') throw Error('Select a Sonoravell project file.');
    const p=validateProject(obj.project);
    const raw=new Map(Object.keys(p.assets).map(id=>{
      if(!Object.hasOwn(obj.media,id)||typeof obj.media[id]!=='string') throw Error('Project is missing embedded audio.');
      return [id,base64ToBytes(obj.media[id])];
    }));
    return {p,raw};
  }
  function parseMidi(bytes) {
    const data=new Uint8Array(bytes);
    let pos=0, boundary=data.length;
    function read(){ if(pos>=boundary) throw Error('Truncated MIDI event.'); return data[pos++]; }
    function number(count){let n=0;while(count--) n=n*256+read();return n;}
    function tag(){return String.fromCharCode(read(),read(),read(),read());}
    function varint(){let n=0;for(let i=0;i<4;i++){const x=read();n=n*128+(x&127);if(x<128)return n;}throw Error('Invalid MIDI variable length.');}
    function take(length){if(pos+length>boundary) throw Error('Truncated MIDI chunk.');const result=data.subarray(pos,pos+length);pos+=length;return result;}
    if(tag()!=='MThd'||number(4)!==6) throw Error('Unsupported MIDI header.');
    const format=number(2), count=number(2), division=number(2);
    if(format>1||division===0||division>=32768) throw Error('Use MIDI format 0 or 1 with PPQ timing.');
    const tracks=[], tempos=[];
    for(let i=0;i<count;i++){
      boundary=data.length;
      if(tag()!=='MTrk') throw Error('Invalid MIDI track.');
      const length=number(4);
      if(pos+length>data.length) throw Error('Truncated MIDI track.');
      boundary=pos+length;
      let time=0,status=0,title='MIDI '+(i+1);
      const active=new Map(), byChannel=new Map(), controls=new Map();
      function finish(ch,pitch,end){
        const k=ch*128+pitch, queue=active.get(k);
        if(!queue?.length) return;
        const first=queue.shift();
        if(!byChannel.has(ch)) byChannel.set(ch,[]);
        byChannel.get(ch).push(SW.note(pitch,first.time/division,Math.max(1,end-first.time)/division,first.velocity/127));
      }
      while(pos<boundary){
        time+=varint();
        let code=read(), first=null;
        if(code<128){
          if(!status) throw Error('Missing MIDI running status.');
          first=code;code=status;
        }
        if(code===255){
          status=0;
          const type=read(), body=take(varint());
          if(type===3) title=new TextDecoder().decode(body).trim().slice(0,100)||title;
          if(type===81&&body.length===3){
            const micros=body[0]*65536+body[1]*256+body[2];
            if(micros>0) tempos.push([time,60000000/micros]);
          }
          if(type===47) break;
        }else if(code===240||code===247){
          take(varint()); status=0;
        }else if(code>=128&&code<240){
          status=code;
          const type=code>>4,ch=code&15,pitch=first??read(),velocity=(type===12||type===13)?0:read();
          if(pitch>127||velocity>127) throw Error('Invalid MIDI channel event.');
          if(type===9&&velocity){
            const key=ch*128+pitch;
            if(!active.has(key)) active.set(key,[]);
            active.get(key).push({time,velocity});
          }else if(type===8||type===9) finish(ch,pitch,time);
          else {
            const decoded=SW.midiControl(code,pitch,velocity);
            if(decoded){
              const part=controls.get(ch)||{};
              controls.set(ch,part);SW.setExpression(part,decoded[0],time/division,decoded[1]);
            }
          }
        }else throw Error('Unsupported MIDI event.');
      }
      for(const [key,queue] of active) while(queue.length) finish(Math.floor(key/128),key%128,time);
      pos=boundary;
      const channels=new Set([...byChannel.keys(),...controls.keys()]);
      for(const ch of channels) tracks.push({name:channels.size===1?title:title+' · Ch '+(ch+1),
        notes:byChannel.get(ch)||[],expression:controls.get(ch)?.expression,drum:ch===9});
    }
    tempos.sort((a,b)=>a[0]-b[0]);
    return {tracks,bpm:tempos[0]?.[1]??120,tempoChanges:tempos.length>1};
  }
  function midi(p) {
    const tracks=p.tracks.filter(t=>t.type==='midi');
    const arr=[], div=480, micros=Math.round(60000000/p.bpm);
    const u16=n=>[n>>8&255,n&255], u32=n=>[n>>>24,n>>>16&255,n>>>8&255,n&255];
    const vlq=n=>{const out=[n&127];while((n>>=7)>0) out.unshift((n&127)|128);return out;};
    function push(values){for(const value of values) arr.push(value);}
    function chunk(tag,data){push(encode.encode(tag));push(u32(data.length));push(data);}
    chunk('MThd',[0,1,...u16(tracks.length+1),...u16(div)]);
    const denominator=2;
    chunk('MTrk',[0,255,81,3,micros>>16&255,micros>>8&255,micros&255,0,255,88,4,p.meter,denominator,24,8,0,255,47,0]);
    let instrumentChannel=0;
    for(const t of tracks){
      const title=encode.encode(t.name), ch=t.instrument==='Drums'?9:(instrumentChannel++%15);
      const route=t.instrument==='Drums'?ch:ch>=9?ch+1:ch;
      const events=[];
      for(const c of t.clips) for(const n of c.notes){
        if(c.muted||n.muted||n.start>=c.length) continue;
        const pitch=clamp(n.pitch+t.transpose,0,127);
        const start=Math.round((c.start+n.start)*div),end=Math.max(start+1,Math.round((c.start+Math.min(c.length,n.start+n.length))*div));
        if(n.velocity<=0) continue;
        events.push([start,3,144|route,pitch,clamp(Math.round(n.velocity*127),1,127)],[end,0,128|route,pitch,0]);
      }
      for(const c of t.clips.filter(c=>!c.muted)){
        for(const [key,points] of Object.entries(c.expression||{})){
          if(!SW.encodeControl(key,0,route))continue;
          const last=points.at(-1);
          if(last&&last.value!==SW.midiLanes[key][5]){
            const reset=SW.midiLanes[key][5];
            events.push([Math.round((c.start+c.length)*div),1,...SW.encodeControl(key,reset,route)]);
          }
          for(const {at,value} of points){
            if(at===c.length&&value!==SW.midiLanes[key][5])continue;
            events.push([Math.round((c.start+at)*div),2,...SW.encodeControl(key,value,route)]);
          }
        }
      }
      events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
      const body=[0,255,3,...vlq(title.length),...title];
      let last=0;
      for(const [time,,code,pitch,velocity] of events){body.push(...vlq(time-last),code,pitch,velocity);last=time;}
      body.push(0,255,47,0);
      chunk('MTrk',body);
    }
    return Uint8Array.from(arr);
  }
  function zip(entries) {
    if(entries.length>65535)throw Error('This ZIP contains too many files.');
    const table=Uint32Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++) i=(i&1)?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
    const parts=[], central=[];
    let offset=0, centralLength=0;
    for(const [name, buffer] of entries) {
      const filename=encode.encode(name), data=new Uint8Array(buffer);
      if(filename.length>65535||offset+centralLength+data.length+76+filename.length*2>0xffffffff-22)
        throw Error('This ZIP would exceed 4 GiB. Export fewer files at a time.');
      let crc=0xffffffff;
      for(const byte of data) crc=table[(crc^byte)&255]^(crc>>>8);
      crc=(crc^0xffffffff)>>>0;
      const header=new Uint8Array(30+filename.length), h=new DataView(header.buffer);
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,2048,true);h.setUint16(12,33,true);
      h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,filename.length,true);
      header.set(filename,30);parts.push(header,data);
      const dir=new Uint8Array(46+filename.length), d=new DataView(dir.buffer);
      d.setUint32(0,0x02014b50,true); d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,2048,true);d.setUint16(14,33,true);
      d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,filename.length,true);d.setUint32(42,offset,true);
      dir.set(filename,46);central.push(dir);centralLength+=dir.length;offset+=header.length+data.length;
    }
    const end=new DataView(new ArrayBuffer(22));
    end.setUint32(0,0x06054b50,true);end.setUint16(8,entries.length,true);end.setUint16(10,entries.length,true);
    end.setUint32(12,centralLength,true);end.setUint32(16,offset,true);
    return new Blob([...parts,...central,end.buffer],{type:'application/zip'});
  }
  const cleanName = value => value.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').trim().replace(/[. ]+$/,'').slice(0,110)||'Sonoravell';
  return {bytesToBase64,base64ToBytes,wav,encodeProject,decodeProject,validateProject,parseMidi,midi,zip,cleanName};
})());
