/* LifeMapz - Visual Time Horizons App v3.1.1
   Changes:
   - Mobile-safe Google sign-in (popup -> redirect fallback + redirect completion)
   - Versioned SW registration + auto-reload on update
   - Runtime label fixes: VERKS->VIEWS, Grand(groc)->Dark Mode, Sync-Glashed->Cloud Sync
   - Only specific "Visual Horizons" titles changed to "Hours" (hours card + cascade bottom)
   - Safe sidebar navigation for Days/Weeks/etc. (scrolls within Horizons view)
   - CloudSyncService template-string fixes
   - Cloud Sync: reconnects quietly only if previously enabled (no “disabled” toast on login)
*/

const APP_VERSION = (window && window.LIFEMAPZ_VERSION) || "3.1.1";

/* --------------------- Firebase --------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyBgiYPtoh7VILEcUdy1oyPfaqMRQP5nQl0",
  authDomain: "lifemapz-project.firebaseapp.com",
  projectId: "lifemapz-project",
  storageBucket: "lifemapz-project.appspot.com",
  messagingSenderId: "305063601285",
  appId: "1:305063601285:web:6fb6eebbe4f00f20dcf5ec"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();      // optional
const storage = firebase.storage();   // optional

// 🔒 Keep auth across redirects/tabs (esp. mobile/PWA)
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) => {
  console.warn("Auth persistence fallback:", e && (e.code || e.message));
});

/* --------------------- HTTP helper --------------------- */
const http = {
  async get(url, { headers = {}, timeout = 12000, responseType = "json" } = {}) {
    if (typeof axios !== "undefined") {
      const res = await axios.get(url, { headers, timeout, responseType: responseType === "text" ? "text" : "json" });
      return { status: res.status, data: res.data, headers: res.headers };
    }
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), timeout);
    const res = await fetch(url, { headers, signal: ctl.signal });
    clearTimeout(id);
    const data = responseType === "text" ? await res.text() : await res.json().catch(() => ({}));
    return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
  },

  async post(url, body, { headers = {}, timeout = 12000 } = {}) {
    if (typeof axios !== "undefined") {
      const res = await axios.post(url, body, { headers: { "Content-Type": "application/json", ...headers }, timeout });
      return { status: res.status, data: res.data, headers: res.headers };
    }
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), timeout);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    clearTimeout(id);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
  },

  async put(url, body, { headers = {}, timeout = 12000 } = {}) {
    if (typeof axios !== "undefined") {
      const res = await axios.put(url, body, { headers: { "Content-Type": "application/json", ...headers }, timeout });
      return { status: res.status, data: res.data, headers: res.headers };
    }
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), timeout);
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    clearTimeout(id);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
  }
};

/* --------------------- CloudSyncService --------------------- */
class CloudSyncService {
  constructor() {
    this.pantry  = { base: "https://getpantry.cloud/apiv1", pantryId: null, basket: "lifemapz" };
    this.jsonbin = { base: "https://api.jsonbin.io/v3",      binId: null };
    this.backend = null;
    this.isEnabled = false;
    this.syncInterval = null;
    this.dataChangeCallbacks = [];
    this.lastSyncTime = null;
    this._lastRemoteStamp = null;
  }

  async enable(sessionCode = null) {
    if (!sessionCode) {
      const saved = this._loadSession();
      if (saved) sessionCode = saved;
    }
    if (sessionCode && this._isLegacyKvdbCode(sessionCode)) {
      await this._migrateFromKvdb(sessionCode);
      sessionCode = this._loadSession();
    }

    if (sessionCode) {
      await this._parseAndSetSession(sessionCode);
    } else {
      await this._createPantrySession();
    }

    try {
      const current = await this._getRemote();
      if (!current) await this._saveRemote(this._initDoc());
    } catch {
      if (this.backend === "pantry") {
        await this._createJsonBinSession();
        await this._saveRemote(this._initDoc());
      }
    }

    this.isEnabled = true;
    this._startPolling();
    return true;
  }

  disable() {
    this.isEnabled = false;
    this._lastRemoteStamp = null;
    if (this.syncInterval) clearInterval(this.syncInterval);
  }

  async sync(localData) {
    if (!this.isEnabled) return localData;
    try {
      const remote = await this._getRemote();
      const merged = this._merge(localData, remote);
      await this._saveRemote(merged);
      this.lastSyncTime = new Date();
      this._lastRemoteStamp = merged?.lastSaved || null;
      return merged;
    } catch {
      if (this.backend === "pantry") {
        try {
          await this._createJsonBinSession();
          const remote = await this._getRemote();
          const merged = this._merge(localData, remote);
          await this._saveRemote(merged);
          this.lastSyncTime = new Date();
          this._lastRemoteStamp = merged?.lastSaved || null;
          return merged;
        } catch {}
      }
      return localData;
    }
  }

  onDataChange(cb) { if (typeof cb === "function") this.dataChangeCallbacks.push(cb); }

  get sessionId() {
    if (this.backend === "pantry"  && this.pantry.pantryId)  return `pantry:${this.pantry.pantryId}`;
    if (this.backend === "jsonbin" && this.jsonbin.binId)    return `jsonbin:${this.jsonbin.binId}`;
    return null;
  }

  getSyncStatus() {
    return {
      enabled: this.isEnabled,
      backend: this.backend,
      sessionId: this.sessionId,
      lastSync: this.lastSyncTime
    };
  }

  async _parseAndSetSession(code) {
    if (code.startsWith("pantry:")) {
      this.backend = "pantry";
      this.pantry.pantryId = code.split(":")[1];
      this._saveSession();
      return;
    }
    if (code.startsWith("jsonbin:")) {
      this.backend = "jsonbin";
      this.jsonbin.binId = code.split(":")[1];
      this._saveSession();
      return;
    }
    // raw pantry id
    this.backend = "pantry";
    this.pantry.pantryId = code;
    this._saveSession();
  }

  async _createPantrySession() {
    const res = await http.post(`${this.pantry.base}/pantry`, { description: "LifeMapz Sync" });
    const pid = res?.data?.pantryId || res?.data?.id || res?.pantryId || res?.id;
    if (!pid) throw new Error("GetPantry: failed to create pantry");
    this.pantry.pantryId = pid;
    this.backend = "pantry";
    this._saveSession();
    await http.put(`${this.pantry.base}/pantry/${this.pantry.pantryId}/basket/${this.pantry.basket}`, this._initDoc());
  }

  async _createJsonBinSession() {
    const init = this._initDoc();
    const res = await http.post(`${this.jsonbin.base}/b`, { record: init });
    const id = res?.data?.metadata?.id || res?.data?.id || res?.metadata?.id || res?.id;
    if (!id) throw new Error("JSONBin: failed to create bin");
    this.jsonbin.binId = id;
    this.backend = "jsonbin";
    this._saveSession();
  }

  async _getRemote() {
    if (this.backend === "pantry") {
      const res = await http.get(`${this.pantry.base}/pantry/${this.pantry.pantryId}/basket/${this.pantry.basket}`);
      if (res.status === 404) return null;
      return (res && typeof res.data === "object") ? res.data : null;
    }
    if (this.backend === "jsonbin") {
      const res = await http.get(`${this.jsonbin.base}/b/${this.jsonbin.binId}/latest`, { headers: { "X-Bin-Meta": "false" } });
      if (res.status === 404) return null;
      return res?.data?.record ?? res?.record ?? null;
    }
    return null;
  }

  async _saveRemote(data) {
    if (this.backend === "pantry") {
      await http.put(`${this.pantry.base}/pantry/${this.pantry.pantryId}/basket/${this.pantry.basket}`, data);
      return;
    }
    if (this.backend === "jsonbin") {
      await http.put(`${this.jsonbin.base}/b/${this.jsonbin.binId}`, { record: data });
      return;
    }
    throw new Error("No backend selected");
  }

  _merge(localData, remoteData) {
    if (!remoteData) return localData;
    if (!localData?.lastSaved) return remoteData;
    return new Date(remoteData.lastSaved) > new Date(localData.lastSaved) ? remoteData : localData;
  }

  _startPolling() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(async () => {
      if (!this.isEnabled) return;
      try {
        const remote = await this._getRemote();
        const stamp = remote?.lastSaved || null;
        if (stamp && stamp !== this._lastRemoteStamp) {
          this._lastRemoteStamp = stamp;
          this.dataChangeCallbacks.forEach(cb => cb(remote));
        }
      } catch {}
    }, 12000);
  }

  _initDoc() {
    const now = new Date().toISOString();
    return {
      version: APP_VERSION,
      tasks: [],
      lastSaved: now,
      createdAt: now
    };
  }

  _saveSession() {
    const code = this.sessionId;
    if (code) localStorage.setItem("lifemapz-sync-session", code);
  }

  _loadSession() {
    const direct = localStorage.getItem("lifemapz-sync-session");
    if (direct) return direct;
    const cfg = localStorage.getItem("lifemapz-sync-config");
    if (cfg) {
      try { return JSON.parse(cfg)?.sessionId || null; } catch {}
    }
    return null;
  }

  _isLegacyKvdbCode(code) {
    if (!code) return false;
    if (code.startsWith("kvdb:")) return true;
    return !code.includes(":") && /^[a-z0-9]{10,}$/i.test(code);
  }

  async _migrateFromKvdb(code) {
    try {
      const bucketId = code.startsWith("kvdb:") ? code.split(":")[1] : code;
      let legacyData = null;
      try {
        const res = await http.get(`https://kvdb.io/${bucketId}/timestripe`, { responseType: "text" });
        if (res && res.status >= 200 && res.status < 300) {
          try { legacyData = JSON.parse(res.data); } catch {}
        }
      } catch {}
      await this._createPantrySession();
      await this._saveRemote(legacyData && typeof legacyData === "object" ? legacyData : this._initDoc());
      const cfg = localStorage.getItem("lifemapz-sync-config");
      if (cfg) {
        try {
          const p = JSON.parse(cfg);
          p.sessionId = this.sessionId;
          p.enabled = true;
          localStorage.setItem("lifemapz-sync-config", JSON.stringify(p));
        } catch {}
      }
    } catch {}
  }
}

/* --------------------- LifeMapzApp --------------------- */
class LifeMapzApp {
  constructor() {
    this.currentView = "horizons";
    this.currentTheme = this.loadTheme();
    this.data = this.loadData();
    this.currentTaskTimeData = {};
    this.cloudSync = new CloudSyncService();
    this.syncEnabled = false;
    this.init();
  }

  init() {
    this.applyTheme();
    this._runtimeTextTweaks();
    this.bindEvents();
    this.setupSampleData();
    this.updateDateDisplay();
    this.renderCurrentView();
    this.setupServiceWorker();
    this.initCloudSync();

    const importEl = document.getElementById("import-file");
    if (importEl) importEl.addEventListener("change", (e) => this.importData(e.target.files[0]));

    setTimeout(() => this.showNotification(`LifeMapz v${APP_VERSION} is ready!`, "success"), 600);
  }

  /* -------- Runtime UI text tweaks (idempotent) -------- */
  _runtimeTextTweaks() {
    // VERKS -> VIEWS (sidebar section header)
    document.querySelectorAll(".sidebar-section h3").forEach(h3 => {
      if (h3.textContent.trim().toUpperCase() === "VERKS") h3.textContent = "VIEWS";
    });

    // Grand (groc) -> Dark Mode
    const themeBtnLabel = document.querySelector(".theme-toggle span");
    if (themeBtnLabel && /grand\s*\(groc\)/i.test(themeBtnLabel.textContent)) {
      themeBtnLabel.textContent = "Dark Mode";
    }

    // Sync-Glashed -> Cloud Sync
    const syncBtnLabel = document.querySelector("#sync-toggle span");
    if (syncBtnLabel && /sync-glashed/i.test(syncBtnLabel.textContent)) {
      syncBtnLabel.textContent = "Cloud Sync";
    }

    // Only change the SPECIFIC “Visual Horizons” titles you pointed out:
    // 1) The first card with data-horizon="hours"
    const hoursCardTitle = document.querySelector('.horizon-section[data-horizon="hours"] .section-header h4');
    if (hoursCardTitle && /visual\s+horizons/i.test(hoursCardTitle.textContent)) {
      hoursCardTitle.innerHTML = `<i class="fas fa-clock"></i> Hours`;
    }
    // 2) Cascade bottom level data-level="hours"
    const cascadeHours = document.querySelector('.cascade-level[data-level="hours"] h4');
    if (cascadeHours && /visual\s+horizons/i.test(cascadeHours.textContent)) {
      cascadeHours.textContent = "Hours";
    }
  }

  /* -------- Service Worker (versioned) -------- */
  setupServiceWorker() {
    if ("serviceWorker" in navigator) {
      const register = () =>
        navigator.serviceWorker
          .register(`./sw.js?v=${APP_VERSION}`)
          .then((reg) => {
            // When a new SW is installed while one is controlling the page: reload to get fresh assets
            reg.onupdatefound = () => {
              const sw = reg.installing;
              if (!sw) return;
              sw.onstatechange = () => {
                if (sw.state === "installed" && navigator.serviceWorker.controller) {
                  window.location.reload();
                }
              };
            };
          })
          .catch((err) => console.log("❌ SW registration failed:", err));

      window.addEventListener("load", register);
      navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
    }
  }

  /* -------- Cloud Sync -------- */
  async initCloudSync() {
    const syncConfig = this.loadSyncConfig();
    this.updateSyncUI();

    // Reconnect quietly ONLY if previously enabled
    if (syncConfig && syncConfig.enabled && syncConfig.sessionId) {
      try {
        await this.enableCloudSync(syncConfig.sessionId, { quiet: true, reconnect: true });
      } catch (error) {
        console.warn("Failed to reconnect cloud sync:", error);
        this.disableCloudSync({ silent: true });
      }
    } else {
      // Default state: not syncing, no toast
      this.syncEnabled = false;
      this.updateSyncUI();
    }
  }

  async enableCloudSync(sessionId = null, opts = {}) {
    const { quiet = false } = opts;
    try {
      this.syncEnabled = true;
      this.updateSyncUI();
      if (!quiet) this.showNotification("Setting up cloud sync...", "info");

      await this.cloudSync.enable(sessionId);

      this.cloudSync.onDataChange((remoteData) => {
        if (this.shouldAcceptRemoteData(remoteData)) this.handleRemoteData(remoteData);
      });

      const merged = await this.cloudSync.sync(this.data);
      if (merged) { this.data = merged; this.saveData(false); this.renderCurrentView(); }

      this.saveSyncConfig({ enabled: true, sessionId: this.cloudSync.sessionId });
      this.updateSyncUI();
      if (!quiet) this.showNotification("Cloud sync enabled!", "success");
    } catch (error) {
      console.error("Cloud sync enable failed:", error);
      if (!quiet) this.showNotification("Cloud sync unavailable. Using local storage.", "warning");
      this.disableCloudSync({ silent: quiet });
    }
  }

  disableCloudSync(opts = {}) {
    const { silent = false } = opts;
    const wasEnabled = this.syncEnabled;

    this.syncEnabled = false;
    this.cloudSync.disable();
    this.saveSyncConfig({ enabled: false, sessionId: null });
    this.updateSyncUI();

    // Only show toast if user actively turned it off
    if (!silent && wasEnabled) {
      this.showNotification("Cloud sync disabled", "info");
    }
  }

  handleRemoteData(remoteData) {
    if (this.shouldAcceptRemoteData(remoteData)) {
      this.data = remoteData;
      this.saveData(false);
      this.renderCurrentView();
      this.showNotification("Changes synced from cloud", "info");
    }
  }

  shouldAcceptRemoteData(remoteData) {
    if (!remoteData || !remoteData.lastSaved) return false;
    if (!this.data.lastSaved) return true;
    return new Date(remoteData.lastSaved) > new Date(this.data.lastSaved);
  }

  saveData(triggerSync = true) {
    this.data.lastSaved = new Date().toISOString();
    this.data.version = APP_VERSION;
    localStorage.setItem("lifemapz-data", JSON.stringify(this.data));
    if (triggerSync && this.syncEnabled) {
      this.cloudSync.sync(this.data).catch(err => console.warn("Cloud sync failed:", err));
    }
  }

  showSyncModal() { this.openModal("sync-setup-modal"); }

  async createSyncSession() {
    try {
      await this.enableCloudSync(null, { quiet: false });
      this.closeModal("sync-setup-modal");
    } catch {
      this.showNotification("Failed to create sync session", "error");
    }
  }

  async joinSyncSession() {
    const code = document.getElementById("sync-code-input")?.value.trim();
    if (!code) return this.showNotification("Please enter a sync code", "error");
    try {
      await this.enableCloudSync(code, { quiet: false });
      this.closeModal("sync-setup-modal");
    } catch {
      this.showNotification("Failed to join sync session", "error");
    }
  }

  showDataModal() { this.openModal("data-modal"); }

  loadSyncConfig() {
    const c = localStorage.getItem("lifemapz-sync-config");
    return c ? JSON.parse(c) : { enabled: false, sessionId: null };
  }

  saveSyncConfig(config) {
    localStorage.setItem("lifemapz-sync-config", JSON.stringify(config));
  }

  updateSyncUI() {
    const syncIndicator  = document.getElementById("sync-indicator");
    const syncDot        = document.getElementById("sync-dot-desktop"); // desktop dot (span)
    const syncDotMobile  = document.getElementById("sync-dot");         // mobile dot (span)
    const syncStatus     = document.getElementById("sync-status");
    const syncToggle     = document.getElementById("sync-toggle");

    if (syncDot && !syncDot.classList.contains("sync-dot-desktop")) {
      syncDot.classList.add("sync-dot-desktop");
    }

    if (this.syncEnabled) {
      syncIndicator?.classList.add("syncing");
      syncDot?.classList.add("syncing");
      syncDotMobile?.classList.add("syncing");
      syncToggle?.classList.add("syncing");
      if (syncStatus) syncStatus.textContent = "🟢 Syncing with cloud";
    } else {
      syncIndicator?.classList.remove("syncing");
      syncDot?.classList.remove("syncing");
      syncDotMobile?.classList.remove("syncing");
      syncToggle?.classList.remove("syncing");
      if (syncStatus) syncStatus.textContent = "⚫ Sync disabled";
    }
  }

  /* -------- Theme -------- */
  loadTheme() {
    const saved = localStorage.getItem("lifemapz-theme");
    return saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }

  applyTheme() {
    document.body.setAttribute("data-theme", this.currentTheme);
  }

  toggleTheme() {
    this.currentTheme = this.currentTheme === "light" ? "dark" : "light";
    this.applyTheme();
    localStorage.setItem("lifemapz-theme", this.currentTheme);
    this.showNotification(`${this.currentTheme === "dark" ? "Dark" : "Light"} mode enabled`, "success");
  }

  /* -------- Data model -------- */
  loadData() {
    const saved = localStorage.getItem("lifemapz-data");
    return saved ? JSON.parse(saved) : this.getDefaultData();
  }

  getDefaultData() {
    return {
      version: APP_VERSION,
      tasks: [],
      lastSaved: new Date().toISOString()
    };
  }

  setupSampleData() {
    if (this.data.tasks.length === 0) {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      this.data.tasks = [
        {
          id: "1",
          title: "Morning Workout",
          description: "Complete morning exercise routine",
          horizon: "hours",
          priority: "medium",
          completed: false,
          createdAt: now.toISOString(),
          timeSettings: {
            date: this.toInputDate(now),
            startTime: "07:00",
            endTime: "08:00",
            repeat: "daily",
            weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"]
          },
          cascadesTo: ["days"]
        },
        {
          id: "2",
          title: "Plan weekly goals",
          description: "Set objectives for the week",
          horizon: "weeks",
          priority: "high",
          completed: false,
          createdAt: now.toISOString(),
          timeSettings: {
            date: this.toInputDate(now),
            startTime: "09:00",
            endTime: "10:00",
            repeat: "weekly",
            weekdays: ["monday"]
          },
          cascadesTo: ["months"]
        },
        {
          id: "3",
          title: "Annual review preparation",
          description: "Prepare for year-end review",
          horizon: "years",
          priority: "medium",
          completed: false,
          createdAt: now.toISOString(),
          timeSettings: {
            date: this.toInputDate(tomorrow),
            startTime: "14:00",
            endTime: "16:00",
            repeat: "none"
          },
          cascadesTo: ["life"]
        }
      ];
      this.saveData();
    }
  }

  /* -------- Auth wiring -------- */
  bindEvents() {
    // Auth UI
    const emailEl   = document.getElementById("email");
    const passEl    = document.getElementById("password");
    const signupBtn = document.getElementById("btn-signup");
    const loginBtn  = document.getElementById("btn-login");
    const googleBtn = document.getElementById("btn-google");
    const logoutBtn = document.getElementById("btn-logout");
    const authPanel = document.getElementById("auth-panel");
    const userPanel = document.getElementById("user-panel");
    const whoami    = document.getElementById("whoami");
    const msgEl     = document.getElementById("auth-msg");

    const showMsg = (txt) => {
      if (!msgEl) { alert(txt); return; }
      msgEl.textContent = txt;
      setTimeout(() => (msgEl.textContent = ""), 4000);
    };

    // Prefill helper (dev)
    if (emailEl && !emailEl.value) emailEl.value = "bongjacib@gmail.com";

    // Auth state
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        if (authPanel) authPanel.style.display = "none";
        if (userPanel) userPanel.style.display = "block";
        if (whoami) whoami.textContent = `Signed in as ${user.email || user.displayName || user.uid}`;
        try {
          const ref = db.collection("users").doc(user.uid);
          const snap = await ref.get();
          if (!snap.exists) {
            await ref.set({
              email: user.email || null,
              displayName: user.displayName || null,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          }
        } catch (e) {
          console.warn("User bootstrap error:", e);
        }
      } else {
        if (authPanel) authPanel.style.display = "block";
        if (userPanel) userPanel.style.display = "none";
        if (whoami) whoami.textContent = "";
      }
    });

    // Email/password: Sign up
    signupBtn?.addEventListener("click", async () => {
      try {
        const email = emailEl?.value?.trim();
        const pass  = passEl?.value ?? "";
        if (!email || !pass) return showMsg("Enter email and password.");
        await auth.createUserWithEmailAndPassword(email, pass);
      } catch (e) {
        showMsg(e.message || String(e));
      }
    });

    // Email/password: Log in
    loginBtn?.addEventListener("click", async () => {
      try {
        const email = emailEl?.value?.trim();
        const pass  = passEl?.value ?? "";
        if (!email || !pass) return showMsg("Enter email and password.");
        await auth.signInWithEmailAndPassword(email, pass);
      } catch (e) {
        showMsg(e.message || String(e));
      }
    });

    // ---- Google Sign-In (mobile-safe + visible redirect result) ----
    const googleProvider = new firebase.auth.GoogleAuthProvider();

    function googleSignIn() {
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      // On mobile/PWA: always use redirect
      if (isStandalone || isMobile) {
        return auth.signInWithRedirect(googleProvider);
      }

      // Desktop: try popup; if blocked, fall back to redirect
      return auth.signInWithPopup(googleProvider).catch((err) => {
        console.warn("Popup failed; falling back to redirect:", err && err.code);
        return auth.signInWithRedirect(googleProvider);
      });
    }

    // Wire button
    googleBtn?.addEventListener("click", async () => {
      try { await googleSignIn(); }
      catch (e) {
        const msg = (e && (e.code || e.message)) || String(e);
        console.warn("googleSignIn error:", msg);
        const m = document.getElementById("auth-msg");
        if (m) m.textContent = msg;
        else alert(msg);
      }
    });

    // 3) Complete the redirect flow EARLY and show any error in the banner
    auth.getRedirectResult()
      .then((result) => {
        if (result && result.user) {
          const who = document.getElementById("whoami");
          if (who) who.textContent = `Signed in as ${result.user.email || result.user.displayName || result.user.uid}`;
          const m = document.getElementById("auth-msg");
          if (m) m.textContent = "Signed in!";
        }
      })
      .catch((e) => {
        const msg = (e && (e.code || e.message)) || String(e);
        console.warn("getRedirectResult error:", msg);
        const m = document.getElementById("auth-msg");
        if (m) m.textContent = msg; else alert(msg);
      });

    // Log out
    logoutBtn?.addEventListener("click", async () => {
      try { await auth.signOut(); }
      catch (e) { showMsg(e.message || String(e)); }
    });

    // App-wide events
    document.getElementById("task-form")?.addEventListener("submit", (e) => { e.preventDefault(); this.saveTask(); });

    document.addEventListener("click", (e) => {
      const item = e.target.closest(".sidebar-item[data-view]");
      if (item) {
        const view = item.dataset.view;
        this._handleSidebarViewClick(view);
      }
      if (e.target.classList.contains("modal")) this.closeModal(e.target.id);
    });

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "n") { e.preventDefault(); this.openTaskModal(); }
      if (e.key === "Escape") this.closeAllModals();
    });

    this.setupTimeModalEvents();
  }

  _handleSidebarViewClick(view) {
    // Only 'horizons' and 'cascade' are full-page views
    const targetViewEl = document.getElementById(`${view}-view`);
    if (targetViewEl) {
      this.switchView(view);
      return;
    }
    // If it's one of the horizons (days/weeks/etc.), scroll the section inside Horizons view
    const horizonIds = ["hours", "days", "weeks", "months", "years", "life"];
    if (horizonIds.includes(view)) {
      this.switchView("horizons");
      const section = document.querySelector(`.horizon-section[data-horizon="${view}"]`);
      if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* -------- Time modal events -------- */
  setupTimeModalEvents() {
    this.ensureDatePicker();

    document.querySelectorAll(".repeat-option").forEach(btn => {
      btn.addEventListener("click", (e) => {
        document.querySelectorAll(".repeat-option").forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");
        const type = e.target.dataset.repeat;
        const wk = document.getElementById("weekday-options");
        if (wk) wk.style.display = type === "weekly" ? "block" : "none";
        this.updateUpcomingDates();
      });
    });

    document.querySelectorAll(".weekday-btn").forEach(btn => {
      btn.addEventListener("click", (e) => { 
        e.target.classList.toggle("active"); 
        this.updateUpcomingDates(); 
      });
    });

    document.getElementById("task-start-time")?.addEventListener("change", () => this.updateUpcomingDates());
    document.getElementById("task-end-time")?.addEventListener("change", () => this.updateUpcomingDates());

    document.addEventListener("change", (e) => {
      if (e.target && e.target.id === "task-date") this._onDateChanged(e.target.value);
    });

    const header = document.getElementById("selected-date-display");
    if (header) header.style.cursor = "pointer";
    header?.addEventListener("click", () => this.showRescheduleOptions());
  }

  ensureDatePicker() {
    let dateEl = document.getElementById("task-date");
    if (!dateEl) {
      const timeModalBody = document.querySelector("#time-modal .time-modal-body");
      const dateDisplay = timeModalBody?.querySelector(".date-display-section");
      if (dateDisplay) {
        const datePickerContainer = document.createElement("div");
        datePickerContainer.className = "date-picker-container";
        datePickerContainer.innerHTML = `
          <label for="task-date">Select Date</label>
          <input type="date" id="task-date" class="date-picker-input">
        `;
        dateDisplay.insertAdjacentElement("afterend", datePickerContainer);
        dateEl = document.getElementById("task-date");
        if (dateEl) dateEl.addEventListener("change", (e) => this._onDateChanged(e.target.value));
      }
    }
    return dateEl;
  }

  /* -------- Views -------- */
  switchView(viewName) {
    if (!viewName || viewName === this.currentView) return;

    document.querySelectorAll(".sidebar-item").forEach(i => i.classList.remove("active"));
    const item = document.querySelector(`[data-view="${viewName}"]`);
    if (item) item.classList.add("active");

    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    const v = document.getElementById(`${viewName}-view`);
    if (v) v.classList.add("active");

    this.currentView = viewName;

    const titles = { "horizons": "Visual Horizons", "cascade": "Cascade Flow" };
    const titleEl = document.getElementById("current-view-title");
    if (titleEl) titleEl.textContent = titles[viewName] || viewName;

    this.renderCurrentView();
    if (window.innerWidth <= 768) this.toggleMobileMenu(false);
  }

  _toDateOnly(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
  _isSameDay(a,b){ return this._toDateOnly(a).getTime()===this._toDateOnly(b).getTime(); }
  _startOfWeek(d){ const dt=this._toDateOnly(d); const dow=dt.getDay(); dt.setDate(dt.getDate()-dow); return dt; }
  _endOfWeek(d){ const s=this._startOfWeek(d); const e=new Date(s); e.setDate(e.getDate()+6); return e; }
  _isInCurrentWeek(d){ const t=new Date(); const s=this._startOfWeek(t); const e=this._endOfWeek(t); const x=this._toDateOnly(d); return x>=s && x<=e; }
  _isInCurrentMonth(d){ const t=new Date(); return d.getFullYear()===t.getFullYear() && d.getMonth()===t.getMonth(); }
  _isInCurrentYear(d){ const t=new Date(); return d.getFullYear()===t.getFullYear(); }
  _taskDate(task){ const ds=task?.timeSettings?.date; if(!ds)return null; const d=new Date(ds); return isNaN(d)?null:d; }

  _getTasksForHorizon(horizon) {
    const tasks = [];
    for (const task of this.data.tasks) {
      if (task.completed) continue;
      if (task.horizon === horizon) { tasks.push(task); continue; }
      if (task.cascadesTo && task.cascadesTo.includes(horizon)) tasks.push(task);
    }
    return tasks;
  }

  renderCurrentView() {
    if (this.currentView === "horizons") this.renderHorizonsView();
    else if (this.currentView === "cascade") this.renderCascadeView();
  }

  renderHorizonsView() {
    const horizons = ["hours", "days", "weeks", "months", "years", "life"];
    horizons.forEach(h => {
      const container = document.getElementById(`${h}-tasks`);
      if (!container) return;
      const tasks = this._getTasksForHorizon(h);
      container.innerHTML = tasks.length === 0
        ? '<div class="empty-state">No tasks yet. Click + to add one.</div>'
        : tasks.map(t => this.renderTaskItem(t)).join("");
    });
  }

  renderTaskItem(task) {
    const timeInfo = task.timeSettings ? this.renderTimeInfo(task.timeSettings) : "";
    return `
      <div class="task-item" data-id="${task.id}">
        <div class="task-content">
          <div class="task-title">${this.escapeHtml(task.title)}</div>
          ${task.description ? `<div class="task-meta">${this.escapeHtml(task.description)}</div>` : ""}
          ${timeInfo}
          ${task.cascadesTo && task.cascadesTo.length > 0
            ? `<div class="task-meta"><small>Cascades to: ${task.cascadesTo.join(", ")}</small></div>`
            : ""}
        </div>
        <div class="task-actions">
          <button class="task-btn" onclick="app.editTask('${task.id}')" title="Edit Task"><i class="fas fa-edit"></i></button>
          <button class="task-btn" onclick="app.deleteTask('${task.id}')" title="Delete Task"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;
  }

  renderTimeInfo(ts) {
    let html = `<div class="task-time-info"><i class="fas fa-clock"></i> ${ts.startTime} - ${ts.endTime}`;
    if (ts.date) {
      try {
        const date = new Date(ts.date);
        html += ` • ${date.toLocaleDateString()}`;
      } catch {}
    }
    if (ts.repeat && ts.repeat !== "none") {
      html += ` • <span class="repeat-badge">${ts.repeat}</span>`;
      if (ts.repeat === "weekly" && ts.weekdays && ts.weekdays.length > 0) {
        html += ` (${ts.weekdays.map(d => d.substring(0,3)).join(", ")})`;
      }
    }
    html += `</div>`;
    return html;
  }

  renderCascadeView() {
    const horizons = ["life", "years", "months", "weeks", "days", "hours"];
    horizons.forEach(h => {
      const container = document.getElementById(`cascade-${h}`);
      if (!container) return;
      const tasks = this.data.tasks.filter(t => t.horizon === h && !t.completed);
      container.innerHTML = tasks.map(t => `
        <div class="cascade-task">
          <strong>${this.escapeHtml(t.title)}</strong>
          ${t.description ? `<div>${this.escapeHtml(t.description)}</div>` : ""}
          ${t.timeSettings ? `<div><small>${this.renderTimeSummary(t.timeSettings)}</small></div>` : ""}
          ${t.cascadesTo ? `<div><small>→ ${t.cascadesTo.join(" → ")}</small></div>` : ""}
        </div>
      `).join("") || '<div class="empty-state">No tasks</div>';
    });
  }

  /* -------- Time modal logic -------- */
  openTimeModal() {
    const dateEl = this.ensureDatePicker();
    const now = new Date();
    const existing = this.currentTaskTimeData?.timeSettings?.date;
    const initDate = existing ? new Date(existing) : now;

    if (dateEl) dateEl.value = this.toInputDate(initDate);
    const disp = document.getElementById("selected-date-display");
    if (disp) disp.textContent = this.formatDateDisplay(initDate);

    if (this.currentTaskTimeData.timeSettings) {
      this.populateTimeModal(this.currentTaskTimeData.timeSettings);
    } else {
      this.setDefaultTimeSettings();
    }

    const resBtn = document.querySelector("#time-modal .time-action-buttons .time-action-btn");
    if (resBtn) resBtn.onclick = () => this.showRescheduleOptions();

    const header = document.getElementById("selected-date-display");
    if (header) { header.style.cursor = "pointer"; header.onclick = () => this.showRescheduleOptions(); }

    this.updateUpcomingDates();
    this.openModal("time-modal");
  }

  populateTimeModal(ts) {
    if (ts.startTime) document.getElementById("task-start-time").value = ts.startTime;
    if (ts.endTime) document.getElementById("task-end-time").value = ts.endTime;
    if (ts.date) {
      const d = new Date(ts.date);
      const el = document.getElementById("task-date");
      if (el) el.value = this.toInputDate(d);
      const disp = document.getElementById("selected-date-display");
      if (disp) disp.textContent = this.formatDateDisplay(d);
    }
    if (ts.repeat) this.setActiveRepeatOption(ts.repeat);
    if (ts.weekdays) this.setActiveWeekdays(ts.weekdays);
    this.updateUpcomingDates();
  }

  setDefaultTimeSettings() {
    const now = new Date();
    const nextHalf = (Math.floor(now.getMinutes() / 30) * 30 + 30) % 60;
    const startTime = this.formatTime(now.getHours(), nextHalf);
    const endTime = this.formatTime((now.getHours() + 1) % 24, now.getMinutes());
    document.getElementById("task-start-time").value = startTime;
    document.getElementById("task-end-time").value = endTime;
    const dateEl = document.getElementById("task-date");
    if (dateEl) dateEl.value = this.toInputDate(now);
    this.setActiveRepeatOption("none");
  }

  formatTime(h, m) { return `${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}`; }

  toInputDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  formatDateDisplay(date) {
    const opts = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    return date.toLocaleDateString("en-US", opts);
  }

  setActiveRepeatOption(type) {
    document.querySelectorAll(".repeat-option").forEach(btn => {
      btn.classList.remove("active");
      if (btn.dataset.repeat === type) btn.classList.add("active");
    });
    const wk = document.getElementById("weekday-options");
    if (wk) wk.style.display = type === "weekly" ? "block" : "none";
  }

  setActiveWeekdays(days) {
    document.querySelectorAll(".weekday-btn").forEach(btn => {
      btn.classList.remove("active");
      if (days.includes(btn.dataset.day)) btn.classList.add("active");
    });
  }

  toggleRepeatOptions() {
    const rs = document.getElementById("repeat-section");
    if (rs) rs.style.display = "block";
  }

  showRescheduleOptions() {
    const dateEl = this.ensureDatePicker();
    if (!dateEl) return;
    try {
      if (typeof dateEl.showPicker === "function") { dateEl.showPicker(); return; }
      dateEl.focus(); dateEl.click();
    } catch {
      this.createFallbackDatePicker(dateEl);
    }
  }

  createFallbackDatePicker(originalEl) {
    const tmp = document.createElement("input");
    tmp.type = "date";
    tmp.value = originalEl.value || this.toInputDate(new Date());
    tmp.style.position = "fixed";
    tmp.style.left = "-9999px";
    document.body.appendChild(tmp);

    tmp.addEventListener("change", () => {
      originalEl.value = tmp.value;
      tmp.remove();
      this._onDateChanged(originalEl.value);
    }, { once: true });

    tmp.addEventListener("blur", () => { setTimeout(() => tmp.remove(), 100); }, { once: true });
    tmp.click();
  }

  _onDateChanged(value) {
    const d = value ? new Date(value) : new Date();
    const disp = document.getElementById("selected-date-display");
    if (disp) disp.textContent = this.formatDateDisplay(d);
    if (!this.currentTaskTimeData.timeSettings) this.currentTaskTimeData.timeSettings = {};
    this.currentTaskTimeData.timeSettings.date = this.toInputDate(d);
    this.updateUpcomingDates();
    this.updateTimeSummary();
  }

  removeDateTime() {
    if (confirm("Remove all time settings for this task?")) {
      this.currentTaskTimeData.timeSettings = null;
      const summary = document.getElementById("time-summary");
      if (summary) summary.textContent = "No time set";
      this.closeModal("time-modal");
      this.showNotification("Time settings removed", "success");
    }
  }

  saveTimeSettings() {
    const timeSettings = {
      date: document.getElementById("task-date")?.value || null,
      startTime: document.getElementById("task-start-time").value,
      endTime: document.getElementById("task-end-time").value,
      repeat: this.getSelectedRepeatOption(),
      weekdays: this.getSelectedWeekdays(),
      createdAt: new Date().toISOString()
    };

    this.currentTaskTimeData.timeSettings = timeSettings;
    this.updateTimeSummary();
    this.closeModal("time-modal");
    this.showNotification("Time settings saved!", "success");
  }

  getSelectedRepeatOption() {
    const active = document.querySelector(".repeat-option.active");
    return active ? active.dataset.repeat : "none";
  }

  getSelectedWeekdays() {
    return Array.from(document.querySelectorAll(".weekday-btn.active")).map(b => b.dataset.day);
  }

  updateTimeSummary() {
    const summary = document.getElementById("time-summary");
    const s = this.currentTaskTimeData.timeSettings;
    if (!summary) return;
    if (!s) { summary.textContent = "No time set"; return; }
    summary.textContent = this.renderTimeSummary(s);
  }

  renderTimeSummary(s) {
    let text = `${s.startTime} - ${s.endTime}`;
    if (s.date) {
      try { text += ` • ${new Date(s.date).toLocaleDateString()}`; } catch {}
    }
    if (s.repeat && s.repeat !== "none") {
      text += ` • ${s.repeat}`;
      if (s.repeat === "weekly" && s.weekdays && s.weekdays.length > 0) {
        text += ` (${s.weekdays.map(d => d.substring(0,3)).join(", ")})`;
      }
    }
    return text;
  }

  updateUpcomingDates() {
    const list = document.querySelector(".upcoming-list");
    if (!list) return;

    const baseDateStr = document.getElementById("task-date")?.value;
    const repeat = this.getSelectedRepeatOption();
    const weekdays = this.getSelectedWeekdays();

    let startDate = baseDateStr ? new Date(baseDateStr) : new Date();
    startDate.setHours(0,0,0,0);

    const items = [];
    const pushDate = (d) => items.push(`<div class="upcoming-item"><strong>${this.formatDateDisplay(d)}</strong></div>`);
    const weekdayIndex = (day) => ({sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6}[day]);

    if (repeat === "none") {
      pushDate(startDate);
    } else if (repeat === "daily") {
      for (let i=0; i<3; i++) { const d = new Date(startDate); d.setDate(d.getDate()+i); pushDate(d); }
    } else if (repeat === "weekly") {
      const chosen = weekdays.map(weekdayIndex).filter(v => v!==undefined).sort((a,b)=>a-b);
      if (chosen.length === 0) chosen.push(startDate.getDay());

      let count = 0;
      let currentDate = new Date(startDate);

      while (count < 3) {
        for (const w of chosen) {
          const next = new Date(currentDate);
          const delta = (w - next.getDay() + 7) % 7;
          next.setDate(next.getDate() + delta);

          if (next >= startDate) {
            pushDate(next);
            count++;
            if (count >= 3) break;
          }
        }
        currentDate.setDate(currentDate.getDate() + 7);
      }
    } else if (repeat === "monthly") {
      for (let i=0; i<3; i++) {
        const d = new Date(startDate);
        d.setMonth(d.getMonth()+i);
        const day = startDate.getDate();
        const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
        d.setDate(Math.min(day, last));
        pushDate(d);
      }
    } else if (repeat === "yearly") {
      for (let i=0; i<3; i++) {
        const d = new Date(startDate);
        d.setFullYear(d.getFullYear()+i);
        pushDate(d);
      }
    }

    list.innerHTML = items.join("");
  }

  /* -------- Task CRUD -------- */
  openTaskModal(taskData = {}) {
    const isEdit = !!taskData.id;
    const titleEl = document.getElementById("task-modal-title");
    const submitText = document.getElementById("task-submit-text");
    if (titleEl) titleEl.textContent = isEdit ? "Edit Task" : "Add Task";
    if (submitText) submitText.textContent = isEdit ? "Update Task" : "Add Task";

    this.currentTaskTimeData = { ...taskData };
    if (isEdit) {
      document.getElementById("edit-task-id").value = taskData.id;
      document.getElementById("task-title").value = taskData.title || "";
      document.getElementById("task-description").value = taskData.description || "";
      document.getElementById("task-horizon").value = taskData.horizon || "hours";
      document.getElementById("task-priority").value = taskData.priority || "medium";
      this.updateTimeSummary();
    } else {
      document.getElementById("edit-task-id").value = "";
      document.getElementById("task-form").reset();
      const summary = document.getElementById("time-summary");
      if (summary) summary.textContent = "No time set";
    }
    this.updateCascadeOptions();
    this.openModal("task-modal");
  }

  updateCascadeOptions() {
    const horizon = document.getElementById("task-horizon").value;
    const cascadeGroup = document.getElementById("cascade-group");

    if (horizon) {
      cascadeGroup.style.display = "block";
      const horizons = ["hours", "days", "weeks", "months", "years", "life"];
      const currentIndex = horizons.indexOf(horizon);

      document.querySelectorAll('input[name="cascade"]').forEach(cb => {
        const targetIndex = horizons.indexOf(cb.value);
        cb.disabled = targetIndex <= currentIndex;
        if (targetIndex > currentIndex && !cb.disabled) cb.checked = true;
      });
    } else {
      cascadeGroup.style.display = "none";
    }
  }

  getCascadeSelections() {
    return Array.from(document.querySelectorAll('input[name="cascade"]:checked')).map(cb => cb.value);
  }

  editTask(taskId) {
    const t = this.data.tasks.find(tt => tt.id === taskId);
    if (t) this.openTaskModal(t);
  }

  deleteTask(taskId) {
    if (confirm("Are you sure you want to delete this task?")) {
      this.data.tasks = this.data.tasks.filter(t => t.id !== taskId);
      this.saveData();
      this.renderCurrentView();
      this.showNotification("Task deleted", "success");
    }
  }

  addToHorizon(h) { this.openTaskModal({ horizon: h }); }

  saveTask() {
    const form = document.getElementById("task-form");
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const isEdit = !!document.getElementById("edit-task-id").value;
    const taskId = isEdit ? document.getElementById("edit-task-id").value : this.generateId();

    const task = {
      id: taskId,
      title: document.getElementById("task-title").value.trim(),
      description: document.getElementById("task-description").value.trim(),
      horizon: document.getElementById("task-horizon").value,
      priority: document.getElementById("task-priority").value,
      completed: false,
      createdAt: isEdit ? (this.data.tasks.find(t => t.id === taskId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      lastModified: new Date().toISOString(),
      cascadesTo: this.getCascadeSelections(),
      timeSettings: this.currentTaskTimeData?.timeSettings || null
    };

    if (isEdit) {
      const idx = this.data.tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) this.data.tasks[idx] = task;
    } else {
      this.data.tasks.push(task);
    }

    this.saveData();
    this.closeModal("task-modal");
    this.renderCurrentView();
    this.showNotification(`Task ${isEdit ? "updated" : "added"} successfully`, "success");
  }

  /* -------- Data Management -------- */
  exportData() {
    const dataStr = JSON.stringify(this.data, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lifemapz-backup-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    this.showNotification("Backup exported successfully", "success");
  }

  importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target.result);
        if (importedData && importedData.tasks) {
          this.data = importedData;
          this.saveData();
          this.renderCurrentView();
          this.showNotification("Data imported successfully", "success");
        } else {
          this.showNotification("Invalid backup file", "error");
        }
      } catch {
        this.showNotification("Error reading backup file", "error");
      }
    };
    reader.readAsText(file);
  }

  clearAllData() {
    if (confirm("⚠️ This will permanently delete ALL your tasks and settings. This cannot be undone!")) {
      this.data = this.getDefaultData();
      this.saveData();
      this.renderCurrentView();
      this.showNotification("All data cleared", "success");
    }
  }

  /* -------- Misc helpers -------- */
  openModal(id) { const el = document.getElementById(id); if (el){ el.style.display = "block"; document.body.style.overflow = "hidden"; } }
  closeModal(id) { const el = document.getElementById(id); if (el){ el.style.display = "none"; document.body.style.overflow = ""; } }
  closeAllModals() { document.querySelectorAll(".modal").forEach(m => m.style.display = "none"); document.body.style.overflow = ""; }

  toggleMobileMenu(show) {
    const sidebar = document.getElementById("main-sidebar");
    if (sidebar){
      if (typeof show === "boolean") sidebar.classList.toggle("active", show);
      else sidebar.classList.toggle("active");
    }
  }

  generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2,5); }

  escapeHtml(text) { const div = document.createElement("div"); div.textContent = text; return div.innerHTML; }

  updateDateDisplay() {
    const now = new Date();
    const opts = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    const el = document.getElementById("current-date");
    if (el) el.textContent = now.toLocaleDateString("en-US", opts);
  }

  showNotification(msg, type="info") {
    document.querySelectorAll(".notification").forEach(n => n.remove());
    const el = document.createElement("div");
    el.className = `notification notification-${type}`;
    el.innerHTML = `
      <div class="notification-content">
        <i class="fas fa-${type === "success" ? "check" : type === "error" ? "exclamation-triangle" : "info"}"></i>
        <span>${this.escapeHtml(msg)}</span>
      </div>
    `;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.animation = "slideOut 0.3s ease";
      setTimeout(() => el.parentNode && el.parentNode.removeChild(el), 300);
    }, 3000);
  }
}

/* --------------------- Boot --------------------- */
document.addEventListener("DOMContentLoaded", () => {
  window.app = new LifeMapzApp();
});
