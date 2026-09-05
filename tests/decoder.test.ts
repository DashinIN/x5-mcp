import { describe, expect, it } from 'vitest';
import { encode } from 'turbo-stream';
import { decodeHistory } from '../src/x5/decoder.js';
import { raw } from './helpers.js';

describe('history decoder (synthetic ADR contract)', () => {
  it('decodes JSON action envelopes', async () => {
    expect((await decodeHistory(Response.json({ data: { additionalReceiptsResponse: [raw] } }))).receipts).toEqual([raw]);
  });
  it('decodes a real turbo-stream encoding without implementing its parser', async () => {
    const stream = encode({ data: { additionalReceiptsResponse: [raw], isNewData: true } });
    expect(await decodeHistory(new Response(stream))).toEqual({ receipts: [raw], isNewData: true });
  });
  it('recognizes an empty page', async () => {
    expect(await decodeHistory(Response.json({ additionalReceiptsResponse: [] }))).toEqual({ receipts: [] });
  });
  it.each([{}, { additionalReceiptsResponse: null }, { error: 'unauthorized' }])('does not interpret malformed responses as empty history', async value => {
    await expect(decodeHistory(Response.json(value))).rejects.toMatchObject({ code: 'X5_UNEXPECTED_RESPONSE' });
  });
  it('rejects HTML login and corrupt streams', async () => {
    await expect(decodeHistory(new Response('<html>login</html>'))).rejects.toMatchObject({ code: 'X5_AUTH' });
    await expect(decodeHistory(new Response('not-a-stream'))).rejects.toMatchObject({ code: 'X5_DECODE' });
  });
});
