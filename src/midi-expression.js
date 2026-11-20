(function (SW) {
  const {clamp}=SW;
  const midiLanes={
    bend:['Pitch bend',-8192,8191,1,'',0],
    cc1:['Mod wheel · CC1',0,127,1,'',0],
    cc11:['Expression · CC11',0,127,1,'',127],
    cc64:['Sustain pedal · CC64',0,127,1,'',0],
    cc74:['Brightness · CC74',0,127,1,'',64],
    cc91:['Reverb send · CC91',0,127,1,'',0],
    cc93:['Chorus send · CC93',0,127,1,'',0]
  };
  const velocity=['Velocity',1,127,1,'',100];
  function expressionSpecs(t) {
    const settings=SW.instrumentSettings(t);
    const supported=Object.fromEntries(Object.entries(SW.instrumentSpecs(t.instrument))
      .map(([key,spec])=>['inst:'+key,[...spec,settings[key]]]));
    return {velocity,...midiLanes,...supported};
  }
  function expressionSpec(key) {
    if(Object.hasOwn(midiLanes,key))return midiLanes[key];
    if(!key.startsWith('inst:'))return undefined;
    for(const name of Object.keys(SW.instruments)){
      const spec=SW.instrumentSpecs(name)[key.slice(5)];
      if(Array.isArray(spec)) return spec;
    }
  }
  function pointValue(points,at,fallback,step=false) {
    if(!points?.length||at<points[0].at)return fallback;
    let lo=0,hi=points.length;
    while(lo<hi){
      const mid=(lo+hi)>>1;
      if(points[mid].at<=at) lo=mid+1;else hi=mid;
    }
    const prev=points[lo-1],next=points[lo];
    return step||!next?prev.value:prev.value+(next.value-prev.value)*(at-prev.at)/(next.at-prev.at);
  }
  function setExpression(c,key,at,value){
    const spec=expressionSpec(key);
    if(!spec||!Number.isFinite(at)||!Number.isFinite(value))return;
    const [,min,max,step]=spec;
    const point={at:Number(clamp(at,0,c.length??100000).toFixed(7)),value:clamp(Number((Math.round(value/step)*step).toFixed(7)),min,max)};
    const points=(c.expression??={})[key]??=[];
    const index=points.findIndex(row=>row.at>=point.at);
    if(index===-1)points.push(point);
    else if(points[index].at===point.at) points[index]=point;
    else points.splice(index,0,point);
    return point;
  }
  function expressionSlice(c,from,to,includeEnd=true){
    if(!c.expression) return undefined;
    const entries=[];
    for(const [key,points] of Object.entries(c.expression)){
      const first=points[0];
      if(!first)continue;
      const carried=from>first.at?pointValue(points,from,first.value,key==='cc64'):undefined;
      const inside=points.filter(point=>point.at>=from&&(includeEnd?point.at<=to:point.at<to))
        .map(point=>({at:Number((point.at-from).toFixed(7)),value:point.value}));
      if(carried!==undefined&&inside[0]?.at!==0)inside.unshift({at:0,value:carried});
      if(key!=='cc64'&&includeEnd&&to>first.at&&to<points.at(-1).at&&inside.at(-1)?.at!==Number((to-from).toFixed(7)))
        inside.push({at:Number((to-from).toFixed(7)),value:pointValue(points,to,first.value)});
      if(inside.length)entries.push([key,inside]);
    }
    return Object.fromEntries(entries);
  }
  function sustainedEnd(c,end){
    const lane=c.expression?.cc64;
    if(pointValue(lane,end,0,true)<64) return end;
    return lane.find(point=>point.at>end&&point.value<64)?.at??c.length;
  }
  function midiControl(code,a,b){
    const type=code>>4;
    if(type===14)return ['bend',(b<<7)+a-8192];
    const key='cc'+a;
    if(type===11&&Object.hasOwn(midiLanes,key))return [key,b];
  }
  function encodeControl(key,value,channel){
    const n=Math.round(value);
    if(key==='bend'){const word=n+8192;return [224|channel,word&127,word>>7];}
    if(key.startsWith('cc')&&Object.hasOwn(midiLanes,key))return [176|channel,Number(key.slice(2)),n];
  }
  Object.assign(SW,{midiLanes,expressionSpecs,expressionSpec,pointValue,setExpression,expressionSlice,sustainedEnd,midiControl,encodeControl});
})(SW);
