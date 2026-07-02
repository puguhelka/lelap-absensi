// ── STATUS LABELS ──
const statusLabels = [
  "Hadir Lengkap", "Belum Absen", "Hanya Masuk", "Hanya Pulang",
  "Telat", "Izin", "Sakit", "Cuti",
  "Absensi Tidak Lengkap", "Libur Shift"
];
const statusLabelMap = {
  "hadir_lengkap": "Hadir Lengkap",
  "belum_absen": "Belum Absen",
  "hanya_masuk": "Hanya Masuk",
  "hanya_pulang": "Hanya Pulang",
  "telat": "Telat",
  "izin": "Izin",
  "sakit": "Sakit",
  "cuti": "Cuti",
  "absensi_tidak_lengkap": "Absensi Tidak Lengkap",
  "libur_shift": "Libur Shift"
};
function labelStatus(s) { return statusLabelMap[s] || s || "Belum Absen"; }

// ── CACHE ──
let _employees = [];
let _shifts = [];

// ── STATE ──
const today = new Date();
const state = {
  view: "dashboard",
  selectedDate: today.toISOString().slice(0, 10),
  selectedMonth: today.getMonth(),
  selectedYear: today.getFullYear(),
  detailKey: null,
  attendanceRecords: [],
  auditLogs: []
};

// ── VIEWS ──
const views = {
  dashboard: { title: "Dashboard Ringkasan", element: "dashboardView" },
  daily: { title: "Monitoring Harian", element: "dailyView" },
  monthly: { title: "Monitoring Bulanan", element: "monthlyView" },
  records: { title: "Data Absensi", element: "recordsView" },
  employees: { title: "Data Karyawan", element: "employeesView" },
  shifts: { title: "Jadwal Shift", element: "shiftsView" },
  leave: { title: "Izin / Sakit / Cuti", element: "leaveView" },
  reports: { title: "Laporan & Export", element: "reportsView" },
  settings: { title: "Pengaturan", element: "settingsView" },
  audit: { title: "Audit Log", element: "auditView" }
};

// ── AUTH ──
function adminAuthHeaders() {
  const token = localStorage.getItem("lelapAdminToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authFetch(url, options = {}) {
  const headers = { ...adminAuthHeaders(), ...options.headers };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("lelapAdminToken");
    window.location.href = "/absensi/login";
    return null;
  }
  return res;
}

// ── DATA LOADER ──
async function loadAllData() {
  try {
    const [emps, shfs] = await Promise.all([
      authFetch("/absensi/api/admin/employees").then(r => r && r.ok ? r.json() : []),
      authFetch("/absensi/api/admin/shifts").then(r => r && r.ok ? r.json() : [])
    ]);
    _employees = emps || [];
    _shifts = shfs || [];
  } catch (e) {
    console.error("Gagal muat data:", e);
  }
}

// ── HELPERS ──
function getEmployee(id) {
  return _employees.find(e => e.id === id) || { id, name: "—", fullName: "—", position: "—", defaultShiftId: null };
}
function getShift(id) {
  return _shifts.find(s => s.id === id) || { id, name: "—", start: "—", end: "—", tolerance: 0 };
}
function monthNames() {
  return ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
}
function daysInMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }
function dateKey(year, monthIndex, day) { return `${year}-${pad(monthIndex + 1)}-${pad(day)}`; }
function pad(v) { return String(v).padStart(2, "0"); }
function isSunday(dateStr) { return new Date(dateStr + "T12:00:00").getDay() === 0; }
function dayName(dateStr) { return ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"][new Date(dateStr + "T12:00:00").getDay()]; }
function formatLongDate(dateStr) {
  const [y,m,d] = dateStr.split("-");
  return `${Number(d)} ${monthNames()[Number(m)-1]} ${y}`;
}
function nowStamp() {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}`;
}

// ── BOOT ──
document.addEventListener("DOMContentLoaded", async () => {
  hydrateControls();
  bindEvents();
  await loadAllData();
  // Refresh dropdowns that depend on loaded data
  fillShiftSelect("dailyShift");
  fillCorrectionStatus();
  await renderAll();
});

function hydrateControls() {
  document.getElementById("globalDate").value = state.selectedDate;
  document.getElementById("yearInput").value = state.selectedYear;
  document.getElementById("monthSelect").innerHTML = monthNames()
    .map((n, i) => `<option value="${i}">${n}</option>`).join("");
  document.getElementById("monthSelect").value = String(state.selectedMonth);
  fillStatusSelect("dailyStatus");
  fillStatusSelect("monthlyStatus");
  fillShiftSelect("dailyShift");
  fillCorrectionStatus();
}

function bindEvents() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  document.getElementById("sidebarToggle").addEventListener("click", () => {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("open");
  });
  overlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
  });
  document.querySelectorAll(".nav-item").forEach(b => {
    b.addEventListener("click", () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("open");
      setView(b.dataset.view);
    });
  });
  document.querySelectorAll("[data-shortcut]").forEach(b => {
    b.addEventListener("click", () => {
      setView(b.dataset.shortcut);
      if (b.dataset.status) document.getElementById("dailyStatus").value = b.dataset.status;
      if (b.dataset.homecare) document.getElementById("dailyHomecare").checked = true;
      renderDaily();
    });
  });
  document.getElementById("globalDate").addEventListener("change", e => {
    state.selectedDate = e.target.value;
    renderAll();
  });
  ["dailySearch","dailyStatus","dailyShift","dailyHomecare","dailyLate","dailyReview"]
    .forEach(id => document.getElementById(id).addEventListener("input", renderDaily));
  ["monthSelect","yearInput","monthlySearch","monthlyStatus","monthlyHomecare","monthlyReview"]
    .forEach(id => document.getElementById(id).addEventListener("input", () => {
      state.selectedMonth = Number(document.getElementById("monthSelect").value);
      state.selectedYear = Number(document.getElementById("yearInput").value);
      renderMonthly();
    }));
  document.getElementById("exportCurrent").addEventListener("click", exportCurrentView);
  document.getElementById("logoutAdmin").addEventListener("click", logoutAdmin);
  document.getElementById("closeDetail").addEventListener("click", closeDetail);
  document.getElementById("closeCorrection").addEventListener("click", closeCorrection);
  document.getElementById("openCorrection").addEventListener("click", openCorrection);
  document.getElementById("detailExport").addEventListener("click", exportDetail);
  document.getElementById("correctionForm").addEventListener("submit", saveCorrection);
  document.getElementById("addEmployee").addEventListener("click", () => {
    document.getElementById("addEmployeeForm").reset();
    document.getElementById("empJoinedDate").value = new Date().toISOString().slice(0, 10);
    document.getElementById("addEmployeeModal").style.display = "flex";
  });
  document.getElementById("cancelAddEmployee").addEventListener("click", () => {
    document.getElementById("addEmployeeModal").style.display = "none";
  });
  document.getElementById("addEmployeeModal").addEventListener("click", e => {
    if (e.target.id === "addEmployeeModal") document.getElementById("addEmployeeModal").style.display = "none";
  });
  document.getElementById("addEmployeeForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = document.getElementById("saveAddEmployee");
    btn.disabled = true;
    btn.textContent = "Menyimpan...";
    try {
      const payload = {
        fullName: document.getElementById("empFullName").value.trim(),
        email: document.getElementById("empEmail").value.trim(),
        password: document.getElementById("empPassword").value,
        position: document.getElementById("empPosition").value.trim() || undefined,
        phone: document.getElementById("empPhone").value.trim() || undefined,
        employeeCode: document.getElementById("empCode").value.trim() || undefined,
        joinedDate: document.getElementById("empJoinedDate").value || undefined,
        notes: document.getElementById("empNotes").value.trim() || undefined
      };
      const res = await authFetch("/absensi/api/admin/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = res ? await res.json() : {};
      if (res && res.ok) {
        alert("✅ Karyawan berhasil ditambahkan!");
        document.getElementById("addEmployeeModal").style.display = "none";
        await loadAllData();
        renderEmployees();
        if (state.view === "dashboard") renderDashboard();
      } else {
        alert(`❌ ${data.message || "Gagal menambahkan karyawan."}`);
      }
    } catch { alert("❌ Gagal terhubung ke server."); }
    finally { btn.disabled = false; btn.textContent = "Simpan"; }
  });
  document.getElementById("resetDevice").addEventListener("click", () => {
    alert("Pilih karyawan lalu klik Reset Device ID.");
  });
  document.getElementById("deleteCancelBtn").addEventListener("click", hideDeleteModal);
  document.getElementById("deleteModal").addEventListener("click", e => {
    if (e.target.id === "deleteModal") hideDeleteModal();
  });
  document.getElementById("deleteConfirmInput").addEventListener("input", e => {
    document.getElementById("deleteConfirmBtn").disabled = e.target.value !== "HAPUS";
  });
  document.getElementById("deleteConfirmBtn").addEventListener("click", () => {
    if (deleteTargetId !== null) confirmDeleteEmployee();
    else if (bulkDeleteIds.length > 0) confirmBulkDelete();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") hideDeleteModal(); });
  document.getElementById("selectAllEmployees").addEventListener("change", e => {
    document.querySelectorAll(".employee-checkbox").forEach(cb => cb.checked = e.target.checked);
    updateBulkDeleteButton();
  });
  document.getElementById("bulkDeleteEmployee").addEventListener("click", showBulkDeleteModal);
  document.getElementById("addShift").addEventListener("click", () => {
    alert("Tambah shift akan terhubung ke POST /api/admin/shifts.");
  });
  document.getElementById("copySchedule").addEventListener("click", () => {
    alert("Copy jadwal akan dibuat setelah modul kalender shift aktif.");
  });
  document.getElementById("addLeave").addEventListener("click", showLeaveModal);
  document.getElementById("closeLeaveModal").addEventListener("click", hideLeaveModal);
  document.getElementById("cancelLeaveBtn").addEventListener("click", hideLeaveModal);
  document.getElementById("leaveForm").addEventListener("submit", saveLeave);
}

// ── RENDER ALL ──
async function renderAll() {
  await loadAllData();
  await Promise.all([
    renderDashboard(),
    renderDaily(),
    renderMonthly()
  ]);
  renderEmployees();
  renderShifts();
  renderRecords();
  renderLeave();
  renderReports();
  renderSettings();
  renderAudit();
}

// ── VIEW RENDER MAP ──
const viewRenderers = {
  dashboard: renderDashboard,
  daily: renderDaily,
  monthly: renderMonthly,
  records: renderRecords,
  employees: renderEmployees,
  shifts: renderShifts,
  leave: renderLeave,
  reports: renderReports,
  settings: renderSettings,
  audit: renderAudit
};

function setView(view) {
  state.view = view;
  document.getElementById("pageTitle").textContent = views[view].title;
  document.querySelectorAll(".nav-item").forEach(i => i.classList.toggle("active", i.dataset.view === view));
  document.querySelectorAll(".view").forEach(s => s.classList.remove("active"));
  document.getElementById(views[view].element).classList.add("active");
  const renderFn = viewRenderers[view];
  if (renderFn) renderFn();
}

// ── DASHBOARD ──
async function renderDashboard() {
  const date = state.selectedDate;
  try {
    const res = await authFetch(`/absensi/api/admin/dashboard-summary?date=${date}`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const c = data.counts || {};
    const metrics = [
      ["Total aktif", c.total || _employees.filter(e => e.status === "active").length, "Karyawan"],
      ["Hadir lengkap", c.hadir_lengkap || 0, "Selesai masuk dan pulang"],
      ["Belum absen", c.belum_absen || 0, "Tidak ada absen hari ini"],
      ["Telat", c.telat || 0, "Masuk lewat toleransi"],
      ["Tidak lengkap", c.absensi_tidak_lengkap || 0, "Butuh cek admin"],
      ["Homecare", data.homecare || 0, "Di luar kantor"],
      ["Hanya masuk", c.hanya_masuk || 0, "Belum pulang"],
      ["Hanya pulang", c.hanya_pulang || 0, "Tidak normal"],
      ["Izin", c.izin || 0, "Disetujui admin"],
      ["Sakit", c.sakit || 0, "Tercatat"],
      ["Cuti", c.cuti || 0, "Tercatat"],
      ["Perlu review", data.needsReview || 0, "Fake GPS/data risiko"]
    ];
    document.getElementById("metricGrid").innerHTML = metrics
      .map(([l, v, n]) => `<article class="metric-card"><button type="button" data-metric="${l}"><span class="metric-label">${l}</span><div class="metric-value">${v}</div><span class="metric-note">${n}</span></button></article>`)
      .join("");
    document.querySelectorAll("[data-metric]").forEach(b => b.addEventListener("click", () => setView("daily")));
    const noShow = (data.employeesWithoutSummary || []).map(e => ({ employeeId: e.id, status: "Belum Absen", key: `${e.id}-${date}` }));
    renderPersonList("missingCheckIn", noShow);
    renderPersonList("lateList", []);
    renderPersonList("homecareList", []);
  } catch (e) { console.error("Dashboard error:", e); }
}

// ── DAILY ──
async function renderDaily() {
  const date = state.selectedDate;
  try {
    const res = await authFetch(`/absensi/api/admin/attendance/daily?date=${date}`);
    if (!res || !res.ok) {
      document.getElementById("dailyRows").innerHTML = `<tr><td colspan="11" class="empty-state">Gagal memuat data harian.</td></tr>`;
      return;
    }
    let items = await res.json();
    const search = (document.getElementById("dailySearch").value || "").toLowerCase();
    const statusF = document.getElementById("dailyStatus").value;
    const shiftF = document.getElementById("dailyShift").value;
    const homecareF = document.getElementById("dailyHomecare").checked;
    const lateF = document.getElementById("dailyLate").checked;
    const reviewF = document.getElementById("dailyReview").checked;
    if (search || statusF || shiftF || homecareF || lateF || reviewF) {
      items = (items || []).filter(item => {
        const emp = item.employee || {};
        const s = item.summary || {};
        return (!search || (emp.fullName || "").toLowerCase().includes(search)) &&
          (!statusF || labelStatus(s.dailyStatus) === statusF) &&
          (!shiftF || String(item.shift?.id || "") === shiftF) &&
          (!homecareF || s.isHomecare) &&
          (!lateF || s.isLate) &&
          (!reviewF || s.needsReview);
      });
    }
    const target = document.getElementById("dailyRows");
    if (!items || !items.length) {
      target.innerHTML = `<tr><td colspan="11" class="empty-state">Tidak ada data sesuai filter.</td></tr>`;
      return;
    }
    target.innerHTML = items.map(item => {
      const emp = item.employee || {};
      const s = item.summary || {};
      const shift = item.shift || {};
      return `<tr>
        <td><strong>${emp.fullName || "—"}</strong><br><span class="muted">${emp.position || "—"}</span></td>
        <td>${shift.name || "—"}</td>
        <td>${statusBadge({ status: labelStatus(s.dailyStatus), isLate: s.isLate, isHomecare: s.isHomecare, needsReview: s.needsReview })}</td>
        <td>${s.checkInTime || "-"}</td>
        <td>-</td>
        <td>${s.isHomecare ? "Homecare" : "Kantor"}</td>
        <td>${s.checkOutTime || "-"}</td>
        <td>-</td>
        <td>-</td>
        <td>${s.adminNote || s.homecareNote || "-"}</td>
        <td><button class="button" type="button" data-detail="${emp.id}-${date}">Detail</button></td>
      </tr>`;
    }).join("");
    bindDetailButtons();
  } catch (e) {
    console.error("Daily error:", e);
    document.getElementById("dailyRows").innerHTML = `<tr><td colspan="11" class="empty-state">Error memuat data.</td></tr>`;
  }
}

// ── MONTHLY ──
async function renderMonthly() {
  const month = state.selectedMonth + 1;
  const year = state.selectedYear;
  const days = daysInMonth(year, state.selectedMonth);
  const dayHeaders = Array.from({ length: days }, (_, i) => `<th class="day-cell">${i + 1}</th>`).join("");
  document.getElementById("monthlyHead").innerHTML = `<tr><th>Karyawan</th>${dayHeaders}<th>Hadir</th><th>Telat</th><th>Tdk Lngkp</th><th>Blm Absen</th><th>Izin</th><th>Sakit</th><th>Cuti</th><th>Homecare</th><th>Review</th></tr>`;
  try {
    const res = await authFetch(`/absensi/api/admin/attendance/monthly?month=${month}&year=${year}`);
    if (!res || !res.ok) {
      document.getElementById("monthlyRows").innerHTML = `<tr><td class="empty-state" colspan="${days + 10}">Gagal memuat data bulanan.</td></tr>`;
      return;
    }
    const data = await res.json();
    const monthRows = data.rows || [];
    const search = (document.getElementById("monthlySearch").value || "").toLowerCase();
    const statusF = document.getElementById("monthlyStatus").value;
    const homecareF = document.getElementById("monthlyHomecare").checked;
    const reviewF = document.getElementById("monthlyReview").checked;

    let filtered = monthRows;
    if (search || statusF || homecareF || reviewF) {
      filtered = monthRows.filter(item => {
        const emp = item.employee;
        const days = item.days || [];
        return (!search || emp.fullName.toLowerCase().includes(search)) &&
          (!statusF || days.some(d => labelStatus(d.status) === statusF)) &&
          (!homecareF || days.some(d => d.homecare)) &&
          (!reviewF || days.some(d => d.needsReview));
      });
    }

    const rows = filtered.map(item => {
      const emp = item.employee;
      const days = item.days || [];
      const counts = days.reduce((acc, d) => {
        const st = d.status || "belum_absen";
        if (st === "hadir_lengkap" && !d.isLate) acc.complete++;
        else if (st === "belum_absen") acc.missing++;
        else if (st === "telat" || d.isLate) acc.late++;
        else if (["absensi_tidak_lengkap","hanya_masuk","hanya_pulang"].includes(st)) acc.incomplete++;
        else if (st === "izin") acc.izin++;
        else if (st === "sakit") acc.sakit++;
        else if (st === "cuti") acc.cuti++;
        if (d.homecare) acc.homecare++;
        if (d.needsReview) acc.review++;
        return acc;
      }, { complete: 0, missing: 0, late: 0, incomplete: 0, izin: 0, sakit: 0, cuti: 0, homecare: 0, review: 0 });
      const dayCells = days.map(d => {
        const st = d.status || "belum_absen";
        const codeMap = { hadir_lengkap: "OK", telat: "T", absensi_tidak_lengkap: "!", hanya_masuk: "M", hanya_pulang: "P", belum_absen: "X", izin: "I", sakit: "S", cuti: "C", libur_shift: "L" };
        const code = d.needsReview ? "R" : (codeMap[st] || "-");
        const cls = (() => { if (d.needsReview) return "review"; if (d.homecare) return "homecare"; if (d.isLate || st === "telat") return "late"; if (["hanya_masuk","hanya_pulang","absensi_tidak_lengkap"].includes(st)) return "incomplete"; if (st === "belum_absen") return "missing"; if (["izin","sakit","cuti","libur_shift"].includes(st)) return "leave"; return "complete"; })();
        return `<td class="day-cell"><button class="day-button" type="button" title="${emp.fullName} | ${d.date} | ${labelStatus(st)}" data-detail="${emp.id}-${d.date}"><span class="day-code ${cls}">${code}</span></button></td>`;
      }).join("");
      return `<tr><td><strong>${emp.fullName}</strong><br><span class="muted">${getShift(emp.defaultShiftId).name}</span></td>${dayCells}<td class="summary-number">${counts.complete}</td><td class="summary-number">${counts.late}</td><td class="summary-number">${counts.incomplete}</td><td class="summary-number">${counts.missing}</td><td class="summary-number">${counts.izin}</td><td class="summary-number">${counts.sakit}</td><td class="summary-number">${counts.cuti}</td><td class="summary-number">${counts.homecare}</td><td class="summary-number">${counts.review}</td></tr>`;
    });
    document.getElementById("monthlyRows").innerHTML = rows.length ? rows.join("") : `<tr><td class="empty-state" colspan="${days + 10}">Tidak ada data sesuai filter.</td></tr>`;
    bindDetailButtons();
  } catch (e) {
    document.getElementById("monthlyRows").innerHTML = `<tr><td class="empty-state" colspan="${days + 10}">Error memuat data.</td></tr>`;
  }
}

// ── EMPLOYEES (from API) ──
function renderEmployees() {
  if (!localStorage.getItem("lelapAdminToken")) return;
  const rows = _employees.length ? _employees.map(emp => `
    <tr>
      <td><input type="checkbox" class="employee-checkbox" value="${emp.id}"></td>
      <td><strong>${emp.fullName}</strong><br><span class="muted">${emp.joinedDate}</span></td>
      <td>${emp.email || "—"}</td>
      <td>${emp.phone || "—"}</td>
      <td>${emp.position || "—"}</td>
      <td>${emp.shiftName || "—"}</td>
      <td>${emp.registeredDeviceId ? emp.registeredDeviceId : "<span class='muted'>Belum terdaftar</span>"}</td>
      <td><span class="badge ${emp.status === "active" ? "complete" : "missing"}">${emp.status === "active" ? "Aktif" : "Nonaktif"}</span></td>
      <td><button class="button danger small" type="button" data-delete-id="${emp.id}" data-delete-name="${emp.fullName}">Hapus</button></td>
    </tr>`).join("") : `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)">Belum ada data karyawan.</td></tr>`;
  document.getElementById("employeeRows").innerHTML = rows;
  document.querySelectorAll("[data-delete-id]").forEach(btn => btn.addEventListener("click", () => showDeleteModal(Number(btn.dataset.deleteId), btn.dataset.deleteName)));
  document.querySelectorAll(".employee-checkbox").forEach(cb => cb.addEventListener("change", updateBulkDeleteButton));
  updateBulkDeleteButton();
}

// ── SHIFTS ──
function renderShifts() {
  document.getElementById("shiftRows").innerHTML = _shifts.map(s => {
    const assigned = _employees.filter(e => e.defaultShiftId === s.id);
    return `<tr><td><strong>${s.name}</strong></td><td>${s.start}</td><td>${s.end}</td><td>${s.tolerance} menit</td><td>${s.days}</td><td>${assigned.map(e => e.fullName).join(", ") || "-"}</td><td><span class="badge ${s.active ? "complete" : "missing"}">${s.active ? "Aktif" : "Nonaktif"}</span></td></tr>`;
  }).join("");
}

// ── RECORDS ──
async function renderRecords() {
  const search = (document.getElementById("recordsSearch")?.value || "").toLowerCase();
  const from = document.getElementById("recordsFrom")?.value || "";
  const to = document.getElementById("recordsTo")?.value || "";
  const type = document.getElementById("recordsType")?.value || "";
  try {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const res = await authFetch(`/absensi/api/admin/attendance/records?${params}`);
    if (!res || !res.ok) throw new Error("Gagal");
    let items = await res.json();
    if (search) items = items.filter(r => getEmployee(r.employeeId)?.fullName?.toLowerCase().includes(search));
    if (type) items = items.filter(r => r.type === type);
    document.getElementById("recordsRows").innerHTML = items.length
      ? items.slice(0, 100).map((r, i) => {
          const emp = getEmployee(r.employeeId);
          return `<tr><td>${i + 1}</td><td><strong>${emp?.fullName || "—"}</strong></td><td><span class="badge ${r.type === "check_in" ? "complete" : "late"}">${r.type === "check_in" ? "Masuk" : "Pulang"}</span></td><td>${r.date}</td><td>${r.time || "—"}</td><td>${r.day || "—"}</td><td>${r.photo ? "<div class='photo-thumb' style='background:#e2e8f0;font-size:10px;display:grid;place-items:center'>📸</div>" : "—"}</td><td>${r.location || "—"}</td><td><span class="badge ${r.status === "submitted" ? "complete" : "missing"}">${r.status || "—"}</span></td><td style="font-size:11px;color:var(--ink-secondary)">${r.deviceId || "—"}</td><td>${r.isMock ? '<span class="badge review">⚠️ Fake GPS</span>' : '<span class="badge complete">Normal</span>'}</td></tr>`;
        }).join("")
      : `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--muted)">Belum ada data absensi.</td></tr>`;
  } catch {
    document.getElementById("recordsRows").innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--muted)">Gagal memuat data absensi.</td></tr>`;
  }
}

// ── LEAVE ──
async function renderLeave() {
  try {
    const res = await authFetch("/absensi/api/admin/employee-leaves");
    if (!res || !res.ok) throw new Error("Gagal");
    const leaves = await res.json();
    document.getElementById("leaveRows").innerHTML = leaves.length
      ? leaves.map(l => {
          const tipeMap = { izin: "Izin", sakit: "Sakit", cuti: "Cuti" };
          const statusMap = { approved: "Disetujui", pending: "Pending", rejected: "Ditolak" };
          return `<tr>
            <td><strong>${l.employeeName}</strong></td>
            <td><span class="badge ${l.leaveType === "izin" ? "late" : l.leaveType === "sakit" ? "review" : "complete"}">${tipeMap[l.leaveType] || l.leaveType}</span></td>
            <td>${l.startDate}</td>
            <td>${l.endDate}</td>
            <td>${l.reason || "—"}</td>
            <td><span class="badge ${l.status === "approved" ? "complete" : l.status === "rejected" ? "missing" : "late"}">${statusMap[l.status] || l.status}</span></td>
            <td>—</td>
            <td>—</td>
            <td><button class="button danger small" type="button" data-delete-leave="${l.id}">Hapus</button></td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted)">Belum ada data izin/sakit/cuti.</td></tr>`;
    document.querySelectorAll("[data-delete-leave]").forEach(btn =>
      btn.addEventListener("click", async () => {
        if (!confirm("Hapus data izin/cuti ini?")) return;
        const r = await authFetch(`/absensi/api/admin/employee-leaves/${btn.dataset.deleteLeave}`, { method: "DELETE" });
        if (r && r.ok) { renderLeave(); if (state.view === "dashboard") renderDashboard(); }
        else alert("❌ Gagal menghapus.");
      })
    );
  } catch {
    document.getElementById("leaveRows").innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted)">Gagal memuat data izin/cuti.</td></tr>`;
  }
}

function showLeaveModal() {
  document.getElementById("leaveEmployee").innerHTML = _employees.map(e => `<option value="${e.id}">${e.fullName}</option>`).join("");
  document.getElementById("leaveStart").value = state.selectedDate;
  document.getElementById("leaveEnd").value = state.selectedDate;
  document.getElementById("leaveReason").value = "";
  document.getElementById("leaveModal").style.display = "flex";
}
function hideLeaveModal() { document.getElementById("leaveModal").style.display = "none"; }

async function saveLeave(e) {
  e.preventDefault();
  const btn = document.getElementById("saveLeaveBtn");
  btn.disabled = true; btn.textContent = "Menyimpan...";
  try {
    const res = await authFetch("/absensi/api/admin/employee-leaves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: Number(document.getElementById("leaveEmployee").value),
        leaveType: document.getElementById("leaveType").value,
        startDate: document.getElementById("leaveStart").value,
        endDate: document.getElementById("leaveEnd").value,
        reason: document.getElementById("leaveReason").value
      })
    });
    if (res && res.ok) { hideLeaveModal(); renderLeave(); if (state.view === "dashboard") renderDashboard(); }
    else { const d = await res.json(); alert(`❌ ${d.message || "Gagal"}`); }
  } catch { alert("❌ Gagal terhubung ke server."); }
  finally { btn.disabled = false; btn.textContent = "Simpan"; }
}

// ── REPORTS ──
function renderReports() {
  const btns = [
    ["reportDailyExcel", "daily", "excel"],
    ["reportDailyPdf", "daily", "pdf"],
    ["reportMonthlyExcel", "monthly", "excel"],
    ["reportMonthlyPdf", "monthly", "pdf"]
  ];
  btns.forEach(([id, period, format]) => {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = () => {
      const params = new URLSearchParams({ period, format, date: state.selectedDate, month: String(state.selectedMonth + 1), year: String(state.selectedYear) });
      window.open(`/absensi/api/admin/reports/export-${format === "pdf" ? "pdf" : "excel"}?${params}`, "_blank");
    };
  });
  const photoBtn = document.getElementById("reportPhotoZip");
  if (photoBtn) photoBtn.onclick = () => alert("Export ZIP foto akan menyusul.");
}

// ── SETTINGS ──
async function renderSettings() {
  try {
    const res = await authFetch("/absensi/api/admin/office");
    const office = res && res.ok ? (await res.json()) : { name: "—", address: "—", latitude: "—", longitude: "—", radiusMeter: 20 };
    document.getElementById("officeSettings").innerHTML = settingsRows([
      ["Nama", office.name], ["Alamat", office.address], ["Latitude", office.latitude], ["Longitude", office.longitude], ["Radius valid", `${office.radiusMeter} meter`]
    ]);
  } catch {}
  const adminEmails = _employees.filter(e => e.role === "admin").map(e => e.email);
  const fallbackAdmins = ["puguh.legowo.k@gmail.com", "refinna.sari.86@gmail.com"];
  document.getElementById("adminSettings").innerHTML = settingsRows((adminEmails.length ? adminEmails : fallbackAdmins).map((email, i) => [`Admin ${i + 1}`, email]));
  document.getElementById("securitySettings").innerHTML = settingsRows([
    ["Password", "Hash backend"], ["Token API", "Wajib"], ["GPS", "Wajib ON"], ["Foto", "Kamera langsung"], ["Device binding", "Aktif"], ["Fake GPS", "Tandai review"]
  ]);
}

// ── AUDIT ──
async function renderAudit() {
  try {
    const res = await authFetch("/absensi/api/admin/audit-logs");
    if (!res || !res.ok) {
      document.getElementById("auditRows").innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)">Gagal memuat audit log.</td></tr>`;
      return;
    }
    const logs = await res.json();
    if (!logs || !logs.length) {
      document.getElementById("auditRows").innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)">Belum ada aktivitas.</td></tr>`;
      return;
    }
    document.getElementById("auditRows").innerHTML = logs.map(log => `
      <tr>
        <td>${log.createdAt || log.at || "-"}</td>
        <td>${log.admin || "-"}</td>
        <td>${log.action || "-"}</td>
        <td>${log.entity || "-"}</td>
        <td>${typeof log.oldValue === "object" ? JSON.stringify(log.oldValue) : (log.oldValue || "-")}</td>
        <td>${typeof log.newValue === "object" ? JSON.stringify(log.newValue) : (log.newValue || "-")}</td>
        <td>${log.reason || log.message || "-"}</td>
      </tr>`).join("");
  } catch (e) {
    document.getElementById("auditRows").innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)">Error memuat audit log.</td></tr>`;
  }
}

// ── LOGOUT ──
async function logoutAdmin() {
  try {
    await fetch("/absensi/api/auth/logout", { method: "POST", headers: adminAuthHeaders() });
  } catch {}
  localStorage.removeItem("lelapAdminToken");
  window.location.href = "/absensi/login";
}

// ── BULK DELETE ──
let bulkDeleteIds = [];
function updateBulkDeleteButton() {
  const checked = document.querySelectorAll(".employee-checkbox:checked");
  const btn = document.getElementById("bulkDeleteEmployee");
  bulkDeleteIds = Array.from(checked).map(cb => Number(cb.value));
  btn.disabled = bulkDeleteIds.length === 0;
  btn.textContent = bulkDeleteIds.length > 0 ? `🗑️ Hapus ${bulkDeleteIds.length} Terpilih` : "🗑️ Hapus Terpilih";
}
function showBulkDeleteModal() {
  if (!bulkDeleteIds.length) return;
  document.getElementById("deleteEmployeeName").textContent = `${bulkDeleteIds.length} karyawan`;
  document.getElementById("deleteModalMessage").innerHTML = `Yakin ingin menghapus <strong>${bulkDeleteIds.length} karyawan</strong> terpilih?`;
  document.getElementById("deleteConfirmInput").value = "";
  document.getElementById("deleteConfirmBtn").disabled = true;
  document.getElementById("deleteModal").style.display = "flex";
  deleteTargetId = null;
}
async function confirmBulkDelete() {
  if (!bulkDeleteIds.length) return;
  const btn = document.getElementById("deleteConfirmBtn");
  btn.disabled = true; btn.textContent = "Menghapus...";
  try {
    const res = await authFetch("/absensi/api/admin/employees/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: bulkDeleteIds }) });
    const data = res ? await res.json() : {};
    if (res && res.ok) { alert(`✅ ${data.message}`); hideDeleteModal(); await loadAllData(); renderEmployees(); if (state.view === "dashboard") renderDashboard(); }
    else { alert(`❌ ${data.message || "Gagal menghapus."}`); }
  } catch { alert("❌ Gagal terhubung ke server."); }
  finally { btn.disabled = false; btn.textContent = "Hapus"; }
}
// ── DELETE MODAL ──
let deleteTargetId = null;
function showDeleteModal(employeeId, employeeName) {
  deleteTargetId = employeeId;
  document.getElementById("deleteEmployeeName").textContent = employeeName;
  document.getElementById("deleteConfirmInput").value = "";
  document.getElementById("deleteConfirmBtn").disabled = true;
  document.getElementById("deleteModal").style.display = "flex";
}
function hideDeleteModal() {
  document.getElementById("deleteModal").style.display = "none";
  deleteTargetId = null;
}
async function confirmDeleteEmployee() {
  if (deleteTargetId === null) return;
  const btn = document.getElementById("deleteConfirmBtn");
  btn.disabled = true; btn.textContent = "Menghapus...";
  try {
    const res = await authFetch(`/absensi/api/admin/employees/${deleteTargetId}`, { method: "DELETE" });
    const data = res ? await res.json() : {};
    if (res && res.ok) { alert(`✅ ${data.message}`); hideDeleteModal(); await loadAllData(); renderEmployees(); if (state.view === "dashboard") renderDashboard(); }
    else { alert(`❌ ${data.message || "Gagal menghapus karyawan."}`); }
  } catch { alert("❌ Gagal terhubung ke server."); }
  finally { btn.disabled = false; btn.textContent = "Hapus"; }
}

// ── STATUS BADGE ──
function statusBadge(row) {
  return `<span class="badge ${statusClass(row)}">${row.status}${row.needsReview ? " - Review" : ""}</span>`;
}
function statusClass(row) {
  if (row.needsReview || row.isMockLocation) return "review";
  if (row.isHomecare) return "homecare";
  if (row.isLate || row.status === "Telat") return "late";
  if (["Hanya Masuk","Hanya Pulang","Absensi Tidak Lengkap"].includes(row.status)) return "incomplete";
  if (row.status === "Belum Absen") return "missing";
  if (["Izin","Sakit","Cuti","Libur Shift"].includes(row.status)) return "leave";
  return "complete";
}

// ── DETAIL MODAL ──
async function openDetail(key) {
  state.detailKey = key;
  document.getElementById("detailModal").classList.add("open");
  document.getElementById("detailModal").setAttribute("aria-hidden", "false");
  const parts = (key || "").split("-");
  const empId = Number(parts[0]);
  const date = parts.slice(1).join("-");
  const emp = getEmployee(empId);
  document.getElementById("detailTitle").textContent = emp.fullName;
  document.getElementById("detailDate").textContent = `${dayName(date)}, ${formatLongDate(date)}`;
  try {
    const res = await authFetch(`/absensi/api/admin/attendance/detail?employee_id=${empId}&date=${date}`);
    if (!res || !res.ok) throw new Error("Gagal");
    const data = await res.json();
    const s = data.summary;
    const records = data.records || [];
    const shift = data.shift;
    const leave = data.leave;
    const recHtml = records.length ? records.map(r =>
      `<div class="detail-row"><span>${r.attendanceType === "check_in" ? "✅ Masuk" : "🚪 Pulang"}</span><span>${r.attendanceTime}${r.isMockLocation ? ' ⚠️ Fake GPS' : ''}${r.locationType ? ` (${r.locationType})` : ''}</span></div>`
    ).join("") : `<div class="detail-row"><span>Tidak ada record absensi.</span></div>`;
    const shiftName = shift ? `${shift.name} (${shift.start}-${shift.end})` : "—";
    const leaveInfo = leave ? `${leave.leaveType.toUpperCase()} - ${leave.startDate} s/d ${leave.endDate}${leave.reason ? `: ${leave.reason}` : ''}` : "—";
    const statusLabel = s ? (statusLabelMap[s.dailyStatus] || s.dailyStatus) : "Belum Absen";
    document.getElementById("detailContent").innerHTML = `
      <div class="detail-list">
        <div class="detail-row"><span>Karyawan</span><span>${emp.fullName}</span></div>
        <div class="detail-row"><span>Jabatan</span><span>${emp.position || "—"}</span></div>
        <div class="detail-row"><span>Tanggal</span><span>${date}</span></div>
        <div class="detail-row"><span>Shift</span><span>${shiftName}</span></div>
        <div class="detail-row"><span>Status</span><span>${statusLabel}${s?.isLate ? ' ⏰ Telat' : ''}${s?.isHomecare ? ' 🏠 Homecare' : ''}${s?.needsReview ? ' ⚠️ Review' : ''}</span></div>
        <div class="detail-row"><span>Izin/Cuti</span><span>${leaveInfo}</span></div>
        <div class="detail-row"><span>Check In/Out</span></div>
        ${recHtml}
        <div class="detail-row"><span>Catatan Admin</span><span>${s?.adminNote || "—"}</span></div>
        <div class="detail-row"><span>Catatan Homecare</span><span>${s?.homecareNote || "—"}</span></div>
      </div>`;
    window._detailSummaryId = s?.id || null;
  } catch {
    document.getElementById("detailContent").innerHTML = `<div class="empty-state">Gagal memuat data detail.</div>`;
  }
}
function closeDetail() {
  document.getElementById("detailModal").classList.remove("open");
  document.getElementById("detailModal").setAttribute("aria-hidden", "true");
}
function openCorrection() {
  if (!state.detailKey) return;
  document.getElementById("correctionStatus").value = "";
  document.getElementById("correctionNote").value = "";
  document.getElementById("correctionModal").classList.add("open");
  document.getElementById("correctionModal").setAttribute("aria-hidden", "false");
}
function closeCorrection() {
  document.getElementById("correctionModal").classList.remove("open");
  document.getElementById("correctionModal").setAttribute("aria-hidden", "true");
}
function saveCorrection(e) {
  e.preventDefault();
  const summaryId = window._detailSummaryId;
  if (!summaryId) { alert("Tidak ada data absensi untuk dikoreksi."); return; }
  const status = document.getElementById("correctionStatus").value;
  const note = document.getElementById("correctionNote").value.trim();
  if (!note) { alert("Alasan koreksi wajib diisi."); return; }
  (async () => {
    try {
      const res = await authFetch(`/absensi/api/admin/attendance/${summaryId}/correction`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyStatus: status, adminNote: note })
      });
      if (res && res.ok) { alert("✅ Koreksi berhasil disimpan."); closeCorrection(); closeDetail(); if (state.view === "dashboard") renderDashboard(); if (state.view === "daily") renderDaily(); }
      else { const d = await res.json(); alert(`❌ ${d.message || "Gagal"}`); }
    } catch { alert("❌ Gagal terhubung ke server."); }
  })();
}

// ── EXPORT ──
function exportCurrentView() {
  if (state.view === "monthly") { exportMonthly(); return; }
  exportDaily();
}
function exportDaily() {
  const params = new URLSearchParams({ period: "daily", format: "excel", date: state.selectedDate });
  window.open(`/absensi/api/admin/reports/export-excel?${params}`, "_blank");
}
function exportMonthly() {
  const params = new URLSearchParams({ period: "monthly", format: "excel", month: String(state.selectedMonth + 1), year: String(state.selectedYear) });
  window.open(`/absensi/api/admin/reports/export-excel?${params}`, "_blank");
}
function exportDetail() {
  if (state.detailKey) {
    const params = new URLSearchParams({ format: "pdf", period: "detail", key: state.detailKey });
    window.open(`/absensi/api/admin/reports/export-pdf?${params}`, "_blank");
  } else alert("Tidak ada detail yang dipilih.");
}

// ── OTHER ──
function renderPersonList(id, rows) {
  const target = document.getElementById(id);
  if (!rows || !rows.length) { target.innerHTML = `<div class="empty-state">Tidak ada data.</div>`; return; }
  target.innerHTML = rows.map(r => {
    const emp = getEmployee(r.employeeId);
    return `<button class="person-row link-button" type="button" data-detail="${r.key}"><span><strong>${emp.fullName}</strong><span class="muted">${r.status}</span></span>${statusBadge(r)}</button>`;
  }).join("");
  bindDetailButtons();
}
function bindDetailButtons() {
  document.querySelectorAll("[data-detail]").forEach(b => { b.onclick = () => openDetail(b.dataset.detail); });
}
function settingsRows(rows) {
  return rows.map(([l, v]) => `<div class="setting-row"><strong>${l}</strong><span>${v}</span></div>`).join("");
}
function fillStatusSelect(id) {
  document.getElementById(id).innerHTML = `<option value="">Semua status</option>${statusLabels.map(s => `<option value="${s}">${s}</option>`).join("")}`;
}
function fillShiftSelect(id) {
  document.getElementById(id).innerHTML = `<option value="">Semua shift</option>${_shifts.map(s => `<option value="${s.id}">${s.name}</option>`).join("")}`;
}
function fillCorrectionStatus() {
  document.getElementById("correctionStatus").innerHTML = statusLabels.map(s => `<option value="${s}">${s}</option>`).join("");
}
