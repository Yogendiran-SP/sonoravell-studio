(function (SW) {
  function createPanelWindows({status,onChange}) {
    const popups = new Map(), listeners = [], fullscreenIntent = new WeakMap();
    function listen(target,type,handler,options) {
      listeners.push([target===window,type,handler,options]);
      target.addEventListener(type,handler,options);
    }
    function get(id) {
      for (const {win} of popups.values()) {
        const el = win.document.getElementById(id);
        if (el) return el;
      }
      return null;
    }
    function query(selector) {
      return [...popups.values()].flatMap(({win})=>[...win.document.querySelectorAll(selector)]);
    }
    function attach(panel,close=true) {
      const record=popups.get(panel);
      if(!record) return;
      popups.delete(panel);
      record.events.abort();
      closeFullscreen(panel);
      record.anchor.replaceWith(panel);
      panel.classList.remove('panel-popped','panel-maximized');
      if(close&&!record.win.closed) record.win.close();
      onChange();
    }
    function detach(panel,title,{width=1040,height=700}={}) {
      if(popups.has(panel)){attach(panel);return;}
      const win=window.open('','','popup,width='+width+',height='+height);
      if(!win){status('Allow pop-ups to detach this panel.',true);return;}
      const doc=win.document;
      const anchor=document.createComment('Sonoravell panel '+title);
      try {
        doc.title=title+' · Sonoravell';
        for(const original of document.querySelectorAll('style,link[rel=stylesheet]')){
          const style=original.cloneNode(true);
          if(original.href)style.href=original.href;
          doc.head.append(style);
        }
        doc.body.className=document.body.className+' popup-workspace';
        Object.assign(doc.body.dataset,document.body.dataset);
        const events=new AbortController();
        for(const [toWindow,type,handler,options] of listeners){
          (toWindow?win:doc).addEventListener(type,handler,{...(options||{}),signal:events.signal});
        }
        panel.before(anchor);
        popups.set(panel,{win,anchor,events});
        panel.classList.remove('panel-maximized');
        panel.classList.add('panel-popped');
        doc.body.append(panel);
        win.addEventListener('pagehide',()=>attach(panel,false),{once:true,signal:events.signal});
        win.focus();onChange();return true;
      } catch(error) {
        if(popups.has(panel))attach(panel);
        else win.close();
        status(error.message,true);
      }
    }
    async function fullscreen(panel,desired) {
      const doc=panel.ownerDocument;
      const active=doc.fullscreenElement===panel||panel.classList.contains('panel-maximized');
      const enter=desired??!active, intent={enter};
      fullscreenIntent.set(panel,intent);
      if(enter===active)return;
      if(!enter){
        if(doc.fullscreenElement===panel)await doc.exitFullscreen();
        panel.classList.remove('panel-maximized');return;
      }
      try{
        if(!panel.requestFullscreen)throw Error('Fullscreen unavailable');
        await panel.requestFullscreen();
        if(fullscreenIntent.get(panel)?.enter===false&&doc.fullscreenElement===panel)await doc.exitFullscreen();
      }catch{
        if(fullscreenIntent.get(panel)===intent&&!panel.hidden)panel.classList.add('panel-maximized');
      }
    }
    function closeFullscreen(panel){
      fullscreenIntent.set(panel,{enter:false});
      if(panel.ownerDocument?.fullscreenElement===panel) panel.ownerDocument.exitFullscreen().catch(()=>{});
      panel.classList.remove('panel-maximized');
    }
    function focus(panel){popups.get(panel)?.win.focus();}
    function close(){for(const panel of [...popups.keys()])attach(panel);}
    function sync(){
      for(const {win} of popups.values()){
        win.document.body.className=document.body.className+' popup-workspace';
        Object.assign(win.document.body.dataset,document.body.dataset);
      }
    }
    return {listen,get,query,detach,attach,fullscreen,closeFullscreen,focus,close,sync,detached:panel=>popups.has(panel)};
  }
  function bindPanelResize(handle,axis,read,write,limit) {
    let start;
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0) return;
      const coordinate=axis==='y'?event.clientY:event.clientX;
      start={size:read(),coordinate,pointer:event.pointerId};
      handle.setPointerCapture(event.pointerId);event.preventDefault();
    });
    handle.addEventListener('pointermove',event=>{
      if(start?.pointer!==event.pointerId)return;
      write(SW.clamp(start.size+start.coordinate-(axis==='y'?event.clientY:event.clientX),...limit()));
    });
    handle.addEventListener('lostpointercapture',()=>{start=null;});
    handle.addEventListener('keydown',event=>{
      const delta=axis==='y'?{ArrowUp:24,ArrowDown:-24}:{ArrowLeft:24,ArrowRight:-24};
      if(!Object.hasOwn(delta,event.key))return;
      event.preventDefault();write(SW.clamp(read()+delta[event.key],...limit()));
    });
  }
  Object.assign(SW,{createPanelWindows,bindPanelResize});
})(SW);
