import { bindAuthForm } from './auth-form.js';
const token = new URLSearchParams(location.search).get('token') || '';
// Retain only in memory; remove it from the address before any navigation/referrer.
history.replaceState(null, '', location.pathname);
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
  document.getElementById('auth-message').textContent = 'El enlace no es válido. Solicita otro enlace de recuperación.';
  document.querySelector('button[type="submit"]').disabled = true;
}
bindAuthForm({ endpoint: '/api/auth/restablecer', payload: form => {
  if (form.get('clave') !== form.get('confirmacion')) throw new Error('Las contraseñas no coinciden.');
  return { token, clave: form.get('clave') };
}, onSuccess: (result, message, form) => {
  message.textContent = result.message; form.reset();
  form.querySelectorAll('input').forEach(input => { input.disabled = true; });
  form.querySelector('button').hidden = true;
} });
