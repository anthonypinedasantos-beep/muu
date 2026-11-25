// This legacy Pages Function exposed game generation through an unauthenticated GET.
// The active Requestor uses the Cloudflare Worker, which verifies Turnstile tokens.
// Keep this route closed so it cannot bypass that protection.
export async function onRequest() {
  return new Response(JSON.stringify({
    error: "This endpoint is retired. Use the secure Requestor."
  }), {
    status: 410,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
