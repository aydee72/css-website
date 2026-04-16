const SUPABASE_URL = "https://zfyveyvtafcfkmmfgzjc.supabase.co";
const SUPABASE_ANON = "sb_publishable_MYAyOVxrqvncoLbQ9TKAvQ_EkWEFaoC";

const el = (id) => document.getElementById(id);

function setStatus(msg) {
  el("status").textContent = msg || "";
}

function setEventStatus(msg) {
  el("eventStatus").textContent = msg || "";
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current);
  return cells;
}

function todaySydneyYYYYMMDD() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

async function supabaseFetch(path, { method = "GET", body = null, prefer = null } = {}) {
  const url = `${SUPABASE_URL}${path}`;

  const headers = {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${SUPABASE_ANON}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (prefer) {
    headers["Prefer"] = prefer;
  }

  const res = await fetch(url, {
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
    console.error("Supabase error:", json);
    throw new Error(
      typeof json === "string"
        ? json
        : json.message || json.error || `Request failed (${res.status})`
    );
  }

  return json;
}

async function loadEvents() {
  setEventStatus("Loading…");

  try {
    const today = todaySydneyYYYYMMDD();
    const q =
      `/rest/v1/events?select=id,event_date,name,code&event_date=gte.${today}&order=event_date.asc`;
    const events = await supabaseFetch(q);

    const sel = el("eventSelect");
    sel.innerHTML = "";

    if (!events.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No future events found";
      sel.appendChild(opt);
    } else {
      for (const ev of events) {
        const opt = document.createElement("option");
        opt.value = ev.id;
        opt.textContent = `${ev.event_date} — ${ev.name || ""}${ev.code ? ` (${ev.code})` : ""}`;
        sel.appendChild(opt);
      }
    }

    setEventStatus(`${events.length} events`);
  } catch (e) {
    console.error(e);
    setEventStatus(`Error: ${e.message}`);
  }
}

async function readFileText(file) {
  return await file.text();
}

function normalizeGroupValue(value) {
  const trimmed = String(value ?? "").trim().toUpperCase();
  return trimmed || null;
}

function buildStudentName(first, last) {
  return [String(first || "").trim(), String(last || "").trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function normalizeStudentKey(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseCourseControlCsv(csvText) {
  const lines = String(csvText ?? "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]).map((h) => String(h ?? "").trim());
  const headerMap = Object.fromEntries(header.map((h, i) => [h.toLowerCase(), i]));

  const required = ["coach", "no.", "first", "last", "bike", "level", "group"];
  for (const key of required) {
    if (!(key in headerMap)) {
      throw new Error(`Missing required CSV header: ${key}`);
    }
  }

  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);

    const coachName = String(cols[headerMap["coach"]] ?? "").trim();
    const bike = String(cols[headerMap["no."]] ?? "").trim();
    const first = String(cols[headerMap["first"]] ?? "").trim();
    const last = String(cols[headerMap["last"]] ?? "").trim();
    const bikeModel = String(cols[headerMap["bike"]] ?? "").trim();
    const level = String(cols[headerMap["level"]] ?? "").trim();
    const groupCode = normalizeGroupValue(cols[headerMap["group"]]);
    const studentName = buildStudentName(first, last);

    if (!bike && !studentName && !coachName) {
      continue;
    }

    out.push({
  slot_order: i,
  coach_name: coachName || null,
  bike: bike || null,
  student_name: studentName || null,
  bike_model: bikeModel || null,
  level: level || null,
  group_code: groupCode,
  orientation_out: false,
  ride1_out: false,
  ride2_out: false,
  ride3_out: false,
  ride4_out: false,
  ride5_out: false,
});
  }

  return out;
}

let lastPreview = null;

async function preview() {
  setStatus("Previewing…");
  el("preview").style.display = "none";
  el("btnCommit").disabled = true;
  el("previewList").innerHTML = "";

  try {
    const eventId = el("eventSelect").value;
    const file = el("csvFile").files?.[0];

    if (!eventId) {
      setStatus("Pick an event.");
      return;
    }

    if (!file) {
      setStatus("Choose a CSV.");
      return;
    }

    const csvText = await readFileText(file);
    const rows = parseCourseControlCsv(csvText);

    lastPreview = { eventId, rows };

    el("preview").style.display = "block";
    el("summary").textContent = `${rows.length} student rows ready for upload`;

    const ul = el("previewList");
    ul.innerHTML = "";

    rows.slice(0, 20).forEach((row) => {
      const li = document.createElement("li");
      li.textContent = `${row.coach_name || "-"} · ${row.bike || "-"} · ${row.student_name || ""} · ${row.level || ""} · ${row.group_code || "-"}`;
      ul.appendChild(li);
    });

    if (rows.length > 20) {
      const li = document.createElement("li");
      li.textContent = `…and ${rows.length - 20} more`;
      ul.appendChild(li);
    }

    el("btnCommit").disabled = rows.length === 0;
    setStatus("Preview ready.");
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`);
  }
}

async function commit() {
  if (!lastPreview) {
    setStatus("Run Preview first.");
    return;
  }

  const { eventId, rows } = lastPreview;

  try {
    setStatus("Syncing Course Control students…");

    const existing = await supabaseFetch(
      `/rest/v1/course_control_students?event_id=eq.${eventId}&select=*`
    );

    const rideStateByStudent = {};
    existing.forEach((row) => {
      const key = normalizeStudentKey(row.student_name);
      if (!key) return;

      rideStateByStudent[key] = {
  orientation_out: row.orientation_out ?? false,
  ride1_out: row.ride1_out ?? false,
  ride2_out: row.ride2_out ?? false,
  ride3_out: row.ride3_out ?? false,
  ride4_out: row.ride4_out ?? false,
  ride5_out: row.ride5_out ?? false,
};
    });

    const existingBySlot = {};
    existing.forEach((row) => {
      const slot = Number(row.slot_order);
      if (Number.isFinite(slot)) {
        existingBySlot[slot] = row;
      }
    });

    const incomingSlots = new Set(rows.map((r) => r.slot_order));

    for (const row of rows) {
      const existingRow = existingBySlot[row.slot_order];
      const studentKey = normalizeStudentKey(row.student_name);
      const savedRideState = studentKey ? rideStateByStudent[studentKey] : null;

      const payload = {
  event_id: eventId,
  slot_order: row.slot_order,
  coach_name: row.coach_name,
  bike: row.bike,
  student_name: row.student_name,
  bike_model: row.bike_model,
  level: row.level,
  group_code: row.group_code,
  updated_at: new Date().toISOString(),
  orientation_out: savedRideState?.orientation_out ?? false,
  ride1_out: savedRideState?.ride1_out ?? false,
  ride2_out: savedRideState?.ride2_out ?? false,
  ride3_out: savedRideState?.ride3_out ?? false,
  ride4_out: savedRideState?.ride4_out ?? false,
  ride5_out: savedRideState?.ride5_out ?? false,
};

      if (existingRow) {
        await supabaseFetch(
          `/rest/v1/course_control_students?id=eq.${existingRow.id}`,
          {
            method: "PATCH",
            body: payload,
            prefer: "return=minimal",
          }
        );
      } else {
        await supabaseFetch(`/rest/v1/course_control_students`, {
          method: "POST",
          body: payload,
          prefer: "return=minimal",
        });
      }
    }

    for (const row of existing) {
      const slot = Number(row.slot_order);
      if (!incomingSlots.has(slot)) {
        await supabaseFetch(
          `/rest/v1/course_control_students?id=eq.${row.id}`,
          {
            method: "DELETE",
            prefer: "return=minimal",
          }
        );
      }
    }

    setStatus(`Done. Synced ${rows.length} students (slot order preserved, ride state follows student).`);
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`);
  }
}

el("refreshEvents").addEventListener("click", loadEvents);
el("btnPreview").addEventListener("click", preview);
el("btnCommit").addEventListener("click", commit);

loadEvents();