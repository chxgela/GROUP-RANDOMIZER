window.RGM = (() => {
  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-") ||
      !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes("YOUR-")) {
    console.warn("Random Group Maker: configure js/config.js first.");
  }

  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  function setStatus(text, kind = "") {
    const el = document.getElementById("connection-status");
    if (!el) return;
    el.textContent = text;
    el.className = "status-pill " + kind;
  }

  function showError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function clearError(id) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = "";
      el.classList.add("hidden");
    }
  }

  function sessionKey(sessionId) {
    return `rgm:participant:${sessionId}`;
  }

  function getParticipantToken(sessionId) {
    let token = localStorage.getItem(sessionKey(sessionId));
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(sessionKey(sessionId), token);
    }
    return token;
  }

  function publicStudentUrl(sessionId) {
    const url = new URL("student.html", window.location.href);
    url.searchParams.set("session", sessionId);
    return url.href;
  }

  async function copy(text) {
    await navigator.clipboard.writeText(text);
  }

  return { supabase, setStatus, showError, clearError, getParticipantToken, publicStudentUrl, copy };
})();
