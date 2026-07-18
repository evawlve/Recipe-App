-- Fire a NOTIFY on the 'embed_pending' channel whenever rows are inserted into
-- OffFood, so the external GPU embedder (embed_foods.py --listen on the Windows
-- PC) wakes and embeds the new rows in real time instead of polling.
--
-- Statement-level (FOR EACH STATEMENT) so a bulk `createMany` from delta ingest
-- fires exactly one notification, not one per row. The notification is delivered
-- at COMMIT, so the listener always sees the rows when it reconciles.
CREATE OR REPLACE FUNCTION notify_embed_pending() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('embed_pending', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS off_food_embed_notify ON "OffFood";
CREATE TRIGGER off_food_embed_notify
  AFTER INSERT ON "OffFood"
  FOR EACH STATEMENT
  EXECUTE FUNCTION notify_embed_pending();
