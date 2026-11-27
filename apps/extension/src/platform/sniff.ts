// Cheap shape checks for string values, run on every rendered tree row, so
// they never decode or parse. A positive answer only offers an action (Decode
// JWT, Expand JSON); the action itself parses and reports a failure plainly.

// Header and payload of a compact JWS are base64url JSON objects, and base64url
// of '{"' is "eyJ". The signature is empty for alg "none".
const JWT = /^eyJ[\w-]*\.eyJ[\w-]*\.[\w-]*$/;

export function looksLikeJwt(text: string): boolean {
  return JWT.test(text);
}

// After the opening bracket, the first character must be able to start a key
// (for objects) or a value (for arrays), which rules out "[citation needed]".
const OBJECT = /^\{\s*(?:"|\})/;
const ARRAY = /^\[\s*(?:[[{"\d\]-]|true|false|null)/;

export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  const last = trimmed.at(-1);
  return (
    (last === "}" && OBJECT.test(trimmed)) ||
    (last === "]" && ARRAY.test(trimmed))
  );
}
