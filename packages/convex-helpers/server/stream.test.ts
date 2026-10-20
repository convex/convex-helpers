import type { GenericDocument } from "convex/server";
import { defineTable, defineSchema } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import type { IndexKey } from "./stream.js";
import { mergedStream, stream, streamIndexRange } from "./stream.js";
import { modules } from "./setup.test.js";
import { convexToJson, getDocumentSize, v } from "convex/values";

const schema = defineSchema({
  foo: defineTable({
    a: v.number(),
    b: v.number(),
    c: v.number(),
  })
    .index("abc", ["a", "b", "c"])
    .index("ac", ["a", "c"]),
  bar: defineTable({
    c: v.number(),
    d: v.number(),
    e: v.number(),
  }).index("cde", ["c", "d", "e"]),
});

function stripSystemFields(doc: GenericDocument | null) {
  if (doc === null) return doc;
  const { _id, _creationTime, ...rest } = doc;
  return rest;
}
function dropSystemFields(indexKey: IndexKey) {
  return indexKey.slice(0, -2);
}
function dropAndStripSystemFields(
  item: IteratorResult<[GenericDocument | null, IndexKey, number], undefined>,
) {
  return {
    done: item.done,
    value: item.value
      ? [stripSystemFields(item.value[0]), dropSystemFields(item.value[1])]
      : undefined,
  };
}

const MANY_DOCS: { a: number; b: number; c: number }[] = [];
for (let a = 0; a < 3; a++) {
  for (let b = 0; b < 3; b++) {
    for (let c = 0; c < 3; c++) {
      MANY_DOCS.push({ a, b, c });
    }
  }
}

describe("pagination cursor isolation", () => {
  const tenantSchema = defineSchema({
    companies: defineTable({}),
    contacts: defineTable({
      companyId: v.id("companies"),
      createdAt: v.number(),
    }).index("by_company_createdAt", ["companyId", "createdAt"]),
  });

  async function setup() {
    const t = convexTest(tenantSchema, modules);
    const companies = await t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 3; i++) {
        const companyId = await ctx.db.insert("companies", {});
        ids.push(companyId);
        for (let createdAt = 0; createdAt < 3; createdAt++) {
          await ctx.db.insert("contacts", { companyId, createdAt });
        }
      }
      return ids.sort();
    });
    return { t, companies };
  }

  test.each(["asc", "desc"] as const)(
    "foreign cursors stay within the declared tenant range (%s)",
    async (order) => {
      const { t, companies } = await setup();
      await t.run(async (ctx) => {
        const db = stream(ctx.db, tenantSchema);
        const query = db
          .query("contacts")
          .withIndex("by_company_createdAt", (q) =>
            q.eq("companyId", companies[1]!),
          )
          .order(order);
        const expected = await query.collect();
        expect(expected).toHaveLength(3);
        const foreignCompanies =
          order === "asc"
            ? [companies[2]!, companies[0]!]
            : [companies[0]!, companies[2]!];
        for (const foreignCompany of foreignCompanies) {
          const foreignPage = await db
            .query("contacts")
            .withIndex("by_company_createdAt", (q) =>
              q.eq("companyId", foreignCompany),
            )
            .order(order)
            .paginate({ cursor: null, numItems: 2 });
          // Both complete document cursors and shorter index prefixes must
          // intersect the static bounds, never expand them.
          const key = JSON.parse(foreignPage.continueCursor);
          for (const cursor of [
            foreignPage.continueCursor,
            JSON.stringify(key.slice(0, 1)),
            JSON.stringify(key.slice(0, 2)),
          ]) {
            const pastTenant =
              order === "asc"
                ? foreignCompany > companies[1]!
                : foreignCompany < companies[1]!;
            const page = await query.paginate({ cursor, numItems: 10 });
            expect(page.page).toEqual(pastTenant ? [] : expected);
            expect(page.isDone).toBe(true);
            const endingPage = await query.paginate({
              cursor: null,
              endCursor: cursor,
              numItems: 10,
            });
            expect(endingPage.page).toEqual(pastTenant ? expected : []);
          }
        }
      });
    },
  );

  test.each(["asc", "desc"] as const)(
    "the terminal empty cursor cannot escape the tenant range (%s)",
    async (order) => {
      const { t, companies } = await setup();
      await t.run(async (ctx) => {
        const query = stream(ctx.db, tenantSchema)
          .query("contacts")
          .withIndex("by_company_createdAt", (q) =>
            q.eq("companyId", companies[1]!),
          )
          .order(order);
        const complete = await query.paginate({ cursor: null, numItems: 10 });
        expect(complete.page).toHaveLength(3);
        expect(
          complete.page.every((doc) => doc.companyId === companies[1]),
        ).toBe(true);
        expect(complete.isDone).toBe(true);
        expect(complete.continueCursor).toBe("[]");
        const resumed = await query.paginate({
          cursor: complete.continueCursor,
          numItems: 1,
        });
        expect(resumed.page).toEqual([]);
        expect(resumed.isDone).toBe(true);
        expect(resumed.continueCursor).toBe("[]");
        const endingPage = await query.paginate({
          cursor: null,
          endCursor: "[]",
          numItems: 1,
        });
        expect(endingPage.page).toEqual(complete.page);
        expect(endingPage.isDone).toBe(true);
      });
    },
  );
});

describe("reflect", () => {
  test("reflection", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 2))
        .order("desc");
      const { table, index, bounds, indexFields, order } = query.reflect();
      expect(table).toBe("foo");
      expect(index).toBe("abc");
      expect(bounds.lowerBound).toEqual([1, 2]);
      expect(bounds.lowerBoundInclusive).toBe(false);
      expect(bounds.upperBound).toEqual([1]);
      expect(bounds.upperBoundInclusive).toBe(true);
      expect(indexFields).toEqual(["a", "b", "c", "_creationTime", "_id"]);
      expect(order).toBe("desc");
    });
  });

  test("reflection as query", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 3 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 2))
        .order("desc");
      const result = await query.collect();
      expect(result.map(stripSystemFields)).toEqual([
        { a: 1, b: 4, c: 3 },
        { a: 1, b: 3, c: 3 },
      ]);
    });
  });
});

describe("stream", () => {
  test("reflection as stream", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 3 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 2))
        .order("desc");
      expect(query.getOrder()).toBe("desc");
      const iter = query.iterWithKeys()[Symbol.asyncIterator]();
      expect(dropAndStripSystemFields(await iter.next())).toEqual({
        done: false,
        value: [{ a: 1, b: 4, c: 3 }, [1, 4, 3]],
      });
      expect(dropAndStripSystemFields(await iter.next())).toEqual({
        done: false,
        value: [{ a: 1, b: 3, c: 3 }, [1, 3, 3]],
      });
      expect(dropAndStripSystemFields(await iter.next())).toEqual({
        done: true,
      });
    });
  });

  test("query round trip", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 3 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 2))
        .order("desc");
      const result = await query.collect();
      expect(result.map(stripSystemFields)).toEqual([
        { a: 1, b: 4, c: 3 },
        { a: 1, b: 3, c: 4 },
        { a: 1, b: 3, c: 3 },
      ]);
    });
  });

  test("query round trip with pagination", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // put first out of order just in case
      await ctx.db.insert("foo", { a: 1, b: 4, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 4 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 2));
      const resultPage1 = await query.paginate({ numItems: 2, cursor: null });
      expect(resultPage1.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 3, c: 3 },
        { a: 1, b: 3, c: 4 },
      ]);
      expect(resultPage1.isDone).toBe(false);
      const resultPage2 = await query.paginate({
        numItems: 2,
        cursor: resultPage1.continueCursor,
      });
      expect(resultPage2.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 4, c: 3 },
        { a: 1, b: 4, c: 4 },
      ]);
      expect(resultPage2.isDone).toBe(false);
      const resultPage3 = await query.paginate({
        numItems: 2,
        cursor: resultPage2.continueCursor,
      });
      expect(resultPage3.page.map(stripSystemFields)).toEqual([]);
      expect(resultPage3.isDone).toBe(true);
    });
  });

  test("continuCursor respects the order of the stream", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // put first out of order just in case
      await ctx.db.insert("foo", { a: 1, b: 1, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 2 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 2 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc")
        .order("desc");
      const result = await query.paginate({ numItems: 1, cursor: null });
      expect(result.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 3, c: 2 },
      ]);
      expect(result.isDone).toBe(false);
      expect(result.continueCursor).toMatch("[1,3,2");
      const result2 = await query.paginate({
        numItems: 1,
        cursor: result.continueCursor,
      });
      expect(result2.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 3 },
      ]);
      expect(result2.isDone).toBe(false);
      expect(result2.continueCursor).toMatch("[1,2,3");
      const result3 = await query.paginate({
        numItems: 1,
        cursor: result2.continueCursor,
      });
      expect(result3.continueCursor).toMatch("[1,2,2");
      expect(result3.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 2 },
      ]);
      expect(result3.isDone).toBe(false);
    });
  });

  test("query round trip with pagination one item at a time", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // put first out of order just in case
      await ctx.db.insert("foo", { a: 1, b: 3, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 2 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 2 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      const query = stream(ctx.db, schema).query("foo").withIndex("abc");
      const result = await query.paginate({ numItems: 1, cursor: null });
      expect(result.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 1 },
      ]);
      expect(result.isDone).toBe(false);
      const result2 = await query.paginate({
        numItems: 2,
        cursor: result.continueCursor,
      });
      expect(result2.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 2 },
        { a: 1, b: 2, c: 3 },
      ]);
      expect(result2.isDone).toBe(false);
      const result3 = await query.paginate({
        numItems: 1,
        cursor: result2.continueCursor,
      });
      expect(result3.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 3, c: 1 },
      ]);
      expect(result3.isDone).toBe(false);
    });
  });

  test("merge streams", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 3 }); // excluded
      await ctx.db.insert("foo", { a: 1, b: 4, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 5, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 6, c: 5 });
      const query1 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 4));
      const query2 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).lt("b", 3));
      const query3 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).eq("b", 4).eq("c", 3));
      const fullQuery = mergedStream([query1, query2, query3], ["a", "b", "c"]);
      const result = await fullQuery.collect();
      expect(result.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 4, c: 3 },
        { a: 1, b: 5, c: 4 },
        { a: 1, b: 6, c: 5 },
      ]);
      const page1 = await fullQuery.paginate({
        numItems: 2,
        cursor: null,
      });
      expect(page1.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 4, c: 3 },
      ]);
      expect(page1.isDone).toBe(false);
      const page2 = await fullQuery.paginate({
        numItems: 3,
        cursor: page1.continueCursor,
      });
      expect(page2.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 5, c: 4 },
        { a: 1, b: 6, c: 5 },
      ]);
      expect(page2.isDone).toBe(true);
    });
  });

  test("merge streams desc", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 3 });
      await ctx.db.insert("foo", { a: 2, b: 1, c: 3 });
      await ctx.db.insert("foo", { a: 2, b: 4, c: 4 });
      const query1 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1))
        .order("desc");
      const query2 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 2))
        .order("desc");
      const merged = mergedStream([query1, query2], ["a", "b", "c"]);
      const result = await merged.collect();
      expect(result.map(stripSystemFields)).toEqual([
        { a: 2, b: 4, c: 4 },
        { a: 2, b: 1, c: 3 },
        { a: 1, b: 3, c: 3 },
        { a: 1, b: 2, c: 3 },
      ]);
    });
  });

  test("filter stream", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 }); // excluded by index
      await ctx.db.insert("foo", { a: 1, b: 3, c: 3 }); // excluded by filter
      await ctx.db.insert("foo", { a: 1, b: 4, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 5 }); // excluded by filter
      await ctx.db.insert("foo", { a: 1, b: 5, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 6, c: 4 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 2));
      const filteredQuery = query.filterWith(async (doc) => doc.c === 4);
      const result = await filteredQuery.collect();
      expect(result.map(stripSystemFields)).toEqual([
        { a: 1, b: 4, c: 4 },
        { a: 1, b: 5, c: 4 },
        { a: 1, b: 6, c: 4 },
      ]);
      const page1 = await filteredQuery.paginate({
        numItems: 2,
        cursor: null,
      });
      expect(page1.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 4, c: 4 },
        { a: 1, b: 5, c: 4 },
      ]);
      expect(page1.isDone).toBe(false);

      const limitedPage1 = await filteredQuery.paginate({
        numItems: 2,
        cursor: null,
        maximumRowsRead: 2,
      });
      expect(limitedPage1.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 4, c: 4 },
      ]);
      expect(limitedPage1.pageStatus).toBe("SplitRequired");
      // Splits land on a returned document, not the filtered-out [1, 3, 3].
      expect(dropSystemFields(JSON.parse(limitedPage1.splitCursor!))).toEqual([
        1, 4, 4,
      ]);
      expect(dropSystemFields(JSON.parse(limitedPage1.continueCursor))).toEqual(
        [1, 4, 4],
      );
    });
  });

  test("no SplitRecommended without endCursor", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 1; i <= 20; i++) {
        await ctx.db.insert("foo", { a: 1, b: i, c: i % 2 === 0 ? 1 : 0 });
      }
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1))
        .filterWith(async (doc) => doc.c === 1);

      const page1 = await query.paginate({
        numItems: 3,
        cursor: null,
      });
      expect(page1.page).toHaveLength(3);
      expect(page1.pageStatus).toBeUndefined();
    });
  });

  test("SplitRecommended when endCursor set and page exceeds numItems + 1", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 1; i <= 10; i++) {
        await ctx.db.insert("foo", { a: 1, b: i, c: i % 2 === 0 ? 1 : 0 });
      }
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1))
        .filterWith(async (doc) => doc.c === 1);

      const endCursor = JSON.stringify(convexToJson([1, 100, 0]));
      const page = await query.paginate({
        numItems: 3,
        cursor: null,
        endCursor,
      });
      // 5 matches out of 10 docs. 5 >= numItems + 1 (4) → SplitRecommended.
      expect(page.page).toHaveLength(5);
      expect(page.pageStatus).toBe("SplitRecommended");
      expect(page.splitCursor).toBeDefined();
    });
  });

  test("SplitRecommended when scan approaches scan limit regardless of endCursor", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // SOFT_MAX_SCAN_LEN = 32000 / 2 = 16000. Insert that many docs where
      // only a handful match the filter, so indexKeys hits the soft max while
      // page.length stays below numItems + 1.
      for (let i = 1; i <= 16000; i++) {
        await ctx.db.insert("foo", { a: 4, b: i, c: i % 3000 === 0 ? 1 : 0 });
      }
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 4))
        .filterWith(async (doc) => doc.c === 1);

      const page = await query.paginate({
        numItems: 10,
        cursor: null,
        endCursor: null,
      });
      // a few matches, but many index keys scanned.
      expect(page.page).toHaveLength(5);
      expect(page.pageStatus).toBe("SplitRecommended");
      expect(page.splitCursor).toBeDefined();
    });
  });

  test("SplitRequired fires with filterWith when maximumRowsRead is hit", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 1; i <= 20; i++) {
        await ctx.db.insert("foo", { a: 3, b: i, c: i % 5 === 0 ? 1 : 0 });
      }
      const filteredQuery = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 3))
        .filterWith(async (doc) => doc.c === 1);

      const page1 = await filteredQuery.paginate({
        numItems: 3,
        cursor: null,
        maximumRowsRead: 8,
      });
      // Hit the hard row limit before finding 3 matches.
      // Only 1 match in first 8 rows (b=5).
      expect(page1.page).toHaveLength(1);
      expect(page1.pageStatus).toBe("SplitRequired");
      expect(page1.splitCursor).toBeDefined();
    });
  });

  test("merge orderBy streams", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 3 });
      await ctx.db.insert("foo", { a: 2, b: 1, c: 3 });
      await ctx.db.insert("foo", { a: 2, b: 4, c: 4 });
      await ctx.db.insert("foo", { a: 3, b: 6, c: 5 });
      const query1 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));
      const query2 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 2));
      const merged = mergedStream([query1, query2], ["b", "c"]);
      const result = await merged.collect();
      expect(result.map(stripSystemFields)).toEqual([
        { a: 2, b: 1, c: 3 },
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 3, c: 3 },
        { a: 2, b: 4, c: 4 },
      ]);
      const mergedDesc = mergedStream(
        [query1.order("desc"), query2.order("desc")],
        ["b", "c"],
      );
      const resultDesc = await mergedDesc.collect();
      expect(resultDesc.map(stripSystemFields)).toEqual([
        { a: 2, b: 4, c: 4 },
        { a: 1, b: 3, c: 3 },
        { a: 1, b: 2, c: 3 },
        { a: 2, b: 1, c: 3 },
      ]);
      const mergedPage1 = await mergedDesc.paginate({
        numItems: 2,
        cursor: null,
      });
      expect(mergedPage1.page.map(stripSystemFields)).toEqual([
        { a: 2, b: 4, c: 4 },
        { a: 1, b: 3, c: 3 },
      ]);
      expect(mergedPage1.isDone).toBe(false);
      const mergedPage2 = await mergedDesc.paginate({
        numItems: 3,
        cursor: mergedPage1.continueCursor,
      });
      expect(mergedPage2.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 3 },
        { a: 2, b: 1, c: 3 },
      ]);
      expect(mergedPage2.isDone).toBe(true);

      // You can't merge streams and exclude an index field that's still used
      // for ordering.
      expect(() => mergedStream([query1, query2], ["c"])).toThrow();
    });
  });

  test("merge streams between indexes", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 4 });
      await ctx.db.insert("foo", { a: 2, b: 2, c: 5 });
      await ctx.db.insert("foo", { a: 3, b: 1, c: 6 });
      const query1 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 2).eq("b", 2));
      const query2 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("ac", (q) => q.eq("a", 1));
      const merged = mergedStream([query1, query2], ["c"]);
      const result = await merged.collect();
      expect(result.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 3, c: 4 },
        { a: 2, b: 2, c: 5 },
      ]);
    });
  });

  test.each(["asc", "desc"] as const)(
    "merged pagination preserves fixed fields when a range becomes empty (%s)",
    async (order) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const doc of MANY_DOCS) await ctx.db.insert("foo", doc);
        const db = stream(ctx.db, schema);
        const query = mergedStream(
          [
            db
              .query("foo")
              .withIndex("abc", (q) => q.eq("a", 1).lte("b", 0))
              .order(order),
            db
              .query("foo")
              .withIndex("abc", (q) => q.eq("a", 2).gte("b", 2))
              .order(order),
          ],
          ["b", "c"],
        );
        const expected = MANY_DOCS.filter(
          ({ a, b }) => (a === 1 && b === 0) || (a === 2 && b === 2),
        );
        if (order === "desc") expected.reverse();
        let cursor: string | null = null;
        for (const [i, doc] of expected.entries()) {
          const remaining = await query.paginate({ cursor, numItems: 100 });
          expect(remaining.page.map(stripSystemFields)).toEqual(
            expected.slice(i),
          );
          const page = await query.paginate({ cursor, numItems: 1 });
          expect(page.page.map(stripSystemFields)).toEqual([doc]);
          cursor = page.continueCursor;
        }
        const last = await query.paginate({ cursor, numItems: 1 });
        expect(last.page).toEqual([]);
        expect(last.isDone).toBe(true);
      });
    },
  );

  test("map stream", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 4 });
      await ctx.db.insert("foo", { a: 2, b: 2, c: 5 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));
      const mapped = query.map(async (doc) => `doc with c: ${doc.c}`);
      const result = await mapped.collect();
      expect(result).toEqual(["doc with c: 3", "doc with c: 4"]);
      const page1 = await mapped.paginate({
        numItems: 1,
        cursor: null,
      });
      expect(page1.page).toEqual(["doc with c: 3"]);
      const page2 = await mapped.paginate({
        numItems: 2,
        cursor: page1.continueCursor,
      });
      expect(page2.page).toEqual(["doc with c: 4"]);
      expect(page2.isDone).toBe(true);
    });
  });

  test("flatMap stream", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 4 });
      await ctx.db.insert("foo", { a: 2, b: 2, c: 5 }); // excluded by index
      // join table
      await ctx.db.insert("bar", { c: 3, d: 4, e: 5 });
      await ctx.db.insert("bar", { c: 3, d: 1, e: 2 });
      await ctx.db.insert("bar", { c: 4, d: 2, e: 3 });
      await ctx.db.insert("bar", { c: 5, d: 3, e: 4 }); // joined document excluded by index
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));
      const flatMapped = query.flatMap(
        async (doc) =>
          stream(ctx.db, schema)
            .query("bar")
            .withIndex("cde", (q) => q.eq("c", doc.c))
            .map(async (joinDoc) => ({ ...joinDoc, ...doc })),
        ["c", "d", "e"],
      );
      const result = await flatMapped.collect();
      expect(result.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 3, d: 1, e: 2 },
        { a: 1, b: 2, c: 3, d: 4, e: 5 },
        { a: 1, b: 3, c: 4, d: 2, e: 3 },
      ]);
    });
  });

  test.each(["asc", "desc"] as const)(
    "flatMap pagination preserves later outer items (%s)",
    async (order) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        // The join keys run opposite to the outer stream's ordering.
        for (const a of [1, 2, 3]) {
          const c = 4 - a;
          await ctx.db.insert("foo", { a, b: 0, c });
          for (const d of [1, 2, 3]) {
            await ctx.db.insert("bar", { c, d, e: 0 });
          }
        }
        const query = stream(ctx.db, schema)
          .query("foo")
          .withIndex("abc")
          .order(order)
          // Mapped values need not contain their original index fields.
          .map(async (doc) => ({ joinKey: doc.c }))
          .flatMap(
            async (doc) =>
              stream(ctx.db, schema)
                .query("bar")
                .withIndex("cde", (q) => q.eq("c", doc.joinKey))
                .order(order),
            ["c", "d", "e"],
          );
        const all = await query.collect();
        expect(all).toHaveLength(9);

        const first = await query.paginate({ cursor: null, numItems: 1 });
        const rest = await query.paginate({
          cursor: first.continueCursor,
          numItems: 10,
        });
        expect([...first.page, ...rest.page]).toEqual(all);
        expect(rest.isDone).toBe(true);

        for (const numItems of [1, 2, 4]) {
          let cursor: string | null = null;
          const paged = [];
          for (let i = 0; i <= all.length; i++) {
            const page = await query.paginate({ cursor, numItems });
            const reread = await query.paginate({
              cursor,
              endCursor: page.continueCursor,
              numItems,
            });
            expect(reread.page).toEqual(page.page);
            paged.push(...page.page);
            if (page.isDone) break;
            expect(page.continueCursor).not.toBe(cursor);
            cursor = page.continueCursor;
          }
          expect(paged).toEqual(all);
        }

        // Exercise both bounds within one outer item, across adjacent items,
        // and with an entire outer item strictly between them.
        const cursors: (string | null)[] = [null];
        for (let i = 0; i < all.length; i++) {
          const page = await query.paginate({
            cursor: cursors[i]!,
            numItems: 1,
          });
          cursors.push(page.continueCursor);
        }
        for (const [start, end] of [
          [1, 2],
          [2, 5],
          [1, 8],
        ] as const) {
          const page = await query.paginate({
            cursor: cursors[start]!,
            endCursor: cursors[end]!,
            numItems: 1,
          });
          expect(page.page).toEqual(all.slice(start, end));
          if (page.splitCursor) {
            const left = await query.paginate({
              cursor: cursors[start]!,
              endCursor: page.splitCursor,
              numItems: 1,
            });
            const right = await query.paginate({
              cursor: page.splitCursor,
              endCursor: cursors[end]!,
              numItems: 1,
            });
            expect([...left.page, ...right.page]).toEqual(page.page);
          }
        }
      });
    },
  );

  test.each(["asc", "desc"] as const)(
    "nested flatMap keeps each cursor prefix until that level advances (%s)",
    async (order) => {
      const nestedSchema = defineSchema({
        a: defineTable({ a: v.number() }).index("a", ["a"]),
        b: defineTable({ b: v.number() }).index("b", ["b"]),
        c: defineTable({ c: v.number() }).index("c", ["c"]),
      });
      const t = convexTest(nestedSchema, modules);
      await t.run(async (ctx) => {
        for (const value of [0, 1, 2]) {
          await ctx.db.insert("a", { a: value });
          await ctx.db.insert("b", { b: value });
          await ctx.db.insert("c", { c: value });
        }
        const db = stream(ctx.db, nestedSchema);
        const a = db.query("a").withIndex("a").order(order);
        const b = db.query("b").withIndex("b").order(order);
        const c = db.query("c").withIndex("c").order(order);
        const ab = a.flatMap(
          async (aDoc) => b.map(async (bDoc) => ({ a: aDoc.a, b: bDoc.b })),
          b.getIndexFields(),
        );
        const bc = b.flatMap(
          async (bDoc) => c.map(async (cDoc) => ({ b: bDoc.b, c: cDoc.c })),
          c.getIndexFields(),
        );
        // Exercise both (a.flatMap(b)).flatMap(c) and a.flatMap(b.flatMap(c)).
        const queries = [
          ab.flatMap(
            async (abDoc) => c.map(async (cDoc) => ({ ...abDoc, c: cDoc.c })),
            c.getIndexFields(),
          ),
          a.flatMap(
            async (aDoc) => bc.map(async (bcDoc) => ({ a: aDoc.a, ...bcDoc })),
            bc.getIndexFields(),
          ),
        ];
        const expected = MANY_DOCS.slice();
        if (order === "desc") expected.reverse();
        for (const query of queries) {
          expect(await query.collect()).toEqual(expected);
          const cursors: (string | null)[] = [null];
          for (const [i, doc] of expected.entries()) {
            const cursor = cursors[i]!;
            const remaining = await query.paginate({ cursor, numItems: 100 });
            expect(remaining.page).toEqual(expected.slice(i));
            expect(remaining.isDone).toBe(true);
            const page = await query.paginate({ cursor, numItems: 1 });
            expect(page.page).toEqual([doc]);
            cursors.push(page.continueCursor);
          }
          // Finish c, then b, before advancing a; also clip at the upper edge.
          for (const [start, end] of [
            [13, 14],
            [13, 17],
            [13, 22],
          ] as const) {
            const page = await query.paginate({
              cursor: cursors[start]!,
              endCursor: cursors[end]!,
              numItems: 1,
            });
            expect(page.page).toEqual(expected.slice(start, end));
          }
          const last = await query.paginate({
            cursor: cursors.at(-1)!,
            numItems: 1,
          });
          expect(last.page).toEqual([]);
          expect(last.isDone).toBe(true);
        }
      });
    },
  );

  test.each(["asc", "desc"] as const)(
    "flatMap resumes merged inner streams after a skipped outer item (%s)",
    async (order) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const a of [1, 2, 3]) {
          await ctx.db.insert("foo", { a, b: 0, c: a });
          for (const d of [1, 2]) {
            await ctx.db.insert("bar", { c: a, d, e: 0 });
          }
        }
        const query = stream(ctx.db, schema)
          .query("foo")
          .withIndex("abc")
          .order(order)
          .filterWith(async (doc) => doc.a === 2)
          .flatMap(
            async (doc) =>
              mergedStream(
                [1, 2].map((d) =>
                  stream(ctx.db, schema)
                    .query("bar")
                    .withIndex("cde", (q) => q.eq("c", doc.c).eq("d", d))
                    .order(order),
                ),
                ["e"],
              ),
            ["e"],
          );
        const all = await query.collect();
        expect(all).toHaveLength(2);
        const first = await query.paginate({
          cursor: null,
          numItems: 10,
          maximumRowsRead: 1,
        });
        expect(first.page).toEqual([]);
        expect(first.isDone).toBe(false);
        const rest = await query.paginate({
          cursor: first.continueCursor,
          numItems: 10,
        });
        expect(rest.page).toEqual(all);
        expect(rest.isDone).toBe(true);
      });
    },
  );

  test("streamIndexRange returns correct subset", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 4, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 5, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 6, c: 0 });
      const bounds = {
        lowerBound: [1, 5],
        lowerBoundInclusive: true,
        upperBound: [1, 6],
        upperBoundInclusive: false,
      };
      const result = await streamIndexRange(
        ctx.db,
        schema,
        "foo",
        "abc",
        bounds,
        "asc",
      ).collect();
      expect(result.map(stripSystemFields)).toEqual([{ a: 1, b: 5, c: 0 }]);
    });
  });

  test.each(["asc", "desc"] as const)(
    "streamIndexRange resumes within and beyond a bounded prefix (%s)",
    async (order) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const doc of MANY_DOCS) await ctx.db.insert("foo", doc);
        const query = streamIndexRange(
          ctx.db,
          schema,
          "foo",
          "abc",
          {
            lowerBound: [1, 1],
            lowerBoundInclusive: true,
            upperBound: [],
            upperBoundInclusive: true,
          },
          order,
        );
        const expected = MANY_DOCS.filter(
          ({ a, b }) => a > 1 || (a === 1 && b >= 1),
        );
        if (order === "desc") expected.reverse();
        expect((await query.collect()).map(stripSystemFields)).toEqual(
          expected,
        );
        let cursor: string | null = null;
        for (const [i, doc] of expected.entries()) {
          const remaining = await query.paginate({ cursor, numItems: 100 });
          expect(remaining.page.map(stripSystemFields)).toEqual(
            expected.slice(i),
          );
          expect(remaining.isDone).toBe(true);
          const page = await query.paginate({ cursor, numItems: 1 });
          expect(page.page.map(stripSystemFields)).toEqual([doc]);
          cursor = page.continueCursor;
        }
        const last = await query.paginate({ cursor, numItems: 1 });
        expect(last.page).toEqual([]);
        expect(last.isDone).toBe(true);
      });
    },
  );

  test.each(["asc", "desc"] as const)(
    "streamIndexRange handles empty intervals and inclusive prefixes (%s)",
    async (order) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const doc of MANY_DOCS) await ctx.db.insert("foo", doc);
        for (const lowerBoundInclusive of [true, false]) {
          for (const upperBoundInclusive of [true, false]) {
            for (const [lowerBound, upperBound] of [
              [[2, 0, 1], [1]],
              [[2], [1, 2, 1]],
              [
                [1, 1],
                [1, 1],
              ],
              [
                [1, 1],
                [1, 1, 1],
              ],
              [
                [1, 1, 1],
                [1, 1],
              ],
            ] as const) {
              const query = streamIndexRange(
                ctx.db,
                schema,
                "foo",
                "abc",
                {
                  lowerBound: [...lowerBound],
                  lowerBoundInclusive,
                  upperBound: [...upperBound],
                  upperBoundInclusive,
                },
                order,
              );
              const expected = MANY_DOCS.filter(({ a, b, c }) => {
                if (a !== 1 || b !== 1 || lowerBound[0] === 2) return false;
                const aboveLower =
                  lowerBound.length === 3
                    ? lowerBoundInclusive
                      ? c >= 1
                      : c > 1
                    : lowerBoundInclusive;
                const belowUpper =
                  upperBound.length === 3
                    ? upperBoundInclusive
                      ? c <= 1
                      : c < 1
                    : upperBoundInclusive;
                return aboveLower && belowUpper;
              });
              if (order === "desc") expected.reverse();
              expect((await query.collect()).map(stripSystemFields)).toEqual(
                expected,
              );
            }
          }
        }
      });
    },
  );

  test.each(["asc", "desc"] as const)(
    "exclusive empty prefixes produce empty index ranges (%s)",
    async (order) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const doc of MANY_DOCS) await ctx.db.insert("foo", doc);
        for (const [lowerBound, upperBound] of [
          [[], []],
          [[], [1]],
          [[1], []],
        ]) {
          for (const lowerBoundInclusive of [true, false]) {
            for (const upperBoundInclusive of [true, false]) {
              if (
                (lowerBound.length !== 0 || lowerBoundInclusive) &&
                (upperBound.length !== 0 || upperBoundInclusive)
              ) {
                continue;
              }
              const query = streamIndexRange(
                ctx.db,
                schema,
                "foo",
                "abc",
                {
                  lowerBound,
                  lowerBoundInclusive,
                  upperBound,
                  upperBoundInclusive,
                },
                order,
              );
              expect(await query.collect()).toEqual([]);
            }
          }
        }
        const unbounded = stream(ctx.db, schema)
          .query("foo")
          .withIndex("abc")
          .order(order);
        const page = await unbounded.paginate({ cursor: "[]", numItems: 1 });
        expect(page.page).toEqual([]);
        expect(page.isDone).toBe(true);
      });
    },
  );

  test("paginate with 0 numItems", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));
      const page = await query.paginate({
        numItems: 0,
        cursor: "",
      });
      expect(page.page).toEqual([]);
      expect(page.isDone).toBe(false);
      expect(page.continueCursor).toBe("");

      await expect(() =>
        query.paginate({
          numItems: 0,
          cursor: null,
        }),
      ).rejects.toThrow();
    });
  });

  test("paginate respects endCursor", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 1, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 0 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1))
        .order("asc");
      const endCursor = JSON.stringify(convexToJson([1, 2, 0]));
      const page = await query.paginate({
        numItems: 10,
        cursor: null,
        endCursor,
      });
      expect(page.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 1, c: 0 },
        { a: 1, b: 2, c: 0 },
      ]);
      // When an endCursor is provided and the end of the query range isn't
      // reached, the query is not `isDone`, since pagination is about getting
      // to the end of the query range, not just until endCursor for each page.
      expect(page.isDone).toBe(false);
    });
  });
  test("paginate cant reconnect cursors with endCursor", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 1, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 0 });
      const withoutEndCursor = await stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1))
        .order("asc")
        .paginate({ numItems: 2, cursor: null });
      expect(withoutEndCursor.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 1, c: 0 },
        { a: 1, b: 2, c: 0 },
      ]);
      expect(withoutEndCursor.isDone).toBe(false);
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1))
        .order("asc");
      const page = await query.paginate({
        numItems: 10,
        cursor: null,
        endCursor: withoutEndCursor.continueCursor,
      });
      expect(page.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 1, c: 0 },
        { a: 1, b: 2, c: 0 },
      ]);
      expect(page.isDone).toBe(false);
    });
  });
  test("flatMap ignores null outer items", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      const result = await stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1))
        .filterWith(async () => false)
        .flatMap(async () => null as any, ["a", "b", "c"])
        .collect();
      expect(result).toEqual([]);
    });
  });

  test("distinct stream", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 5 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 1 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 3 });
      await ctx.db.insert("foo", { a: 2, b: 5, c: 6 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));
      const distinct = query.distinct(["b"]);
      const result = await distinct.collect();
      expect(result.map(stripSystemFields)).toEqual([
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 3, c: 4 },
        { a: 1, b: 4, c: 1 },
      ]);
    });
  });

  /* test both asc and desc */
  test.each([{ order: "asc" }, { order: "desc" }] as const)(
    "distinct pagination works",
    async ({ order }) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const values = [
          { a: 1, b: 2, c: 3 },
          { a: 1, b: 2, c: 5 },
          { a: 1, b: 2, c: 6 },
          { a: 1, b: 3, c: 7 },
          { a: 1, b: 3, c: 8 },
          { a: 1, b: 4, c: 9 },
          { a: 1, b: 4, c: 10 },
          { a: 1, b: 5, c: 0 },
          { a: 1, b: 6, c: 0 },
        ];
        const expectedValuesAsc = [
          { a: 1, b: 2, c: 3 },
          { a: 1, b: 3, c: 7 },
          { a: 1, b: 4, c: 9 },
          { a: 1, b: 5, c: 0 },
          { a: 1, b: 6, c: 0 },
        ];

        const expectedValuesDesc = [
          { a: 1, b: 6, c: 0 },
          { a: 1, b: 5, c: 0 },
          { a: 1, b: 4, c: 10 },
          { a: 1, b: 3, c: 8 },
          { a: 1, b: 2, c: 6 },
        ];
        const expected =
          order === "asc" ? expectedValuesAsc : expectedValuesDesc;
        for (const value of values) {
          await ctx.db.insert("foo", value);
        }
        async function doPaginate(cursor: string | null) {
          return stream(ctx.db, schema)
            .query("foo")
            .withIndex("abc", (q) => q.eq("a", 1))
            .order(order)
            .distinct(["b"])
            .paginate({
              numItems: 2,
              cursor,
            });
        }
        const query = await doPaginate(null);
        expect(query.page.map(stripSystemFields)).toEqual(expected.slice(0, 2));
        expect(query.isDone).toBe(false);
        const page2 = await doPaginate(query.continueCursor!);
        expect(page2.page.map(stripSystemFields)).toEqual(expected.slice(2, 4));
        expect(page2.isDone).toBe(false);
        const page3 = await doPaginate(page2.continueCursor!);
        expect(page3.page.map(stripSystemFields)).toEqual(expected.slice(4, 6));
        expect(page3.isDone).toBe(true);
      });
    },
  );

  /*
  SELECT * FROM foo WHERE a = 1 AND b > 1 AND b < 5 AND c > 3
  */
  test("loose index scan", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 1, c: 4 }); // excluded by outer
      await ctx.db.insert("foo", { a: 1, b: 2, c: 1 }); // excluded by inner
      await ctx.db.insert("foo", { a: 1, b: 3, c: 1 }); // excluded by inner
      await ctx.db.insert("foo", { a: 1, b: 3, c: 5 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 6 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 5, c: 4 }); // excluded by outer
      await ctx.db.insert("foo", { a: 2, b: 5, c: 6 }); // excluded by outer
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1).gt("b", 1).lt("b", 5))
        .distinct(["b"])
        .flatMap(
          async (doc) =>
            stream(ctx.db, schema)
              .query("foo")
              .withIndex("abc", (q) => q.eq("a", 1).eq("b", doc.b).gt("c", 3)),
          ["a", "b", "c"],
        );
      const result = await query.collect();
      expect(result.map(stripSystemFields)).toEqual([
        { a: 1, b: 3, c: 5 },
        { a: 1, b: 3, c: 6 },
        { a: 1, b: 4, c: 4 },
      ]);
      const page1 = await query.paginate({
        numItems: 2,
        cursor: null,
        maximumRowsRead: 2,
      });
      // for b=2, the flatmap is empty, so it's as if b=2 were filtered out
      // by filterWith -- it counts towards the maximumRowsRead.
      expect(page1.page.map(stripSystemFields)).toEqual([{ a: 1, b: 3, c: 5 }]);
    });
  });
  test("undefined cursor serialization roundtrips", async () => {
    const schema = defineSchema({
      foo: defineTable({
        a: v.optional(v.number()),
        b: v.number(),
      }).index("ab", ["a", "b"]),
    });
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2 });
      await ctx.db.insert("foo", { a: undefined, b: 3 });
      await ctx.db.insert("foo", { a: 2, b: 4 });
      await ctx.db.insert("foo", { a: undefined, b: 5 });
      const query = stream(ctx.db, schema).query("foo").withIndex("ab");
      const result = await query.paginate({ numItems: 1, cursor: null });
      expect(result.continueCursor).toMatch('["undefined",');
      expect(result.page.map(stripSystemFields)).toEqual([
        { a: undefined, b: 3 },
      ]);
      expect(result.isDone).toBe(false);
      const page1 = await query.paginate({
        numItems: 2,
        cursor: result.continueCursor,
      });
      expect(page1.page.map(stripSystemFields)).toEqual([
        { b: 5 },
        { a: 1, b: 2 },
      ]);
      expect(page1.isDone).toBe(false);
      const page2 = await query.paginate({
        numItems: 2,
        cursor: page1.continueCursor,
      });
      expect(page2.page.map(stripSystemFields)).toEqual([{ a: 2, b: 4 }]);
      expect(page2.isDone).toBe(true);
    });
  });
  test("literal undefined string works", async () => {
    const schema = defineSchema({
      foo: defineTable({
        a: v.optional(v.string()),
        b: v.number(),
      }).index("ab", ["a", "b"]),
    });
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: undefined, b: 1 });
      await ctx.db.insert("foo", { a: "undefined", b: 2 });
      const query = stream(ctx.db, schema).query("foo").withIndex("ab");
      const result = await query.paginate({ numItems: 1, cursor: null });
      expect(result.continueCursor).toMatch('["undefined",');
      expect(result.page.map(stripSystemFields)).toEqual([
        { a: undefined, b: 1 },
      ]);
      expect(result.isDone).toBe(false);
      const page1 = await query.paginate({
        numItems: 1,
        cursor: result.continueCursor,
      });
      expect(page1.continueCursor).toMatch('["_undefined",');
      expect(page1.page.map(stripSystemFields)).toEqual([
        { a: "undefined", b: 2 },
      ]);
    });
  });
});

describe("bandwidth tracking", () => {
  // Helper: get total bandwidth from iterWithKeys(true) for N items
  async function collectBandwidth<T extends NonNullable<unknown>>(
    iterable: AsyncIterable<[T | null, IndexKey, number]>,
    maxItems?: number,
  ): Promise<{
    items: (T | null)[];
    totalBandwidth: number;
    bandwidths: number[];
  }> {
    const items: (T | null)[] = [];
    const bandwidths: number[] = [];
    let totalBandwidth = 0;
    let count = 0;
    for await (const [doc, _, bandwidth] of iterable) {
      items.push(doc);
      bandwidths.push(bandwidth);
      totalBandwidth += bandwidth;
      count++;
      if (maxItems !== undefined && count >= maxItems) break;
    }
    return { items, totalBandwidth, bandwidths };
  }

  test("iterWithKeys tracks bandwidth when enabled", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 4 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));

      // With tracking enabled, bandwidth should match getDocumentSize per doc
      const allDocs = await ctx.db.query("foo").collect();
      const expectedSizes = allDocs.map((doc) => getDocumentSize(doc));
      const expectedTotal = expectedSizes.reduce((a, b) => a + b, 0);

      const withTracking = await collectBandwidth(query.iterWithKeys(true));
      expect(withTracking.items.length).toBe(2);
      expect(withTracking.totalBandwidth).toBe(expectedTotal);
      expect(withTracking.bandwidths).toEqual(expectedSizes);

      // With tracking disabled, bandwidth should be 0
      const withoutTracking = await collectBandwidth(query.iterWithKeys(false));
      expect(withoutTracking.items.length).toBe(2);
      expect(withoutTracking.totalBandwidth).toBe(0);
      for (const bw of withoutTracking.bandwidths) {
        expect(bw).toBe(0);
      }
    });
  });

  test("basic stream paginate respects maximumBytesRead", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 1, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 0 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));

      // Get size of one document
      const firstDoc = await query.first();
      const oneDocSize = getDocumentSize(firstDoc!);

      // With limit of one doc's size, should return exactly 1 doc
      const page1 = await query.paginate({
        numItems: 10,
        cursor: null,
        maximumBytesRead: oneDocSize,
      });
      expect(page1.page.length).toBe(1);
      expect(page1.isDone).toBe(false);
      expect(page1.pageStatus).toBe("SplitRequired");

      // With limit of two docs' size, should return exactly 2 docs
      const page2 = await query.paginate({
        numItems: 10,
        cursor: null,
        maximumBytesRead: oneDocSize * 2,
      });
      expect(page2.page.length).toBe(2);
      expect(page2.isDone).toBe(false);

      // With very large limit, should return all docs
      const pageAll = await query.paginate({
        numItems: 10,
        cursor: null,
        maximumBytesRead: oneDocSize * 100,
      });
      expect(pageAll.page.length).toBe(3);
      expect(pageAll.isDone).toBe(true);
    });
  });

  test("filterWith tracks bandwidth for filtered-out docs", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 1, c: 0 }); // will be filtered out
      await ctx.db.insert("foo", { a: 1, b: 2, c: 0 }); // will be filtered out
      await ctx.db.insert("foo", { a: 1, b: 3, c: 1 }); // passes filter
      await ctx.db.insert("foo", { a: 1, b: 4, c: 1 }); // passes filter
      const baseQuery = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));
      const filtered = baseQuery.filterWith(async (doc) => doc.c === 1);

      // Verify bandwidth is tracked for ALL docs (including filtered ones)
      const allDocs = await ctx.db.query("foo").collect();
      const expectedSizes = allDocs.map((doc) => getDocumentSize(doc));

      const bw = await collectBandwidth(filtered.iterWithKeys(true));
      // Should have 4 iterations (2 nulls + 2 docs)
      expect(bw.items.length).toBe(4);
      // Each iteration's bandwidth should match the original doc's size
      expect(bw.bandwidths).toEqual(expectedSizes);

      const oneDocSize = expectedSizes[0]!;

      // With limit barely above 2 docs, should stop after 2 reads
      // (which means 0 results since first 2 are filtered)
      const page = await filtered.paginate({
        numItems: 10,
        cursor: null,
        maximumBytesRead: oneDocSize * 2,
      });
      // The first two docs are filtered out but still count towards bytes,
      // so we should have read 2 docs (both filtered) and stopped
      expect(page.page.length).toEqual(0);
      expect(page.isDone).toBe(false);
      expect(page.pageStatus).toBe("SplitRequired");
    });
  });

  test("mergedStream tracks bandwidth for pre-fetched docs", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 1, c: 0 });
      await ctx.db.insert("foo", { a: 2, b: 2, c: 0 });
      await ctx.db.insert("foo", { a: 3, b: 3, c: 0 });
      const query1 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));
      const query2 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 2));
      const query3 = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 3));
      const merged = mergedStream([query1, query2, query3], ["a", "b", "c"]);

      const allDocs = await ctx.db.query("foo").collect();
      const docSizes = allDocs.map((doc) => getDocumentSize(doc));
      const expectedTotal = docSizes.reduce((a, b) => a + b, 0);

      // First iteration reads from all 3 streams for comparison,
      // so bandwidth should reflect all 3 docs
      const bw = await collectBandwidth(merged.iterWithKeys(true), 1);
      expect(bw.items.length).toBe(1);
      // First yield includes bandwidth from all 3 pre-fetched docs
      expect(bw.bandwidths[0]).toBe(expectedTotal);

      // Collect all bandwidth - subsequent yields have 0 since docs were
      // already pre-fetched (and their "done" sentinels read next iteration)
      const bwAll = await collectBandwidth(merged.iterWithKeys(true));
      expect(bwAll.items.length).toBe(3);
      expect(bwAll.totalBandwidth).toBe(expectedTotal);
      // First yield gets all 3 pre-fetched bandwidths; subsequent yields
      // read 1 new doc + get "done" from exhausted streams
      expect(bwAll.bandwidths[0]).toBe(expectedTotal);

      // Paginate: with a low byte limit, the first iteration pre-fetches
      // all 3 docs so it should hit the limit immediately
      const oneDocSize = docSizes[0]!;
      const page = await merged.paginate({
        numItems: 10,
        cursor: null,
        maximumBytesRead: oneDocSize,
      });
      // Pre-fetched 3 docs but only yielded 1
      expect(page.page.length).toBe(1);
      expect(page.isDone).toBe(false);
      expect(page.pageStatus).toBe("SplitRequired");
    });
  });

  test("map stream tracks bandwidth of original docs", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 1, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 0 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));
      // Map to strings - these are NOT documents, but we should still
      // track bandwidth from the original docs that were read
      const mapped = query.map(async (doc) => `val: ${doc.b}`);

      const allDocs = await ctx.db.query("foo").collect();
      const expectedSizes = allDocs.map((doc) => getDocumentSize(doc));
      const expectedTotal = expectedSizes.reduce((a, b) => a + b, 0);

      const bw = await collectBandwidth(mapped.iterWithKeys(true));
      expect(bw.items).toEqual(["val: 1", "val: 2", "val: 3"]);
      // Bandwidth should reflect original document sizes, not mapped values
      expect(bw.totalBandwidth).toBe(expectedTotal);
      expect(bw.bandwidths).toEqual(expectedSizes);

      const oneDocSize = expectedSizes[0]!;
      const page = await mapped.paginate({
        numItems: 10,
        cursor: null,
        maximumBytesRead: oneDocSize,
      });
      expect(page.page.length).toBe(1);
      expect(page.isDone).toBe(false);
    });
  });

  test("flatMap tracks bandwidth for outer and inner docs", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 4 });
      // Join table
      await ctx.db.insert("bar", { c: 3, d: 1, e: 1 });
      await ctx.db.insert("bar", { c: 3, d: 2, e: 2 });
      await ctx.db.insert("bar", { c: 4, d: 1, e: 1 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));
      const flatMapped = query.flatMap(
        async (doc) =>
          stream(ctx.db, schema)
            .query("bar")
            .withIndex("cde", (q) => q.eq("c", doc.c)),
        ["c", "d", "e"],
      );

      const foos = await ctx.db.query("foo").collect();
      const bars = await ctx.db.query("bar").collect();
      const fooSizes = foos.map((doc) => getDocumentSize(doc));
      const barSizes = bars.map((doc) => getDocumentSize(doc));
      // bars are ordered by (c, d, e): c=3,d=1,e=1 | c=3,d=2,e=2 | c=4,d=1,e=1
      // foos are ordered by (a, b, c): a=1,b=2,c=3 | a=1,b=3,c=4

      const bw = await collectBandwidth(flatMapped.iterWithKeys(true));
      // Should yield 3 results: 2 bars for c=3, 1 bar for c=4
      expect(bw.items.length).toBe(3);
      // First yield: outer foo[0] + inner bar[0]
      expect(bw.bandwidths[0]).toBe(fooSizes[0]! + barSizes[0]!);
      // Second yield: only inner bar[1] (outer already charged)
      expect(bw.bandwidths[1]).toBe(barSizes[1]!);
      // Third yield: outer foo[1] + inner bar[2]
      expect(bw.bandwidths[2]).toBe(fooSizes[1]! + barSizes[2]!);
      const expectedTotal =
        fooSizes[0]! +
        fooSizes[1]! +
        barSizes[0]! +
        barSizes[1]! +
        barSizes[2]!;
      expect(bw.totalBandwidth).toBe(expectedTotal);

      const oneDocSize = fooSizes[0]!;
      const page = await flatMapped.paginate({
        numItems: 10,
        cursor: null,
        maximumBytesRead: oneDocSize,
      });
      // Should stop after reading first outer doc (and maybe first inner doc)
      expect(page.page.length).toBeLessThanOrEqual(2);
      expect(page.isDone).toBe(false);
    });
  });

  test("distinct stream tracks bandwidth", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 2, c: 3 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 5 }); // skipped by distinct
      await ctx.db.insert("foo", { a: 1, b: 3, c: 4 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 1 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));
      const distinct = query.distinct(["b"]);

      // Docs ordered by (a, b, c): b=2,c=3 | b=2,c=5 | b=3,c=4 | b=4,c=1
      // Distinct on b yields first of each: b=2 (c=3), b=3 (c=4), b=4 (c=1)
      const allDocs = await ctx.db.query("foo").collect();
      const docSizes = allDocs.map((doc) => getDocumentSize(doc));

      const bw = await collectBandwidth(distinct.iterWithKeys(true));
      // Should yield 3 results (distinct b values: 2, 3, 4)
      expect(bw.items.length).toBe(3);
      // Each distinct yield reads exactly one doc from the narrowed stream
      expect(bw.bandwidths[0]).toBe(docSizes[0]!); // b=2,c=3
      expect(bw.bandwidths[1]).toBe(docSizes[2]!); // b=3,c=4
      expect(bw.bandwidths[2]).toBe(docSizes[3]!); // b=4,c=1

      const oneDocSize = docSizes[0]!;
      const page = await distinct.paginate({
        numItems: 10,
        cursor: null,
        maximumBytesRead: oneDocSize,
      });
      expect(page.page.length).toBe(1);
      expect(page.isDone).toBe(false);
      expect(page.pageStatus).toBe("SplitRequired");
    });
  });

  test("streamIndexRange tracks bandwidth", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 4, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 5, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 6, c: 0 });
      const bounds = {
        lowerBound: [1, 4],
        lowerBoundInclusive: true,
        upperBound: [1, 6],
        upperBoundInclusive: true,
      };
      const rangeStream = streamIndexRange(
        ctx.db,
        schema,
        "foo",
        "abc",
        bounds,
        "asc",
      );

      const allDocs = await ctx.db.query("foo").collect();
      const expectedTotal = allDocs.reduce(
        (sum, doc) => sum + getDocumentSize(doc),
        0,
      );

      const bw = await collectBandwidth(rangeStream.iterWithKeys(true));
      expect(bw.items.length).toBe(3);
      expect(bw.totalBandwidth).toBe(expectedTotal);
    });
  });

  test("pagination continues correctly after maximumBytesRead", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("foo", { a: 1, b: 1, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 2, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 3, c: 0 });
      await ctx.db.insert("foo", { a: 1, b: 4, c: 0 });
      const query = stream(ctx.db, schema)
        .query("foo")
        .withIndex("abc", (q) => q.eq("a", 1));

      const firstDoc = await query.first();
      const oneDocSize = getDocumentSize(firstDoc!);

      // Page 1: read 1 doc, hit byte limit
      const page1 = await query.paginate({
        numItems: 10,
        cursor: null,
        maximumBytesRead: oneDocSize,
      });
      expect(page1.page.map(stripSystemFields)).toEqual([{ a: 1, b: 1, c: 0 }]);
      expect(page1.isDone).toBe(false);

      // Page 2: continue from cursor, read 1 doc, hit byte limit
      const page2 = await query.paginate({
        numItems: 10,
        cursor: page1.continueCursor,
        maximumBytesRead: oneDocSize,
      });
      expect(page2.page.map(stripSystemFields)).toEqual([{ a: 1, b: 2, c: 0 }]);
      expect(page2.isDone).toBe(false);

      // Page 3: continue, allow plenty of bytes to read remaining docs
      const page3 = await query.paginate({
        numItems: 10,
        cursor: page2.continueCursor,
        maximumBytesRead: oneDocSize * 100,
      });
      expect(page3.page.map(stripSystemFields)).toEqual([
        { a: 1, b: 3, c: 0 },
        { a: 1, b: 4, c: 0 },
      ]);
      expect(page3.isDone).toBe(true);
    });
  });
});
