// Gmail HTTPS transport. No credentials or message contents are logged.
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const DELIVERY_ERROR = 'No se pudo enviar el correo de recuperación.';
const CONTROL = /[\x00-\x1f\x7f]/;
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_{|}~-]+)*$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function credential(value) {
  if (typeof value !== 'string' || CONTROL.test(value)) return '';
  const normalized = value.trim();
  return /\s/.test(normalized) ? '' : normalized;
}

// Accept only an ASCII mailbox, never display names or a recipient list.
function mailbox(value) {
  if (typeof value !== 'string' || CONTROL.test(value)) return '';
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254) return '';
  const parts = normalized.split('@');
  if (parts.length !== 2) return '';
  const [local, domain] = parts;
  const labels = domain.split('.');
  if (!local || local.length > 64 || !LOCAL_PART.test(local) || labels.length < 2 ||
      labels.some(label => label.length > 63 || !DOMAIN_LABEL.test(label)) ||
      !/^[a-z]{2,63}$/.test(labels.at(-1))) return '';
  return normalized;
}

function encodedSubject(subject) {
  if (typeof subject !== 'string' || !subject.trim() || CONTROL.test(subject) || !subject.isWellFormed()) {
    throw new Error(DELIVERY_ERROR);
  }
  // Each encoded word stays below 75 characters and never splits UTF-8 bytes.
  const chunks = [];
  let chunk = '', bytes = 0;
  for (const character of subject) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 42) { chunks.push(chunk); chunk = ''; bytes = 0; }
    chunk += character;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(value => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`).join('\r\n ');
}

function rawMessage({ sender, to, subject, text, timestamp }) {
  const recipient = mailbox(to);
  if (!recipient || typeof text !== 'string' || !text.isWellFormed() || !Number.isFinite(timestamp)) {
    throw new Error(DELIVERY_ERROR);
  }
  const body = Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  const mime = [
    `From: ${sender}`,
    `To: ${recipient}`,
    `Subject: ${encodedSubject(subject)}`,
    `Date: ${new Date(timestamp).toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    '',
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

export function createGmailMailer({ clientId, clientSecret, refreshToken, user,
  fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const id = credential(clientId);
  const secret = credential(clientSecret);
  const refresh = credential(refreshToken);
  const sender = mailbox(user);
  const available = Boolean(id && secret && refresh && sender && typeof fetchImpl === 'function' && typeof now === 'function');
  let cachedToken = null;
  let refreshFlight = null;

  async function accessToken() {
    if (cachedToken && now() < cachedToken.expiresAt) return cachedToken;
    if (!refreshFlight) {
      refreshFlight = (async () => {
        const startedAt = now();
        const response = await fetchImpl(TOKEN_ENDPOINT, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ client_id: id, client_secret: secret,
            refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
        });
        if (!response.ok) throw new Error(DELIVERY_ERROR);
        const result = await response.json();
        const value = credential(result?.access_token);
        const seconds = result?.expires_in;
        if (!value || !Number.isFinite(seconds) || seconds <= 0 ||
            (result.token_type !== undefined &&
              (typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer'))) {
          throw new Error(DELIVERY_ERROR);
        }
        // Count from request start and reserve one minute for latency and clock skew.
        const expiresAt = startedAt + Math.max(0, seconds * 1000 - 60_000);
        if (!Number.isFinite(expiresAt)) throw new Error(DELIVERY_ERROR);
        cachedToken = { value, expiresAt };
        return cachedToken;
      })().catch(() => {
        cachedToken = null;
        throw new Error(DELIVERY_ERROR);
      }).finally(() => { refreshFlight = null; });
    }
    return refreshFlight;
  }

  return {
    available,
    async send(message) {
      try {
        if (!available) throw new Error(DELIVERY_ERROR);
        const { to, subject, text } = message || {};
        // Reject malformed headers before refreshing or sending anything.
        const raw = rawMessage({ sender, to, subject, text, timestamp: now() });
        const token = await accessToken();
        const response = await fetchImpl(SEND_ENDPOINT, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ raw }),
        });
        if (!response.ok) {
          if ([401, 403].includes(response.status) && cachedToken === token) cachedToken = null;
          throw new Error(DELIVERY_ERROR);
        }
        const result = await response.json();
        if (typeof result?.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(result.id)) throw new Error(DELIVERY_ERROR);
        return { id: result.id };
      } catch {
        // Never include provider payloads, network errors, tokens or recovery links.
        throw new Error(DELIVERY_ERROR);
      }
    },
  };
}
