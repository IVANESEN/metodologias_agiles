import { bindAuthForm } from './auth-form.js';
bindAuthForm({ endpoint: '/api/auth/recuperar', payload: form => Object.fromEntries(form),
  onSuccess: (result, message) => { message.textContent = result.message; } });
