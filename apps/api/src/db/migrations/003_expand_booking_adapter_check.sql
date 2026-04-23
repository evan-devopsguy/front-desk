ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_booking_adapter_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_booking_adapter_check
  CHECK (booking_adapter IN ('mock','boulevard','vagaro','google-calendar'));
