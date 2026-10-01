(() => {
  const {
    supabase,
    showError,
    clearError,
    publicStudentUrl,
    copy
  } = RGM;

  let currentSessionId = null;
  let channel = null;

  const loginView = document.getElementById("login-view");
  const adminApp = document.getElementById("admin-app");
  const sessionList = document.getElementById("session-list");
  const manageCard = document.getElementById("manage-card");

  const customSizes = document.getElementById("custom-sizes");
  const equalArea = document.getElementById("equal-size-area");
  const customArea = document.getElementById("custom-size-area");

  const groupCountInput =
    document.getElementById("group-count");

  const totalStudentsInput =
    document.getElementById("total-students");

  const memberInput =
    document.getElementById("members-per-group");

  const customGroups =
    document.getElementById("custom-groups");

  /* =========================
     HELPERS
  ========================= */

  function errText(error) {
    return (
      error?.message ||
      "Something went wrong. Please try again."
    );
  }

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character])
    );
  }

  /* =========================
     CUSTOM GROUP INPUTS
  ========================= */

  function buildCustomInputs() {
    const count = Math.max(
      1,
      Math.min(
        100,
        Number(groupCountInput.value) || 1
      )
    );

    const oldValues = [
      ...customGroups.querySelectorAll("input")
    ].map(input => input.value);

    customGroups.innerHTML = "";

    for (let i = 1; i <= count; i++) {
      const wrapper =
        document.createElement("div");

      wrapper.className = "capacity-item";

      const label =
        document.createElement("label");

      label.textContent = `Group ${i}`;

      const input =
        document.createElement("input");

      input.type = "number";
      input.min = "1";
      input.max = "1000";

      input.value =
        oldValues[i - 1] ||
        memberInput.value ||
        "5";

      input.dataset.group = i;

      input.addEventListener(
        "input",
        updatePreview
      );

      wrapper.append(label, input);

      customGroups.appendChild(wrapper);
    }

    updatePreview();
  }

  function capacitiesFromForm() {
    if (customSizes.checked) {
      return [
        ...customGroups.querySelectorAll("input")
      ].map(input => Number(input.value));
    }

    const total =
      Number(totalStudentsInput.value);

    const count =
      Number(groupCountInput.value);

    if (
      !Number.isInteger(total) ||
      !Number.isInteger(count) ||
      total < count
    ) {
      return [];
    }

    const base =
      Math.floor(total / count);

    const remainder =
      total % count;

    return Array.from(
      { length: count },
      (_, index) =>
        base +
        (index < remainder ? 1 : 0)
    );
  }

  function updatePreview() {
    const capacities =
      capacitiesFromForm();

    const sum =
      capacities.reduce(
        (a, b) => a + b,
        0
      );

    const total =
      Number(totalStudentsInput.value);

    const text = capacities.length
      ? `Capacity: ${sum} slots${
          sum === total
            ? " ✓ matches total students"
            : ` • ${
                sum - total
              } difference from total students`
        }`
      : "";

    const preview =
      document.getElementById(
        customSizes.checked
          ? "custom-capacity-preview"
          : "capacity-preview"
      );

    if (preview) {
      preview.textContent = text;
    }
  }

  /* =========================
     FORM EVENTS
  ========================= */

  customSizes.addEventListener(
    "change",
    () => {
      equalArea.classList.toggle(
        "hidden",
        customSizes.checked
      );

      customArea.classList.toggle(
        "hidden",
        !customSizes.checked
      );

      if (customSizes.checked) {
        buildCustomInputs();
      }

      updatePreview();
    }
  );

  groupCountInput.addEventListener(
    "input",
    () => {
      if (customSizes.checked) {
        buildCustomInputs();
      }

      updatePreview();
    }
  );

  totalStudentsInput.addEventListener(
    "input",
    updatePreview
  );

  memberInput.addEventListener(
    "input",
    updatePreview
  );

  /* =========================
     LOAD SESSIONS
  ========================= */

  async function loadSessions() {
    const {
      data,
      error
    } = await supabase
      .from("sessions")
      .select(
        "id, subject, class_section, total_students, status, created_at"
      )
      .order(
        "created_at",
        { ascending: false }
      );

    if (error) {
      throw error;
    }

    sessionList.innerHTML =
      data?.length
        ? data
            .map(
              session => `
                <div
                  class="session-item ${
                    session.id ===
                    currentSessionId
                      ? "active"
                      : ""
                  }"
                  data-id="${session.id}"
                >

                  <div class="session-item-title">
                    ${escapeHtml(
                      session.subject
                    )}
                    —
                    ${escapeHtml(
                      session.class_section
                    )}
                  </div>

                  <div class="session-item-meta">
                    ${session.total_students}
                    students
                  </div>

                  <div class="session-item-status">
                    ${escapeHtml(
                      session.status
                    )}
                  </div>

                </div>
              `
            )
            .join("")
        : `
            <p class="muted">
              No sessions yet.
            </p>
          `;

    sessionList
      .querySelectorAll(
        ".session-item"
      )
      .forEach(element => {
        element.addEventListener(
          "click",
          () =>
            openSession(
              element.dataset.id
            )
        );
      });
  }

  /* =========================
     CREATE SESSION
  ========================= */

  async function createSession(event) {
    event.preventDefault();

    clearError("create-error");

    const subject =
      document
        .getElementById("subject")
        .value
        .trim();

    const section =
      document
        .getElementById("section")
        .value
        .trim();

    const total =
      Number(totalStudentsInput.value);

    const count =
      Number(groupCountInput.value);

    const capacities =
      capacitiesFromForm();

    if (!subject || !section) {
      return showError(
        "create-error",
        "Subject and class/section are required."
      );
    }

    if (
      !capacities.length ||
      capacities.some(
        value =>
          !Number.isInteger(value) ||
          value < 1
      )
    ) {
      return showError(
        "create-error",
        "All group capacities must be whole numbers greater than 0."
      );
    }

    if (
      capacities.reduce(
        (a, b) => a + b,
        0
      ) !== total
    ) {
      return showError(
        "create-error",
        "Group capacity must exactly equal total students."
      );
    }

    const button =
      document.getElementById(
        "create-session-button"
      );

    button.disabled = true;
    button.textContent = "Creating…";

    try {
      const {
        data,
        error
      } = await supabase.rpc(
        "create_grouping_session",
        {
          p_subject: subject,
          p_class_section: section,
          p_total_students: total,
          p_capacities: capacities
        }
      );

      if (error) {
        throw error;
      }

      currentSessionId = data;

      await loadSessions();
      await openSession(data);

      event.target.reset();

      customSizes.checked = false;

      equalArea.classList.remove(
        "hidden"
      );

      customArea.classList.add(
        "hidden"
      );

      buildCustomInputs();

    } catch (error) {
      showError(
        "create-error",
        errText(error)
      );

    } finally {
      button.disabled = false;
      button.textContent =
        "Create Session";
    }
  }

  /* =========================
     OPEN SESSION
  ========================= */

  async function openSession(id) {
    currentSessionId = id;

    clearError("manage-error");

    const {
      data: session,
      error
    } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      showError(
        "manage-error",
        errText(error)
      );
      return;
    }

    document.getElementById(
      "manage-title"
    ).textContent =
      `${session.subject} — ${session.class_section}`;

    document.getElementById(
      "manage-meta"
    ).textContent =
      `${session.total_students} students • ${session.status}`;

    document
      .getElementById(
        "start-session"
      )
      .classList.toggle(
        "hidden",
        session.status !== "draft"
      );

    document
      .getElementById(
        "end-session"
      )
      .classList.toggle(
        "hidden",
        session.status === "ended"
      );

    manageCard.classList.remove(
      "hidden"
    );

    await loadManageData();
    await loadSessions();

    subscribeSession();
  }

  /* =========================
     LOAD GROUPS AND STUDENTS
  ========================= */

  async function loadManageData() {
    if (!currentSessionId) {
      return;
    }

    /*
      GROUPS:
      groups.id = unique ID of the group
      groups.group_number = visible group number
    */

    const {
      data: groups,
      error: groupsError
    } = await supabase
      .from("groups")
      .select(
        "id, group_number, capacity, assigned_count"
      )
      .eq(
        "session_id",
        currentSessionId
      )
      .order("group_number");

    /*
      ASSIGNMENTS:
      assignments.group_id tells us
      which group the student belongs to.
    */

    const {
      data: students,
      error: studentsError
    } = await supabase
      .from("assignments")
      .select(
        "student_name, group_id, assigned_at"
      )
      .eq(
        "session_id",
        currentSessionId
      )
      .order("assigned_at");

    if (groupsError) {
      throw groupsError;
    }

    if (studentsError) {
      throw studentsError;
    }

    const groupData =
      groups || [];

    const studentData =
      students || [];

    /* =========================
       SUMMARY
    ========================= */

    const assigned =
      studentData.length;

    const total =
      groupData.reduce(
        (sum, group) =>
          sum +
          Number(group.capacity),
        0
      );

    const full =
      groupData.filter(
        group =>
          Number(
            group.assigned_count
          ) >=
          Number(group.capacity)
      ).length;

    document.getElementById(
      "admin-summary"
    ).innerHTML = `
      <div class="summary-box">
        <div class="summary-value">
          ${assigned}/${total}
        </div>

        <div class="summary-label">
          Students assigned
        </div>
      </div>

      <div class="summary-box">
        <div class="summary-value">
          ${groupData.length}
        </div>

        <div class="summary-label">
          Groups
        </div>
      </div>

      <div class="summary-box">
        <div class="summary-value">
          ${full}/${groupData.length}
        </div>

        <div class="summary-label">
          Groups full
        </div>
      </div>
    `;

    /* =========================
       GROUP LIST
       WITH STUDENT NAMES
    ========================= */

    const groupList =
      document.getElementById(
        "admin-groups"
      );

    groupList.innerHTML =
      groupData
        .map(group => {

          const capacity =
            Number(group.capacity);

          const assignedCount =
            Number(
              group.assigned_count
            );

          const percentage =
            capacity > 0
              ? Math.min(
                  100,
                  Math.round(
                    (assignedCount /
                      capacity) *
                      100
                  )
                )
              : 0;

          /*
            THIS IS THE IMPORTANT FIX.

            Instead of:
            student.group_number

            We use:
            student.group_id === group.id
          */

          const members =
            studentData.filter(
              student =>
                String(
                  student.group_id
                ) ===
                String(group.id)
            );

          const memberList =
            members.length
              ? `
                <ul>
                  ${members
                    .map(
                      student => `
                        <li>
                          ${escapeHtml(
                            student.student_name
                          )}
                        </li>
                      `
                    )
                    .join("")}
                </ul>
              `
              : `
                <p class="muted small">
                  No students assigned yet.
                </p>
              `;

          return `
            <div
              class="group-row group-row-members ${
                assignedCount >=
                capacity
                  ? "full"
                  : ""
              }"
            >

              <div class="group-content">

                <div class="group-header">

                  <div class="group-name">

                    Group
                    ${group.group_number}

                    ${
                      assignedCount >=
                      capacity
                        ? `
                          <span class="lock">
                            🔒 FULL
                          </span>
                        `
                        : ""
                    }

                  </div>

                  <div class="group-count">
                    ${assignedCount}/${capacity}
                  </div>

                </div>

                <div class="progress">
                  <span
                    style="
                      width:${percentage}%;
                    "
                  ></span>
                </div>

                <div class="group-members">
                  ${memberList}
                </div>

              </div>

            </div>
          `;
        })
        .join("");

    /* =========================
       ASSIGNED STUDENTS TABLE
    ========================= */

    const tableBody =
      document.getElementById(
        "students-table-body"
      );

    tableBody.innerHTML =
      studentData.length
        ? studentData
            .map(student => {

              const group =
                groupData.find(
                  group =>
                    String(
                      group.id
                    ) ===
                    String(
                      student.group_id
                    )
                );

              const groupNumber =
                group
                  ? group.group_number
                  : "—";

              return `
                <tr>

                  <td>
                    ${escapeHtml(
                      student.student_name
                    )}
                  </td>

                  <td>
                    ${
                      group
                        ? `Group ${groupNumber}`
                        : "—"
                    }
                  </td>

                  <td>
                    ${new Date(
                      student.assigned_at
                    ).toLocaleString()}
                  </td>

                </tr>
              `;
            })
            .join("")
        : `
            <tr>
              <td
                colspan="3"
                class="muted"
              >
                No students assigned yet.
              </td>
            </tr>
          `;
  }

  /* =========================
     START SESSION
  ========================= */

  async function startSession() {
    const {
      error
    } = await supabase.rpc(
      "set_session_status",
      {
        p_session_id:
          currentSessionId,
        p_status: "active"
      }
    );

    if (error) {
      return showError(
        "manage-error",
        errText(error)
      );
    }

    await openSession(
      currentSessionId
    );
  }

  /* =========================
     RESET SESSION
  ========================= */

  async function resetSession() {
    const confirmed =
      confirm(
        "Reset this session? All student assignments will be permanently removed and the groups will return to 0. This cannot be undone."
      );

    if (!confirmed) {
      return;
    }

    const {
      error
    } = await supabase.rpc(
      "reset_grouping_session",
      {
        p_session_id:
          currentSessionId
      }
    );

    if (error) {
      return showError(
        "manage-error",
        errText(error)
      );
    }

    await openSession(
      currentSessionId
    );
  }

  /* =========================
     END SESSION
  ========================= */

  async function endSession() {
    const confirmed =
      confirm(
        "End/archive this session? Students will no longer be able to pick a group."
      );

    if (!confirmed) {
      return;
    }

    const {
      error
    } = await supabase.rpc(
      "set_session_status",
      {
        p_session_id:
          currentSessionId,
        p_status: "ended"
      }
    );

    if (error) {
      return showError(
        "manage-error",
        errText(error)
      );
    }

    await openSession(
      currentSessionId
    );
  }

  /* =========================
     REALTIME SUBSCRIPTION
  ========================= */

  function subscribeSession() {
    if (channel) {
      supabase.removeChannel(
        channel
      );
    }

    channel = supabase
      .channel(
        `admin-session-${currentSessionId}`
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "groups",
          filter:
            `session_id=eq.${currentSessionId}`
        },
        () => {
          loadManageData();
        }
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "assignments",
          filter:
            `session_id=eq.${currentSessionId}`
        },
        () => {
          loadManageData();
        }
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sessions",
          filter:
            `id=eq.${currentSessionId}`
        },
        () => {
          openSession(
            currentSessionId
          );
        }
      )

      .subscribe();
  }

  /* =========================
     AUTH
  ========================= */

  async function initAuth() {
    const {
      data: {
        session
      }
    } =
      await supabase.auth.getSession();

    if (session) {
      showAdmin(session);
    }

    supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          showAdmin(session);
        } else {
          showLogin();
        }
      }
    );
  }

  async function login(event) {
    event.preventDefault();

    clearError("login-error");

    const email =
      document
        .getElementById("login-email")
        .value
        .trim();

    const password =
      document.getElementById(
        "login-password"
      ).value;

    const {
      error
    } =
      await supabase.auth.signInWithPassword(
        {
          email,
          password
        }
      );

    if (error) {
      showError(
        "login-error",
        "Login failed. Check your email and password."
      );
    }
  }

  async function showAdmin(session) {
    loginView.classList.add(
      "hidden"
    );

    adminApp.classList.remove(
      "hidden"
    );

    document
      .getElementById(
        "logout-button"
      )
      .classList.remove("hidden");

    document.getElementById(
      "admin-email"
    ).textContent =
      session.user.email || "";

    try {
      await loadSessions();
      updatePreview();
    } catch (error) {
      console.error(
        "Could not load sessions:",
        error
      );
    }
  }

  function showLogin() {
    loginView.classList.remove(
      "hidden"
    );

    adminApp.classList.add(
      "hidden"
    );

    document
      .getElementById(
        "logout-button"
      )
      .classList.add("hidden");

    if (channel) {
      supabase.removeChannel(
        channel
      );

      channel = null;
    }

    currentSessionId = null;
  }

  /* =========================
     BUTTON EVENTS
  ========================= */

  document
    .getElementById("login-form")
    .addEventListener(
      "submit",
      login
    );

  document
    .getElementById("logout-button")
    .addEventListener(
      "click",
      () => {
        supabase.auth.signOut();
      }
    );

  document
    .getElementById(
      "create-session-form"
    )
    .addEventListener(
      "submit",
      createSession
    );

  document
    .getElementById(
      "refresh-sessions"
    )
    .addEventListener(
      "click",
      loadSessions
    );

  document
    .getElementById(
      "start-session"
    )
    .addEventListener(
      "click",
      startSession
    );

  document
    .getElementById(
      "reset-session"
    )
    .addEventListener(
      "click",
      resetSession
    );

  document
    .getElementById(
      "end-session"
    )
    .addEventListener(
      "click",
      endSession
    );

  document
    .getElementById(
      "copy-student-link"
    )
    .addEventListener(
      "click",
      async () => {

        if (!currentSessionId) {
          return;
        }

        try {
          await copy(
            publicStudentUrl(
              currentSessionId
            )
          );

          alert(
            "Student link copied."
          );

        } catch {
          showError(
            "manage-error",
            "Could not copy automatically. Copy the student URL from the browser address bar instead."
          );
        }
      }
    );

  /* =========================
     INITIALIZE
  ========================= */

  buildCustomInputs();
  initAuth();

})();