'use strict';
Object.assign(SW, (() => {
  const commandAliases={
    edit:'edit',editor:'edit',showeditor:'edit',toggleeditor:'edit',console:'mixer',mix:'mixer',
    showconsole:'mixer',toggleconsole:'mixer',browser:'browser',showbrowser:'browser',togglebrowser:'browser',
    inspector:'inspector',showinspector:'inspector',toggleinspector:'inspector',
    showautomation:'automation',automation:'automation',findcommand:'find',
    start:'home',returntozero:'home',gotostart:'home',locatesessionstart:'home',
    end:'end',gotoend:'end',zoomtofit:'zoom-fit',fittimelinetocontents:'zoom-fit',zoomin:'zoom-in',zoomout:'zoom-out',zoomverticalin:'zoom-vertical-in',zoomverticalout:'zoom-vertical-out',
    startstop:'transport',playstop:'transport',toggleplay:'transport',play:'transport',record:'record',
    toggleloop:'loop',loopactive:'loop',loop:'loop',togglemetronome:'click',metronome:'click',
    undo:'undo',redo:'redo',save:'save',open:'open',opensong:'open',opensession:'open',importfile:'import-media',
    copy:'copy',cut:'cut',paste:'paste',pasteatoriginalposition:'paste-original',selectall:'all',
    selectallintrack:'select-track',selectmutedevents:'select-muted',invertselection:'invert-selection',
    deselectall:'clear-selection',delete:'delete',split:'split',splitatcursor:'split',splitatplayhead:'split',
    duplicate:'duplicate',duplicateshared:'duplicate',repeat:'repeat',quantize:'quantize',
    mergeevents:'merge',bounce:'merge',bounceselection:'merge',muteevents:'mute-event',lockevents:'lock-event',
    splitrange:'split-range',deletetime:'delete-time',croptorange:'trim-range',loopselection:'range-loop',
    reverse:'reverse',normalize:'normalize',normalizeselection:'normalize',crossfade:'crossfade',
    exportmixdown:'export',exportstems:'export-stems',exportselection:'export-selection',
    arrowtool:'tool-arrow',rangetool:'tool-range',splittool:'tool-split',erasertool:'tool-erase',
    painttool:'tool-draw',mutetool:'tool-mute',bendtool:'tool-bend',listentool:'tool-listen',
    qwertykeyboard:'keyboard',qwerty:'keyboard',legato:'note-legato',humanize:'note-humanize',
    addtracks:'insert-track',inserttrack:'insert-track',snap:'snap-toggle',togglesnap:'snap-toggle',snapactive:'snap-toggle',
    removetrack:'track-remove',removetracks:'track-remove',removetrackandinstrument:'track-remove-complete',
    addinstrumenttrack:'add-instrument',addaudiotrackmono:'add-audio',addaudiotrackstereo:'add-audio',
    addbuschannel:'add-bus',newsession:'new',newsong:'new'
  };
  const modifiers={ctrl:'Ctrl',control:'Ctrl',cmd:'Ctrl',command:'Ctrl',meta:'Ctrl',alt:'Alt',option:'Alt',shift:'Shift'};
  const normal=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
  const keys={arrowleft:'ArrowLeft',arrowright:'ArrowRight',arrowup:'ArrowUp',arrowdown:'ArrowDown',leftarrow:'ArrowLeft',rightwardarrow:'ArrowRight',rightarrow:'ArrowRight',uparrow:'ArrowUp',downarrow:'ArrowDown',
    left:'ArrowLeft',right:'ArrowRight',up:'ArrowUp',down:'ArrowDown',escape:'Escape',esc:'Escape',insert:'Insert',ins:'Insert',
    backspace:'Delete',delete:'Delete',del:'Delete',enter:'Enter',return:'Enter',space:'Space',tab:'Tab',home:'Home',end:'End',
    pageup:'PageUp',pagedown:'PageDown',capslock:'CapsLock',numpadadd:'NumpadAdd',numpadsubtract:'NumpadSubtract',numpadmultiply:'NumpadMultiply',numpaddivide:'NumpadDivide',numpaddecimal:'NumpadDecimal'};
  function convertKey(value){
    if(!value) return '';
    let remainder=value.trim(), matched;
    const found=new Set();
    while((matched=/^(ctrl|control|cmd|command|meta|alt|option|shift)\s*\+/i.exec(remainder))){
      found.add(modifiers[matched[1].toLowerCase()]);remainder=remainder.slice(matched[0].length).trim();
    }
    const lower=remainder.toLowerCase();
    let key=lower==='numpad+'?'NumpadAdd':lower==='numpad-'?'NumpadSubtract':({
      'numpad*':'NumpadMultiply','numpad/':'NumpadDivide','numpad.':'NumpadDecimal'
    })[lower]||keys[normal(lower)];
    if(!key&&/^numpad\s*[0-9]$/.test(lower)) key='Numpad'+lower.at(-1);
    if(!key&&/^(f[1-9]|f1[0-9]|f2[0-4])$/.test(lower)) key=lower.toUpperCase();
    if(!key&&/^[\x21-\x7e]$/.test(remainder))key=remainder.toUpperCase();
    return key?[...['Ctrl','Alt','Shift'].filter(m=>found.has(m)),key].join('+'):null;
  }
  function remapStudioCommands(rows,catalog,current){
    const bindings={...current}, mapped=[],skipped=[],alternates=[],conflicts=[];
    const importedOwners=new Map();
    const nameToCommand=new Map(Object.entries(catalog).map(([id,[name]])=>[normal(name),id]));
    for(const row of rows){
      const key=normal(row.name), family=normal(row.category);
      const contextual=key==='mute'&&['event','audio'].includes(family)?'mute-event':
        key==='importfile'?'import-media':key==='new'&&family==='file'?'new':null;
      const id=contextual||commandAliases[key]||nameToCommand.get(key);
      if(!id||!Object.hasOwn(catalog,id)){skipped.push(row);continue;}
      const choices=row.keys.map(convertKey).filter(Boolean);
      if(row.keys.length&&!choices.length){skipped.push(row);continue;}
      const shortcut=choices[0]??'';
      const previous=importedOwners.get(shortcut);
      if(shortcut&&previous&&previous!==id){conflicts.push({name:row.name,key:shortcut});continue;}
      if(shortcut) importedOwners.set(shortcut,id);
      const others=[];
      for(const chord of new Set(choices.slice(1))){
        if(chord===shortcut)continue;
        if(importedOwners.has(chord)&&importedOwners.get(chord)!==id){conflicts.push({name:row.name,key:chord});continue;}
        importedOwners.set(chord,id);others.push(chord);
      }
      if(others.length)alternates.push({id,name:row.name,keys:others});
      bindings[id]=shortcut;
      mapped.push({id,name:row.name,key:shortcut});
    }
    const newIds=new Set(mapped.map(r=>r.id));
    for(const [id,[,original]] of Object.entries(catalog)){
      if(newIds.has(id)) continue;
      const assigned=Object.hasOwn(bindings,id)?bindings[id]:original;
      if(assigned&&importedOwners.has(assigned)) bindings[id]='';
    }
    return {bindings,mapped,skipped,conflicts,alternates};
  }
  function parseStudioKeys(text){
    if(/<!\s*(DOCTYPE|ENTITY)\b/i.test(text))throw Error('The keyboard scheme contains an unsupported XML declaration.');
    const doc=new DOMParser().parseFromString(text,'application/xml');
    if(doc.querySelector('parsererror')||doc.documentElement.localName!=='Commands')throw Error('Expected a Studio One or Fender Studio Pro .keyscheme XML file.');
    const rows=[];
    for(const command of doc.documentElement.children){
      const name=command.getAttribute('name');
      if(command.localName!=='Command'||!name) continue;
      const keys=[...command.children].filter(el=>el.localName==='Key').map(el=>el.getAttribute('name')).filter(Boolean);
      rows.push({name,category:command.getAttribute('category')||'',keys});
    }
    if(!rows.length)throw Error('This .keyscheme has no keyboard commands.');
    return rows;
  }
  async function readKeyFile(file){
    if(file.size>2*1024*1024)throw Error('Import a keyboard map smaller than 2 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const utf=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
    const text=new TextDecoder(utf).decode(bytes);
    return text.trimStart().startsWith('<')?{rows:parseStudioKeys(text)}:{json:JSON.parse(text)};
  }
  return {convertKey,remapStudioCommands,parseStudioKeys,readKeyFile};
})());
