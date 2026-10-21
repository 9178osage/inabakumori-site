// Characters a work title may never contain: C0 controls except tab/LF, DEL, C1 controls,
// and bidi embeddings/overrides/isolates that could hide or reorder visible text.
// Shared by the refresh (before data/creator-updates.json is written) and the build renderer.
export const FORBIDDEN_TITLE_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
