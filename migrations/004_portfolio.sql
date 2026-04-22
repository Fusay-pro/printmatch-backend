-- Migration 004: printer portfolio showcase
CREATE TABLE IF NOT EXISTS printer_portfolio (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_profile_id UUID NOT NULL REFERENCES printer_profiles(id) ON DELETE CASCADE,
  image_url          TEXT NOT NULL,
  image_key          TEXT,
  caption            TEXT,
  created_at         TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_printer ON printer_portfolio(printer_profile_id);
