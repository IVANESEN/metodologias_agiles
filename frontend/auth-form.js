export function bindAuthForm({ endpoint, payload, onSuccess }) {
  const form = document.querySelector('form');
  const message = document.getElementById('auth-message');
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    message.textContent = '';
    try {
      const data = payload(new FormData(form));
      button.disabled = true;
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data), signal: AbortSignal.timeout(90_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || 'No se pudo completar la solicitud.');
      await onSuccess(result, message, form);
    } catch (error) {
      message.textContent = error.name === 'TypeError' || error.name === 'TimeoutError'
        ? 'No se pudo conectar. Inténtalo de nuevo.' : error.message;
    } finally { button.disabled = false; }
  });
}
