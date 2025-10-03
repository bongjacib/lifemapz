/* LifeMapz - Visual Time Horizons App v3.1.3
   Changes:
   - Fixed Cloud Sync URL construction & template strings
   - JSONBin v3 request/response shape (record wrapper) & safe client fallback
   - Stronger error handling/logging across sync paths
   - AUTO_LINK_CLOUD: persist/recover session under users/{uid}/app/lifemapz with opt-out
   - Status badge reflects Cloud vs Account sync
   - Added missing modal methods for sync and data management
   - ✅ Hours view now shows *today-only* items (no past spillover)
   - ✅ Added Calendar view (read-only month grid) under Views > Calendar
   - ✨ Calendar task lines truncated to 12 chars for clean squares
   - ✨ Month label opens month picker; day click → Hours for that day
   - ✨ Hours shows "Back to Today" chip when viewing a specific date
   - ✨ "+" in Hours pre-fills the selected day for new tasks
*/

const APP_VERSION = (window && window.LIFEMAPZ_VERSION) || "3.1.3";
/** If true, store/read cloud session id in Firestore so devices auto-join after login */
const AUTO_LINK_CLOUD = true;
/** Toggle verbose logs */
const DEBUG = false;

/* --------------------- Firebase --------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyBgiYPtoh7VILEcUdy1oyPfaqMRQP5nQl0",
  authDomain: "lifemapz-project.firebaseapp.com",
  projectId: "lifemapz-project",
  storageBucket: "lifemapz-project.appspot.com",
  messagingSenderId: "305063601285",
  appId: "1:305063601285:web:6fb6eebbe4f00f20dcf5ec"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage?.();

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) =>
  console.warn("Auth persistence fallback:", e && (e.code || e.message))
);

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
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
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
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    clearTimeout(id);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
  }
};

/* --------------------- CloudSyncService (fixed) --------------------- */
class CloudSyncService {
  constructor() {
    this.pantry = { base: "https://getpantry.cloud/apiv1/pantry", basket: "lifemapz", pantryId: null };
    this.jsonbin = {
      base: "https://api.jsonbin.io/v3/b",
      binId: null,
      get headers() {
        const key = (typeof window !== "undefined" && window.JSONBIN_KEY) ? window.JSONBIN_KEY : null;
        return key ? { "Content-Type": "application/json", "X-Master-Key": key } : { "Content-Type": "application/json" };
      },
      get enabled() { return !!(typeof window !== "undefined" && window.JSONBIN_KEY); }
    };
    this.backend = null;
    this.isEnabled = false;
    this.syncInterval = null;
    this.dataChangeCallbacks = [];
    this.lastSyncTime = null;
    this._lastRemoteStamp = null;
    this._sessionId = null;
  }

  async enable(sessionCode = null) {
    if (!sessionCode) sessionCode = this._loadSession() || null;
    if (sessionCode && this._isLegacyKvdbCode(sessionCode)) {
      await this._migrateFromKvdb(sessionCode);
      sessionCode = this._loadSession();
    }
    if (sessionCode) await this._parseAndSetSession(sessionCode);
    else await this._createPantrySession();

    try {
      const current = await this._getRemote();
      if (!current) await this._saveRemote(this._initDoc());
    } catch (error) {
      if (this.backend === "pantry" && this.jsonbin.enabled) {
        await this._createJsonBinSession();
        await this._saveRemote(this._initDoc());
      } else {
        throw new Error(`Cloud Sync initialization failed: ${error.message}`);
      }
    }

    this.isEnabled = true;
    this._startPolling();
    return true;
  }

  disable() {
    this.isEnabled = false;
    this._lastRemoteStamp = null;
    if (this.syncInterval) { clearInterval(this.syncInterval); this.syncInterval = null; }
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
    } catch (error) {
      if (this.backend === "pantry" && this.jsonbin.enabled) {
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
  get sessionId() { return this._sessionId; }
  getSyncStatus() { return { enabled: this.isEnabled, backend: this.backend, sessionId: this.sessionId, lastSync: this.lastSyncTime }; }

  async _parseAndSetSession(code) {
    if (code.startsWith("pantry:")) { this.backend = "pantry"; this.pantry.pantryId = code.split(":")[1]; this._sessionId = code; this._saveSession(); return; }
    if (code.startsWith("jsonbin:")) { this.backend = "jsonbin"; this.jsonbin.binId = code.split(":")[1]; this._sessionId = code; this._saveSession(); return; }
    this.backend = "pantry"; this.pantry.pantryId = code; this._sessionId = `pantry:${code}`; this._saveSession();
  }

  async _createPantrySession() {
    const res = await http.post(`${this.pantry.base}`, { description: "LifeMapz Sync Session" });
    const pid = res?.data?.pantryId || res?.data?.id;
    if (!pid) throw new Error("GetPantry: no pantryId in response");
    this.pantry.pantryId = pid;
    this.backend = "pantry";
    this._sessionId = `pantry:${pid}`;
    this._saveSession();
    await http.put(`${this.pantry.base}/${this.pantry.pantryId}/basket/${this.pantry.basket}`, this._initDoc());
  }

  async _createJsonBinSession() {
    if (!this.jsonbin.enabled) throw new Error("JSONBin disabled (no key provided)");
    const initData = this._initDoc();
    const res = await http.post(`${this.jsonbin.base}`, { record: initData }, { headers: this.jsonbin.headers });
    const id = res?.data?.metadata?.id || res?.data?.id;
    if (!id) throw new Error("JSONBin: no id in response");
    this.jsonbin.binId = id;
    this.backend = "jsonbin";
    this._sessionId = `jsonbin:${id}`;
    this._saveSession();
  }

  async _getRemote() {
    if (!this.backend) throw new Error("No backend selected");
    if (this.backend === "pantry") {
      if (!this.pantry.pantryId) throw new Error("Pantry ID not set");
      const res = await http.get(`${this.pantry.base}/${this.pantry.pantryId}/basket/${this.pantry.basket}`);
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`Pantry status ${res.status}`);
      return (res && typeof res.data === "object") ? res.data : null;
    }
    if (this.backend === "jsonbin") {
      if (!this.jsonbin.binId) throw new Error("JSONBin ID not set");
      const res = await http.get(`${this.jsonbin.base}/${this.jsonbin.binId}/latest`, { headers: { ...this.jsonbin.headers, "X-Bin-Meta": "false" } });
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`JSONBin status ${res.status}`);
      const body = res?.data?.record ?? res?.record ?? res?.data ?? null;
      return (body && typeof body === "object") ? body : null;
    }
    return null;
  }

  async _saveRemote(data) {
    if (!this.backend) throw new Error("No backend selected");
    if (this.backend === "pantry") {
      if (!this.pantry.pantryId) throw new Error("Pantry ID not set");
      await http.put(`${this.pantry.base}/${this.pantry.pantryId}/basket/${this.pantry.basket}`, data);
      return;
    }
    if (this.backend === "jsonbin") {
      if (!this.jsonbin.binId) throw new Error("JSONBin ID not set");
      await http.put(`${this.jsonbin.base}/${this.jsonbin.binId}`, { record: data }, { headers: this.jsonbin.headers });
      return;
    }
    throw new Error("Unsupported backend");
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
          this.dataChangeCallbacks.forEach(cb => { try { cb(remote); } catch (e) {} });
        }
      } catch {}
    }, 12000);
  }

  _initDoc() {
    const now = new Date().toISOString();
    return { version: APP_VERSION, tasks: [], lastSaved: now, createdAt: now, app: "LifeMapz" };
  }

  _saveSession() { if (this._sessionId) localStorage.setItem("lifemapz-sync-session", this._sessionId); }
  _loadSession() {
    const direct = localStorage.getItem("lifemapz-sync-session");
    if (direct) return direct;
    const cfg = localStorage.getItem("lifemapz-sync-config");
    if (cfg) { try { return JSON.parse(cfg)?.sessionId || null; } catch {} }
    return null;
  }
  _isLegacyKvdbCode(code) { if (!code) return false; if (code.startsWith("kvdb:")) return true; return !code.includes(":") && /^[a-z0-9]{10,}$/i.test(code); }
  async _migrateFromKvdb(code) {
    try {
      const bucketId = code.startsWith("kvdb:") ? code.split(":")[1] : code;
      let legacyData = null;
      try {
        const res = await http.get(`https://kvdb.io/${bucketId}/timestripe`, { responseType: "text" });
        if (res && res.status >= 200 && res.status < 300 && res.data) { try { legacyData = JSON.parse(res.data); } catch {} }
      } catch {}
      await this._createPantrySession();
      await this._saveRemote(legacyData && typeof legacyData === "object" ? legacyData : this._initDoc());
      const cfg = localStorage.getItem("lifemapz-sync-config");
      if (cfg) { try { const p = JSON.parse(cfg); p.sessionId = this.sessionId; p.enabled = true; localStorage.setItem("lifemapz-sync-config", JSON.stringify(p)); } catch {} }
    } catch (e) { throw e; }
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
    this.firebaseSync = { enabled:false, unsub:null, docRef:null, writing:false, lastRemote:null };
    this.syncEnabled = false;
    this.calendar = { current: new Date() };
    this.hoursDateOverride = null;
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

  _runtimeTextTweaks() {
    document.querySelectorAll(".sidebar-section h3").forEach(h3 => {
      if (h3.textContent.trim().toUpperCase() === "VERKS") h3.textContent = "VIEWS";
    });
    const themeBtnLabel = document.querySelector(".theme-toggle span");
    if (themeBtnLabel && /grand\s*\(groc\)/i.test(themeBtnLabel.textContent)) themeBtnLabel.textContent = "Dark Mode";
    const syncBtnLabel = document.querySelector("#sync-toggle span");
    if (syncBtnLabel && /sync-glashed/i.test(syncBtnLabel.textContent)) syncBtnLabel.textContent = "Cloud Sync";
    const hoursCardTitle = document.querySelector('.horizon-section[data-horizon="hours"] .section-header h4');
    if (hoursCardTitle && /visual\s+horizons/i.test(hoursCardTitle.textContent)) hoursCardTitle.innerHTML = `<i class="fas fa-clock"></i> Hours`;
    const cascadeHours = document.querySelector('.cascade-level[data-level="hours"] h4');
    if (cascadeHours && /visual\s+horizons/i.test(cascadeHours.textContent)) cascadeHours.textContent = "Hours";
  }

  setupServiceWorker() {
    if ("serviceWorker" in navigator) {
      const register = () =>
        navigator.serviceWorker
          .register(`./sw.js?v=${APP_VERSION}`)
          .then((reg) => {
            reg.onupdatefound = () => {
              const sw = reg.installing;
              if (!sw) return;
              sw.onstatechange = () => {
                if (sw.state === "installed" && navigator.serviceWorker.controller) window.location.reload();
              };
            };
          })
          .catch((err) => console.log("❌ SW registration failed:", err));
      window.addEventListener("load", register);
      navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
    }
  }

  async initCloudSync() {
    const syncConfig = this.loadSyncConfig();
    this.updateSyncUI();
    if (syncConfig && syncConfig.enabled && syncConfig.sessionId) {
      try { await this.enableCloudSync(syncConfig.sessionId, { quiet: true, reconnect: true }); }
      catch (error) { this.disableCloudSync({ silent: true }); }
    } else {
      this.syncEnabled = false;
      this.updateSyncUI();
    }
  }

  async enableCloudSync(sessionId = null, opts = {}) {
    const { quiet = false, reconnect = false } = opts;
    try {
      this.disableFirebaseSync();
      this.syncEnabled = true;
      this.updateSyncUI();
      if (!quiet) this.showNotification("Setting up cloud sync...", "info");
      await this.cloudSync.enable(sessionId);
      this.cloudSync.onDataChange((remoteData) => { if (this.shouldAcceptRemoteData(remoteData)) this.handleRemoteData(remoteData); });
      const merged = await this.cloudSync.sync(this.data);
      if (merged) { this.data = merged; this.saveData(false); this.renderCurrentView(); }
      this.saveSyncConfig({ enabled: true, sessionId: this.cloudSync.sessionId });
      if (AUTO_LINK_CLOUD && auth.currentUser && this.cloudSync.sessionId) await this._setAutoLinkState(true, this.cloudSync.sessionId);
      this.updateSyncUI();
      if (!quiet) this.showNotification(reconnect ? "Cloud sync reconnected!" : "Cloud sync enabled!", "success");
    } catch (error) {
      if (!quiet) this.showNotification("Cloud sync unavailable. Using local storage.", "warning");
      this.disableCloudSync({ silent: quiet });
      const u = auth.currentUser;
      if (u) this.enableFirebaseSync(u.uid);
    }
  }

  disableCloudSync(opts = {}) {
    const { silent = false } = opts;
    const wasEnabled = this.syncEnabled;
    this.syncEnabled = false;
    this.cloudSync.disable();
    this.saveSyncConfig({ enabled: false, sessionId: null });
    this.updateSyncUI();
    if (!silent && wasEnabled) this.showNotification("Cloud sync disabled", "info");
    if (AUTO_LINK_CLOUD && auth.currentUser) this._setAutoLinkState(false, null);
    const u = auth.currentUser;
    if (u) this.enableFirebaseSync(u.uid);
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
    if (this.firebaseSync?.enabled) this._writeFirebase().catch(() => {});
    if (triggerSync && this.syncEnabled) this.cloudSync.sync(this.data).catch(() => {});
    this.renderCurrentView();
  }

  showSyncModal() { this.openModal("sync-setup-modal"); }
  async createSyncSession() { try { await this.enableCloudSync(null, { quiet: false }); this.closeModal("sync-setup-modal"); } catch { this.showNotification("Failed to create sync session", "error"); } }
  async joinSyncSession() {
    const code = document.getElementById("sync-code-input")?.value.trim();
    if (!code) return this.showNotification("Please enter a sync code", "error");
    try { await this.enableCloudSync(code, { quiet: false }); this.closeModal("sync-setup-modal"); }
    catch { this.showNotification("Failed to join sync session", "error"); }
  }

  showDataModal() { this.openModal("data-modal"); }
  loadSyncConfig() { const c = localStorage.getItem("lifemapz-sync-config"); return c ? JSON.parse(c) : { enabled: false, sessionId: null }; }
  saveSyncConfig(config) { localStorage.setItem("lifemapz-sync-config", JSON.stringify(config)); }

  updateSyncUI() {
    const syncIndicator  = document.getElementById("sync-indicator");
    const syncDot        = document.getElementById("sync-dot-desktop");
    const syncDotMobile  = document.getElementById("sync-dot");
    const syncStatus     = document.getElementById("sync-status");
    const syncToggle     = document.getElementById("sync-toggle");
    [syncIndicator, syncDot, syncDotMobile, syncToggle].forEach(el => el?.classList.toggle("syncing", !!(this.syncEnabled || this.firebaseSync?.enabled)));
    if (syncStatus) {
      if (this.syncEnabled) syncStatus.textContent = "🟢 Syncing with cloud";
      else if (this.firebaseSync?.enabled) syncStatus.textContent = "🟢 Syncing with account";
      else syncStatus.textContent = "⚫ Sync disabled";
    }
  }

  async _setAutoLinkState(enabled, sessionId = null) {
    try {
      const u = auth.currentUser; if (!u) return;
      await db.collection("users").doc(u.uid).collection("app").doc("lifemapz")
        .set({ cloudAutoLink: !!enabled, cloudSessionId: sessionId || null }, { merge: true });
    } catch {}
  }
  async _getAutoLinkState(uid) {
    try {
      const snap = await db.collection("users").doc(uid).collection("app").doc("lifemapz").get();
      const d = snap.exists ? (snap.data() || {}) : {};
      return { cloudAutoLink: d.cloudAutoLink, cloudSessionId: d.cloudSessionId };
    } catch { return { cloudAutoLink: undefined, cloudSessionId: undefined }; }
  }

  loadTheme() { const saved = localStorage.getItem("lifemapz-theme"); return saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); }
  applyTheme() { document.body.setAttribute("data-theme", this.currentTheme); }
  toggleTheme() {
    this.currentTheme = this.currentTheme === "light" ? "dark" : "light";
    this.applyTheme();
    localStorage.setItem("lifemapz-theme", this.currentTheme);
    this.showNotification(`${this.currentTheme === "dark" ? "Dark" : "Light"} mode enabled`, "success");
  }

  loadData() {
    try {
      const saved = localStorage.getItem("lifemapz-data");
      return saved ? JSON.parse(saved) : this.getDefaultData();
    } catch (e) {
      console.warn("Corrupt local data, resetting.", e);
      return this.getDefaultData();
    }
  }
  getDefaultData() { return { version: APP_VERSION, tasks: [], lastSaved: new Date().toISOString() }; }

  setupSampleData() {
    if (this.data.tasks.length === 0) {
      const now = new Date();
      const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
      this.data.tasks = [
        { id:"1", title:"Morning Workout", description:"Complete morning exercise routine", horizon:"hours", priority:"medium", completed:false, createdAt:now.toISOString(), timeSettings:{ date:this.toInputDate(now), startTime:"07:00", endTime:"08:00", repeat:"daily", weekdays:["monday","tuesday","wednesday","thursday","friday"] }, cascadesTo:["days"] },
        { id:"2", title:"Plan weekly goals", description:"Set objectives for the week", horizon:"weeks", priority:"high", completed:false, createdAt:now.toISOString(), timeSettings:{ date:this.toInputDate(now), startTime:"09:00", endTime:"10:00", repeat:"weekly", weekdays:["monday"] }, cascadesTo:["months"] },
        { id:"3", title:"Annual review preparation", description:"Prepare for year-end review", horizon:"years", priority:"medium", completed:false, createdAt:now.toISOString(), timeSettings:{ date:this.toInputDate(tomorrow), startTime:"14:00", endTime:"16:00", repeat:"none" }, cascadesTo:["life"] }
      ];
      this.saveData();
    }
  }

  enableFirebaseSync(uid) {
    if (this.syncEnabled) return;
    const docRef = db.collection("users").doc(uid).collection("app").doc("lifemapz");
    this.firebaseSync.docRef = docRef;
    this.firebaseSync.enabled = true;

    docRef.get().then((snap) => {
      const remote = snap.exists ? snap.data() : null;
      const localNewer = this.data?.lastSaved && (!remote?.lastSaved || new Date(this.data.lastSaved) >= new Date(remote.lastSaved));
      if (!remote || localNewer) this._writeFirebase().catch(() => {});
      else { this.data = remote; this.saveData(false); this.renderCurrentView(); this.showNotification("Synced from your account", "info"); }
    }).catch(() => {});

    this.firebaseSync.unsub = docRef.onSnapshot((snap) => {
      if (!snap.exists || this.firebaseSync.writing) return;
      const remote = snap.data();
      if (!remote?.lastSaved) return;
      if (!this.data?.lastSaved || new Date(remote.lastSaved) > new Date(this.data.lastSaved)) {
        this.data = remote; this.saveData(false); this.renderCurrentView(); this.showNotification("Changes synced from your account", "info");
      }
    });

    this.updateSyncUI();
  }

  disableFirebaseSync() {
    if (this.firebaseSync?.unsub) { try { this.firebaseSync.unsub(); } catch {} }
    this.firebaseSync = { enabled:false, unsub:null, docRef:null, writing:false, lastRemote:null };
    this.updateSyncUI();
  }

  async _writeFirebase() {
    if (!this.firebaseSync?.enabled || !this.firebaseSync?.docRef) return;
    this.firebaseSync.writing = true;
    try { await this.firebaseSync.docRef.set(this.data); this.firebaseSync.lastRemote = this.data.lastSaved; }
    finally { this.firebaseSync.writing = false; }
  }

  bindEvents() {
    const emailEl = document.getElementById("email");
    const passEl = document.getElementById("password");
    const signupBtn = document.getElementById("btn-signup");
    const loginBtn = document.getElementById("btn-login");
    const googleBtn = document.getElementById("btn-google");
    const logoutBtn = document.getElementById("btn-logout");
    const authPanel = document.getElementById("auth-panel");
    const userPanel = document.getElementById("user-panel");
    const whoami = document.getElementById("whoami");
    const msgEl = document.getElementById("auth-msg");

    const showMsg = (txt) => { if (!msgEl) { alert(txt); return; } msgEl.textContent = txt; setTimeout(() => (msgEl.textContent = ""), 4000); };
    if (emailEl && !emailEl.value) emailEl.value = "bongjacib@gmail.com";

    auth.onAuthStateChanged(async (user) => {
      if (user) {
        if (authPanel) authPanel.style.display = "none";
        if (userPanel) userPanel.style.display = "block";
        if (whoami) whoami.textContent = `Signed in as ${user.email || user.displayName || user.uid}`;
        try {
          const ref = db.collection("users").doc(user.uid);
          const snap = await ref.get();
          if (!snap.exists) await ref.set({ email: user.email || null, displayName: user.displayName || null, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        } catch {}
        this.enableFirebaseSync(user.uid);
        if (AUTO_LINK_CLOUD && !this.syncEnabled) {
          const { cloudAutoLink, cloudSessionId } = await this._getAutoLinkState(user.uid);
          if (cloudSessionId && cloudAutoLink !== false) {
            try { await this.enableCloudSync(cloudSessionId, { quiet: true, reconnect: true }); }
            catch { this.enableFirebaseSync(user.uid); }
          }
        }
      } else {
        if (authPanel) authPanel.style.display = "block";
        if (userPanel) userPanel.style.display = "none";
        if (whoami) whoami.textContent = "";
        this.disableFirebaseSync();
      }
      this.updateSyncUI();
    });

    signupBtn?.addEventListener("click", async () => {
      try { const email = emailEl?.value?.trim(); const pass = passEl?.value ?? ""; if (!email || !pass) return showMsg("Enter email and password."); await auth.createUserWithEmailAndPassword(email, pass); }
      catch (e) { showMsg(e.message || String(e)); }
    });

    loginBtn?.addEventListener("click", async () => {
      try { const email = emailEl?.value?.trim(); const pass = passEl?.value ?? ""; if (!email || !pass) return showMsg("Enter email and password."); await auth.signInWithEmailAndPassword(email, pass); }
      catch (e) { showMsg(e.message || String(e)); }
    });

    const googleProvider = new firebase.auth.GoogleAuthProvider();
    const googleSignIn = () => {
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isStandalone || isMobile) return auth.signInWithRedirect(googleProvider);
      return auth.signInWithPopup(googleProvider).catch(() => auth.signInWithRedirect(googleProvider));
    };
    googleBtn?.addEventListener("click", async (e) => { e.preventDefault(); try { await googleSignIn(); } catch (e) { (document.getElementById("auth-msg") || {}).textContent = (e && (e.code || e.message)) || String(e); } });
    auth.getRedirectResult().then((result) => {
      if (result && result.user) {
        const who = document.getElementById("whoami");
        if (who) who.textContent = `Signed in as ${result.user.email || result.user.displayName || result.user.uid}`;
        const m = document.getElementById("auth-msg"); if (m) m.textContent = "Signed in!";
      }
    }).catch(() => {});

    logoutBtn?.addEventListener("click", async () => { try { await auth.signOut(); } catch (e) { showMsg(e.message || String(e)); } });

    document.getElementById("task-form")?.addEventListener("submit", (e) => { e.preventDefault(); this.saveTask(); });
    document.getElementById("create-sync-btn")?.addEventListener("click", () => this.createSyncSession());
    document.getElementById("join-sync-btn")?.addEventListener("click", () => this.joinSyncSession());

    document.addEventListener("click", (e) => {
      const item = e.target.closest(".sidebar-item[data-view]");
      if (item) this._handleSidebarViewClick(item.dataset.view);
      if (e.target.classList.contains("modal")) this.closeModal(e.target.id);
    });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "n") { e.preventDefault(); this.openTaskModal(); }
      if (e.key === "Escape") this.closeAllModals();
    });

    this.setupTimeModalEvents();
    this._wireCalendarNav();
  }

  _handleSidebarViewClick(view) {
    const targetViewEl = document.getElementById(`${view}-view`);
    if (targetViewEl) { this.switchView(view); return; }
    const horizonIds = ["hours", "days", "weeks", "months", "years", "life"];
    if (horizonIds.includes(view)) {
      this.switchView("horizons");
      document.querySelector(`.horizon-section[data-horizon="${view}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  setupTimeModalEvents() {
    this.ensureDatePicker();
    document.querySelectorAll(".repeat-option").forEach(btn => {
      btn.addEventListener("click", (e) => {
        document.querySelectorAll(".repeat-option").forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");
        const wk = document.getElementById("weekday-options");
        if (wk) wk.style.display = e.target.dataset.repeat === "weekly" ? "block" : "none";
        this.updateUpcomingDates();
      });
    });
    document.querySelectorAll(".weekday-btn").forEach(btn => btn.addEventListener("click", (e) => { e.target.classList.toggle("active"); this.updateUpcomingDates(); }));
    document.getElementById("task-start-time")?.addEventListener("change", () => this.updateUpcomingDates());
    document.getElementById("task-end-time")?.addEventListener("change", () => this.updateUpcomingDates());
    document.addEventListener("change", (e) => { if (e.target && e.target.id === "task-date") this._onDateChanged(e.target.value); });
    const header = document.getElementById("selected-date-display"); if (header) { header.style.cursor = "pointer"; header.addEventListener("click", () => this.showRescheduleOptions()); }
  }

  ensureDatePicker() {
    let dateEl = document.getElementById("task-date");
    if (!dateEl) {
      const timeModalBody = document.querySelector("#time-modal .time-modal-body");
      const dateDisplay = timeModalBody?.querySelector(".date-display-section");
      if (dateDisplay) {
        const datePickerContainer = document.createElement("div");
        datePickerContainer.className = "date-picker-container";
        datePickerContainer.innerHTML = `<label for="task-date">Select Date</label><input type="date" id="task-date" class="date-picker-input">`;
        dateDisplay.insertAdjacentElement("afterend", datePickerContainer);
        dateEl = document.getElementById("task-date");
        if (dateEl) dateEl.addEventListener("change", (e) => this._onDateChanged(e.target.value));
      }
    }
    return dateEl;
  }

  switchView(viewName) {
    if (!viewName || viewName === this.currentView) return;
    document.querySelectorAll(".sidebar-item").forEach(i => i.classList.remove("active"));
    document.querySelector(`[data-view="${viewName}"]`)?.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById(`${viewName}-view`)?.classList.add("active");
    this.currentView = viewName;
    const titles = { horizons: "Visual Horizons", cascade: "Cascade Flow", calendar: "Calendar View" };
    const titleEl = document.getElementById("current-view-title");
    if (titleEl) titleEl.textContent = titles[viewName] || viewName;
    this.renderCurrentView();
    if (window.innerWidth <= 768) this.toggleMobileMenu(false);
  }

  _toDateOnly(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
  _isSameDay(a,b){ return this._toDateOnly(a).getTime()===this._toDateOnly(b).getTime(); }
  _dateKey(d){ return this.toInputDate(d); }
  _todayKey(){ const base = this.hoursDateOverride ? new Date(this.hoursDateOverride) : new Date(); return this.toInputDate(base); }

  _formatNiceDate(key) { try { const d = new Date(key); return d.toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric", year:"numeric" }); } catch { return key; } }
  _truncate(text, n=12) { const s = String(text || ""); return s.length > n ? s.slice(0,n) + "…" : s; }
  clearHoursDateOverride() {
    this.hoursDateOverride = null; this.updateDateDisplay(); this.switchView("horizons");
    document.querySelector('.horizon-section[data-horizon="hours"]')?.scrollIntoView({ behavior:"smooth", block:"start" });
    this.renderCurrentView();
  }
  _openMonthPicker() {
    const input = document.createElement("input");
    input.type = "month";
    const d = new Date(this.calendar.current);
    input.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    input.style.position="fixed"; input.style.left="-9999px";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const [Y,M] = (input.value||"").split("-").map(Number);
      if (Y && M) this.calendar.current = new Date(Y, M-1, 1);
      input.remove(); this.renderCalendarView();
    }, { once:true });
    try{ input.showPicker?.(); }catch{} input.focus();
  }

  _getTasksForHorizon(horizon) {
    const tasks = [];
    const todayKey = this._todayKey();
    for (const task of this.data.tasks) {
      if (task.completed) continue;
      const belongs = task.horizon === horizon || (task.cascadesTo && task.cascadesTo.includes(horizon));
      if (!belongs) continue;
      if (horizon === "hours") {
        const d = task?.timeSettings?.date || null;
        if (!d || d !== todayKey) continue;
      }
      tasks.push(task);
    }
    return tasks;
  }

  // ---- Hours order persistence (per date) ----
  getHoursOrder(dateKey) {
    try { return JSON.parse(localStorage.getItem("lmz-hours-order-" + dateKey)) || []; }
    catch { return []; }
  }
  setHoursOrder(dateKey, ids) {
    localStorage.setItem("lmz-hours-order-" + dateKey, JSON.stringify(ids || []));
  }

  renderCurrentView() {
    if (this.currentView === "horizons") this.renderHorizonsView();
    else if (this.currentView === "cascade") this.renderCascadeView();
    else if (this.currentView === "calendar") this.renderCalendarView();
  }

  renderHorizonsView() {
    const horizons = ["hours", "days", "weeks", "months", "years", "life"];
    horizons.forEach(h => {
      const container = document.getElementById(`${h}-tasks`);
      if (!container) {
        if (DEBUG) console.warn(`Container not found for ${h}`);
        return;
      }

      let tasks = this._getTasksForHorizon(h);

      // Apply saved order for Hours (per selected date)
      if (h === "hours") {
        const savedOrder = this.getHoursOrder(this._todayKey());
        if (savedOrder && savedOrder.length) {
          const map = new Map(tasks.map(t => [t.id, t]));
          const ordered = [];
          savedOrder.forEach(id => { if (map.has(id)) { ordered.push(map.get(id)); map.delete(id); } });
          for (const t of map.values()) ordered.push(t);
          tasks = ordered;
        }
      }

     if (DEBUG) console.log(`Rendering ${h} view with`, tasks.length, 'tasks');

if (h === "hours") {
  // Use HoursCards for the hours view
  if (DEBUG) console.log('Attempting to use HoursCards for hours view');
  
  if (window.HoursCards && typeof window.HoursCards.mount === 'function') {
    try { window.HoursCards.unmount?.(container); } catch {}
    console.log('HoursCards found, mounting with callbacks...');
    window.HoursCards.mount(container, tasks, {
      onReorder: (ids) => {
        console.log('onReorder callback called with:', ids);
        this.handleHoursReorder(ids);
      },
      onEdit: (id) => {
        console.log('onEdit callback called with:', id);
        this.editTask(id);
      },
      onDelete: (id) => {
        console.log('onDelete callback called with:', id);
        this.deleteTask(id);
      }
    });
    console.log('HoursCards mount completed');
  } else {
    if (DEBUG) console.log('HoursCards not available, using fallback');
    // Fallback to regular rendering
    container.innerHTML = tasks.length === 0 ?
      '<div class="empty-state">No tasks yet. Click + to add one.</div>' :
      tasks.map(t => this.renderTaskItem(t)).join("");

    // Wire drag & drop for Hours list (per date)
    this._wireHoursDnD(container, this._todayKey());
  }
} else {
  // Regular rendering for other horizons
  container.innerHTML = tasks.length === 0 ?
    '<div class="empty-state">No tasks yet. Click + to add one.</div>' :
    tasks.map(t => this.renderTaskItem(t)).join("");
}

// Add the "Back to Today" chip for hours view
if (h === "hours") {
  const header = document.querySelector('.horizon-section[data-horizon="hours"] .section-header');
  if (header) {
    let chip = header.querySelector("#hours-override-chip");
    const overrideActive = !!this.hoursDateOverride && this.hoursDateOverride !== this.toInputDate(new Date());
    if (overrideActive) {
      if (!chip) {
        // ... chip creation code
      }
    } else if (chip) chip.remove();
  }
}

  /**
   * Handle reordering of hours tasks
   */
  handleHoursReorder(ids) {
    if (DEBUG) console.log('Hours reorder triggered with IDs:', ids);
    this.setHoursOrder(this._todayKey(), ids);
    this.showNotification("Tasks reordered", "success");
  }

  // ----- Fallback drag & drop (Hours) -----
  _wireHoursDnD(container, dateKey) {
    container.querySelectorAll(".task-item").forEach(item => {
      item.setAttribute("draggable", "true");
      item.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.dataset.id);
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        const ids = Array.from(container.querySelectorAll(".task-item")).map(el => el.dataset.id);
        this.setHoursOrder(dateKey, ids);
      });
    });

    container.ondragover = (e) => {
      e.preventDefault();
      const after = this._getDragAfterElement(container, e.clientY);
      const dragging = container.querySelector(".task-item.dragging");
      if (!dragging) return;
      if (after == null) container.appendChild(dragging);
      else container.insertBefore(dragging, after);
    };
  }
  _getDragAfterElement(container, y) {
    const items = [...container.querySelectorAll(".task-item:not(.dragging)")];
    return items.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  renderTaskItem(task) {
    const timeInfo = task.timeSettings ? this.renderTimeInfo(task.timeSettings) : "";
    return `
      <div class="task-item" data-id="${task.id}">
        <div class="task-content">
          <div class="task-title">${this.escapeHtml(task.title)}</div>
          ${task.description ? `<div class="task-meta">${this.escapeHtml(task.description)}</div>` : ""}
          ${timeInfo}
          ${task.cascadesTo && task.cascadesTo.length > 0 ? `<div class="task-meta"><small>Cascades to: ${task.cascadesTo.join(", ")}</small></div>` : ""}
        </div>
        <div class="task-actions">
          <button class="task-btn" onclick="app.editTask('${task.id}')" title="Edit Task"><i class="fas fa-edit"></i></button>
          <button class="task-btn" onclick="app.deleteTask('${task.id}')" title="Delete Task"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
  }

  renderTimeInfo(ts) {
    let html = `<div class="task-time-info"><i class="fas fa-clock"></i> ${ts.startTime} - ${ts.endTime}`;
    if (ts.date) { try { html += ` • ${new Date(ts.date).toLocaleDateString()}`; } catch {} }
    if (ts.repeat && ts.repeat !== "none") {
      html += ` • <span class="repeat-badge">${ts.repeat}</span>`;
      if (ts.repeat === "weekly" && ts.weekdays && ts.weekdays.length > 0) html += ` (${ts.weekdays.map(d => d.substring(0,3)).join(", ")})`;
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
        </div>`).join("") || '<div class="empty-state">No tasks</div>';
    });
  }

  _ensureCalendarScaffold() {
    const view = document.getElementById("calendar-view");
    if (!view) return null;
    if (!view.dataset.scaffolded) {
      view.innerHTML = `
        <div class="calendar-viewport">
          <div class="calendar-header" style="display:flex;align-items:center;gap:8px;">
            <button class="header-btn" id="cal-prev" title="Previous month"><i class="fas fa-chevron-left"></i></button>
            <h3 id="cal-month-label" style="margin:0 12px;cursor:pointer;">Month YYYY</h3>
            <button class="header-btn" id="cal-next" title="Next month"><i class="fas fa-chevron-right"></i></button>
            <div style="flex:1"></div>
            <button class="header-btn" id="cal-today" title="Jump to today"><i class="fas fa-dot-circle"></i> Today</button>
          </div>
          <div class="calendar-weekdays" style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:8px;">
            ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>`<div class="weekday" style="text-align:center;font-weight:600;opacity:.75">${d}</div>`).join("")}
          </div>
          <div class="calendar-grid" id="calendar-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-top:8px;"></div>
        </div>`;
      view.dataset.scaffolded = "1";
      this._wireCalendarNav();
    }
    return view;
  }

  _wireCalendarNav() {
    const prev = document.getElementById("cal-prev");
    const next = document.getElementById("cal-next");
    const today = document.getElementById("cal-today");
    prev?.addEventListener("click", () => { const d = new Date(this.calendar.current); d.setMonth(d.getMonth() - 1); this.calendar.current = d; this.renderCalendarView(); });
    next?.addEventListener("click", () => { const d = new Date(this.calendar.current); d.setMonth(d.getMonth() + 1); this.calendar.current = d; this.renderCalendarView(); });
    today?.addEventListener("click", () => { this.calendar.current = new Date(); this.renderCalendarView(); });
    document.getElementById("cal-month-label")?.addEventListener("click", () => this._openMonthPicker());
  }

  renderCalendarView() {
    const view = this._ensureCalendarScaffold();
    if (!view) return;
    const monthLabel = document.getElementById("cal-month-label");
    const grid = document.getElementById("calendar-grid");
    if (!grid) return;

    const base = new Date(this.calendar.current);
    const year = base.getFullYear();
    const month = base.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const startDate = new Date(firstOfMonth);
    startDate.setDate(firstOfMonth.getDate() - startOffset);

    const cells = [];
    for (let i = 0; i < 42; i++) { const d = new Date(startDate); d.setDate(startDate.getDate() + i); cells.push(d); }

    const byDate = new Map();
    for (const t of this.data.tasks) {
      if (t.completed) continue;
      const key = t?.timeSettings?.date;
      if (!key) continue;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(t);
    }

    if (monthLabel) monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(firstOfMonth);

    const todayKey = this._todayKey();
    grid.innerHTML = cells.map((d) => {
      const key = this._dateKey(d);
      const inMonth = d.getMonth() === month;
      const items = byDate.get(key) || [];
      const hasItems = items.length > 0;
      const isToday = key === todayKey;
      const titles = hasItems
        ? `<ul class="cal-items" style="list-style:none;margin:6px 0 0;padding:0;max-height:72px;overflow:auto;">
            ${items.slice(0,3).map(t => `<li style="font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">• ${this.escapeHtml(this._truncate(t.title, 12))}</li>`).join("")}
            ${items.length > 3 ? `<li style="font-size:.8rem;opacity:.7;">+${items.length-3} more</li>` : ""}
           </ul>` : "";
      return `
        <div class="cal-cell ${inMonth ? "" : "cal-out"} ${isToday ? "cal-today" : ""}" data-date="${key}"
             style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;min-height:90px;${inMonth?"":"opacity:.55;background:#fafafa"}${isToday?"box-shadow:0 0 0 2px rgba(124,58,237,.4) inset;":""}">
          <div class="cal-date" style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:600;">${d.getDate()}</span>
            ${hasItems ? `<span class="cal-badge" style="font-size:.75rem;padding:2px 6px;border-radius:999px;background:#ede9fe;">${items.length}</span>` : ""}
          </div>
          ${titles}
        </div>`;
    }).join("");

    grid.querySelectorAll(".cal-cell").forEach(cell => {
      cell.addEventListener("click", () => {
        const key = cell.getAttribute("data-date");
        this.hoursDateOverride = key;
        this.updateDateDisplay();
        this.switchView("horizons");
        document.querySelector('.horizon-section[data-horizon="hours"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
        this.renderCurrentView();
      });
    });
  }

  openTimeModal() {
    const dateEl = this.ensureDatePicker();
    const now = new Date();
    const existing = this.currentTaskTimeData?.timeSettings?.date;
    const initDate = existing ? new Date(existing) : now;
    if (dateEl) dateEl.value = this.toInputDate(initDate);
    const disp = document.getElementById("selected-date-display");
    if (disp) disp.textContent = this.formatDateDisplay(initDate);
    if (this.currentTaskTimeData.timeSettings) this.populateTimeModal(this.currentTaskTimeData.timeSettings);
    else this.setDefaultTimeSettings();
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

  formatTime(h,m){ return `${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}`; }
  toInputDate(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; }
  formatDateDisplay(date){ return date.toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" }); }
  setActiveRepeatOption(type){ document.querySelectorAll(".repeat-option").forEach(btn => { btn.classList.remove("active"); if (btn.dataset.repeat === type) btn.classList.add("active"); }); const wk = document.getElementById("weekday-options"); if (wk) wk.style.display = type === "weekly" ? "block" : "none"; }
  setActiveWeekdays(days){ document.querySelectorAll(".weekday-btn").forEach(btn => { btn.classList.remove("active"); if (days.includes(btn.dataset.day)) btn.classList.add("active"); }); }
  toggleRepeatOptions(){ const rs=document.getElementById("repeat-section"); if (rs) rs.style.display="block"; }
  showRescheduleOptions(){ const dateEl=this.ensureDatePicker(); if (!dateEl) return; try { if (typeof dateEl.showPicker==="function") { dateEl.showPicker(); return; } dateEl.focus(); dateEl.click(); } catch { this.createFallbackDatePicker(dateEl); } }
  createFallbackDatePicker(originalEl){
    const tmp=document.createElement("input"); tmp.type="date"; tmp.value=originalEl.value || this.toInputDate(new Date()); tmp.style.position="fixed"; tmp.style.left="-9999px"; document.body.appendChild(tmp);
    tmp.addEventListener("change",()=>{ originalEl.value=tmp.value; tmp.remove(); this._onDateChanged(originalEl.value); },{ once:true });
    tmp.addEventListener("blur",()=>{ setTimeout(()=>tmp.remove(),100); },{ once:true }); tmp.click();
  }
  _onDateChanged(value){ const d=value?new Date(value):new Date(); const disp=document.getElementById("selected-date-display"); if (disp) disp.textContent=this.formatDateDisplay(d); if (!this.currentTaskTimeData.timeSettings) this.currentTaskTimeData.timeSettings={}; this.currentTaskTimeData.timeSettings.date=this.toInputDate(d); this.updateUpcomingDates(); this.updateTimeSummary(); }

  removeDateTime(){ if (confirm("Remove all time settings for this task?")) { this.currentTaskTimeData.timeSettings = null; const summary=document.getElementById("time-summary"); if (summary) summary.textContent="No time set"; this.closeModal("time-modal"); this.showNotification("Time settings removed", "success"); } }
  saveTimeSettings(){
    const timeSettings={ date:document.getElementById("task-date")?.value || null, startTime:document.getElementById("task-start-time").value, endTime:document.getElementById("task-end-time").value, repeat:this.getSelectedRepeatOption(), weekdays:this.getSelectedWeekdays(), createdAt:new Date().toISOString() };
    this.currentTaskTimeData.timeSettings=timeSettings; this.updateTimeSummary(); this.closeModal("time-modal"); this.showNotification("Time settings saved!", "success");
  }
  getSelectedRepeatOption(){ const active=document.querySelector(".repeat-option.active"); return active ? active.dataset.repeat : "none"; }
  getSelectedWeekdays(){ return Array.from(document.querySelectorAll(".weekday-btn.active")).map(b => b.dataset.day); }
  updateTimeSummary(){ const summary=document.getElementById("time-summary"); const s=this.currentTaskTimeData.timeSettings; if (!summary) return; if (!s) { summary.textContent="No time set"; return; } summary.textContent=this.renderTimeSummary(s); }
  renderTimeSummary(s){ let text=`${s.startTime} - ${s.endTime}`; if (s.date) { try { text += ` • ${new Date(s.date).toLocaleDateString()}`; } catch {} } if (s.repeat && s.repeat !== "none") { text += ` • ${s.repeat}`; if (s.repeat === "weekly" && s.weekdays && s.weekdays.length > 0) text += ` (${s.weekdays.map(d => d.substring(0,3)).join(", ")})`; } return text; }
  updateUpcomingDates(){
    const list=document.querySelector(".upcoming-list"); if (!list) return;
    const baseDateStr=document.getElementById("task-date")?.value; const repeat=this.getSelectedRepeatOption(); const weekdays=this.getSelectedWeekdays();
    let startDate=baseDateStr?new Date(baseDateStr):new Date(); startDate.setHours(0,0,0,0);
    const items=[]; const pushDate=(d)=>items.push(`<div class="upcoming-item"><strong>${this.formatDateDisplay(d)}</strong></div>`); const weekdayIndex=(day)=>({sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6}[day]);
    if (repeat==="none") pushDate(startDate);
    else if (repeat==="daily") { for (let i=0;i<3;i++){ const d=new Date(startDate); d.setDate(d.getDate()+i); pushDate(d);} }
    else if (repeat==="weekly") {
      const chosen=weekdays.map(weekdayIndex).filter(v=>v!==undefined).sort((a,b)=>a-b); if (chosen.length===0) chosen.push(startDate.getDay());
      let count=0; let currentDate=new Date(startDate);
      while (count<3){ for (const w of chosen){ const next=new Date(currentDate); const delta=(w-next.getDay()+7)%7; next.setDate(next.getDate()+delta); if (next>=startDate){ pushDate(next); count++; if (count>=3) break; } } currentDate.setDate(currentDate.getDate()+7); }
    } else if (repeat==="monthly") {
      for (let i=0;i<3;i++){ const d=new Date(startDate); d.setMonth(d.getMonth()+i); const day=startDate.getDate(); const last=new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); d.setDate(Math.min(day,last)); pushDate(d); }
    } else if (repeat==="yearly") {
      for (let i=0;i<3;i++){ const d=new Date(startDate); d.setFullYear(d.getFullYear()+i); pushDate(d); }
    }
    list.innerHTML=items.join("");
  }

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
    if (!cascadeGroup) return;
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

  getCascadeSelections() { return Array.from(document.querySelectorAll('input[name="cascade"]:checked')).map(cb => cb.value); }

  editTask(taskId) { const t = this.data.tasks.find(tt => tt.id === taskId); if (t) this.openTaskModal(t); }

  deleteTask(taskId) {
    if (!confirm("Are you sure you want to delete this task?")) return;
    this.data.tasks = this.data.tasks.filter(t => t.id !== taskId);
    this.saveData();
    this.renderCurrentView();
    this.showNotification("Task deleted", "success");
  }

  addToHorizon(h) {
    const dateKey = (h === "hours" && this.hoursDateOverride) ? this.hoursDateOverride : this.toInputDate(new Date());
    const preset = { horizon: h, timeSettings: { date: dateKey, startTime: "09:00", endTime: "10:00", repeat: "none", weekdays: [] } };
    this.openTaskModal(preset);
  }

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

    // Ensure Hours order is updated when adding/updating an Hours task with a date
    if (task.horizon === "hours" && task.timeSettings?.date) {
      const dk = task.timeSettings.date;
      const order = this.getHoursOrder(dk);
      if (!order.includes(task.id)) this.setHoursOrder(dk, [...order, task.id]);
    }

    this.saveData();
    this.closeModal("task-modal");
    this.renderCurrentView();
    this.showNotification(`Task ${isEdit ? "updated" : "added"} successfully`, "success");
  }

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

  showNotification(message, type = "info") {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.className = `lmz-toast lmz-${type}`;
    Object.assign(toast.style, {
      position: "fixed", zIndex: 9999, right: "16px", bottom: "16px", padding: "10px 12px",
      borderRadius: "8px",
      background: type === "error" ? "#fecaca" : type === "success" ? "#bbf7d0" : type === "warning" ? "#fde68a" : "#e5e7eb",
      color: "#111827", boxShadow: "0 6px 20px rgba(0,0,0,.15)", fontSize: "0.95rem", maxWidth: "90vw"
    });
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = "opacity .3s"; }, 2400);
    setTimeout(() => toast.remove(), 2800);
  }

  openModal(id){ const el=document.getElementById(id); if (el){ el.style.display="block"; document.body.style.overflow="hidden"; } }
  closeModal(id){ const el=document.getElementById(id); if (el){ el.style.display="none"; document.body.style.overflow=""; } }
  closeAllModals(){ document.querySelectorAll(".modal").forEach(m => m.style.display="none"); document.body.style.overflow=""; }

  toggleMobileMenu(show){ const sidebar=document.getElementById("main-sidebar"); if (sidebar){ if (typeof show==="boolean") sidebar.classList.toggle("active", show); else sidebar.classList.toggle("active"); } }
  generateId(){
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }
  escapeHtml(text){ const div=document.createElement("div"); div.textContent=text; return div.innerHTML; }
  updateDateDisplay(){ const base=this.hoursDateOverride ? new Date(this.hoursDateOverride) : new Date(); const el=document.getElementById("current-date"); if (el) el.textContent=base.toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" }); }
}

/* --------------------- Boot --------------------- */
document.addEventListener("DOMContentLoaded", () => { window.app = new LifeMapzApp(); });
