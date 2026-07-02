CREATE DATABASE IF NOT EXISTS lelap_absensi
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE lelap_absensi;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'employee') NOT NULL DEFAULT 'employee',
  phone VARCHAR(40) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL
);

CREATE TABLE shifts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  late_tolerance_minutes INT UNSIGNED NOT NULL DEFAULT 15,
  days_applicable JSON NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL
);

CREATE TABLE employees (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  employee_code VARCHAR(50) NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  position VARCHAR(120) NULL,
  phone VARCHAR(40) NULL,
  profile_photo VARCHAR(255) NULL,
  default_shift_id BIGINT UNSIGNED NULL,
  registered_device_id VARCHAR(190) NULL,
  joined_date DATE NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  CONSTRAINT employees_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT employees_default_shift_id_fk FOREIGN KEY (default_shift_id) REFERENCES shifts(id)
);

CREATE TABLE employee_schedules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id BIGINT UNSIGNED NOT NULL,
  shift_id BIGINT UNSIGNED NULL,
  work_date DATE NOT NULL,
  schedule_status ENUM('work', 'libur_shift') NOT NULL DEFAULT 'work',
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  UNIQUE KEY employee_schedules_employee_date_unique (employee_id, work_date),
  CONSTRAINT employee_schedules_employee_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT employee_schedules_shift_id_fk FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

CREATE TABLE office_locations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  address TEXT NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  radius_meter INT UNSIGNED NOT NULL DEFAULT 20,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL
);

CREATE TABLE attendance_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id BIGINT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  attendance_type ENUM('check_in', 'check_out') NOT NULL,
  server_time DATETIME NOT NULL,
  device_time DATETIME NULL,
  day_name VARCHAR(20) NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  gps_address TEXT NOT NULL,
  gps_accuracy_meter DECIMAL(8, 2) NULL,
  distance_from_office DECIMAL(10, 2) NULL,
  location_type ENUM('office', 'homecare', 'outside_radius') NOT NULL,
  gps_status ENUM('on', 'off', 'unknown') NOT NULL DEFAULT 'on',
  is_mock_location BOOLEAN NOT NULL DEFAULT FALSE,
  device_id VARCHAR(190) NULL,
  selfie_photo_path VARCHAR(255) NOT NULL,
  watermarked_photo_path VARCHAR(255) NOT NULL,
  thumbnail_photo_path VARCHAR(255) NULL,
  homecare_address TEXT NULL,
  homecare_note TEXT NULL,
  client_name VARCHAR(160) NULL,
  attendance_status VARCHAR(80) NOT NULL,
  risk_status ENUM('normal', 'needs_review', 'invalid') NOT NULL DEFAULT 'normal',
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  INDEX attendance_records_employee_date_idx (employee_id, attendance_date),
  CONSTRAINT attendance_records_employee_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE daily_attendance_summaries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id BIGINT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  shift_id BIGINT UNSIGNED NULL,
  check_in_id BIGINT UNSIGNED NULL,
  check_out_id BIGINT UNSIGNED NULL,
  check_in_time TIME NULL,
  check_out_time TIME NULL,
  daily_status ENUM(
    'hadir_lengkap',
    'belum_absen',
    'hanya_masuk',
    'hanya_pulang',
    'telat',
    'izin',
    'sakit',
    'cuti',
    'absensi_tidak_lengkap',
    'libur_shift'
  ) NOT NULL,
  is_late BOOLEAN NOT NULL DEFAULT FALSE,
  late_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  is_homecare BOOLEAN NOT NULL DEFAULT FALSE,
  is_incomplete BOOLEAN NOT NULL DEFAULT FALSE,
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  admin_note TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  UNIQUE KEY daily_attendance_employee_date_unique (employee_id, attendance_date),
  CONSTRAINT daily_attendance_employee_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT daily_attendance_shift_id_fk FOREIGN KEY (shift_id) REFERENCES shifts(id),
  CONSTRAINT daily_attendance_check_in_id_fk FOREIGN KEY (check_in_id) REFERENCES attendance_records(id),
  CONSTRAINT daily_attendance_check_out_id_fk FOREIGN KEY (check_out_id) REFERENCES attendance_records(id)
);

CREATE TABLE leave_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id BIGINT UNSIGNED NOT NULL,
  leave_type ENUM('izin', 'sakit', 'cuti') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  attachment_path VARCHAR(255) NULL,
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'approved',
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  admin_note TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  CONSTRAINT leave_requests_employee_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT leave_requests_approved_by_fk FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE attendance_corrections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  daily_attendance_summary_id BIGINT UNSIGNED NOT NULL,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  correction_type VARCHAR(80) NOT NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP NULL,
  CONSTRAINT attendance_corrections_summary_id_fk FOREIGN KEY (daily_attendance_summary_id) REFERENCES daily_attendance_summaries(id),
  CONSTRAINT attendance_corrections_admin_user_id_fk FOREIGN KEY (admin_user_id) REFERENCES users(id)
);

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(120) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  reason TEXT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMP NULL,
  INDEX audit_logs_entity_idx (entity_type, entity_id),
  CONSTRAINT audit_logs_admin_user_id_fk FOREIGN KEY (admin_user_id) REFERENCES users(id)
);

CREATE TABLE device_reset_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id BIGINT UNSIGNED NOT NULL,
  old_device_id VARCHAR(190) NULL,
  new_device_id VARCHAR(190) NULL,
  requested_reason TEXT NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  CONSTRAINT device_reset_employee_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT device_reset_approved_by_fk FOREIGN KEY (approved_by) REFERENCES users(id)
);

INSERT INTO shifts (name, start_time, end_time, late_tolerance_minutes, days_applicable, is_active, created_at, updated_at)
VALUES
  ('Shift Reguler', '08:00:00', '16:00:00', 15, JSON_ARRAY('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'), TRUE, NOW(), NOW()),
  ('Shift Homecare', '08:30:00', '17:00:00', 20, JSON_ARRAY('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'), TRUE, NOW(), NOW());

INSERT INTO office_locations (name, address, latitude, longitude, radius_meter, is_active, created_at, updated_at)
VALUES
  ('Lelap Mom Baby Care Salatiga', 'Alamat kantor diinput saat setup awal', -7.3300000, 110.5000000, 20, TRUE, NOW(), NOW());

INSERT INTO users (name, email, password_hash, role, is_active, created_at, updated_at)
VALUES
  ('Puguh Legowo', 'puguh.legowo.k@gmail.com', '$2y$10$replace_with_real_hash', 'admin', TRUE, NOW(), NOW()),
  ('Refinna Sari', 'refinna.sari.86@gmail.com', '$2y$10$replace_with_real_hash', 'admin', TRUE, NOW(), NOW()),
  ('Refinna Sar', 'refinna.sar.86@gmail.com', '$2y$10$replace_with_real_hash', 'admin', TRUE, NOW(), NOW());
