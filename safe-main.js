(() => {
  "use strict";

  const ID = "geofs-script-vault-safe";
  const STORE = "geofs-script-vault-v1";
  const PREFS = "geofs-script-vault-v1-preferences";
  const HANDLER = "__geofsVaultSafeShortcutHandler";
  const MAX_SCRIPT_LENGTH = 200000;
  const MAX_NAME_LENGTH = 120;

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function isValidShortcut(code) {
    return /^Key[A-Z]$/.test(code);
  }

  function toShortcutLabel(code) {
    return code ? code.slice(3) : "";
  }

  function normalizeScript(rawScript) {
    if (!rawScript || typeof rawScript !== "object") return null;

    const name = String(rawScript.name ?? "").trim();
    const code = String(rawScript.code ?? "").trim();
    const id = String(rawScript.id ?? "");

    if (!name || !code) return null;
    if (name.length > MAX_NAME_LENGTH) return null;
    if (code.length > MAX_SCRIPT_LENGTH) return null;

    return {
      id: id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      name,
      code,
      autoRun: Boolean(rawScript.autoRun)
    };
  }

  function normalizePrefs(rawPrefs) {
    const base = {
      shortcut: "KeyP",
      autoRun: false
    };

    const next = {
      ...base,
      ...(rawPrefs && typeof rawPrefs === "object" ? rawPrefs : {})
    };

    if (!isValidShortcut(next.shortcut)) {
      next.shortcut = "KeyP";
    }

    next.autoRun = Boolean(next.autoRun);
    return next;
  }

  if (window[HANDLER]) {
    document.removeEventListener("keydown", window[HANDLER], true);
    document.removeEventListener("keydown", window[HANDLER], false);
  }

  document.getElementById(ID)?.remove();
  document.getElementById(ID + "-style")?.remove();
  document.getElementById(ID + "-launcher")?.remove();

  let scripts = Array.isArray(readJSON(STORE, []))
    ? readJSON(STORE, []).map(normalizeScript).filter(Boolean)
    : [];

  let prefs = normalizePrefs(readJSON(PREFS, {}));
  let editingId = null;
  let capturing = false;
  const running = new Map();

  function saveScripts() {
    writeJSON(STORE, scripts);
  }

  function savePrefs() {
    writeJSON(PREFS, prefs);
  }

  const style = document.createElement("style");
  style.id = ID + "-style";
  style.textContent = `
    #${ID} * { box-sizing: border-box; }
    #${ID} {
      position: fixed;
      top: 55px;
      left: 10px;
      bottom: 52px;
      width: 310px;
      max-width: calc(100vw - 20px);
      overflow-y: auto;
      z-index: 2147483646;
      background: #fff;
      color: #111;
      border: 1px solid #777;
      padding: 8px;
      font: 12px Arial,sans-serif;
      box-shadow: 0 1px 4px #777;
      box-sizing: border-box;
    }
    #${ID} button,
    #${ID} input,
    #${ID} textarea {
      font: 12px Arial,sans-serif;
      padding: 5px;
      border: 1px solid #999;
      border-radius: 2px;
      background: #fff;
      color: #111;
    }
    #${ID} button { cursor: pointer; }
    #${ID} button:hover { background: #eee; }
    #${ID} input:not([type=checkbox]),
    #${ID} textarea { width: 100%; }
    #${ID} textarea {
      min-height: 90px;
      resize: vertical;
      font-family: monospace;
    }
    #${ID} .row {
      display: flex;
      gap: 4px;
      margin: 5px 0;
    }
    #${ID} .row > * { flex: 1; min-width: 0; }
    #${ID} .heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #aaa;
      padding-bottom: 7px;
      margin-bottom: 7px;
    }
    #${ID} .setting,
    #${ID} .script {
      padding: 7px 0;
      border-bottom: 1px solid #ccc;
    }
    #${ID} .script-title { font-weight: bold; overflow-wrap: anywhere; }
    #${ID} .muted { color: #555; }
    #${ID} .status {
      margin-top: 7px;
      padding-top: 6px;
      border-top: 1px solid #ccc;
      overflow-wrap: anywhere;
    }
    #${ID} label {
      display: flex;
      align-items: center;
      gap: 5px;
      margin: 5px 0;
    }
    #${ID} input[type=checkbox] { width: auto; }
    #${ID} .keyfield {
      text-align: center;
      font-weight: bold;
      cursor: pointer;
    }
  `;

  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = ID;
  root.innerHTML = `
    <div class="heading">
      <strong>Safe Script Manager</strong>
      <button id="gsv-hide">Hide</button>
    </div>

    <div class="setting">
      <div>Menu shortcut</div>
      <div class="row">
        <input id="gsv-key" class="keyfield" readonly title="Click and press a letter">
        <button id="gsv-change">Change key</button>
      </div>
      <div id="gsv-keyhelp" class="muted">Click the field, then press A–Z.</div>
    </div>

    <div class="row">
      <input id="gsv-search" placeholder="Search scripts" aria-label="Search scripts">
      <button id="gsv-new">New</button>
    </div>

    <div id="gsv-list"></div>

    <hr>
    <strong id="gsv-formtitle">New script</strong>
    <input id="gsv-name" placeholder="Script name" style="margin-top:6px" maxlength="120">
    <textarea id="gsv-code" placeholder="Paste script code here" spellcheck="false"></textarea>

    <div class="row">
      <button id="gsv-save">Save script</button>
      <button id="gsv-clear">Clear</button>
    </div>

    <label>
      <input type="checkbox" id="gsv-autorun">
      Run marked scripts when manager loads
    </label>

    <div id="gsv-status" class="status">Ready.</div>
  `;

  document.body.appendChild(root);

  const $ = (name) => root.querySelector("#gsv-" + name);
  const status = (message) => {
    $("status").textContent = message;
  };

  function refreshKeyField() {
    $("key").value = capturing ? "Press a letter..." : toShortcutLabel(prefs.shortcut);
  }

  function startCapture() {
    capturing = true;
    refreshKeyField();
    $("keyhelp").textContent = "Press a letter from A to Z. Escape cancels.";
    status("Waiting for a new shortcut key.");
  }

  function cancelCapture() {
    capturing = false;
    refreshKeyField();
    $("keyhelp").textContent = "Click the field, then press A–Z.";
  }

  $("key").addEventListener("click", startCapture);
  $("change").addEventListener("click", startCapture);

  const keyHandler = (event) => {
    if (capturing) {
      if (event.repeat) return;

      if (event.code === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelCapture();
        status("Shortcut change cancelled.");
        return;
      }

      if (!/^Key[A-Z]$/.test(event.code) || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      prefs.shortcut = event.code;
      try {
        savePrefs();
      } catch (error) {
        console.error("[Safe Script Manager]", error);
      }

      cancelCapture();
      status("Shortcut set to " + toShortcutLabel(prefs.shortcut) + ".");
      return;
    }

    if (
      event.repeat ||
      event.ctrlKey || event.altKey || event.metaKey ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
    ) {
      return;
    }

    if (event.code === prefs.shortcut) {
      event.preventDefault();
      event.stopImmediatePropagation();
      root.style.display = root.style.display === "none" ? "block" : "none";
    }
  };

  window[HANDLER] = keyHandler;
  document.addEventListener("keydown", keyHandler, true);

  $("hide").onclick = () => {
    root.style.display = "none";
  };

  function clearForm() {
    editingId = null;
    $("name").value = "";
    $("code").value = "";
    $("formtitle").textContent = "New script";
    $("save").textContent = "Save script";
  }

  function editScript(script) {
    editingId = script.id;
    $("name").value = script.name;
    $("code").value = script.code;
    $("formtitle").textContent = "Edit script";
    $("save").textContent = "Update script";
  }

  function render() {
    const query = $("search").value.trim().toLowerCase();
    const list = $("list");
    list.replaceChildren();

    const filtered = scripts.filter((script) => {
      const name = String(script.name ?? "").toLowerCase();
      const code = String(script.code ?? "").toLowerCase();
      return name.includes(query) || code.includes(query);
    });

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = scripts.length ? "No matching scripts." : "No saved scripts yet.";
      list.appendChild(empty);
      return;
    }

    for (const script of filtered) {
      const item = document.createElement("div");
      item.className = "script";

      const title = document.createElement("div");
      title.className = "script-title";
      title.textContent = script.name;
      item.appendChild(title);

      const info = document.createElement("div");
      info.className = "muted";
      info.textContent = running.has(script.id) ? "Running" : "Saved";
      item.appendChild(info);

      const row = document.createElement("div");
      row.className = "row";

      const addButton = (label, action) => {
        const button = document.createElement("button");
        button.textContent = label;
        button.onclick = action;
        row.appendChild(button);
        return button;
      };

      const run = addButton("Run", () => runScript(script));
      const stop = addButton("Stop", () => stopScript(script));
      addButton("Edit", () => editScript(script));
      addButton("Delete", () => {
        if (!confirm("Delete " + script.name + "?")) return;
        scripts = scripts.filter((s) => s.id !== script.id);
        saveScripts();
        if (editingId === script.id) clearForm();
        render();
        status("Deleted " + script.name + ".");
      });

      run.disabled = running.has(script.id);
      stop.disabled = !running.has(script.id);
      item.appendChild(row);

      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!script.autoRun;
      checkbox.onchange = () => {
        script.autoRun = checkbox.checked;
        saveScripts();
        render();
      };
      label.append(checkbox, document.createTextNode("Auto-run"));
      item.appendChild(label);

      list.appendChild(item);
    }
  }

  function createScriptRuntime(code) {
    const runnerSource = `
      "use strict";
      return (async function runtimeEntry(runtime) {
        const { signal, stopRequested, console, document, window, localStorage, setTimeout, clearTimeout } = runtime;

        const ensureNotStopped = () => {
          if (signal.aborted || stopRequested()) {
            const err = new Error("Script stopped.");
            err.name = "AbortError";
            throw err;
          }
        };

        const wrapApi = () => ({
          console,
          document,
          window,
          localStorage,
          setTimeout,
          clearTimeout,
          ensureNotStopped,
          stopRequested
        });

        const api = wrapApi();

        ${code}
      });
    `;

    return new AsyncFunction("runtime", runnerSource);
  }

  async function runScript(script) {
    if (running.has(script.id)) return;

    const record = {
      stopRequested: false,
      abort: () => {
        record.stopRequested = true;
      }
    };

    running.set(script.id, record);
    render();
    status("Running " + script.name + ".");

    try {
      const runner = createScriptRuntime(script.code);
      await runner({
        signal: {
          aborted: false,
          get aborted() {
            return Boolean(record.stopRequested);
          }
        },
        stopRequested: () => record.stopRequested,
        console,
        document,
        window,
        localStorage,
        setTimeout,
        clearTimeout
      });

      status(record.stopRequested
        ? "Stop requested for " + script.name + "."
        : "Finished " + script.name + ".");
    } catch (error) {
      console.error("[Safe Script Manager]", error);
      status(error && error.name === "AbortError"
        ? "Script stopped: " + script.name + "."
        : "Script error: " + (error && error.message ? error.message : String(error)));
    } finally {
      running.delete(script.id);
      render();
    }
  }

  function stopScript(script) {
    const record = running.get(script.id);
    if (!record) return;
    record.stopRequested = true;
    status("Stop requested; the script must support stopping.");
    render();
  }

  $("save").onclick = () => {
    const name = $("name").value.trim();
    const code = $("code").value.trim();

    if (!name || !code) {
      status("Enter a script name and code.");
      return;
    }

    if (name.length > MAX_NAME_LENGTH) {
      status("Script name is too long.");
      return;
    }

    if (code.length > MAX_SCRIPT_LENGTH) {
      status("Script code is too long.");
      return;
    }

    if (editingId !== null) {
      const existing = scripts.find((s) => s.id === editingId);
      if (!existing) return clearForm();
      existing.name = name;
      existing.code = code;
    } else {
      scripts.push({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        name,
        code,
        autoRun: false
      });
    }

    try {
      saveScripts();
      clearForm();
      render();
      status("Saved.");
    } catch (error) {
      status("Save failed: " + (error && error.message ? error.message : String(error)));
    }
  };

  $("new").onclick = clearForm;
  $("clear").onclick = clearForm;
  $("search").oninput = render;

  $("autorun").checked = !!prefs.autoRun;
  $("autorun").onchange = (event) => {
    prefs.autoRun = event.target.checked;
    savePrefs();
    status("Auto-run preference updated.");
  };

  refreshKeyField();
  render();
  status("Loaded " + scripts.length + " saved script(s).");

  if (prefs.autoRun) {
    for (const script of scripts.filter((s) => s.autoRun)) {
      runScript(script);
    }
  }

  console.log("[GeoFS Safe Script Manager] Loaded successfully.");
})();
