// /js/dashboard.js — versión con AUTO-REFRESH (Supabase Realtime)
let calendar = null;
let LAST_SHIFTS = [];

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('openEmployeeForm');
  const closeBtn = document.getElementById('closeModal');
  const modal = document.getElementById('employeeModal');

  if (openBtn && modal) openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
  if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

  const newEmployeeForm = document.getElementById('newEmployeeForm');
  const employeeNameSelect = document.getElementById('employeeName');
  const shiftForm = document.getElementById('shiftForm');

  // --- Utils de fecha (zona Europe/Rome) ---
  const todayLocalISO = () => {
    const d = new Date();
    const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' }).format(d);
    const m = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', month: '2-digit' }).format(d);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', day: '2-digit' }).format(d);
    return `${y}-${m}-${day}`; // YYYY-MM-DD
  };

  // 👉 Agrega nuevo dipendente
  newEmployeeForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('newName').value.trim();
    const email = document.getElementById('newEmail').value.trim();
    const department = document.getElementById('newDepartment').value;
    const role = document.getElementById('newRole').value.trim();
    const weekly_hours = parseInt(document.getElementById('newHours').value);

    if (!name || !email || !department || !role || isNaN(weekly_hours)) {
      alert('Compila tutti i campi correttamente.');
      return;
    }

    const { error } = await supabase.from('employees').insert([
      { name, email, department, role, weekly_hours }
    ]);

    if (error) {
      alert('Errore nel salvataggio: ' + error.message);
      console.error(error);
    } else {
      alert('Dipendente registrato con successo!');
      newEmployeeForm.reset();
      modal.classList.add('hidden');
      // No hace falta recargar aquí: Realtime refrescará solo.
      // Igual si quieres inmediata: loadEmployees();
    }
  });

  // 👉 Cargar dipendenti en select
  async function loadEmployees() {
    const { data, error } = await supabase.from('employees').select('*').order('name', { ascending: true });
    if (error) {
      console.error(error);
      return;
    }
    // placeholder inicial
    const opts = [`<option value="">Seleziona dipendente</option>`].concat(
      (data || []).map(emp => `<option value="${emp.id}">${emp.name}</option>`)
    );
    employeeNameSelect.innerHTML = opts.join('');
    loadEmployeeTable(data || []);
  }

  // 👉 Guardar un turno
  shiftForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = document.getElementById('shiftDate').value;
    const employee_id = document.getElementById('employeeName').value;
    const start = document.getElementById('startTime').value;
    const end = document.getElementById('endTime').value;
    const role = document.getElementById('role').value;

    if (!date || !employee_id || !start || !end || !role) {
      alert('Completa tutti i campi.');
      return;
    }

    const { error } = await supabase.from('shifts').insert([
      { employee_id, date, start_time: start, end_time: end, role }
    ]);

    if (error) {
      alert('Errore nel salvataggio turno: ' + error.message);
    } else {
      alert('Turno salvato!');
      // No hace falta: Realtime actualizará tabla y calendario.
      // loadShifts();
    }
  });

  // 👉 Mostrar turni nella tabella
  async function loadShifts() {
    const { data, error } = await supabase
      .from('shifts')
      .select('*, employees(name)')
      .order('date');

    if (error) {
      console.error(error);
      return;
    }

    LAST_SHIFTS = data || [];

    const tbody = document.getElementById('shiftBody');
    tbody.innerHTML = '';

    LAST_SHIFTS.forEach(shift => {
      const start = shift.start_time.slice(0, 5);
      const end = shift.end_time.slice(0, 5);

      // cálculo horas: diferencia - 0.5h pausa
      const ms = new Date(`1970-01-01T${end}:00Z`) - new Date(`1970-01-01T${start}:00Z`);
      const ore = (ms / 3600000 - 0.5);
      const oreFmt = isFinite(ore) ? ore.toFixed(1) : '0.0';

      tbody.innerHTML += `
        <tr>
          <td class="px-2 py-1">${shift.date}</td>
          <td class="px-2 py-1">${shift.employees?.name ?? ''}</td>
          <td class="px-2 py-1">${shift.role}</td>
          <td class="px-2 py-1">${start}</td>
          <td class="px-2 py-1">${end}</td>
          <td class="px-2 py-1">${oreFmt}h</td>
          <td class="px-2 py-1 flex gap-2">
            <span class="edit-shift cursor-pointer text-blue-600" data-id="${shift.id}" data-date="${shift.date}" data-name="${shift.employees?.name ?? ''}" data-start="${shift.start_time}" data-end="${shift.end_time}" data-role="${shift.role}">📝</span>
            <span class="delete-shift cursor-pointer text-red-600" data-id="${shift.id}">🗑️</span>
          </td>
        </tr>
      `;
    });

    renderCalendar(LAST_SHIFTS);
    renderToday(LAST_SHIFTS);
  }

  // 👉 Mostrar chi lavora oggi (local Europe/Rome)
  function renderToday(shifts) {
    const today = todayLocalISO();
    const todayShifts = shifts.filter(s => s.date === today);
    const list = document.getElementById('todayWorkersList');

    if (todayShifts.length === 0) {
      list.innerHTML = '<li>Nessuno ha il turno oggi.</li>';
    } else {
      list.innerHTML = '';
      todayShifts.forEach(s => {
        list.innerHTML += `<li>${s.employees?.name ?? ''} (${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)})</li>`;
      });
    }
  }

  // 👉 Render calendario FullCalendar (reutilizable)
  function renderCalendar(shifts) {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    const events = shifts.map(s => ({
      id: String(s.id),
      title: s.employees?.name ?? '',
      start: s.date, // allDay para vista mensual
      allDay: true
    }));

    if (!calendar) {
      calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'it',
        height: 500,
        events: [],
        dateClick: function(info) {
          const dayShifts = LAST_SHIFTS.filter(s => s.date === info.dateStr);
          const box = document.getElementById('selectedDayWorkers');
          const ul = document.getElementById('workersByDateList');
          const label = document.getElementById('selectedDate');

          label.textContent = info.dateStr;
          ul.innerHTML = '';

          if (dayShifts.length === 0) {
            ul.innerHTML = '<li>Nessuno lavora questo giorno.</li>';
          } else {
            dayShifts.forEach(s => {
              ul.innerHTML += `<li>${s.employees?.name ?? ''} (${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)})</li>`;
            });
          }

          box.classList.remove('hidden');
        }
      });
      calendar.render();
    }

    // Actualiza eventos sin recrear el calendario
    calendar.removeAllEvents();
    calendar.addEventSource(events);
  }

  // 👉 Tabella dipendenti
  async function loadEmployeeTable(data) {
    const tbody = document.getElementById('employeeBody');
    tbody.innerHTML = '';

    data.forEach(emp => {
      tbody.innerHTML += `
        <tr>
          <td class="px-2 py-1">${emp.name}</td>
          <td class="px-2 py-1">${emp.email}</td>
          <td class="px-2 py-1">${emp.department}</td>
          <td class="px-2 py-1">${emp.role}</td>
          <td class="px-2 py-1 text-red-500 cursor-pointer">🗑️</td>
        </tr>
      `;
    });
  }

  // 👉 Modal di modifica turno
  document.addEventListener('click', (e) => {
    if (e.target.matches('.edit-shift')) {
      const modal = document.getElementById('editShiftModal');
      modal.classList.remove('hidden');

      document.getElementById('editShiftForm').dataset.id = e.target.dataset.id;
      document.getElementById('editShiftDate').value = e.target.dataset.date;
      document.getElementById('editShiftName').value = e.target.dataset.name;
      document.getElementById('editShiftStart').value = e.target.dataset.start;
      document.getElementById('editShiftEnd').value = e.target.dataset.end;
      document.getElementById('editShiftRole').value = e.target.dataset.role;
    }

    if (e.target.matches('.delete-shift')) {
      const id = e.target.dataset.id;
      if (confirm('Eliminare questo turno?')) {
        supabase.from('shifts').delete().eq('id', id).then(({ error }) => {
          if (error) alert('Errore eliminazione turno: ' + error.message);
          // Realtime actualizará todo solo.
        });
      }
    }
  });

  document.getElementById('closeEditModal')?.addEventListener('click', () => {
    document.getElementById('editShiftModal').classList.add('hidden');
  });

  document.getElementById('editShiftForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = e.target.dataset.id;
    const date = document.getElementById('editShiftDate').value;
    const start = document.getElementById('editShiftStart').value;
    const end = document.getElementById('editShiftEnd').value;
    const role = document.getElementById('editShiftRole').value;

    const { error } = await supabase.from('shifts').update({
      date,
      start_time: start,
      end_time: end,
      role
    }).eq('id', id);

    if (error) {
      alert('Errore nel salvataggio modifiche');
      console.error(error);
    } else {
      alert('Modifica salvata!');
      document.getElementById('editShiftModal').classList.add('hidden');
      // Realtime actualizará automáticamente.
    }
  });

  // 🟢 Cargar todo al inicio
  loadEmployees();
  loadShifts();

  // ⚡ ACTIVAR Realtime (AUTO)
  startRealtime();

  // limpiar canal al salir
  window.addEventListener('beforeunload', () => {
    if (window.__dashboardChannel) supabase.removeChannel(window.__dashboardChannel);
  });

  // --- Realtime ---
  function startRealtime() {
    const channel = supabase
      .channel('realtime-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
        // recarga lista/select/tabla empleados
        loadEmployees();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => {
        // recarga turni + calendario + "chi lavora oggi"
        loadShifts();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // ya estamos escuchando; si quisieras, podrías hacer una refreshAll aquí también
        }
      });

    window.__dashboardChannel = channel;
  }
});