import { bindAuthForm } from './auth-form.js';
bindAuthForm({ endpoint: '/api/auth/recuperar', payload: form => Object.fromEntries(form),
  onSuccess: (result, message) => { message.classList.add('ok'); message.textContent = result.message; } });
