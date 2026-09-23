import {
  createPipeline,
  stringifyJsonValue,
  type JsonObject,
  type JsonValue,
  type PipelineDefinition,
} from "@json-workbench/core";

/**
 * First-run sample dataset. Everything here is synthetic and generated
 * locally from a fixed seed, so the sample is identical on every machine,
 * needs no network access, and contains no real personal data (emails use
 * the reserved example.com domain).
 */

export const SAMPLE_FILE_NAME = "sample-orders.json";
export const SAMPLE_ORDER_COUNT = 80;

export const SAMPLE_SQL_QUERY = [
  "SELECT status,",
  "  COUNT(*) AS orders,",
  "  ROUND(SUM(total), 2) AS revenue",
  "FROM read_json_auto('source.json')",
  "GROUP BY status",
  "ORDER BY revenue DESC",
].join("\n");

const FIRST_NAMES = [
  "Ada",
  "Bruno",
  "Chen",
  "Dara",
  "Elif",
  "Farah",
  "Goran",
  "Hana",
  "Ivo",
  "Jun",
  "Kiri",
  "Lena",
  "Milo",
  "Nia",
  "Omar",
  "Priya",
];
const LAST_NAMES = [
  "Sample",
  "Example",
  "Placeholder",
  "Testwell",
  "Mockridge",
  "Fixture",
  "Demoson",
  "Stubbs",
];
const COUNTRIES = ["US", "DE", "IN", "BR", "JP", "GB", "CA", "FR"];
const STATUSES = [
  "shipped",
  "shipped",
  "shipped",
  "delivered",
  "processing",
  "cancelled",
];
const PRODUCTS: ReadonlyArray<{ sku: string; name: string; price: number }> = [
  { sku: "KB-101", name: "Mechanical keyboard", price: 89.5 },
  { sku: "MS-220", name: "Wireless mouse", price: 24.99 },
  { sku: "MN-270", name: "27-inch monitor", price: 229 },
  { sku: "HD-050", name: "USB-C hub", price: 39.95 },
  { sku: "CB-003", name: "Braided cable", price: 9.99 },
  { sku: "HS-310", name: "Noise-cancelling headset", price: 149 },
  { sku: "DK-900", name: "Standing desk mat", price: 45 },
  { sku: "LP-014", name: "Laptop stand", price: 32.5 },
];

/** Small deterministic PRNG (mulberry32) so the sample never changes. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Builds a realistic nested "orders API" response as plain JSON values. */
export function createSampleOrders(count = SAMPLE_ORDER_COUNT): JsonObject[] {
  const random = seededRandom(20260923);
  const start = Date.UTC(2026, 0, 1);
  const orders: JsonObject[] = [];
  for (let index = 0; index < count; index++) {
    const first = pick(random, FIRST_NAMES);
    const last = pick(random, LAST_NAMES);
    const itemCount = 1 + Math.floor(random() * 3);
    const items: JsonObject[] = [];
    for (let item = 0; item < itemCount; item++) {
      const product = pick(random, PRODUCTS);
      items.push({
        sku: product.sku,
        name: product.name,
        quantity: 1 + Math.floor(random() * 3),
        price: product.price,
      });
    }
    const subtotal = round2(
      items.reduce(
        (sum, item) => sum + (item.quantity as number) * (item.price as number),
        0,
      ),
    );
    const createdAt = new Date(
      start + Math.floor(random() * 240) * 86_400_000,
    ).toISOString();
    orders.push({
      id: `ord_${String(1001 + index)}`,
      status: pick(random, STATUSES),
      createdAt,
      customer: {
        id: `cus_${String(1 + Math.floor(random() * 60)).padStart(3, "0")}`,
        name: `${first} ${last}`,
        email: `${first}.${last}@example.com`.toLowerCase(),
        tier: random() < 0.25 ? "pro" : "free",
        address: { country: pick(random, COUNTRIES) },
      },
      items,
      total: subtotal,
      currency: "USD",
      tags: random() < 0.3 ? ["gift"] : [],
    });
  }
  return orders;
}

/**
 * A slightly edited copy of the sample (one status change, one updated
 * total, one removed order) so the Diff panel has something to compare.
 */
export function createSampleDiffTarget(
  orders: readonly JsonObject[],
): JsonObject[] {
  const copy = orders.map(
    (order) => JSON.parse(JSON.stringify(order)) as JsonObject,
  );
  if (copy[0]) copy[0] = { ...copy[0], status: "delivered" };
  if (copy[1])
    copy[1] = { ...copy[1], total: round2(Number(copy[1].total) + 10) };
  copy.splice(2, 1);
  return copy;
}

/** Example pipeline: one native filter step plus one JSONata projection. */
export function createSamplePipeline(): PipelineDefinition {
  return createPipeline([
    {
      id: "sample-filter-shipped",
      type: "filter",
      enabled: true,
      config: { field: "status", equals: "shipped" },
    },
    {
      id: "sample-jsonata-summary",
      type: "jsonata",
      enabled: true,
      config: {
        expression:
          "[$.{ 'order': id, 'customer': customer.name, 'country': customer.address.country, 'items': $count(items), 'total': total }]",
      },
    },
  ]);
}

export interface SampleWorkspace {
  readonly fileName: string;
  readonly text: string;
  readonly pipeline: PipelineDefinition;
  readonly sqlQuery: string;
  readonly diffText: string;
}

/** Everything the side panel needs to populate Tree/Table/SQL/Diff. */
export function createSampleWorkspace(): SampleWorkspace {
  const orders = createSampleOrders();
  return {
    fileName: SAMPLE_FILE_NAME,
    text: stringifyJsonValue(orders as JsonValue, true),
    pipeline: createSamplePipeline(),
    sqlQuery: SAMPLE_SQL_QUERY,
    diffText: stringifyJsonValue(
      createSampleDiffTarget(orders) as JsonValue,
      true,
    ),
  };
}
