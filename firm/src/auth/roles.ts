// BIG PICTURE
// Role rules in one place, so action (enforcement) and the page (hiding the form)
// cannot drift apart. The page check is only UX; the action check is the real one
const MATTER_CREATOR_ROLES = new Set(["attorney", "paralegal", "admin"]);

export function canCreateMatter(role: string) {
  return MATTER_CREATOR_ROLES.has(role);
}
