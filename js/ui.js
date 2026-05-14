import { signOutUser } from "./auth.js";

export function formatDate(d) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateInput(d) {
  // YYYY-MM-DD for <input type="date">
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseDateInput(str) {
  // "YYYY-MM-DD" → Date at local midnight
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayInput() {
  return formatDateInput(new Date());
}

export function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function renderHeader({ profile, active }) {
  const root = location.pathname.includes("/admin/") ? "../" : "./";
  const isAdmin = profile?.role === "admin";
  const links = isAdmin
    ? [
        { href: `${root}admin/index.html`, label: "Dashboard", key: "dashboard" },
        { href: `${root}admin/students.html`, label: "Students", key: "students" },
        { href: `${root}admin/log-membership.html`, label: "Log membership", key: "log-membership" },
        { href: `${root}admin/log-purchase.html`, label: "Log purchase", key: "log-purchase" },
        { href: `${root}admin/log-used.html`, label: "Log lesson", key: "log-used" },
      ]
    : [
        { href: `${root}dashboard.html`, label: "Dashboard", key: "dashboard" },
        { href: `${root}history.html`, label: "History", key: "history" },
      ];

  const html = `
    <header class="site-header">
      <a class="brand" href="${root}${isAdmin ? "admin/index.html" : "dashboard.html"}">
        <span class="brand-mark">ETT</span>
        <span class="brand-text">Eric Table Tennis</span>
      </a>
      <nav class="nav">
        ${links
          .map(
            (l) =>
              `<a href="${l.href}" class="${l.key === active ? "is-active" : ""}">${l.label}</a>`
          )
          .join("")}
      </nav>
      <div class="user-pill">
        <span class="user-name">${escapeHtml(profile?.displayName || profile?.email || "")}</span>
        <button id="signout-btn" class="btn-link">Sign out</button>
      </div>
    </header>
    <div id="offline-banner" class="offline-banner" hidden>Offline — changes will sync when reconnected</div>
  `;
  const el = document.getElementById("header");
  if (el) el.innerHTML = html;

  document.getElementById("signout-btn")?.addEventListener("click", async () => {
    await signOutUser();
    location.href = `${root}index.html`;
  });

  updateOfflineBanner();
  window.addEventListener("online", updateOfflineBanner);
  window.addEventListener("offline", updateOfflineBanner);
}

function updateOfflineBanner() {
  const el = document.getElementById("offline-banner");
  if (!el) return;
  el.hidden = navigator.onLine;
}

export function showToast(msg, kind = "info") {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = `toast toast-${kind}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.classList.add("toast-out"), 2400);
  setTimeout(() => t.remove(), 2900);
}

// Attach a custom student-search combobox to an <input>. Replaces the
// native <datalist>, whose search behavior is inconsistent across
// browsers (Safari does prefix-only on `value`; Chrome does substring).
// This implementation: case-insensitive substring match across both
// name AND email, mouse + keyboard selection, popup auto-positioned
// under the input.
//
// Returns `(value) => uid|null`. If the value matches a known student
// label exactly, returns the uid; otherwise null.
//
// `datalistEl` is accepted for backward compat (caller can pass null)
// — when supplied, its contents are emptied so the native dropdown
// doesn't conflict with the custom popup.
export function populateStudentTypeahead(inputEl, datalistEl, students) {
  if (datalistEl) datalistEl.innerHTML = "";
  inputEl.removeAttribute("list");

  const items = [];
  const byLabel = new Map();
  for (const s of students) {
    const label = s.displayName ? `${s.displayName} (${s.email})` : s.email;
    if (byLabel.has(label)) continue;
    byLabel.set(label, s.uid);
    items.push({
      label,
      uid: s.uid,
      name: (s.displayName || "").toLowerCase(),
      email: (s.email || "").toLowerCase(),
    });
  }

  const popup = document.createElement("div");
  popup.className = "combo-popup";
  popup.hidden = true;
  inputEl.parentNode.insertBefore(popup, inputEl.nextSibling);

  let activeIndex = -1;
  let visible = [];

  const closePopup = () => {
    popup.hidden = true;
    activeIndex = -1;
  };

  const render = () => {
    const q = (inputEl.value || "").toLowerCase().trim();
    visible = q
      ? items.filter((x) => x.name.includes(q) || x.email.includes(q))
      : items;
    visible = visible.slice(0, 50);

    popup.innerHTML = "";
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "combo-empty";
      empty.textContent = q ? "No matches" : "Start typing…";
      popup.appendChild(empty);
    } else {
      visible.forEach((x, i) => {
        const row = document.createElement("div");
        row.className = "combo-item";
        if (i === activeIndex) row.classList.add("is-active");
        row.textContent = x.label;
        row.addEventListener("mousedown", (ev) => {
          ev.preventDefault(); // don't blur the input before click registers
          inputEl.value = x.label;
          inputEl.dispatchEvent(new Event("change", { bubbles: true }));
          closePopup();
        });
        popup.appendChild(row);
      });
    }
    popup.hidden = false;
  };

  inputEl.addEventListener("focus", render);
  inputEl.addEventListener("input", () => {
    activeIndex = -1;
    render();
  });
  inputEl.addEventListener("blur", () => {
    // Delay so a mousedown on a row registers before we hide.
    setTimeout(closePopup, 120);
  });
  inputEl.addEventListener("keydown", (ev) => {
    if (popup.hidden) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      activeIndex = Math.min(visible.length - 1, activeIndex + 1);
      render();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      render();
    } else if (ev.key === "Enter" && activeIndex >= 0) {
      ev.preventDefault();
      const pick = visible[activeIndex];
      if (pick) {
        inputEl.value = pick.label;
        inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
      closePopup();
    } else if (ev.key === "Escape") {
      closePopup();
    }
  });

  return (typedValue) => byLabel.get((typedValue || "").trim()) || null;
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v != null) {
      node.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}
