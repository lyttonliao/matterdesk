-- Custom SQL migration file, put your code below! --
CREATE FUNCTION app_user_is_staff() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT EXISTS (SELECT 1 FROM users WHERE id = app_user_id() AND role <> 'client') $$;
--> statement-breakpoint
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notes_select ON notes FOR SELECT
  USING (
    app_user_is_staff()
    AND EXISTS (
      SELECT 1 FROM matter_members mm
      WHERE mm.matter_id = notes.matter_id AND mm.user_id = app_user_id()
    )
  );
--> statement-breakpoint
CREATE POLICY notes_insert ON notes FOR INSERT
  WITH CHECK (
    author_id = app_user_id()
    AND app_user_is_staff()
    AND EXISTS (
      SELECT 1 FROM matter_members mm
      WHERE mm.matter_id = notes.matter_id AND mm.user_id = app_user_id()
    )
  );
  