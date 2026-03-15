const SUPABASE_URL = "https://zfyveyvtafcfkmmfgzjc.supabase.co";
const SUPABASE_ANON = "sb_publishable_MYAyOVxrqvncoLbQ9TKAvQ_EkWEFaoC";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

const state = {
  loading: false,
  err: "",
  events: [],
  selectedEventId: "",
  rows: [],
  assignByEnroll: {},
  drills: [],
  drillsLoading: false,
  csvPreview: null,
  csvWarnings: [],
  maxRideNo: 5,
  editOpen: false,
  editEnrollmentId: null,
  editRideNo: 1,
  editValue: "",
  editCustomDescription: "",
  drillSearch: "",
  realtimeChannel: null,
};

const els = {
  eventSelect: document.getElementById("eventSelect"),
  refreshBtn: document.getElementById("refreshBtn"),
  board: document.getElementById("board"),
  statusArea: document.getElementById("statusArea"),
  csvInfo: document.getElementById("csvInfo"),
  csvFileInput: document.getElementById("csvFileInput"),
  editModal: document.getElementById("editModal"),
  modalTitle: document.getElementById("modalTitle"),
  editValue: document.getElementById("editValue"),
  editCustomDescription: document.getElementById("editCustomDescription"),
  drillSearch: document.getElementById("drillSearch"),
  drillList: document.getElementById("drillList"),
  drillCount: document.getElementById("drillCount"),
  clearTextBtn: document.getElementById("clearTextBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  saveBtn: document.getElementById("saveBtn"),
};

function norm(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function assignmentDisplay(a) {
  return norm(a.drill_code) || norm(a.custom_text) || "";
}

function latestRideDisplay(assignments) {
  let bestRideNo = 0;
  let bestText = "";

  for (const a of assignments) {
    const rideNo = Number(a.ride_no);
    if (!Number.isFinite(rideNo) || rideNo <= 0) continue;

    const text = assignmentDisplay(a);
    if (!text) continue;

    if (rideNo >= bestRideNo) {
      bestRideNo = rideNo;
      bestText = text;
    }
  }

  return bestText || null;
}

function splitDrillValue(raw) {
  const v = norm(raw);
  if (!v) return { drill_code: null, custom_text: null, display: "" };

  const looksLikeCode = /^[A-Z0-9]{2,10}$/.test(v);
  if (looksLikeCode) {
    return { drill_code: v, custom_text: null, display: v };
  }

  return { drill_code: null, custom_text: v, display: v };
}

function parseRideColumns(raw) {
  const rides = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).trim().toLowerCase();
    const m =
      key.match(/^ride\s*0*([0-9]+)$/) ||
      key.match(/^ride\s*([0-9]+)$/) ||
      key.match(/^ride([0-9]+)$/);

    if (!m) continue;

    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0 || n > 10) continue;

    const val = norm(v);
    if (val) rides[n] = val;
  }
  return rides;
}

function toCsvRow(raw) {
  const coach = norm(raw.COACH ?? raw.Coach ?? raw.coach);
  const bikeNo = norm(
    raw["bike#"] ??
      raw.Bike ??
      raw.bike ??
      raw.bike_no ??
      raw["Bike#"] ??
      raw["BIKE#"]
  );
  const student = norm(raw.Student ?? raw.student ?? raw.STUDENT ?? raw.Name ?? raw.name);
  const rides = parseRideColumns(raw);

  return { coach, bikeNo, student, rides, raw };
}

function setStatus() {
  const bits = [];
  if (state.loading) bits.push(`<div>Loading roster…</div>`);
  if (state.err) bits.push(`<div class="status-error">${escapeHtml(state.err)}</div>`);
  if (!state.loading && !state.err && state.rows.length === 0 && state.selectedEventId) {
    bits.push(`<div>No enrollments yet for this event.</div>`);
  }

  if (state.csvWarnings.length) {
    bits.push(`<div class="warning-list"><div>CSV warnings:</div>${state.csvWarnings
      .map((w) => `<div class="warning-item">• ${escapeHtml(w)}</div>`)
      .join("")}</div>`);
  }

  els.statusArea.innerHTML = bits.join("");

  if (state.csvPreview) {
    els.csvInfo.textContent = `CSV loaded: ${state.csvPreview.length} rows · Showing ${state.maxRideNo} rides`;
  } else {
    els.csvInfo.textContent = "";
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadEvents() {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabaseClient
    .from("events")
    .select("id,code,name,event_date")
    .gte("event_date", today)
    .order("event_date", { ascending: true });

  if (error) throw error;

  state.events = data ?? [];
  renderEventSelect();
}

function renderEventSelect() {
  const current = state.selectedEventId || "";

  if (!state.events.length) {
    els.eventSelect.innerHTML = `<option value="">No events found</option>`;
    return;
  }

  const options = [
    `<option value="">Select an event…</option>`,
    ...state.events.map((ev) => {
      const selected = ev.id === current ? "selected" : "";
      return `<option value="${escapeHtml(ev.id)}" ${selected}>${escapeHtml(
        `${ev.code} · ${ev.name} · ${ev.event_date}`
      )}</option>`;
    }),
  ];

  els.eventSelect.innerHTML = options.join("");
}

async function loadDrills() {
  state.drillsLoading = true;
  renderDrillList();

  try {
    const { data, error } = await supabaseClient
      .from("drills")
      .select("code,title,description,category")
      .order("code", { ascending: true });

    if (error) throw error;
    state.drills = data ?? [];
  } finally {
    state.drillsLoading = false;
    renderDrillList();
  }
}

async function loadRoster() {
  if (!state.selectedEventId) {
    state.rows = [];
    state.assignByEnroll = {};
    renderBoard();
    setStatus();
    return;
  }

  state.loading = true;
  state.err = "";
  setStatus();

  try {
    const { data, error } = await supabaseClient
      .from("enrollments")
      .select(`
        id,
        coach,
        bike_no,
        group,
        person:people(id,full_name,last_drill_text),
        assignments:assignments(id,enrollment_id,ride_no,drill_code,custom_text,custom_description)
      `)
      .eq("event_id", state.selectedEventId)
      .order("coach", { ascending: true })
      .order("group", { ascending: true, nullsFirst: false })
      .order("bike_no", { ascending: true });

    if (error) throw error;

    state.rows = data ?? [];

    const map = {};
    for (const r of state.rows) {
      const list = r.assignments ?? [];
      const perRide = {};
      for (const a of list) {
        const n = Number(a.ride_no);
        if (!Number.isFinite(n) || n <= 0 || n > 10) continue;
        perRide[n] = a;
      }
      map[r.id] = perRide;
    }

    state.assignByEnroll = map;
  } catch (e) {
    state.err = String(e?.message ?? e ?? "Failed to load roster");
  } finally {
    state.loading = false;
    renderBoard();
    setStatus();
  }
}

function groupedRows() {
  const map = new Map();

  for (const r of state.rows) {
    const key = (r.coach ?? "Unassigned").trim() || "Unassigned";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }

  return Array.from(map.entries());
}

function getRideDisplay(enrollment, rideNo) {
  const perRide = state.assignByEnroll[enrollment.id] ?? {};
  const a = perRide[rideNo];
  const val = a ? assignmentDisplay(a) : "";

  const hasAnySavedAssignments = Object.keys(perRide).length > 0;

  if (rideNo === 1 && !val && !hasAnySavedAssignments && enrollment.person?.last_drill_text) {
    return enrollment.person.last_drill_text;
  }

  return val;
}

function renderBoard() {
  if (!state.selectedEventId) {
    els.board.innerHTML = "";
    return;
  }

  const groups = groupedRows();

  if (!groups.length && !state.loading && !state.err) {
    els.board.innerHTML = "";
    return;
  }

  els.board.innerHTML = groups
    .map(([coach, list]) => {
      const rowsHtml = list
        .map((r) => {
          const rideCells = Array.from({ length: state.maxRideNo }, (_, i) => i + 1)
            .map((rideNo) => {
              const val = getRideDisplay(r, rideNo);
              const isEmpty = !norm(val);

              return `
                <button
                  class="cell ${isEmpty ? "" : "cell-on"}"
                  type="button"
                  data-enrollment-id="${escapeHtml(r.id)}"
                  data-ride-no="${rideNo}"
                >
                  <div class="cell-title">R${rideNo}</div>
                  <div class="cell-val">${escapeHtml(val || "—")}</div>
                </button>
              `;
            })
            .join("");

          return `
            <div class="row">
              <div class="bike">${escapeHtml(r.bike_no ?? "-")}</div>
              <div class="row-main">
                <div class="name">${escapeHtml(r.person?.full_name ?? "(missing person)")}</div>
                <div class="ride-row">${rideCells}</div>
                ${
                  r.person?.last_drill_text
                    ? `<div class="last-drill">Last drill: ${escapeHtml(r.person.last_drill_text)}</div>`
                    : ""
                }
              </div>
            </div>
          `;
        })
        .join("");

      return `
        <section class="group">
          <div class="group-title">${escapeHtml(coach)}</div>
          ${rowsHtml}
        </section>
      `;
    })
    .join("");

  els.board.querySelectorAll(".cell").forEach((btn) => {
    btn.addEventListener("click", () => {
      const enrollmentId = btn.getAttribute("data-enrollment-id");
      const rideNo = Number(btn.getAttribute("data-ride-no"));
      const enrollment = state.rows.find((r) => r.id === enrollmentId);
      if (!enrollment) return;

      const currentVal = getRideDisplay(enrollment, rideNo);
      openEdit(enrollmentId, rideNo, currentVal);
    });
  });
}

function filteredDrills() {
  const q = norm(state.drillSearch).toLowerCase();
  if (!q) return state.drills.slice(0, 60);

  return state.drills
    .filter((d) => {
      const hay = [d.code, d.title ?? "", d.description ?? "", d.category ?? ""]
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    })
    .slice(0, 100);
}

function renderDrillList() {
  const list = filteredDrills();

  els.drillCount.textContent = state.drillsLoading
    ? "Loading drills…"
    : `Drills: ${list.length}`;

  if (state.drillsLoading) {
    els.drillList.innerHTML = `<div class="muted">Loading drills…</div>`;
    return;
  }

  if (!list.length) {
    els.drillList.innerHTML = `<div class="muted">No drills match your search.</div>`;
    return;
  }

  els.drillList.innerHTML = list
    .map((d) => {
      return `
        <button class="drill-item" type="button" data-code="${escapeHtml(d.code)}">
          <div class="drill-item-top">
            <div class="drill-code">${escapeHtml(d.code)}</div>
            ${d.category ? `<div class="drill-category">${escapeHtml(d.category)}</div>` : ""}
          </div>
          ${d.title ? `<div class="drill-title">${escapeHtml(d.title)}</div>` : ""}
          ${d.description ? `<div class="drill-desc">${escapeHtml(d.description)}</div>` : ""}
        </button>
      `;
    })
    .join("");

  els.drillList.querySelectorAll(".drill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-code") || "";
      state.editValue = code;
      state.drillSearch = code;
      state.editCustomDescription = "";
      syncEditFields();
      renderDrillList();
    });
  });
}

function syncEditFields() {
  els.editValue.value = state.editValue;
  els.editCustomDescription.value = state.editCustomDescription;
  els.drillSearch.value = state.drillSearch;
  els.modalTitle.textContent = `Edit Ride ${state.editRideNo}`;
}

function openEdit(enrollmentId, rideNo, currentVal) {
  state.editEnrollmentId = enrollmentId;
  state.editRideNo = rideNo;
  state.editValue = currentVal ?? "";

  const existing = state.assignByEnroll[enrollmentId]?.[rideNo];
  state.editCustomDescription = existing?.custom_description ?? "";
  state.drillSearch = "";

  syncEditFields();
  renderDrillList();

  state.editOpen = true;
  els.editModal.classList.remove("hidden");
}

function closeEdit() {
  state.editOpen = false;
  state.editEnrollmentId = null;
  state.drillSearch = "";
  state.editCustomDescription = "";
  els.editModal.classList.add("hidden");
}

async function upsertAssignment(enrollmentId, rideNo, value, customDescription) {
  const v = norm(value);

  const enrollment = state.rows.find((r) => r.id === enrollmentId);
  const personId = enrollment?.person?.id ?? null;

  if (!v) {
    const { error } = await supabaseClient
      .from("assignments")
      .delete()
      .eq("enrollment_id", enrollmentId)
      .eq("ride_no", rideNo);

    if (error) throw error;
  } else {
    const s = splitDrillValue(v);

    let drill_code = null;
    let custom_text = null;
    let custom_description = null;

    if (s.drill_code) {
      const { data: drillRow, error: drillErr } = await supabaseClient
        .from("drills")
        .select("code")
        .eq("code", s.drill_code)
        .maybeSingle();

      if (drillErr) throw drillErr;

      if (drillRow?.code) {
        drill_code = s.drill_code;
        custom_text = null;
        custom_description = null;
      } else {
        drill_code = null;
        custom_text = v;
        custom_description = norm(customDescription) || null;
      }
    } else {
      drill_code = null;
      custom_text = s.custom_text;
      custom_description = norm(customDescription) || null;
    }

    const { error } = await supabaseClient.from("assignments").upsert(
      {
        enrollment_id: enrollmentId,
        ride_no: rideNo,
        drill_code,
        custom_text,
        custom_description,
      },
      { onConflict: "enrollment_id,ride_no" }
    );

    if (error) throw error;
  }

  if (personId) {
    const { data: updatedAssignments, error: readErr } = await supabaseClient
      .from("assignments")
      .select("id,enrollment_id,ride_no,drill_code,custom_text,custom_description")
      .eq("enrollment_id", enrollmentId)
      .order("ride_no", { ascending: true });

    if (readErr) throw readErr;

    const lastDrillText = latestRideDisplay(updatedAssignments ?? []);

    const { error: peopleErr } = await supabaseClient
      .from("people")
      .update({ last_drill_text: lastDrillText })
      .eq("id", personId);

    if (peopleErr) throw peopleErr;
  }
}

async function handleSaveEdit() {
  if (!state.editEnrollmentId) return;

  try {
    await upsertAssignment(
      state.editEnrollmentId,
      state.editRideNo,
      state.editValue,
      state.editCustomDescription
    );

    closeEdit();
    await loadRoster();
  } catch (e) {
    window.alert(`Save failed: ${String(e?.message ?? e ?? "Unknown error")}`);
  }
}

async function handleCsvFile(file) {
  const text = await file.text();

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors?.length) {
    console.log("CSV parse errors:", parsed.errors);
  }

  const out = [];
  const warns = [];
  let maxRide = 1;

  for (const raw of parsed.data ?? []) {
    if (!raw) continue;
    const row = toCsvRow(raw);

    if (!row.student && !row.coach && !row.bikeNo) continue;

    if (!row.student) warns.push("A row is missing Student name (will be skipped).");
    if (!row.coach) warns.push(`Student "${row.student || "(unknown)"}" has no coach (allowed).`);
    if (!row.bikeNo) warns.push(`Student "${row.student || "(unknown)"}" has no bike # (allowed).`);

    for (const n of Object.keys(row.rides ?? {})) {
      maxRide = Math.max(maxRide, Number(n));
    }

    out.push(row);
  }

  state.csvPreview = out.filter((r) => !!r.student);
  state.csvWarnings = Array.from(new Set(warns));
  state.maxRideNo = Math.max(5, Math.min(10, maxRide));

  setStatus();
  renderBoard();
  window.alert(`CSV loaded: ${out.length} rows parsed.\n\nNext: preview + import.`);
}

async function connectRealtime() {
  if (state.realtimeChannel) {
    await supabaseClient.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }

  if (!state.selectedEventId) return;

  state.realtimeChannel = supabaseClient
    .channel(`rt-rideplan-${state.selectedEventId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "enrollments" }, () => {
      void loadRoster();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, () => {
      void loadRoster();
    })
    .subscribe();
}

function wireEvents() {
  els.eventSelect.addEventListener("change", async (e) => {
    state.selectedEventId = e.target.value;
    await loadRoster();
    await connectRealtime();
  });

  els.refreshBtn.addEventListener("click", async () => {
    await loadRoster();
  });

  els.csvFileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleCsvFile(file);
    e.target.value = "";
  });

  els.editValue.addEventListener("input", (e) => {
    state.editValue = e.target.value.toUpperCase();
  });

  els.editCustomDescription.addEventListener("input", (e) => {
    state.editCustomDescription = e.target.value;
  });

  els.drillSearch.addEventListener("input", (e) => {
    state.drillSearch = e.target.value;
    renderDrillList();
  });

  els.clearTextBtn.addEventListener("click", () => {
    state.editValue = "";
    state.drillSearch = "";
    state.editCustomDescription = "";
    syncEditFields();
    renderDrillList();
  });

  els.cancelBtn.addEventListener("click", () => {
    closeEdit();
  });

  els.saveBtn.addEventListener("click", async () => {
    await handleSaveEdit();
  });

  els.editModal.addEventListener("click", (e) => {
    if (e.target === els.editModal) {
      closeEdit();
    }
  });
}

async function init() {
  wireEvents();

  try {
    await loadEvents();
    await loadDrills();

    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("eventId");

    if (eventId) {
      state.selectedEventId = eventId;
      renderEventSelect();
      await loadRoster();
      await connectRealtime();
    }
  } catch (e) {
    state.err = String(e?.message ?? e ?? "Failed to initialise page");
    setStatus();
  }
}

void init();