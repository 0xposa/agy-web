#!/usr/bin/env node
/**
 * Antigravity Web Server & AI Bridge (agy-web)
 *
 * 1. Uses a 100% isolated database & config directory (/root/projects/agy-web/data)
 *    so it never touches or conflicts with `opencode pair` (/root/.local/share/opencode).
 * 2. Serves the customized Antigravity Web UI from /root/projects/agy-web/dist.
 * 3. Filters /api/model, /api/provider, /api/integration, /api/skill, and /api/command
 *    so ONLY Antigravity models, providers, skills, and slash commands exist.
 * 4. Provides an OpenAI-compatible AI Bridge (/v1/chat/completions) powered by
 *    `/root/.local/bin/agy.bin` with automatic account rotation via `agy-switcher`.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawn, execSync, execFile } = require("child_process");

const DIST_DIR = path.join(__dirname, "dist");
const DATA_DIR = "/root/.agy-web-data";
const XDG_CONFIG_HOME = path.join(DATA_DIR, "config");
const XDG_DATA_HOME = path.join(DATA_DIR, "share");
const XDG_STATE_HOME = path.join(DATA_DIR, "state");
const XDG_CACHE_HOME = path.join(DATA_DIR, "cache");

const ENGINE_CONFIG_DIR = path.join(XDG_CONFIG_HOME, "opencode");
const ENGINE_STATE_DIR = path.join(XDG_STATE_HOME, "opencode");
const ENGINE_JSONC = path.join(ENGINE_CONFIG_DIR, "opencode.jsonc");
const ENGINE_MODEL_STATE = path.join(ENGINE_STATE_DIR, "model.json");
const SECRET_FILE = path.join(DATA_DIR, "secret.json");
const STATE_FILE = path.join(__dirname, ".agy-web-state.json");

const PORT = Number(process.env.AGY_WEB_PORT || 49375);
const HOST = process.env.AGY_WEB_HOST || "0.0.0.0";
const ENGINE_HOST = "127.0.0.1";
const ENGINE_PORT = Number(process.env.AGY_ENGINE_PORT || 49373);

const AGY_MODELS = {
  "gemini-4-argon": {
    name: "Gemini 4 Argon",
    family: "gemini-4-argon",
    variants: ["low", "medium", "high"],
    defaultEffort: "low",
    limit: { context: 1000000, output: 65536 },
  },
  "gemini-3.8-flash": {
    name: "Gemini 3.8 Flash",
    family: "gemini-3.8-flash",
    variants: ["low", "medium", "high"],
    defaultEffort: "low",
    limit: { context: 1000000, output: 65536 },
  },
  "claude-opus-5-5": {
    name: "Claude Opus 5.5",
    family: "claude-opus-5-5",
    variants: ["low", "medium", "high"],
    defaultEffort: "low",
    limit: { context: 200000, output: 32000 },
  },
  "claude-sonnet-5-5": {
    name: "Claude Sonnet 5.5",
    family: "claude-sonnet-5-5",
    variants: ["low", "medium", "high"],
    defaultEffort: "low",
    limit: { context: 200000, output: 32000 },
  },
  "gpt-oss-120b": {
    name: "GPT-OSS 120B",
    family: "gpt-oss-120b",
    variants: ["medium"],
    defaultEffort: "medium",
    limit: { context: 128000, output: 32000 },
  },
};

const AGY_SKILLS = [
  {
    id: "antigravity-guide",
    name: "Antigravity Guide",
    description:
      "Comprehensive guide and quick reference for Google DeepMind Antigravity (agy), CLI flags, slash commands, and customizations.",
    path: "/root/.gemini/antigravity-cli/builtin/skills/antigravity_guide/SKILL.md",
    content: "# Antigravity Guide\nUse this skill for configuring and using Google DeepMind Antigravity.",
  },
  {
    id: "agy-customizations",
    name: "Antigravity Customizations",
    description:
      "Guide for the Antigravity Customization System: skills, rules, plugins, hooks, and MCP servers.",
    path: "/root/.gemini/antigravity-cli/builtin/skills/agy-customizations/SKILL.md",
    content: "# Antigravity Customizations\nReference for creating skills, rules, plugins, hooks, and MCP servers.",
  },
  {
    id: "antigravity-switcher",
    name: "Antigravity Auto-Rotation Switcher",
    description:
      "Mengaktifkan dan menonaktifkan fitur Zero-Interruption Auto-Rotation pada batas kuota (HTTP 429). Trigger dengan /antigravity-switcher.",
    path: "/root/.gemini/antigravity-cli/skills/antigravity-switcher/SKILL.md",
    content: "# Antigravity Auto-Rotation Switcher\nToggle automatic account rotation on HTTP 429 quota limits.",
  },
  {
    id: "switcher-account",
    name: "Antigravity Account Switcher",
    description:
      "Native Antigravity Account Switcher. Mengganti akun Google Antigravity secara interaktif. Trigger dengan /switcher-account.",
    path: "/root/.gemini/antigravity-cli/skills/switcher-account/SKILL.md",
    content: "# Antigravity Account Switcher\nSwitch active Google Antigravity account interactively.",
  },
  {
    id: "memory-bank",
    name: "Memory Bank",
    description:
      "Manages persistent project memory, session continuity, and active context (/root/.gemini/config/MEMORY.md).",
    path: "/root/.gemini/config/skills/memory-bank/SKILL.md",
    content: "# Memory Bank\nPersistent user and environment memory management.",
  },
];

const AGY_COMMANDS = [
  // 1. Quota & CLI inspection utilities
  { name: "usage", description: "View model quota and rate limits (alias: quota)" },
  { name: "quota", description: "View model quota and rate limits" },
  { name: "credits", description: "Show remaining G1 credits and purchase link" },
  { name: "skills", description: "List available skills and custom tools" },
  { name: "agents", description: "List available custom agents" },
  { name: "changelog", description: "Show Antigravity release notes and changes" },
  { name: "effort", description: "Set or inspect reasoning effort (low|medium|high|xhigh|max)" },
  { name: "help", description: "Show available commands and keybindings" },
  { name: "permissions", description: "Manage tool permissions" },
  { name: "hooks", description: "Manage hook configurations for tool events" },
  { name: "plugin", description: "Manage plugins (install, list, enable, disable)" },
  { name: "config", description: "Open settings and configuration panel" },

  // 2. Autonomous directives & workflows
  { name: "goal", description: "Run a thorough autonomous goal until fully achieved" },
  { name: "plan", description: "Step-by-step architectural planning before execution" },
  { name: "boost", description: "Deep thinking, strategic planning, and rigorous verification" },
  { name: "review", description: "Thorough code review of local changes, branch, CL, or files" },
  { name: "grill-me", description: "Interactive design interview to align on requirements" },
  { name: "teamwork", description: "Coordinate a swarm of autonomous Antigravity agents" },
  { name: "compact", description: "Compact and summarize conversation context" },
  { name: "schedule", description: "Run an instruction on a recurring schedule or timer" },
  { name: "browser", description: "Interact with web pages or search the live web" },
  { name: "learn", description: "Persist learned preferences and setup into memory" },

  // 3. Antigravity switcher & accounts
  { name: "antigravity-switcher", description: "Toggle Zero-Interruption Auto-Rotation on HTTP 429 quota limits" },
  { name: "switcher-account", description: "Switch active Google Antigravity account interactively" },
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

let activeDirectory = "/root";

function getOrCreateEngineSecret() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SECRET_FILE, "utf8"));
      if (parsed.password) return parsed.password;
    }
  } catch {}
  const password = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(SECRET_FILE, JSON.stringify({ password }, null, 2) + "\n", { mode: 0o600 });
  return password;
}

const ENGINE_PASSWORD = getOrCreateEngineSecret();
const ENGINE_BASIC_AUTH = "Basic " + Buffer.from(`opencode:${ENGINE_PASSWORD}`).toString("base64");

function setupIsolatedEngineConfig() {
  fs.mkdirSync(ENGINE_CONFIG_DIR, { recursive: true });
  fs.mkdirSync(XDG_DATA_HOME, { recursive: true });
  fs.mkdirSync(ENGINE_STATE_DIR, { recursive: true });
  fs.mkdirSync(XDG_CACHE_HOME, { recursive: true });

  const engineModelsConfig = {};
  for (const [id, info] of Object.entries(AGY_MODELS)) {
    engineModelsConfig[id] = {
      name: info.name,
      limit: info.limit,
    };
  }

  const cfg = {
    $schema: "https://opencode.ai/config.json",
    model: "antigravity/gemini-3.8-flash",
    snapshot: false,
    disabled_providers: ["opencode", "openai", "vikey", "or", "apinex", "openrouter"],
    providers: {
      antigravity: {
        name: "Antigravity (Google DeepMind)",
        package: "@opencode/ai/providers/openai-compatible",
        settings: {
          baseURL: `http://127.0.0.1:${PORT}/v1`,
          apiKey: "agy-local-bridge",
        },
        models: engineModelsConfig,
      },
    },
  };
  fs.writeFileSync(ENGINE_JSONC, JSON.stringify(cfg, null, 2) + "\n");

  const modelState = {
    recent: [
      { providerID: "antigravity", modelID: "gemini-3.8-flash" },
      { providerID: "antigravity", modelID: "gemini-4-argon" },
      { providerID: "antigravity", modelID: "claude-opus-5-5" },
      { providerID: "antigravity", modelID: "claude-sonnet-5-5" },
      { providerID: "antigravity", modelID: "gpt-oss-120b" },
    ],
    favorite: [
      { providerID: "antigravity", modelID: "gemini-3.8-flash" },
      { providerID: "antigravity", modelID: "gemini-4-argon" },
      { providerID: "antigravity", modelID: "claude-opus-5-5" },
      { providerID: "antigravity", modelID: "claude-sonnet-5-5" },
      { providerID: "antigravity", modelID: "gpt-oss-120b" },
    ],
    variant: {
      "antigravity/gemini-3.8-flash": "low",
      "antigravity/gemini-4-argon": "low",
      "antigravity/claude-opus-5-5": "low",
      "antigravity/claude-sonnet-5-5": "low",
      "antigravity/gpt-oss-120b": "medium",
    },
  };
  fs.writeFileSync(ENGINE_MODEL_STATE, JSON.stringify(modelState, null, 2) + "\n");
}

function buildAntigravityModelObject(id, info) {
  const allowedVariants = info.variants || ["low", "medium", "high"];
  return {
    id,
    modelID: id,
    providerID: "antigravity",
    name: info.name,
    family: info.family || id,
    package: "@opencode/ai/providers/openai-compatible",
    settings: {
      apiKey: "agy-local-bridge",
      baseURL: `http://127.0.0.1:${PORT}/v1`,
    },
    capabilities: {
      tools: true,
      input: ["text", "image"],
      output: ["text"],
    },
    variants: allowedVariants.map((v) => ({
      id: v,
      settings: { reasoningEffort: v },
    })),
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: info.limit,
  };
}

function buildAntigravityModelsList() {
  return Object.entries(AGY_MODELS).map(([id, info]) => buildAntigravityModelObject(id, info));
}

function buildAntigravityProviderObject() {
  return {
    id: "antigravity",
    name: "Antigravity (Google DeepMind)",
    activation: "enabled",
    package: "@opencode/ai/providers/openai-compatible",
    settings: {
      apiKey: "agy-local-bridge",
      baseURL: `http://127.0.0.1:${PORT}/v1`,
    },
  };
}

function computeCspForHtml(html) {
  const m = html.match(
    /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(["'])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i
  );
  const hash = m ? crypto.createHash("sha256").update(m[2]).digest("base64") : "";
  return `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${
    hash ? ` 'sha256-${hash}'` : ""
  }; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; media-src 'self' data:; connect-src * data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'self' blob:`;
}

const brCache = new Map();

function serveStaticAsset(req, res, urlObj) {
  let relPath = decodeURIComponent(urlObj.pathname).replace(/^\/+/, "");
  if (!relPath) relPath = "index.html";

  let filePath = path.join(DIST_DIR, relPath);
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  if (!exists) {
    if (relPath.startsWith("_assets/") || relPath.startsWith("icons/")) {
      res.writeHead(404, { "cache-control": "no-store" });
      res.end("Not Found");
      return;
    }
    relPath = "index.html";
    filePath = path.join(DIST_DIR, "index.html");
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }

  const ext = path.extname(relPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const isIndex = relPath === "index.html";
  const isNoCache = isIndex || relPath === "sw.js" || relPath === "registerSW.js";
  const rawBuf = fs.readFileSync(filePath);

  const acceptEncoding = req.headers["accept-encoding"] || "";
  const supportsBr = !isIndex && /\bbr\b/.test(acceptEncoding);

  let bodyBuf = rawBuf;
  const headers = {
    "content-type": contentType,
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    "pragma": "no-cache",
    "expires": "0",
    "content-security-policy": isIndex ? computeCspForHtml(rawBuf.toString("utf8")) : computeCspForHtml(""),
    "x-content-type-options": "nosniff",
  };

  if (supportsBr && rawBuf.length > 512) {
    let cached = brCache.get(relPath);
    if (!cached) {
      cached = zlib.brotliCompressSync(rawBuf, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
      });
      brCache.set(relPath, cached);
    }
    bodyBuf = cached;
    headers["content-encoding"] = "br";
    headers["vary"] = "accept-encoding";
  }

  headers["content-length"] = bodyBuf.length;
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
  } else {
    res.end(bodyBuf);
  }
}

function extractTextFromMessageContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function isTitleGeneratorRequest(messages, payload) {
  if (!Array.isArray(messages)) return false;
  const allTexts = messages
    .map((m) => extractTextFromMessageContent(m.content))
    .join("\n");
  if (
    /You name conversations|Reply with a title for it|title generator|generate a (?:brief|concise|short) title|single-line title/i.test(
      allTexts
    )
  ) {
    return true;
  }
  return false;
}

function generateInstantTitle(messages) {
  const userMsgs = (messages || []).filter((m) => m.role === "user");
  let raw = userMsgs.length > 0 ? extractTextFromMessageContent(userMsgs[userMsgs.length - 1].content) : "Antigravity Session";
  const tagMatch = raw.match(/<message>\s*([\s\S]*?)\s*<\/message>/i);
  if (tagMatch) {
    raw = tagMatch[1];
  }
  const cleaned = raw
    .replace(/^Here is the first message[^:]*:\s*/i, "")
    .replace(/^Here is the conversation[^:]*:\s*/i, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Antigravity Chat";
  const words = cleaned.split(" ").slice(0, 6).join(" ");
  return words.length > 48 ? words.slice(0, 48).trim() : words;
}

function buildPromptFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "Hello";
  const relevant = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = extractTextFromMessageContent(m.content).trim();
    if (text) relevant.push({ role: m.role, text });
  }
  if (relevant.length === 0) return "Hello";
  if (relevant.length === 1) return relevant[0].text;
  const history = relevant
    .slice(-9, -1)
    .map((m) => `[${m.role === "user" ? "USER" : "ASSISTANT"}]:\n${m.text}`)
    .join("\n\n");
  const last = relevant[relevant.length - 1].text;
  return `Previous conversation context:\n${history}\n\nCurrent user request:\n${last}`;
}

function resolveAgyModelAndEffort(rawModelInput, payload) {
  const raw = String(rawModelInput || "gemini-3.8-flash").replace(/^antigravity\//, "");
  const suffixMatch = raw.match(/^(.*)-(low|medium|high)$/);
  const baseFamily = suffixMatch ? suffixMatch[1] : raw;
  const suffixEffort = suffixMatch ? suffixMatch[2] : null;

  const info = AGY_MODELS[baseFamily] || AGY_MODELS["gemini-3.8-flash"];
  const familyId = AGY_MODELS[baseFamily] ? baseFamily : "gemini-3.8-flash";

  const requestedEffort =
    payload.reasoning_effort ||
    (payload.reasoning && payload.reasoning.effort) ||
    suffixEffort ||
    info.defaultEffort ||
    "low";

  const validEfforts = info.variants || ["low", "medium", "high"];
  const effort = validEfforts.includes(requestedEffort)
    ? requestedEffort
    : info.defaultEffort || "low";

  return { model: familyId, effort };
}

const warmWorkers = new Map();

function getAgyBin() {
  return fs.existsSync("/root/.local/bin/agy.bin")
    ? "/root/.local/bin/agy.bin"
    : fs.existsSync("/root/.local/bin/agy")
    ? "/root/.local/bin/agy"
    : "agy";
}

function getOrSpawnWarmWorker(cwd, model, effort) {
  const key = `${cwd}|${model}|${effort}`;
  let w = warmWorkers.get(key);
  if (w && !w.dead && !w.busy) return w;

  if (!w || w.dead) {
    // Evict oldest idle worker if > 2
    if (warmWorkers.size >= 3) {
      for (const [k, old] of warmWorkers.entries()) {
        if (!old.busy) {
          try { old.child.kill("SIGTERM"); } catch {}
          warmWorkers.delete(k);
          break;
        }
      }
    }
    const args = [
      "--print=",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--model", model,
      "--dangerously-skip-permissions",
    ];
    if (effort && ["low", "medium", "high"].includes(effort) && model.startsWith("gemini")) {
      args.push("--effort", effort);
    }
    const child = spawn(getAgyBin(), args, {
      cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const worker = {
      key,
      child,
      ready: false,
      busy: false,
      dead: false,
      turns: 0,
      buf: "",
      onLine: null,
      onClose: null,
      onStderr: null,
      readyQueue: [],
    };
    child.stdout.on("data", (d) => {
      worker.buf += d.toString("utf8");
      const lines = worker.buf.split("\n");
      worker.buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.event === "init") {
            worker.ready = true;
            while (worker.readyQueue.length > 0) {
              const fn = worker.readyQueue.shift();
              fn();
            }
            continue;
          }
        } catch {}
        if (worker.onLine) worker.onLine(line);
      }
    });
    child.stderr.on("data", (d) => {
      if (worker.onStderr) worker.onStderr(d.toString("utf8"));
    });
    child.on("close", (code) => {
      worker.dead = true;
      warmWorkers.delete(key);
      if (worker.onClose) worker.onClose(code);
    });
    warmWorkers.set(key, worker);
    return worker;
  }
  return null;
}

function handleAgyChatCompletions(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let payload = {};
    try {
      payload = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid JSON body" } }));
      return;
    }

    const { model, effort } = resolveAgyModelAndEffort(payload.model, payload);
    const stream = payload.stream !== false;
    const chatId = "chatcmpl-" + crypto.randomBytes(12).toString("hex");
    const created = Math.floor(Date.now() / 1000);

    // Fast path for background session title generation so it doesn't spawn a second heavy CLI
    if (isTitleGeneratorRequest(payload.messages, payload)) {
      const titleText = generateInstantTitle(payload.messages);
      if (stream) {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(
          `data: ${JSON.stringify({
            id: chatId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { role: "assistant", content: titleText }, finish_reason: null }],
          })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({
            id: chatId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          })}\n\n`
        );
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: chatId,
            object: "chat.completion",
            created,
            model,
            choices: [{ index: 0, message: { role: "assistant", content: titleText }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          })
        );
      }
      return;
    }

    const cwd =
      activeDirectory && fs.existsSync(activeDirectory) && fs.statSync(activeDirectory).isDirectory()
        ? activeDirectory
        : "/root";

    const userMsgs = Array.isArray(payload.messages) ? payload.messages.filter((m) => m.role === "user") : [];
    const lastUserText = userMsgs.length > 0 ? extractTextFromMessageContent(userMsgs[userMsgs.length - 1].content).trim() : "Hello";

    // Direct CLI execution for commands answered by the CLI itself (e.g. /usage, /credits, /skills, /help, etc.)
    const cliMatch = lastUserText.match(/^\/(usage|quota|credits|skills|agents|changelog|help|effort|permissions|hooks|plugin|config)(?:\s+(.*))?$/i);
    if (cliMatch) {
      const cmdName = cliMatch[1].toLowerCase();
      const rawCmd = "/" + cmdName + (cliMatch[2] ? " " + cliMatch[2] : "");
      if (stream) {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
      }
      const cmdChild = spawn(getAgyBin(), ["-p", rawCmd, "--dangerously-skip-permissions"], {
        cwd,
        env: { ...process.env },
      });
      let fullOut = "";
      cmdChild.stdout.on("data", (d) => { fullOut += d.toString("utf8"); });
      cmdChild.stderr.on("data", (d) => { fullOut += d.toString("utf8"); });
      cmdChild.on("close", () => {
        let formatted = fullOut.trim();
        if (/^(usage|quota)$/i.test(cmdName)) {
          const lines = formatted.split("\n");
          const rows = [];
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith("Quota:") || line.startsWith("Last progress:")) continue;
            const m = line.match(/^(.+?)\s{2,}(.+?)\s{2,}(\d+%(?:\s*\([^)]*\))?)(?:\s{2,}(.+))?$/);
            if (m) {
              rows.push(`| ${m[1].trim()} | ${m[2].trim()} | **${m[3].trim()}** | ${m[4] ? m[4].trim() : "-"} |`);
            } else if (line.includes("\t")) {
              const parts = line.split("\t").map((s) => s.trim());
              if (parts.length >= 3) {
                const reset = parts[3] ? parts[3].replace("T", " ").replace("Z", " UTC") : "-";
                rows.push(`| ${parts[0]} | ${parts[1]} | **${parts[2]}** | ${reset} |`);
              }
            }
          }
          if (rows.length > 0) {
            formatted = `### 📊 Model Quota Usage\n\n| Model Group | Limit Window | Remaining | Resets At |\n| :--- | :--- | :--- | :--- |\n${rows.join("\n")}\n`;
          }
        } else if (formatted) {
          formatted = ```\n${formatted}\n```;
        } else {
          formatted = "Command completed.";
        }

        if (stream) {
          res.write(`data: ${JSON.stringify({
            id: chatId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { role: "assistant", content: formatted }, finish_reason: null }],
          })}\n\n`);
          res.write(`data: ${JSON.stringify({
            id: chatId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
          })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            id: chatId,
            object: "chat.completion",
            created,
            model,
            choices: [{ index: 0, message: { role: "assistant", content: formatted }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
          }));
        }
      });
      return;
    }

    const runAgyAttempt = (attempt = 1) => {
      const worker = getOrSpawnWarmWorker(cwd, model, effort);

      let stderrBuf = "";
      let fullText = "";
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      let hitRateLimit = false;
      let finishedResponse = false;

      const sendChunk = (deltaObj, finishReason = null, includeUsage = null) => {
        if (!stream || res.writableEnded || finishedResponse) return;
        const chunkData = {
          id: chatId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: deltaObj, finish_reason: finishReason }],
        };
        if (includeUsage) chunkData.usage = includeUsage;
        res.write(`data: ${JSON.stringify(chunkData)}\n\n`);
      };

      const finishNow = (killWorker = false) => {
        if (finishedResponse || res.writableEnded) return;
        finishedResponse = true;
        if (worker) {
          worker.busy = false;
          worker.onLine = null;
          worker.onStderr = null;
          worker.onClose = null;
          if (killWorker) {
            worker.dead = true;
            warmWorkers.delete(worker.key);
            try { worker.child.kill("SIGTERM"); } catch {}
          }
        }
        if (stream) {
          const chunkData = {
            id: chatId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage,
          };
          res.write(`data: ${JSON.stringify(chunkData)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: chatId,
              object: "chat.completion",
              created,
              model,
              choices: [{ index: 0, message: { role: "assistant", content: fullText }, finish_reason: "stop" }],
              usage,
            })
          );
        }
      };

      if (attempt === 1) {
        sendChunk({ role: "assistant", content: "" });
      }

      const processLine = (line) => {
        if (!line.trim() || finishedResponse) return;
        try {
          const evt = JSON.parse(line);
          if (evt.event === "step_update" && evt.step_update) {
            const su = evt.step_update;
            if (su.thinking_delta) sendChunk({ reasoning_content: su.thinking_delta });
            if (su.text_delta) {
              fullText += su.text_delta;
              sendChunk({ content: su.text_delta });
            }
            if (su.usage) {
              usage = {
                prompt_tokens: su.usage.input_tokens || 0,
                completion_tokens: su.usage.output_tokens || 0,
                total_tokens: su.usage.total_tokens || 0,
              };
            }
          } else if (evt.event === "result" && evt.result) {
            if (evt.result.usage) {
              usage = {
                prompt_tokens: evt.result.usage.input_tokens || usage.prompt_tokens,
                completion_tokens: evt.result.usage.output_tokens || usage.completion_tokens,
                total_tokens: evt.result.usage.total_tokens || usage.total_tokens,
              };
            }
            if (!fullText && typeof evt.result.response === "string" && evt.result.response) {
              fullText += evt.result.response;
              sendChunk({ content: evt.result.response });
            }
            if (evt.result.status === "ERROR" || evt.result.error) {
              const errStr = JSON.stringify(evt.result);
              if (/429|quota|rate.?limit|ResourceExhausted/i.test(errStr)) {
                hitRateLimit = true;
                if (worker) {
                  worker.dead = true;
                  warmWorkers.delete(worker.key);
                  try { worker.child.kill("SIGTERM"); } catch {}
                }
                return;
              } else if (!fullText && evt.result.error) {
                const errMsg = `⚠️ Error: ${evt.result.error}`;
                fullText += errMsg;
                sendChunk({ content: errMsg });
              }
            }
            finishNow(false);
          }
        } catch {}
      };

      if (worker) {
        worker.busy = true;
        const turnPrompt = worker.turns === 0 ? buildPromptFromMessages(payload.messages) : lastUserText;
        worker.turns++;
        worker.onLine = processLine;
        worker.onStderr = (str) => {
          stderrBuf += str;
          if (/429|quota|rate.?limit|ResourceExhausted/i.test(str)) hitRateLimit = true;
        };
        worker.onClose = (code) => {
          if (hitRateLimit && attempt < 3) {
            try {
              const status = execSync("agy-switcher --auto-rotate-status", { encoding: "utf8" }).trim();
              if (status.includes("ENABLED")) {
                const rotOut = execSync("agy-switcher --rotate", { encoding: "utf8" });
                const emailMatch = rotOut.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
                const newEmail = emailMatch ? emailMatch[1] : "next account";
                const msg = `\n> 🔄 *Quota limit reached. Auto-rotated to account: \`${newEmail}\`. Resuming task...*\n\n`;
                fullText += msg;
                sendChunk({ content: msg });
                return runAgyAttempt(attempt + 1);
              }
            } catch {}
          }
          finishNow(true);
        };
        res.on("close", () => {
          if (!res.writableEnded && !finishedResponse) {
            finishNow(true);
          }
        });
        const sendTurn = () => {
          try {
            worker.child.stdin.write(JSON.stringify({ event: "user", message: { role: "user", content: turnPrompt } }) + "\n");
          } catch {
            finishNow(true);
          }
        };
        if (worker.ready) sendTurn();
        else worker.readyQueue.push(sendTurn);
        return;
      }
    };

    runAgyAttempt(1);
  });
}

// Intercept and customize JSON API responses so ONLY Antigravity models/providers/skills appear
function transformApiResponse(pathname, method, statusCode, rawBody) {
  if (statusCode < 200 || statusCode >= 300) return rawBody;
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return rawBody;
  }

  // 1. /api/info -> rewrite URLs to agy-web port
  if (method === "GET" && pathname === "/api/info") {
    parsed.urls = [`http://127.0.0.1:${PORT}`];
    return JSON.stringify(parsed);
  }

  // 2. /api/model -> ONLY return Antigravity models (strip opencode, openai, vikey, or, apinex)
  if (method === "GET" && pathname === "/api/model") {
    parsed.data = buildAntigravityModelsList();
    return JSON.stringify(parsed);
  }

  // 3. /api/model/default -> ALWAYS return Gemini 3.8 Flash
  if (method === "GET" && pathname === "/api/model/default") {
    parsed.data = buildAntigravityModelObject("gemini-3.8-flash", AGY_MODELS["gemini-3.8-flash"]);
    return JSON.stringify(parsed);
  }

  // 4. /api/provider -> ONLY return Antigravity provider
  if (method === "GET" && pathname === "/api/provider") {
    parsed.data = [buildAntigravityProviderObject()];
    return JSON.stringify(parsed);
  }
  if (method === "GET" && pathname === "/api/provider/antigravity") {
    parsed.data = buildAntigravityProviderObject();
    return JSON.stringify(parsed);
  }

  // 5. /api/integration -> ONLY return Antigravity
  if (method === "GET" && pathname === "/api/integration") {
    parsed.data = [
      {
        id: "antigravity",
        name: "Antigravity (Google DeepMind)",
        methods: [],
        connections: [],
      },
    ];
    return JSON.stringify(parsed);
  }

  // 6. /api/credential -> hide third-party OpenCode credentials
  if (method === "GET" && pathname === "/api/credential") {
    parsed.data = [];
    return JSON.stringify(parsed);
  }

  // 7. /api/skill -> remove `opencode` skill and inject Antigravity skills
  if (method === "GET" && pathname === "/api/skill") {
    const existing = Array.isArray(parsed.data)
      ? parsed.data.filter((s) => s.id !== "opencode")
      : [];
    const existingIds = new Set(existing.map((s) => s.id));
    for (const sk of AGY_SKILLS) {
      if (!existingIds.has(sk.id)) existing.unshift(sk);
    }
    parsed.data = existing;
    return JSON.stringify(parsed);
  }

  // 8. /api/command -> ONLY native Antigravity slash commands
  if (method === "GET" && pathname === "/api/command") {
    parsed.data = AGY_COMMANDS.map((c) => ({ ...c, source: "command" }));
    return JSON.stringify(parsed);
  }

  // 9. /api/session & /api/session/:id -> ensure session model is always one of the clean Antigravity models
  if (method === "GET" && pathname === "/api/session" && Array.isArray(parsed.data)) {
    for (const s of parsed.data) {
      if (!s.model || s.model.providerID !== "antigravity" || !AGY_MODELS[s.model.id]) {
        const cleanId = s.model?.id ? s.model.id.replace(/-(low|medium|high)$/, "") : "gemini-3.8-flash";
        s.model = {
          id: AGY_MODELS[cleanId] ? cleanId : "gemini-3.8-flash",
          providerID: "antigravity",
          variant: s.model?.variant || "low",
        };
      }
    }
    return JSON.stringify(parsed);
  }
  if (method === "GET" && /^\/api\/session\/[^/]+$/.test(pathname) && parsed.data && typeof parsed.data === "object") {
    const sm = parsed.data.model;
    if (sm && sm.id && AGY_MODELS[sm.id]) {
      const v = sm.variant && ["low", "medium", "high"].includes(sm.variant) ? sm.variant : AGY_MODELS[sm.id].defaultEffort;
      getOrSpawnWarmWorker(activeDirectory || "/root", sm.id, v);
    }
    if (!sm || sm.providerID !== "antigravity" || !AGY_MODELS[sm.id]) {
      const cleanId = sm?.id ? sm.id.replace(/-(low|medium|high)$/, "") : "gemini-3.8-flash";
      parsed.data.model = {
        id: AGY_MODELS[cleanId] ? cleanId : "gemini-3.8-flash",
        providerID: "antigravity",
        variant: sm?.variant || "low",
      };
    }
    return JSON.stringify(parsed);
  }

  return rawBody;
}

const INTERCEPTED_GET_PATHS = new Set([
  "/api/info",
  "/api/model",
  "/api/model/default",
  "/api/provider",
  "/api/provider/antigravity",
  "/api/integration",
  "/api/credential",
  "/api/skill",
  "/api/command",
  "/api/session",
]);

function shouldInterceptResponse(method, pathname) {
  if (method !== "GET") return false;
  if (INTERCEPTED_GET_PATHS.has(pathname)) return true;
  if (/^\/api\/session\/[^/]+$/.test(pathname)) return true;
  return false;
}

function extractRequestDirectory(req, urlObj) {
  return (
    urlObj.searchParams.get("location[directory]") ||
    urlObj.searchParams.get("directory") ||
    req.headers["x-opencode-directory"] ||
    null
  );
}

function proxyToEngine(req, res, urlObj) {
  const reqDir = extractRequestDirectory(req, urlObj);
  if (reqDir) {
    activeDirectory = String(reqDir);
  }

  const headers = { ...req.headers };
  headers.host = `${ENGINE_HOST}:${ENGINE_PORT}`;

  // Automatically authenticate with the isolated engine so browser sessions never 401
  if (!headers.authorization && !urlObj.pathname.startsWith("/auth/")) {
    headers.authorization = ENGINE_BASIC_AUTH;
  }

  if (headers.cookie) {
    headers.cookie = headers.cookie.replace(
      new RegExp(`opencode_session_${PORT}\\b`, "g"),
      `opencode_session_${ENGINE_PORT}`
    );
  }
  if (headers.origin) {
    headers.origin = `http://${ENGINE_HOST}:${ENGINE_PORT}`;
  }
  if (headers.referer) {
    headers.referer = headers.referer.replace(
      /^https?:\/\/[^/]+/,
      `http://${ENGINE_HOST}:${ENGINE_PORT}`
    );
  }

  const intercept = shouldInterceptResponse(req.method, urlObj.pathname);
  if (intercept) {
    delete headers["accept-encoding"];
  }

  const proxyReq = http.request(
    {
      hostname: ENGINE_HOST,
      port: ENGINE_PORT,
      path: urlObj.pathname + urlObj.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const resHeaders = { ...proxyRes.headers };
      if (resHeaders["set-cookie"]) {
        const cookies = Array.isArray(resHeaders["set-cookie"])
          ? resHeaders["set-cookie"]
          : [resHeaders["set-cookie"]];
        resHeaders["set-cookie"] = cookies.map((c) =>
          c
            .replace(`opencode_session_${ENGINE_PORT}=`, `opencode_session_${PORT}=`)
            .replace(/;\s*HttpOnly/gi, "; HttpOnly")
        );
      }

      if (intercept) {
        const chunks = [];
        proxyRes.on("data", (d) => chunks.push(d));
        proxyRes.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          const modified = transformApiResponse(
            urlObj.pathname,
            req.method,
            proxyRes.statusCode || 200,
            rawBody
          );
          delete resHeaders["content-length"];
          delete resHeaders["content-encoding"];
          res.writeHead(proxyRes.statusCode || 200, resHeaders);
          res.end(modified);
        });
        return;
      }

      res.writeHead(proxyRes.statusCode || 200, resHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ _tag: "ServiceUnavailableError", message: err.message }));
  });

  req.pipe(proxyReq);
}

let engineStarting = false;

function ensureIsolatedEngineRunning() {
  if (engineStarting) return;
  const probe = http.get(
    {
      hostname: ENGINE_HOST,
      port: ENGINE_PORT,
      path: "/api/info",
      headers: { Authorization: ENGINE_BASIC_AUTH },
      timeout: 8000,
    },
    (res) => {
      res.resume();
    }
  );
  probe.on("error", (err) => {
    if (err && err.code === "ECONNREFUSED") {
      spawnIsolatedEngine();
      getOrSpawnWarmWorker("/root", "gemini-3.8-flash", "low");
      getOrSpawnWarmWorker("/root", "claude-sonnet-5-5", "low");
    }
  });
  probe.on("timeout", () => {
    probe.destroy();
  });
}

function spawnIsolatedEngine() {
  if (engineStarting) return;
  engineStarting = true;
  try {
    const ocBin = fs.existsSync("/root/.opencode/bin/opencode")
      ? "/root/.opencode/bin/opencode"
      : "opencode";
    const logFd = fs.openSync(path.join(DATA_DIR, "engine.log"), "a");
    const child = spawn(
      ocBin,
      ["serve", "--port", String(ENGINE_PORT), "--hostname", ENGINE_HOST],
      {
        cwd: "/root",
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: {
          ...process.env,
          XDG_CONFIG_HOME,
          XDG_DATA_HOME,
          XDG_STATE_HOME,
          XDG_CACHE_HOME,
          OPENCODE_PASSWORD: ENGINE_PASSWORD,
          OPENCODE_SERVER_PASSWORD: ENGINE_PASSWORD,
        },
      }
    );
    child.on("exit", () => {
      engineStarting = false;
    });
    child.unref();
    setTimeout(() => {
      engineStarting = false;
    }, 6000);
  } catch (err) {
    engineStarting = false;
    console.error("[agy-web] Failed to start isolated engine:", err.message);
  }
}

let quotaCache = { timestamp: 0, data: null };

function handleAgyModalApi(req, res, urlObj) {
  const p = urlObj.pathname;

  // 1. GET /api/agy/quota
  if (p === "/api/agy/quota" && req.method === "GET") {
    const now = Date.now();
    if (quotaCache.data && now - quotaCache.timestamp < 15000) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(quotaCache.data));
    }
    execFile(getAgyBin(), ["-p", "/usage", "--dangerously-skip-permissions"], { timeout: 25000 }, (err, stdout) => {
      if (err) {
        if (quotaCache.data) {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify(quotaCache.data));
        }
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      const lines = (stdout || "").trim().split("\n");
      const groups = [];
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("Quota:") || line.startsWith("Last progress:")) continue;
        const m = line.match(/^(.+?)\s{2,}(.+?)\s{2,}(\d+%(?:\s*\([^)]*\))?)(?:\s{2,}(.+))?$/);
        if (m) {
          groups.push({
            model: m[1].trim(),
            window: m[2].trim(),
            remaining: m[3].trim(),
            resetsAt: m[4] ? m[4].trim() : "-",
          });
        } else if (line.includes("\t")) {
          const parts = line.split("\t").map((s) => s.trim());
          if (parts.length >= 3) {
            groups.push({
              model: parts[0],
              window: parts[1],
              remaining: parts[2],
              resetsAt: parts[3] ? parts[3].replace("T", " ").replace("Z", " UTC") : "-",
            });
          }
        }
      }
      const resp = { ok: true, groups };
      quotaCache = { timestamp: now, data: resp };
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(resp));
    });
    return;
  }

  // 2. GET /api/agy/switcher/status
  if (p === "/api/agy/switcher/status" && req.method === "GET") {
    execFile("agy-switcher", ["--auto-rotate-status"], { timeout: 5000 }, (err, stdout) => {
      const st = (stdout || "").trim();
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, enabled: st === "ENABLED", status: st }));
    });
    return;
  }

  // 3. POST /api/agy/switcher/toggle
  if (p === "/api/agy/switcher/toggle" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let b = {};
      try { b = JSON.parse(body || "{}"); } catch {}
      const arg = b.enable ? "on" : "off";
      execFile("agy-switcher", ["--auto-rotate", arg], { timeout: 5000 }, () => {
        execFile("agy-switcher", ["--auto-rotate-status"], { timeout: 5000 }, (_e, stOut) => {
          const st = (stOut || "").trim();
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, enabled: st === "ENABLED", status: st }));
        });
      });
    });
    return;
  }

  // 4. GET /api/agy/accounts
  if (p === "/api/agy/accounts" && req.method === "GET") {
    execFile("agy-switcher", ["--list-json"], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      let list = [];
      try { list = JSON.parse(stdout || "[]"); } catch {}
      const activeAcct = list.find((a) => a.is_active);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, accounts: list, activeEmail: activeAcct ? activeAcct.email : null }));
    });
    return;
  }

  // 5. POST /api/agy/accounts/switch
  if (p === "/api/agy/accounts/switch" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let b = {};
      try { b = JSON.parse(body || "{}"); } catch {}
      if (!b.email) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Target email required" }));
      }
      execFile("agy-switcher", ["--switch", b.email], { timeout: 8000 }, (err, stdout, stderr) => {
        if (err) {
          res.writeHead(500, { "content-type": "application/json" });
          return res.end(JSON.stringify({ ok: false, error: stderr || err.message }));
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, activeEmail: b.email, message: (stdout || "").trim() }));
      });
    });
    return;
  }

  // 6. POST /api/agy/accounts/rotate
  if (p === "/api/agy/accounts/rotate" && req.method === "POST") {
    execFile("agy-switcher", ["--rotate"], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: stderr || err.message }));
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, result: (stdout || "").trim() }));
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not Found" }));
}

setupIsolatedEngineConfig();
ensureIsolatedEngineRunning();
setInterval(ensureIsolatedEngineRunning, 15000).unref();

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // Native Antigravity Modal & Management APIs
  if (urlObj.pathname.startsWith("/api/agy/")) {
    return handleAgyModalApi(req, res, urlObj);
  }

  // 1. OpenAI-compatible AI Bridge for Antigravity CLI (`agy`)
  if (urlObj.pathname === "/v1/chat/completions" && req.method === "POST") {
    return handleAgyChatCompletions(req, res);
  }
  if (urlObj.pathname === "/v1/models" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: Object.entries(AGY_MODELS).map(([id, info]) => ({
          id,
          object: "model",
          created: 1794330000,
          owned_by: "antigravity",
          name: info.name,
        })),
      })
    );
    return;
  }

  // 2. Fast-path static Antigravity API endpoints (0ms response, 100% isolated from OpenCode models)
  if (req.method === "GET") {
    const reqDir = extractRequestDirectory(req, urlObj);
    if (reqDir && reqDir !== activeDirectory) { activeDirectory = String(reqDir); getOrSpawnWarmWorker(activeDirectory, "gemini-3.8-flash", "low"); }
    const locDir = reqDir || activeDirectory || "/root";
    const locWorkspace = urlObj.searchParams.get("location[workspaceID]") || undefined;
    const locObj = locWorkspace ? { directory: locDir, workspaceID: locWorkspace } : { directory: locDir };

    if (urlObj.pathname === "/api/model") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ location: locObj, data: buildAntigravityModelsList() }));
      return;
    }
    if (urlObj.pathname === "/api/model/default") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          location: locObj,
          data: buildAntigravityModelObject("gemini-3.8-flash", AGY_MODELS["gemini-3.8-flash"]),
        })
      );
      return;
    }
    if (urlObj.pathname === "/api/provider") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ location: locObj, data: [buildAntigravityProviderObject()] }));
      return;
    }
    if (urlObj.pathname === "/api/provider/antigravity") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ location: locObj, data: buildAntigravityProviderObject() }));
      return;
    }
    if (urlObj.pathname === "/api/integration") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          location: locObj,
          data: [{ id: "antigravity", name: "Antigravity (Google DeepMind)", methods: [], connections: [] }],
        })
      );
      return;
    }
    if (urlObj.pathname === "/api/credential") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
  }

  // Native Antigravity slash command
  const cmdMatch = urlObj.pathname.match(/^\/api\/session\/([^/]+)\/command$/);
  if (cmdMatch && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let b = {};
      try { b = JSON.parse(body || "{}"); } catch {}
      const cmdName = (b.name || "").toLowerCase();

      // Client management & diagnostic commands: return 204 immediately
      if (/^(usage|quota|credits|skills|agents|changelog|help|effort|permissions|hooks|plugin|config|terminal|antigravity-switcher|switcher-account)$/i.test(cmdName)) {
        res.writeHead(204);
        res.end();
        return;
      }

      // For workflow prompt commands (/plan, /goal, /boost, /review, etc.):
      // Respond 204 to satisfy client contract (successStatus: 204)
      res.writeHead(204);
      res.end();

      // Forward to isolated engine /prompt in the background
      const text = ("/" + (b.name || "") + " " + (b.text || "")).trim();
      const fwd = { text };
      for (const k of ["files", "agents", "skills", "delivery"]) if (b[k] !== undefined) fwd[k] = b[k];
      const data = JSON.stringify(fwd);
      const fakePath = urlObj.pathname.replace(/\/command(\?|$)/, "/prompt$1") + urlObj.search;
      const fwdReq = http.request(
        {
          hostname: ENGINE_HOST,
          port: ENGINE_PORT,
          path: fakePath,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(data),
            authorization: ENGINE_BASIC_AUTH,
          },
        },
        (fwdRes) => {
          fwdRes.resume();
        }
      );
      fwdReq.on("error", (err) => {
        console.error("[cmd-fwd] error:", err.message);
      });
      fwdReq.end(data);
    });
    return;
  }

  // 3. Proxy API, Auth, and OpenAPI spec to isolated backend engine
  if (
    urlObj.pathname === "/api" ||
    urlObj.pathname.startsWith("/api/") ||
    urlObj.pathname.startsWith("/auth/") ||
    urlObj.pathname === "/openapi.json"
  ) {
    return proxyToEngine(req, res, urlObj);
  }

  // 3. Serve customized Antigravity Web UI static assets from /root/projects/agy-web/dist
  return serveStaticAsset(req, res, urlObj);
});

// Proxy WebSocket upgrades (used by persistent PTY terminal in Web UI)
server.on("upgrade", (req, socket, head) => {
  const headers = { ...req.headers };
  headers.host = `${ENGINE_HOST}:${ENGINE_PORT}`;
  if (!headers.authorization) {
    headers.authorization = ENGINE_BASIC_AUTH;
  }
  if (headers.cookie) {
    headers.cookie = headers.cookie.replace(
      new RegExp(`opencode_session_${PORT}\\b`, "g"),
      `opencode_session_${ENGINE_PORT}`
    );
  }
  if (headers.origin) {
    headers.origin = `http://${ENGINE_HOST}:${ENGINE_PORT}`;
  }

  const proxyReq = http.request({
    hostname: ENGINE_HOST,
    port: ENGINE_PORT,
    path: req.url,
    method: req.method,
    headers,
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    let rawHeaders = `HTTP/1.1 101 Switching Protocols\r\n`;
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) rawHeaders += `${k}: ${item}\r\n`;
      } else if (v !== undefined) {
        rawHeaders += `${k}: ${v}\r\n`;
      }
    }
    rawHeaders += `\r\n`;
    socket.write(rawHeaders);
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on("error", () => socket.destroy());
    socket.on("error", () => proxySocket.destroy());
  });

  proxyReq.on("error", () => {
    socket.destroy();
  });

  if (head && head.length) proxyReq.write(head);
  proxyReq.end();
});

server.listen(PORT, HOST, () => {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({
        pid: process.pid,
        port: PORT,
        host: HOST,
        enginePort: ENGINE_PORT,
        dataDir: DATA_DIR,
        startedAt: new Date().toISOString(),
      })
    );
  } catch {}
  console.log(`[agy-web] Antigravity Web UI server listening on http://127.0.0.1:${PORT} (isolated DB: ${DATA_DIR})`);
});
