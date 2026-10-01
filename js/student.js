(() => {
  const { supabase, setStatus, showError, clearError, getParticipantToken } = RGM;
  const params = new URLSearchParams(location.search);
  const sessionId = params.get("session");

  const loading = document.getElementById("student-loading");
  const app = document.getElementById("student-app");
  const title = document.getElementById("session-title");
  const meta = document.getElementById("session-meta");
  const groupList = document.getElementById("group-list");
  const assignedTotal = document.getElementById("assigned-total");
  const form = document.getElementById("pick-form");
  const nameInput = document.getElementById("student-name");
  const pickButton = document.getElementById("pick-button");
  const resultView = document.getElementById("result-view");
  const resultGroup = document.getElementById("result-group");
  const resultName = document.getElementById("result-name");
  const fullCard = document.getElementById("full-card");

  let session = null;
  let groups = [];
  let channel = null;

  function friendlyError(error) {
    const msg = (error && error.message) || "";
    if (msg.includes("already picked")) return msg;
    if (msg.includes("session is not active")) return "This session is not currently accepting picks.";
    if (msg.includes("session is full")) return "The session is full. No group slots remain.";
    if (msg.includes("duplicate")) return "That name has already been used in this session.";
    return "We could not complete the request. Check your connection and try again.";
  }

  async function loadSession() {
    if (!sessionId) throw new Error("Missing session link.");
    const { data, error } = await supabase
      .from("sessions")
      .select("id, subject, class_section, total_students, status")
      .eq("id", sessionId)
      .single();
    if (error) throw error;
    session = data;

    title.textContent = `${session.subject} — ${session.class_section}`;
    meta.textContent = `${session.total_students} students • ${session.status === "active" ? "Open for picks" : "Not accepting picks"}`;

    if (session.status !== "active") {
      form.closest("#pick-form-view").classList.add("hidden");
      fullCard.classList.remove("hidden");
      fullCard.querySelector("h2").textContent = session.status === "full" ? "Session Full" : "Session Not Active";
      fullCard.querySelector("p").textContent =
        session.status === "full" ? "All configured group slots have been assigned." : "The facilitator has not opened this session for picks.";
    }
  }

  async function loadGroups() {
    const { data, error } = await supabase
      .from("groups")
      .select("id, group_number, capacity, assigned_count")
      .eq("session_id", sessionId)
      .order("group_number");
    if (error) throw error;
    groups = data || [];
    renderGroups();
  }

  async function restoreAssignment() {
    const token = getParticipantToken(sessionId);
    const { data, error } = await supabase.rpc("get_my_assignment", {
      p_session_id: sessionId,
      p_participant_token: token
    });
    if (error) return;
    if (data && data.length) {
      const row = data[0];
      showResult(row.student_name, row.group_number);
    }
  }

  function renderGroups() {
    const total = groups.reduce((sum, g) => sum + g.capacity, 0);
    const assigned = groups.reduce((sum, g) => sum + g.assigned_count, 0);
    assignedTotal.textContent = `${assigned} / ${total} students assigned`;

    groupList.innerHTML = groups.map(g => {
      const full = g.assigned_count >= g.capacity;
      const pct = Math.min(100, Math.round((g.assigned_count / g.capacity) * 100));
      return `<div class="group-row ${full ? "full" : ""}">
        <div style="flex:1">
          <div class="group-name">Group ${g.group_number} ${full ? '<span class="lock">🔒 FULL</span>' : ""}</div>
          <div class="progress"><span style="width:${pct}%"></span></div>
        </div>
        <div class="group-count">${g.assigned_count}/${g.capacity}</div>
      </div>`;
    }).join("");

    if (session && session.status === "active" && assigned >= total) {
      fullCard.classList.remove("hidden");
      fullCard.querySelector("h2").textContent = "Session Full";
      fullCard.querySelector("p").textContent = "All configured group slots have been assigned.";
      document.getElementById("pick-form-view").classList.add("hidden");
    }
  }

  function showResult(name, groupNumber) {
    resultView.classList.remove("hidden");
    document.getElementById("pick-form-view").classList.add("hidden");
    resultGroup.textContent = `GROUP ${groupNumber}`;
    resultName.textContent = name;
  }

  async function pickGroup(event) {
    event.preventDefault();
    clearError("student-error");
    const name = nameInput.value.trim().replace(/\s+/g, " ");
    if (!name) {
      showError("student-error", "Please enter your name.");
      nameInput.focus();
      return;
    }

    pickButton.disabled = true;
    pickButton.textContent = "Assigning…";
    const token = getParticipantToken(sessionId);

    try {
      const { data, error } = await supabase.rpc("pick_group", {
        p_session_id: sessionId,
        p_student_name: name,
        p_participant_token: token
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      showResult(row.student_name, row.group_number);
      await loadGroups();
    } catch (error) {
      showError("student-error", friendlyError(error));
      pickButton.disabled = false;
      pickButton.textContent = "Pick My Group";
      await loadGroups().catch(() => {});
    }
  }

  async function startRealtime() {
    channel = supabase.channel(`rgm-session-${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `session_id=eq.${sessionId}` },
        () => loadGroups().catch(() => {}))
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` },
        () => loadSession().catch(() => {}))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setStatus("Live", "online");
        else if (status === "CHANNEL_ERROR") setStatus("Connection error", "offline");
      });
  }

  async function init() {
    try {
      setStatus("Connecting…");
      await loadSession();
      await loadGroups();
      await restoreAssignment();
      loading.classList.add("hidden");
      app.classList.remove("hidden");
      form.addEventListener("submit", pickGroup);
      await startRealtime();
    } catch (error) {
      loading.innerHTML = `<p class="error-text">Unable to load this session. Check the link and try again.</p>`;
      setStatus("Offline", "offline");
      console.error(error);
    }
  }

  init();
})();
