// Test tokens are always joined from their parts at run time: a literal JWT in
// a file trips the repository's secret scan.

export function base64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** header.payload.signature, with each JSON part encoded the way an issuer would. */
export function makeToken(
  header: unknown,
  payload: unknown,
  signature = base64url("not a real signature"),
): string {
  return [
    base64url(JSON.stringify(header)),
    base64url(JSON.stringify(payload)),
    signature,
  ].join(".");
}
