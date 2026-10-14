-- Custom SQL migration file, put your code below! --

CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE matters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE matter_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY matter_members_select ON matter_members FOR SELECT
  USING (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY matter_members_insert ON matter_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM matters m
    WHERE m.id = matter_members.matter_id AND m.created_by = app_user_id()
  ));
--> statement-breakpoint
CREATE POLICY matters_select ON matters FOR SELECT
  USING (
    created_by = app_user_id()
    OR EXISTS (
      SELECT 1 FROM matter_members mm
      WHERE mm.matter_id = matters.id AND mm.user_id = app_user_id()
    )
  );
--> statement-breakpoint
CREATE POLICY matters_insert ON matters FOR INSERT
  WITH CHECK (created_by = app_user_id());
--> statement-breakpoint
CREATE POLICY matters_update ON matters FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM matter_members mm
    WHERE mm.matter_id = matters.id AND mm.user_id = app_user_id()
  ));
--> statement-breakpoint
CREATE POLICY documents_all ON documents FOR ALL
  USING (EXISTS (
    SELECT 1 FROM matter_members mm
    WHERE mm.matter_id = documents.matter_id AND mm.user_id = app_user_id()
  ));
--> statement-breakpoint
REVOKE UPDATE ON matters FROM firm_app;
--> statement-breakpoint
GRANT UPDATE (title, status, type, opened_at) ON matters TO firm_app;