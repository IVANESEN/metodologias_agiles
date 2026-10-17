export function createMemoryMailer() {
  const outbox = [];
  return { available: true, outbox, async send(message) { outbox.push({ ...message }); } };
}

export function createMailer({ production = process.env.NODE_ENV === 'production', logger = console } = {}) {
  return {
    // No simulation, tokens or delivery claims in production. Inject a real adapter to enable recovery there.
    available: !production,
    async send({ text }) {
      if (production) throw new Error('Configura un proveedor de correo antes de habilitar recuperación en producción.');
      logger.info(`Correo simulado de recuperación (solo desarrollo):\n${text}`);
    },
  };
}
