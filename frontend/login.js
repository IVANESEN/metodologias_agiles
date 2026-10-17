import { bindAuthForm } from './auth-form.js';
bindAuthForm({ endpoint: '/api/auth/login', payload: form => Object.fromEntries(form),
  onSuccess: () => location.replace('/') });
