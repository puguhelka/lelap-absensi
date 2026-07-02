import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(__dirname);
const dataDir = join(__dirname, "data");
const uploadDir = join(__dirname, "uploads");
const storePath = join(dataDir, "store.json");
const port = Number(process.env.PORT || 3000);
const authCookieName = "lelap_auth_token";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 14;
const secureCookie = process.env.COOKIE_SECURE === "true";

const adminEmails = [
  "puguh.legowo.k@gmail.com",
  "refinna.sari.86@gmail.com",
  "refinna.sar.86@gmail.com"
];

const dailyStatuses = [
  "hadir_lengkap",
  "belum_absen",
  "hanya_masuk",
  "hanya_pulang",
  "telat",
  "izin",
  "sakit",
  "cuti",
  "absensi_tidak_lengkap",
  "libur_shift"
];

ensureDirectories();
const store = loadStore();

const server = createServer(async (req, res) => {
  try {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, {
      error: "internal_server_error",
      message: error.message
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Lelap Absensi backend running at http://127.0.0.1:${port}`);
  console.log(`Dashboard: http://127.0.0.1:${port}/absensi`);
});

async function handleApi(req, res, url) {
  const method = req.method || "GET";
  const path = url.pathname;
  const body = ["POST", "PATCH", "PUT"].includes(method) ? await readJsonBody(req) : {};
  const segments = path.split("/").filter(Boolean);

  if (method === "GET" && path === "/api/health") {
    sendJson(res, 200, { ok: true, service: "lelap-absensi-backend", time: nowIso() });
    return;
  }

  if (method === "POST" && path === "/api/auth/login") {
    login(res, body);
    return;
  }

  if (method === "POST" && path === "/api/auth/logout") {
    const session = requireAuth(req, res);
    if (!session) return;
    store.sessions = store.sessions.filter((item) => item.token !== session.token);
    saveStore();
    res.setHeader("Set-Cookie", expiredAuthCookie());
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && path === "/api/auth/me") {
    const context = requireAuth(req, res);
    if (!context) return;
    sendJson(res, 200, publicUser(context.user));
    return;
  }

  if (segments[1] === "mobile") {
    await handleMobile(req, res, method, path, body);
    return;
  }

  if (segments[1] === "admin") {
    await handleAdmin(req, res, method, path, url, body, segments);
    return;
  }

  sendJson(res, 404, { error: "not_found", message: "Endpoint tidak ditemukan." });
}

async function handleMobile(req, res, method, path, body) {
  const context = requireRole(req, res, ["employee"]);
  if (!context) return;

  const employee = employeeForUser(context.user.id);
  if (!employee) {
    sendJson(res, 403, { error: "employee_not_found", message: "Akun belum terhubung ke data karyawan." });
    return;
  }

  if (method === "GET" && path === "/api/mobile/home") {
    const date = todayIsoDate();
    sendJson(res, 200, {
      employee,
      today: date,
      shift: shiftForEmployee(employee.id, date),
      attendance: summaryForEmployeeDate(employee.id, date)
    });
    return;
  }

  if (method === "GET" && path === "/api/mobile/today-attendance") {
    sendJson(res, 200, summaryForEmployeeDate(employee.id, todayIsoDate()));
    return;
  }

  if (method === "GET" && path === "/api/mobile/attendance/history") {
    const rows = store.dailyAttendanceSummaries
      .filter((item) => item.employeeId === employee.id)
      .sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate))
      .slice(0, 60);
    sendJson(res, 200, rows.map(enrichSummary));
    return;
  }

  if (method === "GET" && path === "/api/mobile/schedule") {
    const rows = store.employeeSchedules
      .filter((item) => item.employeeId === employee.id)
      .sort((a, b) => a.workDate.localeCompare(b.workDate));
    sendJson(res, 200, rows);
    return;
  }

  if (method === "POST" && path === "/api/mobile/device/register") {
    if (!body.deviceId) {
      sendJson(res, 422, { error: "validation_error", message: "deviceId wajib diisi." });
      return;
    }
    employee.registeredDeviceId = String(body.deviceId);
    employee.updatedAt = nowIso();
    audit(context.user.id, "employee.device_registered", "employees", employee.id, null, { deviceId: body.deviceId }, "Registrasi device dari aplikasi mobile.");
    saveStore();
    sendJson(res, 200, { ok: true, employee });
    return;
  }

  if (method === "POST" && path === "/api/mobile/attendance/check-in") {
    createAttendance(res, context.user, employee, "check_in", body);
    return;
  }

  if (method === "POST" && path === "/api/mobile/attendance/check-out") {
    createAttendance(res, context.user, employee, "check_out", body);
    return;
  }

  sendJson(res, 404, { error: "not_found", message: "Endpoint mobile tidak ditemukan." });
}

async function handleAdmin(req, res, method, path, url, body, segments) {
  const context = requireRole(req, res, ["admin"]);
  if (!context) return;

  if (method === "GET" && path === "/api/admin/dashboard-summary") {
    const date = url.searchParams.get("date") || todayIsoDate();
    sendJson(res, 200, dashboardSummary(date));
    return;
  }

  if (method === "GET" && path === "/api/admin/attendance/daily") {
    const date = url.searchParams.get("date") || todayIsoDate();
    sendJson(res, 200, dailyAttendance(date));
    return;
  }

  if (method === "GET" && path === "/api/admin/attendance/monthly") {
    const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
    const year = Number(url.searchParams.get("year") || new Date().getFullYear());
    sendJson(res, 200, monthlyAttendance(month, year));
    return;
  }

  if (method === "GET" && segments[2] === "attendance" && segments[3] && segments.length === 4) {
    const summary = store.dailyAttendanceSummaries.find((item) => String(item.id) === segments[3]);
    if (!summary) {
      sendJson(res, 404, { error: "not_found", message: "Data absensi tidak ditemukan." });
      return;
    }
    sendJson(res, 200, enrichSummary(summary));
    return;
  }

  if (method === "PATCH" && segments[2] === "attendance" && segments[3] && segments[4] === "correction") {
    correctAttendance(res, context.user, Number(segments[3]), body);
    return;
  }

  if (method === "GET" && path === "/api/admin/employees") {
    sendJson(res, 200, store.employees.map(enrichEmployee));
    return;
  }

  if (method === "POST" && path === "/api/admin/employees") {
    createEmployee(res, context.user, body);
    return;
  }

  if (method === "PATCH" && segments[2] === "employees" && segments[3] && segments.length === 4) {
    updateEmployee(res, context.user, Number(segments[3]), body);
    return;
  }

  if (method === "PATCH" && segments[2] === "employees" && segments[3] && segments[4] === "reset-device") {
    resetDevice(res, context.user, Number(segments[3]), body);
    return;
  }

  if (method === "GET" && path === "/api/admin/shifts") {
    sendJson(res, 200, store.shifts);
    return;
  }

  if (method === "POST" && path === "/api/admin/shifts") {
    createShift(res, context.user, body);
    return;
  }

  if (method === "PATCH" && segments[2] === "shifts" && segments[3]) {
    updateShift(res, context.user, Number(segments[3]), body);
    return;
  }

  if (method === "GET" && path === "/api/admin/reports/export-excel") {
    exportReport(res, url);
    return;
  }

  if (method === "GET" && path === "/api/admin/reports/export-pdf") {
    exportTextReport(res, url);
    return;
  }

  if (method === "GET" && path === "/api/admin/audit-logs") {
    sendJson(res, 200, store.auditLogs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    return;
  }

  sendJson(res, 404, { error: "not_found", message: "Endpoint admin tidak ditemukan." });
}

function login(res, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const user = store.users.find((item) => item.email.toLowerCase() === email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    sendJson(res, 401, { error: "invalid_credentials", message: "Email atau password salah." });
    return;
  }

  if (!user.isActive) {
    sendJson(res, 403, { error: "account_inactive", message: "Akun dinonaktifkan." });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * sessionMaxAgeSeconds).toISOString();
  user.lastLoginAt = nowIso();
  store.sessions.push({ token, userId: user.id, expiresAt, createdAt: nowIso() });
  saveStore();

  res.setHeader("Set-Cookie", authCookie(token));
  sendJson(res, 200, {
    token,
    expiresAt,
    user: publicUser(user),
    employee: user.role === "employee" ? employeeForUser(user.id) : null
  });
}

function createAttendance(res, user, employee, type, body) {
  const validation = validateAttendancePayload(employee, body);
  if (!validation.ok) {
    sendJson(res, validation.status, { error: validation.error, message: validation.message });
    return;
  }

  const office = activeOffice();
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const distance = round(distanceMeters(latitude, longitude, Number(office.latitude), Number(office.longitude)), 2);
  const outsideOffice = distance > Number(office.radiusMeter);
  const locationType = outsideOffice ? "homecare" : "office";
  const date = body.attendanceDate || todayIsoDate();
  const serverTime = nowIso();
  const record = {
    id: nextId("attendanceRecords"),
    employeeId: employee.id,
    attendanceDate: date,
    attendanceType: type,
    serverTime,
    deviceTime: body.deviceTime || null,
    dayName: dayName(date),
    latitude,
    longitude,
    gpsAddress: String(body.gpsAddress || body.homecareAddress || office.address),
    gpsAccuracyMeter: body.gpsAccuracyMeter ? Number(body.gpsAccuracyMeter) : null,
    distanceFromOffice: distance,
    locationType,
    gpsStatus: "on",
    isMockLocation: Boolean(body.isMockLocation),
    deviceId: String(body.deviceId),
    selfiePhotoPath: persistPhoto(body.selfiePhotoBase64, employee.id, date, type, "selfie", body.selfiePhotoPath),
    watermarkedPhotoPath: persistPhoto(body.watermarkedPhotoBase64, employee.id, date, type, "watermarked", body.watermarkedPhotoPath),
    thumbnailPhotoPath: body.thumbnailPhotoPath || null,
    homecareAddress: outsideOffice ? String(body.homecareAddress) : null,
    homecareNote: outsideOffice ? String(body.homecareNote) : null,
    clientName: outsideOffice ? String(body.clientName || "") : null,
    attendanceStatus: "submitted",
    riskStatus: body.isMockLocation ? "needs_review" : "normal",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (!employee.registeredDeviceId) {
    employee.registeredDeviceId = record.deviceId;
  }

  store.attendanceRecords.push(record);
  const summary = recomputeDailySummary(employee.id, date);
  audit(user.id, `attendance.${type}`, "attendance_records", record.id, null, record, type === "check_in" ? "Absen masuk dari mobile." : "Absen pulang dari mobile.");
  saveStore();

  sendJson(res, 201, {
    ok: true,
    record,
    dailySummary: enrichSummary(summary)
  });
}

function validateAttendancePayload(employee, body) {
  if (!body.deviceId) {
    return { ok: false, status: 422, error: "validation_error", message: "deviceId wajib dikirim." };
  }

  if (employee.registeredDeviceId && employee.registeredDeviceId !== String(body.deviceId)) {
    return {
      ok: false,
      status: 409,
      error: "device_mismatch",
      message: "Akun ini sudah terikat ke device lain. Minta admin reset device ID."
    };
  }

  if (String(body.gpsStatus || "").toLowerCase() !== "on") {
    return { ok: false, status: 422, error: "gps_off", message: "GPS wajib aktif sebelum absen." };
  }

  if (!isFinite(Number(body.latitude)) || !isFinite(Number(body.longitude))) {
    return { ok: false, status: 422, error: "location_missing", message: "Latitude dan longitude wajib valid." };
  }

  if (!body.selfiePhotoBase64 && !body.selfiePhotoPath) {
    return { ok: false, status: 422, error: "photo_required", message: "Foto selfie langsung dari kamera wajib dikirim." };
  }

  const office = activeOffice();
  const distance = distanceMeters(Number(body.latitude), Number(body.longitude), Number(office.latitude), Number(office.longitude));
  const outsideOffice = distance > Number(office.radiusMeter);

  if (outsideOffice && String(body.locationType || "").toLowerCase() !== "homecare") {
    return {
      ok: false,
      status: 422,
      error: "outside_radius",
      message: "Absensi di luar radius kantor wajib memilih status Homecare."
    };
  }

  if (outsideOffice && (!body.homecareAddress || !body.homecareNote)) {
    return {
      ok: false,
      status: 422,
      error: "homecare_required",
      message: "Alamat dan catatan homecare wajib diisi untuk absensi di luar radius kantor."
    };
  }

  return { ok: true };
}

function recomputeDailySummary(employeeId, date) {
  const employee = store.employees.find((item) => item.id === employeeId);
  const shift = shiftForEmployee(employeeId, date);
  const records = store.attendanceRecords.filter((item) => item.employeeId === employeeId && item.attendanceDate === date);
  const checkIn = records.filter((item) => item.attendanceType === "check_in").sort((a, b) => a.serverTime.localeCompare(b.serverTime))[0] || null;
  const checkOut = records.filter((item) => item.attendanceType === "check_out").sort((a, b) => b.serverTime.localeCompare(a.serverTime))[0] || null;
  const leave = leaveForDate(employeeId, date);
  const schedule = scheduleForDate(employeeId, date);
  const now = nowIso();
  let status = "belum_absen";
  let isLate = false;
  let lateMinutes = 0;
  let isIncomplete = false;
  let needsReview = records.some((item) => item.isMockLocation || item.riskStatus === "needs_review");

  if (leave) {
    status = leave.leaveType;
  } else if (schedule?.scheduleStatus === "libur_shift" || isSunday(date)) {
    status = "libur_shift";
  } else if (checkIn && checkOut) {
    const late = lateInfo(checkIn.serverTime, shift);
    isLate = late.isLate;
    lateMinutes = late.minutes;
    status = isLate ? "telat" : "hadir_lengkap";
  } else if (checkIn) {
    const late = lateInfo(checkIn.serverTime, shift);
    isLate = late.isLate;
    lateMinutes = late.minutes;
    status = "hanya_masuk";
    isIncomplete = true;
  } else if (checkOut) {
    status = "hanya_pulang";
    isIncomplete = true;
    needsReview = true;
  }

  if (records.some((item) => !item.selfiePhotoPath || item.gpsStatus !== "on" || !item.latitude || !item.longitude)) {
    status = "absensi_tidak_lengkap";
    isIncomplete = true;
  }

  const existing = store.dailyAttendanceSummaries.find((item) => item.employeeId === employeeId && item.attendanceDate === date);
  const summary = existing || {
    id: nextId("dailyAttendanceSummaries"),
    employeeId,
    attendanceDate: date,
    createdAt: now
  };

  Object.assign(summary, {
    shiftId: shift?.id || employee.defaultShiftId,
    checkInId: checkIn?.id || null,
    checkOutId: checkOut?.id || null,
    checkInTime: checkIn ? timePart(checkIn.serverTime) : null,
    checkOutTime: checkOut ? timePart(checkOut.serverTime) : null,
    dailyStatus: status,
    isLate,
    lateMinutes,
    isHomecare: records.some((item) => item.locationType === "homecare"),
    isIncomplete,
    needsReview,
    adminNote: existing?.adminNote || null,
    updatedAt: now
  });

  if (!existing) {
    store.dailyAttendanceSummaries.push(summary);
  }

  return summary;
}

function correctAttendance(res, admin, summaryId, body) {
  const summary = store.dailyAttendanceSummaries.find((item) => item.id === summaryId);
  if (!summary) {
    sendJson(res, 404, { error: "not_found", message: "Ringkasan absensi tidak ditemukan." });
    return;
  }

  const newStatus = body.dailyStatus || body.status;
  const reason = String(body.reason || body.adminNote || "").trim();

  if (!dailyStatuses.includes(newStatus)) {
    sendJson(res, 422, { error: "validation_error", message: "dailyStatus tidak valid." });
    return;
  }

  if (!reason) {
    sendJson(res, 422, { error: "validation_error", message: "Alasan koreksi wajib diisi." });
    return;
  }

  const oldValue = { ...summary };
  summary.dailyStatus = newStatus;
  summary.adminNote = reason;
  summary.needsReview = Boolean(body.needsReview ?? false);
  summary.isIncomplete = ["hanya_masuk", "hanya_pulang", "absensi_tidak_lengkap"].includes(newStatus);
  summary.isLate = newStatus === "telat" || Boolean(body.isLate);
  summary.updatedAt = nowIso();

  const correction = {
    id: nextId("attendanceCorrections"),
    dailyAttendanceSummaryId: summary.id,
    adminUserId: admin.id,
    correctionType: "status",
    oldValue,
    newValue: { ...summary },
    reason,
    createdAt: nowIso()
  };

  store.attendanceCorrections.push(correction);
  audit(admin.id, "attendance.correction", "daily_attendance_summaries", summary.id, oldValue, summary, reason);
  saveStore();

  sendJson(res, 200, {
    ok: true,
    summary: enrichSummary(summary),
    correction
  });
}

function createEmployee(res, admin, body) {
  const required = ["fullName", "email", "password"];
  const missing = required.filter((key) => !body[key]);
  if (missing.length) {
    sendJson(res, 422, { error: "validation_error", message: `${missing.join(", ")} wajib diisi.` });
    return;
  }

  const email = String(body.email).toLowerCase();
  if (store.users.some((user) => user.email.toLowerCase() === email)) {
    sendJson(res, 409, { error: "email_exists", message: "Email sudah digunakan." });
    return;
  }

  const now = nowIso();
  const user = {
    id: nextId("users"),
    name: String(body.fullName),
    email,
    passwordHash: hashPassword(String(body.password)),
    role: "employee",
    phone: body.phone || null,
    isActive: true,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now
  };

  const employee = {
    id: nextId("employees"),
    userId: user.id,
    employeeCode: body.employeeCode || `EMP-${String(user.id).padStart(4, "0")}`,
    fullName: String(body.fullName),
    position: body.position || null,
    phone: body.phone || null,
    profilePhoto: body.profilePhoto || null,
    defaultShiftId: body.defaultShiftId || store.shifts[0]?.id || null,
    registeredDeviceId: null,
    joinedDate: body.joinedDate || todayIsoDate(),
    status: "active",
    notes: body.notes || null,
    createdAt: now,
    updatedAt: now
  };

  store.users.push(user);
  store.employees.push(employee);
  audit(admin.id, "employee.created", "employees", employee.id, null, employee, "Admin membuat akun karyawan.");
  saveStore();
  sendJson(res, 201, enrichEmployee(employee));
}

function updateEmployee(res, admin, employeeId, body) {
  const employee = store.employees.find((item) => item.id === employeeId);
  if (!employee) {
    sendJson(res, 404, { error: "not_found", message: "Karyawan tidak ditemukan." });
    return;
  }

  const oldValue = { ...employee };
  ["fullName", "position", "phone", "profilePhoto", "defaultShiftId", "joinedDate", "status", "notes"].forEach((key) => {
    if (body[key] !== undefined) employee[key] = body[key];
  });
  employee.updatedAt = nowIso();

  const user = store.users.find((item) => item.id === employee.userId);
  if (user) {
    if (body.fullName !== undefined) user.name = body.fullName;
    if (body.phone !== undefined) user.phone = body.phone;
    user.isActive = employee.status === "active";
    user.updatedAt = nowIso();
  }

  audit(admin.id, "employee.updated", "employees", employee.id, oldValue, employee, body.reason || "Admin memperbarui data karyawan.");
  saveStore();
  sendJson(res, 200, enrichEmployee(employee));
}

function resetDevice(res, admin, employeeId, body) {
  const employee = store.employees.find((item) => item.id === employeeId);
  if (!employee) {
    sendJson(res, 404, { error: "not_found", message: "Karyawan tidak ditemukan." });
    return;
  }

  const oldDeviceId = employee.registeredDeviceId;
  employee.registeredDeviceId = null;
  employee.updatedAt = nowIso();

  const request = {
    id: nextId("deviceResetRequests"),
    employeeId,
    oldDeviceId,
    newDeviceId: null,
    requestedReason: body.reason || "Reset oleh admin.",
    approvedBy: admin.id,
    approvedAt: nowIso(),
    status: "approved",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  store.deviceResetRequests.push(request);
  audit(admin.id, "employee.device_reset", "employees", employee.id, { registeredDeviceId: oldDeviceId }, { registeredDeviceId: null }, request.requestedReason);
  saveStore();
  sendJson(res, 200, { ok: true, employee: enrichEmployee(employee), deviceReset: request });
}

function createShift(res, admin, body) {
  const missing = ["name", "startTime", "endTime"].filter((key) => !body[key]);
  if (missing.length) {
    sendJson(res, 422, { error: "validation_error", message: `${missing.join(", ")} wajib diisi.` });
    return;
  }

  const now = nowIso();
  const shift = {
    id: nextId("shifts"),
    name: String(body.name),
    startTime: body.startTime,
    endTime: body.endTime,
    lateToleranceMinutes: Number(body.lateToleranceMinutes || 15),
    daysApplicable: body.daysApplicable || ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
    isActive: body.isActive ?? true,
    createdAt: now,
    updatedAt: now
  };

  store.shifts.push(shift);
  audit(admin.id, "shift.created", "shifts", shift.id, null, shift, "Admin membuat shift.");
  saveStore();
  sendJson(res, 201, shift);
}

function updateShift(res, admin, shiftId, body) {
  const shift = store.shifts.find((item) => item.id === shiftId);
  if (!shift) {
    sendJson(res, 404, { error: "not_found", message: "Shift tidak ditemukan." });
    return;
  }

  const oldValue = { ...shift };
  ["name", "startTime", "endTime", "lateToleranceMinutes", "daysApplicable", "isActive"].forEach((key) => {
    if (body[key] !== undefined) shift[key] = body[key];
  });
  shift.updatedAt = nowIso();
  audit(admin.id, "shift.updated", "shifts", shift.id, oldValue, shift, body.reason || "Admin memperbarui shift.");
  saveStore();
  sendJson(res, 200, shift);
}

function dashboardSummary(date) {
  const rows = dailyAttendance(date);
  const counts = countStatuses(rows);
  return {
    date,
    totalActiveEmployees: store.employees.filter((item) => item.status === "active").length,
    ...counts,
    missingCheckIn: rows.filter((item) => item.dailyStatus === "belum_absen"),
    missingCheckOut: rows.filter((item) => item.dailyStatus === "hanya_masuk"),
    lateEmployees: rows.filter((item) => item.isLate),
    homecareAttendances: rows.filter((item) => item.isHomecare),
    needsReview: rows.filter((item) => item.needsReview)
  };
}

function dailyAttendance(date) {
  return store.employees
    .filter((employee) => employee.status === "active")
    .map((employee) => {
      const summary = summaryForEmployeeDate(employee.id, date);
      return enrichSummary(summary);
    });
}

function monthlyAttendance(month, year) {
  const days = new Date(year, month, 0).getDate();
  const employees = store.employees.filter((employee) => employee.status === "active");
  return {
    month,
    year,
    days,
    employees: employees.map((employee) => {
      const daily = Array.from({ length: days }, (_, index) => {
        const date = `${year}-${pad(month)}-${pad(index + 1)}`;
        return enrichSummary(summaryForEmployeeDate(employee.id, date));
      });
      return {
        employee: enrichEmployee(employee),
        daily,
        totals: countStatuses(daily)
      };
    })
  };
}

function summaryForEmployeeDate(employeeId, date) {
  const existing = store.dailyAttendanceSummaries.find((item) => item.employeeId === employeeId && item.attendanceDate === date);
  if (existing) return existing;
  return virtualSummary(employeeId, date);
}

function virtualSummary(employeeId, date) {
  const employee = store.employees.find((item) => item.id === employeeId);
  const leave = leaveForDate(employeeId, date);
  const schedule = scheduleForDate(employeeId, date);
  let status = "belum_absen";

  if (leave) status = leave.leaveType;
  if (schedule?.scheduleStatus === "libur_shift" || isSunday(date)) status = "libur_shift";

  return {
    id: `virtual-${employeeId}-${date}`,
    employeeId,
    attendanceDate: date,
    shiftId: schedule?.shiftId || employee?.defaultShiftId || null,
    checkInId: null,
    checkOutId: null,
    checkInTime: null,
    checkOutTime: null,
    dailyStatus: status,
    isLate: false,
    lateMinutes: 0,
    isHomecare: false,
    isIncomplete: false,
    needsReview: false,
    adminNote: null,
    createdAt: null,
    updatedAt: null
  };
}

function countStatuses(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.hadirLengkap += row.dailyStatus === "hadir_lengkap" ? 1 : 0;
      acc.belumAbsen += row.dailyStatus === "belum_absen" ? 1 : 0;
      acc.telat += row.dailyStatus === "telat" || row.isLate ? 1 : 0;
      acc.hanyaMasuk += row.dailyStatus === "hanya_masuk" ? 1 : 0;
      acc.hanyaPulang += row.dailyStatus === "hanya_pulang" ? 1 : 0;
      acc.izin += row.dailyStatus === "izin" ? 1 : 0;
      acc.sakit += row.dailyStatus === "sakit" ? 1 : 0;
      acc.cuti += row.dailyStatus === "cuti" ? 1 : 0;
      acc.absensiTidakLengkap += row.dailyStatus === "absensi_tidak_lengkap" || row.isIncomplete ? 1 : 0;
      acc.liburShift += row.dailyStatus === "libur_shift" ? 1 : 0;
      acc.homecare += row.isHomecare ? 1 : 0;
      acc.perluReview += row.needsReview ? 1 : 0;
      return acc;
    },
    {
      hadirLengkap: 0,
      belumAbsen: 0,
      telat: 0,
      hanyaMasuk: 0,
      hanyaPulang: 0,
      izin: 0,
      sakit: 0,
      cuti: 0,
      absensiTidakLengkap: 0,
      liburShift: 0,
      homecare: 0,
      perluReview: 0
    }
  );
}

function exportReport(res, url) {
  const type = url.searchParams.get("type") || "daily";
  if (type === "monthly") {
    const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
    const year = Number(url.searchParams.get("year") || new Date().getFullYear());
    const data = monthlyAttendance(month, year);
    const header = ["Nama", ...Array.from({ length: data.days }, (_, index) => String(index + 1)), "Hadir", "Telat", "Tidak Lengkap", "Belum Absen", "Izin", "Sakit", "Cuti", "Homecare", "Review"];
    const rows = data.employees.map((item) => [
      item.employee.fullName,
      ...item.daily.map((day) => day.dailyStatus),
      item.totals.hadirLengkap,
      item.totals.telat,
      item.totals.absensiTidakLengkap,
      item.totals.belumAbsen,
      item.totals.izin,
      item.totals.sakit,
      item.totals.cuti,
      item.totals.homecare,
      item.totals.perluReview
    ]);
    sendText(res, 200, toCsv([header, ...rows]), "text/csv; charset=utf-8", `lelap-bulanan-${year}-${pad(month)}.csv`);
    return;
  }

  const date = url.searchParams.get("date") || todayIsoDate();
  const rows = dailyAttendance(date).map((item) => [
    item.attendanceDate,
    item.employee.fullName,
    item.shift?.name || "",
    item.checkInTime || "",
    item.checkOutTime || "",
    item.dailyStatus,
    item.isLate ? "Ya" : "Tidak",
    item.isHomecare ? "Homecare" : "Kantor",
    item.adminNote || ""
  ]);
  sendText(res, 200, toCsv([["Tanggal", "Nama", "Shift", "Jam Masuk", "Jam Pulang", "Status", "Telat", "Lokasi", "Catatan"], ...rows]), "text/csv; charset=utf-8", `lelap-harian-${date}.csv`);
}

function exportTextReport(res, url) {
  const type = url.searchParams.get("type") || "monthly";
  const lines = [];

  if (type === "daily") {
    const date = url.searchParams.get("date") || todayIsoDate();
    const summary = dashboardSummary(date);
    lines.push("Laporan Harian Lelap Absensi", `Tanggal: ${date}`, "");
    lines.push(`Hadir lengkap: ${summary.hadirLengkap}`);
    lines.push(`Telat: ${summary.telat}`);
    lines.push(`Belum absen: ${summary.belumAbsen}`);
    lines.push(`Tidak lengkap: ${summary.absensiTidakLengkap}`);
  } else {
    const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
    const year = Number(url.searchParams.get("year") || new Date().getFullYear());
    const data = monthlyAttendance(month, year);
    lines.push("Laporan Bulanan Lelap Absensi", `Periode: ${pad(month)}-${year}`, "");
    data.employees.forEach((item) => {
      lines.push(`${item.employee.fullName}: hadir ${item.totals.hadirLengkap}, telat ${item.totals.telat}, tidak lengkap ${item.totals.absensiTidakLengkap}, belum absen ${item.totals.belumAbsen}`);
    });
  }

  sendText(res, 200, lines.join("\n"), "text/plain; charset=utf-8", `lelap-report-${type}.txt`);
}

function enrichSummary(summary) {
  const checkIn = store.attendanceRecords.find((item) => item.id === summary.checkInId) || null;
  const checkOut = store.attendanceRecords.find((item) => item.id === summary.checkOutId) || null;
  return {
    ...summary,
    employee: enrichEmployee(store.employees.find((item) => item.id === summary.employeeId)),
    shift: store.shifts.find((item) => item.id === summary.shiftId) || null,
    checkIn,
    checkOut
  };
}

function enrichEmployee(employee) {
  if (!employee) return null;
  const user = store.users.find((item) => item.id === employee.userId);
  return {
    ...employee,
    email: user?.email || null,
    userIsActive: user?.isActive ?? false,
    defaultShift: store.shifts.find((item) => item.id === employee.defaultShiftId) || null
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt
  };
}

function requireRole(req, res, roles) {
  const context = requireAuth(req, res);
  if (!context) return null;
  if (!roles.includes(context.user.role)) {
    sendJson(res, 403, { error: "forbidden", message: "Role tidak memiliki akses ke endpoint ini." });
    return null;
  }
  return context;
}

function requireAuth(req, res) {
  const context = contextFromRequest(req);

  if (!context) {
    sendJson(res, 401, { error: "unauthorized", message: "Token tidak valid atau sudah kadaluarsa." });
    return null;
  }

  return context;
}

function employeeForUser(userId) {
  return store.employees.find((item) => item.userId === userId) || null;
}

function activeOffice() {
  return store.officeLocations.find((item) => item.isActive) || store.officeLocations[0];
}

function shiftForEmployee(employeeId, date) {
  const schedule = scheduleForDate(employeeId, date);
  const employee = store.employees.find((item) => item.id === employeeId);
  return store.shifts.find((item) => item.id === (schedule?.shiftId || employee?.defaultShiftId)) || store.shifts[0] || null;
}

function scheduleForDate(employeeId, date) {
  return store.employeeSchedules.find((item) => item.employeeId === employeeId && item.workDate === date) || null;
}

function leaveForDate(employeeId, date) {
  return store.leaveRequests.find((item) => item.employeeId === employeeId && item.approvalStatus === "approved" && item.startDate <= date && item.endDate >= date) || null;
}

function lateInfo(serverTime, shift) {
  if (!shift) return { isLate: false, minutes: 0 };
  const date = serverTime.slice(0, 10);
  const actual = new Date(serverTime).getTime();
  const threshold = new Date(`${date}T${shift.startTime}`).getTime() + Number(shift.lateToleranceMinutes || 0) * 60_000;
  const minutes = Math.max(0, Math.ceil((actual - threshold) / 60_000));
  return { isLate: minutes > 0, minutes };
}

function persistPhoto(base64, employeeId, date, type, kind, fallbackPath) {
  if (base64) {
    const clean = String(base64).replace(/^data:image\/\w+;base64,/, "");
    const filename = `${employeeId}-${date}-${type}-${kind}-${Date.now()}.jpg`;
    const filePath = join(uploadDir, filename);
    writeFileSync(filePath, Buffer.from(clean, "base64"));
    return `/uploads/${filename}`;
  }

  if (fallbackPath) return String(fallbackPath);
  return `/uploads/placeholder-${employeeId}-${date}-${type}-${kind}.jpg`;
}

async function serveStatic(req, res, url) {
  const originalPathname = decodeURIComponent(url.pathname);

  if (originalPathname === "/") {
    redirect(res, "/absensi");
    return;
  }

  if (originalPathname === "/absensi/login" || originalPathname === "/absensi/login/") {
    if (isAdminRequest(req)) {
      redirect(res, "/absensi");
      return;
    }
    sendFile(res, join(rootDir, "login.html"));
    return;
  }

  const dashboardPath = originalPathname === "/absensi" || originalPathname === "/absensi/" || originalPathname === "/index.html";
  if (dashboardPath && !isAdminRequest(req)) {
    redirect(res, "/absensi/login");
    return;
  }

  let pathname = originalPathname;
  if (pathname === "/absensi" || pathname === "/absensi/") {
    pathname = "/index.html";
  }

  if (pathname.startsWith("/absensi/")) {
    pathname = pathname.replace("/absensi", "");
  }

  if (pathname.startsWith("/uploads/")) {
    const filePath = safeJoin(__dirname, pathname);
    if (filePath && existsSync(filePath)) {
      sendFile(res, filePath);
      return;
    }
  }

  const filePath = safeJoin(rootDir, pathname);
  if (!filePath || !existsSync(filePath)) {
    sendJson(res, 404, { error: "not_found", message: "File tidak ditemukan." });
    return;
  }

  sendFile(res, filePath);
}

function contextFromRequest(req) {
  const header = req.headers.authorization || "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  const cookies = parseCookies(req.headers.cookie || "");
  const token = bearerToken || cookies[authCookieName] || "";
  const session = store.sessions.find((item) => item.token === token);

  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    return null;
  }

  const user = store.users.find((item) => item.id === session.userId);
  if (!user || !user.isActive) {
    return null;
  }

  return { token, session, user };
}

function isAdminRequest(req) {
  const context = contextFromRequest(req);
  return Boolean(context && context.user.role === "admin");
}

function parseCookies(cookieHeader) {
  return String(cookieHeader)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const index = item.indexOf("=");
      if (index === -1) return acc;
      const key = decodeURIComponent(item.slice(0, index));
      const value = decodeURIComponent(item.slice(index + 1));
      acc[key] = value;
      return acc;
    }, {});
}

function authCookie(token) {
  const secure = secureCookie ? "; Secure" : "";
  return `${authCookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}${secure}`;
}

function expiredAuthCookie() {
  const secure = secureCookie ? "; Secure" : "";
  return `${authCookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendFile(res, filePath) {
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
  }[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(readFileSync(filePath));
}

function safeJoin(base, pathname) {
  const target = normalize(join(base, pathname));
  return target.startsWith(normalize(base)) ? target : null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 20_000_000) {
        reject(new Error("Request body terlalu besar."));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Body harus JSON valid."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, payload, contentType, filename) {
  const headers = { "Content-Type": contentType };
  if (filename) headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  res.writeHead(status, headers);
  res.end(payload);
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
}

function ensureDirectories() {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(uploadDir, { recursive: true });
}

function loadStore() {
  if (!existsSync(storePath)) {
    const seed = buildSeedStore();
    writeFileSync(storePath, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(readFileSync(storePath, "utf8"));
}

function saveStore() {
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function buildSeedStore() {
  const now = nowIso();
  const users = [
    ...adminEmails.map((email, index) => ({
      id: index + 1,
      name: index === 0 ? "Puguh Legowo" : `Admin ${index + 1}`,
      email,
      passwordHash: hashPassword("Admin123!"),
      role: "admin",
      phone: null,
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now
    })),
    ...["Sari Wulandari", "Dinda Permata", "Maya Lestari", "Rina Aprilia"].map((name, index) => ({
      id: adminEmails.length + index + 1,
      name,
      email: `${name.split(" ")[0].toLowerCase()}@lelap.web.id`,
      passwordHash: hashPassword("Karyawan123!"),
      role: "employee",
      phone: `08${12 + index}-0000-00${index + 11}`,
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now
    }))
  ];

  const shifts = [
    {
      id: 1,
      name: "Shift Reguler",
      startTime: "08:00:00",
      endTime: "16:00:00",
      lateToleranceMinutes: 15,
      daysApplicable: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      isActive: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 2,
      name: "Shift Pagi Khusus",
      startTime: "07:00:00",
      endTime: "15:00:00",
      lateToleranceMinutes: 10,
      daysApplicable: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      isActive: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 3,
      name: "Shift Homecare",
      startTime: "08:30:00",
      endTime: "17:00:00",
      lateToleranceMinutes: 20,
      daysApplicable: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      isActive: true,
      createdAt: now,
      updatedAt: now
    }
  ];

  const employees = users
    .filter((user) => user.role === "employee")
    .map((user, index) => ({
      id: index + 1,
      userId: user.id,
      employeeCode: `EMP-${String(index + 1).padStart(4, "0")}`,
      fullName: user.name,
      position: ["Terapis Baby Care", "Terapis Mom Care", "Admin Front Office", "Terapis Homecare"][index],
      phone: user.phone,
      profilePhoto: null,
      defaultShiftId: index === 1 ? 2 : index === 3 ? 3 : 1,
      registeredDeviceId: index === 0 ? "LA-ANDROID-001" : null,
      joinedDate: `2026-0${Math.min(index + 1, 6)}-10`,
      status: "active",
      notes: null,
      createdAt: now,
      updatedAt: now
    }));

  return {
    meta: {
      schemaVersion: 1,
      createdAt: now
    },
    users,
    employees,
    shifts,
    employeeSchedules: [],
    attendanceRecords: [],
    dailyAttendanceSummaries: [],
    leaveRequests: [
      {
        id: 1,
        employeeId: 2,
        leaveType: "izin",
        startDate: "2026-06-27",
        endDate: "2026-06-27",
        reason: "Keperluan keluarga.",
        attachmentPath: null,
        approvalStatus: "approved",
        approvedBy: 1,
        approvedAt: now,
        adminNote: "Disetujui owner.",
        createdAt: now,
        updatedAt: now
      }
    ],
    officeLocations: [
      {
        id: 1,
        name: "Lelap Mom Baby Care Salatiga",
        address: "Alamat kantor diinput saat setup awal",
        latitude: -7.33,
        longitude: 110.5,
        radiusMeter: 20,
        isActive: true,
        createdAt: now,
        updatedAt: now
      }
    ],
    attendanceCorrections: [],
    auditLogs: [],
    deviceResetRequests: [],
    sessions: []
  };
}

function nextId(collectionName) {
  const items = store[collectionName] || [];
  const numericIds = items.map((item) => Number(item.id)).filter(Number.isFinite);
  return numericIds.length ? Math.max(...numericIds) + 1 : 1;
}

function audit(adminUserId, action, entityType, entityId, oldValue, newValue, reason) {
  store.auditLogs.push({
    id: nextId("auditLogs"),
    adminUserId,
    action,
    entityType,
    entityId,
    oldValue,
    newValue,
    reason,
    ipAddress: null,
    userAgent: null,
    createdAt: nowIso()
  });
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, encoded) {
  const [method, salt, hash] = String(encoded).split("$");
  if (method !== "scrypt" || !salt || !hash) return false;
  const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const radius = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function timePart(isoDate) {
  return new Date(isoDate).toTimeString().slice(0, 8);
}

function dayName(date) {
  return ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][new Date(`${date}T12:00:00`).getDay()];
}

function isSunday(date) {
  return new Date(`${date}T12:00:00`).getDay() === 0;
}

function pad(value) {
  return String(value).padStart(2, "0");
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
