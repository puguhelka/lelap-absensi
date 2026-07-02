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

    // Support both /absensi/api/... and /api/... paths (proxy + direct)
    const rawPath = url.pathname;
    let apiPath = rawPath;
    if (apiPath.startsWith("/absensi/")) {
      apiPath = apiPath.replace("/absensi", "");
    }

    if (apiPath.startsWith("/api/")) {
      // Temporarily rewrite for API routing
      url.pathname = apiPath;
      await handleApi(req, res, url);
      url.pathname = rawPath; // restore for serveStatic
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

  if (method === "DELETE" && segments[2] === "employees" && segments[3] && segments.length === 4) {
    deleteEmployee(res, context.user, Number(segments[3]));
    return;
  }

  if (method === "POST" && path === "/api/admin/employees/bulk-delete") {
    bulkDeleteEmployees(res, context.user, body);
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
    sendJson(res, 404, { error: "not_found", message: "Data absensi tidak ditemukan." });
    return;
  }

  const oldValue = { ...summary };
  if (body.adminNote !== undefined) summary.adminNote = body.adminNote;
  if (body.dailyStatus !== undefined) summary.dailyStatus = body.dailyStatus;
  summary.updatedAt = nowIso();
  audit(admin.id, "attendance.correction", "daily_attendance_summaries", summary.id, oldValue, summary, body.adminNote || "Koreksi manual oleh admin.");
  saveStore();
  sendJson(res, 200, enrichSummary(summary));
}

// ── DELETE EMPLOYEE ──────────────────────────────────────────
function deleteEmployee(res, admin, employeeId) {
  const employeeIndex = store.employees.findIndex((item) => item.id === employeeId);
  if (employeeIndex === -1) {
    sendJson(res, 404, { error: "not_found", message: "Karyawan tidak ditemukan." });
    return;
  }

  const employee = store.employees[employeeIndex];

  // Prevent deleting the last admin
  const user = store.users.find((item) => item.id === employee.userId);
  if (user && adminEmails.includes(user.email.toLowerCase())) {
    sendJson(res, 403, { error: "cannot_delete_admin", message: "Tidak bisa menghapus akun admin." });
    return;
  }

  // Remove associated user
  if (user) {
    store.users = store.users.filter((item) => item.id !== user.id);
    store.sessions = store.sessions.filter((item) => item.userId !== user.id);
  }

  // Clean up attendance data
  store.attendanceRecords = store.attendanceRecords.filter((item) => item.employeeId !== employeeId);
  store.dailyAttendanceSummaries = store.dailyAttendanceSummaries.filter((item) => item.employeeId !== employeeId);
  store.employeeSchedules = store.employeeSchedules.filter((item) => item.employeeId !== employeeId);
  store.deviceResetRequests = (store.deviceResetRequests || []).filter((item) => item.employeeId !== employeeId);

  // Remove employee record
  store.employees.splice(employeeIndex, 1);

  audit(admin.id, "employee.deleted", "employees", employeeId, employee, null, `Admin menghapus karyawan: ${employee.fullName}`);
  saveStore();
  sendJson(res, 200, { ok: true, message: `Karyawan ${employee.fullName} berhasil dihapus.` });
}

// ── BULK DELETE EMPLOYEES ────────────────────────────────────
function bulkDeleteEmployees(res, admin, body) {
  const ids = body.ids || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    sendJson(res, 422, { error: "validation_error", message: "ids wajib berupa array dan tidak boleh kosong." });
    return;
  }

  const results = { deleted: [], skipped: [], errors: [] };

  ids.forEach((employeeId) => {
    const index = store.employees.findIndex((item) => item.id === employeeId);
    if (index === -1) {
      results.errors.push({ id: employeeId, reason: "not_found" });
      return;
    }

    const employee = store.employees[index];
    const user = store.users.find((item) => item.id === employee.userId);

    // Skip admin accounts
    if (user && adminEmails.includes(user.email.toLowerCase())) {
      results.skipped.push({ id: employeeId, name: employee.fullName, reason: "akun admin" });
      return;
    }

    // Remove user + sessions
    if (user) {
      store.users = store.users.filter((item) => item.id !== user.id);
      store.sessions = store.sessions.filter((item) => item.userId !== user.id);
    }

    // Clean attendance data
    store.attendanceRecords = store.attendanceRecords.filter((item) => item.employeeId !== employeeId);
    store.dailyAttendanceSummaries = store.dailyAttendanceSummaries.filter((item) => item.employeeId !== employeeId);
    store.employeeSchedules = store.employeeSchedules.filter((item) => item.employeeId !== employeeId);
    store.deviceResetRequests = (store.deviceResetRequests || []).filter((item) => item.employeeId !== employeeId);

    // Remove employee
    store.employees.splice(index, 1);
    results.deleted.push({ id: employeeId, name: employee.fullName });

    audit(admin.id, "employee.deleted", "employees", employeeId, employee, null, `Admin menghapus karyawan: ${employee.fullName}`);
  });

  saveStore();
  sendJson(res, 200, {
    ok: true,
    message: `${results.deleted.length} karyawan berhasil dihapus.${results.skipped.length ? ` ${results.skipped.length} dilewati (admin).` : ""}${results.errors.length ? ` ${results.errors.length} gagal.` : ""}`,
    results
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
  audit(admin.id, "employee.device_reset", "employees", employee.id, { oldDeviceId }, { registeredDeviceId: null }, "Admin mereset device ID.");
  saveStore();
  sendJson(res, 200, { ok: true, deviceResetRequest: request, employee: enrichEmployee(employee) });
}

// ── SHIFT CRUD (minimal) ─────────────────────────────────────
function createShift(res, admin, body) {
  if (!body.name || !body.start || !body.end) {
    sendJson(res, 422, { error: "validation_error", message: "Nama, jam masuk, dan jam pulang wajib diisi." });
    return;
  }
  const shift = {
    id: nextId("shifts"),
    name: String(body.name),
    start: String(body.start),
    end: String(body.end),
    tolerance: body.tolerance !== undefined ? Number(body.tolerance) : 15,
    days: body.days || "Senin-Minggu",
    active: body.active !== false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  store.shifts.push(shift);
  audit(admin.id, "shift.created", "shifts", shift.id, null, shift, "Admin menambah shift baru.");
  saveStore();
  sendJson(res, 201, shift);
}

function updateShift(res, admin, shiftId, body) {
  const shift = store.shifts.find((item) => item.id === shiftId);
  if (!shift) {
    sendJson(res, 404, { error: "not_found", message: "Shift tidak ditemukan." });
    return;
  }
  const old = { ...shift };
  ["name", "start", "end", "tolerance", "days", "active"].forEach((key) => {
    if (body[key] !== undefined) shift[key] = body[key];
  });
  shift.updatedAt = nowIso();
  audit(admin.id, "shift.updated", "shifts", shift.id, old, shift, "Admin memperbarui shift.");
  saveStore();
  sendJson(res, 200, shift);
}

// ── SUMMARY / DASHBOARD ─────────────────────────────────────
function dashboardSummary(date) {
  const dateEmployees = store.employees.filter((item) => item.status === "active");
  const summaries = store.dailyAttendanceSummaries.filter((item) => item.attendanceDate === date);
  const counts = { total: dateEmployees.length, hadir_lengkap: 0, belum_absen: 0, hanya_masuk: 0, hanya_pulang: 0, telat: 0, izin: 0, sakit: 0, cuti: 0, absensi_tidak_lengkap: 0, libur_shift: 0 };

  summaries.forEach((s) => {
    if (counts[s.dailyStatus] !== undefined) counts[s.dailyStatus]++;
  });

  // Remaining are "belum_absen"
  const accounted = Object.entries(counts).filter(([k]) => k !== "total" && k !== "belum_absen").reduce((sum, [, v]) => sum + v, 0);
  counts.belum_absen = Math.max(0, counts.total - accounted);

  return {
    date,
    counts,
    homecare: summaries.filter((item) => item.isHomecare).length,
    needsReview: summaries.filter((item) => item.needsReview).length,
    summaries: summaries.map(enrichSummary),
    employeesWithoutSummary: dateEmployees.filter((emp) => !summaries.some((s) => s.employeeId === emp.id)).map(enrichEmployee)
  };
}

function dailyAttendance(date) {
  return store.employees
    .filter((item) => item.status === "active")
    .map((emp) => {
      const summary = store.dailyAttendanceSummaries.find((s) => s.employeeId === emp.id && s.attendanceDate === date);
      const records = store.attendanceRecords.filter((r) => r.employeeId === emp.id && r.attendanceDate === date);
      const shift = shiftForEmployee(emp.id, date);
      const leave = leaveForDate(emp.id, date);
      const schedule = scheduleForDate(emp.id, date);
      return {
        employee: enrichEmployee(emp),
        summary: summary ? enrichSummary(summary) : null,
        shift,
        leave,
        schedule,
        records: records.sort((a, b) => a.serverTime.localeCompare(b.serverTime))
      };
    });
}

function monthlyAttendance(month, year) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dateStr = (day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const employees = store.employees.filter((item) => item.status === "active");

  const rows = employees.map((emp) => {
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = dateStr(d);
      const summary = store.dailyAttendanceSummaries.find((s) => s.employeeId === emp.id && s.attendanceDate === date);
      const leave = leaveForDate(emp.id, date);
      const schedule = scheduleForDate(emp.id, date);

      let status = summary?.dailyStatus || (leave ? leave.leaveType : "belum_absen");
      if (isSunday(date) && status === "belum_absen") {
        status = "libur_shift";
      }
      if (schedule?.scheduleStatus === "libur_shift") {
        status = "libur_shift";
      }

      days.push({
        day: d,
        date,
        status,
        homecare: summary?.isHomecare || false,
        checkInTime: summary?.checkInTime || null,
        checkOutTime: summary?.checkOutTime || null,
        needsReview: summary?.needsReview || false,
        adminNote: summary?.adminNote || null,
        isIncomplete: summary?.isIncomplete || false
      });
    }
    return { employee: enrichEmployee(emp), days };
  });

  return { month, year, daysInMonth, rows };
}

function exportReport(res, url) {
  const type = url.searchParams.get("type") || "daily";
  const date = url.searchParams.get("date") || todayIsoDate();
  const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());

  let rows = [];
  if (type === "daily") {
    const data = dailyAttendance(date);
    rows = data.map((item) => ({
      Nama: item.employee.fullName,
      Jabatan: item.employee.position,
      Shift: item.shift?.name || "-",
      "Jam Masuk": item.summary?.checkInTime || "-",
      "Jam Pulang": item.summary?.checkOutTime || "-",
      Status: item.summary?.dailyStatus || "belum_absen",
      Homecare: item.summary?.isHomecare ? "Ya" : "Tidak",
      "Perlu Review": item.summary?.needsReview ? "Ya" : "Tidak",
    }));
  } else if (type === "monthly") {
    const data = monthlyAttendance(month, year);
    rows = data.rows.map((item) => {
      const hadir = item.days.filter((d) => d.status === "hadir_lengkap").length;
      const telat = item.days.filter((d) => d.status === "telat").length;
      const alpha = item.days.filter((d) => d.status === "belum_absen").length;
      const izin = item.days.filter((d) => d.status === "izin").length;
      const sakit = item.days.filter((d) => d.status === "sakit").length;
      return {
        Nama: item.employee.fullName,
        Jabatan: item.employee.position,
        Hadir: hadir,
        Telat: telat,
        Alpha: alpha,
        Izin: izin,
        Sakit: sakit,
        TotalHari: item.days.length
      };
    });
  }

  sendJson(res, 200, { type, date: type === "daily" ? date : null, month: type === "monthly" ? month : null, year: type === "monthly" ? year : null, rows });
}

function exportTextReport(res, url) {
  const type = url.searchParams.get("type") || "daily";
  const date = url.searchParams.get("date") || todayIsoDate();
  const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());
  let text = `LAPORAN ABSENSI ${type === "daily" ? `HARIAN - ${date}` : `BULANAN - ${month}/${year}`}\n${"=".repeat(50)}\n\n`;

  if (type === "daily") {
    const data = dailyAttendance(date);
    data.forEach((item) => {
      text += `${item.employee.fullName} (${item.employee.position})\n`;
      text += `  Shift: ${item.shift?.name || "-"} | Masuk: ${item.summary?.checkInTime || "-"} | Pulang: ${item.summary?.checkOutTime || "-"}\n`;
      text += `  Status: ${item.summary?.dailyStatus || "belum_absen"}${item.summary?.isHomecare ? " [Homecare]" : ""}\n\n`;
    });
  } else if (type === "monthly") {
    const data = monthlyAttendance(month, year);
    data.rows.forEach((item) => {
      const hadir = item.days.filter((d) => d.status === "hadir_lengkap").length;
      const telat = item.days.filter((d) => d.status === "telat").length;
      const alpha = item.days.filter((d) => d.status === "belum_absen").length;
      text += `${item.employee.fullName} - Hadir: ${hadir}, Telat: ${telat}, Alpha: ${alpha}\n`;
    });
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

// ── HELPERS ──────────────────────────────────────────────────
function nowIso() { return new Date().toISOString(); }
function todayIsoDate() { return nowIso().slice(0, 10); }
function timePart(iso) { return iso ? iso.slice(11, 19) : null; }
function dayName(dateStr) {
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  return days[new Date(dateStr + "T00:00:00").getDay()] || "";
}
function isSunday(dateStr) { return new Date(dateStr + "T00:00:00").getDay() === 0; }

function nextId(collectionName) {
  const seq = store.sequences || {};
  seq[collectionName] = (seq[collectionName] || 0) + 1;
  store.sequences = seq;
  return seq[collectionName];
}

function round(value, decimals) { return Number(Math.round(Number(value + "e" + decimals)) + "e-" + decimals); }

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  // Support both scrypt$salt$hash (legacy) and salt:hash formats
  let salt, hash;
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    salt = parts[1];
    hash = parts[2];
  } else {
    [salt, hash] = stored.split(":");
  }
  const derived = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(hash), Buffer.from(derived));
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

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Cookie");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendFile(res, filePath) {
  const mimeMap = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".pdf": "application/pdf"
  };
  const ext = extname(filePath).toLowerCase();
  const contentType = mimeMap[ext] || "application/octet-stream";
  const content = readFileSync(filePath);
  const isHtml = ext === ".html";
  const cacheControl = isHtml ? "public, max-age=0, must-revalidate" : "public, max-age=0, must-revalidate";
  const surrogate = "max-age=0";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Surrogate-Control": surrogate
  });
  res.end(content);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function safeJoin(base, target) {
  const fullPath = normalize(join(base, target));
  if (!fullPath.startsWith(normalize(base))) return null;
  return fullPath;
}

function requireAuth(req, res) {
  const header = req.headers.authorization || "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  const cookies = parseCookies(req.headers.cookie || "");
  const token = bearerToken || cookies[authCookieName] || "";
  const session = store.sessions.find((item) => item.token === token);

  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    sendJson(res, 401, { error: "unauthorized", message: "Sesi tidak valid atau sudah habis." });
    return null;
  }

  const user = store.users.find((item) => item.id === session.userId);
  if (!user || !user.isActive) {
    sendJson(res, 401, { error: "unauthorized", message: "Akun tidak aktif." });
    return null;
  }

  return { token, session, user };
}

function requireRole(req, res, roles) {
  const context = requireAuth(req, res);
  if (!context) return null;
  if (!roles.includes(context.user.role)) {
    sendJson(res, 403, { error: "forbidden", message: `Akses khusus: ${roles.join(" / ")}.` });
    return null;
  }
  return context;
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

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone };
}

function employeeForUser(userId) {
  return store.employees.find((item) => item.userId === userId) || null;
}

function shiftForEmployee(employeeId, date) {
  const employee = store.employees.find((item) => item.id === employeeId);
  if (!employee) return null;
  const shiftId = employee.defaultShiftId;
  if (!shiftId) return null;
  return store.shifts.find((item) => item.id === shiftId) || null;
}

function leaveForDate(employeeId, date) {
  return store.employeeLeaves?.find((item) => item.employeeId === employeeId && date >= item.startDate && date <= item.endDate && item.status === "approved") || null;
}

function scheduleForDate(employeeId, date) {
  return store.employeeSchedules?.find((item) => item.employeeId === employeeId && item.workDate === date) || null;
}

function summaryForEmployeeDate(employeeId, date) {
  const summary = store.dailyAttendanceSummaries.find((item) => item.employeeId === employeeId && item.attendanceDate === date);
  return summary ? enrichSummary(summary) : null;
}

function lateInfo(serverTimeIso, shift) {
  if (!shift || !serverTimeIso) return { isLate: false, minutes: 0 };
  const time = timePart(serverTimeIso);
  if (!time || !shift.start) return { isLate: false, minutes: 0 };
  const [h, m] = time.split(":").map(Number);
  const [sh, sm] = shift.start.split(":").map(Number);
  const threshold = sh * 60 + sm + (shift.tolerance || 15);
  const actual = h * 60 + m;
  if (actual <= threshold) return { isLate: false, minutes: 0 };
  return { isLate: true, minutes: actual - threshold };
}

function enrichEmployee(employee) {
  if (!employee) return null;
  const user = store.users.find((item) => item.id === employee.userId);
  const shift = store.shifts.find((item) => item.id === employee.defaultShiftId);
  return {
    ...employee,
    email: user?.email || null,
    isActive: user?.isActive ?? true,
    shiftName: shift?.name || "-",
    role: user?.role || null
  };
}

function enrichSummary(summary) {
  if (!summary) return null;
  const employee = store.employees.find((item) => item.id === summary.employeeId);
  return {
    ...summary,
    employeeName: employee?.fullName || "—",
    employeePosition: employee?.position || "—"
  };
}

const statusLabels = {
  hadir_lengkap: "Hadir Lengkap",
  belum_absen: "Belum Absen",
  hanya_masuk: "Hanya Masuk",
  hanya_pulang: "Hanya Pulang",
  telat: "Telat",
  izin: "Izin",
  sakit: "Sakit",
  cuti: "Cuti",
  absensi_tidak_lengkap: "Absensi Tidak Lengkap",
  libur_shift: "Libur Shift"
};

function activeOffice() {
  return store.office || { name: "Kantor Pusat", address: "Alamat kantor", latitude: "-7.330000", longitude: "110.500000", radiusMeter: 20 };
}

function persistPhoto(base64, employeeId, date, type, label, existingPath) {
  if (existingPath && existsSync(existingPath)) return existingPath;
  if (!base64) return null;

  try {
    ensureDirectories();
    const folder = join(uploadDir, String(employeeId), date);
    mkdirSync(folder, { recursive: true });
    const filename = `${type}_${label}_${Date.now()}.jpg`;
    const filePath = join(folder, filename);
    const buffer = Buffer.from(base64, "base64");
    writeFileSync(filePath, buffer);
    return filePath;
  } catch {
    return null;
  }
}

function ensureDirectories() {
  [dataDir, uploadDir].forEach((dir) => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  });
}

function loadStore() {
  if (!existsSync(storePath)) return defaultStore();
  try {
    return JSON.parse(readFileSync(storePath, "utf-8"));
  } catch {
    return defaultStore();
  }
}

function saveStore() {
  try {
    ensureDirectories();
    writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save store:", err.message);
  }
}

function defaultStore() {
  return {
    sequences: { users: 7, employees: 5, shifts: 4, attendanceRecords: 0, dailyAttendanceSummaries: 0, sessions: 0, deviceResetRequests: 0, employeeLeaves: 0, employeeSchedules: 0, auditLogs: 0 },
    users: [
      { id: 1, name: "Puguh Legowo", email: "puguh.legowo.k@gmail.com", passwordHash: hashPassword("Admin123!"), role: "admin", phone: null, isActive: true, lastLoginAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 2, name: "Finna Refina", email: "refinna.sari.86@gmail.com", passwordHash: hashPassword("Admin123!"), role: "admin", phone: null, isActive: true, lastLoginAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 3, name: "Sari Wulandari", email: "sari@lelap.web.id", passwordHash: hashPassword("Karyawan123!"), role: "employee", phone: "0812-1100-2233", isActive: true, lastLoginAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 4, name: "Dinda Permata", email: "dinda@lelap.web.id", passwordHash: hashPassword("Karyawan123!"), role: "employee", phone: "0813-2200-3344", isActive: true, lastLoginAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 5, name: "Maya Lestari", email: "maya@lelap.web.id", passwordHash: hashPassword("Karyawan123!"), role: "employee", phone: "0821-3300-4455", isActive: true, lastLoginAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 6, name: "Rina Aprilia", email: "rina@lelap.web.id", passwordHash: hashPassword("Karyawan123!"), role: "employee", phone: "0857-4400-5566", isActive: true, lastLoginAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 7, name: "Tika Handayani", email: "tika@lelap.web.id", passwordHash: hashPassword("Karyawan123!"), role: "employee", phone: "0878-5500-6677", isActive: true, lastLoginAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    ],
    employees: [
      { id: 1, userId: 3, employeeCode: "EMP-0001", fullName: "Sari Wulandari", position: "Terapis Baby Care", phone: "0812-1100-2233", profilePhoto: null, defaultShiftId: 1, registeredDeviceId: null, joinedDate: "2025-09-12", status: "active", notes: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 2, userId: 4, employeeCode: "EMP-0002", fullName: "Dinda Permata", position: "Terapis Mom Care", phone: "0813-2200-3344", profilePhoto: null, defaultShiftId: 2, registeredDeviceId: null, joinedDate: "2025-11-04", status: "active", notes: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 3, userId: 5, employeeCode: "EMP-0003", fullName: "Maya Lestari", position: "Admin Front Office", phone: "0821-3300-4455", profilePhoto: null, defaultShiftId: 1, registeredDeviceId: null, joinedDate: "2024-06-18", status: "active", notes: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 4, userId: 6, employeeCode: "EMP-0004", fullName: "Rina Aprilia", position: "Terapis Homecare", phone: "0857-4400-5566", profilePhoto: null, defaultShiftId: 4, registeredDeviceId: null, joinedDate: "2026-01-06", status: "active", notes: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 5, userId: 7, employeeCode: "EMP-0005", fullName: "Tika Handayani", position: "Terapis Baby Spa", phone: "0878-5500-6677", profilePhoto: null, defaultShiftId: 3, registeredDeviceId: null, joinedDate: "2026-03-15", status: "active", notes: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    ],
    shifts: [
      { id: 1, name: "Shift Reguler", start: "08:00", end: "16:00", tolerance: 15, days: "Senin-Sabtu", active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 2, name: "Shift Pagi Khusus", start: "07:00", end: "15:00", tolerance: 10, days: "Senin-Jumat", active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 3, name: "Shift Siang", start: "10:00", end: "18:00", tolerance: 15, days: "Senin-Sabtu", active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: 4, name: "Shift Homecare", start: "08:30", end: "17:00", tolerance: 20, days: "Sesuai jadwal", active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    ],
    office: { name: "Lelap Mom Baby Care Salatiga", address: "Jl. Taman Pahlawan 81, Salatiga", latitude: "-7.330000", longitude: "110.500000", radiusMeter: 20 },
    attendanceRecords: [],
    dailyAttendanceSummaries: [],
    employeeLeaves: [],
    employeeSchedules: [],
    deviceResetRequests: [],
    auditLogs: [],
    sessions: []
  };
}

function audit(userId, action, entityType, entityId, oldValue, newValue, description) {
  store.auditLogs.push({
    id: nextId("auditLogs"),
    userId,
    action,
    entityType,
    entityId,
    oldValue,
    newValue,
    description,
    ipAddress: null,
    createdAt: nowIso()
  });
}

async function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

// ── STATIC FILE SERVING ──────────────────────────────────────
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

  const dashboardPath = originalPathname === "/absensi/app" || originalPathname === "/absensi/app/" || originalPathname === "/app.html";
  if (dashboardPath && !isAdminRequest(req)) {
    redirect(res, "/absensi/login");
    return;
  }

  // Redirect /absensi → /absensi/app/ for cache bust
  if (originalPathname === "/absensi" || originalPathname === "/absensi/") {
    redirect(res, "/absensi/app/");
    return;
  }

  let pathname = originalPathname;
  if (pathname === "/absensi/app" || pathname === "/absensi/app/") {
    pathname = "/app.html";
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
