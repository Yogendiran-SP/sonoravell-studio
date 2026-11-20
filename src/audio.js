'use strict';
Object.assign(SW, (() => {
  const {clamp,db,seconds,automationValue}=SW;
  const audioClass=globalThis.AudioContext||globalThis.webkitAudioContext;
  const offlineClass=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
  const buffers=new WeakMap();
  function noise(ctx,kind){
    if(!buffers.has(ctx)) buffers.set(ctx,{});
    const cache=buffers.get(ctx);
    if(cache[kind]) return cache[kind];
    const reverb=kind==='room'||kind==='hall';
    const length=Math.floor(ctx.sampleRate*(kind==='hall'?3.8:kind==='room'?1.75:.48));
    const buffer=ctx.createBuffer(reverb?2:1,length,ctx.sampleRate);
    let seed=76391;
    for(let c=0;c<buffer.numberOfChannels;c++){
      const data=buffer.getChannelData(c);
      for(let i=0;i<length;i++){
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        const envelope=reverb?(1-i/length)**3*.6:1;
        data[i]=(seed/2147483648-1)*envelope;
      }
    }
    return cache[kind]=buffer;
  }
  const direct=n=>n;
  function insert(ctx,e,units){
    let input,output,reduction=null,filters=[];
    const params={};
    const link=(key,param,convert=direct)=>{ params[key]??=[];params[key].push({param,convert});param.value=convert(e.params[key]); };
    const startOsc=()=>{ const source=ctx.createOscillator(); source.start(); units.push(source);return source; };
    const wetDry=(node,wetNode=node)=>{
      input=ctx.createGain();output=ctx.createGain();
      const dry=ctx.createGain(), wet=ctx.createGain();
      input.connect(dry).connect(output);input.connect(node);wetNode.connect(wet).connect(output);
      link('mix',dry.gain,v=>1-v);link('mix',wet.gain);
    };
    switch(e.type){
      case 'Parametric EQ': case 'Low Cut': case 'Low Pass': case 'High Shelf': case 'Low Shelf': case 'Band Pass': case 'Notch': {
        input=output=ctx.createBiquadFilter();filters=[input];
        input.type={'Parametric EQ':'peaking','Low Cut':'highpass','Low Pass':'lowpass','High Shelf':'highshelf','Low Shelf':'lowshelf','Band Pass':'bandpass',Notch:'notch'}[e.type];
        link('frequency',input.frequency);
        if('q' in e.params) link('q',input.Q);
        if('gain' in e.params) link('gain',input.gain);
        break;
      }
      case 'Compressor': case 'Limiter': case 'Parallel Compressor': {
        const node=ctx.createDynamicsCompressor();reduction=node;
        if(e.type==='Parallel Compressor') wetDry(node);
        else input=output=node;
        node.knee.value=e.type==='Limiter'?0:12;node.attack.value=.002;node.ratio.value=20;
        link('threshold',node.threshold);link('release',node.release);
        if(e.type!=='Limiter'){link('attack',node.attack);link('ratio',node.ratio);}
        break;
      }
      case 'Echo': case 'Slap Delay': {
        const delay=ctx.createDelay(2), feedback=ctx.createGain();
        wetDry(delay);delay.connect(feedback).connect(delay);
        link('time',delay.delayTime);link('feedback',feedback.gain);
        break;
      }
      case 'Room Reverb': case 'Hall Reverb': {
        const room=ctx.createConvolver();
        room.buffer=noise(ctx,e.type==='Hall Reverb'?'hall':'room');
        wetDry(room);
        break;
      }
      case 'Drive': {
        input=ctx.createGain();output=ctx.createGain();
        const shaper=ctx.createWaveShaper(), tone=ctx.createBiquadFilter();
        shaper.curve=Float32Array.from({length:4097},(_,i)=>Math.tanh((i/2048-1)*2.8));
        shaper.oversample='2x';tone.type='lowpass';
        input.connect(shaper).connect(tone).connect(output);
        link('amount',input.gain,v=>.28+v*3.7);link('tone',tone.frequency);link('output',output.gain);
        break;
      }
      case 'Chorus': {
        const delay=ctx.createDelay(.05), lfo=startOsc(), depth=ctx.createGain();
        delay.delayTime.value=.012;lfo.connect(depth).connect(delay.delayTime);
        wetDry(delay);link('rate',lfo.frequency);link('depth',depth.gain);
        break;
      }
      case 'Tremolo': {
        input=output=ctx.createGain();
        const lfo=startOsc(), depth=ctx.createGain();
        lfo.connect(depth).connect(input.gain);
        link('rate',lfo.frequency);link('depth',input.gain,v=>1-v/2);link('depth',depth.gain,v=>v/2);
        break;
      }
      case 'Stereo Width': {
        input=ctx.createGain(); input.channelCount=2;input.channelCountMode='explicit';
        const split=ctx.createChannelSplitter(2);
        output=ctx.createChannelMerger(2);
        input.connect(split);
        for(let src=0;src<2;src++) for(let dst=0;dst<2;dst++){
          const gain=ctx.createGain();
          split.connect(gain,src);gain.connect(output,0,dst);
          link('width',gain.gain,v=>src===dst?(1+v)/2:(1-v)/2);
        }
        break;
      }
      case 'Three-Band EQ': case 'Cabinet Filter': {
        const low=ctx.createBiquadFilter(), mid=ctx.createBiquadFilter(), high=ctx.createBiquadFilter();
        input=low;output=high;filters=[low,mid,high];
        low.connect(mid).connect(high);
        mid.type='peaking';mid.Q.value=.8;
        if(e.type==='Three-Band EQ'){
          low.type='lowshelf';low.frequency.value=160;
          high.type='highshelf';high.frequency.value=6000;
          link('low',low.gain);link('mid',mid.gain);link('high',high.gain);link('frequency',mid.frequency);
        }else{
          low.type='highpass';high.type='lowpass';mid.frequency.value=2100;
          link('low',low.frequency);link('high',high.frequency);link('presence',mid.gain);
        }
        break;
      }
      case 'Soft Clipper': case 'Bit Reducer': {
        const gain=ctx.createGain(), shaper=ctx.createWaveShaper();
        const shape=e.type==='Soft Clipper'?v=>Math.tanh(v*1.5):v=>Math.round(v*16)/16;
        shaper.curve=Float32Array.from({length:4097},(_,i)=>shape(i/2048-1));
        gain.connect(shaper);link('drive',gain.gain,db);
        if(e.type==='Bit Reducer') wetDry(gain,shaper);
        else{
          input=gain;output=ctx.createGain();shaper.connect(output);
          shaper.oversample='4x';link('output',output.gain,db);
        }
        break;
      }
      case 'Flanger': {
        const delay=ctx.createDelay(.03), lfo=startOsc(), depth=ctx.createGain(), feedback=ctx.createGain();
        delay.delayTime.value=.005;lfo.connect(depth).connect(delay.delayTime);
        delay.connect(feedback).connect(delay);wetDry(delay);
        link('rate',lfo.frequency);link('depth',depth.gain);link('feedback',feedback.gain);
        break;
      }
      case 'Phaser': {
        const lfo=startOsc(), depth=ctx.createGain();
        const filters=Array.from({length:4},(_,i)=>{
          const n=ctx.createBiquadFilter();
          n.type='allpass';n.frequency.value=780+i*185;n.Q.value=.8;
          depth.connect(n.frequency);return n;
        });
        lfo.connect(depth);filters.reduce((a,b)=>a.connect(b));
        wetDry(filters[0],filters.at(-1));
        link('rate',lfo.frequency);link('depth',depth.gain);
        break;
      }
      case 'Auto Pan': {
        input=output=ctx.createStereoPanner();
        const lfo=startOsc(), depth=ctx.createGain();
        lfo.connect(depth).connect(input.pan);
        link('rate',lfo.frequency);link('depth',depth.gain);
        break;
      }
      case 'Polarity': {
        input=output=ctx.createGain();
        link('gain',input.gain);
        break;
      }
      case 'Utility Gain': {
        input=output=ctx.createGain();
        link('gain',input.gain,db);
        break;
      }
      default: throw Error('Unknown insert: '+e.type);
    }
    return {input,output,params,filters,reduction};
  }
  function audibility(p) {
    const solo=new Set(p.tracks.filter(t=>t.solo).map(t=>t.id));
    if(!solo.size) return null;
    for(const t of p.tracks) if(t.soloSafe) solo.add(t.id);
    const by=new Map(p.tracks.map(t=>[t.id,t]));
    const result=new Set(solo);
    function addUpstream(id){
      const t=by.get(id);
      if(!t||t.type!=='bus') return;
      for(const src of p.tracks) if(src.out===id||src.send===id||src.sends?.some(s=>s.to===id&&!s.mute)){
        if(result.has(src.id)) continue;
        result.add(src.id);addUpstream(src.id);
      }
    }
    function addDownstream(id){
      const t=by.get(id);
      if(!t) return;
      for(const bus of [t.out,t.send,...(t.sends||[]).filter(s=>!s.mute).map(s=>s.to)]) if(by.has(bus)&&!result.has(bus)){
        result.add(bus);addDownstream(bus);
      }
    }
    solo.forEach(addUpstream);
    for(const id of [...result]) addDownstream(id);
    return result;
  }
  const instrumentEffects=[
    ['Room Reverb',{mix:'reverb'}, {mix:'cc91'}],
    ['Echo',{mix:'delay',time:'delayTime',feedback:'delayFeedback'}, {}],
    ['Chorus',{mix:'chorus'}, {mix:'cc93'}]
  ];
  function instrumentChain(ctx,t,stage,units){
    const source=ctx.createGain(), rack={};
    const settings=SW.instrumentSettings(t);
    let current=source;
    for(const [type,mapping,cc] of instrumentEffects){
      const e=SW.effect(type);
      for(const [key,name] of Object.entries(mapping))e.params[key]=settings[name];
      const fx=insert(ctx,e,units);
      current.connect(fx.input);current=fx.output;
      for(const [key,name] of Object.entries(mapping))rack[name]={targets:fx.params[key],cc:cc[key]};
    }
    current.connect(stage);
    return {source,rack};
  }
  function animateLane(params,points,from,to,when,secs,fallback,step=false){
    if(!points?.length)return;
    for(const {param,convert} of params){
      param.setValueAtTime(convert(SW.pointValue(points,from,fallback,step)),when);
      const update=(value,at)=>step?param.setValueAtTime(convert(value),at):param.linearRampToValueAtTime(convert(value),at);
      for(const [i,point] of points.entries())if(point.at>from&&point.at<to){
        const at=when+secs(point.at-from);
        if(!i)param.setValueAtTime(convert(point.value),at);else update(point.value,at);
      }
      if(!step&&to>from)update(SW.pointValue(points,to,fallback),when+secs(to-from));
    }
  }
  function animateRack(rack,t,c,from,to,when,secs){
    const settings=SW.instrumentSettings(t);
    for(const [key,{targets,cc}] of Object.entries(rack||{})){
      const internal=c.expression?.['inst:'+key], midi=cc&&c.expression?.[cc];
      if(!internal?.length&&!midi?.length){
        for(const {param,convert} of targets)param.setValueAtTime(convert(settings[key]),when);
        continue;
      }
      const mapped=midi?.map(point=>({at:point.at,value:point.value/127}));
      animateLane(targets,internal?.length?internal:mapped,from,to,when,secs,settings[key]);
    }
  }
  function buildGraph(ctx,p,meters=false,output='master',sink=ctx.destination,layout=p.spatialMonitor||'stereo'){
    const units=[], sources=new Set(), tracks=new Map(), cueNodes=new Map(), cueMeters=new Map(), active=audibility(p);
    const gate=ctx.createGain(), discrete=layout==='surround';
    let merger=null;
    if(discrete){
      merger=ctx.createChannelMerger(SW.speakers.length);
      gate.channelCount=SW.speakers.length;
      gate.channelCountMode='explicit';
      gate.channelInterpretation='discrete';
      sink.channelInterpretation='discrete';
    }
    gate.connect(sink);
    for(const t of [...p.tracks,p.master]){
      const input=ctx.createGain(), trim=ctx.createGain(), preTap=ctx.createGain(), postTap=ctx.createGain();
      const volume=ctx.createGain(), pan=ctx.createStereoPanner(), mute=ctx.createGain(), out=ctx.createGain();
      const parameters={volume:[{param:volume.gain,convert:db}],pan:[{param:pan.pan,convert:direct}],trim:[{param:trim.gain,convert:t.polarity?n=>-db(n):db}]};
      if(t.mono){trim.channelCount=1;trim.channelCountMode='explicit';}
      trim.gain.value=(t.polarity?-1:1)*db(t.trim??0);
      volume.gain.value=db(t.volume);pan.pan.value=t.pan;
      const dim=t.id!=='master'&&active&&!active.has(t.id);
      const routeGain=t.mute?0:dim?(p.dimSolo?db(-18):0):1;
      mute.gain.value=routeGain;
      const rawStages=new Map([['in',input],['trim',trim],['pre',preTap],['fader',volume],['pan',pan],['post',postTap],['out',mute]]);
      if(t.type==='audio')rawStages.set('source',ctx.createGain());
      if(t.type==='midi')rawStages.set('instrument',ctx.createGain());
      const points=new Map([...rawStages].map(([key,node])=>[key,{input:node,output:node}]));
      const processors=new Map();
      for(const e of t.fx){
        if(e.bypass){
          const passthrough=ctx.createGain();
          points.set('fx:'+e.id,{input:passthrough,output:passthrough});
          continue;
        }
        const node=insert(ctx,e,units);
        points.set('fx:'+e.id,node);
        processors.set(e.id,node);
        for(const [key,targets] of Object.entries(node.params))parameters['fx:'+e.id+':'+key]=targets;
      }
      const links=SW.serialEdges(t);
      for(const {from,to} of links){
        const source=points.get(from), target=points.get(to);
        if(source&&target)source.output.connect(target.input);
      }
      const pre=ctx.createGain(),post=ctx.createGain();
      pre.gain.value=post.gain.value=routeGain;
      preTap.connect(pre);postTap.connect(post);
      let analyzer=null;
      if(meters){
        analyzer=ctx.createAnalyser();analyzer.fftSize=256;
        mute.connect(analyzer).connect(out);
      }else mute.connect(out);
      const chain=t.type==='midi'&&links.some(link=>link.from==='source'&&link.to==='instrument')?
        instrumentChain(ctx,t,rawStages.get('instrument'),units):null;
      const source=t.type==='audio'?rawStages.get('source'):chain?.source??null;
      tracks.set(t.id,{input,source,rack:chain?.rack,pre,post,out,parameters,analyzer,processors,insertOut:preTap,postFader:volume,postTap});
    }
    for(const cue of SW.cueSettings(p)){
      const input=ctx.createGain(), output=ctx.createGain();
      output.gain.value=cue.mute?0:db(cue.volume);
      if(!cue.disconnected)input.connect(output);
      if(meters){
        const analyzer=ctx.createAnalyser();analyzer.fftSize=256;
        output.connect(analyzer);
        cueNodes.set(cue.id,{input,output:analyzer});cueMeters.set(cue.id,analyzer);
      }else cueNodes.set(cue.id,{input,output});
    }
    const master=tracks.get('master');
    if(discrete){
      const gain=ctx.createGain();
      const spec={channelCount:SW.speakers.length,channelCountMode:'explicit',channelInterpretation:'discrete'};
      Object.assign(gain,spec);
      gain.gain.value=p.master.mute?0:db(p.master.volume+(p.master.trim??0))*(p.master.polarity?-1:1);
      merger.connect(gain).connect(gate);
      master.parameters={volume:[{param:gain.gain,convert:v=>p.master.mute?0:db(v+(p.master.trim??0))*(p.master.polarity?-1:1)}]};
    }else if(output!=='__off')(cueNodes.get(output)?.output||(tracks.get(output)||master).out).connect(gate);
    for(const t of p.tracks){
      const node=tracks.get(t.id), destination=tracks.get(t.out);
      const spatial=SW.position(t);
      if(discrete&&destination===master) connectSurround(ctx,node,merger,spatial);
      else if(layout==='binaural'&&destination===master&&spatial.mode!=='stereo') connectBinaural(ctx,node,destination,spatial);
      else if(destination)node.out.connect(destination.input);
      for(const route of SW.sendList(t)){
        if(!tracks.has(route.to)||route.mute) continue;
        const send=ctx.createGain();
        send.gain.value=db(route.level);
        (route.pre?node.pre:node.post).connect(send).connect(tracks.get(route.to).input);
      }
      for(const route of SW.cueSends(t)){
        if(!cueNodes.has(route.to)||route.mute) continue;
        const send=ctx.createGain(), pan=ctx.createStereoPanner();
        send.gain.value=db(route.level);
        pan.pan.value=route.followPan?(route.postTap?0:t.pan):route.pan;
        if(route.followPan&&!route.postTap) node.parameters.pan.push({param:pan.pan,convert:direct});
        (route.pre?node.insertOut:route.postTap?node.postTap:node.postFader).connect(send).connect(pan).connect(cueNodes.get(route.to).input);
      }
    }
    function own(source){
      sources.add(source);
      source.addEventListener('ended',()=>{sources.delete(source);source.disconnect();},{once:true});
      return source;
    }
    function stop(){
      gate.gain.setValueAtTime(0,ctx.currentTime);
      gate.disconnect();
      for(const source of [...units,...sources]){try{source.stop();source.disconnect();}catch{}}
      sources.clear();
    }
    return {ctx,p,tracks,gate,own,stop,cueMeters};
  }
  function asMono(ctx,node){
    const mono=ctx.createGain();mono.channelCount=1;mono.channelCountMode='explicit';
    node.connect(mono);return mono;
  }
  function connectBinaural(ctx,node,destination,spatial){
    const mono=asMono(ctx,node.out), panner=ctx.createPanner(), dry=ctx.createGain(), wet=ctx.createGain();
    panner.panningModel='HRTF';panner.rolloffFactor=0;
    for(const [key,param,convert] of [
      ['x',panner.positionX,v=>v*2],['y',panner.positionZ,v=>v*2],['z',panner.positionY,v=>v*1.8],
      ['spread',dry.gain,v=>v*.5],['spread',wet.gain,v=>1-v*.5]
    ]){
      param.value=convert(spatial[key]);
      (node.parameters['space:'+key]??=[]).push({param,convert});
    }
    mono.connect(panner).connect(wet).connect(destination.input);
    node.out.connect(dry).connect(destination.input);
  }
  function connectSurround(ctx,node,merger,spatial){
    if(spatial.mode==='stereo'){
      const split=ctx.createChannelSplitter(2);
      node.out.connect(split);split.connect(merger,0,0);split.connect(merger,1,1);return;
    }
    const mono=asMono(ctx,node.out), lp=ctx.createBiquadFilter();
    lp.type='lowpass';lp.frequency.value=120;mono.connect(lp);
    const weights=SW.speakerGains(spatial);
    const params=SW.speakers.map(([label],i)=>{
      const amp=ctx.createGain();
      amp.gain.value=weights[i];
      (label==='LFE'?lp:mono).connect(amp).connect(merger,0,i);
      return amp.gain;
    });
    node.spatial={spatial,params};
  }
  function automateSurround(graph,t,node,from,to,when){
    const {spatial,params}=node.spatial;
    const keys=Object.keys(SW.spatialSpecs);
    const points=[...new Set([from,to,...keys.flatMap(key=>(t.lanes['space:'+key]||[]).map(pt=>pt.at).filter(at=>at>from&&at<to))])].sort((a,b)=>a-b);
    if(t.automation==='Off'||!keys.some(k=>t.lanes['space:'+k]?.length)) return;
    const positionAt=at=>Object.fromEntries(keys.map(key=>[key,automationValue(t.lanes['space:'+key],at,spatial[key])]));
    for(let i=0;i<points.length;i++){
      const first=i===0,a=points[Math.max(0,i-1)],b=points[i];
      const steps=first?1:Math.min(64,Math.max(1,Math.ceil((b-a)*8)));
      for(let n=1;n<=steps;n++){
        const at=a+(b-a)*n/steps,time=when+seconds(at-from,graph.p.bpm);
        const gains=SW.speakerGains(positionAt(at));
        params.forEach((param,j)=>{
          if(first)param.setValueAtTime(gains[j],time);
          else param.linearRampToValueAtTime(gains[j],time);
        });
      }
    }
  }
  function automate(graph,t,from,to,when,overrides){
    const node=graph.tracks.get(t.id), bpm=graph.p.bpm;
    if(node.spatial) automateSurround(graph,t,node,from,to,when);
    for(const [key,targets] of Object.entries(node.parameters)){
      const override=overrides?.get(t.id+':'+key);
      const lane=t.automation==='Off'?null:t.lanes[key];
      if(override!==undefined||!lane?.length) continue;
      for(const {param,convert} of targets){
        // Gains interpolate in decibels, matching the envelope shown in the editor.
        const point=(at,value,first)=> {
          const time=when+seconds(at-from,bpm);
          const v=convert(value);
          if(first) param.setValueAtTime(v,time);
          else if(convert===db) param.exponentialRampToValueAtTime(v,time);
          else param.linearRampToValueAtTime(v,time);
        };
        point(from,automationValue(lane,from,0),true);
        for(const event of lane) if(event.at>from&&event.at<to) point(event.at,event.value,false);
        point(to,automationValue(lane,to,0),false);
      }
    }
  }
  function overrideParam(graph,id,key,value){
    if(!graph) return;
    const now=graph.ctx.currentTime;
    for(const {param,convert} of graph.tracks.get(id)?.parameters[key]||[]){
      param.cancelScheduledValues(now);param.setTargetAtTime(convert(value),now,.015);
    }
  }
  function sampleData(entry,reverse,ctx) {
    if(!reverse) return entry.buffer;
    if(!entry.reversed){
      const b=entry.buffer;
      const r=ctx.createBuffer(b.numberOfChannels,b.length,b.sampleRate);
      for(let c=0;c<b.numberOfChannels;c++) r.getChannelData(c).set(b.getChannelData(c).slice().reverse());
      entry.reversed=r;
    }
    return entry.reversed;
  }
  function audioEvent(graph,t,c,entry,from,to,when){
    if(!entry) return;
    const {ctx,p}=graph, start=Math.max(c.start,from), end=Math.min(c.start+c.length,to);
    if(end<=start) return;
    const src=graph.own(ctx.createBufferSource()), amp=ctx.createGain();
    const rate=p.bpm/c.sourceBpm, advance=start-c.start, duration=seconds(end-start,p.bpm);
    const sourceOffset=seconds(c.offset+advance,c.sourceBpm);
    src.buffer=sampleData(entry,c.reverse,ctx);src.playbackRate.value=rate;
    src.connect(amp).connect(graph.tracks.get(t.id).source);
    const at=when+seconds(start-from,p.bpm), linearGain=db(c.gain);
    const a=Math.min(c.fadeIn,c.length), b=Math.min(c.fadeOut,c.length-a);
    const finish=advance+(end-start);
    const level=pos=>linearGain*Math.min(a?SW.fadeLevel(c.fadeInShape,pos/a):1,
      b?SW.fadeLevel(c.fadeOutShape,(c.length-pos)/b):1);
    amp.gain.setValueAtTime(level(advance),at);
    for(const [left,right,shape] of [[0,a,c.fadeInShape],[c.length-b,c.length,c.fadeOutShape]]){
      const from=Math.max(left,advance), to=Math.min(right,finish);
      if(to<=from) continue;
      if(from>advance)amp.gain.setValueAtTime(level(from),at+seconds(from-advance,p.bpm));
      const steps=shape&&shape!=='linear'?20:1;
      for(let i=1;i<=steps;i++){
        const pos=from+(to-from)*i/steps;
        amp.gain.linearRampToValueAtTime(level(pos),at+seconds(pos-advance,p.bpm));
      }
    }
    if(sourceOffset<src.buffer.duration){src.start(at,sourceOffset);src.stop(at+duration);}
    else {src.disconnect();}
  }
  function voice(graph,t,pitch,velocity,when,length,media,releaseLimit=Infinity,hold=false,expression=null){
    if(velocity<=0||length<=0) return;
    const {ctx}=graph, dest=graph.tracks.get(t.id).source;
    if(!dest)return;
    const instrument=t.instrument, settings=SW.instrumentSettings(t);
    const {from=0,to=0,secs=direct,lanes={}}=expression||{};
    for(const key of Object.keys(SW.instrumentSpecs(instrument))){
      settings[key]=SW.pointValue(lanes['inst:'+key],from,settings[key]);
    }
    if(instrument==='Drums') hold=false;
    const freq=440*2**((clamp(pitch+t.transpose,0,127)-69+(settings.tune??0)/100)/12);
    const amp=ctx.createGain();
    let source, release=settings.release??.12, level=settings.level*velocity, attack=settings.attack??.01, sustain=settings.sustain??.5;
    let sampleOffset=0, filter;
    if(instrument==='Sampler'){
      const sample=media.get(t.sample);
      if(!sample) return;
      source=ctx.createBufferSource();source.buffer=sample.buffer;
      source.playbackRate.value=2**((pitch+t.transpose-settings.root+settings.tune/100)/12);
      sampleOffset=source.buffer.duration*settings.start;
      length=Math.min(length,(source.buffer.duration-sampleOffset)/source.playbackRate.value);
      filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=settings.cutoff;filter.Q.value=settings.resonance;
      source.connect(filter).connect(amp);
    }else if(instrument==='Drums'){
      if(pitch===36||pitch===35||pitch===41||pitch===43){
        source=ctx.createOscillator();source.type='sine';
        source.frequency.setValueAtTime(pitch>36?settings.pitch*1.3:settings.pitch,when);
        source.frequency.exponentialRampToValueAtTime(settings.pitch*(pitch>36?.56:.4),when+.075);
        length=Math.min(.8,Math.max(length,settings.decay));level=velocity*settings.level;release=.075;sustain=.08;
        source.connect(amp);
      }else{
        source=ctx.createBufferSource();source.buffer=noise(ctx,'drum');
        const filter=ctx.createBiquadFilter();filter.type=pitch>=42?'highpass':'bandpass';
        filter.frequency.value=pitch>=42?6700:1700;filter.Q.value=.55;
        source.connect(filter).connect(amp);
        length=Math.min(pitch===46?.24:.11,length);attack=.002;
        level=velocity*settings.level*settings.noise*(pitch>=42?.65:1.05);release=pitch===46?.12:.055;sustain=.18;
      }
    }else{
      source=ctx.createOscillator();source.type=settings.wave;source.frequency.value=freq;
      filter=ctx.createBiquadFilter();filter.type='lowpass';
      filter.frequency.value=Math.min(ctx.sampleRate*.47,settings.cutoff);filter.Q.value=settings.resonance;
      source.connect(filter).connect(amp);
    }
    const peakTime=when+Math.min(length*.45,attack), sustainTime=Math.min(when+length,peakTime+(settings.decay??.13));
    const cutoff=Math.min(when+length+release,releaseLimit);
    const endTime=Math.min(when+length,cutoff);
    const gain=amp.gain;gain.setValueAtTime(0,when);gain.linearRampToValueAtTime(level,peakTime);
    gain.linearRampToValueAtTime(level*sustain,sustainTime);
    const expressive=ctx.createGain();
    amp.connect(expressive).connect(dest);graph.own(source);
    const bend=value=>value/(value<0?8192:8191)*settings.bendRange*100;
    const brightness=value=>Math.min(ctx.sampleRate*.47,clamp(settings.cutoff*2**((value-64)/32),30,18000));
    const apply=(param,points,fallback,convert=direct)=>{
      if(param) animateLane([{param,convert}],points,from,to,when,secs,fallback);
    };
    apply(source.detune,lanes.bend,0,bend);
    apply(expressive.gain,lanes.cc11,127,value=>value/127);
    if(filter){
      if(lanes['inst:cutoff']?.length)apply(filter.frequency,lanes['inst:cutoff'],settings.cutoff,v=>Math.min(ctx.sampleRate*.47,v));
      else apply(filter.frequency,lanes.cc74,64,brightness);
      apply(filter.Q,lanes['inst:resonance'],settings.resonance);
    }
    let vibrato, depth;
    if(source.detune&&settings.vibrato&&(hold||lanes.cc1?.length)){
      vibrato=graph.own(ctx.createOscillator());vibrato.frequency.value=5.3;
      depth=ctx.createGain();depth.gain.value=0;vibrato.connect(depth).connect(source.detune);
      apply(depth.gain,lanes.cc1,0,value=>value/127*settings.vibrato);vibrato.start(when);
    }
    function control(key,value) {
      const now=Math.max(ctx.currentTime,when);
      const set=(param,n)=>param?.setTargetAtTime(n,now,.012);
      if(key==='bend')set(source.detune,bend(value));
      else if(key==='cc1')set(depth?.gain,value/127*settings.vibrato);
      else if(key==='cc11')set(expressive.gain,value/127);
      else if(key==='cc74'&&filter)set(filter.frequency,brightness(value));
      for(const {targets,cc} of Object.values(graph.tracks.get(t.id)?.rack||{})){
        if(key===cc) for(const {param,convert} of targets)set(param,convert(value/127));
      }
    }
    source.addEventListener('ended',()=>{
      if(vibrato){try{vibrato.stop();}catch{}}
      amp.disconnect();expressive.disconnect();
    },{once:true});
    if(instrument==='Sampler') source.start(when,sampleOffset);
    else source.start(when);
    if(hold){
      let releasing=false;
      const releaseVoice=()=>{
        if(releasing) return;
        releasing=true;
        const now=Math.max(ctx.currentTime,when+.001);
        if(gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
        else {gain.cancelScheduledValues(now);gain.setValueAtTime(level*sustain,now);}
        gain.linearRampToValueAtTime(0,now+release);
        try{source.stop(now+release+.005);}catch{}
      };
      return Object.assign(releaseVoice,{control});
    }
    gain.setValueAtTime(level*sustain,Math.max(sustainTime,endTime));
    gain.linearRampToValueAtTime(0,Math.max(endTime+.001,cutoff));
    source.stop(Math.max(endTime+.002,cutoff+.001));
  }
  function click(graph,from,to,when){
    const {ctx,p}=graph;
    for(let beat=Math.ceil(from);beat<to;beat++){
      const start=when+seconds(beat-from,p.bpm), o=graph.own(ctx.createOscillator()), gain=ctx.createGain();
      o.frequency.value=beat%p.meter===0?1480:980;
      gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.095,start+.003);
      gain.gain.exponentialRampToValueAtTime(.0001,start+.04);
      o.connect(gain).connect(graph.gate);o.start(start);o.stop(start+.042);
      o.addEventListener('ended',()=>gain.disconnect(),{once:true});
    }
  }
  function schedule(graph,media,from,to,when,options={}){
    const p=graph.p, secs=b=>seconds(b,p.bpm);
    for(const t of [...p.tracks,p.master]){
      automate(graph,t,from,to,when,options.overrides);
      if(options.only&&options.only!==t.id) continue;
      for(const c of t.clips){
        if(c.muted||c.start+c.length<=from||c.start>=to) continue;
        if(c.type==='audio'){audioEvent(graph,t,c,media.get(c.asset),from,to,when);continue;}
        const clipFrom=Math.max(0,from-c.start),clipTo=Math.min(c.length,to-c.start);
        animateRack(graph.tracks.get(t.id)?.rack,t,c,clipFrom,clipTo,when+secs(Math.max(0,c.start-from)),secs);
        for(const n of c.notes){
          if(n.muted||options.chaseNotes===false&&c.start+n.start<from) continue;
          const start=Math.max(c.start+n.start,from);
          const held=t.instrument==='Drums'?n.start+n.length:SW.sustainedEnd(c,Math.min(c.length,n.start+n.length));
          const end=Math.min(c.start+held,c.start+c.length,to);
          if(end<=start) continue;
          voice(graph,t,n.pitch,n.velocity,when+secs(start-from),secs(end-start),media,options.loop?when+secs(to-from):Infinity,false,
            {from:start-c.start,to:end-c.start,secs,lanes:c.expression});
        }
      }
    }
    if(options.click) click(graph,from,to,when);
  }
  function audioContext(options){if(!audioClass) throw Error('This browser does not support Web Audio.');return new audioClass(options);}
  async function renderAudio(p,media,{from=0,to=SW.songEnd(p),rate=48000,tail=1.5,only,output,layout='stereo'}={}){
    if(!offlineClass) throw Error('Offline audio rendering is unavailable.');
    const duration=seconds(to-from,p.bpm)+tail;
    if(duration>1800) throw Error('Render up to 30 minutes at a time using a shorter range.');
    if(duration<=0) throw Error('Choose a nonempty export range.');
    const ctx=new offlineClass(layout==='surround'?12:2,Math.ceil(duration*rate),rate);
    const graph=buildGraph(ctx,p,false,output,ctx.destination,layout);
    schedule(graph,media,from,to,0,{only});
    return ctx.startRendering();
  }
  async function renderRealtime(p,media,{from,to,rate,tail,only,output,layout='stereo'}){
    if(!audioClass||!globalThis.AudioWorkletNode) throw Error('Realtime capture requires AudioWorklet. Open the localhost launcher in Chrome or Edge.');
    const ctx=new audioClass({sampleRate:rate});
    let graph, timer, url;
    try{
      if(!ctx.audioWorklet) throw Error('Realtime capture requires the localhost launcher in a compatible browser.');
      const module=`
        class RenderCapture extends AudioWorkletProcessor {
          constructor(options) {
            super();
            const {first,total}=options.processorOptions;
            this.first=first;this.total=total;this.at=0;
            this.chunk=[new Float32Array(4096),new Float32Array(4096)];
          }
          process(inputs) {
            const input=inputs[0]||[];
            const quantum=input[0]?.length||128;
            for(let i=0;i<quantum;i++){
              const frame=currentFrame+i;
              if(frame<this.first) continue;
              const position=frame-this.first;
              if(position>=this.total) return false;
              const slot=position%4096;
              this.chunk[0][slot]=input[0]?.[i]||0;
              this.chunk[1][slot]=input[1]?.[i]??this.chunk[0][slot];
              const done=position===this.total-1;
              if(slot===4095||done){
                const data=this.chunk.map(bytes=>slot===4095?bytes:bytes.slice(0,slot+1));
                this.port.postMessage({at:position-slot,data,done},data.map(bytes=>bytes.buffer));
                if(done) return false;
                this.chunk=[new Float32Array(4096),new Float32Array(4096)];
              }
            }
            return true;
          }
        }
        registerProcessor('sw-render-capture',RenderCapture);
      `;
      url=URL.createObjectURL(new Blob([module],{type:'text/javascript'}));
      await ctx.audioWorklet.addModule(url);
      await ctx.resume();
      rate=ctx.sampleRate;
      const duration=seconds(to-from,p.bpm)+tail;
      const total=Math.ceil(duration*rate);
      const first=Math.ceil((ctx.currentTime+.2)*rate);
      const receiver=new AudioWorkletNode(ctx,'sw-render-capture',{
        numberOfInputs:1,numberOfOutputs:1,channelCount:2,channelCountMode:'explicit',outputChannelCount:[2],processorOptions:{first,total}
      });
      const buffer=ctx.createBuffer(2,total,rate);
      const result=new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(Error('Realtime capture timed out. Keep Sonoravell active during rendering.')),(duration+20)*1000);
        receiver.port.onmessage=({data:message})=>{
          for(let ch=0;ch<2;ch++) buffer.getChannelData(ch).set(message.data[ch],message.at);
          if(message.done) resolve(buffer);
        };
        receiver.onprocessorerror=()=>reject(Error('Realtime capture stopped inside the browser audio engine.'));
      });
      receiver.connect(ctx.destination);
      graph=buildGraph(ctx,p,false,output,receiver,layout);
      schedule(graph,media,from,to,first/rate,{only});
      return await result;
    }finally{
      clearTimeout(timer);
      graph?.stop();
      if(url) URL.revokeObjectURL(url);
      if(ctx.state!=='closed') await ctx.close();
    }
  }
  return {audioContext,buildGraph,schedule,renderAudio,voice,overrideParam,audibility,renderRealtime};
})());
