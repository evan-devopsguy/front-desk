ALTER TABLE conversations
  RENAME COLUMN patient_phone_hash TO contact_phone_hash;
ALTER TABLE bookings
  RENAME COLUMN patient_name TO contact_name;
ALTER TABLE bookings
  RENAME COLUMN patient_phone_hash TO contact_phone_hash;
ALTER INDEX IF EXISTS conversations_tenant_phone_idx
  RENAME TO conversations_tenant_contact_idx;
