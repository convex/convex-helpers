import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  GenericDatabaseReader,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import { defineSchema, defineTable } from "convex/server";
import { compareValues, convexToJson, v } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { IndexBounds, IndexKey, QueryStream } from "./stream.js";
import { mergedStream, stream, streamIndexRange } from "./stream.js";
import { wrapDatabaseReader } from "./rowLevelSecurity.js";
import { modules } from "./setup.test.js";

// These properties enforce query bounds, not confidentiality of indexed fields:
// stream cursors intentionally contain index values, even for filtered-out rows.
// Increase cases or add seeds (e.g. 0xc0ffee, 0xdeadbeef) for more coverage when
// changing stream.ts. Keep the defaults small for routine test runs.
const seeds = [1];
const cases = 8;

const tenantValidator = v.optional(
  v.union(
    v.null(),
    v.boolean(),
    v.int64(),
    v.number(),
    v.string(),
    v.bytes(),
    v.array(v.number()),
    v.object({ tag: v.number() }),
  ),
);
const schema = defineSchema({
  rows: defineTable({
    tenant: tenantValidator,
    nested: v.object({ tenant: tenantValidator }),
    bucket: v.number(),
    score: v.number(),
    secret: v.string(),
  })
    .index("tenant_bucket_score", ["tenant", "bucket", "score"])
    .index("tenant_score", ["tenant", "score"])
    .index("nested_tenant", ["nested.tenant", "bucket", "score"]),
  groups: defineTable({ tenant: tenantValidator, bucket: v.number() }).index(
    "tenant_bucket",
    ["tenant", "bucket"],
  ),
});
type Model = DataModelFromSchemaDefinition<typeof schema>;
type Row = DocumentByName<Model, "rows">;
type Group = DocumentByName<Model, "groups">;
type Reader = GenericDatabaseReader<Model>;
type Order = "asc" | "desc";
type Entry = { doc: Row | null; key: IndexKey };
type Scenario = {
  name: string;
  query: QueryStream<Row>;
  entries: Entry[];
  readable: Set<string>;
  extraKeys?: IndexKey[];
  // Distinct pagination positions at the end of a group, not within a document.
  distinctLength?: number;
  // An empty budget-limited distinct page may intentionally skip a group.
  budgetedWalk?: false;
};
type Cursor = { wire: string; key: IndexKey };

function random(seed: number) {
  let state = seed >>> 0;
  const int = (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * n);
  };
  return {
    int,
    pick<T>(items: readonly T[]): T {
      return items[int(items.length)]!;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    },
  };
}

const tenants: Row["tenant"][] = [
  undefined,
  null,
  false,
  true,
  -2n,
  2n,
  -Infinity,
  -1,
  -0,
  1,
  Infinity,
  NaN,
  "",
  "a",
  "m",
  "z",
  "undefined",
  "_undefined",
  "__undefined",
  new Uint8Array([0, 255]).buffer,
  [0, 1],
  { tag: 1 },
];

// Encode the stream wire representation, including serializeCursor's undefined
// escaping. Keep this test-local so fabricated client cursors do not depend on
// the production cursor helpers. Valid pagination also exercises cursors emitted
// by the library itself.
function cursor(key: IndexKey): Cursor {
  return {
    key,
    wire: JSON.stringify(
      convexToJson(
        key.map((value) =>
          value === undefined
            ? "undefined"
            : typeof value === "string" && value.endsWith("undefined")
              ? `_${value}`
              : value,
        ),
      ),
    ),
  };
}
function keyOf(doc: Row | Group): IndexKey {
  return "score" in doc
    ? [doc.tenant, doc.bucket, doc.score, doc._creationTime, doc._id]
    : [doc.tenant, doc.bucket, doc._creationTime, doc._id];
}
// This is deliberately independent of stream.ts's compareKeys. It uses ordinary
// lexicographic ordering; inBounds compares document prefixes and then applies
// inclusivity directly, without the library's predecessor/successor machinery.
// Sharing that machinery would let the oracle reproduce the same boundary bug.
function compare(a: IndexKey, b: IndexKey): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareValues(a[i], b[i]);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}
function sameTenant(a: Row["tenant"], b: Row["tenant"]) {
  return compareValues(a, b) === 0;
}
function ordered(entries: Entry[], order: Order) {
  return entries
    .slice()
    .sort((a, b) => compare(a.key, b.key) * (order === "asc" ? 1 : -1));
}
function entriesOf(rows: Row[], order: Order): Entry[] {
  return ordered(
    rows.map((doc) => ({ doc, key: keyOf(doc) })),
    order,
  );
}
function inBounds(key: IndexKey, bounds: IndexBounds): boolean {
  const lower = compare(
    key.slice(0, bounds.lowerBound.length),
    bounds.lowerBound,
  );
  const upper = compare(
    key.slice(0, bounds.upperBound.length),
    bounds.upperBound,
  );
  return (
    (lower > 0 || (lower === 0 && bounds.lowerBoundInclusive)) &&
    (upper < 0 || (upper === 0 && bounds.upperBoundInclusive))
  );
}
function modelPage(
  scenario: Scenario,
  start: Cursor | null,
  end: Cursor | null,
  numItems: number,
): Row[] {
  const direction = scenario.query.getOrder() === "asc" ? 1 : -1;
  const project = (key: IndexKey) =>
    key.slice(0, scenario.distinctLength ?? key.length);
  const result = scenario.entries
    .filter(({ key, doc }) => {
      if (doc === null) return false;
      key = project(key);
      const afterStart =
        start === null ||
        compare(key.slice(0, project(start.key).length), project(start.key)) *
          direction >
          0;
      const beforeEnd =
        end === null ||
        compare(key.slice(0, project(end.key).length), project(end.key)) *
          direction <=
          0;
      return afterStart && beforeEnd;
    })
    .map(({ doc }) => doc!);
  return end === null ? result.slice(0, numItems) : result;
}

async function fixture(seed: number, selectedTenants = tenants) {
  const rng = random(seed);
  const t = convexTest(schema, modules);
  const { rows, groups } = await t.run(async (ctx) => {
    const input: Omit<Row, "_id" | "_creationTime">[] = [];
    for (const tenant of selectedTenants) {
      for (let bucket = 0; bucket < 3; bucket++) {
        await ctx.db.insert("groups", { tenant, bucket });
        for (const score of [-1, 0, 1, rng.int(5) - 2]) {
          input.push({
            tenant,
            nested: { tenant },
            bucket,
            score,
            secret: `secret-${input.length}`,
          });
        }
      }
    }
    for (const row of rng.shuffle(input)) await ctx.db.insert("rows", row);
    return {
      rows: await ctx.db.query("rows").collect(),
      groups: await ctx.db.query("groups").collect(),
    };
  });
  return { t, rows, groups, rng };
}

function observer(db: Reader) {
  const reads: string[] = [];
  // Observe every document consumed by the underlying DB iterator. Always allow
  // it through: using this wrapper must not itself prevent a cursor escape.
  const observed = wrapDatabaseReader({}, db, {
    rows: {
      read: async (_, doc) => {
        reads.push(doc._id);
        return true;
      },
    },
    groups: {
      read: async (_, doc) => {
        reads.push(doc._id);
        return true;
      },
    },
  });
  return { db: observed, reads };
}

async function check(
  scenario: Scenario,
  reads: string[],
  opts: PaginationOptions,
  label: string,
  allowError = false,
): Promise<PaginationResult<Row> | undefined> {
  reads.length = 0;
  let result: PaginationResult<Row> | undefined;
  let failure: unknown;
  try {
    result = await scenario.query.paginate(opts);
  } catch (error) {
    failure = error;
  }
  const context = `${label}; ${scenario.name}; ${JSON.stringify(opts)}`;
  // Check this OUTSIDE the catch: even a later exception must not hide a read
  // outside the query's static bounds.
  expect(
    reads.filter((id) => !scenario.readable.has(id)),
    `${context}; out-of-range database reads`,
  ).toEqual([]);
  if (failure !== undefined) {
    if (!allowError) throw new Error(context, { cause: failure });
    return;
  }
  expect(result, context).toBeDefined();
  const visible = new Set(
    scenario.entries.flatMap((entry) => (entry.doc ? [entry.doc._id] : [])),
  );
  expect(
    result!.page.filter((doc) => !visible.has(doc._id)),
    context,
  ).toEqual([]);
  const safeKeys = new Set(
    [
      ...scenario.entries.map((entry) => entry.key),
      ...(scenario.extraKeys ?? []),
      // Empty distinct pages can expose just the group boundary, omitting the
      // rejected row's remaining index fields.
      ...(scenario.distinctLength === undefined
        ? []
        : scenario.entries.map((entry) =>
            entry.key.slice(0, scenario.distinctLength),
          )),
    ].map((key) => cursor(key).wire),
  );
  for (const output of [result!.continueCursor, result!.splitCursor]) {
    // Echoing an attacker-provided endpoint is not disclosure of server data.
    if (
      output === undefined ||
      output === null ||
      output === "[]" ||
      output === opts.endCursor ||
      (opts.numItems === 0 && output === opts.cursor)
    )
      continue;
    expect(
      safeKeys.has(output),
      `${context}; unexpected cursor metadata ${output}`,
    ).toBe(true);
  }
  return result;
}

function mutations(keys: IndexKey[], rng: ReturnType<typeof random>): Cursor[] {
  const result: IndexKey[] = [];
  // Generate all prefix lengths and splice points, then sample up to cases.
  for (const key of keys.slice(0, 6)) {
    for (let length = 0; length <= key.length; length++)
      result.push(key.slice(0, length));
    for (let at = 0; at < key.length; at++) {
      for (const value of [undefined, null, "undefined", rng.pick(tenants)]) {
        const edited = key.slice();
        edited[at] = value;
        result.push(edited);
      }
      result.push([...key.slice(0, at), ...rng.pick(keys).slice(at)]);
    }
    result.push([...key, null], [...key, ...rng.pick(keys)]);
  }
  return [
    ...new Map(
      [
        // Always cover empty cursors and every tenant value type.
        [],
        ...tenants.map((tenant) => [tenant]),
        ...rng.shuffle(result).slice(0, cases),
      ].map((key) => {
        const c = cursor(key);
        return [c.wire, c];
      }),
    ).values(),
  ];
}

function scenarios(
  db: Reader,
  rows: Row[],
  groups: Group[],
  order: Order,
): Scenario[] {
  const streams = stream(db, schema);
  const owned = rows.filter((row) => row.tenant === "m");
  const ownGroups = groups.filter((group) => group.tenant === "m");
  const base = streams
    .query("rows")
    .withIndex("tenant_bucket_score", (q) => q.eq("tenant", "m"))
    .order(order);
  const outer = streams
    .query("groups")
    .withIndex("tenant_bucket", (q) => q.eq("tenant", "m"))
    .order(order);
  const make = (
    name: string,
    query: QueryStream<Row>,
    allowed: Row[],
    entries = entriesOf(allowed, order),
    outerReads: Group[] = [],
    extraKeys: IndexKey[] = [],
  ): Scenario => ({
    name,
    query,
    entries: ordered(entries, order),
    extraKeys,
    readable: new Set([...allowed, ...outerReads].map((doc) => doc._id)),
  });
  const baseEntries = entriesOf(owned, order);
  const result = [
    make("plain", base, owned),
    make(
      "bounded",
      streams
        .query("rows")
        .withIndex("tenant_bucket_score", (q) =>
          q.eq("tenant", "m").eq("bucket", 1).gte("score", 0),
        )
        .order(order),
      owned.filter((row) => row.bucket === 1 && row.score >= 0),
    ),
    make(
      "nested index field",
      streams
        .query("rows")
        .withIndex("nested_tenant", (q) => q.eq("nested.tenant", "m"))
        .order(order),
      owned,
    ),
    make(
      "different index",
      streams
        .query("rows")
        .withIndex("tenant_score", (q) => q.eq("tenant", "m"))
        .order(order),
      owned,
      owned.map((doc) => ({
        doc,
        key: [doc.tenant, doc.score, doc._creationTime, doc._id],
      })),
    ),
    make(
      "map changes indexed fields",
      base.map(async (doc) => ({
        ...doc,
        tenant: "redacted",
        bucket: -100,
        score: -100,
      })),
      owned,
    ),
    make(
      "filter",
      base.filterWith(async (doc) => doc.score > 0),
      owned,
      baseEntries.map((entry) => ({
        ...entry,
        doc: entry.doc!.score > 0 ? entry.doc : null,
      })),
    ),
    make(
      "filter all",
      base.filterWith(async () => false),
      owned,
      baseEntries.map((entry) => ({ ...entry, doc: null })),
    ),
    make(
      "filter and map",
      base
        .filterWith(async (doc) => doc.score > 0)
        .map(async (doc) => ({ ...doc, bucket: -100 })),
      owned,
      baseEntries.map((entry) => ({
        ...entry,
        doc: entry.doc!.score > 0 ? entry.doc : null,
      })),
    ),
  ];
  const first = rows[3]!,
    last = rows[rows.length - 4]!;
  const byTime = rows.filter(
    (row) =>
      row._creationTime >= first._creationTime &&
      row._creationTime < last._creationTime,
  );
  result.push(
    make(
      "creation time",
      streams
        .query("rows")
        .withIndex("by_creation_time", (q) =>
          q
            .gte("_creationTime", first._creationTime)
            .lt("_creationTime", last._creationTime),
        )
        .order(order),
      byTime,
      byTime.map((doc) => ({ doc, key: [doc._creationTime, doc._id] })),
    ),
  );
  result.push(
    make(
      "document id",
      streams
        .query("rows")
        .withIndex("by_id", (q) => q.eq("_id", first._id))
        .order(order),
      [first],
      [{ doc: first, key: [first._id] }],
    ),
  );

  const unionRows = rows.filter(
    (row) => row.tenant === "a" || row.tenant === "z",
  );
  result.push(
    make(
      "merge across an unauthorized tenant",
      mergedStream(
        ["a", "z"].map((tenant) =>
          streams
            .query("rows")
            .withIndex("tenant_bucket_score", (q) => q.eq("tenant", tenant))
            .order(order),
        ),
        ["bucket", "score"],
      ),
      unionRows,
      unionRows.map((doc) => ({ doc, key: keyOf(doc).slice(1) })),
    ),
  );
  const disjoint = owned.filter((row) => row.bucket === 0 || row.bucket === 2);
  result.push(
    make(
      "merge disjoint ranges",
      mergedStream(
        [0, 2].map((bucket) =>
          streams
            .query("rows")
            .withIndex("tenant_bucket_score", (q) =>
              q.eq("tenant", "m").eq("bucket", bucket),
            )
            .order(order),
        ),
        ["bucket", "score"],
      ),
      disjoint,
      disjoint.map((doc) => ({ doc, key: keyOf(doc).slice(1) })),
    ),
  );

  const distinctEntries = baseEntries.filter(
    (entry, i) =>
      i === 0 || entry.doc!.bucket !== baseEntries[i - 1]!.doc!.bucket,
  );
  result.push({
    ...make("distinct", base.distinct(["bucket"]), owned, distinctEntries),
    distinctLength: 2,
  });
  result.push({
    ...make(
      "distinct then filter",
      base.distinct(["bucket"]).filterWith(async (doc) => doc.bucket !== 1),
      owned,
      distinctEntries.map((entry) => ({
        ...entry,
        doc: entry.doc!.bucket !== 1 ? entry.doc : null,
      })),
    ),
    distinctLength: 2,
  });
  const filteredDistinct: Entry[] = [];
  const buckets = new Set<number>();
  for (const entry of baseEntries) {
    const doc = entry.doc!;
    if (buckets.has(doc.bucket)) continue;
    if (doc.score === 0) buckets.add(doc.bucket);
    filteredDistinct.push({ ...entry, doc: doc.score === 0 ? doc : null });
  }
  result.push({
    ...make(
      "filter then distinct",
      base.filterWith(async (doc) => doc.score === 0).distinct(["bucket"]),
      owned,
      filteredDistinct,
    ),
    distinctLength: 2,
    budgetedWalk: false,
  });

  const positive = owned.filter((row) => row.score >= 0);
  result.push(
    make(
      "flatMap",
      outer.flatMap(
        async (group) =>
          streams
            .query("rows")
            .withIndex("tenant_bucket_score", (q) =>
              q
                .eq("tenant", group.tenant)
                .eq("bucket", group.bucket)
                .gte("score", 0),
            )
            .order(order),
        ["tenant", "bucket", "score", "_creationTime", "_id"],
      ),
      positive,
      ownGroups.flatMap((group) =>
        positive
          .filter((doc) => doc.bucket === group.bucket)
          .map((doc) => ({ doc, key: [...keyOf(group), ...keyOf(doc)] })),
      ),
      ownGroups,
      ownGroups.map((group) => [...keyOf(group), ...Array(5).fill(null)]),
    ),
  );

  const nonzero = owned.filter((row) => row.score !== 0);
  const filteredInner = positive.filter((row) => row.bucket === 1);
  result.push(
    make(
      "filtered outer flatMap",
      outer
        .filterWith(async (group) => group.bucket === 1)
        .flatMap(
          async (group) =>
            streams
              .query("rows")
              .withIndex("tenant_bucket_score", (q) =>
                q
                  .eq("tenant", group.tenant)
                  .eq("bucket", group.bucket)
                  .gte("score", 0),
              )
              .order(order),
          ["tenant", "bucket", "score", "_creationTime", "_id"],
        ),
      filteredInner,
      ownGroups
        .filter((group) => group.bucket === 1)
        .flatMap((group) =>
          filteredInner.map((doc) => ({
            doc,
            key: [...keyOf(group), ...keyOf(doc)],
          })),
        ),
      ownGroups,
      ownGroups.map((group) => [...keyOf(group), ...Array(5).fill(null)]),
    ),
  );
  result.push(
    make(
      "flatMap merged inner",
      outer.flatMap(
        async (group) =>
          mergedStream(
            [
              streams
                .query("rows")
                .withIndex("tenant_bucket_score", (q) =>
                  q
                    .eq("tenant", group.tenant)
                    .eq("bucket", group.bucket)
                    .lt("score", 0),
                )
                .order(order),
              streams
                .query("rows")
                .withIndex("tenant_bucket_score", (q) =>
                  q
                    .eq("tenant", group.tenant)
                    .eq("bucket", group.bucket)
                    .gt("score", 0),
                )
                .order(order),
            ],
            ["score"],
          ),
        ["score", "_creationTime", "_id"],
      ),
      nonzero,
      ownGroups.flatMap((group) =>
        nonzero
          .filter((doc) => doc.bucket === group.bucket)
          .map((doc) => ({
            doc,
            key: [...keyOf(group), ...keyOf(doc).slice(2)],
          })),
      ),
      ownGroups,
      ownGroups.map((group) => [...keyOf(group), ...Array(3).fill(null)]),
    ),
  );

  const unionGroups = groups.filter(
    (group) => group.tenant === "a" || group.tenant === "z",
  );
  const mergedOuter = mergedStream(
    ["a", "z"].map((tenant) =>
      streams
        .query("groups")
        .withIndex("tenant_bucket", (q) => q.eq("tenant", tenant))
        .order(order),
    ),
    ["bucket"],
  );
  result.push(
    make(
      "merged outer flatMap",
      mergedOuter.flatMap(
        async (group) =>
          streams
            .query("rows")
            .withIndex("tenant_bucket_score", (q) =>
              q.eq("tenant", group.tenant).eq("bucket", group.bucket),
            )
            .order(order),
        ["tenant", "bucket", "score", "_creationTime", "_id"],
      ),
      unionRows,
      unionGroups.flatMap((group) =>
        unionRows
          .filter(
            (doc) => doc.tenant === group.tenant && doc.bucket === group.bucket,
          )
          .map((doc) => ({
            doc,
            key: [...keyOf(group).slice(1), ...keyOf(doc)],
          })),
      ),
      unionGroups,
      unionGroups.map((group) => [
        ...keyOf(group).slice(1),
        ...Array(5).fill(null),
      ]),
    ),
  );

  result.push(
    make(
      "nested flatMap",
      outer.flatMap(
        async (group) =>
          streams
            .query("rows")
            .withIndex("tenant_bucket_score", (q) =>
              q.eq("tenant", group.tenant).eq("bucket", group.bucket),
            )
            .order(order)
            .flatMap(
              async (middle) =>
                streams
                  .query("rows")
                  .withIndex("tenant_bucket_score", (q) =>
                    q
                      .eq("tenant", middle.tenant)
                      .eq("bucket", middle.bucket)
                      .eq("score", middle.score),
                  )
                  .order(order),
              ["tenant", "bucket", "score", "_creationTime", "_id"],
            ),
        [
          "tenant",
          "bucket",
          "score",
          "_creationTime",
          "_id",
          "tenant",
          "bucket",
          "score",
          "_creationTime",
          "_id",
        ],
      ),
      owned,
      ownGroups.flatMap((group) =>
        owned
          .filter((middle) => middle.bucket === group.bucket)
          .flatMap((middle) =>
            owned
              .filter(
                (doc) =>
                  doc.bucket === middle.bucket && doc.score === middle.score,
              )
              .map((doc) => ({
                doc,
                key: [...keyOf(group), ...keyOf(middle), ...keyOf(doc)],
              })),
          ),
      ),
      ownGroups,
      ownGroups.flatMap((group) => [
        [...keyOf(group), ...Array(10).fill(null)],
        ...owned
          .filter((middle) => middle.bucket === group.bucket)
          .map((middle) => [
            ...keyOf(group),
            ...keyOf(middle),
            ...Array(5).fill(null),
          ]),
      ]),
    ),
  );
  return result;
}

const malformed = [
  "",
  " ",
  "[",
  "null",
  "false",
  "1",
  '"[]"',
  "{}",
  '{"0":"m","length":1}',
  '[{"$integer":"bad"}]',
  '[{"$float":"bad"}]',
  '[{"$undefined":true}]',
  '[{"$bytes":"!"}]',
  '[{"__proto__":{"tenant":"z"}}]',
  '["\\u0075ndefined"]',
];

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// An empty inner stream yields a placeholder with an all-null suffix. Resuming
// must advance past an empty outer item when a read limit stops at that placeholder.
test.each([
  { order: "asc", maximumRowsRead: 1 },
  { order: "desc", maximumRowsRead: 1 },
  { order: "asc", maximumBytesRead: 1 },
  { order: "desc", maximumBytesRead: 1 },
] as const)(
  "flatMap advances past a budgeted empty inner stream: %j",
  async ({ order, ...limit }) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("groups", { tenant: "m", bucket: 0 });
      const db = stream(ctx.db, schema);
      const query = db
        .query("groups")
        .withIndex("tenant_bucket", (q) => q.eq("tenant", "m"))
        .order(order)
        .flatMap(
          async (group) =>
            db
              .query("rows")
              .withIndex("tenant_bucket_score", (q) =>
                q.eq("tenant", group.tenant),
              )
              .order(order),
          ["tenant", "bucket", "score", "_creationTime", "_id"],
        );
      const first = await query.paginate({
        cursor: null,
        numItems: 1,
        ...limit,
      });
      expect(first.page).toEqual([]);
      const second = await query.paginate({
        cursor: first.continueCursor,
        numItems: 1,
        ...limit,
      });
      expect(second.isDone).toBe(true);
    });
  },
);

test.each(["asc", "desc"] as const)(
  "a skipped inner cursor preserves its position after inserts (%s)",
  async (order) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("groups", { tenant: "m", bucket: 0 });
      const db = stream(ctx.db, schema);
      const query = db
        .query("groups")
        .withIndex("tenant_bucket", (q) => q.eq("tenant", "m"))
        .order(order)
        .flatMap(
          async (group) =>
            db
              .query("rows")
              .withIndex("tenant_bucket_score", (q) =>
                q
                  .eq("tenant", group.tenant)
                  .eq("bucket", group.bucket)
                  .gte("score", 0),
              )
              .order(order),
          ["tenant", "bucket", "score", "_creationTime", "_id"],
        );
      const first = await query.paginate({
        cursor: null,
        numItems: 1,
        maximumRowsRead: 1,
      });
      expect(first.page).toEqual([]);
      expect(first.isDone).toBe(false);
      // Newly inserted rows fall on the appropriate side of the placeholder's
      // index position. Adjacent pages must still contain them exactly once.
      const inserted = await ctx.db.insert("rows", {
        tenant: "m",
        nested: { tenant: "m" },
        bucket: 0,
        score: 1,
        secret: "new allowed row",
      });
      await ctx.db.insert("rows", {
        tenant: "z",
        nested: { tenant: "z" },
        bucket: 0,
        score: 1,
        secret: "foreign row",
      });
      await ctx.db.insert("rows", {
        tenant: "m",
        nested: { tenant: "m" },
        bucket: 0,
        score: -1,
        secret: "excluded row",
      });
      const nextBucket = order === "asc" ? 1 : -1;
      await ctx.db.insert("groups", { tenant: "m", bucket: nextBucket });
      const later = await ctx.db.insert("rows", {
        tenant: "m",
        nested: { tenant: "m" },
        bucket: nextBucket,
        score: 1,
        secret: "next outer row",
      });
      const resumed = await query.paginate({
        cursor: first.continueCursor,
        numItems: 10,
      });
      expect(resumed.page.map((doc) => doc._id)).toEqual(
        order === "asc" ? [inserted, later] : [later],
      );
      const refreshed = await query.paginate({
        cursor: null,
        endCursor: first.continueCursor,
        numItems: 10,
      });
      expect(refreshed.page.map((doc) => doc._id)).toEqual(
        order === "asc" ? [] : [inserted],
      );
    });
  },
);

// An empty budget-limited distinct page advances past its last examined group,
// even if that group has unread matching rows. This keeps legacy cursor semantics.
test.each([
  { order: "asc", maximumRowsRead: 1 },
  { order: "desc", maximumRowsRead: 1 },
  { order: "asc", maximumBytesRead: 1 },
  { order: "desc", maximumBytesRead: 1 },
] as const)(
  "empty filtered distinct pages advance past the last examined group: %j",
  async ({ order, ...limit }) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const score of [-1, 0, 1]) {
        await ctx.db.insert("rows", {
          tenant: "m",
          nested: { tenant: "m" },
          bucket: 0,
          score,
          secret: `secret-${score}`,
        });
      }
      const query = stream(ctx.db, schema)
        .query("rows")
        .withIndex("tenant_bucket_score", (q) => q.eq("tenant", "m"))
        .order(order)
        .filterWith(async (row) => row.score === 0)
        .distinct(["bucket"]);
      const unlimited = await query.paginate({ cursor: null, numItems: 1 });
      expect(unlimited.page.map((row) => row.score)).toEqual([0]);
      const first = await query.paginate({
        cursor: null,
        numItems: 1,
        ...limit,
      });
      expect(first.page).toEqual([]);
      const second = await query.paginate({
        cursor: first.continueCursor,
        numItems: 1,
        ...limit,
      });
      expect(second.page).toEqual([]);
      expect(second.isDone).toBe(true);
      expect(JSON.parse(first.continueCursor)).toEqual(["m", 0]);
    });
  },
);

describe.each(seeds)("stream cursor properties (seed %i)", (seed) => {
  test.each(["asc", "desc"] as const)(
    "stale cursors remain scoped after deletion, reindexing, and tenant changes (%s)",
    async (order) => {
      const { t, rows, rng } = await fixture(seed, ["a", "m", "z"]);
      const issued = await t.run(async (ctx) => {
        const query = stream(ctx.db, schema)
          .query("rows")
          .withIndex("tenant_bucket_score", (q) => q.eq("tenant", "m"))
          .order(order);
        const cursors: string[] = [];
        let next: string | null = null;
        for (let i = 0; i < 5; i++) {
          const page = await query.paginate({ cursor: next, numItems: 1 });
          next = page.continueCursor;
          cursors.push(next);
        }
        return cursors;
      });
      await t.run(async (ctx) => {
        const owned = rng.shuffle(rows.filter((row) => row.tenant === "m"));
        await ctx.db.delete("rows", owned[0]!._id);
        await ctx.db.patch("rows", owned[1]!._id, {
          tenant: "z",
          nested: { tenant: "z" },
        });
        await ctx.db.patch("rows", owned[2]!._id, { bucket: 9, score: 100 });
        await ctx.db.insert("rows", {
          tenant: "a",
          nested: { tenant: "a" },
          bucket: 0,
          score: 0,
          secret: "new foreign secret",
        });
      });
      await t.run(async (ctx) => {
        const current = await ctx.db.query("rows").collect();
        const { db, reads } = observer(ctx.db);
        // Reuse previously issued cursors under a new tenant scope as well.
        for (const tenant of ["m", "a"]) {
          const allowed = current.filter(
            (row) => row.tenant === tenant && row.bucket < 3,
          );
          const scenario: Scenario = {
            name: `stale ${tenant}`,
            query: stream(db, schema)
              .query("rows")
              .withIndex("tenant_bucket_score", (q) =>
                q.eq("tenant", tenant).lt("bucket", 3),
              )
              .order(order),
            entries: entriesOf(allowed, order),
            readable: new Set(allowed.map((row) => row._id)),
          };
          for (const wire of issued) {
            for (const opts of [
              { cursor: wire, numItems: 100 },
              { cursor: null, endCursor: wire, numItems: 100 },
            ]) {
              await check(scenario, reads, opts, `seed ${seed}, stale`);
            }
          }
        }
      });
    },
  );

  test.each(["asc", "desc"] as const)(
    "composed streams preserve scope under adversarial cursors (%s)",
    async (order) => {
      const { t, rows, groups, rng } = await fixture(seed, ["a", "m", "z"]);
      await t.run(async (ctx) => {
        const { db, reads } = observer(ctx.db);
        const variants = scenarios(db, rows, groups, order);
        // Mix keys from other tenants, tables, indexes, and stream compositions.
        const crossQuery = [
          ...groups.map(keyOf),
          ...variants.flatMap((scenario) =>
            scenario.entries
              .filter((entry) => entry.doc)
              .slice(0, 2)
              .map((entry) => entry.key),
          ),
        ];
        for (const scenario of variants) {
          const ownKeys = scenario.entries.map((entry) => entry.key);
          const attacks = [
            ...mutations(
              [
                ...rng.shuffle(ownKeys).slice(0, 3),
                ...rng.shuffle(rows).slice(0, 3).map(keyOf),
              ],
              rng,
            ).map((c) => c.wire),
            ...crossQuery.map((key) => cursor(key).wire),
            ...malformed,
          ];
          for (const [i, wire] of attacks.entries()) {
            const other = rng.pick(attacks);
            for (const opts of [
              { cursor: wire, numItems: rng.pick([0, 1, 2, 100, -1, 0.5]) },
              { cursor: null, endCursor: wire, numItems: 1 },
              {
                cursor: wire,
                endCursor: other,
                numItems: 3,
                maximumRowsRead: rng.pick([0, 1, 3]),
              },
              {
                cursor: other,
                endCursor: wire,
                numItems: 3,
                maximumBytesRead: rng.pick([0, 1, 500]),
              },
            ]) {
              const result = await check(
                scenario,
                reads,
                opts,
                `seed ${seed}, attack ${i}`,
                true,
              );
              if (result) {
                // A leaked continuation/split cursor could enable a second request
                // even when the first page is empty. Replay both server outputs.
                for (const next of new Set(
                  [result.continueCursor, result.splitCursor].filter(
                    (c): c is string => typeof c === "string",
                  ),
                )) {
                  await check(
                    scenario,
                    reads,
                    { cursor: next, numItems: 2, maximumRowsRead: 2 },
                    `seed ${seed}, replay ${i}`,
                    true,
                  );
                  await check(
                    scenario,
                    reads,
                    {
                      cursor: null,
                      endCursor: next,
                      numItems: 2,
                      maximumRowsRead: 2,
                    },
                    `seed ${seed}, replay end ${i}`,
                    true,
                  );
                }
              }
            }
          }
        }
      });
    },
    30_000,
  );

  test.each(["asc", "desc"] as const)(
    "distinct budgeted walks omit groups only after empty pages (%s)",
    async (order) => {
      const { t, rows, groups, rng } = await fixture(seed, ["a", "m", "z"]);
      await t.run(async (ctx) => {
        const { db, reads } = observer(ctx.db);
        const scenario = scenarios(db, rows, groups, order).find(
          (variant) => variant.name === "filter then distinct",
        )!;
        const expected = scenario.entries.flatMap((entry) =>
          entry.doc ? [entry.doc._id] : [],
        );
        for (const budget of ["rows", "bytes"] as const) {
          let start: Cursor | null = null;
          const actual: string[] = [];
          const omitted = new Set<string>();
          const seen = new Set<string>();
          let done = false;
          for (let page = 0; page < rows.length + 1; page++) {
            const result: PaginationResult<Row> = (await check(
              scenario,
              reads,
              {
                cursor: start?.wire ?? null,
                numItems: rng.int(3) + 1,
                ...(budget === "rows"
                  ? { maximumRowsRead: rng.int(4) + 1 }
                  : { maximumBytesRead: rng.pick([1, 300, 600]) }),
              },
              `seed ${seed}, distinct ${budget} page ${page}`,
            ))!;
            const end: Cursor | null = result.isDone
              ? null
              : {
                  wire: result.continueCursor,
                  key: JSON.parse(result.continueCursor) as IndexKey,
                };
            const inPageRange = modelPage(scenario, start, end, Infinity).map(
              (doc) => doc._id,
            );
            if (result.page.length > 0 || result.isDone) {
              // A nonempty page must include every representative through its
              // last result. Later partially searched groups remain for retry.
              expect(result.page.map((doc) => doc._id)).toEqual(inPageRange);
              if (!result.isDone) {
                expect(result.continueCursor).toBe(
                  cursor(keyOf(result.page.at(-1)!)).wire,
                );
              }
            } else {
              expect(result.pageStatus).toBe("SplitRequired");
              const lastRead = rows.find((doc) => doc._id === reads.at(-1))!;
              expect(end!.key).toEqual([lastRead.tenant, lastRead.bucket]);
              for (const id of inPageRange) omitted.add(id);
            }
            actual.push(...result.page.map((doc) => doc._id));
            if (result.isDone) {
              done = true;
              break;
            }
            expect(seen.has(result.continueCursor)).toBe(false);
            seen.add(result.continueCursor);
            start = end;
          }
          expect(done).toBe(true);
          expect(actual).toEqual(expected.filter((id) => !omitted.has(id)));
        }
      });
    },
  );

  test.each(["asc", "desc"] as const)(
    "valid composed pagination is complete and makes progress (%s)",
    async (order) => {
      const { t, rows, groups, rng } = await fixture(seed, ["a", "m", "z"]);
      await t.run(async (ctx) => {
        const { db, reads } = observer(ctx.db);
        for (const scenario of scenarios(db, rows, groups, order)) {
          const expected = scenario.entries.flatMap((entry) =>
            entry.doc ? [entry.doc._id] : [],
          );
          const actual: string[] = [];
          let next: string | null = null;
          let done = false;
          const seen = new Set<string>();
          for (
            let page = 0;
            page < scenario.entries.length * 3 + groups.length * 3 + 10;
            page++
          ) {
            const result = await check(
              scenario,
              reads,
              {
                cursor: next,
                numItems: rng.int(3) + 1,
                // Empty distinct pages may intentionally omit groups. Test complete
                // walks without budgets; budget behavior is covered separately.
                // Adversarial safety tests still exercise budgets on every variant.
                maximumRowsRead:
                  scenario.budgetedWalk === false
                    ? undefined
                    : rng.pick([undefined, 1, 3]),
                maximumBytesRead:
                  scenario.budgetedWalk === false
                    ? undefined
                    : rng.pick([undefined, 1, 500]),
              },
              `seed ${seed}, page ${page}`,
            );
            actual.push(...result!.page.map((row) => row._id));
            if (result!.isDone) {
              done = true;
              break;
            }
            expect(
              seen.has(result!.continueCursor),
              `${scenario.name} did not advance`,
            ).toBe(false);
            seen.add(result!.continueCursor);
            next = result!.continueCursor;
          }
          expect(done, scenario.name).toBe(true);
          expect(actual, scenario.name).toEqual(expected);
          const endpoints: (Cursor | null)[] = [
            null,
            cursor([]),
            ...rng
              .shuffle(scenario.entries)
              .slice(0, 6)
              .map((entry) => cursor(entry.key)),
          ];
          for (const start of endpoints) {
            for (const end of endpoints) {
              const result = await check(
                scenario,
                reads,
                {
                  cursor: start?.wire ?? null,
                  endCursor: end?.wire,
                  numItems: 3,
                },
                `seed ${seed}, endpoints`,
              );
              expect(
                result!.page.map((row) => row._id),
                scenario.name,
              ).toEqual(
                modelPage(scenario, start, end, 3).map((row) => row._id),
              );
            }
          }
        }
      });
    },
    30_000,
  );

  test.each(["asc", "desc"] as const)(
    "static index bounds agree with a document oracle (%s)",
    async (order) => {
      const { t, rows, rng } = await fixture(seed);
      await t.run(async (ctx) => {
        const { db, reads } = observer(ctx.db);
        const streams = stream(db, schema);
        for (let i = 0; i < Math.max(cases, tenants.length); i++) {
          const tenant = tenants[i % tenants.length];
          const bucket = rng.int(3);
          const lower = rng.int(5) - 2,
            upper = rng.int(5) - 1;
          const lowerInclusive = rng.int(2) === 0,
            upperInclusive = rng.int(2) === 0;
          const depth = i % 3;
          const query = streams
            .query("rows")
            .withIndex("tenant_bucket_score", (q) => {
              const fixed = q.eq("tenant", tenant);
              if (depth === 2)
                return fixed.eq("bucket", bucket).eq("score", lower);
              if (depth === 1) {
                const fixedBucket = fixed.eq("bucket", bucket);
                const start = lowerInclusive
                  ? fixedBucket.gte("score", lower)
                  : fixedBucket.gt("score", lower);
                return upperInclusive
                  ? start.lte("score", upper)
                  : start.lt("score", upper);
              }
              const start = lowerInclusive
                ? fixed.gte("bucket", lower)
                : fixed.gt("bucket", lower);
              return upperInclusive
                ? start.lte("bucket", upper)
                : start.lt("bucket", upper);
            })
            .order(order);
          const allowed = rows.filter((row) => {
            if (!sameTenant(row.tenant, tenant)) return false;
            if (depth === 2)
              return row.bucket === bucket && row.score === lower;
            if (depth === 1 && row.bucket !== bucket) return false;
            const value = depth === 1 ? row.score : row.bucket;
            return (
              (lowerInclusive ? value >= lower : value > lower) &&
              (upperInclusive ? value <= upper : value < upper)
            );
          });
          const scenario: Scenario = {
            name: `static case ${i}, depth ${depth}`,
            query,
            entries: entriesOf(allowed, order),
            readable: new Set(allowed.map((row) => row._id)),
          };
          const candidates = [
            cursor([]),
            ...rng
              .shuffle(rows)
              .slice(0, 5)
              .flatMap((row) => {
                const key = keyOf(row);
                return [
                  cursor(key),
                  cursor(key.slice(0, rng.int(key.length + 1))),
                ];
              }),
          ];
          const endpoints: (Cursor | null)[] = [null, ...candidates];
          for (const start of endpoints) {
            for (const end of [null, rng.pick(endpoints)]) {
              const numItems = rng.pick([1, 2, 100]);
              const result = await check(
                scenario,
                reads,
                {
                  cursor: start?.wire ?? null,
                  endCursor: end?.wire,
                  numItems,
                },
                `seed ${seed}`,
              );
              expect(
                result!.page.map((row) => row._id),
                `${scenario.name}, ${start?.wire}, ${end?.wire}`,
              ).toEqual(
                modelPage(scenario, start, end, numItems).map((row) => row._id),
              );
            }
          }
        }
      });
    },
  );

  test.each(["asc", "desc"] as const)(
    "lexicographic and repeatedly narrowed ranges never expand (%s)",
    async (order) => {
      const { t, rows, rng } = await fixture(seed, ["a", "m", "z"]);
      await t.run(async (ctx) => {
        const { db, reads } = observer(ctx.db);
        const bound = () => {
          const key = keyOf(rng.pick(rows));
          return key.slice(0, rng.int(key.length + 1));
        };
        for (let i = 0; i < cases; i++) {
          const bounds: IndexBounds = {
            lowerBound: bound(),
            upperBound: bound(),
            lowerBoundInclusive: rng.int(2) === 0,
            upperBoundInclusive: rng.int(2) === 0,
          };
          const allowed = rows.filter((row) => inBounds(keyOf(row), bounds));
          let scenario: Scenario = {
            name: `range ${i}`,
            query: streamIndexRange(
              db,
              schema,
              "rows",
              "tenant_bucket_score",
              bounds,
              order,
            ),
            entries: entriesOf(allowed, order),
            readable: new Set(allowed.map((row) => row._id)),
          };
          for (let round = 0; round < 3; round++) {
            const result = await check(
              scenario,
              reads,
              { cursor: null, numItems: 1000 },
              `seed ${seed}, round ${round}`,
            );
            expect(result!.page.map((row) => row._id)).toEqual(
              scenario.entries.map((entry) => entry.doc!._id),
            );
            const next = {
              ...bounds,
              lowerBound: bound(),
              upperBound: bound(),
            };
            scenario = {
              ...scenario,
              query: scenario.query.narrow(next),
              entries: scenario.entries.filter((entry) =>
                inBounds(entry.key, next),
              ),
            };
            scenario.readable = new Set(
              scenario.entries.map((entry) => entry.doc!._id),
            );
          }
        }
      });
    },
  );
});
