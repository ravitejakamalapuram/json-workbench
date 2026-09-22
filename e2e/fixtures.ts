export const FIXTURE = [
  { id: 1, name: "Ada", active: true, score: 10 },
  { id: 2, name: "Grace", active: false, score: 20 },
  { id: 3, name: "Linus", active: true, score: 30 },
] as const;

export const FIXTURE_TEXT = JSON.stringify(FIXTURE);

export const EMBEDDED_FIXTURE_TEXT = JSON.stringify([
  { id: 1, payload: '{"nested":true}' },
]);

export const MALFORMED_TEXT = '{"id":oops}';
