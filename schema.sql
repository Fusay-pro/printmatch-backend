-- PrintMatch Database Schema
-- PostgreSQL

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  address TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PRINTER PROFILES (optional seller side)
-- ─────────────────────────────────────────
CREATE TABLE printer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  bio TEXT,
  rate_per_hour DECIMAL(10,2) NOT NULL DEFAULT 0,
  material_prices JSONB NOT NULL DEFAULT '{}',
  printers_owned TEXT[] DEFAULT '{}',
  avg_rating DECIMAL(3,2) DEFAULT 0,
  total_reviews INT DEFAULT 0,
  jobs_completed INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  is_available BOOLEAN DEFAULT TRUE,
  -- Partner application fields
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  province VARCHAR(100),
  district VARCHAR(100),
  phone VARCHAR(30),
  line_id VARCHAR(100),
  printer_photo_url TEXT,
  id_photo_url TEXT,
  reject_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- JOBS
-- ─────────────────────────────────────────
CREATE TYPE job_status AS ENUM (
  'open',
  'in_progress',
  'printing',
  'shipped',
  'delivered',
  'closed',
  'failed',
  'disputed',
  'cancelled'
);

CREATE TYPE complexity_level AS ENUM ('simple', 'medium', 'complex');
CREATE TYPE material_type AS ENUM ('PLA', 'ABS', 'PETG', 'resin', 'TPU', 'nylon', 'other');

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commissioner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  material material_type NOT NULL,
  estimated_weight_g DECIMAL(8,2),
  estimated_time_hr DECIMAL(6,2),
  complexity complexity_level NOT NULL DEFAULT 'medium',
  is_rush BOOLEAN DEFAULT FALSE,
  budget_max DECIMAL(10,2) NOT NULL,
  stl_file_url TEXT,
  status job_status DEFAULT 'open',
  assigned_printer_id UUID REFERENCES printer_profiles(id) ON DELETE SET NULL,
  tracking_number VARCHAR(100),
  courier VARCHAR(100),
  shipped_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- QUOTES
-- ─────────────────────────────────────────
CREATE TYPE quote_status AS ENUM ('pending', 'accepted', 'rejected');

CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  printer_id UUID REFERENCES printer_profiles(id) ON DELETE CASCADE,
  suggested_price DECIMAL(10,2) NOT NULL,
  final_price DECIMAL(10,2) NOT NULL,
  note TEXT,
  estimated_days INT,
  status quote_status DEFAULT 'pending',
  match_score DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PAYMENTS / ESCROW
-- ─────────────────────────────────────────
CREATE TYPE payment_status AS ENUM (
  'held',
  'released',
  'refunded',
  'partial_refund',
  'disputed',
  'frozen'
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL UNIQUE,
  commissioner_id UUID REFERENCES users(id),
  printer_id UUID REFERENCES printer_profiles(id),
  amount DECIMAL(10,2) NOT NULL,
  refund_amount DECIMAL(10,2) DEFAULT 0,
  status payment_status DEFAULT 'held',
  escrow_released_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PROGRESS UPDATES
-- ─────────────────────────────────────────
CREATE TABLE progress_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  printer_id UUID REFERENCES printer_profiles(id),
  message TEXT,
  photo_url TEXT,
  percent_complete INT CHECK (percent_complete BETWEEN 0 AND 100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- FAILURE REPORTS
-- ─────────────────────────────────────────
CREATE TYPE failure_reason AS ENUM ('printer_fault', 'material_issue', 'external');

CREATE TABLE failure_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  printer_id UUID REFERENCES printer_profiles(id),
  reason failure_reason NOT NULL,
  note TEXT,
  reprint_requested BOOLEAN DEFAULT FALSE,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- REVIEWS
-- ─────────────────────────────────────────
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE UNIQUE,
  commissioner_id UUID REFERENCES users(id),
  printer_id UUID REFERENCES printer_profiles(id),
  rating INT CHECK (rating BETWEEN 1 AND 5) NOT NULL,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- MESSAGES (chat per job)
-- ─────────────────────────────────────────
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- APPEALS
-- ─────────────────────────────────────────
CREATE TABLE appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL DEFAULT 'other',
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','resolved')),
  admin_reply TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────
CREATE INDEX idx_jobs_commissioner ON jobs(commissioner_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_assigned_printer ON jobs(assigned_printer_id);
CREATE INDEX idx_quotes_job ON quotes(job_id);
CREATE INDEX idx_quotes_printer ON quotes(printer_id);
CREATE INDEX idx_messages_job ON messages(job_id);
CREATE INDEX idx_progress_job ON progress_updates(job_id);
CREATE INDEX idx_reviews_printer ON reviews(printer_id);
CREATE INDEX idx_printer_user ON printer_profiles(user_id);

-- ─────────────────────────────────────────
-- AUTO-UPDATE updated_at on jobs
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
