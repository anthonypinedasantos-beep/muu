const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (data, status=200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
async function getJson(url) {
  const res = await fetch(url, { headers: { "accept": "application/json", "user-agent": "RBXCONDOS/1.0" } });
  if (!res.ok) throw new Error("Roblox API respondió " + res.status);
  return res.json();
}
function collectCandidates(value, out=[], seen=new Set()) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) { for (const item of value) collectCandidates(item,out,seen); return out; }
  const id = value.universeId ?? value.universeID;
  const place = value.rootPlaceId ?? value.placeId ?? value.root_place_id;
  if ((id || place) && (value.name || value.title || value.gameName)) {
    const key=String(id||place);
    if(!seen.has(key)){seen.add(key);out.push({universeId:id?String(id):null,placeId:place?String(place):null,name:value.name||value.title||value.gameName,creator:value.creatorName||value.creator?.name||value.creator?.username||value.creatorName,playing:value.playerCount||value.playing||0});}
  }
  for(const [k,v] of Object.entries(value)) if(v && typeof v==="object") collectCandidates(v,out,seen);
  return out;
}
async function universeFromPlace(placeId) {
  const d=await getJson("https://apis.roblox.com/universes/v1/places/"+encodeURIComponent(placeId)+"/universe");
  return d.universeId ? String(d.universeId) : null;
}
export async function onRequestGet({ request }) {
  const url=new URL(request.url), q=(url.searchParams.get("q")||"").trim().slice(0,80);
  if(q.length<2) return json({error:"Escribe al menos 2 caracteres."},400);
  try {
    const searchUrl=new URL("https://apis.roblox.com/search-api/omni-search");
    searchUrl.searchParams.set("searchQuery",q);
    searchUrl.searchParams.set("pageType","Game");
    searchUrl.searchParams.set("sessionId",crypto.randomUUID());
    searchUrl.searchParams.set("pageToken","");
    const searchData=await getJson(searchUrl);
    const candidates=collectCandidates(searchData).slice(0,35);
    const resolved=await Promise.all(candidates.map(async c=>{
      try { const universeId=c.universeId || (c.placeId?await universeFromPlace(c.placeId):null); return universeId?{...c,universeId}:null; } catch { return null; }
    }));
    const ids=[...new Set(resolved.filter(Boolean).map(x=>x.universeId))];
    if(!ids.length) return json({games:[]});
    const details=await getJson("https://games.roblox.com/v1/games?universeIds="+ids.join(","));
    const detailMap=new Map((details.data||[]).map(g=>[String(g.id),g]));
    const eligible=resolved.filter(Boolean).map(c=>({candidate:c,game:detailMap.get(c.universeId)})).filter(x=>x.game && Number(x.game.maxPlayers)===3);
    const thumbIds=eligible.map(x=>x.game.id);
    let thumbs={};
    if(thumbIds.length){
      try{
        const t=await getJson("https://thumbnails.roblox.com/v1/games/icons?universeIds="+thumbIds.join(",")+"&size=512x512&format=Png&isCircular=false");
        for(const item of t.data||[]) if(item.imageUrl) thumbs[String(item.targetId)]=item.imageUrl;
      }catch{}
    }
    const games=eligible.map(({candidate:c,game:g})=>({
      universeId:String(g.id),placeId:String(g.rootPlaceId||c.placeId||""),name:g.name||c.name||"Experiencia de Roblox",
      creator:g.creator?.name||c.creator||"Creador de Roblox",playing:Number(g.playing||c.playing||0),
      maxPlayers:Number(g.maxPlayers),thumbnail:thumbs[String(g.id)]||""
    })).filter(g=>g.placeId).slice(0,24);
    return json({games});
  } catch(error) {
    return json({error:"No se pudo buscar en Roblox en este momento. "+(error?.message||"Inténtalo de nuevo más tarde.")},502);
  }
}