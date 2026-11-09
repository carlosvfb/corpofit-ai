import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import './saas-helpers.mjs';
import { AsaasApiError, AsaasClient, AsaasNetworkError, AsaasTimeoutError } from '../saas/asaas/client.js';

const mk = fetchImpl => new AsaasClient({ apiKey: 'secret_key_123', baseUrl: 'https://api-sandbox.asaas.com/v3', fetchImpl });
const respond = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe('AsaasClient', () => {
  test('envia access_token, User-Agent e corpo JSON', async () => {
    const calls = [];
    const f = async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ id: 'cus_1' }), { status: 200 }); };
    await mk(f).createCustomer({ name: 'A', cpfCnpj: '52998224725' });
    const [url, init] = calls[0];
    assert.equal(String(url), 'https://api-sandbox.asaas.com/v3/customers');
    assert.equal(init.headers.access_token, 'secret_key_123');
    assert.match(init.headers['User-Agent'], /CorpoFit AI/);
    assert.match(init.body, /cpfCnpj/);
  });

  test('GET não envia corpo e aplica query', async () => {
    const calls = [];
    const f = async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ data: [] }), { status: 200 }); };
    await mk(f).listCustomers({ externalReference: 'u1', limit: 1 });
    assert.match(String(calls[0][0]), /externalReference=u1/);
    assert.equal(calls[0][1].body, undefined);
  });

  test('mapeia erros da API sem vazar a chave', async () => {
    const err = await mk(respond({ errors: [{ code: 'invalid_access_token', description: 'Chave inválida' }] }, 401)).getPayment('pay_1').catch(e => e);
    assert.ok(err instanceof AsaasApiError);
    assert.equal(err.status, 401);
    assert.ok(!err.message.includes('secret_key_123'));
  });

  test('converte abort em AsaasTimeoutError e falha de rede em AsaasNetworkError', async () => {
    const abort = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
    await assert.rejects(mk(abort).getPayment('x'), AsaasTimeoutError);
    const net = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(mk(net).getPayment('x'), AsaasNetworkError);
  });
});
