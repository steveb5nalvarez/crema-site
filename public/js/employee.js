// /js/employee.js
const TZ = 'Europe/Rome';
let EMP = null;          // mi fila en employees
let MY_SHIFTS = [];
let CAL = null;
let MY_EMP_ID = null;

// ====== UTILS TIEMPO ======
function nowInMilan() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(now).reduce((a,p)=>(a[p.type]=p.value,a),{});
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`);
}
function todayISOInMilan() {
  const d = nowInMilan();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dtInMilan(dateStr, timeHHMM) {
  const base = new Date(`${dateStr}T${timeHHMM}:00`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }).formatToParts(base).reduce((a,p)=>(a[p.type]=p.value,a),{});
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`);
}
function diffHours(hhmmA, hhmmB, breakH=0.5){
  const [ah,am]=hhmmA.split(':').map(Number); const [bh,bm]=hhmmB.split(':').map(Number);
  return Math.max(0, (bh*60+bm - (ah*60+am))/60 - breakH);
}
function formatMonthLabel() {
  return new Intl.DateTimeFormat('it-IT',{month:'long',year:'numeric', timeZone:TZ}).format(nowInMilan());
}
function initials(name=''){ return name.trim().split(/\s+/).slice(0,2).map(p=>p[0]?.toUpperCase()||'').join(''); }

// ====== ARRANQUE ======
document.addEventListener('DOMContentLoaded', async () => {
  await ensureSession();
  await loadMe();
  startRealtime();
});

// ====== AUTH / SESSION ======
async function ensureSession(){
  const { data: { session } } = await supabase.auth.getSession();
  if(!session){
    // redirige al login si no hay sesión
    location.href = '/index.html';
    return;
  }
}
window.logout = async function(){
  await supabase.auth.signOut();
  location.href = '/index.html';
};

// ====== CARGA PERFIL Y EMPLEADO ======
async function loadMe(){
  // mi empleado por user_id
  const { data: empArr, error: e1 } = await supabase
    .from('employees')
    .select('id,name,email,department,role,weekly_hours,user_id')
    .eq('user_id',(await supabase.auth.getUser()).data.user?.id)
    .limit(1);
  if(e1){ console.error(e1); return; }
  EMP = empArr?.[0];
  if(!EMP){ alert('Non troviamo il tuo profilo dipendente.'); return; }
  MY_EMP_ID = EMP.id;

  // perfil (avatar/nombre)
  const { data: prof, error: e2 } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, role_label')
    .eq('user_id', EMP.user_id).maybeSingle();
  const displayName = prof?.full_name || EMP.name || '—';
  const displayRole = prof?.role_label || EMP.role || '—';
  document.getElementById('empName').textContent = displayName;
  document.getElementById('empRole').textContent = displayRole;
  document.getElementById('weeklyHours').textContent = EMP.weekly_hours ?? '—';

  // avatar
  const avatarImg = document.getElementById('avatarImg');
  const avatarInit = document.getElementById('avatarInitials');
  const avatarBox = document.getElementById('avatarBox');
  avatarInit.textContent = initials(displayName) || 'EC';
  if(prof?.avatar_url){
    avatarImg.src = prof.avatar_url;
    avatarImg.classList.remove('hidden');
    avatarInit.classList.add('hidden');
    avatarBox.classList.add('hidden');
  } else {
    avatarInit.classList.remove('hidden');
  }

  // carga turnos + renders
  await loadMyShifts();
  await renderMonthHours();

  // preparar select de swap
  await populateSwapSelects();

  // cargar lista de swaps (donde soy requester o partner)
  await loadMySwaps();

  // lista de compañeros para chat
  await loadCoworkers();
}

// ====== TURNOS ======
async function loadMyShifts(){
  const { data, error } = await supabase
    .from('shifts')
    .select('id,date,start_time,end_time,role')
    .eq('employee_id', MY_EMP_ID)
    .order('date', { ascending: true });
  if(error){ console.error(error); return; }
  MY_SHIFTS = data || [];
  renderToday();
  renderCalendar();
  renderMonthLabel();
}

function renderToday(){
  const ul = document.getElementById('todayShift');
  const today = todayISOInMilan();
  const list = MY_SHIFTS.filter(s=>s.date===today);
  if(list.length===0){ ul.innerHTML = '<li>Nessun turno oggi.</li>'; }
  else {
    ul.innerHTML = list.map(s=>`<li>${s.date} ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)} (${s.role||''})</li>`).join('');
  }
  renderNow();
}

function renderNow(){
  const p = document.getElementById('nowStatus');
  const now = nowInMilan();
  const today = todayISOInMilan();
  const curr = MY_SHIFTS.filter(s=>s.date===today).find(s=>{
    const a=dtInMilan(s.date, s.start_time.slice(0,5));
    const b=dtInMilan(s.date, s.end_time.slice(0,5));
    return now>=a && now<b;
  });
  p.textContent = curr ? `Sì, fino alle ${curr.end_time.slice(0,5)}` : 'No, non sei in turno adesso.';
}

function renderCalendar(){
  const el = document.getElementById('calendar');
  const events = MY_SHIFTS.map(s=>({
    id:String(s.id),
    title:`Turno ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`,
    start:s.date, allDay:true
  }));
  if(!CAL){
    CAL = new FullCalendar.Calendar(el,{
      initialView:'dayGridMonth', locale:'it', height:500,
      initialDate: todayISOInMilan(),
      events:[]
    });
    CAL.render();
  }
  CAL.removeAllEvents();
  CAL.addEventSource(events);
}
function renderMonthLabel(){
  document.getElementById('currentMonthLabel').textContent = formatMonthLabel();
}

async function renderMonthHours(){
  const now = nowInMilan();
  const y = now.getFullYear(), m = now.getMonth()+1;
  const start = `${y}-${String(m).padStart(2,'0')}-01`;
  const endDay = new Date(y,m,0).getDate();
  const end = `${y}-${String(m).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`;

  const { data, error } = await supabase
    .from('shifts')
    .select('start_time,end_time,date')
    .eq('employee_id', MY_EMP_ID)
    .gte('date', start).lte('date', end);
  if(error){ console.error(error); return; }
  const total = (data||[]).reduce((sum,s)=> sum + diffHours(s.start_time, s.end_time, 0.5), 0);
  document.getElementById('monthHours').textContent = total.toFixed(1);
}

// ====== SWAPS ======
async function populateSwapSelects(){
  // mis turnos (próximos 30 días)
  const today = todayISOInMilan();
  const { data: mine } = await supabase
    .from('shifts')
    .select('id,date,start_time,end_time,role')
    .eq('employee_id', MY_EMP_ID)
    .gte('date', today)
    .order('date');

  // turnos de otros (próximos 30 días)
  const { data: others } = await supabase
    .from('shifts')
    .select('id,date,start_time,end_time,role, employee_id, employees(name)')
    .neq('employee_id', MY_EMP_ID)
    .gte('date', today)
    .order('date');

  const mySel = document.getElementById('myShiftSelect');
  const partnerSel = document.getElementById('partnerShiftSelect');

  mySel.innerHTML = (mine||[]).map(s=>`
    <option value="${s.id}">${s.date} ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)} (${s.role||''})</option>
  `).join('') || '<option value="">Nessun turno</option>';

  partnerSel.innerHTML = (others||[]).map(s=>`
    <option value="${s.id}" data-emp="${s.employee_id}">
      ${s.date} ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)} — ${s.employees?.name||'collega'}
    </option>
  `).join('') || '<option value="">Nessun turno disponibile</option>';

  document.getElementById('btnProposeSwap').onclick = async ()=>{
    const from_shift_id = Number(mySel.value);
    const to_shift_id = Number(partnerSel.value);
    if(!from_shift_id || !to_shift_id){ alert('Seleziona entrambi i turni.'); return; }
    const partner_id = Number(partnerSel.options[partnerSel.selectedIndex].dataset.emp);
    const note = document.getElementById('swapNote').value.trim();

    const { error } = await supabase.from('shift_swaps').insert([{ 
      from_shift_id, to_shift_id, requester_id: MY_EMP_ID, partner_id, note 
    }]);
    if(error){ alert('Errore proposta: '+error.message); return; }
    alert('Proposta inviata!');
    await loadMySwaps();
  };
}

async function loadMySwaps(){
  const { data, error } = await supabase
    .from('shift_swaps')
    .select(`
      id, from_shift_id, to_shift_id, requester_id, partner_id, partner_accepted, manager_approved, status, note, updated_at,
      from_shift:from_shift_id (id, date, start_time, end_time, employees(name)),
      to_shift:to_shift_id     (id, date, start_time, end_time, employees(name))
    `)
    .or(`requester_id.eq.${MY_EMP_ID},partner_id.eq.${MY_EMP_ID}`)
    .order('updated_at', { ascending:false });
  if(error){ console.error(error); return; }

  const ul = document.getElementById('swapList');
  ul.innerHTML = (data||[]).map(sw=>{
    const mineIsRequester = sw.requester_id === MY_EMP_ID;
    const labelA = `${sw.from_shift?.date} ${sw.from_shift?.start_time?.slice(0,5)}–${sw.from_shift?.end_time?.slice(0,5)} (${sw.from_shift?.employees?.name||''})`;
    const labelB = `${sw.to_shift?.date} ${sw.to_shift?.start_time?.slice(0,5)}–${sw.to_shift?.end_time?.slice(0,5)} (${sw.to_shift?.employees?.name||''})`;

    let actions = '';
    if(!sw.partner_accepted && sw.partner_id === MY_EMP_ID){
      actions = `<button data-accept="${sw.id}" class="text-blue-700 underline">Accetta</button> 
                 <button data-reject="${sw.id}" class="text-red-600 underline">Rifiuta</button>`;
    } else if(mineIsRequester && sw.status==='pending'){
      actions = `<span class="text-xs text-gray-500">In attesa del collega…</span>`;
    } else if(sw.status==='partner_accepted'){
      actions = `<span class="text-xs text-gray-500">In attesa dell'approvazione del manager</span>`;
    } else if(sw.status==='approved'){
      actions = `<span class="text-green-700 font-semibold">Approvato ✅</span>`;
    } else if(sw.status==='rejected'){
      actions = `<span class="text-red-600 font-semibold">Rifiutato ❌</span>`;
    }

    return `<li class="border rounded p-2">
      <div class="font-medium">Scambio: <span class="text-gray-700">${labelA}</span> ⇄ <span class="text-gray-700">${labelB}</span></div>
      <div class="text-xs text-gray-500">Stato: ${sw.status}${sw.partner_accepted ? ' (accettato dal collega)' : ''}</div>
      ${sw.note ? `<div class="text-xs text-gray-500">Nota: ${sw.note}</div>` : ''}
      <div class="mt-1 flex gap-3">${actions}</div>
    </li>`;
  }).join('') || '<li>Nessuna richiesta.</li>';

  ul.onclick = async (e)=>{
    const acceptId = e.target?.dataset?.accept;
    const rejectId = e.target?.dataset?.reject;
    if(acceptId){
      const { error } = await supabase.from('shift_swaps')
        .update({ partner_accepted:true, status:'partner_accepted' })
        .eq('id', acceptId);
      if(error) return alert('Errore: '+error.message);
      await loadMySwaps();
    } else if(rejectId){
      const { error } = await supabase.from('shift_swaps')
        .update({ status:'rejected' })
        .eq('id', rejectId);
      if(error) return alert('Errore: '+error.message);
      await loadMySwaps();
    }
  };
}

// ====== CHAT ======
let CURRENT_THREAD_ID = null;
let THREAD_SUB = null;

async function loadCoworkers(){
  // listar colegas (solo nombre/role) para chat
  const { data, error } = await supabase
    .from('employees')
    .select('id,name,role')
    .neq('id', MY_EMP_ID)
    .order('name');
  if(error){ console.error(error); return; }
  const ul = document.getElementById('empList');
  const search = document.getElementById('searchEmp');
  const render = (rows)=> ul.innerHTML = (rows||[]).map(e=>`
      <li><button data-emp="${e.id}" class="w-full text-left px-2 py-1 hover:bg-blue-50 rounded">
      ${e.name} <span class="text-xs text-gray-500">(${e.role||''})</span></button></li>
  `).join('') || '<li class="text-gray-500">Nessun collega</li>';
  render(data);
  search.oninput = () => {
    const q = search.value.toLowerCase();
    render(data.filter(e => e.name.toLowerCase().includes(q) || (e.role||'').toLowerCase().includes(q)));
  };
  ul.onclick = async (e)=>{
    const id = e.target.closest('button')?.dataset?.emp;
    if(!id) return;
    await openThread(Number(id));
  };
}

async function openThread(otherEmpId){
  // busca o crea thread
  let { data, error } = await supabase
    .from('direct_threads')
    .select('id')
    .or(`and(a_employee_id.eq.${MY_EMP_ID},b_employee_id.eq.${otherEmpId}),and(a_employee_id.eq.${otherEmpId},b_employee_id.eq.${MY_EMP_ID})`)
    .limit(1).single();

  if(error && error.code!=='PGRST116'){ console.error(error); return; }
  if(!data){
    const ins = await supabase.from('direct_threads')
      .insert([{ a_employee_id: MY_EMP_ID, b_employee_id: otherEmpId }])
      .select('id').single();
    if(ins.error){ console.error(ins.error); return; }
    data = ins.data;
  }
  CURRENT_THREAD_ID = data.id;
  document.getElementById('chatHeader').textContent = `Thread #${CURRENT_THREAD_ID}`;
  document.getElementById('chatSend').disabled = false;

  await loadThreadMessages(CURRENT_THREAD_ID);
  subscribeThread(CURRENT_THREAD_ID);
}

async function loadThreadMessages(threadId){
  const { data, error } = await supabase
    .from('direct_messages')
    .select('id,sender_employee_id,body,created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if(error){ console.error(error); return; }
  const box = document.getElementById('chatBox');
  box.innerHTML = (data||[]).map(m=>{
    const mine = m.sender_employee_id === MY_EMP_ID;
    return `<div class="mb-1 ${mine?'text-right':''}">
      <span class="${mine?'bg-blue-600 text-white':'bg-white border'} inline-block px-2 py-1 rounded">${m.body}</span>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function subscribeThread(threadId){
  if(THREAD_SUB) supabase.removeChannel(THREAD_SUB);
  THREAD_SUB = supabase.channel(`rt-thread-${threadId}`)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'direct_messages', filter:`thread_id=eq.${threadId}` },
      payload => {
        const m = payload.new;
        const mine = m.sender_employee_id === MY_EMP_ID;
        const box = document.getElementById('chatBox');
        box.innerHTML += `<div class="mb-1 ${mine?'text-right':''}">
          <span class="${mine?'bg-blue-600 text-white':'bg-white border'} inline-block px-2 py-1 rounded">${m.body}</span>
        </div>`;
        box.scrollTop = box.scrollHeight;
      }
    ).subscribe();
}

document.getElementById('chatSend').onclick = async ()=>{
  if(!CURRENT_THREAD_ID) return;
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if(!text) return;
  const { error } = await supabase.from('direct_messages').insert([{
    thread_id: CURRENT_THREAD_ID, sender_employee_id: MY_EMP_ID, body: text
  }]);
  if(error){ alert('Errore messaggio: '+error.message); return; }
  input.value='';
};

// ====== REALTIME ======
function startRealtime(){
  // mis turnos
  supabase.channel('rt-emp-shifts')
    .on('postgres_changes', { event:'*', schema:'public', table:'shifts', filter:`employee_id=eq.${MY_EMP_ID}` }, async ()=>{
      await loadMyShifts();
      await renderMonthHours();
    })
    .subscribe();

  // mis swaps (como requester o partner)
  supabase.channel('rt-swaps')
    .on('postgres_changes', { event:'*', schema:'public', table:'shift_swaps' }, async ()=>{
      await loadMySwaps();
      // si manager aprobó, los turnos cambiarán y rt-emp-shifts refresca
    })
    .subscribe();

  // mensajes se suscriben por thread cuando abres uno
}