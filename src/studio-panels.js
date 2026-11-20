'use strict';
Object.assign(SW, (() => {
  const {clamp}=SW;
  const artNames=['Keys','Bass','Pad','Lead','Pluck','Organ','Strings','Drums','Sampler',
    'Parametric EQ','Low Cut','Low Pass','High Shelf','Compressor','Limiter','Echo','Room Reverb','Drive',
    'Chorus','Tremolo','Stereo Width','Low Shelf','Band Pass','Notch','Three-Band EQ','Parallel Compressor',
    'Slap Delay','Hall Reverb','Flanger','Phaser','Auto Pan','Soft Clipper','Bit Reducer','Cabinet Filter','Polarity','Utility Gain'];
  function art(name){
    const i=artNames.indexOf(name);
    return i<0?null:{x:(i%6)*20,y:Math.floor(i/6)*20};
  }
  const general={
    attack:['Attack',.001,2,.001,'s'],decay:['Decay',.01,3,.001,'s'],sustain:['Sustain',0,1,.001,''],
    release:['Release',.01,5,.001,'s'],cutoff:['Cutoff',30,18000,1,'Hz'],resonance:['Resonance',.1,18,.1,'Q'],
    level:['Level',0,1,.001,''],tune:['Fine tune',-100,100,1,'¢']
  };
  const drum={
    pitch:['Kick pitch',40,150,1,'Hz'],decay:['Drum decay',.03,.8,.001,'s'],
    noise:['Noise level',0,1,.001,''],level:['Level',0,1,.001,'']
  };
  const sampler={
    attack:general.attack,decay:general.decay,sustain:general.sustain,release:general.release,
    cutoff:general.cutoff,resonance:general.resonance,level:general.level,tune:general.tune,
    root:['Root note',0,127,1,'MIDI'],start:['Sample start',0,.95,.001,'']
  };
  const space={
    reverb:['Reverb mix',0,1,.01,''],delay:['Delay mix',0,1,.01,''],
    delayTime:['Delay time',.01,1.8,.01,'s'],delayFeedback:['Delay feedback',0,.9,.01,''],
    chorus:['Chorus mix',0,1,.01,'']
  };
  function instrumentSpecs(name){
    const controls=name==='Sampler'?sampler:name==='Drums'?drum:general;
    return {...controls,...space,bendRange:['Pitch bend range',0,24,1,'st'],
      ...(name==='Drums'?{}:{vibrato:['Vibrato depth',0,200,1,'¢']})};
  }
  function instrumentSettings(t){
    const spec=SW.instruments[t.instrument]||SW.instruments.Keys;
    const values=t.synth||{};
    const base=t.instrument==='Drums'?{pitch:114,decay:.12,noise:.7,level:.75}:{
      wave:spec[0]||'triangle',attack:spec[1]??.01,decay:t.instrument==='Pluck'?.2:.13,
      sustain:spec[2]??.5,cutoff:spec[3]??15000,resonance:.7,level:spec[4]??.23,tune:0,
      release:t.instrument==='Pad'||t.instrument==='Strings'?.27:t.instrument==='Bass'?.08:.11,
      root:60,start:0
    };
    return {reverb:0,delay:0,delayTime:.32,delayFeedback:.28,chorus:0,bendRange:2,vibrato:42,...base,...values};
  }
  function dialFraction(value,low,high,unit){
    return unit==='Hz'&&low>0?Math.log(clamp(value,low,high)/low)/Math.log(high/low):clamp((value-low)/(high-low),0,1);
  }
  function dialValue(fraction,low,high,step,unit){
    const x=clamp(fraction,0,1);
    const raw=unit==='Hz'&&low>0?low*(high/low)**x:low+(high-low)*x;
    return clamp(Number((low+Math.round((raw-low)/step)*step).toFixed(7)),low,high);
  }
  return {art,instrumentSpecs,instrumentSettings,dialFraction,dialValue};
})());
