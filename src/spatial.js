'use strict';
Object.assign(SW, (() => {
  const {clamp,db}=SW;
  const spatialDefaults={mode:'stereo',x:0,y:-.75,z:0,spread:0,lfe:-60};
  const spatialSpecs={
    x:['Left / right',-1,1,.01,''],y:['Front / rear',-1,1,.01,''],z:['Elevation',0,1,.01,''],
    spread:['Spread',0,1,.01,''],lfe:['LFE send',-60,0,.1,'dB']
  };
  const speakers=[
    ['FL',-.5,-.866,0],['FR',.5,-.866,0],['FC',0,-1,0],['LFE',0,0,0],
    ['BL',-.65,.76,0],['BR',.65,.76,0],['SL',-1,0,0],['SR',1,0,0],
    ['TFL',-.5,-.72,1],['TFR',.5,-.72,1],['TBL',-.65,.76,1],['TBR',.65,.76,1]
  ];
  const speakerMask=0x2d63f;
  function position(t){return {...spatialDefaults,...t.spatial};}
  function speakerGains(value){
    const result=new Float64Array(speakers.length);
    const horizontal=Math.hypot(value.x,value.y);
    const direction=horizontal<.001?[0,-1]:[value.x/horizontal,value.y/horizontal];
    const spread=clamp(value.spread,0,1);
    for(const [i,[label,x,y,z]] of speakers.entries()){
      if(label==='LFE') continue;
      const length=Math.hypot(x,y);
      const dot=clamp((direction[0]*x+direction[1]*y)/length,-1,1);
      const gain=Math.exp((dot-1)*(8-6*spread));
      const height=z?value.z:1-value.z;
      result[i]=gain*Math.sqrt(height);
    }
    const power=Math.hypot(...result)||1;
    for(let i=0;i<result.length;i++)result[i]/=power;
    result[3]=value.lfe<=-59.99?0:db(value.lfe);
    return result;
  }
  function cueSettings(p){return p.cues||[];}
  function cueSends(t){return t.cueSends||[];}
  function sendList(t){return [...(t.send?[{to:t.send,level:t.sendLevel,pre:false,legacy:true}]:[]),...(t.sends||[])];}
  return {spatialDefaults,spatialSpecs,speakers,speakerMask,position,speakerGains,cueSettings,cueSends,sendList};
})());
