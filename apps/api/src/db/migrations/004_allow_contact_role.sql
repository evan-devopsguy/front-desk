ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_role_check
  CHECK (role IN ('patient','contact','assistant','system','tool'));
