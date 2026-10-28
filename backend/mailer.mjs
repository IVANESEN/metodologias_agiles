import { createGmailMailer } from './gmail-mailer.mjs';

export function createMemoryMailer() {
  const outbox = [];
  return { available: true, outbox, async send(message) { outbox.push({ ...message }); } };
}

export function createResendMailer({ apiKey, from, fetchImpl = globalThis.fetch } = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const sender = typeof from === 'string' ? from.trim() : '';
  const available = Boolean(key && sender && !/[\r\n]/.test(key + sender));
  return {
    available,
    async send({ to, subject, text }) {
      if (!available) throw new Error('Configura RESEND_API_KEY y MAIL_FROM para enviar correos.');
      try {
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: sender, to: [to], subject, text }),
        });
        if (!response.ok) throw new Error('DELIVERY_FAILED');
        const result = await response.json();
        if (typeof result?.id !== 'string' || !result.id) throw new Error('DELIVERY_FAILED');
        return { id: result.id };
      } catch {
        // Provider payloads and network errors can include credentials or recovery links.
        throw new Error('No se pudo enviar el correo de recuperación.');
      }
    },
  };
}

export function createMailer({ production = process.env.NODE_ENV === 'production', logger = console,
  apiKey = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM, fetchImpl = globalThis.fetch,
  provider = process.env.MAIL_PROVIDER || 'resend',
  gmailClientId = process.env.GMAIL_CLIENT_ID, gmailClientSecret = process.env.GMAIL_CLIENT_SECRET,
  gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN, gmailUser = process.env.GMAIL_USER } = {}) {
  const selected = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  if (selected === 'gmail') return createGmailMailer({
    clientId: gmailClientId, clientSecret: gmailClientSecret, refreshToken: gmailRefreshToken,
    user: gmailUser, fetchImpl,
  });
  if (selected !== 'resend') return {
    available: false,
    async send() { throw new Error('No se pudo enviar el correo de recuperación.'); },
  };
  if (apiKey || from) return createResendMailer({ apiKey, from, fetchImpl });
  return {
    // No simulation, tokens or delivery claims in production. Inject a real adapter to enable recovery there.
    available: !production,
    async send({ text }) {
      if (production) throw new Error('Configura un proveedor de correo antes de habilitar recuperación en producción.');
      logger.info(`Correo simulado de recuperación (solo desarrollo):\n${text}`);
    },
  };
}
