// ==UserScript==
// @name           Zen Tidy Tabs
// @description    Arc-style "Tidy Tabs": AI groups loose tabs by topic into Zen folders.
// @include        main
// ==/UserScript==

(() => {
  if (window.__zenTidyTabs) return;
  window.__zenTidyTabs = true;

  const P = "tidy-tabs.";
  const LOG = "[Tidy Tabs]";
  const BUTTON_CLASS = "zen-tidy-tabs-button";
  const SKIP_URLS = new Set(["about:blank", "about:newtab", "about:home", "about:privatebrowsing"]);
  const MAX_TABS = 200;

  const prefs = {
    str: (k, d = "") => {
      try { return Services.prefs.getStringPref(P + k, d); } catch { return d; }
    },
    bool: (k, d) => {
      try { return Services.prefs.getBoolPref(P + k, d); } catch { return d; }
    },
    int: (k, d) => {
      try {
        const t = Services.prefs.getPrefType(P + k);
        if (t === Services.prefs.PREF_INT) return Services.prefs.getIntPref(P + k);
        if (t === Services.prefs.PREF_STRING) {
          const n = parseInt(Services.prefs.getStringPref(P + k), 10);
          return Number.isFinite(n) ? n : d;
        }
      } catch {}
      return d;
    },
  };

  const cfg = () => ({
    provider: prefs.str("provider", "ollama").toLowerCase(),
    mode: prefs.str("mode", "folders").toLowerCase(),
    minGroup: Math.max(1, prefs.int("min-group-size", 2)),
    reuse: prefs.bool("reuse-existing-folders", true),
    collapse: prefs.bool("collapse-new-folders", false),
    fallback: prefs.bool("fallback-to-domain", true),
    auto: prefs.bool("auto-tidy", false),
    autoThreshold: Math.max(3, prefs.int("auto-threshold", 10)),
    shortcut: prefs.str("shortcut", "alt+shift+t"),
    instructions: prefs.str("custom-instructions", ""),
    ollamaUrl: prefs.str("ollama.url", "http://localhost:11434"),
    ollamaModel: prefs.str("ollama.model", "llama3.2"),
    openaiUrl: prefs.str("openai.url", "https://api.openai.com/v1"),
    openaiKey: prefs.str("openai.key", ""),
    openaiModel: prefs.str("openai.model", ""),
    geminiKey: prefs.str("gemini.key", ""),
    geminiModel: prefs.str("gemini.model", "gemini-3.5-flash-lite"),
    anthropicKey: prefs.str("anthropic.key", ""),
    anthropicModel: prefs.str("anthropic.model", "claude-haiku-5-5"),
  });

  // ---------- tabs ----------

  const activeSpace = () => gZenWorkspaces.activeWorkspace;

  function looseTabs() {
    const strip = gZenWorkspaces.activeWorkspaceStrip;
    if (!strip) return [];
    return [...strip.children].filter(
      (t) =>
        gBrowser.isTab(t) &&
        !t.pinned &&
        !t.group &&
        !t.closing &&
        !t.hidden &&
        !t.hasAttribute("zen-empty-tab") &&
        !t.hasAttribute("zen-glance-tab") &&
        !t.hasAttribute("zen-essential")
    );
  }

  function describe(tab) {
    const uri = tab.linkedBrowser?.currentURI;
    const url = uri?.spec || "";
    let host = "";
    try { host = uri?.host || ""; } catch {}
    return { url, host: host.replace(/^www\./, ""), title: (tab.label || "").slice(0, 100) };
  }

  function sortableTabs() {
    return looseTabs()
      .filter((t) => !SKIP_URLS.has(describe(t).url))
      .slice(0, MAX_TABS);
  }

  function existingFolders() {
    const container = gZenWorkspaces.pinnedTabsContainer;
    if (!container) return [];
    return [...container.querySelectorAll("zen-folder")].filter(
      (f) => f.isZenFolder && !f.isLiveFolder && f.getAttribute("zen-workspace-id") === activeSpace()
    );
  }

  // ---------- grouping ----------

  const SYSTEM = `You organize web browser tabs into folders by topic, like Arc browser's "Tidy Tabs".
Respond with JSON only, no prose, in exactly this shape:
{"groups":[{"name":"Folder Name","tabs":[0,2,5]}]}
Rules:
- Group by the task, project or subject the user is working on, not merely by website, unless the website itself is the subject.
- Names: 1-3 words, Title Case, specific (e.g. "Thermo Homework", "Flight Search"), no emoji.
- Each tab index appears in at most one group. Leave out tabs that fit no group.
- If an existing folder fits, reuse its name exactly.
- Prefer fewer, meaningful groups over many tiny ones.`;

  function buildPrompt(tabs, folders, c) {
    const lines = tabs.map((t, i) => {
      const d = describe(t);
      return `${i}. ${d.title} | ${d.host || d.url.slice(0, 60)}`;
    });
    let p = `Minimum tabs per new group: ${c.minGroup}.\n`;
    if (folders.length) p += `Existing folders: ${folders.map((f) => JSON.stringify(f.label)).join(", ")}\n`;
    if (c.instructions.trim()) p += `User preferences: ${c.instructions.trim()}\n`;
    p += `\nTabs:\n${lines.join("\n")}`;
    return p;
  }

  async function post(url, body, headers = {}, timeoutMs = 120000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text);
    } catch (e) {
      if (e.name === "AbortError") throw new Error("request timed out");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const providers = {
    async ollama(prompt, c) {
      const data = await post(`${c.ollamaUrl.replace(/\/+$/, "")}/api/chat`, {
        model: c.ollamaModel,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
      });
      return data?.message?.content;
    },
    async openai(prompt, c) {
      if (!c.openaiModel) throw new Error("set tidy-tabs.openai.model");
      const headers = c.openaiKey ? { Authorization: `Bearer ${c.openaiKey}` } : {};
      const data = await post(
        `${c.openaiUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          model: c.openaiModel,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: prompt },
          ],
        },
        headers
      );
      return data?.choices?.[0]?.message?.content;
    },
    async gemini(prompt, c) {
      if (!c.geminiKey) throw new Error("set tidy-tabs.gemini.key");
      const data = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.geminiModel)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        },
        { "x-goog-api-key": c.geminiKey }
      );
      return data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
    },
    async anthropic(prompt, c) {
      if (!c.anthropicKey) throw new Error("set tidy-tabs.anthropic.key");
      const data = await post(
        "https://api.anthropic.com/v1/messages",
        {
          model: c.anthropicModel,
          max_tokens: 4096,
          system: SYSTEM,
          messages: [{ role: "user", content: prompt }],
        },
        {
          "x-api-key": c.anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        }
      );
      return data?.content?.filter((b) => b.type === "text").map((b) => b.text).join("");
    },
  };

  function parseGroups(raw, count) {
    if (!raw) throw new Error("empty model response");
    const s = String(raw).replace(/```(?:json)?/gi, "");
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("model did not return JSON");
    const obj = JSON.parse(s.slice(a, b + 1));
    const list = Array.isArray(obj) ? obj : obj.groups;
    if (!Array.isArray(list)) throw new Error("model JSON has no groups");
    const used = new Set();
    const out = [];
    for (const g of list) {
      const name = String(g?.name || "")
        .replace(/["'`]/g, "")
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join(" ");
      if (!name) continue;
      const idx = [];
      for (const v of Array.isArray(g.tabs) ? g.tabs : []) {
        const i = Number(v);
        if (Number.isInteger(i) && i >= 0 && i < count && !used.has(i)) {
          used.add(i);
          idx.push(i);
        }
      }
      if (idx.length) out.push({ name, idx });
    }
    return out;
  }

  const SECOND_LEVEL = new Set(["co", "com", "ac", "edu", "gov", "org", "net"]);

  function siteKey(host) {
    const parts = host.split(".").filter(Boolean);
    if (parts.length <= 2) return parts.join(".");
    const n = SECOND_LEVEL.has(parts[parts.length - 2]) && parts.at(-1).length === 2 ? 3 : 2;
    return parts.slice(-n).join(".");
  }

  function domainGroups(tabs) {
    const map = new Map();
    tabs.forEach((t, i) => {
      const host = describe(t).host;
      if (!host) return;
      const key = siteKey(host);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    });
    return [...map.entries()].map(([key, idx]) => {
      const base = key.split(".")[0];
      return { name: base.charAt(0).toUpperCase() + base.slice(1), idx };
    });
  }

  async function computeGroups(tabs, folders, c) {
    if (c.provider === "domain") return domainGroups(tabs);
    const fn = providers[c.provider];
    if (!fn) throw new Error(`unknown provider "${c.provider}"`);
    try {
      return parseGroups(await fn(buildPrompt(tabs, folders, c), c), tabs.length);
    } catch (e) {
      if (!c.fallback) throw e;
      console.warn(LOG, `AI grouping failed (${e.message}); falling back to domain grouping`);
      return domainGroups(tabs);
    }
  }

  // ---------- apply / undo ----------

  let lastUndo = null;

  async function applyFolders(tabs, groups, folders, c) {
    const byName = new Map(folders.map((f) => [String(f.label).toLowerCase(), f]));
    const undo = { mode: "folders", created: [], added: [], original: looseTabs() };
    for (const g of groups) {
      const groupTabs = g.idx.map((i) => tabs[i]).filter((t) => t?.isConnected && !t.pinned);
      const existing = c.reuse ? byName.get(g.name.toLowerCase()) : null;
      if (existing?.isConnected) {
        if (!groupTabs.length) continue;
        for (const t of groupTabs) gBrowser.pinTab(t);
        existing.addTabs(groupTabs);
        undo.added.push(...groupTabs);
        continue;
      }
      if (groupTabs.length < c.minGroup) continue;
      const folder = await gZenFolders.createFolder(groupTabs, {
        label: g.name,
        collapsed: c.collapse,
        workspaceId: activeSpace(),
      });
      if (folder) {
        folder.setAttribute("zen-tidy-tabs", "true");
        byName.set(g.name.toLowerCase(), folder);
        undo.created.push({ folder, tabs: groupTabs });
      }
    }
    return undo;
  }

  function reorder(order) {
    const live = order.filter((t) => t.isConnected && !t.pinned && !t.group);
    for (let i = 1; i < live.length; i++) gBrowser.moveTabAfter(live[i], live[i - 1]);
  }

  function applySort(tabs, groups, c) {
    const original = looseTabs();
    const placed = new Set();
    const order = [];
    for (const g of groups) {
      if (g.idx.length < c.minGroup) continue;
      for (const i of g.idx) {
        order.push(tabs[i]);
        placed.add(tabs[i]);
      }
    }
    for (const t of original) if (!placed.has(t)) order.push(t);
    if (original[0] && order[0] !== original[0]) gBrowser.moveTabBefore(order[0], original[0]);
    reorder(order);
    return { mode: "sort", original };
  }

  function undoLast() {
    const u = lastUndo;
    lastUndo = null;
    if (!u) return;
    const restoreOrder = () => {
      const first = looseTabs()[0];
      const live = u.original.filter((t) => t.isConnected && !t.pinned && !t.group);
      if (first && live[0] && first !== live[0]) gBrowser.moveTabBefore(live[0], first);
      reorder(live);
    };
    if (u.mode === "sort") {
      restoreOrder();
      return;
    }
    const release = (t) => {
      if (!t.isConnected) return;
      if (t.group?.isZenFolder) gBrowser.ungroupTab(t);
      if (t.pinned) gBrowser.unpinTab(t);
    };
    u.added.forEach(release);
    for (const { folder, tabs } of u.created) {
      tabs.forEach(release);
      if (!folder.isConnected) continue;
      const remaining = folder.allItemsRecursive.filter((t) => !t.hasAttribute?.("zen-empty-tab"));
      if (!remaining.length) folder.delete();
    }
    restoreOrder();
  }

  // ---------- main ----------

  let busy = false;
  let lastAutoRun = 0;

  async function tidy({ auto = false } = {}) {
    if (busy) return;
    const c = cfg();
    const tabs = sortableTabs();
    if (tabs.length < 2) {
      setButtons("idle");
      return;
    }
    busy = true;
    setButtons("busy");
    try {
      const folders = c.mode === "folders" ? existingFolders() : [];
      const groups = await computeGroups(tabs, folders, c);
      if (!groups.length) {
        setButtons("idle");
        return;
      }
      lastUndo =
        c.mode === "sort" ? applySort(tabs, groups, c) : await applyFolders(tabs, groups, folders, c);
      setButtons(auto ? "idle" : "undo");
    } catch (e) {
      console.error(LOG, e);
      setButtons("error", e.message);
    } finally {
      busy = false;
      if (auto) lastAutoRun = Date.now();
    }
  }

  // ---------- UI ----------

  let resetTimer = null;

  function setButtons(state, detail = "") {
    clearTimeout(resetTimer);
    const labels = { idle: "Tidy", busy: "Tidying…", undo: "Undo", error: "Tidy failed" };
    for (const b of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
      b.setAttribute("label", labels[state]);
      b.setAttribute("tidy-state", state);
      b.setAttribute(
        "tooltiptext",
        state === "error" ? `Tidy Tabs: ${detail}` : state === "undo" ? "Undo last tidy" : "Group tabs by topic"
      );
    }
    if (state === "undo" || state === "error") {
      resetTimer = setTimeout(() => {
        if (state === "undo") lastUndo = null;
        setButtons("idle");
      }, state === "undo" ? 10000 : 5000);
    }
  }

  function onButton(e) {
    e.stopPropagation();
    if (e.currentTarget.getAttribute("tidy-state") === "undo") {
      undoLast();
      setButtons("idle");
    } else {
      tidy();
    }
  }

  function injectButtons() {
    for (const sep of document.querySelectorAll(".pinned-tabs-container-separator")) {
      if (sep.querySelector(`.${BUTTON_CLASS}`)) continue;
      const btn = document.createXULElement("toolbarbutton");
      btn.className = BUTTON_CLASS;
      btn.setAttribute("label", "Tidy");
      btn.setAttribute("tidy-state", "idle");
      btn.setAttribute("tooltiptext", "Group tabs by topic");
      btn.addEventListener("command", onButton);
      const clear = sep.querySelector(".zen-workspace-close-unpinned-tabs-button");
      if (clear) clear.before(btn);
      else sep.append(btn);
    }
  }

  function parseShortcut(s) {
    const parts = s.toLowerCase().split("+").map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return null;
    const mac = Services.appinfo.OS === "Darwin";
    const sc = { ctrl: false, alt: false, shift: false, meta: false, key: parts.at(-1) };
    for (const m of parts.slice(0, -1)) {
      if (m === "accel") sc[mac ? "meta" : "ctrl"] = true;
      else if (m in sc) sc[m] = true;
      else if (m === "cmd") sc.meta = true;
      else if (m === "option") sc.alt = true;
    }
    return sc;
  }

  function matches(e, sc) {
    if (!sc) return false;
    if (e.ctrlKey !== sc.ctrl || e.altKey !== sc.alt || e.shiftKey !== sc.shift || e.metaKey !== sc.meta) return false;
    const k = sc.key;
    if (/^[a-z]$/.test(k)) return e.code === `Key${k.toUpperCase()}`;
    if (/^[0-9]$/.test(k)) return e.code === `Digit${k}`;
    return e.key.toLowerCase() === k;
  }

  function onKey(e) {
    if (!matches(e, parseShortcut(cfg().shortcut))) return;
    e.preventDefault();
    e.stopPropagation();
    if (lastUndo && !busy && document.querySelector(`.${BUTTON_CLASS}[tidy-state="undo"]`)) {
      undoLast();
      setButtons("idle");
    } else {
      tidy();
    }
  }

  let autoTimer = null;
  function onTabOpen() {
    const c = cfg();
    if (!c.auto) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (busy || Date.now() - lastAutoRun < 120000) return;
      if (sortableTabs().length >= c.autoThreshold) tidy({ auto: true });
    }, 8000);
  }

  async function init() {
    for (let i = 0; i < 100 && !(window.gZenWorkspaces && window.gZenFolders && window.gBrowser); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!window.gZenWorkspaces || !window.gZenFolders) {
      console.error(LOG, "Zen workspace/folder APIs not found; is this Zen Browser?");
      return;
    }
    await gZenWorkspaces.promiseInitialized;
    injectButtons();

    const observer = new MutationObserver(injectButtons);
    const host = gZenWorkspaces.activeWorkspaceElement?.parentElement;
    if (host) observer.observe(host, { childList: true });
    const onUIUpdate = () => injectButtons();
    window.addEventListener("ZenWorkspacesUIUpdate", onUIUpdate);
    window.addEventListener("keydown", onKey, true);
    gBrowser.tabContainer.addEventListener("TabOpen", onTabOpen);

    window.addUnloadListener?.(() => {
      observer.disconnect();
      window.removeEventListener("ZenWorkspacesUIUpdate", onUIUpdate);
      window.removeEventListener("keydown", onKey, true);
      gBrowser.tabContainer.removeEventListener("TabOpen", onTabOpen);
      clearTimeout(autoTimer);
      clearTimeout(resetTimer);
      document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((b) => b.remove());
      delete window.__zenTidyTabs;
    });

    window.ZenTidyTabs = { tidy, undo: undoLast };
  }

  init().catch((e) => console.error(LOG, e));
})();
