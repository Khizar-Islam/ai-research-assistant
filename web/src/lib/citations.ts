// The backend's citation marker syntax (citations.ts): [1]  [1, 2]  [1,2,3]; [1][3] is two
// groups. Includes the spaces before a group: footnote numbers sit right against the word.
export const MARKER_GROUP = /[ \t]*\[\s*\d+\s*(?:,\s*\d+\s*)*\]/g;

// An answer as plain prose, for reading aloud: "…in 1822 [1]." → "…in 1822."
export const stripMarkers = (text: string) => text.replace(MARKER_GROUP, "");
