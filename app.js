const employees = [
  {
    id: 1,
    name: "Sari Wulandari",
    email: "sari@lelap.web.id",
    phone: "0812-1100-2233",
    position: "Terapis Baby Care",
    status: "Aktif",
    defaultShiftId: 1,
    deviceId: "LA-ANDROID-001",
    joinedDate: "2025-09-12"
  },
  {
    id: 2,
    name: "Dinda Permata",
    email: "dinda@lelap.web.id",
    phone: "0813-2200-3344",
    position: "Terapis Mom Care",
    status: "Aktif",
    defaultShiftId: 2,
    deviceId: "LA-IOS-014",
    joinedDate: "2025-11-04"
  },
  {
    id: 3,
    name: "Maya Lestari",
    email: "maya@lelap.web.id",
    phone: "0821-3300-4455",
    position: "Admin Front Office",
    status: "Aktif",
    defaultShiftId: 1,
    deviceId: "LA-ANDROID-021",
    joinedDate: "2024-06-18"
  },
  {
    id: 4,
    name: "Rina Aprilia",
    email: "rina@lelap.web.id",
    phone: "0857-4400-5566",
    position: "Terapis Homecare",
    status: "Aktif",
    defaultShiftId: 4,
    deviceId: "LA-ANDROID-032",
    joinedDate: "2026-01-06"
  },
  {
    id: 5,
    name: "Tika Handayani",
    email: "tika@lelap.web.id",
    phone: "0878-5500-6677",
    position: "Terapis Baby Spa",
    status: "Aktif",
    defaultShiftId: 3,
    deviceId: "Belum terdaftar",
    joinedDate: "2026-03-15"
  }
];

const shifts = [
  {
    id: 1,
    name: "Shift Reguler",
    start: "08:00",
    end: "16:00",
    tolerance: 15,
    days: "Senin-Sabtu",
    active: true
  },
  {
    id: 2,
    name: "Shift Pagi Khusus",
    start: "07:00",
    end: "15:00",
    tolerance: 10,
    days: "Senin-Jumat",
    active: true
  },
  {
    id: 3,
    name: "Shift Siang",
    start: "10:00",
    end: "18:00",
    tolerance: 15,
    days: "Senin-Sabtu",
    active: true
  },
  {
    id: 4,
    name: "Shift Homecare",
    start: "08:30",
    end: "17:00",
    tolerance: 20,
    days: "Sesuai jadwal",
    active: true
  }
];

const office = {
  name: "Lelap Mom Baby Care Salatiga",
  address: "Jl. contoh setup awal, Salatiga",
  latitude: "-7.330000",
  longitude: "110.500000",
  radiusMeter: 20
};

const admins = [
  "puguh.legowo.k@gmail.com",
  "refinna.sari.86@gmail.com",
  "refinna.sar.86@gmail.com"
];

const statuses = [
  "Hadir Lengkap",
  "Belum Absen",
  "Hanya Masuk",
  "Hanya Pulang",
  "Telat",
  "Izin",
  "Sakit",
  "Cuti",
  "Absensi Tidak Lengkap",
  "Libur Shift"
];

const state = {
  view: "dashboard",
  selectedDate: "2026-06-30",
  selectedMonth: 5,
  selectedYear: 2026,
  detailKey: null,
  auditLogs: [
    {
      at: "2026-06-28 17:20",
      admin: "puguh.legowo.k@gmail.com",
      action: "attendance.correction",
      entity: "daily_attendance_summaries#EMP-4-2026-06-28",
      oldValue: "Hanya Pulang",
      newValue: "Absensi Tidak Lengkap",
      reason: "Karyawan lupa menekan absen masuk saat homecare."
    }
  ]
};

const views = {
  dashboard: { title: "Dashboard Ringkasan", element: "dashboardView" },
  daily: { title: "Monitoring Harian", element: "dailyView" },
  monthly: { title: "Monitoring Bulanan", element: "monthlyView" },
  employees: { title: "Data Karyawan", element: "employeesView" },
  shifts: { title: "Jadwal Shift", element: "shiftsView" },
  settings: { title: "Pengaturan Lokasi dan Admin", element: "settingsView" },
  audit: { title: "Audit Log", element: "auditView" }
};

const attendance = buildAttendance();

document.addEventListener("DOMContentLoaded", () => {
  hydrateControls();
  bindEvents();
  renderAll();
});

function hydrateControls() {
  document.getElementById("globalDate").value = state.selectedDate;
  document.getElementById("yearInput").value = state.selectedYear;
  document.getElementById("monthSelect").innerHTML = monthNames()
    .map((name, index) => `<option value="${index}">${name}</option>`)
    .join("");
  document.getElementById("monthSelect").value = String(state.selectedMonth);
  fillStatusSelect("dailyStatus");
  fillStatusSelect("monthlyStatus");
  fillShiftSelect("dailyShift");
  fillCorrectionStatus();
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  document.querySelectorAll("[data-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.shortcut);
      if (button.dataset.status) {
        document.getElementById("dailyStatus").value = button.dataset.status;
      }
      if (button.dataset.homecare) {
        document.getElementById("dailyHomecare").checked = true;
      }
      renderDaily();
    });
  });

  document.getElementById("globalDate").addEventListener("change", (event) => {
    state.selectedDate = event.target.value;
    renderAll();
  });

  [
    "dailySearch",
    "dailyStatus",
    "dailyShift",
    "dailyHomecare",
    "dailyLate",
    "dailyReview"
  ].forEach((id) => document.getElementById(id).addEventListener("input", renderDaily));

  ["monthSelect", "yearInput", "monthlySearch", "monthlyStatus", "monthlyHomecare", "monthlyReview"].forEach(
    (id) => {
      document.getElementById(id).addEventListener("input", () => {
        state.selectedMonth = Number(document.getElementById("monthSelect").value);
        state.selectedYear = Number(document.getElementById("yearInput").value);
        renderMonthly();
      });
    }
  );

  document.getElementById("exportCurrent").addEventListener("click", exportCurrentView);
  document.getElementById("logoutAdmin").addEventListener("click", logoutAdmin);
  document.getElementById("closeDetail").addEventListener("click", closeDetail);
  document.getElementById("closeCorrection").addEventListener("click", closeCorrection);
  document.getElementById("openCorrection").addEventListener("click", openCorrection);
  document.getElementById("detailExport").addEventListener("click", exportDetail);
  document.getElementById("correctionForm").addEventListener("submit", saveCorrection);

  document.getElementById("addEmployee").addEventListener("click", () => {
    alert("Form tambah karyawan akan disambungkan ke POST /api/admin/employees pada tahap backend.");
  });
  document.getElementById("resetDevice").addEventListener("click", () => {
    alert("Reset device akan disambungkan ke PATCH /api/admin/employees/{id}/reset-device.");
  });
  document.getElementById("addShift").addEventListener("click", () => {
    alert("Form shift akan disambungkan ke POST /api/admin/shifts.");
  });
  document.getElementById("copySchedule").addEventListener("click", () => {
    alert("Copy jadwal akan dibuat setelah modul kalender shift aktif.");
  });
}

async function logoutAdmin() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: adminAuthHeaders()
    });
  } finally {
    localStorage.removeItem("lelapAdminToken");
    window.location.href = "/absensi/login";
  }
}

function adminAuthHeaders() {
  const token = localStorage.getItem("lelapAdminToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function renderAll() {
  renderDashboard();
  renderDaily();
  renderMonthly();
  renderEmployees();
  renderShifts();
  renderSettings();
  renderAudit();
}

function setView(view) {
  state.view = view;
  document.getElementById("pageTitle").textContent = views[view].title;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  document.getElementById(views[view].element).classList.add("active");
}

function renderDashboard() {
  const rows = dailyRowsForDate(state.selectedDate);
  const counts = summarizeRows(rows);
  const metrics = [
    ["Total aktif", employees.filter((item) => item.status === "Aktif").length, "Karyawan"],
    ["Hadir lengkap", counts.complete, "Selesai masuk dan pulang"],
    ["Belum absen", counts.missing, "Tidak ada absen hari ini"],
    ["Telat", counts.late, "Masuk lewat toleransi"],
    ["Tidak lengkap", counts.incomplete, "Butuh cek admin"],
    ["Homecare", counts.homecare, "Di luar kantor"],
    ["Hanya masuk", counts.onlyIn, "Belum pulang"],
    ["Hanya pulang", counts.onlyOut, "Tidak normal"],
    ["Izin", counts.izin, "Disetujui admin"],
    ["Sakit", counts.sakit, "Tercatat"],
    ["Cuti", counts.cuti, "Tercatat"],
    ["Perlu review", counts.review, "Fake GPS/data risiko"]
  ];

  document.getElementById("metricGrid").innerHTML = metrics
    .map(
      ([label, value, note]) => `
        <article class="metric-card">
          <button type="button" data-metric="${label}">
            <span class="metric-label">${label}</span>
            <div class="metric-value">${value}</div>
            <span class="metric-note">${note}</span>
          </button>
        </article>
      `
    )
    .join("");

  document.querySelectorAll("[data-metric]").forEach((button) => {
    button.addEventListener("click", () => setView("daily"));
  });

  renderPersonList("missingCheckIn", rows.filter((row) => row.status === "Belum Absen"));
  renderPersonList("lateList", rows.filter((row) => row.isLate));
  renderPersonList("homecareList", rows.filter((row) => row.isHomecare));
}

function renderDaily() {
  const rows = filteredDailyRows();
  const target = document.getElementById("dailyRows");
  if (!rows.length) {
    target.innerHTML = `<tr><td colspan="11" class="empty-state">Tidak ada data sesuai filter.</td></tr>`;
    return;
  }

  target.innerHTML = rows
    .map((row) => {
      const employee = getEmployee(row.employeeId);
      const shift = getShift(row.shiftId);
      return `
        <tr>
          <td><strong>${employee.name}</strong><br><span class="muted">${employee.position}</span></td>
          <td>${shift.name}</td>
          <td>${statusBadge(row)}</td>
          <td>${row.checkInTime || "-"}</td>
          <td>${photoButton(row, "checkIn")}</td>
          <td>${row.checkIn?.locationType || "-"}</td>
          <td>${row.checkOutTime || "-"}</td>
          <td>${photoButton(row, "checkOut")}</td>
          <td>${row.checkOut?.locationType || "-"}</td>
          <td>${row.adminNote || row.homecareNote || "-"}</td>
          <td><button class="button" type="button" data-detail="${row.key}">Detail</button></td>
        </tr>
      `;
    })
    .join("");

  bindDetailButtons();
}

function renderMonthly() {
  const month = Number(document.getElementById("monthSelect").value);
  const year = Number(document.getElementById("yearInput").value);
  const days = daysInMonth(year, month);
  const dayHeaders = Array.from({ length: days }, (_, index) => `<th class="day-cell">${index + 1}</th>`).join("");

  document.getElementById("monthlyHead").innerHTML = `
    <tr>
      <th>Karyawan</th>
      ${dayHeaders}
      <th>Hadir</th>
      <th>Telat</th>
      <th>Tidak Lengkap</th>
      <th>Belum Absen</th>
      <th>Izin</th>
      <th>Sakit</th>
      <th>Cuti</th>
      <th>Homecare</th>
      <th>Review</th>
    </tr>
  `;

  const rows = monthlyEmployees().map((employee) => {
    const summaries = Array.from({ length: days }, (_, index) => {
      const date = dateKey(year, month, index + 1);
      return getSummary(employee.id, date) || makeMissingSummary(employee.id, date);
    });

    const counts = summarizeRows(summaries);
    const dayCells = summaries
      .map(
        (summary) => `
          <td class="day-cell">
            <button class="day-button" type="button" title="${tooltip(summary)}" data-detail="${summary.key}">
              <span class="day-code ${statusClass(summary)}">${statusCode(summary)}</span>
              <span class="mini-thumbs">${miniThumbs(summary)}</span>
            </button>
          </td>
        `
      )
      .join("");

    return `
      <tr>
        <td><strong>${employee.name}</strong><br><span class="muted">${getShift(employee.defaultShiftId).name}</span></td>
        ${dayCells}
        <td class="summary-number">${counts.complete}</td>
        <td class="summary-number">${counts.late}</td>
        <td class="summary-number">${counts.incomplete}</td>
        <td class="summary-number">${counts.missing}</td>
        <td class="summary-number">${counts.izin}</td>
        <td class="summary-number">${counts.sakit}</td>
        <td class="summary-number">${counts.cuti}</td>
        <td class="summary-number">${counts.homecare}</td>
        <td class="summary-number">${counts.review}</td>
      </tr>
    `;
  });

  document.getElementById("monthlyRows").innerHTML = rows.length
    ? rows.join("")
    : `<tr><td class="empty-state" colspan="${days + 10}">Tidak ada data sesuai filter.</td></tr>`;
  bindDetailButtons();
}

function renderEmployees() {
  document.getElementById("employeeRows").innerHTML = employees
    .map(
      (employee) => `
        <tr>
          <td><strong>${employee.name}</strong><br><span class="muted">${employee.joinedDate}</span></td>
          <td>${employee.email}</td>
          <td>${employee.phone}</td>
          <td>${employee.position}</td>
          <td>${getShift(employee.defaultShiftId).name}</td>
          <td>${employee.deviceId}</td>
          <td><span class="badge complete">${employee.status}</span></td>
        </tr>
      `
    )
    .join("");
}

function renderShifts() {
  document.getElementById("shiftRows").innerHTML = shifts
    .map((shift) => {
      const assigned = employees.filter((employee) => employee.defaultShiftId === shift.id).map((employee) => employee.name).join(", ");
      return `
        <tr>
          <td><strong>${shift.name}</strong></td>
          <td>${shift.start}</td>
          <td>${shift.end}</td>
          <td>${shift.tolerance} menit</td>
          <td>${shift.days}</td>
          <td>${assigned || "-"}</td>
          <td><span class="badge complete">${shift.active ? "Aktif" : "Nonaktif"}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderSettings() {
  document.getElementById("officeSettings").innerHTML = settingsRows([
    ["Nama", office.name],
    ["Alamat", office.address],
    ["Latitude", office.latitude],
    ["Longitude", office.longitude],
    ["Radius valid", `${office.radiusMeter} meter`]
  ]);

  document.getElementById("adminSettings").innerHTML = settingsRows(admins.map((email, index) => [`Admin ${index + 1}`, email]));

  document.getElementById("securitySettings").innerHTML = settingsRows([
    ["Password", "Hash backend"],
    ["Token API", "Wajib"],
    ["GPS", "Wajib ON"],
    ["Foto", "Kamera langsung"],
    ["Device binding", "Aktif"],
    ["Fake GPS", "Tandai review"]
  ]);
}

function renderAudit() {
  document.getElementById("auditRows").innerHTML = state.auditLogs
    .map(
      (log) => `
        <tr>
          <td>${log.at}</td>
          <td>${log.admin}</td>
          <td>${log.action}</td>
          <td>${log.entity}</td>
          <td>${log.oldValue}</td>
          <td>${log.newValue}</td>
          <td>${log.reason}</td>
        </tr>
      `
    )
    .join("");
}

function openDetail(key) {
  const row = findSummaryByKey(key);
  if (!row) return;
  state.detailKey = key;
  const employee = getEmployee(row.employeeId);
  const shift = getShift(row.shiftId);
  document.getElementById("detailTitle").textContent = employee.name;
  document.getElementById("detailDate").textContent = `${dayName(row.date)}, ${formatLongDate(row.date)}`;

  document.getElementById("detailContent").innerHTML = `
    <div class="detail-photos">
      ${detailFigure(row.checkIn, "Foto Masuk")}
      ${detailFigure(row.checkOut, "Foto Pulang")}
    </div>
    <div class="detail-list">
      ${detailRow("Shift", shift.name)}
      ${detailRow("Status", statusBadge(row))}
      ${detailRow("Jam masuk", row.checkInTime || "-")}
      ${detailRow("Jam pulang", row.checkOutTime || "-")}
      ${detailRow("Telat", row.isLate ? `${row.lateMinutes} menit` : "Tidak")}
      ${detailRow("Homecare", row.isHomecare ? "Ya" : "Tidak")}
      ${detailRow("Alamat masuk", row.checkIn?.address || "-")}
      ${detailRow("Lat masuk", row.checkIn?.latitude || "-")}
      ${detailRow("Long masuk", row.checkIn?.longitude || "-")}
      ${detailRow("Jarak masuk", row.checkIn ? `${row.checkIn.distance} meter` : "-")}
      ${detailRow("Alamat pulang", row.checkOut?.address || "-")}
      ${detailRow("Lat pulang", row.checkOut?.latitude || "-")}
      ${detailRow("Long pulang", row.checkOut?.longitude || "-")}
      ${detailRow("Fake GPS", row.isMockLocation ? "Terdeteksi" : "Tidak")}
      ${detailRow("Catatan homecare", row.homecareNote || "-")}
      ${detailRow("Catatan admin", row.adminNote || "-")}
    </div>
  `;

  document.getElementById("detailModal").classList.add("open");
  document.getElementById("detailModal").setAttribute("aria-hidden", "false");
}

function closeDetail() {
  document.getElementById("detailModal").classList.remove("open");
  document.getElementById("detailModal").setAttribute("aria-hidden", "true");
}

function openCorrection() {
  if (!state.detailKey) return;
  const row = findSummaryByKey(state.detailKey);
  document.getElementById("correctionStatus").value = row.status;
  document.getElementById("correctionNote").value = row.adminNote || "";
  document.getElementById("correctionModal").classList.add("open");
  document.getElementById("correctionModal").setAttribute("aria-hidden", "false");
}

function closeCorrection() {
  document.getElementById("correctionModal").classList.remove("open");
  document.getElementById("correctionModal").setAttribute("aria-hidden", "true");
}

function saveCorrection(event) {
  event.preventDefault();
  const row = findSummaryByKey(state.detailKey);
  if (!row) return;

  const oldStatus = row.status;
  const newStatus = document.getElementById("correctionStatus").value;
  const note = document.getElementById("correctionNote").value.trim();

  row.status = newStatus;
  row.adminNote = note;
  row.needsReview = false;
  row.isIncomplete = newStatus === "Absensi Tidak Lengkap" || newStatus === "Hanya Masuk" || newStatus === "Hanya Pulang";
  row.isLate = newStatus === "Telat" || row.isLate;

  state.auditLogs.unshift({
    at: nowStamp(),
    admin: admins[0],
    action: "attendance.correction",
    entity: `daily_attendance_summaries#${row.key}`,
    oldValue: oldStatus,
    newValue: newStatus,
    reason: note
  });

  closeCorrection();
  openDetail(row.key);
  renderAll();
}

function exportCurrentView() {
  if (state.view === "monthly") {
    exportMonthly();
    return;
  }
  exportDaily();
}

function exportDaily() {
  const rows = filteredDailyRows();
  const csv = toCsv([
    ["Tanggal", "Nama", "Shift", "Jam Masuk", "Jam Pulang", "Status", "Telat", "Lokasi", "Homecare", "Catatan"],
    ...rows.map((row) => [
      row.date,
      getEmployee(row.employeeId).name,
      getShift(row.shiftId).name,
      row.checkInTime || "",
      row.checkOutTime || "",
      row.status,
      row.isLate ? "Ya" : "Tidak",
      row.checkIn?.locationType || row.checkOut?.locationType || "",
      row.isHomecare ? "Ya" : "Tidak",
      row.adminNote || row.homecareNote || ""
    ])
  ]);
  downloadText(`lelap-harian-${state.selectedDate}.csv`, csv);
}

function exportMonthly() {
  const month = Number(document.getElementById("monthSelect").value);
  const year = Number(document.getElementById("yearInput").value);
  const days = daysInMonth(year, month);
  const header = ["Nama", ...Array.from({ length: days }, (_, index) => String(index + 1)), "Hadir", "Telat", "Tidak Lengkap", "Belum Absen", "Izin", "Sakit", "Cuti", "Homecare", "Review"];
  const rows = monthlyEmployees().map((employee) => {
    const summaries = Array.from({ length: days }, (_, index) => getSummary(employee.id, dateKey(year, month, index + 1)) || makeMissingSummary(employee.id, dateKey(year, month, index + 1)));
    const counts = summarizeRows(summaries);
    return [
      employee.name,
      ...summaries.map((summary) => summary.status),
      counts.complete,
      counts.late,
      counts.incomplete,
      counts.missing,
      counts.izin,
      counts.sakit,
      counts.cuti,
      counts.homecare,
      counts.review
    ];
  });
  downloadText(`lelap-bulanan-${year}-${pad(month + 1)}.csv`, toCsv([header, ...rows]));
}

function exportDetail() {
  const row = findSummaryByKey(state.detailKey);
  if (!row) return;
  const employee = getEmployee(row.employeeId);
  const csv = toCsv([
    ["Field", "Nilai"],
    ["Nama", employee.name],
    ["Tanggal", row.date],
    ["Shift", getShift(row.shiftId).name],
    ["Status", row.status],
    ["Jam masuk", row.checkInTime || ""],
    ["Jam pulang", row.checkOutTime || ""],
    ["Alamat masuk", row.checkIn?.address || ""],
    ["Alamat pulang", row.checkOut?.address || ""],
    ["Homecare", row.isHomecare ? "Ya" : "Tidak"],
    ["Fake GPS", row.isMockLocation ? "Ya" : "Tidak"],
    ["Catatan admin", row.adminNote || ""]
  ]);
  downloadText(`lelap-detail-${employee.name.replaceAll(" ", "-")}-${row.date}.csv`, csv);
}

function filteredDailyRows() {
  const search = document.getElementById("dailySearch").value.toLowerCase();
  const status = document.getElementById("dailyStatus").value;
  const shift = document.getElementById("dailyShift").value;
  const homecare = document.getElementById("dailyHomecare").checked;
  const late = document.getElementById("dailyLate").checked;
  const review = document.getElementById("dailyReview").checked;

  return dailyRowsForDate(state.selectedDate).filter((row) => {
    const employee = getEmployee(row.employeeId);
    return (
      (!search || employee.name.toLowerCase().includes(search)) &&
      (!status || row.status === status) &&
      (!shift || String(row.shiftId) === shift) &&
      (!homecare || row.isHomecare) &&
      (!late || row.isLate) &&
      (!review || row.needsReview)
    );
  });
}

function monthlyEmployees() {
  const search = document.getElementById("monthlySearch").value.toLowerCase();
  const status = document.getElementById("monthlyStatus").value;
  const homecare = document.getElementById("monthlyHomecare").checked;
  const review = document.getElementById("monthlyReview").checked;
  const month = Number(document.getElementById("monthSelect").value);
  const year = Number(document.getElementById("yearInput").value);
  const days = daysInMonth(year, month);

  return employees.filter((employee) => {
    const rows = Array.from({ length: days }, (_, index) => getSummary(employee.id, dateKey(year, month, index + 1)) || makeMissingSummary(employee.id, dateKey(year, month, index + 1)));
    return (
      (!search || employee.name.toLowerCase().includes(search)) &&
      (!status || rows.some((row) => row.status === status)) &&
      (!homecare || rows.some((row) => row.isHomecare)) &&
      (!review || rows.some((row) => row.needsReview))
    );
  });
}

function dailyRowsForDate(date) {
  return employees.map((employee) => getSummary(employee.id, date) || makeMissingSummary(employee.id, date));
}

function getSummary(employeeId, date) {
  return attendance.find((row) => row.employeeId === employeeId && row.date === date);
}

function findSummaryByKey(key) {
  return attendance.find((row) => row.key === key) || buildVirtualRows().find((row) => row.key === key);
}

function buildVirtualRows() {
  const month = Number(document.getElementById("monthSelect").value);
  const year = Number(document.getElementById("yearInput").value);
  const days = daysInMonth(year, month);
  return employees.flatMap((employee) =>
    Array.from({ length: days }, (_, index) => makeMissingSummary(employee.id, dateKey(year, month, index + 1)))
  );
}

function makeMissingSummary(employeeId, date) {
  const employee = getEmployee(employeeId);
  return {
    key: `${employeeId}-${date}`,
    employeeId,
    date,
    shiftId: employee.defaultShiftId,
    status: isSunday(date) ? "Libur Shift" : "Belum Absen",
    checkInTime: "",
    checkOutTime: "",
    checkIn: null,
    checkOut: null,
    isLate: false,
    lateMinutes: 0,
    isHomecare: false,
    isIncomplete: false,
    needsReview: false,
    isMockLocation: false,
    homecareNote: "",
    adminNote: ""
  };
}

function buildAttendance() {
  const rows = [];
  for (let day = 1; day <= 30; day += 1) {
    employees.forEach((employee) => {
      const date = dateKey(2026, 5, day);
      if (isSunday(date)) return;
      const pattern = statusPattern(employee.id, day);
      if (pattern === "Belum Absen") return;
      rows.push(makeSummary(employee, date, pattern, day));
    });
  }
  return rows;
}

function statusPattern(employeeId, day) {
  if (day === 30 && employeeId === 1) return "Telat";
  if (day === 30 && employeeId === 2) return "Hanya Masuk";
  if (day === 30 && employeeId === 3) return "Hadir Lengkap";
  if (day === 30 && employeeId === 4) return "Hadir Lengkap Homecare";
  if (day === 30 && employeeId === 5) return "Belum Absen";
  if (day % 13 === employeeId) return "Izin";
  if (day % 17 === employeeId) return "Sakit";
  if (day % 19 === employeeId) return "Cuti";
  if ((day + employeeId) % 11 === 0) return "Absensi Tidak Lengkap";
  if ((day + employeeId) % 9 === 0) return "Telat";
  if (employeeId === 4 && day % 3 === 0) return "Hadir Lengkap Homecare";
  if (employeeId === 2 && day % 14 === 0) return "Hanya Pulang";
  return "Hadir Lengkap";
}

function makeSummary(employee, date, pattern, day) {
  const shift = getShift(employee.defaultShiftId);
  const isLeave = ["Izin", "Sakit", "Cuti"].includes(pattern);
  const homecare = pattern.includes("Homecare");
  const status = pattern.replace(" Homecare", "");
  const isLate = status === "Telat";
  const incomplete = status === "Absensi Tidak Lengkap" || status === "Hanya Masuk" || status === "Hanya Pulang";
  const needsReview = status === "Hanya Pulang" || (employee.id === 4 && day === 27);
  const mock = employee.id === 4 && day === 27;
  const checkInTime = isLeave || status === "Hanya Pulang" ? "" : shift.start.replace(":00", isLate ? ":23" : ":04");
  const checkOutTime = isLeave || status === "Hanya Masuk" || status === "Absensi Tidak Lengkap" ? "" : shift.end.replace(":00", ":03");
  const locationType = homecare ? "Homecare" : "Kantor Lelap";

  return {
    key: `${employee.id}-${date}`,
    employeeId: employee.id,
    date,
    shiftId: shift.id,
    status,
    checkInTime,
    checkOutTime,
    checkIn: checkInTime ? makeRecord(employee, "Masuk", date, checkInTime, locationType, homecare, mock) : null,
    checkOut: checkOutTime ? makeRecord(employee, "Pulang", date, checkOutTime, locationType, homecare, mock) : null,
    isLate,
    lateMinutes: isLate ? 8 + (employee.id * 2) : 0,
    isHomecare: homecare,
    isIncomplete: incomplete,
    needsReview,
    isMockLocation: mock,
    clientName: homecare ? "Klien Homecare Salatiga" : "",
    homecareNote: homecare ? "Tugas homecare sesuai jadwal admin." : "",
    adminNote: needsReview ? "Perlu validasi lokasi dan urutan absen." : ""
  };
}

function makeRecord(employee, type, date, time, locationType, homecare, mock) {
  const lat = homecare ? "-7.326912" : office.latitude;
  const lng = homecare ? "110.507430" : office.longitude;
  const address = homecare ? "Alamat homecare klien, Salatiga" : office.address;
  return {
    type,
    serverTime: time,
    deviceTime: time,
    latitude: lat,
    longitude: lng,
    address,
    distance: homecare ? 1850 : 9,
    locationType,
    gpsStatus: "ON",
    isMockLocation: mock,
    deviceId: employee.deviceId,
    photo: makePhoto(employee.name, type, date, time, homecare)
  };
}

function makePhoto(name, type, date, time, homecare) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const bg = homecare ? "#6d28d9" : "#0f766e";
  const label = `${type} ${time}`;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560">
      <rect width="420" height="560" fill="${bg}"/>
      <circle cx="210" cy="170" r="82" fill="#f7d7b7"/>
      <rect x="94" y="274" width="232" height="170" rx="84" fill="#17212b"/>
      <text x="210" y="185" text-anchor="middle" font-family="Arial" font-size="52" font-weight="700" fill="#17212b">${initials}</text>
      <rect x="22" y="386" width="376" height="144" rx="8" fill="rgba(255,255,255,0.88)"/>
      <text x="42" y="424" font-family="Arial" font-size="20" font-weight="700" fill="#111827">Lelap Mom Baby Care</text>
      <text x="42" y="454" font-family="Arial" font-size="18" fill="#111827">Nama: ${name}</text>
      <text x="42" y="482" font-family="Arial" font-size="18" fill="#111827">Status: Absen ${label}</text>
      <text x="42" y="510" font-family="Arial" font-size="16" fill="#111827">${date} - GPS ON - ${homecare ? "Homecare" : "Kantor Lelap"}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function summarizeRows(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.complete += row.status === "Hadir Lengkap" && !row.isLate ? 1 : 0;
      acc.missing += row.status === "Belum Absen" ? 1 : 0;
      acc.late += row.isLate || row.status === "Telat" ? 1 : 0;
      acc.incomplete += row.isIncomplete || row.status === "Absensi Tidak Lengkap" ? 1 : 0;
      acc.onlyIn += row.status === "Hanya Masuk" ? 1 : 0;
      acc.onlyOut += row.status === "Hanya Pulang" ? 1 : 0;
      acc.izin += row.status === "Izin" ? 1 : 0;
      acc.sakit += row.status === "Sakit" ? 1 : 0;
      acc.cuti += row.status === "Cuti" ? 1 : 0;
      acc.homecare += row.isHomecare ? 1 : 0;
      acc.review += row.needsReview || row.isMockLocation ? 1 : 0;
      return acc;
    },
    { complete: 0, missing: 0, late: 0, incomplete: 0, onlyIn: 0, onlyOut: 0, izin: 0, sakit: 0, cuti: 0, homecare: 0, review: 0 }
  );
}

function statusBadge(row) {
  return `<span class="badge ${statusClass(row)}">${row.status}${row.needsReview ? " - Review" : ""}</span>`;
}

function statusClass(row) {
  if (row.needsReview || row.isMockLocation) return "review";
  if (row.isHomecare) return "homecare";
  if (row.isLate || row.status === "Telat") return "late";
  if (["Hanya Masuk", "Hanya Pulang", "Absensi Tidak Lengkap"].includes(row.status)) return "incomplete";
  if (["Belum Absen"].includes(row.status)) return "missing";
  if (["Izin", "Sakit", "Cuti", "Libur Shift"].includes(row.status)) return "leave";
  return "complete";
}

function statusCode(row) {
  const codes = {
    "Hadir Lengkap": row.isHomecare ? "H" : "OK",
    Telat: "T",
    "Absensi Tidak Lengkap": "!",
    "Hanya Masuk": "M",
    "Hanya Pulang": "P",
    "Belum Absen": "X",
    Izin: "I",
    Sakit: "S",
    Cuti: "C",
    "Libur Shift": "L"
  };
  return row.needsReview ? "R" : codes[row.status] || "-";
}

function tooltip(row) {
  const employee = getEmployee(row.employeeId);
  return `${employee.name} | ${row.date} | ${row.status} | Masuk ${row.checkInTime || "-"} | Pulang ${row.checkOutTime || "-"}`;
}

function miniThumbs(row) {
  const thumbs = [row.checkIn, row.checkOut]
    .filter(Boolean)
    .map((record) => `<img src="${record.photo}" alt="Foto ${record.type}">`)
    .join("");
  return thumbs || "";
}

function photoButton(row, type) {
  const record = row[type];
  if (!record) return "-";
  return `<button class="photo-thumb button-thumb" type="button" data-detail="${row.key}" aria-label="Buka foto ${record.type}">
    <img src="${record.photo}" alt="Foto ${record.type}">
  </button>`;
}

function detailFigure(record, label) {
  if (!record) {
    return `
      <figure class="detail-photo">
        <figcaption>${label}</figcaption>
        <div class="empty-state">Foto belum tersedia.</div>
      </figure>
    `;
  }
  return `
    <figure class="detail-photo">
      <img src="${record.photo}" alt="${label}">
      <figcaption>${label} - ${record.address}</figcaption>
    </figure>
  `;
}

function detailRow(label, value) {
  return `<div class="detail-row"><span>${label}</span><span>${value}</span></div>`;
}

function renderPersonList(id, rows) {
  const target = document.getElementById(id);
  if (!rows.length) {
    target.innerHTML = `<div class="empty-state">Tidak ada data.</div>`;
    return;
  }
  target.innerHTML = rows
    .map((row) => {
      const employee = getEmployee(row.employeeId);
      return `
        <button class="person-row link-button" type="button" data-detail="${row.key}">
          <span><strong>${employee.name}</strong><span class="muted">${row.status}</span></span>
          ${statusBadge(row)}
        </button>
      `;
    })
    .join("");
  bindDetailButtons();
}

function bindDetailButtons() {
  document.querySelectorAll("[data-detail]").forEach((button) => {
    button.onclick = () => openDetail(button.dataset.detail);
  });
}

function settingsRows(rows) {
  return rows.map(([label, value]) => `<div class="setting-row"><strong>${label}</strong><span>${value}</span></div>`).join("");
}

function fillStatusSelect(id) {
  document.getElementById(id).innerHTML = `<option value="">Semua status</option>${statuses
    .map((status) => `<option value="${status}">${status}</option>`)
    .join("")}`;
}

function fillShiftSelect(id) {
  document.getElementById(id).innerHTML = `<option value="">Semua shift</option>${shifts
    .map((shift) => `<option value="${shift.id}">${shift.name}</option>`)
    .join("")}`;
}

function fillCorrectionStatus() {
  document.getElementById("correctionStatus").innerHTML = statuses.map((status) => `<option value="${status}">${status}</option>`).join("");
}

function getEmployee(id) {
  return employees.find((employee) => employee.id === id);
}

function getShift(id) {
  return shifts.find((shift) => shift.id === id);
}

function monthNames() {
  return ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function dateKey(year, monthIndex, day) {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function isSunday(date) {
  return new Date(`${date}T12:00:00`).getDay() === 0;
}

function dayName(date) {
  return ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][new Date(`${date}T12:00:00`).getDay()];
}

function formatLongDate(date) {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${monthNames()[Number(month) - 1]} ${year}`;
}

function nowStamp() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "");
          return `"${value.replaceAll('"', '""')}"`;
        })
        .join(",")
    )
    .join("\n");
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
