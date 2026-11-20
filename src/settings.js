(function (SW) {
  const toggle = (id, label, value, description) => ({id, label, value, description, type: 'checkbox'});
  const select = (id, label, value, choices, description) => ({id, label, value, choices, description, type: 'select'});
  const number = (id, label, value, min, max, step = 1, description) => ({id, label, value, min, max, step, description, type: 'number'});
  const device = (id, label, value, description) => ({id, label, value, description, type: 'device'});
  const values = entries => entries.map(entry => Array.isArray(entry) ? entry : [String(entry), String(entry)]);
  const rates = values([['0', 'System default'], 44100, 48000, 88200, 96000, 176400, 192000]);
  const categories = [
    ['general', 'General', [
      ['startup', 'General', [
        select('startup', 'At startup', 'restore', values([['restore', 'Reopen last session'], ['blank', 'New blank session'], ['demo', 'After Hours demo']])),
        toggle('autosave', 'Autosave sessions', true, 'Store a local recovery copy in this browser.'),
        number('autosaveDelay', 'Save after idle (seconds)', .5, .5, 60, .5),
        number('newTempo', 'New session tempo (BPM)', 112, 30, 320, .1),
        number('newMeter', 'New session meter (beats per bar)', 4, 2, 12),
        select('initialPanel', 'Startup panel', 'mixer', values([['mixer','Mixer'], ['edit','Edit'], ['browser','Browser'], ['automation','Automation'], ['routing','Signal flow']]))
      ]],
      ['appearance', 'Appearance', [
        select('accent', 'Accent color', 'mint', values([['mint','Mint'], ['blue','Blue'], ['amber','Amber'], ['orchid','Orchid']])),
        select('density', 'Track height', 'normal', values([['compact','Compact'], ['normal','Standard'], ['tall','Tall']])),
        toggle('contrast', 'High contrast', false),
        toggle('eventNames', 'Show event names', true),
        toggle('trackNumbers', 'Show track numbers', false)
      ]],
      ['keys', 'Keyboard Shortcuts', [], [['find','Edit keyboard shortcuts'],['import-keys','Import .keyscheme, XML or JSON'],['export-keys','Export shortcut map']]],
      ['network', 'Network', [toggle('localServices', 'Enable launcher connection', true, 'The Python launcher accepts connections from this computer at 127.0.0.1.')]],
      ['touch', 'Touch Input', [toggle('touchTargets', 'Larger touch targets', false, 'Enlarge transport, menu and panel controls, and event resize handles.')]]
    ]],
    ['locations', 'Locations', [
      ['user-data','User Data', [], [['save','Save current session'],['export-profile','Export preferences'],['import-profile','Import preferences']]],
      ['sound-sets','Sound Sets',[],[['choose-sample-folder','Choose audio and MIDI folder…'],['browse-samples','Browse linked media'],['clear-sample-folder','Clear linked folder']], 'Browse WAV, other audio files, and MIDI from a folder during this visit. Fender Sound Set packages require their original reader.'],
      ['instruments','Instrument Library',[],[['browse-instruments','Browse built-in instruments'],['choose-sample-folder','Choose a sample folder…'],['browse-samples','Browse samples']], 'The Sampler loads audio files. It can load a sample from the linked folder into the selected instrument track.'],
      ['plugins','VST Plug-ins', [], [['browse-local-plugins','Open local plug-ins'],['plugin-folder','Choose inventory folder'],['scan-plugins','Scan installed plug-ins']], 'Folder selection inventories supported plug-ins. Installed processing is available through the optional offline host.'],
      ['files','File Types', [
        select('importTypes','Media picker filter','all',values([['all','Audio and MIDI'],['audio','Audio'],['midi','MIDI']])),
        select('exportRate','Default export sample rate','48000',rates.slice(1)),
        select('exportDepth','Default Wave/AIFF bit depth','24',values([[16,'16-bit PCM'],[24,'24-bit PCM'],[32,'32-bit float']]))
      ], [['import-media','Import file'],['export','Export mixdown']]]
    ]],
    ['audio', 'Audio Setup', [
      ['device','Audio Device', [
        device('outputDevice','Playback output','', 'Custom outputs require browser support and permission.'),
        device('inputDevice','Default recording input','', 'An input chosen on the track takes priority.'),
        select('sampleRate','Requested engine sample rate','0',rates),
        select('latency','Browser latency hint','interactive',values([['interactive','Interactive'],['balanced','Balanced'],['playback','Playback']]))
      ], [['refresh-audio','Refresh audio devices'],['allow-input','Allow microphone and refresh'],['choose-output','Choose output…'],['session-io','Session Audio I/O']]],
      ['processing','Processing', [
        number('lookahead','Loop scheduling lookahead (ms)',220,100,1000,10),
        number('tail','Playback effect tail (seconds)',1.5,0,15,.1),
        number('exportTail','Default render tail (seconds)',2,0,30,.5)
      ],[], 'The browser and operating system manage device buffers and driver selection.']
    ]],
    ['external', 'External Devices', [
      ['midi-devices','MIDI Devices', [
        device('midiInput','Accept from MIDI input',''),
        select('midiChannel','Accept MIDI channel','0',values([['0','Omni'],...Array.from({length:16},(_,i)=>i+1)]))
      ], [['enable-midi','Enable / refresh MIDI devices']]],
      ['computer-keys','Computer Keyboard', [
        toggle('keyboardOn','Open QWERTY MIDI at startup',false),
        number('octave','Default octave',4,0,8),
        number('velocity','Default MIDI velocity',100,1,127)
      ],[['keyboard','Toggle QWERTY keyboard']]]
    ]],
    ['advanced','Advanced', [
      ['editing','Editing', [
        toggle('locateEmpty','Locate when clicking empty timeline space',false),
        toggle('crosshair','Crosshair in empty lanes',false),
        toggle('barGrid','Display beat and bar grid',true),
        toggle('autoColors','Automatically color new tracks',true),
        select('defaultSnap','Startup snap grid','.5',values([['0','Off'],['.25','1/16'],['.5','1/8'],['1','1/4'],['2','1/2'],['bar','Bar']])),
        number('defaultZoom','Startup zoom (pixels per beat)',53,15,150)
      ]],
      ['automation','Automation', [
        select('defaultAutomation','New track automation mode','Read',values(['Off','Read','Touch','Latch','Write'])),
        toggle('autoLanes','Create volume and pan envelopes on new tracks',false),
        number('autoWriteInterval','Write sample interval (ms)',64,24,500,1,'Applies while writing automation during playback.')
      ],[['automation','Open automation editor']]],
      ['recording','Audio', [
        select('recordChannels','Microphone channel request','0',values([['0','Device default'],['1','Mono'],['2','Stereo']])),
        select('recordBitrate','Fallback encoder target (kbps)','256',values([96,128,192,256,320])),
        number('recordOffset','Recording placement offset (ms)',0,-500,500),
        toggle('echoCancellation','Echo cancellation',false),
        toggle('noiseSuppression','Noise suppression',false),
        toggle('inputAutoGain','Automatic microphone gain',false)
      ]],
      ['midi','MIDI', [
        toggle('chaseNotes','Chase long notes when starting playback',true),
        toggle('quantizeRecord','Quantize recorded MIDI note starts',false, 'Uses the active arrangement snap interval.')
      ]],
      ['console','Console', [
        toggle('defaultWide','Wide mixer channels at startup',false),
        toggle('defaultDevices','Show console device shelf at startup',false),
        toggle('consoleColors','Color channel headers',true),
        toggle('holdPeaks','Hold maximum meter peaks',true)
      ],[['mixer','Open Mixer']]],
      ['sync','Synchronization', [
        device('midiOutput','MIDI clock output','','Select a connected MIDI output after enabling MIDI devices.'),
        toggle('midiClock','Send MIDI clock and start/stop',false)
      ],[['enable-midi','Enable / refresh MIDI devices']], 'MIDI clock follows Sonoravell’s tempo. Incoming clock, MTC, MMC and Link require further engine support.'],
      ['services','Services', [
        toggle('extendedEncoders','Use local FFmpeg encoders',true),
        toggle('nativePlugins','Use native offline plug-in processing',true),
        toggle('scanSystem','Enable installed plug-in scans',true)
      ],[['check-services','Check launcher services']]],
      ['video','Video', [
        toggle('videoFollow','Follow the session transport',true),
        toggle('videoMute','Mute reference audio',true),
        number('videoOffset','Reference start (seconds)',0,-3600,3600,.01),
        select('videoFPS','Frame step rate','30',values(['23.976','24','25','29.97','30','50','59.94','60']))
      ],[['import-video','Open video reference…'],['video-panel','Show video reference']], 'The reference video is kept for this open workspace and is outside the audio export.']
    ]]
  ];
  const fields = new Map(categories.flatMap(([, , pages]) => pages.flatMap(([, , items]) => items.map(field => [field.id, field]))));
  const defaults = Object.freeze(Object.fromEntries([...fields.values()].map(({id, value}) => [id, value])));
  function settingValue(id, raw) {
    const field = fields.get(id);
    if (!field) return undefined;
    if (field.type === 'checkbox') return typeof raw === 'boolean' ? raw : field.value;
    if (field.type === 'number') return typeof raw === 'number' && Number.isFinite(raw)
      ? Math.max(field.min, Math.min(field.max, Number((Math.round(raw / field.step) * field.step).toFixed(6))))
      : field.value;
    if (field.type === 'device') return typeof raw === 'string' && raw.length <= 1024 && !/[\u0000-\u001f]/.test(raw) ? raw : field.value;
    return field.choices.some(([value]) => value === raw) ? raw : field.value;
  }
  function preferences(raw) {
    const valid = raw && typeof raw === 'object' && !Array.isArray(raw);
    return Object.fromEntries([...fields.keys()].map(id => [id, valid && Object.hasOwn(raw, id) ? settingValue(id, raw[id]) : defaults[id]]));
  }
  function readPreferenceProfile(raw) {
    if (!['sonoravell-preferences','soundweave-preferences'].includes(raw?.format) || raw.version !== 1 || !raw.settings || typeof raw.settings !== 'object' || Array.isArray(raw.settings))
      throw Error('Select a supported Sonoravell preferences file.');
    return preferences(raw.settings);
  }
  function recordingConstraints(prefs, trackInput, channelCount=Number(prefs.recordChannels)) {
    const id = trackInput || prefs.inputDevice;
    return {
      ...(id ? {deviceId:{exact:id}} : {}),
      ...(channelCount ? {channelCount:{ideal:channelCount}} : {}),
      echoCancellation:prefs.echoCancellation, noiseSuppression:prefs.noiseSuppression, autoGainControl:prefs.inputAutoGain
    };
  }
  Object.assign(SW, {preferenceCategories:categories, preferenceDefaults:defaults, settingValue, preferences, readPreferenceProfile, recordingConstraints});
})(SW);
