# Sonoravell Studio 1.0.2

Sonoravell Studio is a browser-based digital audio workstation in active development. Version 1.0 introduces a dedicated MIDI editor with note properties, scale tools, and a velocity lane, plus editor-aware clipboard shortcuts. Earlier Soundweave sessions remain importable. The included *After Hours* session contains instruments, an FX return, and two independent cue feeds.

The project is distributed under the [MIT License](LICENSE).

## Launch

Extract the ZIP, then open `Start-Sonoravell.cmd` in Windows. With Python 3 installed, the launcher starts `http://127.0.0.1:8765/` and opens a dedicated Edge or Chrome app window when available on Windows. The title follows the current Session name. Other launches use the default browser. Keep the console open. Use Chrome or Edge for browser audio and MIDI features. On other platforms, run `python3 launch.py`.

Opening `Sonoravell.html` directly runs the browser tools. The system plug-in scan, optional native plug-in rendering, and FFmpeg codecs use the localhost launcher. Internet access is unnecessary for an installed setup.

## Workspace map

Fender Studio Pro calls its top-level pages **Start**, **Session**, **Mastering**, and **Show**. In earlier Studio One versions, **Song** referred to the production editor and **Project** referred to the mastering workspace. Sonoravell uses the current domain names and its own interface and assets.

| Workspace | Sonoravell 1.0.2 workflow |
| --- | --- |
| **Start** | Choose **New Document**, select a Session, Mastering, or Show template, and set name and artist. Find, filter, or pin recent documents, open a portable file, edit the local Artist Profile, check import and export activity under Transfers, and access Audio Setup or External Devices. Use **Quick Switch** to return to another open document. |
| **Session** | Record audio or MIDI, arrange on the timeline, and use the Inspector, Browser, Audio Editor, Note Editor, Console, Automation, Signal Flow, and reference video. Open the Launcher, Scratch Pads, Pattern Editor, Score Editor, Lyrics Display, Channel Overview, and Performance Monitor from **View**. Use **Session → Add to Mastering Project** or **Add to Show** to render a stereo copy of the current mix into another workspace. |
| **Mastering** | Import tracks or add the current Session. Reorder the Track Column and audition the Track Lane. Adjust metadata, trims, fades, gap, track gain, output gain, and preset insert chains. Analyze sample peak and RMS. **Digital Release** renders individual masters and a metadata file into a ZIP. |
| **Show** | Build a Setlist with backing tracks, item tempo and meter, pauses, and playback modes. Configure Players, per-item Patches, live input monitoring, video, and Sections. Open **Performance View** for larger controls, Patches, Sections, Lyrics, and Video. Select a virtual Player to play it with the QWERTY keys, or enable **MIDI In**. |
| **File utilities** | Open or save portable documents, export Session mixdowns and stems, or run **Audio Batch Converter** on multiple source files. The standalone build supports Wave output. Installed launcher codecs add their supported formats. |

### Session companion views

- **Launcher** captures a selected arrangement event into a Cell on the same track. Launch a Cell or a whole Scene for audition, queue Scenes in a Playlist, or insert the ordered Events at the Session playhead.
- **Scratch Pads** copy selected events into a separate list of editable beat offsets. Preview the variation or insert it back into the Session.
- **Pattern Editor** uses a 16th-note grid for drum or pitched steps. Read the selected MIDI part into the grid, audition the pattern, and insert a MIDI part.
- **Score Editor** displays the selected Instrument Part on a single staff. Select a note to edit pitch, position, duration, or velocity. Add or remove notes directly.
- **Lyrics Display** follows the Session playhead. **Channel Overview** exposes routing, level, polarity, Inserts, and Sends for the selected channel. **Performance Monitor** reports engine configuration and source audio size, and offers insert bypass controls.

### Portable files and scope

**Save Document** embeds the media used by a Session (`.sonoravell`), Mastering Project (`.sonoravell-master`), or Show (`.sonoravell-show`). Start remembers local document copies in the current browser. The localhost launcher gives that storage a consistent origin. Switching between pages leaves the current Session in memory. A Session sent to Mastering or Show is a rendered copy. Exporting again is necessary to include later Session edits.

Sonoravell's Launcher uses a separate editor and preview transport. Scratch Pads use a list of copied events. The Score Editor supports basic single-staff editing. Mastering analysis covers sample peak and RMS. Live Show playback uses browser audio and device permissions. The reference product also documents concurrent Launcher and Timeline playback, fuller notation engraving, integrated loudness and CD/DDP tools, remote control surfaces, and vendor cloud sharing, publishing, content, and account services. These workflows are outside the current implementation.

Reference pages

- [Fender Studio Pro User Guide, Pages and Smart Templates](https://downloads.ctfassets.net/mdpgzc1lmx9t/4a95Tj0SfvdaC3VC5IvVMG/7c6732e98c4f8b6b097f7907982d88a6/UM_Fender-Studio-Pro_EN.pdf)
- [Fender Studio Pro, Launcher](https://fenderstudiopromanual.fender.com/en/Content/Arranging_Topics/The%20Launcher.htm)
- [Fender Studio Pro, Score Editor](https://fenderstudiopromanual.fender.com/en/Content/Score_Editor_Topics/Chapter-Score_Editor.htm)
- [Fender Studio Pro, Mastering](https://fenderstudiopromanual.fender.com/en/Content/Mastering_Topics/Chapter-Mastering.htm)
- [Fender Studio, Mastering and Release tutorial](https://www.youtube.com/watch?v=njCaNxj2L9M)
- [Fender Studio Pro, Performance View](https://fenderstudiopromanual.fender.com/en/Content/Show_Topics/Show_Perform.htm)

## First tests

### Workspace and Mixer

- Open the Inspector from the left edge and the Browser from the right edge. The Browser header arrow closes it. **F4** and **F5** toggle them independently of the bottom editor.
- Drag just above the lower tabs to resize the panel, or focus the separator and press Up or Down. Resize the Browser at its left edge. The Mixer uses fixed-width strips and a horizontal scrollbar. Faders use the height available between the controls and channel names. Expand Inserts or Sends to scroll inside that rack.
- **F2** is Edit, **F3** is Mixer, **A** is track Automation, and **F6** is Signal Flow. Press the shortcut or click the active tab again to hide that panel. Reopening it restores its previous dock height and fullscreen state for the current launch. Use **Window** to access detachable panels.
- **Detach** moves the lower editor or Browser to another browser window. The window uses the same session, including the same transport, undo history, and selections. Closing the detached window or clicking **Dock panel** reattaches it. Enable pop-ups if the browser blocks this action. Use **Fullscreen** to enlarge just that panel. Use the same button or Esc to return.
- Mixer strips show input and output routing above the Inserts and Sends racks. The input opens audio device selection for an audio track, selects a MIDI source for an instrument, or opens Signal Flow for a bus. The master output selector chooses the monitor source.
- Click a track glyph in the Arrangement, Inspector, or Mixer to pick an icon. **Automatic** follows the current instrument. Unassigned audio tracks use a gray waveform. Your selection is stored in the session.
- Double-click a channel name near the fader and press Enter to commit. Click its color swatch to choose another color. The **Ø** button reverses input polarity.
- Gain and pan use compact rotary dials. Drag vertically, hold Shift for fine adjustments, use arrow keys, or enter the value directly. Double-click resets the dial.
- The Inserts and Sends header chevrons expand their lists. Each insert or send occupies one row, and the aligned strip layout reserves the same space across channels. Open an Insert by clicking its name. The Inserts header **⌄** recalls or stores FX chains and **+** adds an insert. Loading a chain from the strip replaces its inserts and remains undoable. The Sends header **+** lists available bus and cue targets. Expand a send row for destination and cue pan controls.
- Fullscreen expands the Console faders and rack space, the Edit and Automation timelines adapt to the available viewport, and the Browser adds card columns. Signal Flow covers the viewport and its **Fit** command considers both canvas dimensions.

### Insert Track

- Click **+** in the Arrangement or choose **Track → Insert Track**. **T** opens the form when the QWERTY instrument keyboard is inactive. If popups are blocked, the same form opens inside Sonoravell.
- Choose **Audio**, **Instrument**, or **Folder**, enter a name and count, then select a color or use Auto-color. Batch insertion is one Undo step. Audio tracks offer mono or stereo capture, a browser recording device, FX chain, and output. Instrument tracks offer a MIDI source, instrument or retained instrument, FX chain, and output. Folders can group the selected tracks.
- **Shift+T** removes selected tracks and events while keeping enabled instruments and their inserts loaded in the Mixer. The **Instrument** field can reattach a loaded instrument to a new track. **Shift+Alt+T** removes the selected tracks and their instruments. Both track removal actions are undoable.

### Global tracks and loop ruler

- Use the **Global tracks +** button to show or hide Markers, Arranger, Chords, Lyrics, Tempo guides, and Signature guides. Use **File → Import media** to import a file.
- In a global lane, **Add** inserts at the playhead and double-clicking an empty area inserts at the clicked position. Double-click an entry to edit it, drag its center to move it, and drag either edge of a span to resize it. Right-click for actions such as locating, looping a span, or selecting the events in an Arranger section. Global entries are saved with the session and follow ripple deletion.
- The Chords lane displays harmonic annotations. Arranger sections are labeled ranges. Tempo and Signature guides mark points on the timeline. Use **Apply to session** on a tempo or quarter-note signature guide to change the session-wide value.
- Drag above the ruler to draw and enable a loop. Drag its left and right handles to resize it or the band to move it. Hold **Shift** while dragging to bypass snapping. Double-click the band to toggle playback looping. The lower part of the ruler seeks normally.
- **Alt+=** and **Alt+-** increase and decrease track height. The thin slider on each audio or instrument track header changes its volume while preserving selection. Double-click the slider to reset it to 0 dB.

### Bottom transport

- Locate from the position display using the marker and bar navigation buttons. Play, Stop, Record, loop, tempo, meter, and metronome stay in the bottom bar alongside the QWERTY keyboard, hardware MIDI, and Audio Setup controls.
- The left and right loop fields accept **bar.beat.tick** with 960 ticks per beat. For example, in 4/4, `002.2.480` is halfway through beat 2 of bar 2. An integer is a bar number. Press Enter or leave the field to apply it. **Set** uses the selected range.

### Recording

1. Launch Sonoravell from localhost using the Windows shortcut or `python3 launch.py`. Add an **Audio** track. Right-click its header and use **Choose recording input** for a particular microphone or interface, or leave it on the Audio Setup default.
2. Place the playhead, then select the audio track or arm it with **●**. **R** or the transport Record button starts a take. With multiple armed tracks, select the one to record. **Alt-click** a track's arm button to arm it exclusively.
3. Permit microphone access when the browser asks. The track's right-edge meter shows input during recording. The speaker button enables audio input monitoring before, during, and after a take with the same channel routing. Use headphones for monitoring. The Instrument track speaker button controls live MIDI audition and MIDI can still be recorded with audition off.
4. Click **Stop** or press **R** again. The take appears as a 24-bit WAV event on the recording track. Stop also cancels a pending input request. If an **Instrument** track is selected for recording, play QWERTY or enable hardware MIDI and play it instead. MIDI takes retain supported controller events.

The app records one selected or armed track per take. The primary capture path uses mono or stereo PCM and aligns capture with the Web Audio transport. Browsers that cannot load the capture processor may use their available recording codec before converting to WAV. Recording permissions and physical inputs are managed by the operating system and browser.

### Edit commands and macros

- Click an instrument or audio track header while Edit is open. Edit shows that track's piano roll or waveform. Choose another part or event from the editor's selector.
- Hold **Ctrl** with the Arrow tool to see the Range crosshair. Drag across a lane or event to select time. **Ctrl+click** toggles selection. **Ctrl+Z** undoes project changes. **N** toggles snapping in Edit and the Arrangement, and restores the last snap grid when turned back on. Draw, Erase, Split, Mute, Listen, and Stretch use specialized pointers in the Arrangement.
- Drag the fade handles at the two ends of an audio event in the Arrangement or the Audio Editor. The Audio Editor has exact milliseconds, five fade shapes, and event gain in dB. Focus a handle and use the arrow keys for 5 ms changes, or hold Shift for 50 ms.
- **Delete** follows the focused marker, global event, timeline clip or range, piano-roll note, automation or MIDI controller point, insert, send, Pool audio source, or Signal Flow wire. It stays available after importing shortcut maps. Number and text fields keep their normal editing behavior.
- Right-click a track header for track commands. **Shift+T** removes a track and **Shift+Alt+T** removes its instrument with it. Use the separate track commands when a track is selected.
- **Controls** in Edit reveals the range, selection, and detailed editorial controls. **Action** opens the appropriate commands for the Audio or Note Editor.
- Right-click an arrangement event to see its Audio Event or Instrument Part commands. Right-click a note for note clipboard, velocity, transpose, and timing commands. **Shift+F10** opens the same context menu for a focused event.
- Use **Macros** in Arrangement or Edit to choose a ready-made sequence. **Studio → Macro Organizer** creates, edits, duplicates, orders, and removes macros. Arrangement, Note Editor, and Audio Editor each have a command list. Some commands accept values such as semitones, velocity, gain, or fade time. A macro with project changes produces a single Undo entry.
- User macros are stored in the browser. The Organizer can import and export a Sonoravell macro library as JSON.
- The built-in instrument illustrations appear in the Browser, Mixer, Inspector, and instrument editor. Local VST/AU devices have default artwork and an **Artwork** button to save your own image for each device.

### Piano roll

- The piano roll has its own Arrow, Draw, Split, Erase, Mute, and Listen tools. Drag the Arrow on empty space to select notes, Shift-drag to extend the selection, or Ctrl-click individual notes. Double-click empty space or use Draw to insert notes. Drag either edge to trim or extend and Alt-drag to copy the selected group.
- The Properties strip edits MIDI pitch, the one-based beat inside the part, duration in beats, velocity from 1 to 127, and mute. Pitch and start changes preserve intervals and spacing across the selection. The Velocity lane follows the piano ruler. Drag a bar or focus it and use Up/Down. Shift increases the keyboard step to eight.
- Set the note grid separately or follow the arrangement grid. Choose a root and scale to highlight its pitches. Scale Snap constrains inserted and dragged notes. Apply Scale moves selected notes to the nearest allowed pitch.
- The Action menu offers quantize starts and ends, swing amount, split, legato, staccato, fixed grid length, overlap trim, transpose, melodic inversion, accent, humanize, and reverse.

| Shortcut in the piano roll | Action |
| --- | --- |
| Ctrl+X, Ctrl+C, Ctrl+V | Cut, copy, or paste notes |
| Ctrl+Shift+V, Ctrl+D | Paste at the original beat or duplicate after the selected phrase |
| Ctrl+A, Ctrl+I, Delete | Select all, invert selection, or delete |
| Left / Right | Nudge in time by one note-grid step |
| Up / Down, Shift+Up / Shift+Down | Transpose one semitone or one octave |
| Q, Alt+Q, S, Alt+K | Quantize starts, quantize ends, split at playhead, or apply scale |
| 1, 3, 4, 5, 6, 8 | Arrow, Split, Erase, Draw, Mute, or Listen |

The clipboard follows the focused arrangement, piano roll, global lane, automation lane, MIDI controller lane, or insert. Text fields use the operating system's normal clipboard. Paste moves music to the playhead, while Paste at Original Position preserves its placement. Sonoravell saves .sonoravell sessions and also opens .soundweave sessions.

### Edit MIDI Automation

1. Double-click a MIDI event and choose **MIDI Automation**. The **Piano roll** button switches back to notes.
2. The Lane menu offers velocity, pitch bend, modulation, expression, sustain pedal, brightness, reverb send, chorus send, and the parameters of the assigned built-in instrument. The selected-note readout shows its value at note-on and any controller points that occur before note-off.
3. Click the lane to enter a point on the grid. Alt-click places it off-grid. Enter a precise clip beat and value to update a point, or use **At selected note** to add a point at each selected note start. Velocity edits apply to the note selection. With no explicit selection, the full part is selected for velocity edits.
4. Velocity is per note. Pitch bend and the other MIDI controllers are shared across the MIDI part. Envelope and other note-on parameters apply when a voice starts. Continuous pitch, expression, filter, and instrument effect lanes act during playback.
5. The added built-in controls are reverb mix, delay mix, delay time and feedback, chorus mix, pitch bend range, and vibrato depth on melodic instruments. Each device continues to expose its applicable synthesis controls such as attack, release, resonance, or drum and sampler settings. The plug-in panels support both knobs and numeric values.
6. Compatible hardware controllers can be recorded to MIDI parts. Standard MIDI files preserve the supported controllers and note velocity. Sonoravell-specific instrument lanes are stored in the portable project. The offline VST3/AU renderer forwards the supported MIDI messages to the instrument, which determines how it responds. Its parameter knobs use the installed plug-in's exposed parameters. Native inserts remain an offline workflow.

### Menus and Preferences

The top bar has File, Edit, Session, Track, Event, Audio, Transport, View, Window, Studio, and Help. Open a menu with the mouse or Tab and Enter. Use the arrow keys to move through commands and Esc to dismiss a menu. Menu labels show the current shortcut bindings. **Studio → Preferences** or **Ctrl+,** opens the preferences window. **Session → Session Setup** edits the current project and its Audio I/O.

| Category | Pages and controls |
| --- | --- |
| General | Startup session and panel, local recovery, new session defaults, appearance, shortcut editing and .keyscheme import, local services connection, and larger touch targets |
| Locations | User data and profile actions, Sound Sets and Instrument Library pages for a linked audio/MIDI folder, VST inventory, import file filters, and default export rate and bit depth |
| Audio Setup | Playback and default recording device, requested sample rate and latency hint, processing lookahead, playback tail, and render tail |
| External Devices | Web MIDI enablement, device and channel filtering, and QWERTY octave and velocity |
| Advanced | Editing, Automation, Audio, MIDI, Console, Synchronization, Services, and Video |

Preferences apply immediately unless the setting specifies startup or the next audio start. Profiles are portable Sonoravell JSON files. Shortcut layouts use their own import and export controls. Device IDs in a profile may differ across machines. Choose the matching devices again on the target machine.

Under **Locations → Sound Sets**, link a folder of audio or MIDI files. Open the linked folder in the Browser to search filenames and import them at the playhead. The Sampler action uses the selected instrument track or creates one. The folder link lasts until Sonoravell is closed. The Sound Sets and Instrument Library pages work with supported media files. Fender Sound Set bundles and Presence preset libraries require their original readers.

In **Audio Setup**, audio hardware is managed by the browser and operating system. The requested sample rate and latency hint can be constrained by the device or browser, and custom output switching depends on browser support. The browser may request microphone access when selecting an input, starting monitoring, or recording. Session Audio I/O lets you select the main or cue monitor and stereo or binaural monitoring. Click **Open Signal Flow** for channel patching.

In **Advanced → Synchronization**, enable MIDI devices, select a MIDI output and turn on MIDI clock. Soundweave sends clock and transport start/stop while it plays. Incoming sync, MTC, MMC, Ableton Link, native buffer controls, dedicated hardware cue outputs, and live native plug-in hosting are outside this release.

Use **File → Import video reference** to load a compatible local video. **View → Video reference** shows the floating window. Video options include transport follow, audio mute, a start offset, and the rate used by the frame buttons. The workspace retains the reference until you switch sessions or eject it. Video stays outside the portable project and audio exports.

### Signal Flow

Press **F6** to see one node per channel, bus, master, or cue output. Click the node chevron to show its routing selectors, Inserts, and Sends. Gain, pan, level, mute, and polarity controls are on the channel card.

- Pan by dragging empty space or by middle-dragging. Scroll to pan, Shift-scroll to pan horizontally, and Ctrl-scroll or Cmd-scroll to zoom at the pointer. Coordinates extend in either direction. **Home** returns the camera to its origin. **Fit** frames the current nodes.
- Drag a card to move it, or Ctrl-click cards to make a group before moving. The project saves channel locations, including negative positions. **Reset positions** resets the current graph view's nodes.
- Drag between sockets to connect compatible channels. Use the existing wire to reroute or select it and press Delete. The master and cue outputs connect to the monitor node. The route inspector shows send gain and tap for the selected wire.
- Click a channel's **↳** button to edit individual stages, connections or inserts inside that channel. **← Channels** returns to the channel graph. Existing internal patches remain part of the project.

### Track and channel organization

- The arrangement displays audio tracks, instrument tracks, and folders. Buses, the master and FX returns appear in the Mixer and Signal Flow.
- **Ctrl+click** several track headers, then choose **+ Folder**. You can move tracks between folders by dragging their headers or by using the channel’s Folder field.
- Use **+ Bus** on a folder header to route its members through a mixer bus. Removing the folder grouping returns its members to their previous destinations where those routes remain valid.
- The inspector shows Input, Presets, Sends, Pre-fader, Fader, Post-fader, and Output for each channel. Audio recording inputs are selected per track. Bus and master inputs show their connected channels.
- Drag effects or presets from the Browser to a track header or lane. Use the Mixer’s **Devices** shelf to drop directly onto mixer channels. Instrument devices belong on instrument tracks. Dropping an instrument into open arrangement space creates a new instrument track.

### Spatial mixing

Open a track’s **Spatial** panner. Set it to surround bed source or object source, then drag the position marker. Adjust elevation, spread and the LFE send by knob or by typing a value. Spatial panning takes place on channels routed to the master. Position a bus to move its grouped output.

- **Binaural headphones** uses Web Audio HRTF. Select it in Signal flow to monitor or in Export to render it.
- **7.1.4 PCM surround** uses a discrete 12-channel offline renderer with a WAVEFORMATEXTENSIBLE channel mask. Stereo sources go to front left/right, and spatial sources are distributed by position and elevation. The LFE feed is low-passed. The master level is applied; stereo master inserts are bypassed for the multichannel render. Export it as a mixdown WAV.
- Spatial X/Y/Z, spread and LFE fields have automation lanes. Binaural monitoring uses position and spread. LFE feeds the 7.1.4 output.
- This release delivers multichannel PCM and binaural audio. A licensed Dolby Atmos Renderer, ADM BWF object metadata, and Atmos bitstream export are outside the current implementation.

### Plug-in and instrument editors

- **Mixer / Inspector → Inserts → Edit** opens an illustrated, interactive device face. **Open instrument** opens the instrument panel. All 29 stock effects and 9 instruments have controls on their faces. Drag a knob vertically, hold Shift for finer adjustment, double-click to reset it, or type a precise value and press Enter.
- **Spectrum EQ** has low/high cuts, low/high shelves, and three bell bands. Drag a handle horizontally for frequency and vertically for gain where applicable. Use the wheel over a handle to set Q on bands that support it. Select a band and use its power switch to enable or bypass it. Use the spectrum menu to show plug-in input and output separately or together. The filter response remains visible when playback is stopped.
- **Guitar Pedalboard** includes eight independently switchable effects. Drag a pedal by its header or use its arrow buttons to reorder the processing chain. Adjust pedal values on the face. The session stores order, bypass states, and control values, and the same order is used for mixdown.
- Other faces show effect-specific displays such as compressor transfer and gain reduction, repeat taps, modulation, saturation curves, and a stereo vectorscope. Instruments display the amplitude envelope or drum decay. Filter, envelope, and effect handles can be adjusted with arrow keys when focused. The plug-in power switch, reset, and settings clipboard apply per insert.
- Synth controls include oscillator shape, envelope, cutoff, resonance, fine tune, and level. The sampler adds root pitch and sample start. Drums expose kick pitch, decay, noise, and level.

### Optional native plug-ins

Install Pedalboard in the Python environment used by the launcher to enable native offline rendering. On Windows with the Python Launcher, use `py -3 -m pip install pedalboard`. Restart Sonoravell, open **Browser → Local plug-ins → Scan system folders**, and select **Open editor** for a detected VST3 or macOS Audio Unit.

Sonoravell reads the parameters the plug-in exposes and gives each a normalized 0–1 knob and numeric input. Select an audio clip for an effect or a MIDI part for an instrument, then use **Render selected event**. Sonoravell creates a new audio track. Native processing runs in a separate process and does not require FFmpeg. Some vendor plug-ins need additional licensing or do not support this host. Native realtime inserts, vendor interfaces, VST2/ARA hosting, and third-party parameter automation remain open.

### Studio One keyboard map

In Studio One or Fender Studio Pro, use the keyboard mapping scheme menu’s **Export** option to save the original `.keyscheme` file. In Sonoravell, open **Find Command** with **Ctrl+K**, choose **Import keys**, and select the original file. Review the matched shortcuts, conflicts, and unmapped commands, then select **Apply keymap**. Imported secondary bindings are available alongside each primary binding. Sonoravell’s JSON maps remain importable.

## Existing workflow

| Area | Controls |
| --- | --- |
| Edit | F2. Tools 1–8, Ctrl+click selection, Alt-drag duplication, Ctrl+Alt-drag slip, contextual commands, MIDI quantize, ripple delete, fades, and bounce. |
| Mixer | F3. Sends, FX returns, trim, polarity, mono, solo-safe, dim solo, insert chains, and scenes. |
| Inspector and Browser | F4 and F5. Built-in effects and instruments, favorites, presets, pool, and the local inventory. |
| QWERTY MIDI | Caps Lock, then A through J and the upper-row accidentals. Z/X changes octaves and C/V changes velocity. R records a selected or armed instrument. |
| Export | Ctrl+E or Ctrl+Shift+E. Ranges, stems, native WAV/MIDI, and additional FFmpeg formats. |
| Persist | Save for a portable session, Open to reopen it. Earlier portable Soundweave sessions remain supported. |

## Verification and coverage

Run `node tests/check_recording.cjs` to verify timed PCM capture and the encoded fallback using audio device doubles. Run `node tests/check_ui.cjs`, `node tests/check_panels.cjs`, and `node tests/check_patch_panel.cjs` for Console controls, viewport restoration, graph panning and rewiring, track insertion and retention, global events, loop locators, action values, scoped shortcuts, and monitoring using test doubles. Run `node tests/check.cjs` for preference profile validation, project and MIDI round trips, live graph topology, folder-bus restoration, signal types, feedback rejection, spatial gains, WAV format, keymap translation, MIDI expression, sustain, and audio scheduling with test doubles. Run `python3 tests/check_local.py` for the localhost service, plug-in scan fixtures, native worker payloads, and FFmpeg codecs. Run `python3 build.py` after changing the source to regenerate the standalone HTML and embed its artwork.

The automated checks cover project data, view wiring, and launcher behavior. Interactive Chromium playback and native browser window behavior, physical audio and MIDI devices on Windows, and rendering through an installed third-party plug-in remain unverified. Sonoravell incorporates selected workflow details from the references below. Full Fender feature parity remains open, including proprietary stock plug-ins, native ASIO, Studio One projects, deep comping and pitch workflows, and dedicated mastering and show workspaces.

## Sources

- [Fender Studio Pro manual – Macro Toolbar](https://fenderstudiopromanual.fender.com/en/Content/Editing_Topics/Macro_Toolbar.htm)
- [Fender Studio Pro manual – Edit View Event Editing](https://fenderstudiopromanual.fender.com/en/Content/Editing_Topics/Edit_View_Event_Editing.htm)
- [Fender Studio Pro manual – Events](https://fenderstudiopromanual.fender.com/en/Content/Editing_Topics/Events.htm)
- [PreSonus video – How to Build Macros to Maximize Production Efficiency](https://www.youtube.com/watch?v=t4S8qxKmhsI)

- [Blender Manual – Node parts and sockets](https://docs.blender.org/manual/en/latest/interface/controls/nodes/parts.html)
- [Fender Studio Pro manual – Effects Signal Routing](https://fenderstudiopromanual.fender.com/en/Content/Mixing_Topics/Effects_Signal_Routing.htm)

- [Fender Studio Pro manual – The Console](https://fenderstudiopromanual.fender.com/en/Content/Mixing_Topics/The_Console.htm)
- [Fender Studio Pro manual – Channel Overview and Editor](https://fenderstudiopromanual.fender.com/en/Content/Mixing_Topics/Channel%20Overview%20and%20Editor.htm)
- [Fender Studio Pro manual – Customization and panel locations](https://fenderstudiopromanual.fender.com/en/Content/Setup_Topics/Customization.htm)
- [PreSonus video – Mixer Options and Layouts in Studio One](https://www.youtube.com/watch?v=ZCJN9XxtPM4)
- [Sweetwater – Fender Studio Pro mixer and FX-chain pictures](https://www.sweetwater.com/sweetcare/articles/working-with-plug-ins-in-fender-studio-pro/)

- [Fender Studio Pro manual and keyboard reference](https://www.fender.com/pages/fender-studio-pro-specs-resources)
- [Fender Studio Pro manual – General Options](https://fenderstudiopromanual.fender.com/en/Content/Setup_Topics/General_Options.htm)
- [Fender Studio Pro manual – Advanced Options](https://fenderstudiopromanual.fender.com/en/Content/Setup_Topics/Advanced_Options.htm)
- [Fender Studio Pro manual – Managing Your Content](https://fenderstudiopromanual.fender.com/en/Content/Setup_Topics/Managing_Your_Content.htm)
- [Fender Studio – Speed up Your Workflow with Custom Settings](https://www.youtube.com/watch?v=NrYnI-r1cdI)
- [Fender Studio – Audio Settings](https://www.youtube.com/watch?v=qJI6fXewu_I)

- [Fender Studio – Channel and Arrangement Overviews](https://www.youtube.com/watch?v=CFmCGfcau4Q)
- [Fender Studio – Mixing in Dolby Atmos with Studio One Pro](https://www.youtube.com/watch?v=Qg3ajNjt-4M)
- [Fender Studio Pro manual – Spatial mixing](https://fenderstudiopromanual.fender.com/en/Content/Spatial_Audio_Topics/Mixing_Spatial_Audio.htm)
- [Fender Studio Pro manual – Cue mixes](https://fenderstudiopromanual.fender.com/en/Content/Recording_Topics/Cue_Mixes_and_Low-Latency_Monitoring.htm)
- [Fender Studio Pro manual – Key commands](https://fenderstudiopromanual.fender.com/en/Content/Fundamentals_Topics/Key_Commands.htm)
- [Fender Studio Pro manual – Pro EQ3](https://fenderstudiopromanual.fender.com/en/Content/Built-In_Effects_Topics/EQ.htm)
- [Fender Studio Pro manual – Ampire and Pedalboard](https://fenderstudiopromanual.fender.com/en/Content/Built-In_Effects_Topics/Distortion.htm)
- [Fender Studio – Adding plug-ins to your guitar pedalboard](https://www.youtube.com/watch?v=EafLQHEhhA4)
- [Public reference for the exported keymap structure](https://github.com/pajdarova/FenderStudioProMCP/blob/main/src/studio_pro_mcp/keyscheme.py)
- [Spotify Pedalboard – native plug-in API](https://spotify.github.io/pedalboard/reference/pedalboard.html)

- [Blender Manual – editing nodes and links](https://docs.blender.org/manual/en/5.0/interface/controls/nodes/editing.html)


- [Fender Studio Pro user guide – recording and audio event fades](https://downloads.ctfassets.net/mdpgzc1lmx9t/4a95Tj0SfvdaC3VC5IvVMG/7c6732e98c4f8b6b097f7907982d88a6/UM_Fender-Studio-Pro_EN.pdf)
- [Fender Studio – Crossfade Tricks You May Not Know in Studio One](https://www.youtube.com/watch?v=Ymvw_ggLUfU)
- [PreSonus – Studio One Pro 7 More Efficient Editing](https://support.presonus.com/hc/en-us/articles/28825440059149-Studio-One-Pro-7-More-Efficient-Editing)


- [Fender Studio Pro manual – Audio Track creation, routing and input monitoring](https://fenderstudiopromanual.fender.com/en/Content/Recording_Topics/Audio_Tracks.htm)
- [Fender Studio Pro manual – Instrument Track creation and input routing](https://fenderstudiopromanual.fender.com/en/Content/Recording_Topics/Instrument_Tracks.htm)
- [Fender Studio – Recording Basics: What is a Track?](https://www.youtube.com/watch?v=nmHlGgpNnt0)
- [PCAudioLabs – Studio One Add Tracks dialog screenshots](https://pcaudiolabs.com/track-presets-in-studio-one-6/)


- [Fender Studio Pro manual – Global Tracks and arrangement screenshots](https://downloads.ctfassets.net/mdpgzc1lmx9t/4a95Tj0SfvdaC3VC5IvVMG/7c6732e98c4f8b6b097f7907982d88a6/UM_Fender-Studio-Pro_EN.pdf)
- [Fender Studio Pro manual – Looping During Mixing](https://fenderstudiopromanual.fender.com/en/Content/Mixing_Topics/Looping_During_Mixing.htm)
- [Fender Studio – Global Lyrics Track](https://www.youtube.com/watch?v=E_XPEXE1HHQ)
- [Fender Studio – Using the Chord Track](https://www.youtube.com/watch?v=A_3CMsyfWqo)


- [Fender Studio Pro manual – Note Editor action groups](https://fenderstudiopromanual.fender.com/en/Content/Editing_Topics/Action_Menu.htm)
- [Fender Studio – MIDI Editing Improvements and Scale Highlight](https://www.youtube.com/watch?v=MGCOVPftQHE)
- [Sound On Sound – Piano-roll inspector and velocity screenshots](https://www.soundonsound.com/techniques/studio-one-music-editor-tricks)
