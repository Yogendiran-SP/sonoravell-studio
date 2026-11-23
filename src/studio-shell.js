(function (SW) {
  const groups = [
    ['File', ['new','open','demo',null,'save',['save-copy','Save a copy…'],null,'import-media','import-video','export','export-stems','export-midi','audio-batch']],
    ['Edit', ['undo','redo',null,'cut','copy','paste','paste-original','delete',null,'all','select-track','select-muted','invert-selection','clear-selection','snap-toggle','find']],
    ['Session', ['session-setup','session-io','marker',null,'import-media','export','export-stems','export-selection','export-midi',null,'add-to-mastering','add-to-show']],
    ['Track', ['insert-track','add-bus','add-fx',null,'track-duplicate','track-remove','track-remove-complete','track-arm','track-mute','track-solo','track-icon']],
    ['Event', ['split','duplicate','repeat','merge','quantize','align',null,'mute-event','lock-event','nudge-left','nudge-right','split-range','trim-range','delete-time']],
    ['Audio', ['normalize','reverse','detect-stops',null,'fade-both','crossfade','reset-fades','slip-left','slip-right']],
    ['Transport', ['transport','stop','record',null,'home','end','loop','range-loop','click']],
    ['View', ['edit','mixer','browser','inspector','automation','routing','keyboard','video-panel','arrange-macros',null,
      'launcher-view','scratch-view','patterns-view','score-view','lyrics-view','channel-view','monitor-view',
      null,'zoom-in','zoom-out','zoom-fit','zoom-vertical-in','zoom-vertical-out']],
    ['Window', ['show-start','show-session','show-mastering','show-live','quick-switch',null,'focus-arrange','detach-panel','fullscreen-panel','detach-browser','fullscreen-browser',null,'fullscreen','reset-layout']],
    ['Studio', ['preferences','settings-audio','settings-midi','settings-keys','macro-organizer',null,'import-keys','export-keys']],
    ['Help', ['help','find','online-reference','workflow-tutorial','about']]
  ];

  function createMenu({container,popup,commands,shortcut,execute,available,checked,esc}) {
    const button = (i, label) => '<button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false" aria-controls="studio-menu-popup" data-menu="'+i+'">'+esc(label)+'</button>';
    container.innerHTML = groups.map(([label], i) => button(i,label)).join('');
    let active = -1;
    const menuButtons = () => [...container.querySelectorAll('[data-menu]')];
    const entries = () => [...popup.querySelectorAll('button:not(:disabled)')];
    function close(returnFocus = false) {
      if (active < 0) return;
      const current = menuButtons()[active];
      current?.setAttribute('aria-expanded','false');
      active = -1;
      popup.hidden = true;
      if (returnFocus) current?.focus();
    }
    function open(index, selection = 'first') {
      if (active !== index) close();
      active = index;
      const title = menuButtons()[index];
      const [label, items] = groups[index];
      popup.setAttribute('aria-label',label);
      popup.innerHTML = items.map(item => {
        if (!item) return '<hr role="separator">';
        const [id, override] = Array.isArray(item) ? item : [item];
        const name = override || commands[id][0], mark = checked(id), key = shortcut(id);
        return '<button type="button" tabindex="-1" role="'+(mark === undefined?'menuitem':'menuitemcheckbox')+'" data-menu-command="'+esc(id)+'"'+
          (mark === undefined?'':' aria-checked="'+mark+'"')+(available(id)?'':' disabled')+'><span class="menu-check">'+(mark?'✓':'')+
          '</span><span>'+esc(name)+'</span><kbd>'+esc(key)+'</kbd></button>';
      }).join('');
      popup.hidden = false;
      title?.setAttribute('aria-expanded','true');
      const rect = title?.getBoundingClientRect();
      if (rect) {
        popup.style.left = Math.max(4,Math.min(rect.left,innerWidth-popup.offsetWidth-4))+'px';
        popup.style.top = rect.bottom+'px';
        popup.style.maxHeight = Math.max(72, innerHeight-rect.bottom-8)+'px';
      }
      if (selection) (selection === 'last' ? entries().at(-1) : entries()[0])?.focus();
    }
    container.addEventListener('click', event => {
      const title = event.target.closest('[data-menu]');
      if (!title) return;
      const index = Number(title.dataset.menu);
      if (index === active) close(true);
      else open(index);
    });
    container.addEventListener('pointerover', event => {
      const title = event.target.closest('[data-menu]');
      if (event.pointerType !== 'touch' && active !== -1 && title && Number(title.dataset.menu) !== active) open(Number(title.dataset.menu),null);
    });
    popup.addEventListener('click', event => {
      const item = event.target.closest('[data-menu-command]');
      if (!item || item.disabled) return;
      close(true);
      execute(item.dataset.menuCommand);
    });
    document.addEventListener('pointerdown', event => {
      if (!container.contains(event.target) && !popup.contains(event.target)) close();
    });
    window.addEventListener('resize', () => close());
    container.addEventListener('scroll', () => close());
    function handleKey(event) {
      const title = event.target.closest('[data-menu]'), item = event.target.closest('[data-menu-command]');
      if (active < 0 && !title) return false;
      if (event.key === 'Escape' && active >= 0) {close(true);return true;}
      if (event.key === 'Tab') {close();return false;}
      const index = active >= 0 ? active : Number(title.dataset.menu);
      if (['ArrowLeft','ArrowRight'].includes(event.key)) {
        const next = (index + groups.length + (event.key === 'ArrowRight' ? 1 : -1)) % groups.length;
        if (active >= 0) open(next);
        else menuButtons()[next]?.focus();
        return true;
      }
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return false;
      if (active < 0) {
        if (event.key === 'Home') menuButtons()[0]?.focus();
        else if (event.key === 'End') menuButtons().at(-1)?.focus();
        else open(index,event.key === 'ArrowUp'?'last':'first');
        return true;
      }
      const enabled = entries(), current = enabled.indexOf(item);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 :
        current < 0 ? (event.key === 'ArrowUp' ? enabled.length - 1 : 0) :
        (current + enabled.length + (event.key === 'ArrowUp' ? -1 : 1)) % enabled.length;
      enabled[next]?.focus();
      return true;
    }
    return {close, handleKey};
  }

  function createPreferenceWindow({dialog,nav,tabs,body,profile,read,selectSetting,devices,details,action,esc}) {
    const categories = SW.preferenceCategories;
    let categoryId = 'general', pageId = 'startup';
    const category = () => categories.find(([id]) => id === categoryId);
    function drawField(field, values) {
      const {id,label,description,type,min,max,step} = field;
      const attr = 'id="pref-'+id+'" data-setting="'+id+'"';
      const desc = description ? '<small>'+esc(description)+'</small>' : '';
      const value = values[id];
      let control;
      if (type === 'select' || type === 'device') {
        const options = type === 'device' ? devices(id) : field.choices;
        const choices = options.some(([key]) => key === value) ? options : [...options,[value,'Unavailable selection']];
        control = '<select '+attr+'>'+choices.map(([key,name]) => '<option value="'+esc(key)+'"'+(key === value?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>';
      } else if (type === 'number') control = '<input '+attr+' type="number" value="'+value+'" min="'+min+'" max="'+max+'" step="'+step+'">';
      else control = '<input '+attr+' type="checkbox"'+(value?' checked':'')+'>';
      return '<label class="preference-row" for="pref-'+id+'"><span>'+esc(label)+desc+'</span>'+control+'</label>';
    }
    function render() {
      const [,label,pages] = category();
      const [,pageName,fields,actions = [],description] = pages.find(([id]) => id === pageId);
      nav.innerHTML = categories.map(([id,name]) => '<button type="button" data-preference-category="'+id+'" aria-pressed="'+(id === categoryId)+'">'+esc(name)+'</button>').join('');
      tabs.innerHTML = pages.map(([id,name]) => '<button type="button" data-preference-page="'+id+'" aria-pressed="'+(id === pageId)+'">'+esc(name)+'</button>').join('');
      body.innerHTML = '<h3>'+esc(label === pageName?label:pageName)+'</h3>'+(description?'<p>'+esc(description)+'</p>':'')+
        fields.map(field => drawField(field, read())).join('')+
        (actions.length?'<div class="preferences-actions">'+actions.map(([id,name]) => '<button type="button" data-preference-action="'+id+'">'+esc(name)+'</button>').join('')+'</div>':'')+
        '<p id="preferences-details" class="muted-text" role="status">'+esc(details(pageId))+'</p>';
      body.scrollTop = 0;
    }
    function open(nextCategory, nextPage) {
      categoryId = categories.some(([id]) => id === nextCategory) ? nextCategory : categoryId;
      const pages = category()[2];
      pageId = nextPage && pages.some(([id]) => id === nextPage) ? nextPage :
        !nextCategory && pages.some(([id]) => id === pageId) ? pageId : pages[0][0];
      render();
      if (!dialog.open) dialog.showModal();
    }
    nav.addEventListener('click', event => {
      const category = event.target.closest('[data-preference-category]');
      if (category) {open(category.dataset.preferenceCategory);nav.querySelector('[aria-pressed=true]')?.focus();}
    });
    tabs.addEventListener('click', event => {
      const tab = event.target.closest('[data-preference-page]');
      if (tab) {open(categoryId,tab.dataset.preferencePage);tabs.querySelector('[aria-pressed=true]')?.focus();}
    });
    body.addEventListener('change', event => {
      const el = event.target, id = el.dataset.setting;
      if (!id) return;
      const value = SW.settingValue(id, el.type === 'checkbox' ? el.checked : el.type === 'number' ? el.valueAsNumber : el.value);
      selectSetting(id,value);
      if (el.type === 'number') el.value = value;
      const detail = body.querySelector('#preferences-details');
      if (detail) detail.textContent = details(pageId);
    });
    for (const el of [body,profile]) el.addEventListener('click', event => {
      const button = event.target.closest('[data-preference-action]');
      if (button) action(button.dataset.preferenceAction);
    });
    return {open, refresh:() => {if (dialog.open) render();}};
  }
  Object.assign(SW,{createStudioMenu:createMenu,createPreferenceWindow});
})(SW);
