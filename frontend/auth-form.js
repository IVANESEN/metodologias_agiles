export function bindAuthForm({ endpoint, payload, onSuccess }) {
  const form = document.querySelector('form');
  const message = document.getElementById('auth-message');
  const button = form.querySelector('button[type="submit"]');
  const label = button.innerHTML;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    message.textContent = '';
    message.classList.remove('ok');
    form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    try {
      const data = payload(new FormData(form));
      button.disabled = true;
      button.innerHTML = '<span class="spinner" aria-hidden="true"></span> Procesando…';
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data), signal: AbortSignal.timeout(90_000) });
      const result = await response.json();
      if (!response.ok) {
        for (const name of Object.keys(result.error?.fields || {})) form.querySelector(`[name="${name}"]`)?.setAttribute('aria-invalid', 'true');
        const detail = Object.values(result.error?.fields || {})[0];
        throw new Error(detail && result.error?.code === 'VALIDATION_ERROR' ? detail : result.error?.message || 'No se pudo completar la solicitud.');
      }
      await onSuccess(result, message, form);
    } catch (error) {
      message.textContent = error.name === 'TypeError' || error.name === 'TimeoutError'
        ? 'No se pudo conectar. Inténtalo de nuevo.' : error.message;
    } finally { button.disabled = false; button.innerHTML = label; }
  });
}
