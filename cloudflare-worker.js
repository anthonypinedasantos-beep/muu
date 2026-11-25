const GROUP_ID = 34356929;
const MAX_PLAYERS = 3;
const MEMBER_PAGES = 9;
const MEMBER_CACHE_TTL = 10 * 60 * 1000;
const BATCH_SIZE = 15;
const MAX_BATCHES = 12;
const CONCURRENCY = 5;
let memberCache = { expiresAt: 0, ids: [] };

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = new Set([
    "https://rbxcondos.xyz",
    "https://www.rbxcondos.xyz",
    "http://rbxcondos.xyz",
    "http://www.rbxcondos.xyz"
  ]);
  return {
    ...(allowedOrigins.has(origin) ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin"
  };
}
const json = (request, data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...getCorsHeaders(request) }
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function robloxGet(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "RBXCONDOS/1.0" },
        signal: AbortSignal.timeout(12000)
      });
      if (response.status === 429) {
        const wait = Number(response.headers.get("retry-after")) || 2;
        await sleep(Math.min(wait * 1000, 8000));
        continue;
      }
      if (!response.ok) throw new Error("Roblox API respondió " + response.status);
      return await response.json();
    } catch (error) {
      if (attempt === retries - 1) throw error;
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function fetchGroupMembers() {
  if (memberCache.ids.length && Date.now() < memberCache.expiresAt) return shuffle(memberCache.ids);
  const ids = [];
  let cursor = null;
  for (let page = 0; page < MEMBER_PAGES; page++) {
    const url = new URL("https://groups.roblox.com/v1/groups/" + GROUP_ID + "/users");
    url.searchParams.set("sortOrder", "Desc");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await robloxGet(url.toString());
    if (!data) break;
    for (const item of data.data || []) {
      const id = item?.user?.userId;
      if (id) ids.push(Number(id));
    }
    cursor = data.nextPageCursor;
    if (!cursor) break;
  }
  if (ids.length) memberCache = { ids: [...new Set(ids)], expiresAt: Date.now() + MEMBER_CACHE_TTL };
  return shuffle(memberCache.ids);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await mapper(items[index]); }
      catch { results[index] = []; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchUserGames(userId) {
  const url = new URL("https://games.roblox.com/v2/users/" + userId + "/games");
  url.searchParams.set("sortOrder", "Desc");
  url.searchParams.set("limit", "50");
  url.searchParams.set("accessFilter", "2");
  const data = await robloxGet(url.toString());
  return (data?.data || []).filter(game => game?.id && game?.rootPlace?.id);
}

async function fetchGameDetails(ids) {
  const result = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const url = new URL("https://games.roblox.com/v1/games");
    for (const id of ids.slice(i, i + 100)) url.searchParams.append("universeIds", String(id));
    const data = await robloxGet(url.toString());
    for (const game of data?.data || []) result.set(Number(game.id), game);
  }
  return result;
}

async function fetchGameIcon(universeId) {
  try {
    const url = new URL("https://thumbnails.roblox.com/v1/games/icons");
    url.searchParams.set("universeIds", String(universeId));
    url.searchParams.set("returnPolicy", "PlaceHolder");
    url.searchParams.set("size", "512x512");
    url.searchParams.set("format", "Png");
    url.searchParams.set("isCircular", "false");
    const data = await robloxGet(url.toString());
    const item = data?.data?.[0];
    return item?.state === "Completed" ? item.imageUrl || "" : "";
  } catch { return ""; }
}

async function findGroupGame() {
  const members = await fetchGroupMembers();
  if (!members.length) throw new Error("No se pudieron cargar miembros del grupo de Roblox.");
  const maxMembers = Math.min(members.length, BATCH_SIZE * MAX_BATCHES);
  const checked = new Set();

  for (let offset = 0; offset < maxMembers; offset += BATCH_SIZE) {
    const batch = members.slice(offset, offset + BATCH_SIZE);
    const lists = await mapWithConcurrency(batch, CONCURRENCY, fetchUserGames);
    const candidates = new Map();
    for (const games of lists) {
      for (const game of games) {
        const id = Number(game.id);
        if (id && !checked.has(id)) {
          checked.add(id);
          candidates.set(id, game);
        }
      }
    }
    if (!candidates.size) continue;

    const details = await fetchGameDetails([...candidates.keys()]);
    const eligible = [];
    for (const [id, candidate] of candidates) {
      const info = details.get(id);
      if (info && Number(info.maxPlayers) === MAX_PLAYERS) eligible.push({ candidate, info });
    }
    if (!eligible.length) continue;

    const chosen = eligible[Math.floor(Math.random() * eligible.length)];
    const info = chosen.info;
    const placeId = Number(info.rootPlaceId || chosen.candidate.rootPlace?.id);
    if (!placeId) continue;

    return {
      universeId: Number(info.id),
      placeId,
      name: info.name || chosen.candidate.name || "Experiencia de Roblox",
      creator: info.creator?.name || chosen.candidate.creator?.name || "Creador del grupo",
      playing: Number(info.playing || 0),
      visits: Number(info.visits || 0),
      maxPlayers: Number(info.maxPlayers),
      thumbnail: await fetchGameIcon(info.id),
      gameUrl: "https://www.roblox.com/games/" + placeId,
      startUrl: "https://www.roblox.com/games/start?placeId=" + placeId
    };
  }
  return null;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }
    if (request.method !== "POST") return json(request, { error: "Método no permitido." }, 405);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = new Set([
      "https://rbxcondos.xyz",
      "https://www.rbxcondos.xyz"
    ]);
    if (!allowedOrigins.has(origin)) return json(request, { error: "Origen no permitido." }, 403);
    try {
      if (!env.TURNSTILE_SECRET_KEY) {
        return json(request, { error: "La verificación de seguridad no está configurada en el servidor." }, 503);
      }
      let body;
      try { body = await request.json(); }
      catch { return json(request, { error: "Solicitud no válida." }, 400); }
      const token = typeof body?.turnstileToken === "string" ? body.turnstileToken : "";
      if (!token || token.length > 2048) {
        return json(request, { error: "Completa la verificación de Cloudflare antes de continuar." }, 400);
      }
      const verification = new FormData();
      verification.set("secret", env.TURNSTILE_SECRET_KEY);
      verification.set("response", token);
      const clientIp = request.headers.get("CF-Connecting-IP");
      if (clientIp) verification.set("remoteip", clientIp);
      verification.set("idempotency_key", crypto.randomUUID());
      const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: verification
      });
      if (!verifyResponse.ok) {
        return json(request, { error: "No se pudo comprobar la verificación. Inténtalo de nuevo." }, 502);
      }
      const verificationResult = await verifyResponse.json();
      if (!verificationResult.success) {
        return json(request, { error: "La verificación ha caducado o no es válida. Vuelve a completarla." }, 403);
      }
      const game = await findGroupGame();
      if (!game) return json(request, { error: "No se encontró una experiencia del grupo con exactamente 3 jugadores máximos por servidor. Vuelve a intentarlo." }, 404);
      return json(request, { game });
    } catch (error) {
      return json(request, { error: "No se pudo generar un juego ahora mismo. " + (error?.message || "Inténtalo de nuevo más tarde.") }, 502);
    }
  }
}
