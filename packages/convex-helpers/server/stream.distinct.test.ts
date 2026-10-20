import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { mergedStream, stream } from "./stream.js";
import { modules } from "./setup.test.js";

const schema = defineSchema({
  rows: defineTable({
    tenant: v.string(),
    group: v.number(),
    score: v.number(),
  }).index("tenant_group_score", ["tenant", "group", "score"]),
});
const fields = ["tenant", "group", "score"];

describe.each(["asc", "desc"] as const)(
  "distinct page boundaries (%s)",
  (order) => {
    const direction = order === "asc" ? 1 : -1;
    test.each(["filterWith", "map", "flatMap"] as const)(
      "%s retries an unfinished group after a nonempty page",
      async (kind) => {
        const t = convexTest(schema, modules);
        await t.run(async (ctx) => {
          await ctx.db.insert("rows", { tenant: "m", group: 0, score: 0 });
          await ctx.db.insert("rows", {
            tenant: "m",
            group: direction,
            score: -direction,
          });
          await ctx.db.insert("rows", {
            tenant: "m",
            group: direction,
            score: 0,
          });
          const db = stream(ctx.db, schema);
          const base = db
            .query("rows")
            .withIndex("tenant_group_score", (q) => q.eq("tenant", "m"))
            .order(order);
          const input =
            kind === "filterWith"
              ? base.filterWith(async (r) => r.score === 0)
              : kind === "map"
                ? base.map(async (r) => (r.score === 0 ? r : null))
                : base.flatMap(
                    async (r) =>
                      db
                        .query("rows")
                        .withIndex("tenant_group_score", (q) =>
                          q
                            .eq("tenant", "m")
                            .eq("group", r.group)
                            .eq("score", r.score === 0 ? 0 : 99),
                        )
                        .order(order),
                    fields.slice(),
                  );
          const distinct = input.distinct(["group"]);
          for (const query of [
            distinct,
            distinct.map(async (r) => ({ ...r })).filterWith(async () => true),
            distinct.distinct(["group"]),
          ]) {
            const entries = [];
            for await (const entry of query.iterWithKeys(true))
              entries.push(entry);
            const bytes = entries[0]![2] + entries[1]![2];
            for (const limit of [
              { maximumRowsRead: 2 },
              { maximumBytesRead: bytes },
            ]) {
              const first = await query.paginate({
                cursor: null,
                numItems: 10,
                ...limit,
              });
              expect(first.page.map((r) => r.group)).toEqual([0]);
              // Existing array cursors keep the actual last result's complete key.
              expect(JSON.parse(first.continueCursor)).toEqual(entries[0]![1]);
              expect(first.splitCursor).toBe(first.continueCursor);
              const second = await query.paginate({
                cursor: first.continueCursor,
                numItems: 10,
                ...limit,
              });
              expect(second.page.map((r) => r.group)).toEqual([direction]);
              const refreshed = await query.paginate({
                cursor: null,
                endCursor: first.continueCursor,
                numItems: 1,
              });
              expect(refreshed.page).toEqual(first.page);
              const tail = await query.paginate({
                cursor: first.splitCursor!,
                endCursor: first.continueCursor,
                numItems: 1,
              });
              expect(tail.page).toEqual([]);
            }
          }
        });
      },
    );

    test("empty pages skip their last examined group using a prefix cursor", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        // The page budget is shared: the last group gets only one of two reads.
        await ctx.db.insert("rows", {
          tenant: "m",
          group: 0,
          score: -direction,
        });
        const rejected = await ctx.db.insert("rows", {
          tenant: "m",
          group: direction,
          score: -direction,
        });
        await ctx.db.insert("rows", {
          tenant: "m",
          group: direction,
          score: 0,
        });
        await ctx.db.insert("rows", {
          tenant: "m",
          group: 2 * direction,
          score: 0,
        });
        const query = stream(ctx.db, schema)
          .query("rows")
          .withIndex("tenant_group_score", (q) => q.eq("tenant", "m"))
          .order(order)
          .filterWith(async (r) => r.score === 0)
          .distinct(["group"])
          .map(async (r) => ({ ...r }));
        const first = await query.paginate({
          cursor: null,
          numItems: 10,
          maximumRowsRead: 2,
        });
        expect(first.page).toEqual([]);
        expect(first.isDone).toBe(false);
        expect(JSON.parse(first.continueCursor)).toEqual(["m", direction]);
        expect(JSON.parse(first.splitCursor!)).toEqual(["m", 0]);
        const rejectedDoc = (await ctx.db.get("rows", rejected))!;
        const oldCursor = JSON.stringify([
          "m",
          direction,
          rejectedDoc.score,
          rejectedDoc._creationTime,
          rejectedDoc._id,
        ]);
        await ctx.db.delete("rows", rejected);
        for (const cursor of [first.continueCursor, oldCursor]) {
          const next = await query.paginate({ cursor, numItems: 10 });
          expect(next.page.map((r) => r.group)).toEqual([2 * direction]);
        }
        // With more budget, refreshing that original range may find its match.
        const refreshed = await query.paginate({
          cursor: null,
          endCursor: first.continueCursor,
          numItems: 1,
        });
        expect(refreshed.page.map((r) => r.group)).toEqual([direction]);
      });
    });

    test("splits use returned groups and preserve adjacent page ranges", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const group of [0, direction, 2 * direction]) {
          if (group === 2 * direction)
            await ctx.db.insert("rows", {
              tenant: "m",
              group,
              score: -direction,
            });
          await ctx.db.insert("rows", { tenant: "m", group, score: 0 });
        }
        const query = stream(ctx.db, schema)
          .query("rows")
          .withIndex("tenant_group_score", (q) => q.eq("tenant", "m"))
          .order(order)
          .filterWith(async (r) => r.score === 0)
          .distinct(["group"]);
        const first = await query.paginate({
          cursor: null,
          numItems: 10,
          maximumRowsRead: 3,
        });
        expect(first.page.map((r) => r.group)).toEqual([0, direction]);
        expect(JSON.parse(first.continueCursor)[1]).toBe(direction);
        expect(JSON.parse(first.splitCursor!)[1]).toBe(0);
        const before = await query.paginate({
          cursor: null,
          endCursor: first.splitCursor,
          numItems: 1,
        });
        const after = await query.paginate({
          cursor: first.splitCursor!,
          endCursor: first.continueCursor,
          numItems: 1,
        });
        expect([...before.page, ...after.page]).toEqual(first.page);
        const next = await query.paginate({
          cursor: first.continueCursor,
          numItems: 10,
          maximumRowsRead: 3,
        });
        expect(next.page.map((r) => r.group)).toEqual([2 * direction]);
        // A completed group's boundary remains valid after its representative goes away.
        await ctx.db.delete("rows", first.page[1]!._id);
        expect(
          (await query.paginate({ cursor: first.continueCursor, numItems: 10 }))
            .page,
        ).toEqual(next.page);
      });
    });

    test.each([
      // Which scan positions (0-based, in scan order) pass the filter.
      { matches: [0] },
      { matches: [3] },
      { matches: [1, 3] },
      { matches: [1, 2, 4] },
    ])(
      "ordinary filtered pages never expose filtered-out rows: %j",
      async ({ matches }) => {
        const t = convexTest(schema, modules);
        await t.run(async (ctx) => {
          // Scores 0..5 in scan order, then a trailing match beyond the budget.
          // Avoid -0, which serializes differently in cursors.
          for (let i = 0; i < 7; i++)
            await ctx.db.insert("rows", {
              tenant: "m",
              group: 0,
              score: i === 0 ? 0 : direction * i,
            });
          const position = (score: number) => Math.abs(score);
          const query = stream(ctx.db, schema)
            .query("rows")
            .withIndex("tenant_group_score", (q) => q.eq("tenant", "m"))
            .order(order)
            .filterWith(
              async (r) =>
                matches.includes(position(r.score)) || position(r.score) === 6,
            );
          const first = await query.paginate({
            cursor: null,
            numItems: 10,
            maximumRowsRead: 5,
          });
          expect(first.page.map((r) => position(r.score))).toEqual(matches);
          expect(first.pageStatus).toBe("SplitRequired");
          const returned = first.page.map((r) => r.score);
          // Both cursors name returned documents, never filtered-out ones.
          expect(returned).toContain(JSON.parse(first.continueCursor)[2]);
          expect(returned).toContain(JSON.parse(first.splitCursor!)[2]);
          expect(JSON.parse(first.continueCursor)[2]).toBe(returned.at(-1));
          // The page range reproduces the page, and splitting it is lossless.
          expect(
            (
              await query.paginate({
                cursor: null,
                endCursor: first.continueCursor,
                numItems: 1,
              })
            ).page,
          ).toEqual(first.page);
          const before = await query.paginate({
            cursor: null,
            endCursor: first.splitCursor,
            numItems: 1,
          });
          const after = await query.paginate({
            cursor: first.splitCursor!,
            endCursor: first.continueCursor,
            numItems: 1,
          });
          expect([...before.page, ...after.page]).toEqual(first.page);
          // Rows scanned after the last result are re-scanned by the next page.
          const next = await query.paginate({
            cursor: first.continueCursor,
            numItems: 10,
            maximumRowsRead: 5,
          });
          expect(next.continueCursor).not.toBe(first.continueCursor);
          expect(next.page.map((r) => position(r.score))).toEqual(
            matches.at(-1)! + 5 >= 6 ? [6] : [],
          );
        });
      },
    );

    test("filtering after distinct still examines only the representative", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("rows", {
          tenant: "m",
          group: 0,
          score: -direction,
        });
        await ctx.db.insert("rows", { tenant: "m", group: 0, score: 0 });
        await ctx.db.insert("rows", {
          tenant: "m",
          group: direction,
          score: 0,
        });
        const query = stream(ctx.db, schema)
          .query("rows")
          .withIndex("tenant_group_score", (q) => q.eq("tenant", "m"))
          .order(order)
          .distinct(["group"])
          .filterWith(async (r) => r.score === 0);
        const first = await query.paginate({
          cursor: null,
          numItems: 10,
          maximumRowsRead: 1,
        });
        expect(first.page).toEqual([]);
        expect(JSON.parse(first.continueCursor)).toEqual(["m", 0]);
        const next = await query.paginate({
          cursor: first.continueCursor,
          numItems: 10,
        });
        expect(next.page.map((r) => r.group)).toEqual([direction]);
        expect(next.page).toEqual(await query.collect());
      });
    });

    test("bounded refreshes keep their existing read checkpoint", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const first = await ctx.db.insert("rows", {
          tenant: "m",
          group: 0,
          score: 0,
        });
        const last = await ctx.db.insert("rows", {
          tenant: "m",
          group: direction,
          score: -direction,
        });
        const base = stream(ctx.db, schema)
          .query("rows")
          .withIndex("tenant_group_score", (q) => q.eq("tenant", "m"))
          .order(order);
        const lastDoc = (await ctx.db.get("rows", last))!;
        const endCursor = JSON.stringify([
          "m",
          direction,
          -direction,
          lastDoc._creationTime,
          last,
        ]);
        const filtered = base.filterWith(async (r) => r.score === 0);
        for (const query of [filtered, filtered.distinct(["group"])]) {
          const refreshed = await query.paginate({
            cursor: null,
            endCursor,
            numItems: 1,
            maximumRowsRead: 2,
          });
          expect(refreshed.page.map((r) => r._id)).toEqual([first]);
          expect(refreshed.continueCursor).toBe(endCursor);
        }
      });
    });

    test("empty flatMap pages retain their inner position", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const score of [-direction, 0])
          await ctx.db.insert("rows", { tenant: "m", group: 0, score });
        const db = stream(ctx.db, schema);
        const base = db
          .query("rows")
          .withIndex("tenant_group_score", (q) => q.eq("tenant", "m"))
          .order(order);
        const query = base
          .distinct(["group"])
          .flatMap(
            async () => base.filterWith(async (r) => r.score === 0),
            fields.slice(),
          );
        const first = await query.paginate({
          cursor: null,
          numItems: 1,
          maximumRowsRead: 1,
        });
        expect(first.page).toEqual([]);
        expect(JSON.parse(first.continueCursor)).toHaveLength(10);
        const next = await query.paginate({
          cursor: first.continueCursor,
          numItems: 1,
          maximumRowsRead: 1,
        });
        expect(next.page.map((r) => r.score)).toEqual([0]);
      });
    });

    test("empty merged pages retain positions needed by other inputs", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("rows", {
          tenant: "a",
          group: 0,
          score: -direction,
        });
        await ctx.db.insert("rows", { tenant: "b", group: 0, score: 0 });
        const db = stream(ctx.db, schema);
        const firstInput = db
          .query("rows")
          .withIndex("tenant_group_score", (q) => q.eq("tenant", "a"))
          .order(order)
          .filterWith(async () => false)
          .distinct(["group"]);
        const secondInput = db
          .query("rows")
          .withIndex("tenant_group_score", (q) => q.eq("tenant", "b"))
          .order(order);
        const query = mergedStream(
          [firstInput, secondInput],
          ["group", "score"],
        );
        const first = await query.paginate({
          cursor: null,
          numItems: 1,
          maximumRowsRead: 1,
        });
        expect(first.page).toEqual([]);
        expect(JSON.parse(first.continueCursor)).toHaveLength(4);
        const next = await query.paginate({
          cursor: first.continueCursor,
          numItems: 1,
          maximumRowsRead: 1,
        });
        expect(next.page.map((r) => r.tenant)).toEqual(["b"]);
      });
    });
  },
);
