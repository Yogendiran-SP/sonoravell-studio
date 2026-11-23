'use strict';
Object.assign(SW, (() => {
  const {workspaceNames,workspaceTemplates,masteringChains,showModes,showPlayerTypes}=SW;
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const button=(action,label,{id,key,disabled=false,selected,accent=false,title}={})=>
    '<button type="button" data-ws-action="'+esc(action)+'"'+(id?' data-ws-id="'+esc(id)+'"':'')+
    (key?' data-ws-key="'+esc(key)+'"':'')+(selected===undefined?'':' aria-pressed="'+Boolean(selected)+'"')+
    (accent?' class="accent"':'')+(disabled?' disabled':'')+(title?' title="'+esc(title)+'"':'')+'>'+esc(label)+'</button>';
  const option=(key,label,selected)=>'<option value="'+esc(key)+'"'+(String(key)===String(selected)?' selected':'')+'>'+esc(label)+'</option>';
  const select=(key,label,values,current)=>'<label>'+esc(label)+'<select data-ws-field="'+esc(key)+'" aria-label="'+esc(label)+'">'+
    Object.entries(values).map(([id,name])=>option(id,name,current)).join('')+'</select></label>';
  const field=(key,label,value,{min,max,step,limit=120}={})=>'<label>'+esc(label)+'<input data-ws-field="'+esc(key)+'" aria-label="'+esc(label)+'" value="'+esc(value)+'"'+
    (min===undefined?' maxlength="'+limit+'"':' type="number" min="'+min+'" max="'+max+'" step="'+(step??'any')+'"')+'></label>';
  const time=value=>{
    const ms=Math.round(Math.max(0,value)*1000),s=Math.floor(ms/1000);
    return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');
  };
  const seconds=(key,label,value,min=0,max=86400)=>field(key,label,Number(value.toFixed(3)),{min,max,step:'any'});
  const volume=(key,label,value,max=6)=>field(key,label,value,{min:-60,max,step:.1});
  const db=value=>Number.isFinite(value)?value.toFixed(1)+' dB':'−∞ dB';
  const typeLabel=kind=>kind==='mastering'?'Mastering Project':workspaceNames[kind];
  const heading=(heading,actions='')=>'<header class="ws-panel-head"><h2>'+esc(heading)+'</h2>'+actions+'</header>';
  const section=(name,content,actions='')=>'<section class="ws-panel">'+heading(name,actions)+content+'</section>';
  function viewStart({recents,filter,profile,search,activity}){
    const filters={all:'Recent Files',session:'Sessions',mastering:'Projects',show:'Shows',artist:'Artist Profile',transfers:'Transfers'};
    const cards=Object.entries(workspaceTemplates).filter(([key])=>['blank','mastering','show'].includes(key)).map(([key,[kind,name,description]],index)=>
      '<button class="ws-path path-'+kind+'" data-ws-action="new-template" data-ws-key="'+key+'" type="button">'+
      '<span class="ws-path-mark" aria-hidden="true">'+['∿','≋','▷'][index]+'</span><strong>'+esc(name)+'</strong><span>'+esc(description)+'</span></button>').join('');
    const tabs=Object.entries(filters).map(([key,label])=>button('start-filter',label,{key,selected:filter===key})).join('');
    let content;
    if(filter==='artist'){
      content='<div class="ws-form">'+field('profile-name','Artist',profile.artist)+field('profile-venue','Venue',profile.venue)+
        '<p>These defaults are used when creating a document on this device.</p></div>';
    }else if(filter==='transfers'){
      content=activity.length?'<ul class="ws-transfers">'+activity.map(row=>'<li><b>'+esc(row.label)+'</b><span>'+esc(row.state)+'</span></li>').join('')+'</ul>':
        '<p class="ws-empty">Import and export activity appears here.</p>';
    }else{
      const rows=recents.filter(row=>(filter==='all'||row.kind===filter)&&row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
      content='<label class="ws-search">Search <input id="workspace-search" data-ws-field="search" type="search" value="'+esc(search)+'" placeholder="Find a document…"></label>'+
        '<div id="workspace-recent-list">'+recentRows(rows)+'</div>';
    }
    return '<div class="ws-page ws-start"><header class="ws-title"><div><p>Sonoravell Studio</p><h1>Start</h1></div><div class="ws-actions">'+
      button('new','New…',{accent:true})+button('open','Open…')+button('demo','Open After Hours')+'</div></header>'+
      '<div class="ws-paths">'+cards+'</div><div class="ws-start-grid">'+section(filters[filter],'<nav class="ws-filter" aria-label="Document library">'+tabs+'</nav>'+content)+
      section('Setup','<div class="ws-setup">'+button('audio-setup','Audio Setup…')+button('external-devices','External Devices…')+
      button('preferences','Preferences…')+button('help','Shortcut Guide')+'</div>')+'</div></div>';
  }
  function recentRows(rows,{pins=true}={}){
    return rows.length?'<ul class="ws-recent">'+rows.map(row=>'<li><button type="button" class="ws-file" data-ws-action="open-recent" data-ws-id="'+esc(row.id)+'">'+
      '<span class="ws-kind">'+esc(typeLabel(row.kind))+'</span><strong>'+esc(row.name)+'</strong><small>'+esc(new Date(row.at).toLocaleDateString())+'</small></button>'+
      (pins?button('pin-recent',row.pinned?'Unpin':'Pin',{id:row.id,title:row.pinned?'Unpin from the Start page':'Pin on the Start page'}):'')+'</li>').join('')+'</ul>':
      '<p class="ws-empty">No documents match this view.</p>';
  }
  function transport({position=0,length=0,playing=false},play='Play',extra=''){
    return '<div class="ws-transport" aria-label="Workspace transport">'+button('play',playing?'Stop':play,{accent:true,disabled:!length&&!playing})+
      button('home','Return to Start',{disabled:!length})+'<output data-ws-clock>'+time(position)+'</output><input data-ws-seek type="range" min="0" max="'+
      Math.max(length,.01)+'" step=".01" value="'+Math.min(position,length)+'" aria-label="Playback position"'+(!length?' disabled':'')+'>'+
      '<output>'+time(length)+'</output>'+extra+'</div>';
  }
  function sequence(items,selected,kind){
    return items.length?'<ol class="ws-sequence">'+items.map((item,index)=>'<li data-ws-row="'+esc(item.id)+'">'+
      button('select-row',String(index+1).padStart(2,'0')+'  '+item.name,{id:item.id,selected:item.id===selected,title:'Select '+item.name})+
      '<span>'+time(kind==='mastering'?item.end-item.start:item.length)+'</span><div class="ws-actions">'+
      button('row-up','↑',{id:item.id,disabled:index===0,title:'Move earlier'})+
      button('row-down','↓',{id:item.id,disabled:index===items.length-1,title:'Move later'})+'</div></li>').join('')+'</ol>':
      '<p class="ws-empty">'+(kind==='mastering'?'Import audio or add the current Session mix.':'Add a Setlist Item or import backing audio.')+'</p>';
  }
  function waveform(item,media){
    if(!media.has(item.asset))return '';
    return '<canvas data-ws-wave="'+esc(item.asset)+'" data-ws-from="'+item.start+'" data-ws-to="'+item.end+'" width="450" height="54" aria-label="Audio waveform"></canvas>';
  }
  function viewMastering({doc,selected,media,playback,stats}){
    const item=doc.items.find(row=>row.id===selected), layout=SW.masteringLayout(doc.items);
    const length=layout.at(-1)?.end||0;
    const timeline=layout.length?'<div class="ws-master-lane">'+layout.map(({item,start,end},index)=>
      '<button type="button" class="ws-wave-cell" data-ws-action="select-row" data-ws-id="'+item.id+'" data-ws-row="'+item.id+'" aria-pressed="'+(item.id===selected)+
      '" style="flex-grow:'+Math.max(1,(end-start)/Math.max(length,1)*100)+'"><span>'+String(index+1).padStart(2,'0')+' · '+esc(item.name)+
      '</span>'+waveform(item,media)+'<small>'+time(start)+' – '+time(end)+'</small></button>').join('')+'</div>':
      '<p class="ws-empty">The Track Lane will show your assembled tracks and their start times.</p>';
    const detail=item?'<div class="ws-form">'+field('track-name','Title',item.name)+field('track-artist','Artist',item.artist)+
      field('track-comment','Comment',item.comment,{limit:250})+seconds('track-start','Trim start (s)',item.start)+seconds('track-end','Trim end (s)',item.end)+
      seconds('track-fadeIn','Fade in (s)',item.fadeIn)+seconds('track-fadeOut','Fade out (s)',item.fadeOut)+seconds('track-gap','Gap before (s)',item.gap,0,60)+
      volume('track-gain','Gain (dB)',item.gain,12)+select('track-chain','Track inserts',masteringChains,item.chain)+
      (item.source?'<small>Source Session · '+esc(item.source)+'</small>':'')+'</div><div class="ws-inspector-actions">'+button('remove-row','Remove Track',{id:item.id})+
      button('audition-row','Audition Track',{id:item.id})+button('analyze','Analyze Track',{id:item.id})+'</div>':
      '<p class="ws-empty">Select a track to edit its trims, fades, levels, and metadata.</p>';
    return '<div class="ws-page ws-production"><header class="ws-title"><div><p>Mastering</p><h1>'+esc(doc.name)+'</h1></div><div class="ws-actions">'+
      button('import-audio','Add Tracks…')+button('from-session','Add Session')+button('save','Save')+button('digital-release','Digital Release…',{accent:true,disabled:!length})+'</div></header>'+
      '<div class="ws-master-grid">'+section('Track Column',sequence(doc.items,selected,'mastering'))+
      '<div class="ws-production-center">'+section('Track Lane',timeline)+transport({...playback,length})+
      section('Metering','<div class="ws-meters"><label>Peak <meter data-ws-meter min="-72" max="0" low="-24" high="-4" value="-72"></meter></label>'+
        '<output data-ws-peak>−∞ dBFS</output>'+(stats?'<output>Analyzed peak '+db(stats.peak)+'FS · RMS '+db(stats.rms)+'FS</output>':'')+'</div>')+
      section('Master','<div class="ws-form">'+field('name','Project name',doc.name)+field('album','Album',doc.album)+field('artist','Artist',doc.artist)+
      volume('volume','Output (dB)',doc.volume)+select('chain','Master inserts',masteringChains,doc.chain)+'</div>')+'</div>'+
      section('Track Inspector',detail)+'</div></div>';
  }
  function patchOptions(player,item){
    return {'':'Player Default',...Object.fromEntries(player.patches.map(patch=>[patch.id,patch.name]))};
  }
  function showOverview(doc,item,selectedPlayer,monitors){
    return '<div class="ws-player-grid">'+doc.players.map(player=>{
      const source=item?.slots[player.id], patch=SW.playerPatch(player,item), selected=player.id===selectedPlayer;
      return '<article class="ws-player'+(selected?' selected':'')+'"><div class="ws-player-head">'+
        button('select-player',player.name,{id:player.id,selected})+'<small>'+esc(showPlayerTypes[player.type])+'</small></div>'+
        '<div class="ws-actions">'+button('player-mute',patch.mute?'Unmute':'Mute',{id:player.id,selected:patch.mute})+
        (player.type==='backing'&&item?button('load-slot',source?'Replace Audio…':'Load Audio…',{id:player.id}):'')+
        (player.type==='real'?button('monitor',monitors.has(player.id)?'Stop Monitor':'Monitor Input',{id:player.id,selected:monitors.has(player.id)}):'')+
        (player.type==='virtual'?button('audition-player','Audition',{id:player.id}):'')+'</div>'+
        (source?'<small>Backing · '+time(source.duration)+'</small>':'')+'</article>';
    }).join('')+'</div>';
  }
  function showPlayerEditor(player,item){
    if(!player)return '<p class="ws-empty">Select a Player to edit its volume, patch, or instrument.</p>';
    const patch=SW.playerPatch(player,item);
    const control=patch===player?'player':'patch';
    return '<div class="ws-form">'+field('player-name','Player name',player.name)+volume(control+'-gain','Gain (dB)',patch.gain)+
      (player.type==='virtual'?select(control+'-instrument','Instrument',Object.fromEntries(
        Object.keys(SW.instruments).filter(name=>name!=='Sampler').map(name=>[name,name])),patch.instrument):'')+
      (item?select('patch-id','Patch',patchOptions(player,item),item.patches[player.id]||''):'')+
      (patch!==player?field('patch-name','Patch name',patch.name):'')+'</div><div class="ws-inspector-actions">'+
      (item?button('save-patch','Save New Patch',{id:player.id})+(patch!==player?button('remove-patch','Remove Patch',{id:player.id,key:patch.id}):''):'')+
      button('remove-player','Remove Player',{id:player.id})+'</div>';
  }
  function showSections(item,editing,position){
    return (item?.sections||[]).map(section=>{
      const active=position>=section.start&&position<section.end;
      return '<div class="ws-section-row" data-ws-section="'+section.id+'">'+
        button('section-jump',section.name,{id:section.id,selected:active})+
        '<time>'+time(section.start)+' – '+time(section.end)+'</time>'+
        (editing?'<div class="ws-form">'+field('section-name','Name',section.name)+seconds('section-start','Start (s)',section.start,0,item.length)+
          seconds('section-end','End (s)',section.end,0,item.length)+select('section-mode','Playback mode',showModes,section.mode)+
          field('section-loops','Passes',section.loops,{min:1,max:99,step:1})+'</div>'+button('remove-section','Remove Section',{id:section.id}):'')+'</div>';
    }).join('')||(editing?'<p class="ws-empty">Add cue points for songs with multiple sections.</p>':'');
  }
  function performance(doc,item,args){
    const {performTab,playback,monitors}=args;
    const tabs={controls:'Controls',patches:'Patches',sections:'Sections',lyrics:'Lyrics',video:'Video'};
    let center;
    if(performTab==='lyrics')center='<div class="ws-lyrics">'+esc(item?.lyrics||'No lyrics for this item.')+'</div>';
    else if(performTab==='video')center=item?.video?'<video data-ws-show-video playsinline muted preload="metadata"></video>':
      '<p class="ws-empty">Import video into a Setlist Item in Edit View.</p>';
    else if(performTab==='sections')center='<div class="ws-performance-sections">'+showSections(item,false,playback.position)+'</div>';
    else if(performTab==='patches')center='<div class="ws-performance-patches">'+doc.players.map(player=>section(player.name,
      '<div class="ws-actions">'+button('assign-patch','Player Default',{id:player.id,key:'default',selected:!item?.patches[player.id]})+
      player.patches.map(patch=>button('assign-patch',patch.name,{id:player.id,key:patch.id,selected:item?.patches[player.id]===patch.id})).join('')+'</div>')).join('')+'</div>';
    else center=showOverview(doc,item,args.selectedPlayer,monitors);
    return '<div class="ws-page ws-performance"><header class="ws-title"><div><p>Performance View</p><h1>'+esc(item?.name||doc.name)+'</h1></div>'+
      button('performance','Edit View')+'</header><nav class="ws-filter" aria-label="Performance View">'+
      Object.entries(tabs).map(([key,label])=>button('perform-tab',label,{key,selected:key===performTab})).join('')+'</nav>'+
      '<div class="ws-stage-grid">'+section('Setlist',sequence(doc.items,item?.id,'show'))+'<div class="ws-performance-body">'+center+'</div></div>'+
      transport({...playback,length:item?.length||0},'Play',button('previous-item','Previous')+button('next-item','Next'))+'</div>';
  }
  function viewShow(args){
    const {doc,selected,selectedPlayer,playback,perform,monitors}=args;
    const item=doc.items.find(row=>row.id===selected);
    if(perform)return performance(doc,item,args);
    const player=doc.players.find(row=>row.id===selectedPlayer);
    const sectionTools=button('add-section','Add Section',{disabled:!item});
    const setlistDetail=item?'<div class="ws-form">'+field('item-name','Item name',item.name)+
      select('item-mode','Playback mode',{continue:'Continue',stop:'Stop at End',loop:'Loop'},item.mode)+
      seconds('item-length','Length (s)',item.length,.01)+seconds('item-pause','Pause before (s)',item.pause,0,600)+
      field('item-tempo','Tempo (BPM)',item.tempo,{min:30,max:320,step:.1})+
      field('item-meter','Beats per bar',item.meter,{min:2,max:12,step:1})+
      '<label class="ws-span">Lyrics<textarea data-ws-field="item-lyrics" maxlength="12000" rows="4">'+esc(item.lyrics)+'</textarea></label></div>'+
      '<div class="ws-inspector-actions">'+button('remove-row','Remove Item',{id:item.id})+'</div>':'<p class="ws-empty">Select an item to edit its playback settings.</p>';
    return '<div class="ws-page ws-production"><header class="ws-title"><div><p>Show · Edit View</p><h1>'+esc(doc.name)+'</h1></div><div class="ws-actions">'+
      button('add-item','Add Setlist Item')+button('import-audio','Import Backing Tracks…')+button('from-session','Add Session')+
      button('save','Save')+button('enable-midi','MIDI In')+button('performance','Performance View',{accent:true})+'</div></header><div class="ws-master-grid">'+
      section('Setlist',sequence(doc.items,item?.id,'show'))+
      '<div class="ws-production-center">'+section('Players',showOverview(doc,item,selectedPlayer,monitors),
        '<div class="ws-actions">'+Object.entries(showPlayerTypes).map(([key,label])=>button('add-player','+ '+label,{key})).join('')+'</div>')+
      transport({...playback,length:item?.length||0},'Play',button('previous-item','Previous')+button('next-item','Next'))+
      (item?section('Video Track',item.video?'<video data-ws-show-video playsinline muted preload="metadata"></video>':
        '<p class="ws-empty">Import a video for this Setlist Item.</p>','<div class="ws-actions">'+button('import-show-video','Import Video…')+
        (item.video?button('remove-show-video','Remove Video'):'')+'</div>'):'')+
      section('Sections','<div class="ws-sections">'+showSections(item,true,playback.position)+'</div>',sectionTools)+'</div>'+
      '<div class="ws-production-aside">'+section('Show Information','<div class="ws-form">'+field('name','Show name',doc.name)+
      field('artist','Artist',doc.artist)+field('venue','Venue',doc.venue)+'</div>')+section('Setlist Inspector',setlistDetail)+
      section('Player Inspector',showPlayerEditor(player,item))+'</div></div></div>';
  }
  return {workspaceViews:{start:viewStart,mastering:viewMastering,show:viewShow,recentRows,time}};
})());
