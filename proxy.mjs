#!/usr/bin/env node
/*
 * Local relay for resume-bench. Holds the Gemini API key server-side so it
 * never enters the page, and answers the browser's CORS preflight so the HTML
 * can be opened straight off disk.
 *
 * Run:  node proxy.mjs      (reads GEMINI_API_KEY from .env, or the environment)
 *
 * Deliberately dumb: it adds the key header and forwards the body untouched.
 * The page speaks the Gemini request shape directly, so swapping providers
 * means changing UPSTREAM, AUTH_HEADER, and ask() — nothing in between.
 *
 * Binds to loopback only. Nothing here is written for exposure to a network.
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* .env beside this script keeps the key out of shell history. Optional — an
   exported GEMINI_API_KEY works too, and already-set vars win over the file. */
const ENV_FILE = fileURLToPath(new URL(".env", import.meta.url));
const KEY_WAS_PRESET = process.env.GEMINI_API_KEY !== undefined;
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const KEY_SOURCE = KEY_WAS_PRESET
  ? "the environment — this overrides .env; `unset GEMINI_API_KEY` to use the file"
  : existsSync(ENV_FILE) ? ".env" : "the environment";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
const UPSTREAM = "https://generativelanguage.googleapis.com/v1beta/interactions";
const AUTH_HEADER = "x-goog-api-key";
const LOCAL_PATH = "/v1beta/interactions";
const MAX_BODY_BYTES = 1_000_000;

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error(
    `GEMINI_API_KEY is not set. Get a key at https://aistudio.google.com/apikey,\n` +
    `then put it in a .env file beside this script:\n` +
    `  echo 'GEMINI_API_KEY=...' > ${ENV_FILE}\n` +
    `and run: node proxy.mjs`
  );
  process.exit(1);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Retry-After",
  "Access-Control-Max-Age": "86400"
};

function sendJSON(res, status, payload) {
  res.writeHead(status, { ...CORS_HEADERS, "Content-Type": "application/json" });
  res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Request body over ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function forward(body) {
  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "content-type": "application/json", [AUTH_HEADER]: API_KEY },
    body
  });
  /* Pass Retry-After through — ask() needs it to pace itself against the
     free tier, whose limits are per-account and not published. */
  return {
    status: upstream.status,
    text: await upstream.text(),
    retryAfter: upstream.headers.get("retry-after")
  };
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith(LOCAL_PATH)) {
    sendJSON(res, 404, { error: { message: `This proxy serves POST ${LOCAL_PATH} only.` } });
    return;
  }
  try {
    const body = await readBody(req);
    const { status, text, retryAfter } = await forward(body);
    const headers = { ...CORS_HEADERS, "Content-Type": "application/json" };
    if (retryAfter) headers["Retry-After"] = retryAfter;
    res.writeHead(status, headers);
    res.end(text);
  } catch (e) {
    console.error("proxy error:", e.message);
    sendJSON(res, 502, { error: { message: `Proxy could not reach the API: ${e.message}` } });
  }
});

server.on("error", e => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — another copy is probably running. Stop it, or start this one with PORT=${PORT + 1} node proxy.mjs`);
  } else {
    console.error(`Proxy could not start: ${e.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`resume-bench proxy listening on http://localhost:${PORT} -> ${UPSTREAM}`);
  console.log(`using key ...${API_KEY.slice(-4)} from ${KEY_SOURCE}`);
});
