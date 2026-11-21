'use strict';
Object.assign(SW, (() => {
  const {clamp,db}=SW;
  const lowHz=20, highHz=20000;
  const bounds={left:.075,right:.938,top:.09,bottom:.86};
  const frequencies=Float32Array.from({length:240},(_,i)=>lowHz*(highHz/lowHz)**(i/239));
  const frequencyX=value=>Math.log(clamp(value,lowHz,highHz)/lowHz)/Math.log(highHz/lowHz);
  const frequencyAt=x=>lowHz*(highHz/lowHz)**clamp(x,0,1);
  const eqY=(value,range)=>.5-value/(range*2);
  const coordinate=(x,y)=>[bounds.left+(bounds.right-bounds.left)*clamp(x,0,1),
    bounds.top+(bounds.bottom-bounds.top)*clamp(y,0,1)];
  function plotPosition(x,y){
    return [(x-bounds.left)/(bounds.right-bounds.left),(y-bounds.top)/(bounds.bottom-bounds.top)].map(n=>clamp(n,0,1));
  }
  const stockColors=['#e1ab77','#9cdbc4','#a4b6ff'];
  function eqHandles(e){
    if(e.type==='Spectrum EQ')return SW.spectrumBands.map(([key,label,type,,color])=>({
      key,label,color,on:Boolean(e.params[key+'On']),x:key+'Freq',
      y:key+'Gain' in e.params?key+'Gain':undefined,q:key+'Q' in e.params?key+'Q':undefined,
      cutoff:type==='lowpass'||type==='highpass'
    }));
    if(e.type==='Three-Band EQ')return [
      {key:'low',label:'Low shelf',frequency:160,y:'low'},
      {key:'mid',label:'Mid bell',x:'frequency',y:'mid'},
      {key:'high',label:'High shelf',frequency:6000,y:'high'}
    ].map((handle,i)=>({...handle,on:true,color:stockColors[i]}));
    if(e.type==='Cabinet Filter')return [
      {key:'low',label:'Low cut',x:'low',cutoff:true},
      {key:'presence',label:'Presence',frequency:2100,y:'presence'},
      {key:'high',label:'High cut',x:'high',cutoff:true}
    ].map((handle,i)=>({...handle,on:true,color:stockColors[i]}));
    if(!SW.filterStages(e).length)return [];
    return [{key:'filter',label:e.type,color:'#83dfbe',on:true,x:'frequency',
      y:'gain' in e.params?'gain':undefined,q:'q' in e.params?'q':undefined,
      cutoff:e.type==='Low Cut'||e.type==='Low Pass'}];
  }
  function pluginPlot(e,instrument){
    if(!e)return instrument==='Drums'?'drums':'envelope';
    if(e.type==='Guitar Pedalboard')return 'pedals';
    if(eqHandles(e).length)return 'eq';
    if(['Compressor','Limiter','Parallel Compressor'].includes(e.type))return 'dynamics';
    if(['Echo','Slap Delay'].includes(e.type))return 'delay';
    if(['Room Reverb','Hall Reverb'].includes(e.type))return 'reverb';
    if(['Chorus','Tremolo','Flanger','Phaser','Auto Pan'].includes(e.type))return 'modulation';
    if(e.type==='Stereo Width')return 'stereo';
    if(['Drive','Soft Clipper','Bit Reducer'].includes(e.type))return 'drive';
    return 'level';
  }
  const plotTitles={eq:'Frequency response',pedals:'Signal',dynamics:'Input to output',delay:'Echo taps',
    reverb:'Reverb tail',modulation:'Modulation',stereo:'Stereo vectorscope',drive:'Transfer curve',
    level:'Signal',envelope:'Amplitude envelope',drums:'Drum envelope'};
  const standardHandles={
    dynamics:[{key:'threshold',label:'Threshold',x:'threshold',y:'ratio'}],
    delay:[{key:'tap',label:'First repeat',x:'time',y:'feedback'}],
    reverb:[{key:'mix',label:'Reverb mix',y:'mix',fixedX:.19}],
    modulation:[{key:'lfo',label:'Modulation',x:'rate',y:'depth'}],
    stereo:[{key:'width',label:'Stereo width',x:'width',fixedY:.72}],
    drive:[{key:'drive',label:'Drive controls',x:'drive',y:'output'}],
    level:[{key:'gain',label:'Gain',y:'gain',fixedX:.5}],
    envelope:[{key:'attack',label:'Attack',x:'attack',fixedY:.08},
      {key:'decay',label:'Decay and sustain',x:'decay',y:'sustain'},
      {key:'release',label:'Release',x:'release',fixedY:.92}],
    drums:[{key:'drum',label:'Kick decay and pitch',x:'decay',y:'pitch'}]
  };
  function pluginHandles(mode,e){
    if(mode==='eq')return eqHandles(e);
    const handles=standardHandles[mode]||[];
    return handles.map(handle=>{
      const {x,y}=handle, params=e?.params;
      return {...handle,color:'#8ddfc6',on:true,
        x:params&&x&&!(x in params)?(x==='drive'?'amount':undefined):x,
        y:params&&y&&!(y in params)?undefined:y};
    });
  }
  const normalize=(value,spec)=>SW.dialFraction(value,spec[0],spec[1],spec[4]);
  const dial=(fraction,spec)=>SW.dialValue(fraction,spec[0],spec[1],spec[3],spec[4]);
  function envelopePoints(values,specs){
    const attack=.03+.26*normalize(values.attack,specs.attack);
    const decay=attack+.035+.23*normalize(values.decay,specs.decay);
    const hold=decay+.12;
    return [attack,decay,hold,hold+.035+.26*normalize(values.release,specs.release)];
  }
  function handlePosition(mode,handle,values,specs,range){
    const {x,y}=handle;
    if(mode==='eq')return coordinate(frequencyX(values[x]??handle.frequency),y?eqY(values[y],range):.5);
    if(mode==='envelope'){
      const stages=envelopePoints(values,specs);
      return coordinate(stages[{attack:0,decay:1,release:3}[handle.key]],y?.length ? .92-values[y]*.84 : handle.fixedY);
    }
    return coordinate(x?normalize(values[x],specs[x]):handle.fixedX??.5,
      y?1-normalize(values[y],specs[y]):handle.fixedY??.5);
  }
  function handleValues(mode,handle,position,values,specs,range){
    const [tx,ty]=plotPosition(...position),{x,y}=handle,changes={};
    if(x){
      let fraction=tx;
      if(mode==='envelope'){
        const [attack,,hold]=envelopePoints(values,specs);
        fraction=({attack:(tx-.03)/.26,decay:(tx-attack-.035)/.23,release:(tx-hold-.035)/.26})[handle.key];
      }
      changes[x]=mode==='eq'?clamp(Math.round(frequencyAt(tx)),specs[x][0],specs[x][1]):dial(fraction,specs[x]);
    }
    if(y){
      const fraction=mode==='eq'?.5-(ty-.5)*range*2/(specs[y][1]-specs[y][0]):
        mode==='envelope'?(.92-ty)/.84:1-ty;
      changes[y]=dial(fraction,specs[y]);
    }
    return changes;
  }
  // Reuse the processing engine's BiquadFilter definitions for the stopped response.
  let responseContext, cachedDesign;
  function offlineFilters(e,sampleRate){
    const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
    if(!Offline)return [];
    if(responseContext?.sampleRate!==sampleRate){
      responseContext=new Offline(1,1,sampleRate);cachedDesign=null;
    }
    const stages=SW.filterStages(e), signature=JSON.stringify(stages);
    if(signature!==cachedDesign?.signature){
      cachedDesign={signature,filters:stages.map(()=>responseContext.createBiquadFilter())};
    }
    const link=(key,param)=>{param.value=e.params[key];};
    return cachedDesign.filters.map((node,i)=>SW.configureFilter(node,stages[i],link));
  }
  const magnitudes=new Float32Array(frequencies.length), phases=new Float32Array(frequencies.length);
  const response=new Float32Array(frequencies.length);
  function frequencyResponse(e,processor,sampleRate=48000){
    response.fill(e.bypass?0:e.type==='Spectrum EQ'?e.params.output:0);
    if(e.bypass)return response;
    for(const filter of processor?.filters||offlineFilters(e,sampleRate)){
      filter.getFrequencyResponse(frequencies,magnitudes,phases);
      for(let i=0;i<response.length;i++){
        if(Number.isFinite(magnitudes[i]))response[i]+=20*Math.log10(Math.max(.00001,magnitudes[i]));
      }
    }
    return response;
  }
  function createPluginProbe(){
    let current;
    function clear(){
      if(!current)return;
      for(const [from,to] of current.connections)try{from.disconnect(to);}catch{}
      current=null;
    }
    function read(graph,track,e){
      const node=graph?.tracks?.get(track), processor=e&&node?.processors.get(e.id);
      const sources=processor?[processor.input,processor.output]:!e&&node?[node.analyzer]:[];
      if(!sources[0]||!graph.ctx?.createAnalyser){clear();return null;}
      if(current?.graph!==graph||current.track!==track||current.id!==e?.id){
        clear();
        const left=new Float32Array(1024),right=new Float32Array(1024);
        const connections=[], connect=(from,to,...channels)=>{from.connect(to,...channels);connections.push([from,to]);return to;};
        const tap=source=>{
          const analyzer=connect(source,graph.ctx.createAnalyser());
          analyzer.fftSize=4096;analyzer.smoothingTimeConstant=.78;
          return analyzer;
        };
        const input=tap(sources[0]),output=processor?tap(sources[1]):input;
        const stereo=e?.type==='Stereo Width';
        const split=stereo?connect(processor.output,graph.ctx.createChannelSplitter(2)):null;
        const fftIn=new Float32Array(input.frequencyBinCount),fftOut=new Float32Array(output.frequencyBinCount);
        const stereoLeft=stereo?connect(split,graph.ctx.createAnalyser(),0):null;
        const stereoRight=stereo?connect(split,graph.ctx.createAnalyser(),1):null;
        if(stereo)stereoLeft.fftSize=stereoRight.fftSize=1024;
        current={graph,track,id:e?.id,processor,input,output,connections,fftIn,fftOut,left,right,stereoLeft,stereoRight};
      }
      const signal=current;
      signal.input.getFloatFrequencyData(signal.fftIn);
      signal.output.getFloatFrequencyData(signal.fftOut);
      (signal.stereoLeft||signal.output).getFloatTimeDomainData(signal.left);
      if(signal.stereoRight)signal.stereoRight.getFloatTimeDomainData(signal.right);
      return signal;
    }
    return {read,clear};
  }
  function paintPluginPlot(canvas,mode,e,v,specs,signal,{range=24,source='both',sampleRate=48000}={}){
    const g=canvas?.getContext?.('2d');
    if(!g?.save)return;
    const {width:w,height:h}=canvas;
    const [left,top]=coordinate(0,0).map((value,i)=>value*[w,h][i]);
    const [right,bottom]=coordinate(1,1).map((value,i)=>value*[w,h][i]);
    const xy=(x,y)=>[left+x*(right-left),top+y*(bottom-top)];
    const path=(points,ink,thickness=1,fill)=>{
      g.beginPath();
      points.forEach(([x,y],i)=>i?g.lineTo(...xy(x,y)):g.moveTo(...xy(x,y)));
      if(fill){g.closePath();g.fillStyle=fill;g.fill();}
      g.strokeStyle=ink;g.lineWidth=thickness;g.stroke();
    };
    const label=(text,x,y)=>g.fillText(text,...xy(x,y));
    g.fillStyle='#0a1720';g.fillRect(0,0,w,h);
    g.font='12px ui-monospace, monospace';g.fillStyle='#9fb3bf';
    if(mode==='eq'){
      for(const hz of [20,50,100,200,500,1000,2000,5000,10000,20000]){
        const x=frequencyX(hz);
        path([[x,0],[x,1]],'#263945');
        g.textAlign=x>.97?'right':x<.01?'left':'center';
        label(hz>=1000?hz/1000+'k':String(hz),x,1.11);
      }
      g.textAlign='right';
      for(const db of [-range,-range/2,0,range/2,range]){
        const y=eqY(db,range);
        path([[0,y],[1,y]],db===0?'#48606b':'#263945');
        label((db>0?'+':'')+db,-.013,y+.024);
      }
      if(source!=='off'){
        g.textAlign='left';g.fillStyle='#80bba9';
        label('dBFS',1.011,-.033);
        for(const level of [0,-24,-48,-72,-96])label(String(level),1.011,-level/96+.024);
      }
    }else{
      for(let i=0;i<=5;i++)path([[i/5,0],[i/5,1]],'#263945');
      for(let i=0;i<=4;i++)path([[0,i/4],[1,i/4]],i===2?'#48606b':'#263945');
    }
    g.save();g.beginPath();g.rect(left,top,right-left,bottom-top);g.clip();
    if(mode==='eq'){
      const spectrum=(bins,fill,ink)=>{
        const points=Array.from(frequencies,(hz,i)=>{
          const index=hz*signal.input.fftSize/signal.graph.ctx.sampleRate;
          const lower=Math.floor(index), upper=Math.min(lower+1,bins.length-1);
          const a=Math.max(-96,bins[lower]??-96),b=Math.max(-96,bins[upper]??-96);
          return [i/(frequencies.length-1),1-clamp((a+(b-a)*(index-lower)+96)/96,0,1)];
        });
        path([[0,1],...points,[1,1]],ink,1,fill);
      };
      if(signal&&source!=='off'){
        if(source==='both'||source==='input')spectrum(signal.fftIn,'#7eacd31a','#7eacd3a8');
        if(source==='both'||source==='output')spectrum(signal.fftOut,'#6fd5b732','#6fd5b7bc');
      }
      const curve=frequencyResponse(e,signal?.processor,signal?.graph.ctx.sampleRate||sampleRate);
      path(Array.from(curve,(gain,i)=>[i/(curve.length-1),eqY(gain,range)]),e.bypass?'#9ba9ac':'#b5f7df',2.6);
    }else{
      const accent=e?.bypass?'#9ba9ac':'#9aeaca';
      const graph=(fn,ink=accent)=>path(Array.from({length:144},(_,i)=>[i/143,fn(i/143)]),ink,2.2);
      if(signal&&mode!=='stereo'&&mode!=='pedals'&&mode!=='level'){
        graph(x=>.5-.46*signal.left[Math.round(x*(signal.left.length-1))],'#7ea9cc69');
      }
      if(mode==='envelope'){
        const [a,d,s,r]=envelopePoints(v,specs), level=.92-v.sustain*.84;
        const points=[[0,.92],[a,.08],[d,level],[s,level],[r,.92],[1,.92]];
        path([...points,[1,1],[0,1]],'#5bbba272',1,'#4bdcb521');path(points,accent,2.2);
      }
      if(mode==='drums')graph(x=>.91-.82*Math.exp(-x/(.055+v.decay*.55)));
      if(mode==='delay'){
        const first=.09+normalize(v.time,specs.time)*.24;
        path([[0,1],[0,.13]],'#8199b0',2);
        for(let i=0;i<12&&first+i*first*.67<1;i++){
          const x=first+i*first*.67, level=v.mix*v.feedback**i;
          path([[x,1],[x,1-level*.92]],accent,3);
        }
      }
      if(mode==='reverb')graph(x=>1-v.mix*(1-x)**3*(.82+.12*Math.sin(x*308)));
      if(mode==='modulation')graph(x=>.5+.43*normalize(v.depth,specs.depth)*Math.sin(x*Math.PI*2*(.6+4*normalize(v.rate,specs.rate))));
      if(mode==='dynamics'){
        path([[0,1],[1,0]],'#6f8a9e',1);
        graph(x=>{
          const input=-80+80*x, ratio=v.ratio??20,knee=e.type==='Limiter'?0:12;
          const over=input-v.threshold;
          const reduction=knee&&over>-knee/2&&over<knee/2?(1-1/ratio)*(over+knee/2)**2/(2*knee):Math.max(0,over)*(1-1/ratio);
          const output=input-reduction;
          const mix=v.mix??1;
          return 1-(80+20*Math.log10((1-mix)*db(input)+mix*db(output)))/80;
        });
      }
      if(mode==='drive'){
        path([[0,1],[1,0]],'#6f8a9e');
        graph(x=>{
          const input=x*2-1;
          if(e.type==='Drive')return .5-.5*v.output*Math.tanh(clamp(input*(.28+v.amount*3.7),-1,1)*2.8);
          const driven=clamp(input*db(v.drive),-1,1);
          return e.type==='Soft Clipper'?.5-.5*Math.tanh(1.5*driven)*db(v.output):
            .5-.5*((1-v.mix)*input+v.mix*Math.round(driven*16)/16);
        });
      }
      if(mode==='stereo'){
        path([[.5,0],[.5,1]],'#506a78');path([[0,.5],[1,.5]],'#506a78');
        if(signal)path(Array.from({length:signal.left.length},(_,i)=>[
          .5+(signal.right[i]-signal.left[i])*.25,.5-(signal.right[i]+signal.left[i])*.25
        ]),'#92f4d4a2');
      }
      if(mode==='pedals'||mode==='level'){
        if(signal)graph(x=>.5-.46*signal.left[Math.round(x*(signal.left.length-1))]);
        else path([[0,.5],[1,.5]],accent);
      }
    }
    g.restore();
    if(mode!=='eq'){
      g.textAlign='left';g.fillStyle='#9fb3bf';
      if(mode==='dynamics'){label('−80 dB',0,1.11);g.textAlign='right';label('0 dB',1,1.11);}
      if(mode==='delay'){label('Dry',0,1.11);g.textAlign='right';label(Math.round(v.time*1000)+' ms per repeat',1,1.11);}
      if(mode==='modulation'){label(v.rate.toFixed(2)+' Hz',0,1.11);}
      if(mode==='stereo'){label('L − R',0,1.11);g.textAlign='right';label('L + R',1,1.11);}
    }
  }
  return {pluginPlot,plotTitles,pluginHandles,handlePosition,handleValues,frequencyResponse,createPluginProbe,paintPluginPlot};
})());
