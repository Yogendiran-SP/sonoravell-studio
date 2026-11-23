'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const context=vm.createContext({structuredClone,crypto,console,TextEncoder,TextDecoder,ArrayBuffer,Blob,btoa,atob,URL,URLSearchParams});
for(const name of ['model','arrangement','formats','spatial','studio-panels','patch','workflows','midi-expression','track-icons',
  'workspace-documents','workspace-views','session-views']){
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),context,{filename:name+'.js'});
}
const T=context.SW;
const {mastering,show}=T.workspaceViews;
const owner=()=>({showPlayerTypes:T.showPlayerTypes,position:0,playing:false});
for(const [key,[kind]] of Object.entries(T.workspaceTemplates)){
  if(kind!=='session')continue;
  const session=T.createSessionTemplate(key,'Band rehearsal',112,4,'Test Artist');
  assert.equal(T.validateProject(session),session);
  assert.equal(session.bpm,112);
}
const master=T.createWorkspaceDocument('mastering','Steady State','Test Artist');
const verse=T.masteringTrack(T.uid(),'Verse',5),reprise=T.masteringTrack(T.uid(),'Reprise',8);
master.items.push(verse,reprise);
verse.start=1;verse.fadeIn=.6;verse.fadeOut=12;T.normalizeMasterTrack(verse);
reprise.gap=2;reprise.chain='clean';master.chain='limit';master.volume=-1;
assert.equal(verse.fadeOut,3.4);
assert.equal(T.masteringLayout(master.items)[1].start,6);
assert.equal(T.masteringLayout(master.items)[1].end,14);
const assembly=T.masteringProgram(master);
assert.equal(assembly.length,14);
assert.equal(assembly.composition.master.volume,-1);
assert.equal(assembly.composition.master.fx[0].type,'Limiter');
assert.equal(assembly.composition.tracks[1].fx.length,2);
assert.equal(assembly.composition.tracks[0].clips[0].offset,1);
assert.equal(assembly.composition.tracks[0].clips[0].fadeIn,.6);
assert.equal(T.masteringProgram(master,reprise.id).length,8);
const dataA=Uint8Array.from([1,2,3]),dataB=Uint8Array.from([4,5]);
const parsed=T.decodeWorkspaceDocument(JSON.parse(T.encodeWorkspaceDocument(master,new Map([
  [verse.asset,{bytes:dataA.buffer}],[reprise.asset,{bytes:dataB.buffer}]
]))));
assert.deepEqual([...new Uint8Array(parsed.raw.get(verse.asset))],[1,2,3]);
assert.equal(parsed.doc.items[1].gap,2);
const invalid=T.clone(master);
invalid.items[1].asset=invalid.items[0].asset;
assert.throws(()=>T.validateWorkspaceDocument(invalid),/conflicting source durations/);
const masterPage=mastering({doc:master,selected:verse.id,media:new Map(),playback:owner(),stats:null});
assert.match(masterPage,/Track Column/);
assert.match(masterPage,/Track Lane/);
assert.match(masterPage,/Digital Release/);
assert.match(masterPage,/00?0:06\.000|0:06\.000/);

const showDoc=T.createWorkspaceDocument('show','Evening Show','Test Artist');
const keys=T.showPlayer('virtual','Keys'),real=T.showPlayer('real','Vocal');
showDoc.players.push(keys,real);
const verseItem=T.showItem('Verse',verse.asset,showDoc.players[0].id,5);
const last=T.showItem('Reprise',reprise.asset,showDoc.players[0].id,8);
keys.patches.push({id:T.uid(),name:'Ambient Pad',gain:-5,mute:false,instrument:'Pad'});
verseItem.patches[keys.id]=keys.patches[0].id;
verseItem.sections.push(T.showSection('Intro',0,2.5));
verseItem.sections[0].mode='repeat';
verseItem.video={asset:T.uid(),name:'Intro.mp4',mime:'video/mp4'};
verseItem.lyrics='I can see the sky';
showDoc.items.push(verseItem,last);
assert.equal(T.validateWorkspaceDocument(showDoc),showDoc);
assert.equal(T.playerPatch(keys,verseItem).instrument,'Pad');
assert.equal(T.showProgram(showDoc,verseItem).composition.tracks.find(t=>t.id===keys.id).volume,-5);
assert.equal(T.showProgram(showDoc,verseItem).composition.tracks[0].clips[0].length,5);
assert.ok(T.moveWorkspaceRow(showDoc.items,last.id,-1));
assert.equal(showDoc.items[0].id,last.id);
assert.equal(T.decodeWorkspaceDocument(JSON.parse(T.encodeWorkspaceDocument(showDoc,new Map([
  [verse.asset,{bytes:dataA.buffer}],[reprise.asset,{bytes:dataB.buffer}],[verseItem.video.asset,{bytes:dataA.buffer}]
])))).doc.items[1].sections[0].mode,'repeat');
assert.match(show({doc:showDoc,selected:verseItem.id,selectedPlayer:keys.id,playback:owner(),perform:false,monitors:new Map()}),/Video Track/);
assert.match(show({doc:showDoc,selected:verseItem.id,selectedPlayer:keys.id,playback:owner(),perform:true,performTab:'lyrics',monitors:new Map()}),/I can see the sky/);

const session=T.demo(), track=session.tracks[0], clip=track.clips[0], sceneId=T.uid();
session.launcher={scenes:[{id:sceneId,name:'Intro',cells:{[track.id]:T.ideaClip(clip,0)}}],playlist:[sceneId]};
session.scratchPads=[{id:T.uid(),name:'Alternative',events:[{track:track.id,clip:T.ideaClip(clip,1)}]}];
T.validateProject(session);
const ideas=T.ideaProgram(session,[session.scratchPads[0].events,session.scratchPads[0].events]);
assert.equal(ideas.length,(clip.length+1)*2);
assert.notEqual(ideas.project.tracks[0].clips[0].id,clip.id);
assert.notEqual(ideas.project.tracks[0].clips[0].notes[0].id,clip.notes[0].id);
assert.equal(T.decodeProject(T.encodeProject(session,new Map())).p.launcher.playlist[0],sceneId);
T.removeChannel(session,track.id);
assert.equal(Object.keys(session.launcher.scenes[0].cells).length,0);
assert.equal(session.scratchPads[0].events.length,0);
T.validateProject(session);
assert.equal(T.notationStep(72)-T.notationStep(60),7);
assert.equal(T.notationStep(60),T.notationStep(61));
console.log('Workspace templates, mastering assembly/audio data, Show backing, patches and video, persistent sections, and Session ideas passed.');
