import type { GenericDocument } from "convex/server";
import { defineTable, defineSchema } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import type { IndexKey } from "./pagination.js";
import { getPage, paginator } from "./pagination.js";
import { modules } from "./setup.test.js";
import type { GenericId } from "convex/values";
import { v } from "convex/values";

const schema = defineSchema({
  foo: defineTable({
    a: v.number(),
    b: v.number(),
    c: v.number(),
  }).index("abc", ["a", "b", "c"]),
});

function stripSystemFields(doc: GenericDocument) {
  const { _id, _creationTime, ...rest } = doc;
  return rest;
}
function dropSystemFields(indexKey: IndexKey) {
  return indexKey.slice(0, -2);
}

const MANY_DOCS: { a: number; b: number; c: number }[] = [];
for (let a = 0; a < 3; a++) {
  for (let b = 0; b < 3; b++) {
    for (let c = 0; c < 3; c++) {
      MANY_DOCS.push({ a, b, c });
    }
  }
}

describe("manual pagination", () => {
  beforeEach(() => {});
  afterEach(() => {});
  test("single doc by creation time", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      const { page, indexKeys, hasMore } = await getPage(ctx, { table: "foo" });
      expect(page.map(stripSystemFields)).toEqual([{ a: 1, b: 2, c: 3 }]);
      expect(hasMore).toBe(false);
      expect(indexKeys.map(dropSystemFields)).toEqual([[]]);
    });
  });

  test("single doc by abc", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      const { page, indexKeys, hasMore } = await getPage(ctx, {
        table: "foo",
        index: "abc",
        schema,
      });
      expect(page.map(stripSystemFields)).toEqual([{ a: 1, b: 2, c: 3 }]);
      expect(hasMore).toBe(false);
      expect(indexKeys.map(dropSystemFields)).toEqual([[1, 2, 3]]);
    });
  });

  test.each(["asc", "desc"] as const)(
    "empty endpoints remain unbounded when marked exclusive (%s)",
    async (order) => {
      // getPage uses [] to mean no cutoff at that end of the index. Inclusivity
      // only applies to nonempty keys, so [] must not turn a normal scan into an
      // empty range. The opposite endpoint and page limits still apply.
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const doc of MANY_DOCS) await ctx.db.insert("foo", doc);
        for (const { startIndexKey, endIndexKey, expected } of [
          { startIndexKey: [], endIndexKey: [], expected: MANY_DOCS.slice() },
          {
            startIndexKey: [],
            endIndexKey: [1],
            expected: MANY_DOCS.filter(({ a }) =>
              order === "asc" ? a < 1 : a > 1,
            ),
          },
          {
            startIndexKey: [1],
            endIndexKey: [],
            expected: MANY_DOCS.filter(({ a }) =>
              order === "asc" ? a > 1 : a < 1,
            ),
          },
        ]) {
          if (order === "desc") expected.reverse();
          const { page, hasMore } = await getPage(ctx, {
            table: "foo",
            index: "abc",
            schema,
            order,
            startIndexKey,
            endIndexKey,
            startInclusive: false,
            endInclusive: false,
          });
          expect(page.map(stripSystemFields)).toEqual(expected);
          expect(hasMore).toBe(false);
        }
      });
    },
  );

  test.each(["asc", "desc"] as const)(
    "paginate within an index prefix (%s)",
    async (order) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const doc of MANY_DOCS) await ctx.db.insert("foo", doc);
        const request = {
          table: "foo",
          index: "abc",
          schema,
          order,
          startIndexKey: [1, 1],
          endIndexKey: [1, 1],
          targetMaxRows: 1,
        };
        const expected = MANY_DOCS.filter(({ a, b }) => a === 1 && b === 1);
        if (order === "desc") expected.reverse();

        // An exclusive starting prefix skips every document in the prefix.
        const excluded = await getPage(ctx, request);
        expect(excluded.page).toEqual([]);
        expect(excluded.hasMore).toBe(false);

        // Even a partial end key ignores targetMaxRows, so use absoluteMaxRows.
        const all = await getPage(ctx, { ...request, startInclusive: true });
        expect(all.page.map(stripSystemFields)).toEqual(expected);
        expect(all.hasMore).toBe(false);

        const first = await getPage(ctx, {
          ...request,
          startInclusive: true,
          absoluteMaxRows: 2,
        });
        expect(first.page.map(stripSystemFields)).toEqual(expected.slice(0, 2));
        expect(first.hasMore).toBe(true);
        expect(first.indexKeys.map(dropSystemFields)).toEqual(
          expected.slice(0, 2).map(({ a, b, c }) => [a, b, c]),
        );

        // Resume exclusively from the full key, keeping the prefix as the end.
        const next = await getPage(ctx, {
          ...request,
          startIndexKey: first.indexKeys[first.indexKeys.length - 1],
          absoluteMaxRows: 2,
        });
        expect(next.page.map(stripSystemFields)).toEqual(expected.slice(2));
        expect(next.hasMore).toBe(false);
        expect(next.indexKeys).toEqual(all.indexKeys.slice(2));
      });
    },
  );

  test("middle page with exclusive/inclusive bounds", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const doc of MANY_DOCS) {
        await ctx.db.insert("foo", doc);
      }
      const inclusiveDocs = [
        { a: 1, b: 1, c: 0 },
        { a: 1, b: 1, c: 1 },
        { a: 1, b: 1, c: 2 },
        { a: 1, b: 2, c: 0 },
        { a: 1, b: 2, c: 1 },
        { a: 1, b: 2, c: 2 },
      ];
      const request = {
        table: "foo",
        index: "abc",
        schema,
        startIndexKey: [1, 1, 0],
        endIndexKey: [1, 2, 2],
      };
      const { page, hasMore } = await getPage(ctx, {
        ...request,
        startInclusive: true,
        endInclusive: true,
      });
      expect(hasMore).toBe(false);
      expect(page.map(stripSystemFields)).toEqual(inclusiveDocs);

      const { page: page2 } = await getPage(ctx, {
        ...request,
        startInclusive: true,
        endInclusive: false,
      });
      expect(page2.map(stripSystemFields)).toEqual(inclusiveDocs.slice(0, -1));

      const { page: page3 } = await getPage(ctx, {
        ...request,
        startInclusive: false,
        endInclusive: true,
      });
      expect(page3.map(stripSystemFields)).toEqual(inclusiveDocs.slice(1));

      const { page: page4 } = await getPage(ctx, {
        ...request,
        startInclusive: false,
        endInclusive: false,
      });
      expect(page4.map(stripSystemFields)).toEqual(inclusiveDocs.slice(1, -1));
    });
  });

  test("three pages with refreshes", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const doc of MANY_DOCS) {
        await ctx.db.insert("foo", doc);
      }
      const { page: page0, indexKeys: indexKeys0 } = await getPage(ctx, {
        table: "foo",
        index: "abc",
        schema,
        targetMaxRows: 3,
      });
      expect(page0.length).toBe(3);
      const { page: page1, indexKeys: indexKeys1 } = await getPage(ctx, {
        table: "foo",
        index: "abc",
        schema,
        targetMaxRows: 3,
        startIndexKey: indexKeys0[2],
      });
      expect(page1.length).toBe(3);
      const { page: page2 } = await getPage(ctx, {
        table: "foo",
        index: "abc",
        schema,
        targetMaxRows: 3,
        startIndexKey: indexKeys1[2],
      });
      expect(page2.length).toBe(3);
      expect([...page0, ...page1, ...page2].map(stripSystemFields)).toEqual(
        MANY_DOCS.slice(0, 9),
      );

      // Delete the first doc and refresh the first page.
      // It should return only 2 documents because the second page has the third
      // document already.
      await ctx.db.delete("foo", page0[0]!._id as GenericId<"foo">);
      const { page: page0Refreshed } = await getPage(ctx, {
        table: "foo",
        index: "abc",
        schema,
        targetMaxRows: 3,
        endIndexKey: indexKeys0[2],
      });
      expect(page0Refreshed).toEqual(page0.slice(1));

      // Insert a doc in the middle and refresh the second page.
      // It should return 4 documents because it needs to stay adjacent to the
      // third page.
      await ctx.db.insert("foo", { a: 0, b: 1, c: 1.5 });
      const { page: page1Refreshed } = await getPage(ctx, {
        table: "foo",
        index: "abc",
        schema,
        targetMaxRows: 3,
        startIndexKey: indexKeys0[2],
        endIndexKey: indexKeys1[2],
      });
      expect(page1Refreshed.map(stripSystemFields)).toEqual([
        { a: 0, b: 1, c: 0 },
        { a: 0, b: 1, c: 1 },
        { a: 0, b: 1, c: 1.5 },
        { a: 0, b: 1, c: 2 },
      ]);
      // With an absoluteMaxRows of 3, the pages stop being adjacent, but only
      // three rows are returned so we stay within limits.
      const { page: page1AbsoluteMax } = await getPage(ctx, {
        table: "foo",
        index: "abc",
        schema,
        targetMaxRows: 3,
        startIndexKey: indexKeys0[2],
        endIndexKey: indexKeys1[2],
        absoluteMaxRows: 3,
      });
      expect(page1AbsoluteMax.map(stripSystemFields)).toEqual([
        { a: 0, b: 1, c: 0 },
        { a: 0, b: 1, c: 1 },
        { a: 0, b: 1, c: 1.5 },
      ]);
    });
  });

  test("skip forward and scroll back", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const doc of MANY_DOCS) {
        await ctx.db.insert("foo", doc);
      }
      const { page: pageAt } = await getPage(ctx, {
        table: "foo",
        index: "abc",
        schema,
        targetMaxRows: 3,
        startIndexKey: [1],
        startInclusive: true,
      });
      expect(pageAt.map(stripSystemFields)).toEqual([
        { a: 1, b: 0, c: 0 },
        { a: 1, b: 0, c: 1 },
        { a: 1, b: 0, c: 2 },
      ]);
      const { page: pagePrev, indexKeys: indexKeysPrev } = await getPage(ctx, {
        table: "foo",
        index: "abc",
        schema,
        targetMaxRows: 3,
        startIndexKey: [1],
        startInclusive: false,
        order: "desc",
      });
      expect(pagePrev.map(stripSystemFields)).toEqual([
        { a: 0, b: 2, c: 2 },
        { a: 0, b: 2, c: 1 },
        { a: 0, b: 2, c: 0 },
      ]);
      // Refresh prev page and correct the order.
      const { page: pagePrevRefreshed } = await getPage(ctx, {
        table: "foo",
        index: "abc",
        schema,
        targetMaxRows: 3,
        startIndexKey: indexKeysPrev[2],
        endIndexKey: [1],
        startInclusive: true,
        endInclusive: false,
      });
      pagePrev.reverse();
      expect(pagePrevRefreshed).toEqual(pagePrev);
    });
  });
});

describe("paginator", () => {
  test("full table scan", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 5 });
      const result1 = await paginator(ctx.db, schema)
        .query("foo")
        .paginate({ numItems: 100, cursor: null });
      expect(result1.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 2, c: 4 },
        { a: 1, b: 2, c: 5 },
      ]);
      expect(result1.isDone).toBe(true);
      expect(result1.continueCursor).toBe("[]");
    });
  });

  test("paginated table scan", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 5 });
      const result1 = await paginator(ctx.db, schema)
        .query("foo")
        .paginate({ numItems: 2, cursor: null });
      expect(result1.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 2, c: 4 },
      ]);
      expect(result1.isDone).toBe(false);

      const result2 = await paginator(ctx.db, schema)
        .query("foo")
        .paginate({ numItems: 2, cursor: result1.continueCursor });
      expect(result2.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 5 },
      ]);
      expect(result2.isDone).toBe(true);
    });
  });

  test("index range", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 5, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 6, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 2 });
      const result1 = await paginator(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 3).lte("b", 5))
        .paginate({ cursor: null, numItems: 100 });
      expect(result1.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 4, c: 1 },
        { a: 1, b: 4, c: 2 },
        { a: 1, b: 5, c: 1 },
      ]);
      expect(result1.isDone).toBe(true);

      // Descending.
      const result2 = await paginator(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 3).lte("b", 5))
        .order("desc")
        .paginate({ cursor: null, numItems: 100 });
      expect(result2.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 5, c: 1 },
        { a: 1, b: 4, c: 2 },
        { a: 1, b: 4, c: 1 },
      ]);
      expect(result2.isDone).toBe(true);
    });
  });

  test("paginated index range desc", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 5, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 5, c: 2 });
      await ctx.db.insert("foo", { a: 1, b: 5, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 6, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 2 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 2 });
      const result1 = await paginator(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 3).lte("b", 5))
        .order("desc")
        .paginate({ cursor: null, numItems: 2 });
      expect(result1.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 5, c: 3 },
        { a: 1, b: 5, c: 2 },
      ]);
      expect(result1.isDone).toBe(false);

      const result2 = await paginator(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 3).lte("b", 5))
        .order("desc")
        .paginate({ cursor: result1.continueCursor, numItems: 3 });
      expect(result2.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 5, c: 1 },
        { a: 1, b: 4, c: 2 },
        { a: 1, b: 4, c: 1 },
      ]);
      expect(result2.isDone).toBe(false);

      const result3 = await paginator(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 3).lte("b", 5))
        .order("desc")
        .paginate({ cursor: result2.continueCursor, numItems: 2 });
      expect(result3.page.map(stripSystemFields)).toEqual([]);
      expect(result3.isDone).toBe(true);
    });
  });

  test("invalid index range", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      expect(() =>
        paginator(ctx.db, schema)
          .query("foo")
          .withIndex("abc", (q) => q.gt("c" as any, 3)),
      ).toThrow("Cannot use gt on field 'c'");
      expect(() =>
        paginator(ctx.db, schema)
          .query("foo")
          .withIndex("abc", (q) => q.eq("a", 1).eq("c" as any, 3)),
      ).toThrow("Cannot use eq on field 'c'");
      expect(() =>
        paginator(ctx.db, schema)
          .query("foo")
          .withIndex("abc", (q) => (q.gt("a", 1) as any).gt("b", 3)),
      ).toThrow("Cannot use gt on field 'b'");
      expect(() =>
        paginator(ctx.db, schema)
          .query("foo")
          .withIndex("abc", (q) => (q.gt("a", 1).lt("a", 3) as any).eq("b", 3)),
      ).toThrow("Cannot use eq on field 'b'");
    });
  });

  test("endCursor", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 5, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 6, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 3 });
      // First page has two items in it.
      const result1 = await paginator(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 3).lte("b", 5))
        .paginate({ cursor: null, numItems: 2 });
      expect(result1.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 4, c: 1 },
        { a: 1, b: 4, c: 3 },
      ]);
      expect(result1.isDone).toBe(false);
      // Add an item to the first page and refetch with endCursor.
      await ctx.db.insert("foo", { a: 1, b: 4, c: 2 });
      const result2 = await paginator(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 3).lte("b", 5))
        .paginate({
          cursor: null,
          endCursor: result1.continueCursor,
          numItems: 2,
        });
      expect(result2.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 4, c: 1 },
        { a: 1, b: 4, c: 2 },
        { a: 1, b: 4, c: 3 },
      ]);
      expect(result2.isDone).toBe(false);
      expect(result1.continueCursor).toStrictEqual(result2.continueCursor);

      // Second page has one item in it.
      const result3 = await paginator(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 3).lte("b", 5))
        .paginate({ cursor: result2.continueCursor, numItems: 2 });
      expect(result3.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 5, c: 1 },
      ]);
      expect(result3.isDone).toBe(true);
      // Add two items to the second page and refetch with endCursor.
      await ctx.db.insert("foo", { a: 1, b: 5, c: 2 });
      await ctx.db.insert("foo", { a: 1, b: 5, c: 3 });
      const result4 = await paginator(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 3).lte("b", 5))
        .paginate({
          cursor: result2.continueCursor,
          endCursor: result3.continueCursor,
          numItems: 2,
        });
      expect(result4.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 5, c: 1 },
        { a: 1, b: 5, c: 2 },
        { a: 1, b: 5, c: 3 },
      ]);
      expect(result4.isDone).toBe(true);
    });
  });
});
