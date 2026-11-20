'use strict';
(function(SW){
  const processorName='soundweave-pcm-capture';
  const processor=`
    class Capture extends AudioWorkletProcessor {
      constructor(options){
        super();
        this.channels=options.processorOptions.channels;
        this.packet=4096;
        this.data=Array.from({length:this.channels},()=>new Float32Array(this.packet));
        this.offset=0;
        this.from=Infinity;
        this.until=Infinity;
        this.port.onmessage=({data})=>{
          if(data.start!==undefined)this.from=data.start;
          if(data.stop!==undefined)this.until=data.stop;
        };
      }
      flush(){
        if(!this.offset)return;
        const chunk=this.data.map(channel=>channel.slice(0,this.offset));
        this.port.postMessage({chunk},chunk.map(channel=>channel.buffer));
        this.offset=0;
      }
      process(inputs,outputs){
        const input=inputs[0], size=outputs[0][0].length;
        const first=Math.max(0,this.from-currentFrame), last=Math.min(size,this.until-currentFrame);
        if(input.length){
          for(let i=first;i<last;i++){
            for(let ch=0;ch<this.channels;ch++)this.data[ch][this.offset]=(input[ch]||input[0])[i];
            if(++this.offset===this.packet)this.flush();
          }
        }
        if(currentFrame+size>=this.until){
          this.flush();
          this.port.postMessage({done:true});
          return false;
        }
        return true;
      }
    }
    registerProcessor('${processorName}',Capture);
  `;
  const registered=new WeakMap();
  function register(context){
    if(!registered.has(context)){
      const url=URL.createObjectURL(new Blob([processor],{type:'text/javascript'}));
      registered.set(context,context.audioWorklet.addModule(url).finally(()=>URL.revokeObjectURL(url)));
    }
    return registered.get(context);
  }
  function pcmCapture(context,source,channels){
    const node=new AudioWorkletNode(context,processorName,{channelCount:channels,channelCountMode:'explicit',outputChannelCount:[1],processorOptions:{channels}});
    const buffers=[];
    let length=0, startFrame=0, timeout, stopped=false, resolveDone, rejectDone, failure;
    source.connect(node).connect(context.destination); // The processor emits zeros.
    node.port.onmessage=({data})=>{
      if(data.chunk){
        length+=data.chunk[0].length;
        buffers.push(data.chunk);
      }
      if(data.done)resolveDone?.();
    };
    node.onprocessorerror=()=>{
      failure=Error('The browser stopped processing the audio input.');
      rejectDone?.(failure);
    };
    return {
      start(when){
        startFrame=Math.round(when*context.sampleRate);
        node.port.postMessage({start:startFrame});
      },
      async stop(){
        if(failure)throw failure;
        if(stopped)throw Error('The audio take is already finishing.');
        stopped=true;
        const stopFrame=Math.round(context.currentTime*context.sampleRate);
        try{
          await new Promise((resolve,reject)=>{
            resolveDone=resolve;rejectDone=reject;
            node.port.postMessage({stop:stopFrame});
            timeout=setTimeout(()=>reject(Error('The audio input stopped responding.')),5000);
          });
          const usable=Math.min(length,stopFrame-startFrame);
          if(usable<=0)throw Error('The audio input returned no samples. Record a longer take.');
          const buffer=context.createBuffer(channels,usable,context.sampleRate);
          let offset=0;
          for(const chunk of buffers){
            const frames=Math.min(chunk[0].length,usable-offset);
            for(let ch=0;ch<channels;ch++)buffer.getChannelData(ch).set(chunk[ch].subarray(0,frames),offset);
            offset+=frames;
            if(offset===usable)break;
          }
          return buffer;
        }finally{clearTimeout(timeout);buffers.length=0;}
      },
      close(){clearTimeout(timeout);node.port.close();node.disconnect();}
    };
  }
  function encodedCapture(context,stream,channels,bitrate){
    const types=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'];
    const mimeType=types.find(type=>MediaRecorder.isTypeSupported?.(type));
    const instance=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),audioBitsPerSecond:bitrate});
    const chunks=[];
    let lead=0, finish, fail, error, ended=false, timeout;
    instance.addEventListener('dataavailable',event=>{if(event.data?.size)chunks.push(event.data);});
    instance.addEventListener('error',event=>{error=event.error||Error('Audio recording failed.');fail?.(error);});
    instance.addEventListener('stop',()=>{ended=true;finish?.();});
    return {
      start(when){
        lead=Math.max(0,when-context.currentTime);
        instance.start(250);
      },
      async stop(){
        if(error)throw error;
        if(!ended)await new Promise((resolve,reject)=>{
          finish=resolve;fail=reject;
          if(instance.state!=='inactive')instance.stop();
          timeout=setTimeout(()=>reject(Error('The browser could not finish the audio take.')),5000);
        }).finally(()=>clearTimeout(timeout));
        const blob=new Blob(chunks,{type:instance.mimeType});
        chunks.length=0;
        if(!blob.size)throw Error('The audio input returned an empty take.');
        const decoded=await context.decodeAudioData(await blob.arrayBuffer());
        const skip=Math.round(lead*decoded.sampleRate);
        if(skip>=decoded.length)throw Error('The audio take is too short. Wait for recording to start.');
        if(!skip&&decoded.numberOfChannels===channels)return decoded;
        const buffer=context.createBuffer(channels,decoded.length-skip,decoded.sampleRate);
        if(channels===1&&decoded.numberOfChannels>1){
          const left=decoded.getChannelData(0),right=decoded.getChannelData(1),mono=buffer.getChannelData(0);
          for(let i=0;i<mono.length;i++)mono[i]=(left[i+skip]+right[i+skip])*.5;
        }else for(let ch=0;ch<channels;ch++)
          buffer.getChannelData(ch).set(decoded.getChannelData(Math.min(ch,decoded.numberOfChannels-1)).subarray(skip));
        return buffer;
      },
      close(){clearTimeout(timeout);if(instance.state!=='inactive')instance.stop();}
    };
  }
  async function captureInput(context,stream,channels,bitrate){
    const source=context.createMediaStreamSource(stream), analyzer=context.createAnalyser();
    analyzer.fftSize=256;
    source.connect(analyzer);
    let engine;
    if(context.audioWorklet&&globalThis.AudioWorkletNode){
      try{await register(context);engine=pcmCapture(context,source,channels);}
      catch(error){if(!globalThis.MediaRecorder){source.disconnect();throw error;}}
    }
    if(!engine){
      if(!globalThis.MediaRecorder){source.disconnect();throw Error('This browser cannot record audio. Open Sonoravell in Chrome or Edge.');}
      engine=encodedCapture(context,stream,channels,bitrate);
    }
    return {...engine,source,analyzer,close(){try{engine.close();}finally{source.disconnect();}}};
  }
  SW.captureInput=captureInput;
})(SW);
