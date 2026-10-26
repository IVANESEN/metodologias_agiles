// Comportamiento compartido de las pantallas de acceso: mostrar contraseña,
// aviso de Bloq Mayús y medidor de seguridad.
import { icon, LOGO } from './icons.js';

for (const slot of document.querySelectorAll('[data-logo]')) slot.innerHTML = LOGO;
for (const slot of document.querySelectorAll('[data-icon]')) slot.outerHTML = icon(slot.dataset.icon, slot.dataset.class || 'icon');

for (const input of document.querySelectorAll('input[type="password"]')) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'password-toggle addon';
  toggle.setAttribute('aria-label', 'Mostrar contraseña');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.innerHTML = icon('eye');
  toggle.addEventListener('click', () => {
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    toggle.innerHTML = icon(visible ? 'eyeOff' : 'eye');
    toggle.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    toggle.setAttribute('aria-pressed', String(visible));
    input.focus();
  });
  input.after(toggle);
  const caps = document.createElement('p');
  caps.className = 'caps';
  caps.hidden = true;
  caps.textContent = 'Bloq Mayús está activado.';
  input.closest('.field')?.append(caps);
  const check = event => { if (event.getModifierState) caps.hidden = !event.getModifierState('CapsLock'); };
  input.addEventListener('keydown', check);
  input.addEventListener('keyup', check);
  input.addEventListener('blur', () => { caps.hidden = true; });
}

export function passwordScore(value) {
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  return value ? Math.max(1, score) : 0;
}

const meter = document.querySelector('[data-strength-for]');
if (meter) {
  const input = document.getElementById(meter.dataset.strengthFor);
  const text = document.querySelector('[data-strength-text]');
  const labels = ['Usa al menos 8 caracteres con letras y números.', 'Débil', 'Aceptable', 'Buena', 'Excelente'];
  input.addEventListener('input', () => {
    const level = passwordScore(input.value);
    meter.dataset.level = String(level);
    if (text) text.textContent = labels[level];
  });
}
