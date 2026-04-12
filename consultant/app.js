const SUPABASE_URL = "https://zfyveyvtafcfkmmfgzjc.supabase.co";
const SUPABASE_ANON = "sb_publishable_MYAyOVxrqvncoLbQ9TKAvQ_EkWEFaoC";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

const state = {
  loading: false,
  err: "",
  events: [],
  showPastEvents: false,
  selectedEventId: "",
  rows: [],
  assignByEnroll: {},
  ndByPersonId: {},
  drills: [],
  drillsLoading: false,
  csvPreview: null,
  csvWarnings: [],
  maxRideNo: 5,
  hiddenStudentIdsByEvent: {},
  filterModalOpen: false,
  editOpen: false,
  editEnrollmentId: null,
  editRideNo: 1,
  editValue: "",
  editTurnText: "",
  editIsVideo: false,
  editIsBracketing: false,
  editCustomDescription: "",
  editCoachRecommendation: null,
  editRecommendationPending: false,
  editRecommendationConfidence: "",
  editRecommendationConfidenceDetail: "",
  editCoachAudioPending: false,
  editCoachAudioActioned: false,
  editCoachVideoPending: false,
  editCoachVideoActioned: false,
  editCoachAudioPlayed: false,
  editConsultantAudioUrl: "",
  editHiddenMetadataLines: [],
  drillSearch: "",
  realtimeChannel: null,
};

const els = {
  eventSelect: document.getElementById("eventSelect"),
  filterStudentsBtn: document.getElementById("filterStudentsBtn"),
  studentFilterModal: document.getElementById("studentFilterModal"),
  studentFilterList: document.getElementById("studentFilterList"),
  filterSelectAllBtn: document.getElementById("filterSelectAllBtn"),
  filterClearAllBtn: document.getElementById("filterClearAllBtn"),
  filterDoneBtn: document.getElementById("filterDoneBtn"),
  togglePastEventsBtn: document.getElementById("togglePastEventsBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  board: document.getElementById("board"),
  statusArea: document.getElementById("statusArea"),
  csvInfo: document.getElementById("csvInfo"),
  csvFileInput: document.getElementById("csvFileInput"),
  editModal: document.getElementById("editModal"),
    modalTitle: document.getElementById("modalTitle"),
  editValue: document.getElementById("editValue"),
  editTurnText: document.getElementById("editTurnText"),
  editIsVideoBtn: document.getElementById("editIsVideoBtn"),
  editIsBracketingBtn: document.getElementById("editIsBracketingBtn"),
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

function rideLabel(rideNo) {
  return rideNo === 0 ? "N/D" : `R${rideNo}`;
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

/* ===== Coach Recommendation Support ===== */

const COACH_RECOMMENDATION_PREFIX = "[COACH_RECOMMENDATION]";
const COACH_RECOMMENDATION_PENDING_PREFIX = "[COACH_RECOMMENDATION_PENDING]";
const COACH_RECOMMENDATION_CONFIDENCE_PREFIX = "[COACH_RECOMMENDATION_CONFIDENCE]";
const COACH_RECOMMENDATION_CONFIDENCE_DETAIL_PREFIX = "[COACH_RECOMMENDATION_CONFIDENCE_DETAIL]";
const COACH_AUDIO_PENDING_PREFIX = "[COACH_AUDIO_PENDING]";
const COACH_AUDIO_ACTIONED_PREFIX = "[COACH_AUDIO_ACTIONED]";
const COACH_VIDEO_PENDING_PREFIX = "[COACH_VIDEO_PENDING]";
const COACH_VIDEO_ACTIONED_PREFIX = "[COACH_VIDEO_ACTIONED]";
const CONSULTANT_AUDIO_URL_PREFIX = "[CONSULTANT_AUDIO_URL]";
const COACH_RECOMMENDATION_ACTIONED_AT_PREFIX = "[COACH_RECOMMENDATION_ACTIONED_AT]";
const COACH_CONSULTANT_REVIEWED_FOR_PREFIX = "[COACH_CONSULTANT_REVIEWED_FOR]";
const CONSULTANT_VIDEO_ACTIONED_FOR_PREFIX = "[CONSULTANT_VIDEO_ACTIONED_FOR]";

function cleanText(input) {
  return String(input ?? "").replace(/\r\n/g, "\n").trim();
}

function emptyRecommendation() {
  return {
    drill: "",
    turnText: "",
    isVideo: false,
    isBracketing: false,
    note: "",
  };
}

function parseBoolText(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function findMetadataLine(lines, prefix) {
  return lines.find((l) => l.startsWith(prefix)) || "";
}

function metadataLineValue(lines, prefix) {
  const line = findMetadataLine(lines, prefix);
  return line ? line.slice(prefix.length).trim() : "";
}

function isBracketMetadataLine(line) {
  return /^\[[A-Z0-9_]+\](?:\s|$)/.test(String(line ?? "").trim());
}

function isRecommendationJsonPayload(line) {
  const raw = String(line ?? "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return (
      "drill" in parsed ||
      "turnText" in parsed ||
      "note" in parsed ||
      "isVideo" in parsed ||
      "isBracketing" in parsed
    );
  } catch {
    return false;
  }
}

function parseCoachRecommendation(customDescription) {
  const lines = String(customDescription ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const hiddenPrefixes = [
    COACH_RECOMMENDATION_PENDING_PREFIX,
    COACH_RECOMMENDATION_CONFIDENCE_PREFIX,
    COACH_RECOMMENDATION_CONFIDENCE_DETAIL_PREFIX,
    COACH_AUDIO_PENDING_PREFIX,
    COACH_AUDIO_ACTIONED_PREFIX,
    COACH_VIDEO_PENDING_PREFIX,
    COACH_VIDEO_ACTIONED_PREFIX,
    CONSULTANT_AUDIO_URL_PREFIX,
    COACH_RECOMMENDATION_ACTIONED_AT_PREFIX,
    COACH_CONSULTANT_REVIEWED_FOR_PREFIX,
    CONSULTANT_VIDEO_ACTIONED_FOR_PREFIX,
  ];

  const hiddenMetadataLines = [];
  const visibleDescriptionLines = [];
  let coachPayload = "";

  for (const line of lines) {
    if (line.startsWith(COACH_RECOMMENDATION_PREFIX)) {
      coachPayload = line.slice(COACH_RECOMMENDATION_PREFIX.length).trim();
      continue;
    }

    if (hiddenPrefixes.some((p) => line.startsWith(p)) || isBracketMetadataLine(line)) {
      hiddenMetadataLines.push(line);
      continue;
    }

    if (!coachPayload && isRecommendationJsonPayload(line)) {
      coachPayload = line;
      hiddenMetadataLines.push(line);
      continue;
    }

    visibleDescriptionLines.push(line);
  }

  const consultantDescription = visibleDescriptionLines.join("\n").trim();

  const recommendationPending = parseBoolText(
    metadataLineValue(lines, COACH_RECOMMENDATION_PENDING_PREFIX)
  );
  const recommendationConfidence = cleanText(
    metadataLineValue(lines, COACH_RECOMMENDATION_CONFIDENCE_PREFIX)
  );
  const recommendationConfidenceDetail = cleanText(
    metadataLineValue(lines, COACH_RECOMMENDATION_CONFIDENCE_DETAIL_PREFIX)
  );
  const coachAudioPending = parseBoolText(
    metadataLineValue(lines, COACH_AUDIO_PENDING_PREFIX)
  );
  const coachAudioActioned = parseBoolText(
    metadataLineValue(lines, COACH_AUDIO_ACTIONED_PREFIX)
  );
  const coachVideoPending = parseBoolText(
    metadataLineValue(lines, COACH_VIDEO_PENDING_PREFIX)
  );
  const coachVideoActioned = parseBoolText(
    metadataLineValue(lines, COACH_VIDEO_ACTIONED_PREFIX)
  );
  const consultantAudioUrl = cleanText(
    metadataLineValue(lines, CONSULTANT_AUDIO_URL_PREFIX)
  );

  if (!coachPayload) {
    return {
      recommendation: null,
      consultantDescription,
      recommendationPending,
      recommendationConfidence,
      recommendationConfidenceDetail,
      coachAudioPending,
      coachAudioActioned,
      coachVideoPending,
      coachVideoActioned,
      consultantAudioUrl,
      hiddenMetadataLines,
    };
  }

  const payload = coachPayload;

  if (!payload) {
    return {
      recommendation: null,
      consultantDescription,
      recommendationPending,
      recommendationConfidence,
      recommendationConfidenceDetail,
      coachAudioPending,
      coachAudioActioned,
      coachVideoPending,
      coachVideoActioned,
      consultantAudioUrl,
      hiddenMetadataLines,
    };
  }

  if (!payload.startsWith("{")) {
    const note = cleanText(payload);
    return {
      recommendation: note
        ? { ...emptyRecommendation(), note }
        : null,
      consultantDescription,
      recommendationPending,
      recommendationConfidence,
      recommendationConfidenceDetail,
      coachAudioPending,
      coachAudioActioned,
      coachVideoPending,
      coachVideoActioned,
      consultantAudioUrl,
    };
  }

  try {
    const parsed = JSON.parse(payload);

    const recommendation = {
      drill: cleanText(parsed?.drill),
      turnText: cleanText(parsed?.turnText),
      isVideo: !!parsed?.isVideo,
      isBracketing: !!parsed?.isBracketing,
      note: cleanText(parsed?.note),
    };

    const jsonConfidence =
      cleanText(parsed?.confidenceBand) ||
      cleanText(parsed?.confidence) ||
      cleanText(parsed?.confidencePct);
    const jsonConfidenceDetail =
      cleanText(parsed?.confidenceDetail) ||
      cleanText(parsed?.confidenceExplanation) ||
      cleanText(parsed?.confidenceReason);

    const hasAny =
      recommendation.drill ||
      recommendation.turnText ||
      recommendation.note ||
      recommendation.isVideo ||
      recommendation.isBracketing;

    return {
      recommendation: hasAny ? recommendation : null,
      consultantDescription,
      recommendationPending,
      recommendationConfidence: recommendationConfidence || jsonConfidence,
      recommendationConfidenceDetail:
        recommendationConfidenceDetail || jsonConfidenceDetail,
      coachAudioPending,
      coachAudioActioned,
      coachVideoPending,
      coachVideoActioned,
      consultantAudioUrl,
      hiddenMetadataLines,
    };
  } catch {
    const note = cleanText(payload);
    return {
      recommendation: note
        ? { ...emptyRecommendation(), note }
        : null,
      consultantDescription,
      recommendationPending,
      recommendationConfidence,
      recommendationConfidenceDetail,
      coachAudioPending,
      coachAudioActioned,
      coachVideoPending,
      coachVideoActioned,
      consultantAudioUrl,
      hiddenMetadataLines,
    };
  }
}

function buildCustomDescriptionWithCoachRecommendation(
  consultantDescription,
  recommendation,
  metadata = {}
) {
  const cleanConsultant = cleanText(consultantDescription);

  const hasRecommendation =
    recommendation &&
    (cleanText(recommendation.drill) ||
      cleanText(recommendation.turnText) ||
      cleanText(recommendation.note) ||
      recommendation.isVideo ||
      recommendation.isBracketing);

  const coachLine = hasRecommendation
    ? `${COACH_RECOMMENDATION_PREFIX} ${JSON.stringify({
        drill: cleanText(recommendation.drill),
        turnText: cleanText(recommendation.turnText),
        isVideo: !!recommendation.isVideo,
        isBracketing: !!recommendation.isBracketing,
        note: cleanText(recommendation.note),
      })}`
    : "";

  const metadataLines = [];
  if (metadata.recommendationPending) {
    metadataLines.push(`${COACH_RECOMMENDATION_PENDING_PREFIX} true`);
  }
  if (cleanText(metadata.recommendationConfidence)) {
    metadataLines.push(
      `${COACH_RECOMMENDATION_CONFIDENCE_PREFIX} ${cleanText(metadata.recommendationConfidence)}`
    );
  }
  if (cleanText(metadata.recommendationConfidenceDetail)) {
    metadataLines.push(
      `${COACH_RECOMMENDATION_CONFIDENCE_DETAIL_PREFIX} ${cleanText(
        metadata.recommendationConfidenceDetail
      )}`
    );
  }
  if (metadata.coachAudioPending) {
    metadataLines.push(`${COACH_AUDIO_PENDING_PREFIX} true`);
  }
  if (metadata.coachAudioActioned) {
    metadataLines.push(`${COACH_AUDIO_ACTIONED_PREFIX} true`);
  }
  if (metadata.coachVideoPending) {
    metadataLines.push(`${COACH_VIDEO_PENDING_PREFIX} true`);
  }
  if (metadata.coachVideoActioned) {
    metadataLines.push(`${COACH_VIDEO_ACTIONED_PREFIX} true`);
  }
  if (cleanText(metadata.consultantAudioUrl)) {
    metadataLines.push(
      `${CONSULTANT_AUDIO_URL_PREFIX} ${cleanText(metadata.consultantAudioUrl)}`
    );
  }

  const preservedHiddenMetadataLines = Array.isArray(metadata.hiddenMetadataLines)
    ? metadata.hiddenMetadataLines.filter(
        (line) =>
          line &&
          !line.startsWith(COACH_RECOMMENDATION_PREFIX) &&
          !hiddenPrefixesForBuild().some((prefix) => line.startsWith(prefix)) &&
          !isRecommendationJsonPayload(line)
      )
    : [];

  const out = [cleanConsultant, coachLine, ...metadataLines, ...preservedHiddenMetadataLines]
    .filter(Boolean)
    .join("\n")
    .trim();

  return out || null;
}

function hiddenPrefixesForBuild() {
  return [
    COACH_RECOMMENDATION_PENDING_PREFIX,
    COACH_RECOMMENDATION_CONFIDENCE_PREFIX,
    COACH_RECOMMENDATION_CONFIDENCE_DETAIL_PREFIX,
    COACH_AUDIO_PENDING_PREFIX,
    COACH_AUDIO_ACTIONED_PREFIX,
    COACH_VIDEO_PENDING_PREFIX,
    COACH_VIDEO_ACTIONED_PREFIX,
    CONSULTANT_AUDIO_URL_PREFIX,
    COACH_RECOMMENDATION_ACTIONED_AT_PREFIX,
    COACH_CONSULTANT_REVIEWED_FOR_PREFIX,
    CONSULTANT_VIDEO_ACTIONED_FOR_PREFIX,
  ];
}

async function loadEvents() {
  const today = new Date().toISOString().slice(0, 10);

  let query = supabaseClient
    .from("events")
    .select("id,code,name,event_date")
    .order("event_date", { ascending: true });

  if (!state.showPastEvents) {
    query = query.gte("event_date", today);
  }

  const { data, error } = await query;

  if (error) throw error;

  state.events = data ?? [];
  renderEventSelect();
  renderPastEventsToggle();
}

function renderPastEventsToggle() {
  if (!els.togglePastEventsBtn) return;

  els.togglePastEventsBtn.textContent = state.showPastEvents
    ? "Hide past events"
    : "Show past events";
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
    state.ndByPersonId = {};
    renderBoard();
    renderStudentFilterList();
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
        group,
        bike_no,
        person_id,
        event:events(id,event_date),
        person:people(id,full_name,last_drill_text),
        assignments:assignments(id,enrollment_id,ride_no,drill_code,turn_text,is_video,is_bracketing,custom_text,custom_description,coach_audio_url)
      `)
      .eq("event_id", state.selectedEventId)
      .order("coach", { ascending: true })
      .order("bike_no", { ascending: true });

    if (error) throw error;

    state.rows = (data ?? []).slice().sort(compareEnrollmentRows);

    const map = {};
    for (const r of state.rows) {
      const list = r.assignments ?? [];
      const perRide = {};
      for (const a of list) {
        const n = Number(a.ride_no);
        if (!Number.isFinite(n) || n < 0 || n > 10) continue;
        perRide[n] = a;
      }
      map[r.id] = perRide;
    }

    state.assignByEnroll = map;
    ensureHiddenStudentIdsForEvent();
    renderStudentFilterList();
    await loadPreviousNdFallbacks();
  } catch (e) {
    state.err = String(e?.message ?? e ?? "Failed to load roster");
  } finally {
    state.loading = false;
    renderBoard();
    setStatus();
  }
}

async function loadPreviousNdFallbacks() {
  if (!state.selectedEventId) {
    state.ndByPersonId = {};
    return;
  }

  try {
    const { data: eventRow, error: eventErr } = await supabaseClient
      .from("events")
      .select("id,event_date")
      .eq("id", state.selectedEventId)
      .maybeSingle();

    if (eventErr) throw eventErr;

    const currentEventDate = eventRow?.event_date;
    if (!currentEventDate) {
      state.ndByPersonId = {};
      return;
    }

    const personIds = Array.from(
      new Set(
        (state.rows ?? [])
          .map((r) => r.person?.id || r.person_id)
          .filter(Boolean)
      )
    );

    if (!personIds.length) {
      state.ndByPersonId = {};
      return;
    }

    const { data: prevAssignments, error: prevErr } = await supabaseClient
      .from("assignments")
      .select(`
        ride_no,
        drill_code,
        custom_text,
        enrollment:enrollments!inner(
          person_id,
          event:events!inner(event_date)
        )
      `)
      .eq("ride_no", 0)
      .in("enrollment.person_id", personIds)
      .lt("enrollment.event.event_date", currentEventDate);

    if (prevErr) throw prevErr;

    const bestByPerson = {};

    for (const row of prevAssignments ?? []) {
      const personId = row?.enrollment?.person_id;
      const eventDate = row?.enrollment?.event?.event_date;
      const text = norm(row?.drill_code) || norm(row?.custom_text);

      if (!personId || !eventDate || !text) continue;

      const existing = bestByPerson[personId];
      if (!existing || eventDate > existing.event_date) {
        bestByPerson[personId] = { event_date: eventDate, text };
      }
    }

    const map = {};
    for (const [personId, info] of Object.entries(bestByPerson)) {
      map[personId] = info.text;
    }

    state.ndByPersonId = map;
  } catch (e) {
    console.log("Failed to load previous N/D fallbacks:", e?.message ?? e);
    state.ndByPersonId = {};
  }
}

function groupedRows() {
  const map = new Map();
  const orderedRows = state.rows.slice().sort(compareEnrollmentRows);
  const visibleRows = getVisibleRows(orderedRows);

  for (const r of visibleRows) {
    const key = (r.coach ?? "Unassigned").trim() || "Unassigned";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }

  const groups = Array.from(map.entries()).sort(([coachA], [coachB]) =>
    compareText(coachA, coachB)
  );

  return groups.map(([coach, list]) => [coach, list]);
}

const GROUP_ORDER = { W: 0, Y: 1, G: 2 };
const GROUP_THEME = {
  W: { className: "student-group-w", label: "W" },
  Y: { className: "student-group-y", label: "Y" },
  G: { className: "student-group-g", label: "G" },
};
const DEFAULT_GROUP_THEME = { className: "student-group-default", label: "—" };

function compareText(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function bikeSortValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { isNumeric: false, numeric: Number.POSITIVE_INFINITY, text: "" };
  if (/^\d+$/.test(raw)) {
    return { isNumeric: true, numeric: Number(raw), text: raw };
  }
  return { isNumeric: false, numeric: Number.POSITIVE_INFINITY, text: raw };
}

function normalizeStudentGroup(value) {
  const g = String(value ?? "").trim().toUpperCase();
  return GROUP_ORDER[g] === undefined ? "" : g;
}

function compareEnrollmentRows(a, b) {
  const groupA = normalizeStudentGroup(a.group);
  const groupB = normalizeStudentGroup(b.group);
  const rankA = GROUP_ORDER[groupA] ?? Number.POSITIVE_INFINITY;
  const rankB = GROUP_ORDER[groupB] ?? Number.POSITIVE_INFINITY;
  if (rankA !== rankB) return rankA - rankB;

  const bikeA = bikeSortValue(a.bike_no);
  const bikeB = bikeSortValue(b.bike_no);

  if (bikeA.isNumeric && bikeB.isNumeric && bikeA.numeric !== bikeB.numeric) {
    return bikeA.numeric - bikeB.numeric;
  }
  if (bikeA.isNumeric !== bikeB.isNumeric) {
    return bikeA.isNumeric ? -1 : 1;
  }

  const bikeTextCmp = compareText(bikeA.text, bikeB.text);
  if (bikeTextCmp !== 0) return bikeTextCmp;

  const coachCmp = compareText(a.coach ?? "Unassigned", b.coach ?? "Unassigned");
  if (coachCmp !== 0) return coachCmp;

  return compareText(a.person?.full_name ?? "", b.person?.full_name ?? "");
}

function studentFilterStorageKey(eventId) {
  return `consultant.hiddenStudents.${eventId}`;
}

function readHiddenStudentIds(eventId) {
  if (!eventId) return new Set();
  try {
    const raw = window.localStorage.getItem(studentFilterStorageKey(eventId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(Boolean).map((v) => String(v)));
  } catch {
    return new Set();
  }
}

function writeHiddenStudentIds(eventId) {
  if (!eventId) return;
  const set = state.hiddenStudentIdsByEvent[eventId] ?? new Set();
  window.localStorage.setItem(studentFilterStorageKey(eventId), JSON.stringify(Array.from(set)));
}

function ensureHiddenStudentIdsForEvent() {
  const eventId = state.selectedEventId;
  if (!eventId) return;
  if (!state.hiddenStudentIdsByEvent[eventId]) {
    state.hiddenStudentIdsByEvent[eventId] = readHiddenStudentIds(eventId);
  }

  const validIds = new Set(
    state.rows
      .map((r) => String(r.person?.id ?? r.person_id ?? ""))
      .filter(Boolean)
  );

  const next = new Set();
  for (const id of state.hiddenStudentIdsByEvent[eventId]) {
    if (validIds.has(id)) next.add(id);
  }
  state.hiddenStudentIdsByEvent[eventId] = next;
  writeHiddenStudentIds(eventId);
}

function getVisibleRows(rows) {
  const eventId = state.selectedEventId;
  if (!eventId) return rows;
  const hiddenSet = state.hiddenStudentIdsByEvent[eventId] ?? new Set();
  if (!hiddenSet.size) return rows;

  return rows.filter((r) => {
    const personId = String(r.person?.id ?? r.person_id ?? "");
    return personId && !hiddenSet.has(personId);
  });
}

function getRideDisplay(enrollment, rideNo) {
  const perRide = state.assignByEnroll[enrollment.id] ?? {};
  const a = perRide[rideNo];
  const val = a ? assignmentDisplay(a) : "";

  const hasAnySavedAssignments = Object.keys(perRide).length > 0;

  if (rideNo === 1 && !val && !hasAnySavedAssignments) {
    const personId = enrollment.person?.id ?? enrollment.person_id;

    if (personId && state.ndByPersonId[personId]) {
      return state.ndByPersonId[personId];
    }

    if (enrollment.person?.last_drill_text) {
      return enrollment.person.last_drill_text;
    }
  }

  return val;
}

function hasRideRecommendation(enrollmentId, rideNo) {
  const assignment = state.assignByEnroll[enrollmentId]?.[rideNo];
  if (!assignment) return false;

  const parsed = parseCoachRecommendation(assignment?.custom_description);
  return !!parsed.recommendation;
}

function hasRideRecommendationPending(enrollmentId, rideNo) {
  const assignment = state.assignByEnroll[enrollmentId]?.[rideNo];
  if (!assignment) return false;
  const parsed = parseCoachRecommendation(assignment?.custom_description);
  return !!parsed.recommendationPending;
}

function hasRideAudio(enrollmentId, rideNo) {
  const assignment = state.assignByEnroll[enrollmentId]?.[rideNo];
  if (!assignment) return false;
  const parsed = parseCoachRecommendation(assignment?.custom_description);
  return !!assignment?.coach_audio_url || !!parsed.coachAudioPending;
}

function hasRideVideoPending(enrollmentId, rideNo) {
  const assignment = state.assignByEnroll[enrollmentId]?.[rideNo];
  if (!assignment) return false;
  const parsed = parseCoachRecommendation(assignment?.custom_description);
  return !!parsed.coachVideoPending;
}

async function resolveCoachAudioPlaybackUrl(storedValue) {
  const value = String(storedValue ?? "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;

  const { data, error } = await supabaseClient.storage
    .from("coach-audio")
    .createSignedUrl(value, 60 * 60 * 8) // 8 hours

  if (error) throw error;
  return data?.signedUrl ?? "";
}

async function resolveConsultantAudioPlaybackUrl(storedValue) {
  const value = String(storedValue ?? "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;

  const { data, error } = await supabaseClient.storage
    .from("consultant-audio")
    .createSignedUrl(value, 60 * 60 * 8);

  if (error) throw error;
  return data?.signedUrl ?? "";
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
          const studentGroup = normalizeStudentGroup(r.group);
          const theme = GROUP_THEME[studentGroup] ?? DEFAULT_GROUP_THEME;
          const rideCells = [...Array.from({ length: state.maxRideNo }, (_, i) => i + 1), 0]
  .map((rideNo) => {
              const val = getRideDisplay(r, rideNo);
const isEmpty = !norm(val);

const hasRecommendation = hasRideRecommendation(r.id, rideNo);
const hasRecommendationPending = hasRideRecommendationPending(r.id, rideNo);
const hasAudio = hasRideAudio(r.id, rideNo);
const hasVideoPending = hasRideVideoPending(r.id, rideNo);

const displayText = val || (hasRecommendation ? "REC" : "—");

const icons = `
  ${hasRecommendation ? `<span class="cell-icon rec">⭐</span>` : ""}
  ${hasAudio ? `<span class="cell-icon audio">🔊</span>` : ""}
  ${hasVideoPending ? `<span class="cell-icon video">📹</span>` : ""}
`;

return `
  <button
    class="cell ${isEmpty ? "" : "cell-on"} ${hasRecommendationPending ? "cell-rec" : ""}"
                  type="button"
                  data-enrollment-id="${escapeHtml(r.id)}"
                  data-ride-no="${rideNo}"
                >
                  <div class="cell-title">${rideLabel(rideNo)}</div>
                  <div class="cell-val">${escapeHtml(displayText)}</div>
<div class="cell-icons">${icons}</div>
                </button>
              `;
            })
            .join("");

          return `
            <div class="row ${theme.className}">
              <div class="bike">${escapeHtml(r.bike_no ?? "-")}</div>
              <div class="row-main">
                <div class="name">
                  ${escapeHtml(r.person?.full_name ?? "(missing person)")}
                  <span class="group-pill">${escapeHtml(theme.label)}</span>
                </div>
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

function filterStudentsSortedRows() {
  return state.rows.slice().sort(compareEnrollmentRows);
}

function isStudentVisible(personId) {
  const eventId = state.selectedEventId;
  if (!eventId) return true;
  const hiddenSet = state.hiddenStudentIdsByEvent[eventId] ?? new Set();
  return !hiddenSet.has(String(personId));
}

function renderStudentFilterList() {
  if (!els.studentFilterList) return;

  if (!state.selectedEventId) {
    els.studentFilterList.innerHTML = `<div class="muted">Select an event first.</div>`;
    return;
  }

  const rows = filterStudentsSortedRows();
  if (!rows.length) {
    els.studentFilterList.innerHTML = `<div class="muted">No students available for this event.</div>`;
    return;
  }

  els.studentFilterList.innerHTML = rows
    .map((row) => {
      const personId = String(row.person?.id ?? row.person_id ?? "");
      const checked = isStudentVisible(personId) ? "checked" : "";
      const name = row.person?.full_name ?? "(missing person)";
      const coach = (row.coach ?? "Unassigned").trim() || "Unassigned";

      return `
        <label class="student-filter-item">
          <input type="checkbox" data-person-id="${escapeHtml(personId)}" ${checked} />
          <span>${escapeHtml(name)}</span>
          <span class="student-filter-meta">${escapeHtml(`${coach} · Bike ${row.bike_no ?? "-"}`)}</span>
        </label>
      `;
    })
    .join("");

  els.studentFilterList.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.addEventListener("change", () => {
      const eventId = state.selectedEventId;
      if (!eventId) return;
      ensureHiddenStudentIdsForEvent();
      const hiddenSet = state.hiddenStudentIdsByEvent[eventId];
      const personId = cb.getAttribute("data-person-id") || "";

      if (cb.checked) {
        hiddenSet.delete(personId);
      } else {
        hiddenSet.add(personId);
      }

      writeHiddenStudentIds(eventId);
      renderBoard();
    });
  });
}

function setAllStudentsVisible(visible) {
  const eventId = state.selectedEventId;
  if (!eventId) return;
  ensureHiddenStudentIdsForEvent();

  if (visible) {
    state.hiddenStudentIdsByEvent[eventId] = new Set();
  } else {
    state.hiddenStudentIdsByEvent[eventId] = new Set(
      state.rows
        .map((r) => String(r.person?.id ?? r.person_id ?? ""))
        .filter(Boolean)
    );
  }

  writeHiddenStudentIds(eventId);
  renderStudentFilterList();
  renderBoard();
}

function openStudentFilterModal() {
  state.filterModalOpen = true;
  renderStudentFilterList();
  els.studentFilterModal.classList.remove("hidden");
}

function closeStudentFilterModal() {
  state.filterModalOpen = false;
  els.studentFilterModal.classList.add("hidden");
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
    
    function syncToggleButtons() {
      els.editIsVideoBtn.classList.toggle("toggle-chip-on", !!state.editIsVideo);
      els.editIsBracketingBtn.classList.toggle("toggle-chip-on", !!state.editIsBracketing);
    }
    function renderCoachRecommendation() {
  const box = document.getElementById("coachRecommendationBox");
  const content = document.getElementById("coachRecommendationContent");

  if (!box || !content) return;

  const rec = state.editCoachRecommendation;

  if (!rec) {
    box.classList.add("hidden");
    content.innerHTML = "";
    return;
  }

  const lines = [];

  if (rec.drill) lines.push(`<div class="coach-rec-line">Drill: ${escapeHtml(rec.drill)}</div>`);
  if (rec.turnText) lines.push(`<div class="coach-rec-line">Turn(s): ${escapeHtml(rec.turnText)}</div>`);
  if (rec.isVideo) lines.push(`<div class="coach-rec-line">Video</div>`);
  if (rec.isBracketing) lines.push(`<div class="coach-rec-line">Bracketing</div>`);
  if (rec.note) lines.push(`<div class="coach-rec-line">Note: ${escapeHtml(rec.note)}</div>`);

  content.innerHTML = lines.join("");
  box.classList.remove("hidden");
}

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

function syncToggleButtons() {
  els.editIsVideoBtn.classList.toggle("toggle-chip-on", !!state.editIsVideo);
  els.editIsBracketingBtn.classList.toggle("toggle-chip-on", !!state.editIsBracketing);
}

function renderCoachRecommendation() {
  const box = document.getElementById("coachRecommendationBox");
  const content = document.getElementById("coachRecommendationContent");
  const confidence = document.getElementById("coachRecommendationConfidence");
  const confidenceDetail = document.getElementById("coachRecommendationConfidenceDetail");

  if (!box || !content || !confidence || !confidenceDetail) return;

  const rec = state.editCoachRecommendation;

  if (!rec) {
    box.classList.add("hidden");
    content.innerHTML = "";
    confidence.textContent = "";
    confidence.classList.add("hidden");
    confidenceDetail.textContent = "";
    confidenceDetail.classList.add("hidden");
    return;
  }

  const lines = [];

  if (rec.drill) {
    lines.push(`<div class="coach-rec-line">Drill: ${escapeHtml(rec.drill)}</div>`);
  }
  if (rec.turnText) {
    lines.push(`<div class="coach-rec-line">Turn(s): ${escapeHtml(rec.turnText)}</div>`);
  }
  if (rec.isVideo) {
    lines.push(`<div class="coach-rec-line">Video</div>`);
  }
  if (rec.isBracketing) {
    lines.push(`<div class="coach-rec-line">Bracketing</div>`);
  }
  if (rec.note) {
    lines.push(`<div class="coach-rec-line">Note: ${escapeHtml(rec.note)}</div>`);
  }

  content.innerHTML = lines.join("");
  if (state.editRecommendationConfidence) {
    confidence.textContent = `Confidence: ${state.editRecommendationConfidence}`;
    confidence.classList.remove("hidden");
  } else {
    confidence.textContent = "";
    confidence.classList.add("hidden");
  }

  if (state.editRecommendationConfidenceDetail) {
    confidenceDetail.textContent = state.editRecommendationConfidenceDetail;
    confidenceDetail.classList.remove("hidden");
  } else {
    confidenceDetail.textContent = "";
    confidenceDetail.classList.add("hidden");
  }
  box.classList.remove("hidden");
}

async function renderCoachAudio() {
  const box = document.getElementById("coachAudioBox");
  const player = document.getElementById("coachAudioPlayer");
  const videoRow = document.getElementById("coachVideoReviewedRow");
  const videoCheck = document.getElementById("coachVideoReviewed");

  if (!box || !player || !videoRow || !videoCheck || !state.editEnrollmentId) return;

  const enrollmentId = state.editEnrollmentId;
  const rideNo = state.editRideNo;
  const assignment = state.assignByEnroll[enrollmentId]?.[rideNo];
  const audioUrl = assignment?.coach_audio_url || "";
  const hasVideoPending = !!state.editCoachVideoPending;
  videoCheck.checked = !!state.editCoachVideoActioned;
  videoRow.classList.toggle("hidden", !hasVideoPending);

  if (!audioUrl) {
    player.pause();
    player.removeAttribute("src");
    player.load();
    box.classList.toggle("hidden", !hasVideoPending);
    return;
  }

  try {
    const playbackUrl = await resolveCoachAudioPlaybackUrl(audioUrl);

    if (state.editEnrollmentId !== enrollmentId || state.editRideNo !== rideNo) {
      return;
    }

    if (!playbackUrl) {
      throw new Error("Missing signed audio URL");
    }

    player.pause();
    player.src = playbackUrl;
    player.load();
    box.classList.remove("hidden");
  } catch (e) {
    console.error("Failed to resolve coach audio playback URL:", e);
    player.pause();
    player.removeAttribute("src");
    player.load();
    box.classList.toggle("hidden", !hasVideoPending);
  }
}

async function renderConsultantAudio() {
  const box = document.getElementById("consultantAudioBox");
  const player = document.getElementById("consultantAudioPlayer");
  if (!box || !player) return;

  if (!state.editConsultantAudioUrl) {
    player.pause();
    player.removeAttribute("src");
    player.load();
    box.classList.add("hidden");
    return;
  }

  try {
    const playbackUrl = await resolveConsultantAudioPlaybackUrl(state.editConsultantAudioUrl);
    if (!playbackUrl) throw new Error("Missing consultant playback url");
    player.pause();
    player.src = playbackUrl;
    player.load();
    box.classList.remove("hidden");
  } catch (e) {
    console.error("Failed to resolve consultant audio URL:", e);
    box.classList.add("hidden");
  }
}

async function uploadConsultantAudio(file) {
  const ext = (file.name.split(".").pop() || "webm").toLowerCase();
  const key = `${state.editEnrollmentId}/${state.editRideNo}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${ext}`;

  const { error } = await supabaseClient.storage
    .from("consultant-audio")
    .upload(key, file, { upsert: true, contentType: file.type || "audio/webm" });

  if (error) throw error;
  state.editConsultantAudioUrl = key;
  await renderConsultantAudio();
}

function syncEditFields() {
  els.editValue.value = state.editValue;
  els.editTurnText.value = state.editTurnText;
  els.editCustomDescription.value = state.editCustomDescription;
  els.drillSearch.value = state.drillSearch;
  els.modalTitle.textContent = `Edit ${rideLabel(state.editRideNo)}`;
  syncToggleButtons();
  renderCoachRecommendation();
  renderCoachAudio();
  renderConsultantAudio();
}

function openEdit(enrollmentId, rideNo, currentVal) {
  state.editEnrollmentId = enrollmentId;
  state.editRideNo = rideNo;
  state.editValue = currentVal ?? "";

  const existing = state.assignByEnroll[enrollmentId]?.[rideNo];

const parsed = parseCoachRecommendation(existing?.custom_description);

state.editTurnText = existing?.turn_text ?? "";
state.editIsVideo = !!existing?.is_video;
state.editIsBracketing = !!existing?.is_bracketing;

state.editCustomDescription = parsed.consultantDescription;
state.editCoachRecommendation = parsed.recommendation;
state.editRecommendationPending = !!parsed.recommendationPending;
state.editRecommendationConfidence = parsed.recommendationConfidence || "";
state.editRecommendationConfidenceDetail = parsed.recommendationConfidenceDetail || "";
state.editCoachAudioPending = !!parsed.coachAudioPending;
state.editCoachAudioActioned = !!parsed.coachAudioActioned;
state.editCoachVideoPending = !!parsed.coachVideoPending;
state.editCoachVideoActioned = !!parsed.coachVideoActioned;
state.editCoachAudioPlayed = false;
state.editConsultantAudioUrl = parsed.consultantAudioUrl || "";
state.editHiddenMetadataLines = parsed.hiddenMetadataLines || [];

state.drillSearch = "";

  syncEditFields();
  renderDrillList();

  state.editOpen = true;
  els.editModal.classList.remove("hidden");
}

function closeEdit() {
  state.editOpen = false;
  state.editEnrollmentId = null;
  state.editValue = "";
  state.editTurnText = "";
  state.editIsVideo = false;
  state.editIsBracketing = false;
  state.drillSearch = "";
  state.editCustomDescription = "";
  state.editCoachRecommendation = null;
  state.editRecommendationPending = false;
  state.editRecommendationConfidence = "";
  state.editRecommendationConfidenceDetail = "";
  state.editCoachAudioPending = false;
  state.editCoachAudioActioned = false;
  state.editCoachVideoPending = false;
  state.editCoachVideoActioned = false;
  state.editCoachAudioPlayed = false;
  state.editConsultantAudioUrl = "";
  state.editHiddenMetadataLines = [];

  const player = document.getElementById("coachAudioPlayer");
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load();
  }

  els.editModal.classList.add("hidden");
}

async function upsertAssignment(
  enrollmentId,
  rideNo,
  value,
  turnText,
  isVideo,
  isBracketing,
  customDescription
) {
  const v = norm(value);

  const existing = state.assignByEnroll[enrollmentId]?.[rideNo] ?? null;
const parsedExisting = parseCoachRecommendation(existing?.custom_description);

const mergedCustomDescription = buildCustomDescriptionWithCoachRecommendation(
  norm(customDescription) || null,
  parsedExisting.recommendation,
  {
    recommendationPending: state.editRecommendationPending && !!parsedExisting.recommendation,
    recommendationConfidence: parsedExisting.recommendationConfidence,
    recommendationConfidenceDetail: parsedExisting.recommendationConfidenceDetail,
    coachAudioPending: state.editCoachAudioPending,
    coachAudioActioned: state.editCoachAudioActioned,
    coachVideoPending: state.editCoachVideoPending,
    coachVideoActioned: state.editCoachVideoActioned,
    consultantAudioUrl: state.editConsultantAudioUrl,
    hiddenMetadataLines: state.editHiddenMetadataLines,
  }
);

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
        turn_text: norm(turnText) || null,
        is_video: !!isVideo,
        is_bracketing: !!isBracketing,
        custom_text,
        custom_description: mergedCustomDescription,
      },
      { onConflict: "enrollment_id,ride_no" }
    );

    if (error) throw error;
  }

  if (personId) {
        const { data: updatedAssignments, error: readErr } = await supabaseClient
      .from("assignments")
            .select("id,enrollment_id,ride_no,drill_code,turn_text,is_video,is_bracketing,custom_text,custom_description,coach_audio_url")
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
    if (state.editRecommendationPending) {
      state.editRecommendationPending = false;
    }
    if (state.editCoachAudioPending && state.editCoachAudioPlayed) {
      state.editCoachAudioPending = false;
      state.editCoachAudioActioned = true;
    }
    if (state.editCoachVideoPending && state.editCoachVideoActioned) {
      state.editCoachVideoPending = false;
    }

    await upsertAssignment(
      state.editEnrollmentId,
      state.editRideNo,
      state.editValue,
      state.editTurnText,
      state.editIsVideo,
      state.editIsBracketing,
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

  els.togglePastEventsBtn.addEventListener("click", async () => {
    state.showPastEvents = !state.showPastEvents;
    await loadEvents();
  });

  els.refreshBtn.addEventListener("click", async () => {
    await loadRoster();
  });

  els.filterStudentsBtn.addEventListener("click", () => {
    openStudentFilterModal();
  });

  els.filterSelectAllBtn.addEventListener("click", () => {
    setAllStudentsVisible(true);
  });

  els.filterClearAllBtn.addEventListener("click", () => {
    setAllStudentsVisible(false);
  });

  els.filterDoneBtn.addEventListener("click", () => {
    closeStudentFilterModal();
  });

  els.studentFilterModal.addEventListener("click", (e) => {
    if (e.target === els.studentFilterModal) {
      closeStudentFilterModal();
    }
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

  els.editTurnText.addEventListener("input", (e) => {
    state.editTurnText = e.target.value.toUpperCase();
  });

  els.editIsVideoBtn.addEventListener("click", () => {
    state.editIsVideo = !state.editIsVideo;
    syncToggleButtons();
  });

  els.editIsBracketingBtn.addEventListener("click", () => {
    state.editIsBracketing = !state.editIsBracketing;
    syncToggleButtons();
  });

  els.editCustomDescription.addEventListener("input", (e) => {
    state.editCustomDescription = e.target.value;
  });

  const coachAudioPlayer = document.getElementById("coachAudioPlayer");
  if (coachAudioPlayer) {
    coachAudioPlayer.addEventListener("play", () => {
      state.editCoachAudioPlayed = true;
    });
  }

  const coachVideoReviewed = document.getElementById("coachVideoReviewed");
  if (coachVideoReviewed) {
    coachVideoReviewed.addEventListener("change", (e) => {
      state.editCoachVideoActioned = !!e.target.checked;
    });
  }

  const consultantAudioUpload = document.getElementById("consultantAudioUpload");
  if (consultantAudioUpload) {
    consultantAudioUpload.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file || !state.editEnrollmentId) return;
      try {
        await uploadConsultantAudio(file);
      } catch (err) {
        window.alert(`Consultant audio upload failed: ${String(err?.message ?? err ?? "Unknown")}`);
      } finally {
        e.target.value = "";
      }
    });
  }

  els.drillSearch.addEventListener("input", (e) => {
    state.drillSearch = e.target.value;
    renderDrillList();
  });

  els.clearTextBtn.addEventListener("click", () => {
    state.editValue = "";
    state.editTurnText = "";
    state.editIsVideo = false;
    state.editIsBracketing = false;
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
    renderPastEventsToggle();
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
