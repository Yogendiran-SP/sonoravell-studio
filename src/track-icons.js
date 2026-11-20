(function (SW) {
  const icons = {
    waveform:['Audio waveform','M2 12h3l2-5 3 10 3-14 3 18 3-9h3'],
    keys:['Keys','M3 5h18v14H3z M8 5v14 M12 5v14 M16 5v14 M6 5v7 M10 5v7 M14 5v7 M18 5v7'],
    drums:['Drums','M4 10h16v7c0 4-16 4-16 0z M4 10c0-4 16-4 16 0s-16 4-16 0z M7 14v4 M17 14v4 M4 3l6 3 M20 3l-6 3'],
    bus:['Bus','M3 5h4v4H3z M3 15h4v4H3z M17 10h4v4h-4z M7 7h5v10H7 M12 12h5'],
    guitar:['Guitar','M10 12c-6-2-10 4-6 8s10 0 8-6l8-8 1-3-3 1z M7 17h.1 M15 9l2 2'],
    vocals:['Vocals','M9 5a3 3 0 0 1 6 0v7a3 3 0 1 1-6 0z M6 10v2a6 6 0 0 0 12 0v-2 M12 18v4 M8 22h8'],
    bass:['Bass guitar','M10 12c-6-2-10 4-6 8s10 0 8-6l8-8 1-3-3 1z M7 15l2 2 M12 12l7-7 M19 3l2 2 M17 5l2 2'],
    pad:['Electric pad','M3 4h18v16H3z M6 7h5v4H6z M13 7h5v4h-5z M6 13h5v4H6z M13 13h5v4h-5z'],
    grand:['Grand piano','M3 13V8c0-3 4-5 8-5 6 0 7 5 10 7v3z M3 13h18v5H3z M5 18v3 M19 18v3 M7 14v4 M10 14v4 M13 14v4 M16 14v4'],
    organ:['Organ','M3 9h18v11H3z M6 9V3h3v6 M11 9V5h3v4 M16 9V2h3v7 M7 14h10 M7 17h10'],
    strings:['Strings','M10 11c-4-3-6 0-4 3-5 3 0 9 4 7l3-3c2-3 0-6-2-5l8-8 1-3-3 1z M6 17l3 2 M16 4l3 3'],
    synth:['Synth lead','M3 6h18v12H3z M5 13h3V9h4v5h4v-3h3'],
    sampler:['Sampler','M4 4h16v16H4z M7 12h2l2-4 2 8 2-4h2 M7 7h.1 M17 17h.1'],
    speaker:['Output','M3 9h4l5-4v14l-5-4H3z M15 8q6 4 0 8 M18 5q9 7 0 14']
  };
  const defaults={Keys:'keys',Bass:'bass',Pad:'pad',Lead:'synth',Pluck:'guitar',Organ:'organ',Strings:'strings',Drums:'drums',Sampler:'sampler'};
  function trackIcon(t){
    return Object.hasOwn(icons,t.icon)?t.icon:
      t.type==='midi'?defaults[t.instrument]||'keys':t.type==='bus'?'bus':t.type==='master'?'speaker':'waveform';
  }
  function trackIconMarkup(key){
    if(!Object.hasOwn(icons,key))key='waveform';
    return '<svg class="track-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="'+icons[key][1]+'" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  SW.trackIcons=icons;
  SW.trackIcon=trackIcon;
  SW.trackIconMarkup=trackIconMarkup;
})(SW);
