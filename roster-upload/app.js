// ====== CONFIG ======
// Put your anon key here (safe-ish), OR remove events dropdown and hardcode events.
const SUPABASE_URL = "https://zfyveyvtafcfkmmfgzjc.supabase.co";
const SUPABASE_ANON = "sb_publishable_MYAyOVxrqvncoLbQ9TKAvQ_EkWEFaoC";

// Your Edge Function URL:
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/import_roster`;

const el = (id) => document.getElementById(id);

console.log("CSS Roster Upload app.js loaded: 20260307-2");

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

function escapeCsvCell(cell) {
  const value = String(cell ?? "");
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeGroupColumnInCsv(csvText) {
  const newline = csvText.includes("\r\n") ? "\r\n" : "\n";
  const lines = csvText.split(/\r?\n/);

  if (!lines.length) return csvText;

  const header = parseCsvLine(lines[0]);
  const groupIndex = header.findIndex((h) => String(h).trim().toLowerCase() === "group");

  // No group column in this upload. Keep payload unchanged.
  if (groupIndex === -1) return csvText;

  const out = [header.map(escapeCsvCell).join(",")];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") {
      out.push("");
      continue;
    }

    const cols = parseCsvLine(line);
    while (cols.length <= groupIndex) cols.push("");

    cols[groupIndex] = String(cols[groupIndex] ?? "").trim().toUpperCase();
    out.push(cols.map(escapeCsvCell).join(","));
  }

  return out.join(newline);
}

function normalizeGroupValue(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function parseCsvRowsForImport(csvText) {
  const lines = String(csvText ?? "").split(/\r?\n/);
  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]);
  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const cols = parseCsvLine(line);
    const row = {};

    for (let j = 0; j < header.length; j++) {
      const key = String(header[j] ?? "").trim();
      if (!key) continue;
      row[key] = String(cols[j] ?? "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(row, "group")) {
      row.group = normalizeGroupValue(row.group);
    }

    out.push(row);
  }

  return out;
}

function todaySydneyYYYYMMDD() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // "YYYY-MM-DD"
}

async function supabaseFetch(path, { method = "GET", body = null } = {}) {
  const url = `${SUPABASE_URL}${path}`;

  const headers = {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${SUPABASE_ANON}`,
    Accept: "application/json",
  };

  if (body) headers["Content-Type"] = "application/json";

  console.log("→ Calling:", url);
  console.log("→ Sending Authorization header");

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
    console.error("Supabase error response:", json);
    throw new Error(
      typeof json === "string"
        ? json
        : json.message || json.error || `Request failed (${res.status})`
    );
  }

  return json;
}

function setStatus(msg) {
  el("status").textContent = msg || "";
}

function setEventStatus(msg) {
  el("eventStatus").textContent = msg || "";
}

function resetPreview() {
  el("preview").style.display = "none";
  el("warningsBox").style.display = "none";
  el("conflictsBox").style.display = "none";
  el("warnings").innerHTML = "";
  el("conflicts").innerHTML = "";
  el("btnCommit").disabled = true;
}

async function loadEvents() {
  setEventStatus("Loading…");
  try {
    const today = todaySydneyYYYYMMDD();

    // events columns: id, event_date, name, code
    // Query: today + future (Sydney date)
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
        const label = `${ev.event_date} — ${ev.name || ""}${ev.code ? ` (${ev.code})` : ""}`;
        opt.textContent = label;
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

function renderConflicts(conflicts) {
  const wrap = el("conflicts");
  wrap.innerHTML = "";

  for (const c of conflicts) {
    const box = document.createElement("div");
    box.className = "conflict";

    const title = document.createElement("div");
    title.className = "conflict-title";
    title.textContent = `Student: ${c.student}`;
    box.appendChild(title);

    const hint = document.createElement("small");
    hint.textContent =
      "This name matches an existing person. Choose whether to use the existing record or create a new person.";
    box.appendChild(hint);

    // Create new option
    const newRow = document.createElement("label");
    newRow.className = "choice";
    newRow.innerHTML = `
      <input type="radio" name="resolve_${c.name_norm}" value="new">
      <b>Create new person</b>
      <small>Use this only if this is a different person with the same or similar name.</small>
    `;
    box.appendChild(newRow);

    for (const m of c.matches) {
      const row = document.createElement("label");
      row.className = "choice";

      const checked = c.matches.length === 1 ? "checked" : "";

      row.innerHTML = `
        <input type="radio" name="resolve_${c.name_norm}" value="use:${m.id}" ${checked}>
        <b>Use existing person</b> — ${m.full_name}
        <small>${m.last_seen_event_date ? `last seen ${m.last_seen_event_date}` : ""}</small>
      `;

      box.appendChild(row);
    }

    wrap.appendChild(box);
  }
}

function collectResolutions(conflicts) {
  const resolutions = {};
  for (const c of conflicts) {
    const chosen = document.querySelector(`input[name="resolve_${c.name_norm}"]:checked`);
    if (!chosen) continue;

    if (chosen.value === "new") {
      resolutions[c.name_norm] = { action: "new" };
    } else if (chosen.value.startsWith("use:")) {
      resolutions[c.name_norm] = {
        action: "use",
        personId: chosen.value.slice(4),
      };
    }
  }
  return resolutions;
}

function wireConflictValidation(conflicts) {
  const commitBtn = el("btnCommit");
  const conflictsBox = el("conflictsBox");

  const check = () => {
    for (const c of conflicts) {
      const chosen = document.querySelector(`input[name="resolve_${c.name_norm}"]:checked`);
      if (!chosen) {
        commitBtn.disabled = true;
        return;
      }
    }
    commitBtn.disabled = false;
  };

  conflictsBox.onchange = (e) => {
    if (e.target && e.target.matches && e.target.matches("input[type=radio]")) {
      check();
    }
  };

  // initial state
  check();
}

async function callImport(mode, payload, password) {
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-import-password": password,
    },
    body: JSON.stringify({ mode, ...payload }),
  });

  const text = await res.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text || "Import failed" };
  }

  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Import failed (${res.status})`);
  }

  return data;
}

let lastPreview = null;

async function preview() {
  resetPreview();
  setStatus("Previewing…");

  const eventId = el("eventSelect").value;
  const pw = el("pw").value || "";
  const file = el("csvFile").files?.[0];

  if (!eventId) return setStatus("Pick an event.");
  if (!file) return setStatus("Choose a CSV.");
  if (!pw) return setStatus("Enter password.");

  try {
    const csvText = normalizeGroupColumnInCsv(await readFileText(file));
    const importRows = parseCsvRowsForImport(csvText);
    const data = await callImport("preview", { eventId, csvText, rows: importRows }, pw);

    lastPreview = {
      eventId,
      csvText,
      rows: importRows,
      conflicts: data.conflicts || [],
    };

    el("preview").style.display = "block";
    el("summary").textContent =
      `Rows: ${data.rowCount} · Rides detected: ${data.maxRideNo} · Conflicts: ${(data.conflicts || []).length}`;

    const warns = data.warnings || [];
    if (warns.length) {
      el("warningsBox").style.display = "block";
      const ul = el("warnings");
      ul.innerHTML = "";

      for (const w of warns) {
        const li = document.createElement("li");
        li.textContent = w;
        ul.appendChild(li);
      }
    }

    const conflicts = data.conflicts || [];
    if (conflicts.length) {
      el("conflictsBox").style.display = "block";
      renderConflicts(conflicts);

      setStatus("Preview ready. Review matched names, then Commit.");
      wireConflictValidation(conflicts);
    } else {
      el("btnCommit").disabled = false;
      setStatus("Preview ready. If all good, Commit.");
    }
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`);
  }
}

async function commit() {
  setStatus("Committing…");
  const pw = el("pw").value || "";

  if (!lastPreview) return setStatus("Run Preview first.");

  try {
    const resolutions = collectResolutions(lastPreview.conflicts);
    const out = await callImport(
      "commit",
      {
        eventId: lastPreview.eventId,
        csvText: lastPreview.csvText,
        rows: lastPreview.rows,
        resolutions,
      },
      pw
    );

    setStatus(
      `Done. Enrollments: ${out.createdEnrollments}, People: ${out.createdPeople}, Assignments: ${out.createdAssignments}`
    );
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`);
  }
}

el("refreshEvents").addEventListener("click", loadEvents);
el("btnPreview").addEventListener("click", preview);
el("btnCommit").addEventListener("click", commit);

loadEvents();
