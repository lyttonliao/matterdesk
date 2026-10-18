// BIG PICTURE
// Role rules in one place, so action (enforcement) and the page (hiding the form)
// cannot drift apart. The page check is only UX; the action check is the real one
const MATTER_CREATOR_ROLES = new Set(["attorney", "paralegal", "admin"]);
const MATTER_CLOSER_ROLES = new Set(["attorney", "admin"]);
const NOTE_WRITER_ROLES = new Set(["attorney", "paralegal", "admin"]);

export function canCreateMatter(role: string) {
  return MATTER_CREATOR_ROLES.has(role);
}

export function canAddNote(role: string) {
  return NOTE_WRITER_ROLES.has(role);
}

export function canCloseMatter(role: string) {
  return MATTER_CLOSER_ROLES.has(role);
}
