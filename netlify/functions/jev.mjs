import { handleRelay } from '../../src/relay.js';

export default async (req) => {
  const result = await handleRelay({
    method: req.method,
    headers: Object.fromEntries(req.headers),
    bodyText: await req.text(),
    env: { TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY, DEMO_PASSWORD: process.env.DEMO_PASSWORD },
    fetchImpl: fetch,
  });
  return new Response(result.body, { status: result.status, headers: result.headers });
};
