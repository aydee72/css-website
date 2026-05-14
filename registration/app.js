const SUPABASE_URL = "https://zfyveyvtafcfkmmfgzjc.supabase.co";
const SUPABASE_ANON = "sb_publishable_MYAyOVxrqvncoLbQ9TKAvQ_EkWEFaoC";
const SUPABASE_FUNCTIONS_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmeXZleXZ0YWZjZmttbWZnempjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMzQyNDQsImV4cCI6MjA4NjkxMDI0NH0._BSM2R6smNjWOEiv7bwx1oLIIr701HqsgYU8zVYwBYA";

const el = (id) => document.getElementById(id);

let events = [];
let selectedEventId = "";
let students = [];
let jotforms = [];
let matches = [];
let selectedStudent = null;
let showMatchChoices = false;
let liveRefreshTimer = null;
let liveRefreshBusy = false;

const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

function normalizeName(value) {
  return norm(value)
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[.,/#!$%^&*;:{}=_`~()'"?@[\]\\|+<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNameSort(value) {
  const cleaned = norm(value).toLowerCase();
  if (!cleaned) return "";
  return cleaned.split(" ")[0] || "";
}

function lastNameSort(value) {
  const cleaned = norm(value).toLowerCase();
  if (!cleaned) return "";
  const parts = cleaned.split(" ");
  return parts[parts.length - 1] || "";
}

function bikeSortValue(value) {
  const match = norm(value).match(/\d+/);
  const n = match ? Number(match[0]) : NaN;
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function todaySydneyYYYYMMDD() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function setStatus(message, isError = false) {
  el("status").textContent = message || "";
  el("status").className = isError ? "status-area status-error" : "status-area";
}

function setEventStatus(message) {
  el("eventStatus").textContent = message || "";
}

async function supabaseFetch(path, { method = "GET", body = null, prefer = null } = {}) {
  const headers = {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${SUPABASE_ANON}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (prefer) {
    headers.Prefer = prefer;
  }

  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  if (!res.ok) {
    throw new Error(
      typeof json === "string"
        ? json
        : json.message || json.error || `Request failed (${res.status})`
    );
  }

  return json;
}

function eventLabel(event) {
  return event.code || event.name || event.event_date || "Event";
}

async function loadEvents() {
  setEventStatus("Loading…");

  try {
    const today = todaySydneyYYYYMMDD();
    events = await supabaseFetch(
      `/rest/v1/events?select=id,event_date,name,code&event_date=gte.${today}&order=event_date.asc`
    );

    const select = el("eventSelect");
    select.innerHTML = "";

    if (!events.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No future events found";
      select.appendChild(option);
      selectedEventId = "";
      setEventStatus("0 events");
      renderStudents();
      return;
    }

    events.forEach((event) => {
      const option = document.createElement("option");
      option.value = event.id;
      option.textContent = `${event.event_date || ""} — ${eventLabel(event)}`;
      select.appendChild(option);
    });

    selectedEventId = selectedEventId || events[0].id;
    select.value = selectedEventId;
    setEventStatus(`${events.length} events`);
    await loadRegistrationData(selectedEventId);
    startLiveRefresh(selectedEventId);
  } catch (error) {
    console.error(error);
    setEventStatus(`Error: ${error.message}`);
  }
}

async function loadRegistrationData(eventId, silent = false) {
  if (!silent) {
    setStatus("Loading registration data…");
  }

  try {
    const [studentData, jotformData, matchData] = await Promise.all([
      supabaseFetch(
`/rest/v1/course_control_students?select=id,event_id,student_name,bike,level,group_code,registration_checked,general_scrutineering_checked,manual_form_checked&event_id=eq.${encodeURIComponent(eventId)}`      ),
      supabaseFetch(
        `/rest/v1/jotform_registrations?select=jotform_submission_id,full_name,event_id,event_date&event_id=eq.${encodeURIComponent(eventId)}&event_date=eq.${events.find(e => e.id === eventId)?.event_date}`
      ),
      supabaseFetch(
        `/rest/v1/registration_matches?select=course_control_student_id,jotform_submission_id,jotform_name&event_id=eq.${encodeURIComponent(eventId)}`
      ),
    ]);

    students = (studentData || []).map((student) =>
      shouldAutoCompleteScrutineering(student)
        ? { ...student, general_scrutineering_checked: true }
        : student
    );
    jotforms = jotformData || [];
    matches = matchData || [];

    const autoScrutineeringUpdates = (studentData || []).filter(
      (student) => shouldAutoCompleteScrutineering(student) && !student.general_scrutineering_checked
    );

    if (autoScrutineeringUpdates.length) {
      await Promise.all(
        autoScrutineeringUpdates.map((student) =>
          supabaseFetch(`/rest/v1/course_control_students?id=eq.${encodeURIComponent(student.id)}`, {
            method: "PATCH",
            body: { general_scrutineering_checked: true },
            prefer: "return=minimal",
          })
        )
      );
    }

    if (!silent) {
      setStatus("");
    }
    renderStudents();
  } catch (error) {
    console.error(error);
    students = [];
    jotforms = [];
    matches = [];
    renderStudents();
    setStatus(error.message || "Failed loading registration data", true);
  }
}
function startLiveRefresh(eventId) {
  if (liveRefreshTimer) {
    clearInterval(liveRefreshTimer);
  }

  liveRefreshTimer = setInterval(async () => {
    if (!eventId || liveRefreshBusy) return;

    liveRefreshBusy = true;
    try {
      await loadRegistrationData(eventId, true);
    } finally {
      liveRefreshBusy = false;
    }
  }, 2000);
}

window.addEventListener("beforeunload", () => {
  if (liveRefreshTimer) {
    clearInterval(liveRefreshTimer);
  }
});
function sortedStudents() {
  return students
    .filter((student) => norm(student.student_name).length > 0)
    .sort((a, b) => {
      const firstDelta = firstNameSort(a.student_name).localeCompare(firstNameSort(b.student_name));
      if (firstDelta !== 0) return firstDelta;

      const lastDelta = lastNameSort(a.student_name).localeCompare(lastNameSort(b.student_name));
      if (lastDelta !== 0) return lastDelta;

      const fullDelta = norm(a.student_name).localeCompare(norm(b.student_name));
      if (fullDelta !== 0) return fullDelta;

      return bikeSortValue(a.bike) - bikeSortValue(b.bike);
    });
}

function matchMap() {
  const map = new Map();

  matches.forEach((match) => {
    if (match.jotform_submission_id) {
      map.set(match.course_control_student_id, match);
    }
  });

  return map;
}

function autoMatchMap() {
  const manualMatches = matchMap();
  const map = new Map();
  const available = new Map();

  const manualSubmissionIds = new Set(
    Array.from(manualMatches.values())
      .map((match) => match.jotform_submission_id)
      .filter(Boolean)
  );

  jotforms.forEach((entry) => {
    if (manualSubmissionIds.has(entry.jotform_submission_id)) return;

    const key = normalizeName(entry.full_name);
    if (!key) return;

    const list = available.get(key) || [];
    list.push(entry);
    available.set(key, list);
  });

  sortedStudents().forEach((student) => {
    if (manualMatches.has(student.id)) return;

    const key = normalizeName(student.student_name);
    if (!key) return;

    const list = available.get(key);
    if (!list || !list.length) return;

    const picked = list.shift();
    if (picked) {
      map.set(student.id, picked);
    }
  });

  return map;
}

function isMatched(student) {
  return Boolean(matchMap().get(student.id) || autoMatchMap().get(student.id));
}

function groupClass(groupCode) {
  const value = norm(groupCode).toUpperCase();

  if (value === "W") return "registration-group-w";
  if (value === "Y") return "registration-group-y";
  if (value === "G") return "registration-group-g";

  return "";
}

function levelHireSuffix(value) {
  const match = norm(value).match(/^(.*?)\s+(BG|GB|B|G)$/i);
  return match ? match[2].toUpperCase() : "";
}

function shouldAutoCompleteScrutineering(student) {
  return Boolean(levelHireSuffix(student && student.level));
}

function levelDisplay(value) {
  const raw = norm(value);
  if (!raw) return "";

  const suffix = levelHireSuffix(raw);
  if (!suffix) return raw;

  const baseLevel = norm(raw.replace(/\s+(BG|GB|B|G)$/i, ""));
  const hasBikeHire = suffix.includes("B");
  const hasGearHire = suffix.includes("G");

  if (hasBikeHire && hasGearHire) return `${baseLevel} • Bike + Gear Hire`;
  if (hasBikeHire) return `${baseLevel} • Bike Hire`;
  if (hasGearHire) return `${baseLevel} • Gear Hire`;

  return raw;
}

function filteredStudents() {
  const query = norm(el("studentSearch")?.value).toLowerCase();

  if (!query) return sortedStudents();

  return sortedStudents().filter((student) => {
    const name = norm(student.student_name).toLowerCase();
    const bike = norm(student.bike).toLowerCase();

    return name.includes(query) || bike.includes(query);
  });
}


function renderStudents() {
  const container = el("students");
  container.innerHTML = "";

  filteredStudents().forEach((student) => {
        const matched = isMatched(student);
    const row = document.createElement("div");

    row.className = [
      "registration-row",
      matched ? "registration-row-matched" : "registration-row-unmatched",
      groupClass(student.group_code),
    ]
      .filter(Boolean)
      .join(" ");

    row.addEventListener("click", () => openMatchModal(student));

    const bike = document.createElement("div");
    bike.className = "registration-bike";
    bike.textContent = norm(student.bike) || "-";

    const name = document.createElement("div");
    name.className = "registration-name";

    const studentName = document.createElement("div");
    studentName.textContent = norm(student.student_name);
    name.appendChild(studentName);

    const level = levelDisplay(student.level);
    if (level) {
      const levelText = document.createElement("div");
      levelText.textContent = level;
      levelText.style.fontSize = "13px";
      levelText.style.fontWeight = "700";
      levelText.style.color = "#9aa0b5";
      levelText.style.marginTop = "3px";
      name.appendChild(levelText);
    }

    const reg = document.createElement("button");
    reg.type = "button";
    reg.className = "status-button";
    reg.innerHTML = `Reg <span class="${student.registration_checked ? "status-yes" : "status-no"}">${student.registration_checked ? "✓" : "✗"}</span>`;
    reg.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRegistration(student);
    });

    const scrut = document.createElement("div");
    scrut.className = "status-button status-button-readonly";
    scrut.innerHTML = `Scrut <span class="${student.general_scrutineering_checked ? "status-yes" : "status-no"}">${student.general_scrutineering_checked ? "✓" : "✗"}</span>`;

    const form = document.createElement("div");
    form.className = "status-button status-button-readonly";
    form.innerHTML = `Form <span class="${matched ? "status-yes" : "status-no"}">${matched ? "✓" : "✗"}</span>`;

    const manualForm = document.createElement("button");
    manualForm.type = "button";
    manualForm.className = "status-button";
    manualForm.innerHTML = `Manual <span class="${student.manual_form_checked ? "status-yes" : "status-no"}">${student.manual_form_checked ? "✓" : "✗"}</span>`;
    manualForm.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleManualForm(student);
    });
    row.appendChild(bike);
    row.appendChild(name);
    row.appendChild(reg);
    row.appendChild(scrut);
    row.appendChild(form);
    row.appendChild(manualForm);

    container.appendChild(row);
  });
}

async function toggleManualForm(student) {
  if (!selectedEventId) return;

  const next = !student.manual_form_checked;

  try {
    await supabaseFetch(`/rest/v1/course_control_students?id=eq.${encodeURIComponent(student.id)}`, {
      method: "PATCH",
      body: { manual_form_checked: next },
      prefer: "return=minimal",
    });

    await loadRegistrationData(selectedEventId);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed updating manual form check", true);
  }
}


async function toggleRegistration(student) {
  if (!selectedEventId) return;

  const next = !student.registration_checked;

  try {
    await supabaseFetch(`/rest/v1/course_control_students?id=eq.${encodeURIComponent(student.id)}`, {
      method: "PATCH",
      body: { registration_checked: next },
      prefer: "return=minimal",
    });

    await loadRegistrationData(selectedEventId);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed updating registration", true);
  }
}

async function markStudentChecked(studentId) {
  await supabaseFetch(`/rest/v1/course_control_students?id=eq.${encodeURIComponent(studentId)}`, {
    method: "PATCH",
    body: { registration_checked: true },
    prefer: "return=minimal",
  });

  students = students.map((student) =>
    student.id === studentId ? { ...student, registration_checked: true } : student
  );
}

function usedSubmissionIds() {
  const ids = new Set();

  matches.forEach((match) => {
    if (
      selectedStudent &&
      match.course_control_student_id !== selectedStudent.id &&
      match.jotform_submission_id
    ) {
      ids.add(match.jotform_submission_id);
    }
  });

  return ids;
}

function unmatchedJotforms() {
  const used = usedSubmissionIds();
  const map = new Map();

  jotforms.forEach((entry) => {
    if (used.has(entry.jotform_submission_id)) return;

    const key = normalizeName(entry.full_name);
    if (!key) return;

    // keep latest (assuming higher submission id = newer)
    const existing = map.get(key);
    if (!existing || entry.jotform_submission_id > existing.jotform_submission_id) {
      map.set(key, entry);
    }
  });

  return Array.from(map.values());
}

function filteredJotforms() {
  const query = el("searchInput").value.toLowerCase().trim();

  if (!query) return unmatchedJotforms();

  return unmatchedJotforms().filter((entry) =>
    norm(entry.full_name).toLowerCase().includes(query)
  );
}

function selectedMatchName() {
  if (!selectedStudent) return "";

  const manualMatch = matchMap().get(selectedStudent.id);
  const automaticMatch = autoMatchMap().get(selectedStudent.id);

  if (manualMatch) {
    const found = jotforms.find(
      (entry) => entry.jotform_submission_id === manualMatch.jotform_submission_id
    );

    return norm(manualMatch.jotform_name) || norm(found?.full_name);
  }

  return norm(automaticMatch?.full_name);
}

function renderMatchChoices() {
  const container = el("jotformChoices");
  container.innerHTML = "";

  const entries = filteredJotforms();

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = el("searchInput").value.trim()
      ? "No results found."
      : "No unmatched registrations left.";
    container.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "student-filter-item";
    item.textContent = norm(entry.full_name);
    item.addEventListener("click", () => handleManualMatch(entry));
    container.appendChild(item);
  });
}

function openMatchModal(student) {
  selectedStudent = student;

  const manualMatch = matchMap().get(student.id);
  const matched = isMatched(student);

  showMatchChoices = !matched;

  el("modalStudentName").textContent = norm(student.student_name);
  el("searchInput").value = "";

  if (manualMatch) {
    el("currentMatchBox").classList.remove("hidden");
    el("currentMatchText").textContent = `Matched to: ${selectedMatchName() || "Unknown"}`;
  } else {
    el("currentMatchBox").classList.add("hidden");
  }

  el("matchChoices").classList.toggle("hidden", !showMatchChoices);
  renderMatchChoices();
  el("matchModal").classList.remove("hidden");
}

function closeMatchModal() {
  selectedStudent = null;
  showMatchChoices = false;
  el("matchModal").classList.add("hidden");
  el("searchInput").value = "";
}

async function handleManualMatch(choice) {
  if (!selectedStudent || !selectedEventId) return;

  const payload = {
    event_id: selectedEventId,
    course_control_student_id: selectedStudent.id,
    jotform_submission_id: choice.jotform_submission_id,
    jotform_name: norm(choice.full_name),
    matched_at: new Date().toISOString(),
  };

  try {
    await supabaseFetch(
      "/rest/v1/registration_matches?on_conflict=course_control_student_id",
      {
        method: "POST",
        body: payload,
        prefer: "resolution=merge-duplicates,return=representation",
      }
    );

    await markStudentChecked(selectedStudent.id);
    closeMatchModal();
    await loadRegistrationData(selectedEventId);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed creating registration match", true);
  }
}

async function handleClearMatch() {
  if (!selectedStudent || !selectedEventId) return;

  try {
    await supabaseFetch(
      `/rest/v1/registration_matches?course_control_student_id=eq.${encodeURIComponent(selectedStudent.id)}&event_id=eq.${encodeURIComponent(selectedEventId)}`,
      {
        method: "DELETE",
        prefer: "return=minimal",
      }
    );

    await supabaseFetch(`/rest/v1/course_control_students?id=eq.${encodeURIComponent(selectedStudent.id)}`, {
      method: "PATCH",
      body: { registration_checked: false },
      prefer: "return=minimal",
    });

    closeMatchModal();
    await loadRegistrationData(selectedEventId);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed clearing registration match", true);
  }
}

async function syncJotform() {
  if (!selectedEventId) return;

  const button = el("syncJotform");
  button.disabled = true;
  button.textContent = "Syncing Jotform…";
  setStatus("Syncing Jotform…");

  const selectedEvent = events.find((event) => event.id === selectedEventId);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-jotform-registrations`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_FUNCTIONS_ANON}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventId: selectedEventId,
        eventDate: selectedEvent?.event_date ?? null,
      }),
    });

    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }

    if (!res.ok) {
      throw new Error(
        typeof json === "string"
          ? json
          : json?.error || json?.message || `Jotform sync failed (${res.status})`
      );
    }

    const importedCount = Number(json?.imported ?? 0);
    setStatus(`Synced Jotform (${importedCount})`);
    await loadRegistrationData(selectedEventId);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Jotform sync failed", true);
  } finally {
    button.disabled = false;
    button.textContent = "Sync Jotform";
  }
}

el("eventSelect").addEventListener("change", async (event) => {
  selectedEventId = event.target.value;
  await loadRegistrationData(selectedEventId);
  startLiveRefresh(selectedEventId);
});

el("syncJotform").addEventListener("click", syncJotform);
el("doneModal").addEventListener("click", closeMatchModal);
el("cancelModal").addEventListener("click", closeMatchModal);
el("clearMatch").addEventListener("click", handleClearMatch);
el("changeMatch").addEventListener("click", () => {
  showMatchChoices = true;
  el("matchChoices").classList.remove("hidden");
  renderMatchChoices();
});
el("searchInput").addEventListener("input", renderMatchChoices);

el("studentSearch")?.addEventListener("input", renderStudents);

loadEvents();