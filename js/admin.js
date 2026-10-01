(() => {
  const { supabase, showError, clearError, publicStudentUrl, copy } = RGM;
  let currentSessionId = null;
  let channel = null;

  const loginView = document.getElementById("login-view");
  const adminApp = document.getElementById("admin-app");
  const sessionList = document.getElementById("session-list");
  const manageCard = document.getElementById("manage-card");
  const customSizes = document.getElementById("custom-sizes");
  const equalArea = document.getElementById("equal-size-area");
  const customArea = document.getElementById("custom-size-area");
  const groupCountInput = document.getElementById("group-count");
  const totalStudentsInput = document.getElementById("total-students");
  const memberInput = document.getElementById("members-per-group");
  const customGroups = document.getElementById("custom-groups");

  function errText(error) {
    return error?.message || "Something went wrong. Please try again.";
  }

  function buildCustomInputs() {
    const count = Math.max(1, Math.min(100, Number(groupCountInput.value) || 1));
    const old = [...customGroups.querySelectorAll("input")].map(x => x.value);
    customGroups.innerHTML = "";
    for (let i = 1; i <= count; i++) {
      const wrap = document.createElement("div");
      wrap.className = "capacity-item";
      const label = document.createElement("label");
      label.textContent = `Group ${i}`;
      const input = document.createElement("input");
      input.type = "number"; input.min = "1"; input.max = "1000";
      input.value = old[i - 1] || memberInput.value || "5";
      input.dataset.group = i;
      input.addEventListener("input", updatePreview);
      wrap.append(label, input);
      customGroups.appendChild(wrap);
    }
    updatePreview();
  }

  function capacitiesFromForm() {
    if (customSizes.checked) {
      return [...customGroups.querySelectorAll("input")].map(i => Number(i.value));
    }
    const total = Number(totalStudentsInput.value);
    const count = Number(groupCountInput.value);
    if (!Number.isInteger(total) || !Number.isInteger(count) || total < count) return [];
    const base = Math.floor(total / count);
    const remainder = total % count;
    return Array.from({length: count}, (_, i) => base + (i < remainder ? 1 : 0));
  }

  function updatePreview() {
    const caps = capacitiesFromForm();
    const sum = caps.reduce((a,b) => a + b, 0);
    const total = Number(totalStudentsInput.value);
    const text = caps.length ? `Capacity: ${sum} slots${sum === total ? " ✓ matches total students" : ` • ${sum - total} difference from total students`}` : "";
    document.getElementById(customSizes.checked ? "custom-capacity-preview" : "capacity-preview").textContent = text;
  }

  customSizes.addEventListener("change", () => {
    equalArea.classList.toggle("hidden", customSizes.checked);
    customArea.classList.toggle("hidden", !customSizes.checked);
    if (customSizes.checked) buildCustomInputs();
    updatePreview();
  });
  groupCountInput.addEventListener("input", () => { if (customSizes.checked) buildCustomInputs(); updatePreview(); });
  totalStudentsInput.addEventListener("input", updatePreview);
  memberInput.addEventListener("input", updatePreview);

  async function loadSessions() {
    const { data, error } = await supabase
      .from("sessions")
      .select("id, subject, class_section, total_students, status, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;

    sessionList.innerHTML = data?.length ? data.map(s => `
      <div class="session-item ${s.id === currentSessionId ? "active" : ""}" data-id="${s.id}">
        <div class="session-item-title">${escapeHtml(s.subject)} — ${escapeHtml(s.class_section)}</div>
        <div class="session-item-meta">${s.total_students} students</div>
        <div class="session-item-status">${s.status}</div>
      </div>`).join("") : '<p class="muted">No sessions yet.</p>';

    sessionList.querySelectorAll(".session-item").forEach(el => {
      el.addEventListener("click", () => openSession(el.dataset.id));
    });
  }

  async function createSession(event) {
    event.preventDefault();
    clearError("create-error");
    const subject = document.getElementById("subject").value.trim();
    const section = document.getElementById("section").value.trim();
    const total = Number(totalStudentsInput.value);
    const count = Number(groupCountInput.value);
    const capacities = capacitiesFromForm();

    if (!subject || !section) return showError("create-error", "Subject and class/section are required.");
    if (!capacities.length || capacities.some(x => !Number.isInteger(x) || x < 1)) return showError("create-error", "All group capacities must be whole numbers greater than 0.");
    if (capacities.reduce((a,b) => a+b, 0) !== total) return showError("create-error", "Group capacity must exactly equal total students.");

    const button = document.getElementById("create-session-button");
    button.disabled = true; button.textContent = "Creating…";
    try {
      const { data, error } = await supabase.rpc("create_grouping_session", {
        p_subject: subject, p_class_section: section, p_total_students: total, p_capacities: capacities
      });
      if (error) throw error;
      currentSessionId = data;
      await loadSessions();
      await openSession(data);
      event.target.reset();
      customSizes.checked = false;
      equalArea.classList.remove("hidden");
      customArea.classList.add("hidden");
      buildCustomInputs();
    } catch (error) {
      showError("create-error", errText(error));
    } finally {
      button.disabled = false; button.textContent = "Create Session";
    }
  }

  async function openSession(id) {
    currentSessionId = id;
    clearError("manage-error");
    const { data: session, error } = await supabase.from("sessions").select("*").eq("id", id).single();
    if (error) { showError("manage-error", errText(error)); return; }

    document.getElementById("manage-title").textContent = `${session.subject} — ${session.class_section}`;
    document.getElementById("manage-meta").textContent = `${session.total_students} students • ${session.status}`;
    document.getElementById("start-session").classList.toggle("hidden", session.status !== "draft");
    document.getElementById("end-session").classList.toggle("hidden", session.status === "ended");
    manageCard.classList.remove("hidden");
    await loadManageData();
    await loadSessions();
    subscribeSession();
  }

  async function loadManageData() {
    if (!currentSessionId) return;
    const [{data: groups, error: ge}, {data: students, error: se}] = await Promise.all([
      supabase.from("groups").select("id, group_number, capacity, assigned_count").eq("session_id", currentSessionId).order("group_number"),
      supabase.from("assignments").select("student_name, group_number, assigned_at").eq("session_id", currentSessionId).order("assigned_at")
    ]);
    if (ge) throw ge; if (se) throw se;

    const assigned = (students || []).length;
    const total = (groups || []).reduce((a,g) => a + g.capacity, 0);
    const full = (groups || []).filter(g => g.assigned_count >= g.capacity).length;
    document.getElementById("admin-summary").innerHTML = `
      <div class="summary-box"><div class="summary-value">${assigned}/${total}</div><div class="summary-label">Students assigned</div></div>
      <div class="summary-box"><div class="summary-value">${(groups||[]).length}</div><div class="summary-label">Groups</div></div>
      <div class="summary-box"><div class="summary-value">${full}/${(groups||[]).length}</div><div class="summary-label">Groups full</div></div>`;

  document.getElementById("admin-groups").innerHTML = (groups || []).map(g => {
    const pct = Math.min(100, Math.round(g.assigned_count / g.capacity * 100));

    const members = (students || [])
      .filter(s => Number(s.group_number) === Number(g.group_number))
      .map(s => `<li>${escapeHtml(s.student_name)}</li>`)
      .join("");

    return `
      <div class="group-row group-row-members ${g.assigned_count >= g.capacity ? "full" : ""}">
        <div class="group-content">
          <div class="group-header">
            <div class="group-name">
              Group ${g.group_number}
              ${g.assigned_count >= g.capacity ? '<span class="lock">🔒 FULL</span>' : ""}
            </div>
            <div class="group-count">${g.assigned_count}/${g.capacity}</div>
          </div>

          <div class="progress">
            <span style="width:${pct}%"></span>
          </div>

          <div class="group-members">
            ${
              members
                ? `<ul>${members}</ul>`
                : `<p class="muted small">No students assigned yet.</p>`
            }
          </div>
        </div>
      </div>
    `;
  }).join("");

    document.getElementById("students-table-body").innerHTML = (students || []).map(s =>
      `<tr><td>${escapeHtml(s.student_name)}</td><td>Group ${s.group_number}</td><td>${new Date(s.assigned_at).toLocaleString()}</td></tr>`
    ).join("") || '<tr><td colspan="3" class="muted">No students assigned yet.</td></tr>';
  }

  async function startSession() {
    const { error } = await supabase.rpc("set_session_status", { p_session_id: currentSessionId, p_status: "active" });
    if (error) return showError("manage-error", errText(error));
    await openSession(currentSessionId);
  }

  async function resetSession() {
    if (!confirm("Reset this session? All student assignments will be permanently removed and the groups will return to 0. This cannot be undone.")) return;
    const { error } = await supabase.rpc("reset_grouping_session", { p_session_id: currentSessionId });
    if (error) return showError("manage-error", errText(error));
    await openSession(currentSessionId);
  }

  async function endSession() {
    if (!confirm("End/archive this session? Students will no longer be able to pick a group.")) return;
    const { error } = await supabase.rpc("set_session_status", { p_session_id: currentSessionId, p_status: "ended" });
    if (error) return showError("manage-error", errText(error));
    await openSession(currentSessionId);
  }

  function subscribeSession() {
    if (channel) supabase.removeChannel(channel);
    channel = supabase.channel(`admin-session-${currentSessionId}`)
      .on("postgres_changes", {event:"*", schema:"public", table:"groups", filter:`session_id=eq.${currentSessionId}`}, () => loadManageData())
      .on("postgres_changes", {event:"*", schema:"public", table:"assignments", filter:`session_id=eq.${currentSessionId}`}, () => loadManageData())
      .on("postgres_changes", {event:"*", schema:"public", table:"sessions", filter:`id=eq.${currentSessionId}`}, () => openSession(currentSessionId))
      .subscribe();
  }

  async function initAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) showAdmin(session);
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) showAdmin(session); else showLogin();
    });
  }

  async function login(event) {
    event.preventDefault();
    clearError("login-error");
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) showError("login-error", "Login failed. Check your email and password.");
  }

  async function showAdmin(session) {
    loginView.classList.add("hidden");
    adminApp.classList.remove("hidden");
    document.getElementById("logout-button").classList.remove("hidden");
    document.getElementById("admin-email").textContent = session.user.email || "";
    await loadSessions();
    updatePreview();
  }

  function showLogin() {
    loginView.classList.remove("hidden");
    adminApp.classList.add("hidden");
    document.getElementById("logout-button").classList.add("hidden");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  document.getElementById("login-form").addEventListener("submit", login);
  document.getElementById("logout-button").addEventListener("click", () => supabase.auth.signOut());
  document.getElementById("create-session-form").addEventListener("submit", createSession);
  document.getElementById("refresh-sessions").addEventListener("click", loadSessions);
  document.getElementById("start-session").addEventListener("click", startSession);
  document.getElementById("reset-session").addEventListener("click", resetSession);
  document.getElementById("end-session").addEventListener("click", endSession);
  document.getElementById("copy-student-link").addEventListener("click", async () => {
    if (!currentSessionId) return;
    try { await copy(publicStudentUrl(currentSessionId)); alert("Student link copied."); }
    catch { showError("manage-error", "Could not copy automatically. Copy the student URL from the browser address bar instead."); }
  });

  buildCustomInputs();
  initAuth();
})();
