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

  // Aquí irán más cosas después:
  // - Cargar empleados
  // - Guardar turni
  // - Mostrar turni asignati
});
