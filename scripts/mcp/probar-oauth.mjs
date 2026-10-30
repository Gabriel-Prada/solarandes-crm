// Prueba del servidor MCP de la fase 5 haciendo lo mismo que Claude al conectarse (docs/mcp-instalacion.md).
// Necesita el CRM local, la Site URL de Supabase en http://localhost:3000 y MCP_PERMITIR_INSPECTOR=si.
// Uso (desde scripts/mcp):
//   1. node probar-oauth.mjs escuchar   -> deja un buzón en localhost:6274 que recibe el código y prueba solo
//      (con PIEZA2=1 prueba las consultas; con PIEZA3=1, las acciones)
//   2. node probar-oauth.mjs inicio     -> registra una app y escribe la dirección de autorización;
//      ábrela en el navegador con la sesión de la gerente y autoriza (vence en pocos minutos)
//   node probar-oauth.mjs mcp           -> vuelve a probar con la llave guardada
// OJO: PIEZA3=1 ESCRIBE en la base de verdad (actividades y la etapa de O0773). Al terminar hay que borrar
// lo creado, devolver O0773 a su etapa y borrar la app de prueba (docs/plan-fase-5.md, pieza 3, cuenta cómo).
// La llave nunca se imprime: se guarda en scripts/mcp/oauth-*.json (fuera de GitHub). Bórrala al terminar.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ESTADO = join(AQUI, "oauth-estado.json");
const SUPABASE = "https://sfvspgtyfpkxnuzgtgaz.supabase.co";
const MCP = "http://localhost:3000/api/mcp";
const REGRESO = "http://localhost:6274/oauth/callback";
const b64url = (b) => Buffer.from(b).toString("base64url");

async function inicio() {
  // 1. Lo que hace Claude: preguntarle al MCP dónde se entra
  const r401 = await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const desafio = r401.headers.get("www-authenticate");
  const metaUrl = /resource_metadata="([^"]+)"/.exec(desafio)[1];
  const meta = await (await fetch(metaUrl)).json();
  const emisor = meta.authorization_servers[0];
  const u = new URL(emisor);
  const as = await (await fetch(`${u.origin}/.well-known/oauth-authorization-server${u.pathname}`)).json();
  console.log("MCP respondió", r401.status, "| servidor de llaves:", as.issuer);

  // 2. Registrarse como app (registro automático), o reusar la app ya registrada (y aprobada)
  let previo = null;
  try {
    previo = JSON.parse(readFileSync(ESTADO, "utf8"));
  } catch {}
  const reg = previo ? { ok: true, json: async () => ({ client_id: previo.clientId }) } : await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Prueba local (como MCP Inspector)",
      redirect_uris: [REGRESO],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const cliente = await reg.json();
  if (!reg.ok) throw new Error(`Registro rechazado ${reg.status}: ${JSON.stringify(cliente)}`);

  // 3. Pedir permiso con PKCE (el "candado de un solo uso" del código)
  const verificador = b64url(randomBytes(32));
  const reto = b64url(createHash("sha256").update(verificador).digest());
  const state = b64url(randomBytes(16));
  const auth = new URL(as.authorization_endpoint);
  auth.search = new URLSearchParams({
    response_type: "code",
    client_id: cliente.client_id,
    redirect_uri: REGRESO,
    code_challenge: reto,
    code_challenge_method: "S256",
    state,
    resource: meta.resource,
  }).toString();
  writeFileSync(ESTADO, JSON.stringify({ clientId: cliente.client_id, verificador, state, tokenEndpoint: as.token_endpoint }));
  console.log("App registrada:", cliente.client_id);
  console.log("AUTORIZAR:", auth.toString());
}

async function fin(urlRegreso) {
  const estado = JSON.parse(readFileSync(ESTADO, "utf8"));
  const params = new URL(urlRegreso).searchParams;
  if (params.get("error")) throw new Error(`Autorización rechazada: ${params.get("error")}`);
  if (params.get("state") !== estado.state) throw new Error("El state no coincide");

  const r = await fetch(estado.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.get("code"),
      redirect_uri: REGRESO,
      client_id: estado.clientId,
      code_verifier: estado.verificador,
    }),
  });
  const tokens = await r.json();
  if (!r.ok) throw new Error(`Cambio de código rechazado ${r.status}: ${JSON.stringify(tokens)}`);
  writeFileSync(join(AQUI, "oauth-llave.json"), JSON.stringify(tokens));
  if (process.env.PIEZA2) {
    await probarMcp(tokens.access_token);
    return probarPieza2(tokens.access_token);
  }
  if (process.env.PIEZA3) return probarPieza3(tokens.access_token);

  const claims = JSON.parse(Buffer.from(tokens.access_token.split(".")[1], "base64url").toString());
  console.log("Llave recibida. Marcas:", Object.keys(claims).sort().join(", "));
  console.log("client_id presente:", claims.client_id === estado.clientId, "| rol:", claims.role, "| vence en", claims.exp - Math.floor(Date.now() / 1000), "s");

  await probarMcp(tokens.access_token);
}

async function rpc(llave, cuerpo) {
  const r = await fetch(MCP, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${llave}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  const json = texto.startsWith("event:") || texto.startsWith("data:") ? JSON.parse(texto.split("data: ")[1]) : JSON.parse(texto || "{}");
  return { status: r.status, json };
}

async function probarMcp(llave) {
  const init = await rpc(llave, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba-local", version: "1" } },
  });
  console.log("initialize:", init.status, init.json.result?.serverInfo?.name ?? JSON.stringify(init.json));
  const lista = await rpc(llave, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  console.log("tools/list:", lista.status, (lista.json.result?.tools ?? []).map((t) => t.name).join(", ") || JSON.stringify(lista.json));
  const quien = await rpc(llave, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "quien_soy", arguments: {} } });
  console.log("quien_soy:", quien.status, quien.json.result?.content?.[0]?.text ?? JSON.stringify(quien.json));
  const busca = await rpc(llave, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "buscar_cliente", arguments: { texto: "panaderia" } },
  });
  console.log("buscar_cliente('panaderia'):", busca.status, busca.json.result?.content?.[0]?.text ?? JSON.stringify(busca.json));
}

async function mcpConLlaveGuardada() {
  const tokens = JSON.parse(readFileSync(join(AQUI, "oauth-llave.json"), "utf8"));
  await probarMcp(tokens.access_token);
  await probarPieza2(tokens.access_token);
}

// Pieza 3: las acciones, como Laura desde Claude, sobre la venta O0773 (cliente C0771)
async function probarPieza3(llave) {
  let id = 100;
  const herramienta = async (name, args = {}) => {
    const r = await rpc(llave, { jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } });
    const c = r.json.result;
    return `${c?.isError ? "✗" : "✓"} ${c?.content?.[0]?.text ?? JSON.stringify(r.json)}`;
  };
  const en = (dias, hora) => {
    const d = new Date(Date.now() - 5 * 3600e3 + dias * 86400e3).toISOString().slice(0, 10);
    return `${d} ${hora}`;
  };
  const lista = await rpc(llave, { jsonrpc: "2.0", id: id++, method: "tools/list" });
  console.log("HERRAMIENTAS:", (lista.json.result?.tools ?? []).map((t) => `${t.name}${t.annotations?.readOnlyHint === false ? "(escribe)" : ""}`).join(", "));
  const nota = { cliente: "c771", venta: "o773", tipo: "llamada", descripcion: "Prueba fase 5 desde Claude: llamó para preguntar por financiación" };
  console.log("\nregistrar_actividad:", await herramienta("registrar_actividad", nota));
  console.log("registrar_actividad (repetida):", await herramienta("registrar_actividad", nota));
  console.log("registrar_actividad (tarea mañana 7:30 pm):", await herramienta("registrar_actividad", { cliente: "C0771", tipo: "tarea", descripcion: "Prueba fase 5: enviar simulación de financiación", fecha_hora: en(1, "19:30") }));
  console.log("registrar_actividad (cliente que no existe):", await herramienta("registrar_actividad", { cliente: "C99999", tipo: "nota", descripcion: "Prueba fase 5" }));
  console.log("\nmover_venta(ganado):", await herramienta("mover_venta", { venta: "O0773", etapa: "ganado" }));
  console.log("mover_venta(perdido, sin motivo):", await herramienta("mover_venta", { venta: "O0773", etapa: "perdido" }));
  console.log("mover_venta(negociacion):", await herramienta("mover_venta", { venta: "O0773", etapa: "negociacion" }));
  console.log("\nagendar_visita(cliente, en 40 días):", await herramienta("agendar_visita", { cliente: "C0771", fecha_hora: en(40, "09:00") }));
  console.log("agendar_visita(cliente, en 3 días 9:00):", await herramienta("agendar_visita", { cliente: "C0771", fecha_hora: en(3, "09:00"), nota: "Prueba fase 5: techo de teja" }));
  console.log("agendar_visita(repetida):", await herramienta("agendar_visita", { venta: "O0773", fecha_hora: en(3, "09:00") }));
  console.log("agendar_visita(el jueves):", await herramienta("agendar_visita", { venta: "O0773", fecha_hora: "el jueves" }));
}

// Pieza 2: cada consulta y cada resource, con casos difíciles
async function probarPieza2(llave) {
  let id = 10;
  const herramienta = async (name, args = {}) => {
    const r = await rpc(llave, { jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } });
    const c = r.json.result;
    return { status: r.status, error: c?.isError, texto: c?.content?.[0]?.text ?? JSON.stringify(r.json) };
  };
  const recurso = async (uri) => {
    const r = await rpc(llave, { jsonrpc: "2.0", id: id++, method: "resources/read", params: { uri } });
    return r.json.result?.contents?.[0]?.text ?? `ERROR ${JSON.stringify(r.json.error ?? r.json)}`;
  };
  const corto = (t, n = 400) => (t.length > n ? `${t.slice(0, n)}…(${t.length} letras)` : t);

  const lista = await rpc(llave, { jsonrpc: "2.0", id: id++, method: "tools/list" });
  console.log("\nHERRAMIENTAS:", (lista.json.result?.tools ?? []).map((t) => t.name).join(", "));

  const f = await herramienta("ver_ficha", { codigo: "c153" });
  console.log("\nver_ficha(c153):", corto(f.texto, 700));
  console.log("  ¿trae teléfono o correo?", /\+57|@/.test(f.texto));
  console.log("ver_ficha(C99999):", (await herramienta("ver_ficha", { codigo: "C99999" })).texto);
  console.log("ver_ficha('panaderia'):", (await herramienta("ver_ficha", { codigo: "panaderia" })).texto);

  const v = await herramienta("ver_ventas");
  console.log("\nver_ventas():", corto(v.texto, 500));
  console.log("  ¿trae teléfono o correo?", /\+57|@/.test(v.texto));
  console.log("ver_ventas(alta):", corto((await herramienta("ver_ventas", { prioridad: "alta" })).texto, 300));
  console.log("ver_ventas(andres, bogota):", corto((await herramienta("ver_ventas", { asesor: "andres", ciudad: "bogota" })).texto, 300));
  console.log("ver_ventas(ganado, Cali):", corto((await herramienta("ver_ventas", { etapa: "ganado", ciudad: "Cali" })).texto, 200));
  console.log("ver_ventas(Marcela):", (await herramienta("ver_ventas", { asesor: "Marcela" })).texto);
  console.log("ver_ventas(Barranquilla):", (await herramienta("ver_ventas", { ciudad: "Barranquilla" })).texto);

  const s = JSON.parse((await herramienta("ventas_sin_seguimiento")).texto);
  console.log("\nventas_sin_seguimiento: hoy", s.hoy, "| 3+ días:", s.total_sin_seguimiento_3_dias, "| 7+ días:", s.total_aviso_gerente_7_dias);
  console.log("  por asesor:", JSON.stringify(s.por_asesor));
  console.log("  la más olvidada:", JSON.stringify(s.ventas_mas_olvidadas?.[0]));

  const p = JSON.parse((await herramienta("panel_del_negocio")).texto);
  console.log("\npanel_del_negocio:", JSON.stringify(p.indicadores));
  console.log("  asesores:", JSON.stringify(p.asesores?.map((a) => [a.nombre, a.sin_seguimiento])));

  const a = await herramienta("ver_agenda_tecnica");
  console.log("\nver_agenda_tecnica():", corto(a.texto, 500));
  console.log("ver_agenda_tecnica(3 meses):", (await herramienta("ver_agenda_tecnica", { desde: "2026-10-01", hasta: "2026-12-31" })).texto);
  console.log("ver_agenda_tecnica(30/10/2026):", (await herramienta("ver_agenda_tecnica", { desde: "30/10/2026" })).texto);

  console.log("\ncalcular_precio(300, bogota):", (await herramienta("calcular_precio", { consumo_kwh_mes: 300, ciudad: "bogota" })).texto);
  console.log("calcular_precio(300, Pasto):", (await herramienta("calcular_precio", { consumo_kwh_mes: 300, ciudad: "Pasto" })).texto);

  const rl = await rpc(llave, { jsonrpc: "2.0", id: id++, method: "resources/list" });
  const tl = await rpc(llave, { jsonrpc: "2.0", id: id++, method: "resources/templates/list" });
  console.log("\nRESOURCES:", (rl.json.result?.resources ?? []).map((r) => r.uri).join(", "), "| PLANTILLAS:", (tl.json.result?.resourceTemplates ?? []).map((r) => r.uriTemplate).join(", "));
  console.log("catalogo:", corto(await recurso("solarandes://catalogo"), 300));
  console.log("precios:", corto(await recurso("solarandes://precios"), 400));
  const fc = await recurso("solarandes://clientes/C0153");
  console.log("clientes/C0153: ¿trae teléfono?", /\+57/.test(fc), "|", corto(fc, 250));
  console.log("clientes/xyz:", corto(await recurso("solarandes://clientes/xyz"), 200));
}

// Buzón en localhost:6274: recibe el regreso con el código y termina el intercambio solo
async function escuchar() {
  const { createServer } = await import("node:http");
  const servidor = createServer(async (req, res) => {
    if (!req.url.startsWith("/oauth/callback")) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("Listo: el codigo llego. Puedes cerrar esta pestana.");
    try {
      await fin(`http://localhost:6274${req.url}`);
    } catch (e) {
      console.log("ERROR:", e.message);
    }
    servidor.close();
  });
  servidor.listen(6274, () => console.log("Buzón escuchando en localhost:6274"));
}

const [accion, arg] = process.argv.slice(2);
if (accion === "escuchar") await escuchar();
else if (accion === "inicio") await inicio();
else if (accion === "fin") await fin(arg);
else if (accion === "mcp") await mcpConLlaveGuardada();
else console.log("Uso: inicio | fin <url> | mcp");
