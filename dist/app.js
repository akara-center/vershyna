'use strict';
const KEY='summit-v1', Q=QuestCore;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID(), number=n=>Number(n).toLocaleString('uk-UA',{maximumFractionDigits:1});
let state, persistenceBlocked=false, startupError='', interval=null, remaining=600, timerStep=null, toastTimeout, exportURL, backupURLs=[];
try {
  const raw=localStorage.getItem(KEY);
  state=raw?JSON.parse(raw):structuredClone(initial);
  Q.validate(state);
  state=Q.pruneTrash(Q.normalize(migrateState(state)));
  if(raw){try{resetMigrationBackups(raw);}catch{startupError='Не вдалося створити датовану копію перед перенесенням. Старі копії не видалено. Збережи JSON через «Дані».';}}
  if(!state.missions.some(m=>m.id===state.active))state.active=state.missions[0]?.id||null;
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch{persistenceBlocked=true;startupError='Прогрес прочитано, але браузер не дозволяє зберегти оновлення. Експортуй його через «Дані», перш ніж закривати сторінку.';}
} catch(error) {
  state=Q.normalize(structuredClone(initial)); persistenceBlocked=true;
  startupError='Не вдалося прочитати або зберегти прогрес. Попередні дані не перезаписуються. Відкрий «Дані» та імпортуй свою копію.';
}
const BACKUP_LABELS=[
  ['-before-github','Копія перед перенесенням на GitHub'],
  ['-before-import','Копія перед останнім імпортом'],
  ['-before-v4','Копія перед оновленням'],
  ['-before-ui-upgrade','Копія перед зміною інтерфейсу'],
  ['-before-transfer','Копія перед перенесенням задачі'],
  ['-before-project-change','Копія перед архівуванням або видаленням проєкту']
];
function backupStamp(value){return new Date(value).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});}
function backupFilename(value){return 'vershyna-backup-'+new Date(value).toISOString().replace(/[:.]/g,'-')+'.json';}
function writeBackup(suffix,raw){
  Q.validate(JSON.parse(raw));
  const key=KEY+suffix,createdAt=new Date().toISOString();
  localStorage.setItem(key,raw);
  // Store dates separately to keep all existing JSON backups directly importable.
  try{localStorage.setItem(key+'-created-at',createdAt);}catch{localStorage.removeItem(key+'-created-at');}
}
function resetMigrationBackups(raw){
  const marker=KEY+'-github-backup-reset-v1';
  if(localStorage.getItem(marker))return;
  writeBackup('-before-github',raw);
  // Do not prune without verifying that the new copy and its date were saved.
  if(localStorage.getItem(KEY+'-before-github')!==raw||!localStorage.getItem(KEY+'-before-github-created-at'))throw Error('Не вдалося створити датовану копію перед перенесенням.');
  localStorage.setItem(marker,'1');
  for(const suffix of ['-before-import','-before-v4','-before-ui-upgrade','-before-transfer','-before-project-change']){
    localStorage.removeItem(KEY+suffix);localStorage.removeItem(KEY+suffix+'-created-at');
  }
}
function save(){
  if(persistenceBlocked){toast(startupError);return false;}
  try{localStorage.setItem(KEY,JSON.stringify(state));return true;}
  catch{toast('Не вдалося зберегти. Експортуй прогрес через «Дані».');return false;}
}
function mission(){return state.missions.find(m=>m.id===state.active&&!m.archived)||state.missions.find(m=>!m.archived);}
function leaves(m=mission()){return m?.steps.flatMap(Q.leaves)||[];}
function nextStep(){return mission()?Q.nextAction(mission()):null;}
function totalXP(){return state.missions.flatMap(m=>m.steps).reduce((sum,s)=>sum+Q.earned(s),0);}
function toast(message){clearTimeout(toastTimeout);$('#toast').textContent=message;$('#toast').classList.remove('hidden');toastTimeout=setTimeout(()=>$('#toast').classList.add('hidden'),5000);}
function stopTimer(){clearInterval(interval);interval=null;}
function resetTimer(){stopTimer();timerStep=null;}
function formatTime(seconds){return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;}
function modal(html){closeTaskMenus();$('#modalContent').innerHTML=html;if(!$('#modal').open)$('#modal').showModal();$$('[data-close]').forEach(b=>b.onclick=()=>$('#modal').close());}
// Backdrop events target the dialog; require both ends of the tap outside its bounds.
let backdropPointer=null;
function outsideModal(event){const r=$('#modal').getBoundingClientRect();return event.target===$('#modal')&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);}
$('#modal').addEventListener?.('pointerdown',event=>{backdropPointer=outsideModal(event)?event.pointerId:null;});
$('#modal').addEventListener?.('pointerup',event=>{if(backdropPointer===event.pointerId&&outsideModal(event))$('#modal').close();backdropPointer=null;});
$('#modal').addEventListener?.('pointercancel',()=>{backdropPointer=null;});
function confirmRemoval(message,onConfirm){
  modal(`<h2>Перемістити в кошик?</h2><p>${esc(message)}</p><div class="dialog-actions"><button data-close>Скасувати</button><button class="primary" id="confirmRemoval">Видалити</button></div>`);
  $('#confirmRemoval').onclick=onConfirm;
}
function deleteStep(id){
  const s=Q.find(mission().steps,id)?.node;if(!s)return;
  const count=Q.allSteps([s]).length-1;
  confirmRemoval(`Перемістити «${s.name}» у кошик на 7 днів?${count?' Разом із підкроками: '+count+'.':' Лише цей крок.'} Можна буде відновити.`,()=>{
    try{if(storeProjectChange(Q.trashItem(state,id)))toast(`«${s.name}» у кошику на 7 днів.`);}catch(e){toast(e.message);}
  });
}
function finishEdit(){resetTimer();save();$('#modal').close();render();}
function celebrate(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  if(document.querySelectorAll('.confetti').length)return;
  for(let i=0;i<38;i++){
    const part=document.createElement('i');part.className='confetti';
    const angle=(-155+Math.random()*130)*Math.PI/180, distance=150+Math.random()*240;
    part.style.left=(i%2?24:76)+'vw';part.style.top='78vh';
    part.style.background=['#f1ca81','#b6a0ff','#67bdaa','#eb83ba'][i%4];
    part.style.setProperty('--dx',Math.cos(angle)*distance+'px');
    part.style.setProperty('--dy',Math.sin(angle)*distance+'px');
    document.body.append(part);setTimeout(()=>part.remove(),1900);
  }
}
function celebrateProject(){
  document.querySelector('.victory-scene')?.remove();
  const scene=document.createElement('div');scene.className='victory-scene';
  scene.setAttribute('role','status');scene.setAttribute('aria-label','Святкування завершення проєкту');
  scene.innerHTML='<div class="victory-aura"></div><svg class="victory-dancer" viewBox="0 0 120 160" aria-hidden="true"><g class="dance-body" fill="currentColor"><circle cx="60" cy="30" r="14"/><path d="M49 49Q60 43 71 49L76 95Q60 104 44 95Z"/><g class="dance-left"><path d="M50 53L30 70 17 44" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/></g><g class="dance-right"><path d="M70 53L88 66 103 39" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/></g><path d="M52 96L41 120 29 137" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" class="dance-leg-left"/><path class="dance-leg-right" d="M67 96L78 120 92 137" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"/></g></svg>';
  for(let i=0;i<16;i++){
    const star=document.createElement('span');star.className='victory-star';star.textContent=i%3?'✦':'✧';
    const a=i*Math.PI/8;star.style.setProperty('--sx',Math.cos(a)*(100+i%3*30)+'px');star.style.setProperty('--sy',Math.sin(a)*(110+i%3*22)+'px');
    star.style.setProperty('--delay',i%4*.18+'s');scene.append(star);
  }
  for(let i=0;i<3;i++){
    const burst=document.createElement('span');burst.className='victory-firework';
    burst.style.setProperty('--fx',[-135,125,10][i]+'px');burst.style.setProperty('--fy',[-100,-65,135][i]+'px');burst.style.setProperty('--delay',i*.35+'s');
    burst.innerHTML='<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M50 8v20m0 44v20M8 50h20m44 0h20M20 20l14 14m32 32 14 14M20 80l14-14m32-32 14-14"/></g></svg>';scene.append(burst);
  }
  document.body.append(scene);setTimeout(()=>scene.remove(),4600);
}
function takeInWork(id){
  const m=mission(),match=Q.find(m.steps,id);if(!match||Q.isDone(match.node))return;
  const target=Q.nextAction({steps:[match.node]});if(!target)return;
  function promote(nodes){
    const index=nodes.findIndex(n=>n.id===id||n.children?.some(function contains(c){return c.id===id||c.children?.some(contains);}));
    if(index<0)return;
    const node=nodes.splice(index,1)[0];nodes.unshift(node);
    if(node.children?.length){node.collapsed=false;if(node.id!==id)promote(node.children);}
  }
  promote(m.steps);m.focusId=target.id;resetTimer();save();render();toast('Задачу взято в роботу й піднято на початок списку.');
}
function closeTaskMenus(except=null){
  $$('.task-menu').forEach(menu=>{if(menu===except)return;menu.querySelector('.task-actions').hidden=true;menu.querySelector('[data-menu]').setAttribute('aria-expanded','false');});
}
document.addEventListener?.('click',event=>{if(!event.target.closest('.task-menu'))closeTaskMenus();});
document.addEventListener?.('keydown',event=>{if(event.key==='Escape')closeTaskMenus();});
function updateParents(){Q.refreshTree(mission().steps);if(!Q.missionDone(mission()))delete mission().finalized;if(mission().focusId&&Q.nextAction(mission())?.id!==mission().focusId)delete mission().focusId;}
function toggle(id){
  const found=Q.find(mission().steps,id);if(!found||found.node.children?.length)return;
  const before=totalXP(), oldRewards=Q.rewards(before).unlocked.length;
  found.node.done=!found.node.done;if(found.node.done && mission().focusId===id)delete mission().focusId;updateParents();
  const gain=totalXP()-before, newRewards=Q.rewards(totalXP()).unlocked;
  if(gain>0){celebrate();toast(newRewards.length>oldRewards?`Відкрито артефакт: ${newRewards.at(-1).name}! +${gain} XP`:`Крок втілено! +${gain} XP · +${number(gain/5)} іскор`);}
  else toast(found.node.done?'Крок втілено. Прогрес оновлено.':'Виконання скасовано. Прогрес і нагороди перераховано.');
  resetTimer();save();render();
}
function finalize(id){
  const m=mission(), node=id===m.id?m:Q.find(m.steps,id)?.node;if(!node)return;
  const ready=node===m?Q.missionDone(m):Q.isDone(node);
  if(node===m&&!node.finalized&&!ready){toast('Спочатку заверши задачі проєкту.');return;}
  if(node!==m)Q.toggleGroupCompletion(node);
  else node.finalized=!node.finalized;
  updateParents();resetTimer();save();render();
}
function tools(node,index,length,depth){
  const focus=!Q.isDone(node)?`<button class="icon copy-step focus-step" data-focus="${esc(node.id)}">Взяти в роботу</button>`:'';
  return `<div class="step-tools">${focus}${depth<6?`<button class="icon copy-step child-step" data-child="${esc(node.id)}">＋ Підкрок</button>`:''}<button class="icon order-step" data-move="${esc(node.id)}" data-direction="-1" ${index===0?'disabled':''} aria-label="Підняти крок: ${esc(node.name)}">↑</button><button class="icon order-step" data-move="${esc(node.id)}" data-direction="1" ${index===length-1?'disabled':''} aria-label="Опустити крок: ${esc(node.name)}">↓</button><div class="task-menu"><button class="ghost small" data-menu="${esc(node.id)}" aria-label="Дії з кроком: ${esc(node.name)}" aria-expanded="false">⋯</button><div class="task-actions" hidden><button class="icon copy-step" data-transfer="${esc(node.id)}">Перемістити</button><button class="icon copy-step" data-copy="${esc(node.id)}">Копія</button><button class="icon copy-step" data-edit="${esc(node.id)}" aria-label="Редагувати крок: ${esc(node.name)}">Редагувати ✎</button><button class="icon copy-step" data-delete="${esc(node.id)}" aria-label="Видалити крок: ${esc(node.name)}">Видалити</button></div></div></div>`;
}
function renderSteps(steps,depth=0){
  return Q.ordered(steps).map(node=>{
    const index=steps.indexOf(node), group=!!node.children?.length, items=Q.leaves(node), done=items.filter(s=>s.done).length, symbol=['◇','○','—'][Math.min(depth,2)];
    return `<li class="step depth-${Math.min(depth,3)} ${Q.isDone(node)?'done':''} ${group?'step-group':''}" data-step-id="${esc(node.id)}" data-depth="${depth}">${group?`<button class="check marker" data-finalize="${esc(node.id)}" aria-pressed="${node.finalized===true}" aria-label="${node.finalized?'Скасувати остаточне завершення':'Остаточно завершити задачу'}: ${esc(node.name)}">${node.finalized?'✓':symbol}</button>`:`<button class="check marker" data-toggle="${esc(node.id)}" aria-pressed="${node.done}" aria-label="${node.done?'Скасувати виконання':'Завершити крок'}: ${esc(node.name)}">${node.done?'✓':symbol}</button>`}<div class="step-info"><div class="step-name">${group?`<button class="icon" data-collapse="${esc(node.id)}" aria-expanded="${!node.collapsed}" aria-label="${node.collapsed?'Розгорнути':'Згорнути'}: ${esc(node.name)}">${node.collapsed?'▸':'▾'}</button>`:''}${esc(node.name)}</div><div class="step-meta">${group?`${done} / ${items.length} дій · ${Q.earned(node)} / ${node.xp} XP`:`${node.minutes} хв · ${node.xp} XP${node.done?' · втілено':''}`}</div>${node.kind==='course'&&Q.isDone(node)?'<div class="course-award">✦ Відзнака за завершений курс</div>':''}</div>${tools(node,index,steps.length,depth)}${group?`<div class="group-progress"><div class="meter"><div style="width:${Math.round(done/items.length*100)}%"></div></div></div>${node.collapsed?'':`<ul class="step-children">${renderSteps(node.children,depth+1)}</ul>`}`:''}</li>`;
  }).join('');
}
function render(){
  state.missions.forEach(m=>{if(!Q.missionDone(m))delete m.finalized;});
  document.body.classList.toggle('light',state.theme==='light');
  const m=mission(),items=leaves(),done=items.filter(s=>s.done).length,next=nextStep(),xp=totalXP(),rewards=Q.rewards(xp);
  $('#tabs').innerHTML=Q.ordered(state.missions.filter(m=>!m.archived),m=>m.finalized===true&&Q.missionDone(m)).map(item=>{const tasks=leaves(item);return `<button class="${item.id===m?.id?'active':''} ${Q.missionDone(item)?'completed-mission':''}" data-mission="${esc(item.id)}">${state.missions.indexOf(item)+1}. ${esc(item.name)}<span>${tasks.filter(s=>s.done).length} / ${tasks.length} дій</span></button>`;}).join('')+'<button id="newMission" aria-label="Додати місію">＋ Місія</button>'+`<button id="openArchive">Архів (${state.missions.filter(m=>m.archived).length})</button><button id="openTrash">Кошик (${(state.trash||[]).filter(e=>e.deletedAt+Q.TRASH_TTL>Date.now()).length})</button>`;
  $('#mission').classList.toggle('mission-complete',!!m&&Q.missionDone(m));
  $('#mission').innerHTML=m?`<div class="mission-top"><div><span class="badge">${m.deadline?'ФІНІШ · '+esc(new Date(m.deadline+'T12:00:00').toLocaleDateString('uk-UA',{day:'numeric',month:'long'})):'У ВЛАСНОМУ ТЕМПІ'}</span><h2><button class="check marker" id="finalizeMission" aria-pressed="${m.finalized===true}" aria-label="${m.finalized?'Скасувати остаточне завершення':'Остаточно завершити проєкт'}: ${esc(m.name)}">${m.finalized?'✓':'◇'}</button> ${state.missions.indexOf(m)+1}. ${esc(m.name)}</h2><p class="sub" style="font-size:13px">${esc(m.goal)}</p></div><div class="section-actions"><button class="ghost small" id="archiveMission">В архів</button><button class="ghost small" id="deleteMission">Видалити проєкт</button><button class="ghost small" id="editMission">Редагувати</button><button class="ghost small" id="moveMission" ${m.steps.length?'':'disabled'}>Перемістити проєкт</button></div></div><div class="progress-label"><span>Шлях до результату</span><span>${done} із ${items.length} · ${items.length?Math.round(done/items.length*100):0}%</span></div><div class="meter"><div style="width:${items.length?done/items.length*100:0}%"></div></div>${next?`<div class="next"><div class="next-head"><span class="eyebrow">Твій наступний крок</span><span class="reward">${next.children?.length?'Підтвердь результат · XP уже за підкроки':`＋${next.xp} XP · ＋${number(next.xp/5)} іскор`}</span></div><h3>${esc(next.name)}</h3><p class="focus-status">${m.focusId===next.id?'Обрано тобою <button class="ghost small" id="clearFocus">Повернути автовибір</button>':'Автоматично: перша невиконана дія у списку'}</p><p><strong>Результат цього кроку:</strong> ${esc(next.result)}</p><div class="timerline"><span class="timer" id="timer">${timerStep===next.id?formatTime(remaining):formatTime(next.minutes*60)}</span><select id="duration" aria-label="Тривалість сету">${[...new Set([5,10,15,20,25,next.minutes])].sort((a,b)=>a-b).map(n=>`<option value="${n}" ${n===next.minutes?'selected':''}>${n} хв</option>`).join('')}</select><button class="ghost small" id="startTimer">${interval&&timerStep===next.id?'Пауза':'Почати сет'}</button></div><div class="actions"><button class="primary" id="completeNext">Крок виконано ✓</button><button class="ghost" id="delegate">Передати ChatGPT ↗</button><button class="ghost" id="overwhelmed">Крок завеликий</button></div><p class="hint">Бали — за результат. Підкроки ділять винагороду задачі; тривалість сету не збільшує бали.</p></div>`:items.length?`<div class="next"><div class="eyebrow">Місію завершено ✧</div><h3>Цю вершину взято!</h3><p>Поміть, що змінилося завдяки твоїм діям.</p><button class="primary" id="celebrate">Відсвяткувати ✨</button></div>`:`<div class="next"><h3>Перший крок до нової вершини</h3><p>Додай крок або створи серію лекцій.</p></div>`}<div class="section-title"><h3>Маршрут місії</h3><div class="section-actions"><button class="ghost small" id="addStep">＋ Додати крок</button><button class="ghost small" id="addSeries">Створити серію</button></div></div><ul class="steps">${renderSteps(m.steps)}</ul>`:'<h2>Немає активних проєктів</h2><p class="note">Створи місію або поверни проєкт з архіву.</p>';
  $('#level').textContent=`Рівень ${Math.floor(xp/200)+1} · ${xp<200?'Іскра наміру':xp<600?'Сила втілення':'Світло впливу'}`;
  $('#xp').textContent=`${xp%200} / 200 XP`;$('#xpbar').style.width=xp%200/2+'%';$('#coins').textContent=number(xp/5);$('#wins').textContent=state.missions.flatMap(leaves).filter(s=>s.done).length;
  const courses=state.missions.flatMap(item=>Q.allSteps(item.steps)).filter(s=>s.kind==='course'&&Q.isDone(s));
  const aura=Q.auraState(xp,rewards.unlocked.length+courses.length);
  $('#glow').setAttribute('r',aura.radius);$('#auraCenter').setAttribute('stop-opacity',aura.glowOpacity);$('#auraRings').setAttribute('opacity',aura.ringOpacity);$('#auraRings').setAttribute('stroke-width',aura.ringWidth);$('#auraRays').setAttribute('opacity',aura.rayOpacity);$('#auraSparks').setAttribute('opacity',aura.sparkOpacity);$('#auraCaption').textContent=aura.label;
  const visible=rewards.unlocked.slice(-8);
  $('#artifacts').innerHTML=visible.map(r=>`<div class="artifact unlocked" title="${r.threshold} XP"><b>${r.icon}</b><span>${esc(r.name)}</span></div>`).join('')+courses.slice(-3).map(c=>`<div class="artifact unlocked" title="Завершений курс"><b>✦</b><span>${esc(c.name)}</span></div>`).join('')+`<div class="artifact locked"><b>?</b><span>Таємний артефакт<br>${rewards.next} XP</span></div>`;
  $('#artifactHint').textContent=`Відкрито артефактів: ${rewards.unlocked.length+courses.length}. До наступного — ${rewards.next-xp} XP. Його вигляд і назва поки приховані.`;
  $('#allArtifacts')?.remove();
  if(rewards.unlocked.length>8||courses.length>3){$('#artifactHint').insertAdjacentHTML('afterend','<button class="ghost small" id="allArtifacts">Вся колекція</button>');$('#allArtifacts').onclick=()=>modal(`<h2>Твоя колекція</h2><div class="artifacts">${rewards.unlocked.map(r=>`<div class="artifact unlocked"><b>${r.icon}</b><span>${esc(r.name)}</span></div>`).join('')}${courses.map(c=>`<div class="artifact unlocked"><b>✦</b><span>${esc(c.name)}</span></div>`).join('')}</div><div class="dialog-actions"><button data-close>Закрити</button></div>`);}
  bind();
}
function xpOptions(value=50){return [...new Set([25,50,100,200,value])].sort((a,b)=>a-b).map(n=>`<option value="${n}" ${n===value?'selected':''}>${n} XP${({25:' · підтримувальна дія',50:' · звичайний результат',100:' · важливий результат',200:' · ключовий результат'})[n]||' · власне значення'}</option>`).join('');}
function stepEditor(id,{copyId=null,parentId=null}={}){
  const match=Q.find(mission().steps,id),s=match?.node,sourceMatch=Q.find(mission().steps,copyId),source=sourceMatch?.node;
  const parent=parentId?Q.find(mission().steps,parentId)?.node:sourceMatch?.parent;
  if(parentId&&!parent.children?.length&&Q.isDone(parent)){toast('Щоб розділити завершений крок, спочатку скасуй його виконання.');return;}
  const draft=source||s, allocated=!!(parent||match?.parent), locked=!!(s&&Q.hasDone(s));
  modal(`<h2>${source?'Скопіювати крок':parentId?'Новий підкрок':s?'Редагувати крок':'Новий крок'}</h2>${parent?`<p class="note">До задачі «${esc(parent.name)}». Підкроки ділять її ${parent.xp} XP. Зароблені частки зберігаються; нові дії ділять залишок.</p>`:''}<form id="stepForm"><label for="stepName">Назва дії</label><input id="stepName" required maxlength="500" value="${esc(draft?.name||'')}"><label for="stepResult">Що має бути готово</label><textarea id="stepResult" required maxlength="10000">${esc(draft?.result||'')}</textarea><label for="stepMinutes">Сет, хвилин</label><input id="stepMinutes" type="number" min="1" max="120" required value="${draft?.minutes||10}">${allocated?'<p class="note">Бали підкроку визначаються загальною винагородою задачі.</p>':`<label for="stepXP">Внесок у результат</label><select id="stepXP" ${locked?'disabled':''}>${xpOptions(draft?.xp||50)}</select><p class="note">Початкова шкала: 25 / 50 / 100 / 200 XP. Важливіший результат — більша винагорода.${locked?' Щоб змінити бали, спочатку скасуй виконання дій цієї задачі.':''}</p>`}<div class="dialog-actions"><button type="button" data-close>Скасувати</button><button class="primary">Зберегти</button></div></form>`);
  $('#stepForm').onsubmit=e=>{
    e.preventDefault();const v={name:$('#stepName').value.trim(),result:$('#stepResult').value.trim(),minutes:Number($('#stepMinutes').value)};
    if(!v.name||!v.result)return;
    if(s){Object.assign(s,v);if(!allocated&&!locked){s.xp=Number($('#stepXP').value);Q.distribute(s);}}
    else{
      const newNode=source?Q.copyStep(source,uid()):{id:uid(),done:false};Object.assign(newNode,v);newNode.xp=allocated?0:Number($('#stepXP').value);
      if(parentId){parent.children??=[];parent.children.push(newNode);Q.distribute(parent);}
      else if(source){sourceMatch.siblings.splice(sourceMatch.siblings.indexOf(source)+1,0,newNode);if(parent)Q.distribute(parent);else Q.distribute(newNode);}
      else mission().steps.push(newNode);
      if(newNode.xp===0)toast('Підкрок створено без додаткових XP: загальна винагорода вже розподілена між розпочатими або виконаними діями.');
    }
    updateParents();finishEdit();
  };

}
function seriesEditor(){
  modal(`<h2>Створити серію</h2><p class="note">Курс → лекції → дії. За весь курс — окрема відзнака; XP нараховуються лише за дії.</p><form id="seriesForm"><label for="courseName">Назва курсу або великої задачі</label><input id="courseName" required maxlength="500" placeholder="Пройти курс COO"><div class="form-grid"><div><label for="lectureCount">Кількість лекцій</label><input id="lectureCount" type="number" min="1" max="100" value="15" required></div><div><label for="lectureXP">Винагорода за одну лекцію</label><select id="lectureXP">${xpOptions(50)}</select></div></div><label for="lectureTemplate">Шаблон назви: {n} — номер</label><input id="lectureTemplate" required value="Лекція {n}" maxlength="500"><label for="lectureActions">Дії для кожної лекції — по одній у рядку</label><textarea id="lectureActions" required>Переглянути\nЗробити нотатки / опрацювати матеріали</textarea><label for="seriesMinutes">Сет для дії, хвилин</label><input id="seriesMinutes" type="number" min="1" max="120" value="20" required><p class="note" id="seriesSummary"></p><div class="dialog-actions"><button type="button" data-close>Скасувати</button><button class="primary">Створити серію</button></div></form>`);
  function summary(){const n=Number($('#lectureCount').value)||0;$('#seriesSummary').textContent=`Загальна винагорода: ${n*Number($('#lectureXP').value)} XP. Кожна лекція ділить свої бали між її діями.`;}
  $('#lectureCount').oninput=summary;$('#lectureXP').onchange=summary;summary();
  $('#seriesForm').onsubmit=e=>{
    e.preventDefault();const count=Number($('#lectureCount').value),actions=$('#lectureActions').value.split('\n').map(s=>s.trim()).filter(Boolean),name=$('#courseName').value.trim(),template=$('#lectureTemplate').value.trim(),perLecture=Number($('#lectureXP').value),minutes=Number($('#seriesMinutes').value);
    if(!name||!template||!actions.length||actions.length>10||!Number.isInteger(count)||count<1||count>100){toast('Вкажи назву, від 1 до 100 лекцій та від 1 до 10 дій.');return;}
    const course={id:uid(),name,result:'Завершити всі лекції та дії курсу.',minutes,done:false,kind:'course',xp:count*perLecture,children:Array.from({length:count},(_,i)=>({id:uid(),name:template.includes('{n}')?template.replaceAll('{n}',String(i+1)):template+' '+(i+1),result:'Виконати дії лекції.',minutes,done:false,collapsed:true,xp:perLecture,children:actions.map(action=>({id:uid(),name:action,result:action,minutes,done:false,xp:0}))}))};
    Q.distribute(course);mission().steps.push(course);finishEdit();toast(`Створено ${count} лекцій і ${count*actions.length} дій. Бали — після виконання.`);
  };
}
function missionEditor(isNew=false){
  const m=isNew?{}:mission();modal(`<h2>${isNew?'Нова місія':'Налаштування місії'}</h2><form id="missionForm"><label for="missionName">Назва</label><input id="missionName" required maxlength="500" value="${esc(m.name||'')}"><label for="missionGoal">Бажаний результат</label><textarea id="missionGoal" required>${esc(m.goal||'')}</textarea><label for="missionDeadline">Орієнтовний фініш</label><input id="missionDeadline" type="date" value="${esc(m.deadline||'')}"><div class="dialog-actions"><button type="button" data-close>Скасувати</button><button class="primary">Зберегти</button></div></form>`);
  $('#missionForm').onsubmit=e=>{e.preventDefault();const v={name:$('#missionName').value.trim(),goal:$('#missionGoal').value.trim(),deadline:$('#missionDeadline').value};if(!v.name||!v.goal)return;if(isNew){const id=uid();state.missions.push({...v,id,steps:[]});state.active=id;}else Object.assign(m,v);finishEdit();};
}
function storeProjectChange(draft){
  if(persistenceBlocked){toast(startupError);return false;}
  try{Q.validate(draft);writeBackup('-before-project-change',JSON.stringify(state));localStorage.setItem(KEY,JSON.stringify(draft));}
  catch{toast('Не вдалося зберегти зміну. Поточні проєкти залишилися без змін.');return false;}
  state=draft;resetTimer();$('#modal').close();render();return true;
}
function archiveProject(id){
  const m=state.missions.find(m=>m.id===id);if(!m||m.archived)return;
  const draft=structuredClone(state);draft.missions.find(m=>m.id===id).archived=true;
  if(draft.active===id)draft.active=draft.missions.find(m=>!m.archived)?.id||null;
  if(storeProjectChange(draft))toast('Проєкт в архіві. Усі кроки й XP збережено.');
}
function restoreProject(id){
  const draft=structuredClone(state),m=draft.missions.find(m=>m.id===id);if(!m)return;
  delete m.archived;draft.active=id;
  if(storeProjectChange(draft))toast('Проєкт повернуто в активні.');
}
function deleteProject(id){
  const m=state.missions.find(m=>m.id===id);if(!m)return;
  confirmRemoval(`Перемістити проєкт «${m.name}» разом з усіма кроками в кошик на 7 днів? Можна буде відновити.`,()=>{
    try{if(storeProjectChange(Q.trashItem(state,id)))toast(`Проєкт «${m.name}» у кошику на 7 днів.`);}catch(e){toast(e.message);}
  });

}
function showTrash(){
  const entries=(state.trash||[]).filter(e=>e.deletedAt+Q.TRASH_TTL>Date.now());
  modal(`<h2>Кошик</h2><p class="note">Видалені елементи зберігаються 7 днів. Бали повертаються разом із відновленими діями.</p>${entries.length?entries.map(e=>`<div class="archive-item"><h3>${esc(e.node.name)}</h3><p class="note">${e.kind==='project'?'Проєкт':`Крок · ${esc(e.missionName)}${e.parentName?' → '+esc(e.parentName):''}`}<br>Видалено: ${new Date(e.deletedAt).toLocaleString('uk-UA')}<br>Зберігається до: ${new Date(e.deletedAt+Q.TRASH_TTL).toLocaleString('uk-UA')}</p><button data-trash-restore="${esc(e.id)}">Відновити</button></div>`).join(''):'<p>Кошик порожній.</p>'}<p class="note">Елементи, видалені до появи кошика, можуть залишитися в попередніх копіях у розділі «Дані».</p><div class="dialog-actions"><button data-close>Закрити</button></div>`);
  $$('[data-trash-restore]').forEach(b=>b.onclick=()=>{try{if(storeProjectChange(Q.restoreTrash(state,b.dataset.trashRestore)))toast('Елемент відновлено з прогресом і XP.');}catch(e){toast(e.message);}});
}
function showArchive(){
  const archived=state.missions.filter(m=>m.archived);
  modal(`<h2>Архів</h2>${archived.length?archived.map(m=>`<div class="archive-item"><h3>${esc(m.name)}</h3><p class="note">${leaves(m).length} дій · ${m.steps.reduce((sum,n)=>sum+Q.earned(n),0)} XP</p><div class="actions"><button data-view-archive="${esc(m.id)}">Переглянути</button><button data-restore="${esc(m.id)}">Повернути в активні</button><button data-delete-project="${esc(m.id)}">Видалити</button></div></div>`).join(''):'<p>Архів поки порожній.</p>'}<div class="dialog-actions"><button data-close>Закрити</button></div>`);
  $$('[data-view-archive]').forEach(b=>b.onclick=()=>viewArchive(b.dataset.viewArchive));
  $$('[data-restore]').forEach(b=>b.onclick=()=>restoreProject(b.dataset.restore));
  $$('[data-delete-project]').forEach(b=>b.onclick=()=>deleteProject(b.dataset.deleteProject));
}
function viewArchive(id){
  const m=state.missions.find(m=>m.id===id&&m.archived);if(!m)return;
  function tree(nodes){return `<ul class="archive-tree">${nodes.map(n=>`<li><span>${Q.isDone(n)?'✓ ':''}${esc(n.name)}</span><p class="note">${esc(n.result)} · ${Q.earned(n)} XP</p>${n.children?.length?tree(n.children):''}</li>`).join('')}</ul>`;}
  modal(`<h2>${esc(m.name)}</h2><p>${esc(m.goal)}</p>${tree(m.steps)}<div class="dialog-actions"><button id="backArchive">До архіву</button><button id="restoreArchive">Повернути в активні</button><button data-close>Закрити</button></div>`);
  $('#backArchive').onclick=showArchive;$('#restoreArchive').onclick=()=>restoreProject(id);
}
function delegate(){
  const m=mission(),s=nextStep();if(!s)return;
  const prompt=`Допоможи виконати крок моєї місії «${m.name}».\nЗагальний результат: ${m.goal}\nПоточний крок: ${s.name}\nОчікую отримати: ${s.result}\n\nВізьми на себе максимум підготовчої та виконавчої роботи. Спочатку коротко вкажи, що зробиш сам і яке одне рішення або матеріал потрібні від мене. Не вигадуй факти; використовуй актуальні файли, якщо вони доступні. Працюй до конкретного результату, придатного до перевірки. Мій сет участі — ${s.minutes} хвилин. Якщо задача більша, виділи найменший завершений результат і познач залишок.\n\nМої матеріали / уточнення: `;
  modal(`<h2>Передати роботу ChatGPT</h2><p class="note">Скопіюй запит у чат і додай матеріали. Ця кнопка готує передачу; робота почнеться в чаті.</p><label for="promptText">Запит</label><textarea id="promptText" style="min-height:260px">${esc(prompt)}</textarea><div class="dialog-actions"><button data-close>Закрити</button><button class="primary" id="copyPrompt">Скопіювати запит</button></div>`);$('#copyPrompt').onclick=()=>copyText($('#promptText'));
}
function transferEditor(sourceId){
  const whole=state.missions.find(m=>m.id===sourceId), from=whole||state.missions.find(m=>Q.find(m.steps,sourceId));
  const match=whole?null:Q.find(from.steps,sourceId), node=whole||match.node;
  const excluded=new Set(whole?Q.allSteps(whole.steps).map(n=>n.id):Q.allSteps([node]).map(n=>n.id));
  const options=[];
  for(const m of state.missions.filter(m=>!m.archived)){
    if(whole&&m.id===whole.id)continue;
    if(whole||m!==from||match.parent)options.push({mid:m.id,pid:null,label:m.name+' → основний список'});
    function visit(nodes,path=[]){for(const n of nodes){
      const next=[...path,n.name];
      if(!excluded.has(n.id)&&!(n.done&&!n.children?.length)&&match?.parent?.id!==n.id)options.push({mid:m.id,pid:n.id,label:[m.name,...next].join(' → ')});
      if(!excluded.has(n.id))visit(n.children||[],next);
    }}
    visit(m.steps);
  }
  modal(`<h2>Перемістити ${whole?'проєкт':'задачу'}</h2><p>${esc(node.name)}</p><p class="note">Разом із підкроками та виконанням. Уже зароблені XP не зміняться. ${whole?'Проєкт після перенесення стане задачею всередині обраного місця.':''}</p><label for="transferTarget">Куди перемістити</label><select id="transferTarget"><option value="">Обери місце</option>${options.map((o,i)=>`<option value="${i}">${esc(o.label)}</option>`).join('')}</select><p class="note" id="transferPreview"></p><p class="inline-error" id="transferError" role="alert"></p><div class="dialog-actions"><button data-close>Скасувати</button><button class="primary" id="confirmTransfer" disabled>Перемістити</button></div>`);
  if(!options.length)$('#transferPreview').textContent='Немає іншого місця. Спочатку створи проєкт або незавершену задачу.';
  let selection=null;
  $('#transferTarget').onchange=()=>{
    selection=null;$('#confirmTransfer').disabled=true;$('#transferError').textContent='';$('#transferPreview').textContent='';
    if($('#transferTarget').value==='')return;
    const o=options[Number($('#transferTarget').value)];
    try{
      Q.transfer(state,sourceId,o.mid,o.pid);selection=o;$('#confirmTransfer').disabled=false;
      const target=o.pid?Q.find(state.missions.find(m=>m.id===o.mid).steps,o.pid)?.node:null;
      $('#transferPreview').textContent=target&&!target.children?.length?'Обрана дія стане групою. Її винагорода визначатиметься сумою перенесених підкроків; окремих балів за заголовок не буде.':'Збережуться бали перенесених дій. Винагорода груп дорівнюватиме сумі їхніх підкроків.';
    }catch(e){$('#transferError').textContent=e.message;}
  };
  $('#confirmTransfer').onclick=()=>{
    if(!selection)return;
    try{
      if(persistenceBlocked)throw Error(startupError);
      const next=Q.transfer(state,sourceId,selection.mid,selection.pid);
      writeBackup('-before-transfer',JSON.stringify(state));
      localStorage.setItem(KEY,JSON.stringify(next));state=next;
      resetTimer();$('#modal').close();render();toast('Перенесено. Виконання та зароблені XP збережено.');
    }catch(e){$('#transferError').textContent=e.message;}
  };
}
async function copyText(input){try{await navigator.clipboard.writeText(input.value);toast('Текст скопійовано.');}catch{input.focus();input.select();toast('Текст виділено. Скористайся командою «Копіювати».');}}
function bind(){
  $$('[data-menu]').forEach(b=>b.onclick=()=>{const actions=b.parentElement.querySelector('.task-actions');closeTaskMenus(b.parentElement);actions.hidden=!actions.hidden;b.setAttribute('aria-expanded',String(!actions.hidden));});
  if($('#moveMission'))$('#moveMission').onclick=()=>transferEditor(mission().id);
  $('#openArchive').onclick=showArchive;
  $('#openTrash').onclick=showTrash;
  if($('#archiveMission'))$('#archiveMission').onclick=()=>archiveProject(mission().id);
  if($('#deleteMission'))$('#deleteMission').onclick=()=>deleteProject(mission().id);
  $$('[data-delete]').forEach(b=>b.onclick=()=>deleteStep(b.dataset.delete));
  $$('[data-transfer]').forEach(b=>b.onclick=()=>transferEditor(b.dataset.transfer));
  $$('[data-focus]').forEach(b=>b.onclick=()=>takeInWork(b.dataset.focus));
  if($('#clearFocus'))$('#clearFocus').onclick=()=>{delete mission().focusId;resetTimer();save();render();};
  $$('[data-mission]').forEach(b=>b.onclick=()=>{resetTimer();state.active=b.dataset.mission;save();render();});
  $('#newMission').onclick=()=>missionEditor(true);if($('#editMission'))$('#editMission').onclick=()=>missionEditor();if($('#addStep'))$('#addStep').onclick=()=>stepEditor();if($('#addSeries'))$('#addSeries').onclick=seriesEditor;
  if($('#finalizeMission'))$('#finalizeMission').onclick=()=>finalize(mission().id);
  $$('[data-finalize]').forEach(b=>b.onclick=()=>finalize(b.dataset.finalize));
  $$('[data-toggle]').forEach(b=>b.onclick=()=>toggle(b.dataset.toggle));$$('[data-edit]').forEach(b=>b.onclick=()=>stepEditor(b.dataset.edit));$$('[data-copy]').forEach(b=>b.onclick=()=>stepEditor(undefined,{copyId:b.dataset.copy}));$$('[data-child]').forEach(b=>b.onclick=()=>stepEditor(undefined,{parentId:b.dataset.child}));
  $$('[data-collapse]').forEach(b=>b.onclick=()=>{const node=Q.find(mission().steps,b.dataset.collapse).node;node.collapsed=!node.collapsed;save();render();});
  $$('[data-move]').forEach(b=>b.onclick=()=>{const match=Q.find(mission().steps,b.dataset.move);if(Q.moveStep(match.siblings,b.dataset.move,Number(b.dataset.direction))){resetTimer();save();render();$$('[data-move]').find(x=>x.dataset.move===b.dataset.move&&x.dataset.direction===b.dataset.direction)?.focus();}});
  const next=nextStep();if(next){
    $('#completeNext').onclick=()=>toggle(next.id);$('#delegate').onclick=delegate;$('#overwhelmed').onclick=()=>stepEditor(undefined,{parentId:next.id});
    $('#duration').onchange=e=>{next.minutes=Number(e.target.value);resetTimer();save();render();};
    $('#startTimer').onclick=()=>{if(interval){stopTimer();render();return;}if(timerStep!==next.id||remaining<=0){remaining=next.minutes*60;timerStep=next.id;}const end=Date.now()+remaining*1000;interval=setInterval(()=>{remaining=Math.max(0,Math.ceil((end-Date.now())/1000));if($('#timer'))$('#timer').textContent=formatTime(remaining);if(!remaining){stopTimer();render();toast('Сет завершився. Перевір результат або обери менший крок.');}},250);render();};
  }else if($('#celebrate'))$('#celebrate').onclick=celebrateProject;
}
function showData(){
  if(exportURL)URL.revokeObjectURL(exportURL);
  backupURLs.forEach(url=>URL.revokeObjectURL(url));backupURLs=[];
  const text=JSON.stringify(state,null,2);exportURL=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
  modal(`<h2>Твої дані</h2><p class="note">Прогрес зберігається в цьому браузері. Для перенесення між пристроями збережи JSON, потім завантаж його на іншому пристрої.</p><h3>Зберегти копію</h3><a class="file-download" id="export" download="${backupFilename(new Date().toISOString()).replace('backup','progress')}" href="${exportURL}">Зберегти JSON-файл ↓</a><details><summary>Якщо файл не зберігається — скопіювати JSON</summary><textarea class="data-text" id="exportText" readonly aria-label="JSON для копіювання">${esc(text)}</textarea><button class="small" id="copyJSON">Скопіювати JSON</button></details><h3>Завантажити збережений прогрес</h3><label for="importFile">Обрати файл прогресу (.json)</label><input class="file-input" type="file" id="importFile" aria-describedby="fileHelp"><p class="note" id="fileHelp">Натисни стандартну кнопку вибору файла вище. Якщо вбудований переглядач не відкриває вікно вибору, відкрий цю адресу у Chrome через меню переглядача або встав JSON текстом нижче. В іншому браузері прогрес зберігається окремо.</p><details><summary>Або вставити JSON текстом</summary><label for="importText">JSON із твоєї копії</label><textarea class="data-text" id="importText" placeholder="Встав сюди вміст файла"></textarea><button class="small" id="readJSON">Перевірити JSON</button></details><p class="inline-error" id="importError" role="alert"></p><div id="importPreview"></div><p class="note" id="dataStatus"></p><div class="dialog-actions"><button data-close>Закрити</button></div>`);
  $('#export').onclick=()=>{$('#dataStatus').textContent='Якщо браузер не зберіг файл, розкрий «Скопіювати JSON» та збережи текст вручну.';};
  $('#copyJSON').onclick=()=>copyText($('#exportText'));
  const copies=BACKUP_LABELS.map(([suffix,label])=>{const key=KEY+suffix;return {key,label,raw:localStorage.getItem(key),createdAt:localStorage.getItem(key+'-created-at')};}).filter(copy=>copy.raw).sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
  const links=[];
  for(const copy of copies){
    try{const url=URL.createObjectURL(new Blob([copy.raw],{type:'application/json'}));backupURLs.push(url);const dated=copy.createdAt&&!Number.isNaN(Date.parse(copy.createdAt));links.push(`<p class="note"><a download="${dated?backupFilename(copy.createdAt):'vershyna-backup-date-unknown.json'}" href="${url}">${esc(copy.label)} · ${dated?backupStamp(copy.createdAt)+' (Київ)':'дату створення не збережено'} ↓</a></p>`);}catch{}
  }
  $('#dataStatus').insertAdjacentHTML('afterend',links.join(''));
  $('#importFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>8*1024*1024){showImportError('Файл завеликий: максимум 8 МБ.');return;}try{prepareImport(await file.text());}catch{showImportError('Не вдалося прочитати файл. Спробуй вставити його вміст текстом.');}e.target.value='';};
  $('#readJSON').onclick=()=>prepareImport($('#importText').value);
}
function showImportError(message){$('#importError').textContent=message;$('#importPreview').innerHTML='';}
function prepareImport(text){
  try{
    if(text.length>8*1024*1024)throw Error('Завеликий JSON: максимум 8 МБ.');
    const imported=Q.normalize(migrateState(Q.validate(JSON.parse(text.replace(/^\uFEFF/,'')))));Q.validate(imported);
    if(!imported.missions.some(m=>m.id===imported.active))imported.active=imported.missions[0]?.id||null;
    const tasks=imported.missions.flatMap(leaves);$('#importError').textContent='';
    $('#importPreview').innerHTML=`<div class="import-preview"><strong>Файл перевірено</strong><p class="note">Місій: ${imported.missions.length}. Дій: ${tasks.length}. Виконано: ${tasks.filter(s=>s.done).length}.<br>Це замінить поточний прогрес у цьому браузері. Перед заміною буде збережено локальну копію.</p><button class="primary small" id="confirmImport">Замінити прогрес цими даними</button></div>`;
    $('#confirmImport').onclick=()=>{
      try{const current=localStorage.getItem(KEY);if(current)writeBackup('-before-import',current);localStorage.setItem(KEY,JSON.stringify(imported));}
      catch{showImportError('Браузер не дозволив зберегти дані. Поточний прогрес не замінено. Звільни місце або відкрий застосунок у звичайному браузері.');return;}
      state=imported;persistenceBlocked=false;startupError='';resetTimer();$('#modal').close();render();toast('Прогрес імпортовано й збережено.');
    };
  }catch(error){showImportError(error instanceof SyntaxError?'Не вдалося прочитати JSON. Обери файл експорту «Вершини» або перевір вставлений текст.':error.message);}
}
$('#theme').onclick=()=>{state.theme=state.theme==='light'?'dark':'light';save();render();};
$('#settings').onclick=showData;
$('#checkin').onclick=()=>{
  modal('<h2>Почнемо з посильного.</h2><p>Скільки уваги зараз є для одного кроку?</p><div class="actions"><button data-energy="5">5 хв · м’який старт</button><button data-energy="10">10 хв · у роботу</button><button data-energy="20">20 хв · є ресурс</button></div><p class="note">Обери один результат. Підготовку можна передати через «Передати ChatGPT».</p><div class="dialog-actions"><button data-close>Закрити</button></div>');
  $$('[data-energy]').forEach(b=>b.onclick=()=>{const next=nextStep();if(next){next.minutes=Number(b.dataset.energy);resetTimer();save();render();}$('#modal').close();});
};
$('#date').textContent=new Date().toLocaleDateString('uk-UA',{weekday:'long',day:'numeric',month:'long'});
render();if(startupError)toast(startupError);
