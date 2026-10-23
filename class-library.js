/* v42 guided class library. Additive: no changes to exercise measurements. */
const LS_CLASSES = 'iron-log-classes-v42';
let classes = (() => { try { return JSON.parse(localStorage.getItem(LS_CLASSES) || '[]') || []; } catch { return []; } })();
function saveClasses() { localStorage.setItem(LS_CLASSES, JSON.stringify(classes)); touchLocalUpdatedAt(); schedulePush(); }
function safeText(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function classFor(id) { return classes.find(c => c.id === id); }
function effortLabel(v) { const n=Number(v); return !n?'Not rated':n<=3?'Easy':n<=6?'Moderate':n<=8?'Hard':'All Out'; }
function classLabel(c){return `${c.title||c.exercise||'Class'}${c.episode?' — Ep '+c.episode:''}${c.instructor?' · '+c.instructor:''}`;}
function classMeta(c){return [c.duration?c.duration+' min':'',c.published||'',c.music||'',c.platform||''].filter(Boolean).join(' · ');}
function classPickerMarkup(selected='',exercise='') {
 const c=classFor(selected);
 return `<div class="cl-picker" data-exercise="${safeText(exercise)}"><input type="hidden" name="classId" value="${safeText(selected)}"><input class="cl-picker-search" type="search" autocomplete="off" placeholder="Search episode, instructor, title, date, music…" aria-label="Find saved class" value="${safeText(c?classLabel(c):'')}"><label class="cl-picker-filter"><input type="checkbox" class="cl-only-exercise" ${exercise?'checked':''}> Match this exercise</label><div class="cl-picker-results" role="listbox"></div></div>`;
}
function normalizeClassExercise(x){return String(x||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');}
function exerciseMatches(c,exercise){const x=normalizeClassExercise(exercise), y=normalizeClassExercise(c.exercise);if(!x)return true;if(x===y)return true;return (x.includes('recumbent')&&(/cycle|bike|cycling/.test(y)||/cycle|cycling/.test(normalizeClassExercise(c.title))))||(x.includes('treadmill')&&(/walk|run|treadmill/.test(y)||/walk|run/.test(normalizeClassExercise(c.title))));}
function wireClassPicker(overlay){
 const picker=overlay.querySelector('.cl-picker');if(!picker)return;
 const field=picker.querySelector('input[name=classId]'),search=picker.querySelector('.cl-picker-search'),list=picker.querySelector('.cl-picker-results'),filter=picker.querySelector('.cl-only-exercise');
 const exerciseInput=overlay.querySelector('input[name=exercise]');
 const redraw=()=>{
  const q=search.value.toLowerCase().trim(),exercise=exerciseInput?.value||picker.dataset.exercise;
  let found=classes.filter(c=>(!filter.checked||exerciseMatches(c,exercise))&&[c.title,c.episode,c.instructor,c.published,c.music,c.platform,c.exercise,c.duration,c.collection].join(' ').toLowerCase().includes(q));
  found.sort((a,b)=>Number(b.id===field.value)-Number(a.id===field.value)||Number(b.favorite)-Number(a.favorite)||Number(classStats(b.id).last.replaceAll('-',''))-Number(classStats(a.id).last.replaceAll('-',''))||classLabel(a).localeCompare(classLabel(b)));
  list.innerHTML='<button type="button" class="cl-pick-item" data-id="">No class</button>'+found.map(c=>`<button type="button" class="cl-pick-item ${c.id===field.value?'chosen':''}" data-id="${safeText(c.id)}"><strong>${safeText(classLabel(c))}</strong><small>${safeText(classMeta(c))}</small></button>`).join('')+(!found.length?'<p class="field-hint">No matching saved classes.</p>':'');
 };
 picker.addEventListener('click',e=>{const btn=e.target.closest('.cl-pick-item');if(!btn)return;field.value=btn.dataset.id;const c=classFor(field.value);search.value=c?classLabel(c):'';list.hidden=true;});
 search.addEventListener('focus',()=>{search.select();list.hidden=false;redraw()});search.addEventListener('input',()=>{field.value='';list.hidden=false;redraw()});filter.addEventListener('change',()=>{list.hidden=false;redraw()});exerciseInput?.addEventListener('input',()=>{if(!field.value)redraw()});
 picker.selectClass=id=>{field.value=id;const c=classFor(id);search.value=c?classLabel(c):'';list.hidden=true;};
 picker.addEventListener('focusout',e=>{if(!picker.contains(e.relatedTarget))setTimeout(()=>{list.hidden=true;const c=classFor(field.value);search.value=c?classLabel(c):''},100)});
 list.hidden=true;
}
function sessionItems() {
  return Object.entries(logs).flatMap(([date,day])=>Object.entries(day.classSessions||{}).filter(([,s])=>s.classId).map(([exerciseId,s])=>({date,exerciseId,...s})));
}
function classStats(id) { const all=sessionItems().filter(s=>s.classId===id).sort((a,b)=>a.date.localeCompare(b.date)); return {count:all.length,last:all.at(-1)?.date || '',sessions:all}; }
function renderClasses() {
  const wrap=el(`<section class="cl-wrap"><h2>Class Library</h2><p class="field-hint">Save classes without logging a workout. Use History to attach classes to previous sessions.</p><div class="cl-toolbar"><input id="cl-search" placeholder="Search classes, instructors, music or platforms" aria-label="Search classes"><button class="btn-primary" id="cl-add">+ Add Class</button><button class="btn-secondary" id="cl-export">Export JSON</button><button class="btn-secondary" id="cl-import">Import JSON</button><input type="file" id="cl-file" accept="application/json,.json" hidden></div><div class="cl-filter"><select id="cl-status"><option value="">All statuses</option><option>Want to Try</option><option>Active</option><option>Favorite</option><option>Archived</option></select><select id="cl-platform"><option value="">All platforms</option></select></div><div id="cl-results"></div></section>`);
  wrap.querySelector('#cl-add').onclick=()=>openClassEditor();
  wrap.querySelector('#cl-export').onclick=()=>downloadFile(JSON.stringify({format:'iron-log-classes-v42',classes,sessionLinks:sessionItems()},null,2),'class-library-backup-'+todayISO()+'.json','application/json');
  wrap.querySelector('#cl-import').onclick=()=>wrap.querySelector('#cl-file').click();
  wrap.querySelector('#cl-file').onchange=async e=>{try {
    const file=e.target.files?.[0]; if(!file)return;
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.classes))throw Error('Not a class library export');
    const links=Array.isArray(data.sessionLinks)?data.sessionLinks:[];
    if(!confirm(`Restore ${data.classes.length} classes${links.length?` and ${links.length} class-history links`:''}? Matching class IDs will be updated. Existing workout measurements and exercise sets will not be changed.`))return;
    const byId=new Map(classes.map(c=>[c.id,c]));
    data.classes.forEach(c=>{if(c.id&&c.title)byId.set(c.id,c)});
    classes=[...byId.values()];
    let restoredLinks=0;
    links.forEach(link=>{
      if(!link?.date||!link?.exerciseId||!link?.classId)return;
      if(!logs[link.date])logs[link.date]={dayId:'cardio',entries:{}};
      if(!logs[link.date].classSessions)logs[link.date].classSessions={};
      const old=logs[link.date].classSessions[link.exerciseId]||{};
      const merged={...link,...old};
      // Restore missing fields from the backup without replacing newer, non-empty session notes or effort values.
      ['classId','target','actual','modifications','notes','repeat','exerciseName'].forEach(k=>{
        if(old[k]===undefined||old[k]===null||old[k]==='')merged[k]=link[k]??old[k]??'';
      });
      logs[link.date].classSessions[link.exerciseId]=merged;
      restoredLinks++;
    });
    saveLogs(logs); saveClasses(); render();
    alert(`Restore complete: ${data.classes.length} class records available; ${restoredLinks} class-history links restored or checked. Existing workout measurements were preserved.`);
  }catch(err){alert('Import failed: '+err.message)}finally{e.target.value=''}};
  const platform=wrap.querySelector('#cl-platform'); [...new Set(classes.map(c=>c.platform).filter(Boolean))].sort().forEach(p=>platform.insertAdjacentHTML('beforeend',`<option value="${safeText(p)}">${safeText(p)}</option>`));
  const draw=()=>{
    const q=wrap.querySelector('#cl-search').value.toLowerCase(), status=wrap.querySelector('#cl-status').value, plat=platform.value;
    const selected=classes.filter(c=>(!status||c.status===status)&&(!plat||c.platform===plat)&&[c.title,c.episode,c.published,c.duration,c.platform,c.instructor,c.music,c.collection,c.exercise].join(' ').toLowerCase().includes(q));
    const results=wrap.querySelector('#cl-results');results.innerHTML='';
    if(!selected.length){results.innerHTML='<div class="empty-state">No classes match. Add a class to begin.</div>';return;}
    selected.sort((a,b)=>(b.favorite?1:0)-(a.favorite?1:0)||classLabel(a).localeCompare(classLabel(b))).forEach(c=>{
      const st=classStats(c.id);
      const card=el(`<div class="hist-card cl-card"><div class="hist-card-top"><b>${safeText(classLabel(c))}</b><span>${safeText(c.status||'Active')}</span></div><div class="field-hint">${safeText([c.platform,c.exercise,c.duration?c.duration+' min':'',c.published].filter(Boolean).join(' · '))}</div><div class="field-hint">${safeText([c.music,c.collection].filter(Boolean).join(' · '))}</div><div class="field-hint">Expected: ${safeText(c.expected||'—')} ${effortLabel(c.expected)} · Completed: ${st.count} · Last: ${safeText(st.last||'Never')}</div><div class="cl-actions"><button class="btn-secondary cl-edit">Edit</button><button class="btn-secondary cl-copy">Duplicate</button><button class="btn-secondary cl-sessions">History</button><button class="btn-secondary cl-star">${c.favorite?'♥ Favorite':'♡ Favorite'}</button>${c.url?'<a class="cl-link" target="_blank" rel="noopener noreferrer">Open class ↗</a>':''}</div><div class="cl-session-list" hidden></div></div>`);
      card.querySelector('.cl-edit').onclick=()=>openClassEditor(c.id);card.querySelector('.cl-copy').onclick=()=>openClassEditor(null,null,c);
      card.querySelector('.cl-star').onclick=()=>{c.favorite=!c.favorite;if(c.favorite)c.status='Favorite';saveClasses();render();};
      const href=card.querySelector('.cl-link');if(href && /^https?:\/\//i.test(c.url))href.href=c.url;else href?.remove();
      card.querySelector('.cl-sessions').onclick=()=>{const area=card.querySelector('.cl-session-list');area.hidden=!area.hidden;area.innerHTML=st.sessions.length?st.sessions.map(s=>`<div>${safeText(s.date)} · ${safeText(s.exerciseName||s.exerciseId)} · Effort ${safeText(s.actual||'—')}/10 (${effortLabel(s.actual)})</div>`).join(''):'No completed sessions yet.';};
      results.appendChild(card);
    });
  };
  ['#cl-search','#cl-status','#cl-platform'].forEach(id=>wrap.querySelector(id).addEventListener('input',draw));draw();return wrap;
}
const CLASS_FIELDS=[['title','Class title','text'],['platform','Platform / source','text'],['instructor','Instructor','text'],['exercise','Workout type / exercise','text'],['duration','Class duration (minutes)','number'],['episode','Episode / class number','text'],['published','Publish date','date'],['music','Music theme','text'],['url','Class URL','url'],['equipment','Equipment','text'],['focus','Body focus','text'],['difficulty','Difficulty / skill level','text'],['collection','Collection','text']];
function openClassEditor(id,onSaved,duplicateOf=null){
 const original=id?classFor(id):null, lastClass=classes[classes.length-1]||{}, base=original||duplicateOf||{platform:lastClass.platform||'Apple Fitness+',exercise:lastClass.exercise||'',instructor:lastClass.instructor||'',duration:lastClass.duration||''};
 const primary=['title','episode','instructor','duration','music'];
 const extra=['published','platform','exercise','url','equipment','focus','difficulty','collection'];
 const makeField=key=>{const [,,type]=CLASS_FIELDS.find(x=>x[0]===key);const label=CLASS_FIELDS.find(x=>x[0]===key)[1];return `<label class="form-row">${label}<input name="${key}" type="${type}" ${key==='duration'?'list="cl-durations"':key==='instructor'?'list="cl-instructors"':''} value="${safeText(key==='episode'&&duplicateOf?'':base[key]||'')}" ${key==='duration'?'min="1"':''}></label>`};
 const overlay=el(`<div class="modal-overlay"><div class="modal cl-modal"><h3>${original?'Edit':duplicateOf?'Duplicate':'Add'} Class</h3><form id="cl-form"><div class="cl-fields">${primary.map(makeField).join('')}</div><datalist id="cl-durations"><option value="5"><option value="10"><option value="20"><option value="30"><option value="45"></datalist><datalist id="cl-instructors">${[...new Set(classes.map(c=>c.instructor).filter(Boolean))].map(v=>`<option value="${safeText(v)}">`).join('')}</datalist><div class="cl-preview"><small>Class label preview</small><strong id="cl-preview-label"></strong><small id="cl-preview-meta"></small></div><details class="cl-more"><summary>Additional Details</summary><div class="cl-fields">${extra.map(makeField).join('')}<label class="form-row">Expected difficulty (1–10)<select name="expected"><option value="">Not set</option>${Array.from({length:10},(_,i)=>`<option value="${i+1}" ${Number(base.expected)===i+1?'selected':''}>${i+1} — ${effortLabel(i+1)}</option>`).join('')}</select></label><label class="form-row">Status<select name="status">${['Want to Try','Active','Favorite','Archived'].map(x=>`<option ${base.status===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="form-row"><input name="favorite" type="checkbox" ${base.favorite?'checked':''}> Favorite</label><label class="form-row">Class notes<textarea name="notes">${safeText(base.notes||'')}</textarea></label></div></details><div class="modal-actions"><button type="button" class="btn-secondary cl-cancel">Cancel</button>${original?'<button type="button" class="btn-secondary cl-delete">Delete</button>':''}<button type="submit" name="saveMode" value="another" class="btn-secondary">Save & Add Another</button><button type="submit" name="saveMode" value="close" class="btn-primary">Save Class</button></div></form></div></div>`);
 const close=()=>overlay.remove();overlay.onclick=e=>{if(e.target===overlay)close()};overlay.querySelector('.cl-cancel').onclick=close;
 const form=overlay.querySelector('#cl-form');
 const preview=()=>{const d=Object.fromEntries(new FormData(form).entries());overlay.querySelector('#cl-preview-label').textContent=classLabel(d);overlay.querySelector('#cl-preview-meta').textContent=classMeta(d)};
 form.addEventListener('input',preview);preview();
 overlay.querySelector('.cl-delete')?.addEventListener('click',()=>{if(!confirm('Delete this class from the library? Linked workout sessions will keep their measurements but lose this class reference.'))return;classes=classes.filter(c=>c.id!==id);Object.values(logs).forEach(d=>Object.values(d.classSessions||{}).forEach(s=>{if(s.classId===id)s.classId=''}));saveLogs(logs);saveClasses();close();render()});
 form.onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form).entries());data.title=(data.title||'').trim()||data.exercise?.trim()||'';if(!data.title){alert('Enter a class name or workout type.');return}data.favorite=form.elements.favorite.checked;data.id=original?.id||('class_'+Date.now()+'_'+Math.random().toString(36).slice(2,7));if(original)Object.assign(original,data);else classes.push(data);saveClasses();close();render();onSaved?.(data.id);if(e.submitter?.value==='another')openClassEditor(null,onSaved,{...data,episode:''});};document.body.appendChild(overlay);
}
function editClassSession(date, exerciseId, exerciseName){
  const current=logs[date]?.classSessions?.[exerciseId]||{};
  const overlay=el(`<div class="modal-overlay"><div class="modal cl-modal"><h3>Class for ${safeText(exerciseName)}</h3><p class="field-hint">${safeText(date)} · Historical workout measurements remain unchanged.</p><form id="cl-session"><label class="form-row">Saved class</label>${classPickerMarkup(current.classId,exerciseName)}<button class="btn-secondary" type="button" id="cl-new">+ Create New Class</button><details><summary>Effort & session details</summary><div class="cl-fields"><label class="form-row">Target effort<select name="target">${effortOptions(current.target)}</select></label><label class="form-row">Actual effort<select name="actual">${effortOptions(current.actual)}</select></label><label class="form-row">Modifications<textarea name="modifications">${safeText(current.modifications||'')}</textarea></label><label class="form-row">Notes<textarea name="notes">${safeText(current.notes||'')}</textarea></label><label class="form-row">Would repeat?<select name="repeat">${['','Yes','Maybe','No'].map(v=>`<option ${current.repeat===v?'selected':''}>${v}</option>`).join('')}</select></label></div></details><div class="modal-actions"><button type="button" class="btn-secondary cl-cancel">Cancel</button><button class="btn-primary" type="submit">Save</button></div></form></div></div>`);
  const close=()=>overlay.remove();overlay.onclick=e=>{if(e.target===overlay)close()};overlay.querySelector('.cl-cancel').onclick=close;
  overlay.querySelector('#cl-new').onclick=()=>openClassEditor(null,id=>{if(document.body.contains(overlay)){overlay.querySelector('.cl-picker')?.selectClass(id)}});
  overlay.querySelector('form').onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget).entries()); if(!logs[date])logs[date]={dayId:'cardio',entries:{}};if(!logs[date].classSessions)logs[date].classSessions={};logs[date].classSessions[exerciseId]={...data,exerciseName};saveLogs(logs);close();render()};document.body.appendChild(overlay);wireClassPicker(overlay);
}
function effortOptions(selected){return `<option value="">Not recorded</option>`+Array.from({length:10},(_,i)=>`<option value="${i+1}" ${Number(selected)===i+1?'selected':''}>${i+1} — ${effortLabel(i+1)}</option>`).join('');}
function renderDayClassSection(date){
 const box=el(`<details class="cl-day hist-card"><summary>Class Details (optional) ▾</summary><p class="field-hint">Associate classes with your exercises. You can also add them to older workouts in History.</p><div class="cl-day-items"></div></details>`);
 const existing=logs[date]?.classSessions||{};const day=selectedDayInfo();
 const exerciseNames=new Map(); if(day&&day.loggable){for(const key of [day.id,finisherKey(day.id)])getExerciseList(date,key).forEach(x=>exerciseNames.set(x.id,x.name));}
 Object.entries(logs[date]?.entries||{}).forEach(([id])=>{const ex=allExercises()[id];if(ex)exerciseNames.set(id,ex.name)});
 Object.entries(existing).forEach(([id,s])=>{if(!exerciseNames.has(id))exerciseNames.set(id,s.exerciseName||id)});
 const items=box.querySelector('.cl-day-items');
 exerciseNames.forEach((name,id)=>{const cur=existing[id];const b=el(`<button class="btn-secondary cl-session-btn">${safeText(name)}: ${safeText(classFor(cur?.classId)?.title||'Add class / effort')}</button>`);b.onclick=()=>editClassSession(date,id,name);items.appendChild(b)});
 if(!exerciseNames.size)items.innerHTML='<p class="field-hint">Add an exercise first, or use History to backfill previous workouts.</p>';
 return box;
}
function attachHistoryClassButtons(card,date,dayLog,exMap){
 const names=new Map();Object.entries(dayLog.entries||{}).forEach(([id,e])=>{if(entryHasData(e))names.set(id,exMap[id]?.name||id)});
 Object.entries(logs[date]?.classSessions||{}).forEach(([id,s])=>names.set(id,s.exerciseName||exMap[id]?.name||id));
 if(!names.size)return;
 const details=el('<details class="cl-history"><summary>Class Details / Edit Past Classes</summary><div class="cl-day-items"></div></details>');
 names.forEach((name,id)=>{const s=logs[date]?.classSessions?.[id];const c=classFor(s?.classId);const label=`${name} — ${c?.title||'Add class'}${s?.actual?' · effort '+s.actual+'/10':''}`;const button=el(`<button class="btn-secondary cl-session-btn">${safeText(label)}</button>`);button.onclick=()=>editClassSession(date,id,name);details.querySelector('div').appendChild(button)});
 card.appendChild(details);
}
function openHistoricClassEntry(){
 const overlay=el(`<div class="modal-overlay"><div class="modal cl-modal"><h3>Add a Past Class</h3><p class="field-hint">Create a historical class record without changing existing Apple Watch measurements or exercise sets.</p><form id="cl-past"><label class="form-row">Workout date<input required type="date" name="date" value="${todayISO()}"></label><label class="form-row">Exercise / workout type<input required type="text" name="exercise" placeholder="e.g. Pilates, Recumbent Bike"></label><label class="form-row">Saved class</label>${classPickerMarkup()}<button type="button" class="btn-secondary cl-new">+ New Class</button><label class="form-row">Actual effort (optional)<select name="actual">${effortOptions()}</select></label><label class="form-row">Target effort (optional)<select name="target">${effortOptions()}</select></label><label class="form-row">Modifications<textarea name="modifications"></textarea></label><label class="form-row">Notes<textarea name="notes"></textarea></label><div class="modal-actions"><button type="button" class="btn-secondary cl-cancel">Cancel</button><button type="submit" class="btn-primary">Save Past Session</button></div></form></div></div>`);
 const close=()=>overlay.remove();overlay.onclick=e=>{if(e.target===overlay)close()};overlay.querySelector('.cl-cancel').onclick=close;
 overlay.querySelector('.cl-new').onclick=()=>openClassEditor(null,id=>{if(document.body.contains(overlay))overlay.querySelector('.cl-picker')?.selectClass(id)});
 overlay.querySelector('form').onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget).entries());const {date,exercise,...rest}=values;if(!date||!exercise.trim())return;if(!logs[date])logs[date]={dayId:'cardio',entries:{}};if(!logs[date].classSessions)logs[date].classSessions={};const id='past_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);logs[date].classSessions[id]={...rest,exerciseName:exercise.trim()};saveLogs(logs);close();state.tab='history';render();};document.body.appendChild(overlay);wireClassPicker(overlay);
}
