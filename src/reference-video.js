(function (SW) {
  function createReferenceVideo({video, window, title, readout, preferences, location, active, report}) {
    let url = '';
    const loaded = () => url && video.readyState > 0;
    const visible = () => !window.hidden;
    function updateTime() {
      readout.value = loaded() ? video.currentTime.toFixed(3)+' s' : 'No reference';
    }
    function align(playing) {
      const settings = preferences();
      video.muted = settings.videoMute;
      if (!loaded() || !visible() || !settings.videoFollow) return;
      const position = location() - settings.videoOffset;
      const within = position >= 0 && position < video.duration;
      const at = Math.min(video.duration, Math.max(0,position));
      if (Math.abs(video.currentTime-at) > (playing ? .2 : .002)) video.currentTime = at;
      if (playing && within && video.paused && !video.ended) video.play().catch(() => {});
      if ((!playing || !within) && !video.paused) video.pause();
    }
    function hide() {window.hidden = true;video.pause();}
    function show() {window.hidden = false;align(active());}
    function clear() {
      if (!url) return;
      video.pause();
      URL.revokeObjectURL(url);url='';
      video.removeAttribute('src');video.load();title.textContent='Video reference';updateTime();
    }
    function load(file) {
      clear();
      url = URL.createObjectURL(file);video.src = url;title.textContent=file.name;
      show();
    }
    function step(change) {
      if (!loaded()) return;
      if (preferences().videoFollow && active()) return;
      video.pause();
      video.currentTime = Math.min(video.duration,Math.max(0,video.currentTime+change/Number(preferences().videoFPS)));
    }
    video.addEventListener('loadedmetadata', () => {align(active());updateTime();});
    video.addEventListener('timeupdate',updateTime);
    video.addEventListener('error',() => {if (url) report(Error('This browser could not open the video reference.'));});
    return {load, show, hide, clear, visible, align, step,
      togglePlayback:() => {
        if (!loaded() || preferences().videoFollow && active()) return;
        if (!video.paused) video.pause();
        else video.play().catch(report);
      }};
  }
  SW.createReferenceVideo = createReferenceVideo;
})(SW);
