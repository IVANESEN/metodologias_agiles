import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, createResendMailer } from './mailer.mjs';

test('Resend envía el mensaje al endpoint fijo con credencial solo en Authorization', async () => {
  const message = { to: 'usuario@example.test', subject: 'Restablecer', text: 'Enlace de prueba' };
  const mailer = createResendMailer({ apiKey: ' test-secret ', from: 'Constructora <auth@example.test>',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer test-secret');
      assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body), { from: 'Constructora <auth@example.test>',
        to: [message.to], subject: message.subject, text: message.text });
      return { ok: true, json: async () => ({ id: 'email-123' }) };
    } });
  assert.equal(mailer.available, true);
  assert.deepEqual(await mailer.send(message), { id: 'email-123' });
});

test('fallos HTTP, respuestas inválidas y red no exponen datos del proveedor', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ error: 'private-provider-payload' }) }),
    async () => { throw new Error('private-provider-payload'); },
    async () => ({ ok: true, json: async () => { throw new Error('private-provider-payload'); } }),
  ]) {
    const mailer = createResendMailer({ apiKey: 'test-secret', from: 'auth@example.test', fetchImpl });
    await assert.rejects(mailer.send({ to: 'u@example.test', subject: 'Test', text: 'token-secret' }),
      { message: 'No se pudo enviar el correo de recuperación.' });
  }
});

test('configuración incompleta deshabilita correo sin simular envío', async () => {
  for (const config of [{ apiKey: 'test-secret', from: '' }, { apiKey: '', from: 'auth@example.test' },
    { apiKey: 'test-secret', from: 'invalid\r\nheader' }]) {
    const mailer = createMailer({ production: true, ...config,
      fetchImpl: async () => assert.fail('No debe conectar sin configuración válida') });
    assert.equal(mailer.available, false);
    await assert.rejects(mailer.send({ text: 'test' }));
  }
  assert.equal(createMailer({ production: true, apiKey: '', from: '' }).available, false);
});
