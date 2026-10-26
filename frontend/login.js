import { bindAuthForm } from './auth-form.js';

const correo = document.getElementById('correo');
const recordar = document.getElementById('recordar');
try { correo.value = localStorage.getItem('ici.correo') || ''; } catch { /* sin almacenamiento */ }
(correo.value ? document.getElementById('clave') : correo).focus();

// Cada rol entra a su espacio: el equipo de obra a la operación de contratos,
// las demás cuentas al portal.
const DESTINO = { residente: '/', gerente: '/' };
bindAuthForm({
  endpoint: '/api/auth/login',
  payload: form => {
    const data = { correo: form.get('correo'), clave: form.get('clave') };
    if (!data.correo || !data.clave) throw new Error('Escribe tu correo y tu contraseña.');
    return data;
  },
  onSuccess: user => {
    try {
      if (recordar.checked) localStorage.setItem('ici.correo', correo.value.trim());
      else localStorage.removeItem('ici.correo');
    } catch { /* sin almacenamiento */ }
    location.replace(DESTINO[user.rol] || '/app.html');
  },
});
