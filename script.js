"use strict";

// ---------- Config ----------
const API_BASE_URL = "https://mindmetrics-student-health.onrender.com";
const REQUEST_TIMEOUT_MS = 20000;

// Must match the Literal values in the FastAPI StudentData model exactly.
const PLATFORMS = [
  "Facebook", "LinkedIn", "Instagram", "Snapchat", "Twitter", "YouTube",
  "TikTok", "LINE", "KakaoTalk", "VKontakte", "WhatsApp", "WeChat",
];

// Suggestions only. The backend accepts any string; the model groups non-top countries as "Other".
const COUNTRIES = [
  "India", "USA", "Canada", "Australia", "UK", "Germany", "Mexico", "Turkey",
  "France", "Other",
];

// Gauge scale. ASSUMPTION: score is on a 0–10 scale, higher = better.
// Change these if your training data uses a different range.
const SCORE_MAX = 10;

// ---------- Elements ----------
const form = document.getElementById("predictForm");
const submitBtn = document.getElementById("submitBtn");
const resetBtn = document.getElementById("resetBtn");
const formError = document.getElementById("formError");
const resultCard = document.getElementById("resultCard");
const apiStatus = document.getElementById("apiStatus");
const apiStatusText = document.getElementById("apiStatusText");

// ---------- Setup ----------
function populateOptions() {
  const platformSelect = document.getElementById("most_used_platform");
  PLATFORMS.forEach((p) => platformSelect.add(new Option(p, p)));

  const list = document.getElementById("countryList");
  COUNTRIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    list.appendChild(opt);
  });
}

// ---------- Validation (mirrors the Pydantic constraints) ----------
const RULES = {
  age:                     { type: "int",   min: 10, max: 100, label: "Age" },
  gender:                  { type: "text",  label: "Gender" },
  country:                 { type: "text",  label: "Country" },
  academic_level:          { type: "text",  label: "Academic level" },
  most_used_platform:      { type: "text",  label: "Platform" },
  purpose_of_use:          { type: "text",  label: "Purpose" },
  avg_daily_usage_hours:   { type: "float", min: 0, max: 24, label: "Daily usage" },
  daily_unlocks:           { type: "int",   min: 0, label: "Unlocks" },
  study_hours:             { type: "float", min: 0, max: 24, label: "Study hours" },
  physical_activity_hours: { type: "float", min: 0, max: 24, label: "Physical activity" },
  sleep_hours_per_night:   { type: "float", min: 0, max: 24, label: "Sleep" },
  stress_level:            { type: "text",  label: "Stress level" },
};

function validateField(name, raw) {
  const rule = RULES[name];
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (value === "" || value === null || value === undefined) return "This field is required.";
  if (rule.type === "text") return "";

  const num = Number(value);
  if (Number.isNaN(num)) return "Enter a valid number.";
  if (rule.type === "int" && !Number.isInteger(num)) return "Must be a whole number.";
  if (rule.min !== undefined && num < rule.min) return `Must be at least ${rule.min}.`;
  if (rule.max !== undefined && num > rule.max) return `Must be at most ${rule.max}.`;
  return "";
}

function getFieldContainer(name) {
  const el = form.elements[name];
  const node = el instanceof RadioNodeList ? el[0] : el;
  return node.closest(".field");
}

function setFieldError(name, message) {
  const container = getFieldContainer(name);
  const errEl = container.querySelector(`.err[data-for="${name}"]`);
  container.classList.toggle("invalid", Boolean(message));
  if (errEl) errEl.textContent = message || "";
}

function clearErrors() {
  Object.keys(RULES).forEach((n) => setFieldError(n, ""));
  formError.hidden = true;
  formError.innerHTML = "";
}

function readForm() {
  const fd = new FormData(form);
  const raw = {};
  Object.keys(RULES).forEach((n) => (raw[n] = fd.get(n) ?? ""));
  return raw;
}

function validateAll(raw) {
  let firstInvalid = null;
  Object.keys(RULES).forEach((name) => {
    const msg = validateField(name, raw[name]);
    setFieldError(name, msg);
    if (msg && !firstInvalid) firstInvalid = name;
  });
  return firstInvalid;
}

function buildPayload(raw) {
  const payload = {};
  Object.entries(RULES).forEach(([name, rule]) => {
    const v = String(raw[name]).trim();
    payload[name] = rule.type === "int" ? parseInt(v, 10)
                  : rule.type === "float" ? parseFloat(v)
                  : v;
  });
  return payload;
}

// ---------- Result card rendering ----------
function showLoading() {
  resultCard.className = "result-card loading-state";
  resultCard.innerHTML = `
    <div>
      <div class="skeleton-ring"></div>
      <p class="pulse">Analysing the profile…</p>
    </div>`;
}

function showError(title, message) {
  resultCard.className = "result-card error-state";
  resultCard.innerHTML = `
    <div>
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#d6453d" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

const LOW_CUTOFF = 5.1;
const HIGH_CUTOFF = 7.1;

function interpret(score) {
  if (score >= HIGH_CUTOFF) return { cls: "good", color: "var(--good)", label: "Good", text: "Higher than about 75% of students in the training data." };
  if (score >= LOW_CUTOFF)  return { cls: "mid",  color: "var(--mid)",  label: "Moderate", text: "Around the middle of the range seen in the training data." };
  return { cls: "bad", color: "var(--bad)", label: "Low", text: "Lower than about 75% of students in the training data. Sleep, screen time and stress are worth a look." };
}

function showResult(score) {
  const info = interpret(score);
  const R = 70;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(1, score / SCORE_MAX));

  resultCard.className = "result-card success";
  resultCard.innerHTML = `
    <div>
      <div class="gauge">
        <svg viewBox="0 0 170 170" aria-hidden="true">
          <circle class="track" cx="85" cy="85" r="${R}" fill="none" stroke-width="14"/>
          <circle class="bar" cx="85" cy="85" r="${R}" fill="none" stroke-width="14"
                  stroke-linecap="round" stroke="${info.color}"
                  stroke-dasharray="${C}" stroke-dashoffset="${C}"/>
        </svg>
        <div class="gauge-center">
          <span class="score-num" id="scoreNum">0.00</span>
          <span class="score-max">out of ${SCORE_MAX}</span>
        </div>
      </div>
      <span class="badge ${info.cls}">${info.label}</span>
      <p class="label">Predicted mental health score</p>
      <p class="note">${info.text}</p>
      <p class="note" style="margin-top:8px">Model estimate only, not a diagnosis.</p>
    </div>`;

  // Animate the ring and the number.
  const bar = resultCard.querySelector(".bar");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.strokeDashoffset = C * (1 - clamped);
  }));
  countUp(document.getElementById("scoreNum"), score, 1000);

  if (window.matchMedia("(max-width: 900px)").matches) {
    resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function countUp(el, target, duration) {
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = (target * eased).toFixed(2);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- API ----------
function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle("loading", isLoading);
  submitBtn.querySelector(".btn-label").textContent = isLoading ? "Predicting…" : "Predict score";
}

// Turn FastAPI's 422 detail array into { field: message } plus a fallback list.
function handleValidationError(detail) {
  const unmatched = [];
  if (!Array.isArray(detail)) return [String(detail)];
  detail.forEach((d) => {
    const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
    if (field && RULES[field]) setFieldError(field, d.msg);
    else unmatched.push(d.msg || JSON.stringify(d));
  });
  return unmatched;
}

async function predict(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON body */ }

    if (!res.ok) {
      const err = new Error("API error");
      err.status = res.status;
      err.detail = data && data.detail;
      throw err;
    }
    if (!data || typeof data.predicted_mental_health_score !== "number") {
      throw new Error("The server returned an unexpected response.");
    }
    return data.predicted_mental_health_score;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Events ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors();

  const raw = readForm();
  const firstInvalid = validateAll(raw);
  if (firstInvalid) {
    const el = form.elements[firstInvalid];
    (el instanceof RadioNodeList ? el[0] : el).focus();
    return;
  }

  setLoading(true);
  showLoading();

  try {
    const score = await predict(buildPayload(raw));
    showResult(score);
  } catch (err) {
    if (err.name === "AbortError") {
      showError("Request timed out", "The server took too long to respond. Try again.");
    } else if (err.status === 422) {
      const extra = handleValidationError(err.detail);
      showError("Check your inputs", "Some fields were rejected by the server. See the highlighted fields.");
      if (extra.length) {
        formError.innerHTML = `<ul>${extra.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`;
        formError.hidden = false;
      }
    } else if (err.status >= 500) {
      showError(
        "Server error",
        "The model failed to process this input. A country the model never saw in training is a common cause. Try a country from the suggestions."
      );
    } else if (err.status) {
      showError(`Error ${err.status}`, typeof err.detail === "string" ? err.detail : "The request was rejected.");
    } else if (err instanceof TypeError) {
      showError(
        "Can't reach the server",
        `Make sure the backend is running at ${API_BASE_URL} (uvicorn main:app --reload).`
      );
      setApiStatus(false);
    } else {
      showError("Something went wrong", err.message);
    }
  } finally {
    setLoading(false);
  }
});

// Clear a field's error as soon as the user fixes it.
form.addEventListener("input", (e) => {
  const name = e.target.name;
  if (name && RULES[name]) {
    const container = getFieldContainer(name);
    if (container.classList.contains("invalid")) setFieldError(name, validateField(name, e.target.value));
  }
});

resetBtn.addEventListener("click", () => {
  form.reset();
  clearErrors();
  resultCard.className = "result-card empty";
  resultCard.innerHTML = `
    <div class="placeholder">
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <p>Your prediction will appear here.</p>
    </div>`;
});

// ---------- API health indicator ----------
function setApiStatus(online) {
  apiStatus.classList.toggle("online", online);
  apiStatus.classList.toggle("offline", !online);
  apiStatusText.textContent = online ? "API online" : "API offline";
}

async function checkApi() {
  try {
    const res = await fetch(`${API_BASE_URL}/`, { method: "GET" });
    setApiStatus(res.ok);
  } catch (_) {
    setApiStatus(false);
  }
}

populateOptions();
checkApi();
setInterval(checkApi, 15000);
