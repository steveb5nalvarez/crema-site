// Hora de Milán + utilidades UI para el mock
const TZ = 'Europe/Rome';
let CAL = null;
let EMP = null;    // fila employees del usuario
let MY_ID = null;
let SHIFTS = [];

function nowMilano() {
  const n = new Date();
  const p = new Intl.DateTimeFormat('en-CA',{
    timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
  }).formatToParts(n).reduce((a,x)=>(a[x.type]=x.value,a),{});
  return new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`);
}
function todayISO(){ const d=nowMilano(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function monthLabel(){ return new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric', timeZone:TZ}).format(nowMilano()); }
function initials(n){ return (n||'').trim().split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()||'').join('') || 'EC'; }
function toHHMM(totalHours){
  const m = Math.round(totalHours*60);
  const hh = Math.floor(m/60), mm = m%60;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}
function diffHours(h1,h2,br=0.5){
  const [ah,am]=h1.split(':').map(Number), [bh,bm]=h2.split(':').map(Number);
  return Math.max(0,(bh*60+bm - (ah*60+am))/60 - br);
}

document.addEventListener('DOMContentLoaded', async () => {
  // botones
  document.getElementById('btnLogout').onclick = async () => { await supabase.auth.signOut(); location.href='/index.html'; };
  document.getElementById('btnMessages').onclick = () => alert('Chat verrà dopo 🙂');

  await ensureSession();
  await loadEmployeeOfUser();
  await loadShiftsMine();
  paintProfile();
  setupCalendar();
  paintMonthTotals();
  paintDayShifts(todayISO());
  await populateSwapSelects();

  startRealtime();
});

async function ensureSession(){
  const { data:{ session } } = await supabase.auth.getSession();
  if(!session){ location.href='/index.html'; }
}

async function loadEmployeeOfUser(){
  const { data:{ user }} = await supabase.auth.getUser();
  const { data, error } = await supabase.from('employees')
    .select('id, first_name, last_name, name, role, weekly_hours, email, phone, user_id')
    .eq('user_id', user.id).limit(1);
  if(error || !data?.length){ alert('Profilo dipendente non trovato'); throw new Error('no employee'); }
  EMP = data[0];
  MY_ID = EMP.id;
}

function paintProfile(){
  const f = EMP.first_name || (EMP.name||'').split(' ')[0] || '';
  const l = EMP.last_name  || (EMP.name||'').split(' ').slice(1).join(' ') || '';
  document.getElementById('empFirst').textContent = f || '[NOME]';
  document.getElementById('empLast').textContent  = l || '[COGNOME]';
  document.getElementById('empRole').textContent  = EMP.role || '—';
  document.getElementById('empWeekly').textContent= EMP.weekly_hours ?? '—';
  document.getElementById('avatar').textContent = initials(`${f} ${l}`);
}

async function loadShiftsMine(){
  const { data, error } = await supabase
    .from('shifts')
    .select('id,date,start_time,end_time,role')
    .eq('employee_id', MY_ID)
    .order('date',{ascending:true});
  if(error){ console.error(error); return; }
  SHIFTS = data || [];
}

function setupCalendar(){
  document.getElementById('monthTitle').textContent = monthLabel();
  const el = document.getElementById('calendar');
  const events = SHIFTS.map(s=>({ id:String(s.id), title:'', start:s.date, allDay:true }));
  if(!CAL){
    CAL = new FullCalendar.Calendar(el,{
      initialView:'dayGridMonth',
      locale:'en',
      initialDate: todayISO(),
      height: 430,
      headerToolbar: { left:'', center:'title', right:'' },
      dateClick: (info)=> paintDayShifts(info.dateStr),
      events:[]
    });
    CAL.render();
  }
  CAL.removeAllEvents();
  CAL.addEventSource(events);
}

function paintDayShifts(dateStr){
  const wrap = document.getElementById('dayShifts');
  const list = SHIFTS.filter(s=>s.date===dateStr);
  wrap.innerHTML = list.length
    ? list.map(s=>`
      <div>
        <div class="uppercase text-[11px] text-gray-500">LAVORA :</div>
        <div class="font-semibold">| ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)} = ${EMP.first_name || ''} ${EMP.last_name || ''}</div>
        <div class="text-blue-700 text-xs">${s.role || ''}</div>
      </div>
    `).join('')
    : `<div class="uppercase text-[11px] text-gray-500">LAVORA :</div><div class="text-sm text-gray-700">Nessun turno</div>`;
}

function paintMonthTotals(){
  const n = nowMilano(); const y=n.getFullYear(); const m=n.getMonth()+1;
  const start = `${y}-${String(m).padStart(2,'0')}-01`;
  const end = `${y}-${String(m).padStart(2,'0')}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`;
  const monthShifts = SHIFTS.filter(s=>s.date>=start && s.date<=end);
  const total = monthShifts.reduce((sum,s)=> sum + diffHours(s.start_time,s.end_time,0.5), 0);
  document.getElementById('monthLabel').textContent = new Intl.DateTimeFormat('it-IT',{month:'long', timeZone:TZ}).format(n);
  document.getElementById('monthTotalHHMM').textContent = toHHMM(total);
}

// --- Cambio turno (UI básica) ---
async function populateSwapSelects(){
  const today = todayISO();
  const { data: mine } = await supabase
    .from('shifts')
    .select('id,date,start_time,end_time,role')
    .eq('employee_id', MY_ID).gte('date', today).order('date');

  const { data: others } = await supabase
    .from('shifts')
    .select('id,date,start_time,end_time,role, employee_id, employees(name)')
    .neq('employee_id', MY_ID).gte('date', today).order('date');

  const selMine = document.getElementById('selMine');
  const selOther = document.getElementById('selOther');
  selMine.innerHTML = (mine||[]).map(s=>`<option value="${s.id}">${s.date} ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</option>`).join('') || '<option>Nessun turno</option>';
  selOther.innerHTML = (others||[]).map(s=>`<option value="${s.id}">${s.date} ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)} — ${s.employees?.name||''}</option>`).join('') || '<option>Nessun turno</option>';

  document.getElementById('btnSwap').onclick = () => {
    alert('Invio proposta di cambio turno (logica arriverà dopo) ✅');
  };
}

// Realtime para refrescar UI cuando cambien mis turnos
function startRealtime(){
  supabase.channel('rt-emp')
    .on('postgres_changes',{event:'*',schema:'public',table:'shifts', filter:`employee_id=eq.${MY_ID}`},
      async ()=>{ await loadShiftsMine(); setupCalendar(); paintMonthTotals(); paintDayShifts(todayISO()); }
    ).subscribe();
}
