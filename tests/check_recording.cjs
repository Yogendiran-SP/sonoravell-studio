'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const test=vm.createContext({SW:{},URL,Blob,setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/recording.js'),'utf8'),test);
class Node {
  port={close(){}};
  connect(target){return target;}
  disconnect(){}
}
const context={
  sampleRate:48000,currentTime:0,destination:new Node(),
  createMediaStreamSource:()=>new Node(),createAnalyser:()=>new Node(),
  createBuffer(channels,length,rate){
    const data=Array.from({length:channels},()=>new Float32Array(length));
    return {length,numberOfChannels:channels,sampleRate:rate,getChannelData:index=>data[index]};
  }
};
const block=values=>[values.map(value=>new Float32Array(128).fill(value))];
let Processor, worklet;
const scope=vm.createContext({
  currentFrame:0,
  AudioWorkletProcessor: class {
    port={postMessage:message=>worklet.port.onmessage({data:message})};
  },
  registerProcessor(_,body){Processor=body;}
});
context.audioWorklet={async addModule(url){vm.runInContext(await (await fetch(url)).text(),scope);}};
test.AudioWorkletNode=class extends Node {
  constructor(_context,_name,options){
    super();
    worklet=this;
    this.processor=new Processor(options);
    this.port.postMessage=data=>this.processor.port.onmessage({data});
  }
};

async function verify(){
  const take=await test.SW.captureInput(context,{},2,256000);
  take.start(100/context.sampleRate);
  const output=block([0]);
  worklet.processor.process(block([.25,-.5]),output);
  scope.currentFrame=128;
  context.currentTime=216/context.sampleRate;
  const data=take.stop();
  assert.equal(worklet.processor.process(block([.8,-.2]),output),false);
  const recorded=await data;
  assert.equal(recorded.length,116);
  assert.equal(recorded.numberOfChannels,2);
  assert.equal(recorded.getChannelData(0)[0],.25);
  assert.equal(recorded.getChannelData(1)[27],-.5);
  assert.ok(Math.abs(recorded.getChannelData(0)[28]-.8)<1e-6);
  assert.ok(Math.abs(recorded.getChannelData(1)[115]+.2)<1e-6);
  take.close();

  test.AudioWorkletNode=undefined;
  test.MediaRecorder=class extends EventTarget {
    static isTypeSupported(mime){return mime.startsWith('audio/webm');}
    mimeType='audio/webm';
    state='inactive';
    start(){this.state='recording';}
    stop(){
      this.state='inactive';
      const event=new Event('dataavailable');
      Object.assign(event,{data:new Blob(['sample'])});
      this.dispatchEvent(event);
      this.dispatchEvent(new Event('stop'));
    }
  };
  context.decodeAudioData=async bytes=>{
    assert.equal(bytes.byteLength,6);
    const audio=context.createBuffer(1,2400,context.sampleRate);
    audio.getChannelData(0).fill(.6,480);
    return audio;
  };
  context.currentTime=1;
  const fallback=await test.SW.captureInput(context,{},1,256000);
  fallback.start(1.01);
  const decoded=await fallback.stop();
  assert.equal(decoded.length,1920);
  assert.ok(Math.abs(decoded.getChannelData(0)[0]-.6)<1e-6);
  fallback.close();
  console.log('AudioWorklet PCM start/stop frame bounds, stereo samples, and encoded fallback lead-in trimming passed.');
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
