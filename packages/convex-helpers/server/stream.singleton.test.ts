import { defineSchema, defineTable } from "convex/server";
import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
} from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { mergedStream, SingletonStream, stream } from "./stream.js";
import { modules } from "./setup.test.js";

const schema = defineSchema({
  accounts: defineTable({ name: v.string() }).index("name", ["name"]),
  projects: defineTable({
    accountId: v.id("accounts"),
    name: v.string(),
  }).index("accountId", ["accountId"]),
});
type DM = DataModelFromSchemaDefinition<typeof schema>;
type Row = {
  account: DocumentByName<DM, "accounts">;
  project: DocumentByName<DM, "projects"> | null;
};
const fields = ["accountId", "_creationTime", "_id"];

test("SingletonStream paginates with an unbounded endpoint", async () => {
  const singleton = new SingletonStream(
    "tail",
    "asc",
    fields,
    ["a", Infinity, ""],
    ["a"],
  );
  expect(await singleton.collect()).toEqual(["tail"]);
  const first = await singleton.paginate({ cursor: null, numItems: 1 });
  expect(first.page).toEqual(["tail"]);
  const next = await singleton.paginate({
    cursor: first.continueCursor,
    numItems: 1,
  });
  expect(next.page).toEqual([]);
  expect(next.isDone).toBe(true);
});

test("mapping a null singleton never calls the mapper", async () => {
  const singleton = new SingletonStream(null, "asc", [], [], []);
  expect(await singleton.map(async () => "tail").collect()).toEqual([]);
});

test("SingletonStream supports prefix bounds and retains bandwidth and equality fields", async () => {
  const singleton = new SingletonStream(
    "tail",
    "asc",
    fields,
    ["a", 100, "id"],
    ["a"],
    42,
  );
  const included = singleton.narrow({
    lowerBound: ["a"],
    lowerBoundInclusive: true,
    upperBound: ["a"],
    upperBoundInclusive: true,
  });
  expect(await included.collect()).toEqual(["tail"]);
  const item = await included.iterWithKeys(true)[Symbol.asyncIterator]().next();
  expect(item.value?.[2]).toBe(42);
  for (const bounds of [
    {
      lowerBound: ["a"],
      lowerBoundInclusive: false,
      upperBound: [],
      upperBoundInclusive: true,
    },
    {
      lowerBound: [],
      lowerBoundInclusive: true,
      upperBound: ["a"],
      upperBoundInclusive: false,
    },
  ]) {
    const excluded = singleton.narrow(bounds);
    expect(await excluded.collect()).toEqual([]);
    expect(excluded.getEqualityIndexFilter()).toEqual(["a"]);
  }
  // Merging on a suffix relies on the equality prefix even after narrowing
  // excludes the singleton.
  const projected = mergedStream([singleton], ["_creationTime", "_id"]);
  const page = await projected.paginate({ cursor: null, numItems: 1 });
  expect(page.page).toEqual(["tail"]);
  const end = await projected.paginate({
    cursor: page.continueCursor,
    numItems: 1,
  });
  expect(end.page).toEqual([]);
  expect(end.isDone).toBe(true);
});

describe.each(["asc", "desc"] as const)("%s", (order) => {
  test.each(["prepend", "append"] as const)(
    "%s across page boundaries and empty accounts",
    async (position) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const [name, count] of [
          ["A", 1],
          ["B", 0],
          ["C", 2],
          ["D", 0],
        ] as const) {
          const accountId = await ctx.db.insert("accounts", { name });
          for (let i = 0; i < count; i++) {
            await ctx.db.insert("projects", { accountId, name: `${name}${i}` });
          }
        }
        const db = stream(ctx.db, schema);
        const query = db
          .query("accounts")
          .withIndex("name")
          .order(order)
          .flatMap(async (account) => {
            const projects = db
              .query("projects")
              .withIndex("accountId", (q) => q.eq("accountId", account._id))
              .order(order)
              .map<Row>(async (project) => ({ account, project }));
            const timestamp =
              (position === "append") === (order === "asc")
                ? Infinity
                : -Infinity;
            const marker = new SingletonStream<Row>(
              { account, project: null },
              order,
              fields,
              [account._id, timestamp, ""],
              [account._id],
            );
            return mergedStream([projects, marker], fields);
          }, fields);
        const expectedGroups =
          order === "asc" ? ["A", "B", "C", "D"] : ["D", "C", "B", "A"];
        const expected = expectedGroups.flatMap((name) => {
          const projects =
            name === "A"
              ? ["A0"]
              : name === "C"
                ? order === "asc"
                  ? ["C0", "C1"]
                  : ["C1", "C0"]
                : [];
          return position === "append"
            ? [...projects, name]
            : [name, ...projects];
        });
        for (const budget of [
          {},
          { maximumRowsRead: 1 },
          { maximumBytesRead: 1 },
        ]) {
          const actual: string[] = [];
          let cursor: string | null = null;
          const seen = new Set<string>();
          let done = false;
          for (let i = 0; i < 20; i++) {
            const page = await query.paginate({
              cursor,
              numItems: 1,
              ...budget,
            });
            actual.push(
              ...page.page.map((row) => row.project?.name ?? row.account.name),
            );
            if (page.isDone) {
              done = true;
              break;
            }
            expect(seen.has(page.continueCursor)).toBe(false);
            seen.add(page.continueCursor);
            const bounded = await query.paginate({
              cursor,
              numItems: 1,
              endCursor: page.continueCursor,
            });
            expect(bounded.page).toEqual(page.page);
            cursor = page.continueCursor;
          }
          expect(done).toBe(true);
          expect(actual).toEqual(expected);
        }
      });
    },
  );
});
