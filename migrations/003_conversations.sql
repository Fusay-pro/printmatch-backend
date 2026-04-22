-- migrations/003_conversations.sql

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commissioner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  partner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (commissioner_id, partner_user_id)
);

CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id),
  content TEXT,
  msg_type VARCHAR(20) DEFAULT 'text' CHECK (msg_type IN ('text', 'request', 'offer')),
  offer_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conv_commissioner ON conversations(commissioner_id);
CREATE INDEX idx_conv_partner ON conversations(partner_user_id);
CREATE INDEX idx_conv_msg_conv ON conversation_messages(conversation_id);

-- Add if not already present in your running DB
ALTER TABLE printer_profiles
  ADD COLUMN IF NOT EXISTS filaments TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS printer_wattage INT DEFAULT 200;
