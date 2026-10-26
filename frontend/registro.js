import { bindAuthForm } from './auth-form.js';

bindAuthForm({
  endpoint: '/api/auth/registro',
  payload: form => {
    if (!form.get('terminos')) throw new Error('Acepta los términos para crear tu cuenta.');
    const clave = String(form.get('clave') || '');
    if (clave.length < 8 || !/[A-Za-z]/.test(clave) || !/\d/.test(clave)) {
      throw new Error('La contraseña necesita al menos 8 caracteres, con letras y números.');
    }
    return Object.fromEntries(['nombre', 'empresa', 'correo', 'telefono', 'clave'].map(name => [name, form.get(name)]));
  },
  onSuccess: async (user, message, form) => {
    message.classList.add('ok');
    message.textContent = 'Cuenta creada. Entrando a la plataforma…';
    const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo: user.correo, clave: form.querySelector('#clave').value }) });
    location.replace(login.ok ? '/app.html' : '/login.html');
  },
});
