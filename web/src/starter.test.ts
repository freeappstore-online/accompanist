// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it('uses this scaffold id for synthetic authenticated SDK requests', async () => {
  localStorage.setItem('fas:session', JSON.stringify({ token: 'synthetic-token', user: { id: 'synthetic-user', login: 'synthetic' } }));
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response('null', { status: 200 });
  });
  const { fas } = await import('./App');
  await fas.kv.get('identity-probe');
  expect(requests).toContain('https://api.freeappstore.online/v1/apps/accompanist/roles/ensure-member');
  expect(requests).toContain('https://api.freeappstore.online/v1/apps/accompanist/kv/identity-probe');
});
