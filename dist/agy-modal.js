/**
 * Antigravity Native Modal System
 * Provides local desktop-class modals for /usage, /quota, /antigravity-switcher, /switcher-account, /credits, /terminal, and /help.
 * 100% CSP-compliant (no inline onclick handlers).
 */
(function () {
  const PRISM_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L3 20H8.5L12 13L15.5 20H21L12 2ZM12 7.5L14.25 12H9.75L12 7.5Z"/><circle cx="12" cy="16.5" r="1.5" fill-opacity="0.8"/></svg>`;

  let activeModalEl = null;

  function closeModal() {
    if (activeModalEl) {
      activeModalEl.remove();
      activeModalEl = null;
    }
  }

  function createModalBase(title, iconHtml) {
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "agy-modal-backdrop";

    // CSP-compliant event delegation: handles backdrop clicks, [data-agy-close], and [data-agy-open]
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        closeModal();
        return;
      }
      const closeBtn = e.target.closest("[data-agy-close]");
      if (closeBtn) {
        e.preventDefault();
        closeModal();
        return;
      }
      const openBtn = e.target.closest("[data-agy-open]");
      if (openBtn) {
        e.preventDefault();
        const target = openBtn.getAttribute("data-agy-open");
        window.__agyModal.open(target);
      }
    });

    const dialog = document.createElement("div");
    dialog.className = "agy-modal-dialog";

    const header = document.createElement("div");
    header.className = "agy-modal-header";
    header.innerHTML = `
      <div class="agy-modal-title">
        ${iconHtml || PRISM_ICON}
        <span>${title}</span>
      </div>
      <button type="button" class="agy-modal-close" data-agy-close="1" aria-label="Close">✕</button>
    `;

    const body = document.createElement("div");
    body.className = "agy-modal-body";

    const footer = document.createElement("div");
    footer.className = "agy-modal-footer";

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    activeModalEl = backdrop;

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        closeModal();
        window.removeEventListener("keydown", onKeyDown);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return { backdrop, dialog, header, body, footer, close: closeModal };
  }

  // 1. Quota & Usage Modal (/usage, /quota)
  async function showQuotaModal() {
    const modal = createModalBase("Model Quota & Rate Limits");
    modal.body.innerHTML = `<div style="text-align:center;padding:30px;"><div class="agy-spinner"></div><p style="margin-top:10px;color:#8b949e;">Mengambil data kuota model dari Antigravity...</p></div>`;

    async function loadData() {
      try {
        const res = await fetch("/api/agy/quota");
        const json = await res.json();
        if (!json.ok || !json.groups) throw new Error(json.error || "Gagal memuat kuota");

        let html = "";
        for (const g of json.groups) {
          const pctMatch = (g.remaining || "").match(/(\d+)%/);
          const pct = pctMatch ? parseInt(pctMatch[1], 10) : 100;
          let colorClass = "agy-progress-green";
          if (pct < 20) colorClass = "agy-progress-red";
          else if (pct < 50) colorClass = "agy-progress-yellow";

          html += `
            <div class="agy-quota-group">
              <div class="agy-quota-title">
                <span>${g.model}</span>
                <span style="font-weight:700;color:${pct < 20 ? "#f85149" : pct < 50 ? "#d29922" : "#3fb950"};">${g.remaining}</span>
              </div>
              <div class="agy-quota-window">${g.window}</div>
              <div class="agy-progress-bar-bg">
                <div class="agy-progress-bar-fill ${colorClass}" style="width: ${Math.min(100, Math.max(0, pct))}%;"></div>
              </div>
              <div class="agy-quota-reset">Mereset: ${g.resetsAt}</div>
            </div>
          `;
        }

        modal.body.innerHTML = html || "<p>Tidak ada data kuota.</p>";
        modal.footer.innerHTML = `
          <button type="button" class="agy-btn" id="agy-btn-rotate">🔄 Rotasi Akun</button>
          <button type="button" class="agy-btn agy-btn-primary" id="agy-btn-refresh">🔄 Refresh</button>
        `;

        modal.footer.querySelector("#agy-btn-refresh").addEventListener("click", () => {
          modal.body.innerHTML = `<div style="text-align:center;padding:30px;"><div class="agy-spinner"></div><p style="margin-top:10px;color:#8b949e;">Memperbarui...</p></div>`;
          loadData();
        });

        modal.footer.querySelector("#agy-btn-rotate").addEventListener("click", async () => {
          const btn = modal.footer.querySelector("#agy-btn-rotate");
          btn.disabled = true;
          btn.textContent = "Memutar akun...";
          try {
            await fetch("/api/agy/accounts/rotate", { method: "POST" });
            loadData();
          } catch (e) {
            alert("Gagal rotasi: " + e.message);
            btn.disabled = false;
            btn.textContent = "🔄 Rotasi Akun";
          }
        });
      } catch (err) {
        modal.body.innerHTML = `<div style="color:#f85149;padding:10px;">⚠️ Error: ${err.message}</div>`;
        modal.footer.innerHTML = `<button type="button" class="agy-btn agy-btn-primary" data-agy-open="quota">Coba Lagi</button>`;
      }
    }

    loadData();
  }

  // 2. Auto-Rotation Switcher Modal (/antigravity-switcher)
  async function showSwitcherModal() {
    const modal = createModalBase("Zero-Interruption Auto-Rotation");
    modal.body.innerHTML = `<div style="text-align:center;padding:30px;"><div class="agy-spinner"></div><p style="margin-top:10px;color:#8b949e;">Memeriksa status auto-rotation...</p></div>`;

    async function loadData() {
      try {
        const res = await fetch("/api/agy/switcher/status");
        const json = await res.json();
        const enabled = !!json.enabled;

        modal.body.innerHTML = `
          <div class="agy-toggle-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <span style="font-weight:600;font-size:14px;">Status Saat Ini</span>
              <span class="agy-status-pill ${enabled ? "agy-status-enabled" : "agy-status-disabled"}">
                ${enabled ? "● AKTIF (ENABLED)" : "○ NONAKTIF (DISABLED)"}
              </span>
            </div>
            <p style="color:#8b949e;font-size:12.5px;margin:0 0 16px 0;">
              Saat model yang sedang digunakan terkena limit kuota (HTTP 429), sistem akan <strong>otomatis merotasi akun Google Antigravity</strong> secara instan tanpa menghentikan proses pembuatan kode.
            </p>
            <button type="button" class="agy-btn ${enabled ? "agy-btn-danger" : "agy-btn-primary"}" id="agy-toggle-btn" style="width:100%;padding:10px;">
              ${enabled ? "Nonaktifkan Auto-Rotation" : "Aktifkan Auto-Rotation"}
            </button>
          </div>
        `;

        modal.footer.innerHTML = `<button type="button" class="agy-btn" data-agy-close="1">Tutup</button>`;

        modal.body.querySelector("#agy-toggle-btn").addEventListener("click", async () => {
          const btn = modal.body.querySelector("#agy-toggle-btn");
          btn.disabled = true;
          btn.textContent = "Menyimpan perubahan...";
          try {
            await fetch("/api/agy/switcher/toggle", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ enable: !enabled }),
            });
            loadData();
          } catch (e) {
            alert("Gagal mengubah status: " + e.message);
            loadData();
          }
        });
      } catch (err) {
        modal.body.innerHTML = `<div style="color:#f85149;padding:10px;">⚠️ Error: ${err.message}</div>`;
      }
    }

    loadData();
  }

  // 3. Account Switcher Modal (/switcher-account)
  async function showAccountModal() {
    const modal = createModalBase("Pilih Akun Antigravity");
    modal.body.innerHTML = `<div style="text-align:center;padding:30px;"><div class="agy-spinner"></div><p style="margin-top:10px;color:#8b949e;">Memuat daftar akun tersimpan...</p></div>`;

    async function loadData() {
      try {
        const res = await fetch("/api/agy/accounts");
        const json = await res.json();
        if (!json.ok || !json.accounts) throw new Error(json.error || "Gagal memuat akun");

        let html = `<p style="color:#8b949e;margin:0 0 14px 0;font-size:12.5px;">Pilih akun Google Antigravity yang ingin diaktifkan untuk sesi ini:</p>`;

        for (const acc of json.accounts) {
          const isActive = !!acc.is_active;
          html += `
            <div class="agy-account-item ${isActive ? "active" : ""}">
              <div>
                <div style="font-weight:600;font-size:13.5px;color:#e6edf3;">${acc.email}</div>
                <div style="font-size:11.5px;color:#8b949e;margin-top:2px;">Kadaluarsa: ${acc.expiry || "-"}</div>
              </div>
              <div>
                ${
                  isActive
                    ? `<span class="agy-badge-active">✓ Aktif</span>`
                    : `<button type="button" class="agy-btn agy-btn-primary" style="padding:5px 12px;font-size:12px;" data-switch="${acc.email}">Pilih</button>`
                }
              </div>
            </div>
          `;
        }

        modal.body.innerHTML = html;
        modal.footer.innerHTML = `<button type="button" class="agy-btn" data-agy-close="1">Tutup</button>`;

        modal.body.querySelectorAll("button[data-switch]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const targetEmail = btn.getAttribute("data-switch");
            btn.disabled = true;
            btn.textContent = "Mengganti...";
            try {
              const swRes = await fetch("/api/agy/accounts/switch", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email: targetEmail }),
              });
              const swJson = await swRes.json();
              if (!swJson.ok) throw new Error(swJson.error || "Gagal switch");
              loadData();
            } catch (e) {
              alert("Gagal switch: " + e.message);
              loadData();
            }
          });
        });
      } catch (err) {
        modal.body.innerHTML = `<div style="color:#f85149;padding:10px;">⚠️ Error: ${err.message}</div>`;
      }
    }

    loadData();
  }

  // 4. Help & Cheatsheet Modal (/help)
  function showHelpModal() {
    const modal = createModalBase("Antigravity Commands & Cheatsheet");
    const cmds = [
      { name: "/usage", desc: "Tampilkan sisa kuota model & jendela rate limit (modal instan)" },
      { name: "/quota", desc: "Alias untuk /usage" },
      { name: "/terminal", desc: "Buka / sembunyikan drawer PTY terminal bawaan" },
      { name: "/antigravity-switcher", desc: "Konfigurasi Zero-Interruption Auto-Rotation HTTP 429" },
      { name: "/switcher-account", desc: "Pilih dan ganti akun Google Antigravity aktif" },
      { name: "/credits", desc: "Informasi saldo kredit G1 dan penagihan" },
      { name: "/plan", desc: "Perencanaan arsitektur step-by-step sebelum eksekusi kode" },
      { name: "/goal", desc: "Jalankan tugas otonom berulang hingga sasaran tercapai" },
      { name: "/boost", desc: "Deep thinking, penalaran mendalam, & verifikasi ketat" },
      { name: "/review", desc: "Tinjau diff kode, commit, atau branch secara teliti" },
      { name: "/grill-me", desc: "Wawancara interaktif untuk mematangkan kebutuhan teknis" },
      { name: "/teamwork", desc: "Jalankan swarm multi-agent secara paralel" },
      { name: "/compact", desc: "Ringkas konteks sesi untuk menghemat jendela memori" },
      { name: "/browser", desc: "Navigasi dan pencarian web langsung" },
      { name: "/learn", desc: "Simpan preferensi dan konteks penting ke memori jangka panjang" },
      { name: "/skills", desc: "Daftar custom tools dan skill yang terpasang" },
      { name: "/agents", desc: "Daftar konfigurasi agen Antigravity" },
      { name: "/effort", desc: "Atur tingkat reasoning model (low, medium, high, max)" },
      { name: "/config", desc: "Buka panel preferensi dan konfigurasi" },
      { name: "/changelog", desc: "Catatan rilis dan pembaruan Antigravity" },
      { name: "/help", desc: "Tampilkan cheatsheet perintah ini" },
    ];

    let rows = "";
    for (const c of cmds) {
      rows += `
        <div class="agy-cmd-row">
          <span class="agy-cmd-name">${c.name}</span>
          <span class="agy-cmd-desc">${c.desc}</span>
        </div>
      `;
    }

    modal.body.innerHTML = `<div class="agy-command-grid">${rows}</div>`;
    modal.footer.innerHTML = `<button type="button" class="agy-btn agy-btn-primary" data-agy-close="1">Selesai</button>`;
  }

  // 5. Credits Modal (/credits)
  function showCreditsModal() {
    const modal = createModalBase("Antigravity G1 Credits");
    modal.body.innerHTML = `
      <div class="agy-toggle-card">
        <div style="font-weight:600;font-size:14px;margin-bottom:8px;">Google Cloud Antigravity Credits</div>
        <p style="color:#8b949e;margin:0 0 12px 0;">
          Akun Google Antigravity Anda terhubung langsung dengan kuota tier resmi Google DeepMind.
        </p>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button type="button" class="agy-btn agy-btn-primary" data-agy-open="quota">Periksa Kuota</button>
          <button type="button" class="agy-btn" data-agy-open="account">Ganti Akun</button>
        </div>
      </div>
    `;
    modal.footer.innerHTML = `<button type="button" class="agy-btn" data-agy-close="1">Tutup</button>`;
  }

  // 6. Terminal Toggle (/terminal)
  function toggleTerminal() {
    const btn =
      document.querySelector('[data-action="open-terminal"]') ||
      document.querySelector('button[aria-label*="terminal" i]') ||
      document.querySelector('button[title*="terminal" i]');
    if (btn) {
      btn.click();
      return;
    }
    // Fallback: trigger custom event if any
    window.dispatchEvent(new CustomEvent("agy:toggle-terminal"));
  }

  // Global API
  window.__agyModal = {
    open(type, input) {
      const t = String(type || "").toLowerCase().replace(/^\//, "").split(/\s+/)[0];
      if (t === "usage" || t === "quota") return showQuotaModal();
      if (t === "antigravity-switcher" || t === "switcher") return showSwitcherModal();
      if (t === "switcher-account" || t === "account") return showAccountModal();
      if (t === "help") return showHelpModal();
      if (t === "credits") return showCreditsModal();
      if (t === "terminal") return toggleTerminal();
    },
    close: closeModal,
    isModalCommand(name) {
      if (!name || typeof name !== "string") return false;
      const n = name.trim().toLowerCase().replace(/^\//, "").split(/\s+/)[0];
      return /^(usage|quota|antigravity-switcher|switcher-account|switcher|account|terminal|credits|help)$/.test(n);
    },
  };

  // Slash Command Interceptor Hook
  window.__agyHandleSlash = function (rawText) {
    if (!rawText || typeof rawText !== "string") return null;
    const trimmed = rawText.trim();
    if (!trimmed.startsWith("/")) return null;

    const parts = trimmed.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const rest = parts.slice(1).join(" ");

    if (window.__agyModal.isModalCommand(cmd)) {
      return async function () {
        window.__agyModal.open(cmd, rest);
      };
    }
    return null;
  };

  // Ensure document.title always displays Antigravity, never OpenCode
  function cleanTitle() {
    if (typeof document === "undefined") return;
    if (/opencode/i.test(document.title)) {
      document.title = document.title.replace(/\bOpenCode\b/gi, "Antigravity");
    }
  }
  if (typeof document !== "undefined") {
    cleanTitle();
    const titleEl = document.querySelector("title");
    if (titleEl) {
      new MutationObserver(cleanTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
    window.addEventListener("load", cleanTitle);
    setInterval(cleanTitle, 1000);
  }

  // ========================================================
  // Antigravity Native Global Enter & Slash Autocomplete Engine
  // ========================================================
  const AGY_SLASH_COMMANDS = [
    "boost",
    "usage",
    "quota",
    "switcher-account",
    "antigravity-switcher",
    "plan",
    "goal",
    "review",
    "grill-me",
    "teamwork",
    "compact",
    "browser",
    "learn",
    "skills",
    "agents",
    "effort",
    "config",
    "credits",
    "terminal",
    "help",
    "changelog",
  ];

  function matchAgyCommand(prefix) {
    if (!prefix) return "boost";
    const p = prefix.toLowerCase();
    const exact = AGY_SLASH_COMMANDS.find(c => c === p);
    if (exact) return exact;
    const starts = AGY_SLASH_COMMANDS.find(c => c.startsWith(p));
    if (starts) return starts;
    const sub = AGY_SLASH_COMMANDS.find(c => {
      let pi = 0;
      for (let ci = 0; ci < c.length && pi < p.length; ci++) {
        if (c[ci] === p[pi]) pi++;
      }
      return pi === p.length;
    });
    if (sub) return sub;
    return p;
  }

  let isShiftHeld = false;
  window.addEventListener("keydown", (e) => {
    if (e.key === "Shift" || e.shiftKey) {
      isShiftHeld = true;
      window.__agyShiftPressed = true;
    } else {
      isShiftHeld = false;
      window.__agyShiftPressed = false;
    }
  }, true);

  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift" || !e.shiftKey) {
      isShiftHeld = false;
      window.__agyShiftPressed = false;
    }
  }, true);

  function getActiveComposerEditor() {
    const active = document.activeElement;
    if (active && (active.getAttribute("contenteditable") === "true" || active.closest('[contenteditable="true"]'))) {
      return active.getAttribute("contenteditable") === "true" ? active : active.closest('[contenteditable="true"]');
    }
    return document.querySelector('div[contenteditable="true"]');
  }

  function handleNativeEnter(e) {
    const editor = getActiveComposerEditor();
    if (!editor) return;

    // Check if the event target is inside the editor or if editor is focused
    if (!editor.contains(e.target) && document.activeElement !== editor) {
      return;
    }

    const isShift = e.type === "keydown" ? e.shiftKey : (isShiftHeld || e.shiftKey || window.__agyShiftPressed);
    if (isShift) {
      // Shift+Enter allowed for newline
      return;
    }

    // Enter pressed without Shift: STRICTLY PREVENT NEWLINE INSERTION!
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }

    // 1. Check if suggestion popover is open with items
    const activeSuggestion = document.querySelector('[data-suggestion-id][data-active]') ||
                             document.querySelector('[data-suggestion-id]');
    if (activeSuggestion) {
      activeSuggestion.click();
      return;
    }

    // 2. Read editor text
    const rawText = (editor.innerText || editor.textContent || "").trim();

    // 3. If starts with slash '/' (e.g. /bt, /us, /boost, /plan)
    if (rawText.startsWith("/")) {
      const match = rawText.match(/^\/(\S*)/);
      const prefix = match ? match[1].toLowerCase() : "";
      const args = rawText.slice(match ? match[0].length : 1).trim();

      const matched = matchAgyCommand(prefix);

      // A. Modal Commands: /usage, /quota, /switcher-account, /antigravity-switcher, etc.
      if (window.__agyModal && window.__agyModal.isModalCommand(matched)) {
        editor.textContent = "";
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        window.__agyModal.open(matched, args);
        return;
      }

      // B. Workflow Action Commands: /boost, /plan, /goal, /review, etc.
      editor.textContent = "/" + matched + (args ? " " + args : "");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      setTimeout(() => {
        const submitBtn = document.querySelector('[data-action="composer-submit"]');
        if (submitBtn) {
          submitBtn.click();
        }
      }, 30);
      return;
    }

    // 4. Normal Prompt Text: Click submit button immediately
    const submitBtn = document.querySelector('[data-action="composer-submit"]');
    if (submitBtn) {
      submitBtn.click();
    }
  }

  // Intercept beforeinput (Gboard Android / mobile virtual keyboard) in capture phase
  window.addEventListener("beforeinput", (e) => {
    const isEnterInput = e.inputType === "insertParagraph" ||
                         e.inputType === "insertLineBreak" ||
                         (e.inputType === "insertText" && (e.data === "\n" || e.data === "\r\n"));
    if (isEnterInput) {
      handleNativeEnter(e);
    }
  }, true);

  // Intercept keydown (physical keyboard & desktop browsers) in capture phase
  window.addEventListener("keydown", (e) => {
    const isEnterKey = e.key === "Enter" || e.keyCode === 13 || e.which === 13;
    if (isEnterKey) {
      handleNativeEnter(e);
    }
  }, true);

})();
