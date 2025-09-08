// dashboard.js

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('openEmployeeForm');
  const closeBtn = document.getElementById('closeModal');
  const modal = document.getElementById('employeeModal');

  if (openBtn && modal) openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
  if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

  const newEmployeeForm = document.getElementById('newEmployeeForm');
  const employeeNameSelect = document.getElementById('employeeName');
  const shiftForm = document.getElementById('shiftForm');

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
      loadEmployees();
    }
  });

  // 👉 Cargar dipendenti en select
  async function loadEmployees() {
    const { data, error } = await supabase.from('employees').select('*');
    if (error) return console.error(error);

    employeeNameSelect.innerHTML = data.map(emp => `<option value="${emp.id}">${emp.name}</option>`).join('');
    loadEmployeeTable(data);
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
      loadShifts();
    }
  });

  // 👉 Mostrar turni nella tabella
  async function loadShifts() {
    const { data, error } = await supabase
      .from('shifts')
      .select('*, employees(name)')
      .order('date');

    if (error) return console.error(error);

    const tbody = document.getElementById('shiftBody');
    tbody.innerHTML = '';

    data.forEach(shift => {
      const start = shift.start_time.slice(0, 5);
      const end = shift.end_time.slice(0, 5);
      const ore = ((new Date(`1970-01-01T${end}`) - new Date(`1970-01-01T${start}`)) / 3600000 - 0.5).toFixed(1);
      tbody.innerHTML += `
        <tr>
          <td class="px-2 py-1">${shift.date}</td>
          <td class="px-2 py-1">${shift.employees.name}</td>
          <td class="px-2 py-1">${shift.role}</td>
          <td class="px-2 py-1">${start}</td>
          <td class="px-2 py-1">${end}</td>
          <td class="px-2 py-1">${ore}h</td>
          <td class="px-2 py-1 flex gap-2">
            <span class="edit-shift cursor-pointer text-blue-600" data-id="${shift.id}" data-date="${shift.date}" data-name="${shift.employees.name}" data-start="${shift.start_time}" data-end="${shift.end_time}" data-role="${shift.role}">📝</span>
            <span class="delete-shift cursor-pointer text-red-600" data-id="${shift.id}">🗑️</span>
          </td>
        </tr>
      `;
    });

    renderCalendar(data);
    renderToday(data);
  }

  // 👉 Mostrar chi lavora oggi
  function renderToday(shifts) {
    const today = new Date().toISOString().slice(0, 10);
    const todayShifts = shifts.filter(s => s.date === today);
    const list = document.getElementById('todayWorkersList');

    if (todayShifts.length === 0) {
      list.innerHTML = '<li>Nessuno ha il turno oggi.</li>';
    } else {
      list.innerHTML = '';
      todayShifts.forEach(s => {
        list.innerHTML += `<li>${s.employees.name} (${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)})</li>`;
      });
    }
  }

  // 👉 Render calendario FullCalendar
  function renderCalendar(shifts) {
    const calendarEl = document.getElementById('calendar');
    const events = shifts.map(s => ({
      title: s.employees.name,
      start: s.date,
      allDay: true
    }));

    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      locale: 'it',
      height: 500,
      events,
      dateClick: function(info) {
        const dayShifts = shifts.filter(s => s.date === info.dateStr);
        const box = document.getElementById('selectedDayWorkers');
        const ul = document.getElementById('workersByDateList');
        const label = document.getElementById('selectedDate');

        label.textContent = info.dateStr;
        ul.innerHTML = '';

        if (dayShifts.length === 0) {
          ul.innerHTML = '<li>Nessuno lavora questo giorno.</li>';
        } else {
          dayShifts.forEach(s => {
            ul.innerHTML += `<li>${s.employees.name} (${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)})</li>`;
          });
        }

        box.classList.remove('hidden');
      }
    });

    calendar.render();
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
  });

  document.getElementById('closeEditModal').addEventListener('click', () => {
    document.getElementById('editShiftModal').classList.add('hidden');
  });

  document.getElementById('editShiftForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = e.target.dataset.id;
    const date = document.getElementById('editShiftDate').value;
    const name = document.getElementById('editShiftName').value;
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
      loadShifts();
    }
  });

  // 🟢 Cargar todo al inicio
  loadEmployees();
  loadShifts();
});