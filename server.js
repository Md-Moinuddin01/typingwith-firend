const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const port = Number(process.env.PORT || 8123);
const root = __dirname;
const rooms = new Map();

const wordBank = [
  "future", "quiet", "silver", "garden", "simple", "motion", "bright", "typing",
  "wonder", "planet", "coffee", "window", "signal", "memory", "little", "object",
  "orange", "forest", "canvas", "pocket", "school", "smooth", "rocket", "number",
  "circle", "button", "friend", "stream", "branch", "summer", "winter", "castle",
  "engine", "reason", "yellow", "purple", "market", "visual", "energy", "honest",
  "lesson", "center", "shadow", "travel", "phrase", "minute", "record", "custom",
  "change", "office", "create", "public", "design", "studio", "letter", "steady"
];

const commaBank = [
  "pause, type, continue", "read, think, write", "slow, clean, correct",
  "start, focus, finish", "left, right, center", "small, clear, useful",
  "today, tomorrow, later", "one, two, three", "plan, build, test"
];

const quoteBank = [
  "\"type with calm\"", "\"speed follows accuracy\"", "\"focus on the next word\"",
  "\"small steps count\"", "\"practice makes rhythm\"", "\"clean typing wins\"",
  "\"keep your hands steady\"", "\"accuracy before speed\""
];

const modeNames = new Set(["words", "numbers", "commas", "quotes", "mixed"]);
const durations = new Set([60, 120, 180, 240, 300]);

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function makePiece(mode) {
  if (mode === "numbers") return String(Math.floor(100 + Math.random() * 9900));
  if (mode === "commas") return randomItem(commaBank);
  if (mode === "quotes") return randomItem(quoteBank);
  if (mode === "mixed") return makePiece(randomItem(["words", "numbers", "commas", "quotes"]));
  return randomItem(wordBank);
}

function makeText(mode) {
  const parts = [];
  const count = mode === "numbers" ? 420 : 300;
  for (let i = 0; i < count; i++) parts.push(makePiece(mode));
  return parts.join(" ");
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? makeCode() : code;
}

function cleanName(name) {
  return String(name || "Player").trim().slice(0, 18) || "Player";
}

function makePlayer(name) {
  return {
    id: crypto.randomUUID(),
    name: cleanName(name),
    progress: 0,
    wpm: 0,
    acc: 100,
    errors: 0,
    done: false,
    joinedAt: Date.now(),
    updatedAt: Date.now()
  };
}

function roomView(room) {
  return {
    code: room.code,
    mode: room.mode,
    duration: room.duration,
    text: room.text,
    players: Array.from(room.players.values())
      .sort((a, b) => b.progress - a.progress || a.joinedAt - b.joinedAt)
      .map((player) => ({
        name: player.name,
        progress: player.progress,
        wpm: player.wpm,
        acc: player.acc,
        errors: player.errors,
        done: player.done
      }))
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveFile(req, res) {
  const url = new URL(req.url, "http://local");
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const safeName = path.normalize(name).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(root, safeName);
  const ext = path.extname(file).toLowerCase();
  const type = ext === ".js" ? "text/javascript" : "text/html; charset=utf-8";

  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}

function createRoom(body) {
  const mode = modeNames.has(body.mode) ? body.mode : "words";
  const duration = durations.has(Number(body.duration)) ? Number(body.duration) : 60;
  const code = makeCode();
  const player = makePlayer(body.name);
  const room = {
    code,
    mode,
    duration,
    text: makeText(mode),
    players: new Map([[player.id, player]]),
    createdAt: Date.now()
  };
  rooms.set(code, room);
  return { room, playerId: player.id };
}

function getLanAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) addresses.push(item.address);
    }
  }
  return addresses;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");

  try {
    if (req.method === "POST" && url.pathname === "/api/create") {
      const body = await readJson(req);
      const { room, playerId } = createRoom(body);
      sendJson(res, 200, { playerId, room: roomView(room) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/join") {
      const body = await readJson(req);
      const code = String(body.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return sendJson(res, 404, { error: "Challenge code not found." });

      const player = makePlayer(body.name);
      room.players.set(player.id, player);
      sendJson(res, 200, { playerId: player.id, room: roomView(room) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/progress") {
      const body = await readJson(req);
      const room = rooms.get(String(body.code || "").trim().toUpperCase());
      if (!room) return sendJson(res, 404, { error: "Challenge room not found." });

      const player = room.players.get(body.playerId);
      if (!player) return sendJson(res, 404, { error: "Player not found." });

      player.name = cleanName(body.name);
      player.progress = Math.max(0, Math.min(100, Math.round(Number(body.progress) || 0)));
      player.wpm = Math.max(0, Math.round(Number(body.wpm) || 0));
      player.acc = Math.max(0, Math.min(100, Math.round(Number(body.acc) || 0)));
      player.errors = Math.max(0, Math.round(Number(body.errors) || 0));
      player.done = Boolean(body.done);
      player.updatedAt = Date.now();
      sendJson(res, 200, roomView(room));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/room") {
      const code = String(url.searchParams.get("code") || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return sendJson(res, 404, { error: "Challenge code not found." });
      sendJson(res, 200, roomView(room));
      return;
    }

    if (req.method === "GET") {
      await serveFile(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch {
    sendJson(res, 500, { error: "Server error." });
  }
});

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff) rooms.delete(code);
  }
}, 60 * 1000);

server.listen(port, "0.0.0.0", () => {
  console.log(`TypeFlow running at http://localhost:${port}`);
  for (const address of getLanAddresses()) {
    console.log(`Other devices on your network can try http://${address}:${port}`);
  }
});
