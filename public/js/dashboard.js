// dashboard.js
document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('openEmployeeForm');
  const closeBtn = document.getElementById('closeModal');
  const modal = document.getElementById('employeeModal');

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  }
  const newEmployeeForm = document.getElementById('newEmployeeForm');

  newEmployeeForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('newName').value.trim();
    const email = document.getElementById('newEmail').value.trim();
    const department = document.getElementById('newDepartment').value;
    const role = document.getElementById('newRole').value.trim();

    if (!name || !email || !department || !role) {
      alert('Compila tutti i campi.');
      return;
    }

    const { error } = await supabase.from('employees').insert([
      {
        name,
        email,
        department,
        role
      }
    ]);

    if (error) {
      alert('Errore nel salvataggio: ' + error.message);
      console.error(error);
    } else {
      alert('Dipendente registrato con successo!');
      newEmployeeForm.reset();
      document.getElementById('employeeModal').classList.add('hidden');
      // 👇 Aquí puedes volver a cargar la tabella se vuoi
      // loadEmployees();
    }
  });

  // Aquí irán más cosas después:
  // - Cargar empleados
  // - Guardar turni
  // - Mostrar turni asignati
});
