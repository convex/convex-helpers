import { convexTest } from "convex-test";
import {
  defineSchema,
  defineTable,
  type DataModelFromSchemaDefinition,
  type DocumentByName,
  type GenericDatabaseWriter,
} from "convex/server";
import { v, type GenericId } from "convex/values";
import { describe, expect, test, vi } from "vitest";
import {
  RowLevelSecurity,
  type RLSConfig,
  type Rules,
  wrapDatabaseReader,
  wrapDatabaseWriter,
} from "./rowLevelSecurity.js";
import { modules } from "./setup.test.js";

const schema = defineSchema({
  records: defineTable({
    owner: v.string(),
    content: v.string(),
    extra: v.optional(v.string()),
  }).index("by_owner", ["owner"]),
  unrelated: defineTable({ content: v.string() }),
});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type RuleContext = { actor: string | null };
type PolicyRules = Rules<RuleContext, DataModel>;
type RecordDoc = DocumentByName<DataModel, "records">;
type Writer = GenericDatabaseWriter<DataModel>;

const policies: { name: string; config?: RLSConfig; allows: boolean }[] = [
  { name: "omitted config", allows: true },
  { name: "empty config", config: {}, allows: true },
  { name: "default allow", config: { defaultPolicy: "allow" }, allows: true },
  { name: "default deny", config: { defaultPolicy: "deny" }, allows: false },
];
const decisions = ["missing", "allow", "deny"] as const;
const rule = (decision: (typeof decisions)[number]) =>
  decision === "missing" ? undefined : async () => decision === "allow";
const readers = [
  { name: "reader", wrap: wrapDatabaseReader<RuleContext, DataModel> },
  { name: "writer", wrap: wrapDatabaseWriter<RuleContext, DataModel> },
];
const idStyles = ["implicit", "explicit"] as const;
const actor = { actor: "owner" };

async function seed() {
  const t = convexTest(schema, modules);
  const doc = await t.run(async (ctx) => {
    const id = await ctx.db.insert("records", {
      owner: "owner",
      content: "original",
      extra: "preserved by patch, removed by replace",
    });
    await ctx.db.insert("unrelated", { content: "unrelated secret" });
    return (await ctx.db.get("records", id))!;
  });
  return { t, doc };
}

const readCases: {
  name: string;
  rules: PolicyRules;
  allows?: boolean;
}[] = [
  { name: "no tables in rules", rules: {} },
  {
    name: "only an unrelated table in rules",
    rules: { unrelated: { read: async () => true } },
  },
  { name: "empty table rules", rules: { records: {} } },
  {
    name: "insert rule without a read rule",
    rules: { records: { insert: async () => true } },
  },
  {
    name: "modify rule without a read rule",
    rules: { records: { modify: async () => true } },
  },
  {
    name: "allow read rule",
    rules: { records: { read: async () => true } },
    allows: true,
  },
  {
    name: "deny read rule",
    rules: { records: { read: async () => false } },
    allows: false,
  },
];

describe.each(readers)("RLS $name read policies", ({ wrap }) => {
  describe.each(policies)("$name", ({ config, allows: defaultAllows }) => {
    test.each(readCases)("$name", async ({ rules, allows }) => {
      const { t, doc } = await seed();
      const expected = (allows ?? defaultAllows) ? doc : null;
      await t.run(async (ctx) => {
        const db = wrap(actor, ctx.db, rules, config);
        // An ID whose table is absent from the rules must still use the policy.
        // eslint-disable-next-line @convex-dev/explicit-table-ids -- testing the implicit API
        expect(await db.get(doc._id)).toEqual(expected);
        expect(await db.get("records", doc._id)).toEqual(expected);
        expect(await db.query("records").collect()).toEqual(
          expected ? [expected] : [],
        );
      });
    });

    test.each(idStyles)(
      "%s get of a deleted ID returns null",
      async (style) => {
        const { t, doc } = await seed();
        await t.run(async (ctx) => {
          await ctx.db.delete("records", doc._id);
          const read = vi.fn(async () => true);
          const db = wrap(actor, ctx.db, { records: { read } }, config);
          const result =
            style === "explicit"
              ? await db.get("records", doc._id)
              : // eslint-disable-next-line @convex-dev/explicit-table-ids -- testing the implicit API
                await db.get(doc._id);
          expect(result).toBeNull();
          expect(read).not.toHaveBeenCalled();
        });
      },
    );
  });
});

const modifications = ["patch", "replace", "delete"] as const;
function modify(
  db: Writer,
  style: (typeof idStyles)[number],
  operation: (typeof modifications)[number],
  id: GenericId<"records">,
) {
  const value = { owner: "new owner", content: "changed" };
  if (style === "explicit") {
    switch (operation) {
      case "patch":
        return db.patch("records", id, value);
      case "replace":
        return db.replace("records", id, value);
      case "delete":
        return db.delete("records", id);
    }
  }
  switch (operation) {
    case "patch":
      return db.patch(id, value);
    case "replace":
      return db.replace(id, value);
    case "delete":
      return db.delete(id);
  }
}

const modificationCases = [
  ...readCases.slice(0, 2).map(({ name, rules }) => ({
    name,
    rules,
    read: "missing" as const,
    modify: "missing" as const,
  })),
  ...decisions.flatMap((read) =>
    decisions.map((modify) => ({
      name: `read ${read}, modify ${modify}`,
      rules: {
        records: { read: rule(read), modify: rule(modify) },
      } satisfies PolicyRules,
      read,
      modify,
    })),
  ),
];

describe.each(policies)("RLS writes with $name", ({ config, allows }) => {
  describe.each(idStyles)("%s IDs", (style) => {
    describe.each(modifications)("%s", (operation) => {
      test.each(modificationCases)("$name", async (scenario) => {
        const { t, doc } = await seed();
        const canRead =
          scenario.read === "missing" ? allows : scenario.read === "allow";
        const canModify =
          scenario.modify === "missing" ? allows : scenario.modify === "allow";
        await t.run(async (ctx) => {
          const db = wrapDatabaseWriter(actor, ctx.db, scenario.rules, config);
          if (!canRead || !canModify) {
            // Catch inside the transaction so rollback cannot mask a write
            // performed before an authorization error.
            await expect(modify(db, style, operation, doc._id)).rejects.toThrow(
              !canRead
                ? "no read access or doc does not exist"
                : "write access not allowed",
            );
            expect(await ctx.db.get("records", doc._id)).toEqual(doc);
          } else {
            await modify(db, style, operation, doc._id);
            const updated = await ctx.db.get("records", doc._id);
            expect(updated).toEqual(
              operation === "delete"
                ? null
                : {
                    _id: doc._id,
                    _creationTime: doc._creationTime,
                    owner: "new owner",
                    content: "changed",
                    ...(operation === "patch" ? { extra: doc.extra } : {}),
                  },
            );
          }
        });
      });
    });
  });

  test.each(decisions)(
    "insert rule %s is independent of read/modify rules",
    async (decision) => {
      const { t } = await seed();
      await t.run(async (ctx) => {
        const db = wrapDatabaseWriter(
          actor,
          ctx.db,
          {
            records: {
              read: async () => false,
              modify: async () => false,
              insert: rule(decision),
            },
          },
          config,
        );
        const value = { owner: "owner", content: "inserted" };
        const before = await ctx.db.query("records").collect();
        if (decision === "allow" || (decision === "missing" && allows)) {
          const id = await db.insert("records", value);
          expect(await ctx.db.get("records", id)).toMatchObject(value);
          expect(await db.get("records", id)).toBeNull();
        } else {
          await expect(db.insert("records", value)).rejects.toThrow(
            "insert access not allowed",
          );
          expect(await ctx.db.query("records").collect()).toEqual(before);
        }
      });
    },
  );
});

describe("RLS rule evaluation", () => {
  test.each(idStyles)(
    "%s modifications require read access before evaluating modify",
    async (style) => {
      const { t, doc } = await seed();
      await t.run(async (ctx) => {
        const read = vi.fn(async () => false);
        const modifyRule = vi.fn(async () => true);
        const db = wrapDatabaseWriter(actor, ctx.db, {
          records: { read, modify: modifyRule },
        });
        for (const operation of modifications) {
          await expect(modify(db, style, operation, doc._id)).rejects.toThrow(
            "no read access or doc does not exist",
          );
        }
        expect(read).toHaveBeenCalledTimes(3);
        expect(modifyRule).not.toHaveBeenCalled();
        expect(await ctx.db.get("records", doc._id)).toEqual(doc);
      });
    },
  );

  test.each(idStyles)(
    "%s modify rules receive the original document and context",
    async (style) => {
      for (const operation of modifications) {
        const { t, doc } = await seed();
        await t.run(async (ctx) => {
          const read = vi.fn(async () => true);
          const modifyRule = vi.fn(async () => true);
          const db = wrapDatabaseWriter(
            actor,
            ctx.db,
            { records: { read, modify: modifyRule } },
            { defaultPolicy: "deny" },
          );
          await modify(db, style, operation, doc._id);
          expect(read).toHaveBeenCalledExactlyOnceWith(actor, doc);
          expect(modifyRule).toHaveBeenCalledExactlyOnceWith(actor, doc);
        });
      }
    },
  );

  test("insert rules receive context and a document without system fields", async () => {
    const { t } = await seed();
    await t.run(async (ctx) => {
      const insert = vi.fn(async () => true);
      const db = wrapDatabaseWriter(
        actor,
        ctx.db,
        { records: { insert } },
        { defaultPolicy: "deny" },
      );
      const value = { owner: "owner", content: "new" };
      const id = await db.insert("records", value);
      expect(insert).toHaveBeenCalledExactlyOnceWith(actor, value);
      expect(await ctx.db.get("records", id)).toMatchObject(value);
    });
  });

  test.each(idStyles)(
    "%s writes to deleted IDs fail before modify rules",
    async (style) => {
      const { t, doc } = await seed();
      await t.run(async (ctx) => {
        await ctx.db.delete("records", doc._id);
        const modifyRule = vi.fn(async () => true);
        const db = wrapDatabaseWriter(actor, ctx.db, {
          records: { read: async () => true, modify: modifyRule },
        });
        for (const operation of modifications) {
          await expect(modify(db, style, operation, doc._id)).rejects.toThrow(
            "no read access or doc does not exist",
          );
        }
        expect(modifyRule).not.toHaveBeenCalled();
      });
    },
  );

  test.each(["read", "modify", "insert"] as const)(
    "a throwing %s rule fails closed",
    async (operation) => {
      const { t, doc } = await seed();
      await t.run(async (ctx) => {
        const fail = async () => {
          throw new Error("rule failed");
        };
        const db = wrapDatabaseWriter(actor, ctx.db, {
          records: {
            read: async () => true,
            modify: async () => true,
            [operation]: fail,
          },
        });
        const before = await ctx.db.query("records").collect();
        const result =
          operation === "read"
            ? db.get("records", doc._id)
            : operation === "modify"
              ? db.patch("records", doc._id, { content: "blocked" })
              : db.insert("records", { owner: "owner", content: "blocked" });
        await expect(result).rejects.toThrow("rule failed");
        expect(await ctx.db.query("records").collect()).toEqual(before);
      });
    },
  );
});

// Exercise ownership with identities supplied by convex-test, deriving the
// rule context from auth rather than accepting an actor from function arguments.
describe.each(readers)("RLS $name query surfaces", ({ wrap }) => {
  test.each(["owner", "other", null])(
    "isolates records for identity %s",
    async (identity) => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        for (const [owner, content] of [
          ["other", "hidden first"],
          ["owner", "visible first"],
          ["other", "hidden middle"],
          ["owner", "visible last"],
          ["other", "hidden last"],
        ]) {
          await ctx.db.insert("records", { owner, content });
        }
      });
      const asUser = identity
        ? t.withIdentity({ tokenIdentifier: identity })
        : t;
      const expected = await asUser.run(async (ctx) => {
        const actor =
          (await ctx.auth.getUserIdentity())?.tokenIdentifier ?? null;
        const db = wrap(
          { actor },
          ctx.db,
          { records: { read: async ({ actor }, doc) => actor === doc.owner } },
          { defaultPolicy: "deny" },
        );
        const all = await ctx.db.query("records").collect();
        const expected = all.filter((doc) => doc.owner === actor);
        expect(await db.query("records").collect()).toEqual(expected);
        expect(await db.query("records").fullTableScan().collect()).toEqual(
          expected,
        );
        expect(await db.query("records").order("desc").collect()).toEqual(
          [...expected].reverse(),
        );
        expect(await db.query("records").take(2)).toEqual(expected.slice(0, 2));
        expect(await db.query("records").first()).toEqual(expected[0] ?? null);
        const iterated: RecordDoc[] = [];
        for await (const doc of db.query("records")) iterated.push(doc);
        expect(iterated).toEqual(expected);
        expect(
          await db
            .query("records")
            .withIndex("by_owner", (q) => q.eq("owner", "owner"))
            .collect(),
        ).toEqual(expected.filter((doc) => doc.owner === "owner"));
        const unique = db
          .query("records")
          // eslint-disable-next-line @convex-dev/no-filter-in-query -- testing query composition
          .filter((q) => q.eq(q.field("content"), "visible first"));
        expect(await unique.unique()).toEqual(
          expected.find((doc) => doc.content === "visible first") ?? null,
        );
        if (expected.length > 1) {
          await expect(db.query("records").unique()).rejects.toThrow(
            "more than one result",
          );
        } else {
          expect(await db.query("records").unique()).toBeNull();
        }
        for (const doc of all) {
          const visible = doc.owner === actor ? doc : null;
          expect(await db.get("records", doc._id)).toEqual(visible);
          // eslint-disable-next-line @convex-dev/explicit-table-ids -- testing the implicit API
          expect(await db.get(doc._id)).toEqual(visible);
        }
        expect(await db.query("unrelated").collect()).toEqual([]);
        return expected;
      });
      const paginated: RecordDoc[] = [];
      let cursor: string | null = null;
      let done = false;
      // Each page must be fetched in a separate function execution, including
      // empty pages where all scanned documents were hidden by RLS.
      for (let pageNumber = 0; pageNumber < 10 && !done; pageNumber++) {
        const page = await asUser.run(async (ctx) => {
          const actor =
            (await ctx.auth.getUserIdentity())?.tokenIdentifier ?? null;
          const db = wrap(
            { actor },
            ctx.db,
            {
              records: { read: async ({ actor }, doc) => actor === doc.owner },
            },
            { defaultPolicy: "deny" },
          );
          return db.query("records").paginate({ cursor, numItems: 1 });
        });
        expect(page.page.every((doc) => doc.owner === identity)).toBe(true);
        paginated.push(...page.page);
        done = page.isDone;
        cursor = page.continueCursor;
      }
      expect(done).toBe(true);
      expect(paginated).toEqual(expected);
    },
  );
});

describe.each(idStyles)("RLS ownership writes with %s IDs", (style) => {
  describe.each(modifications)("%s", (operation) => {
    test.each(["owner", "other", null])(
      "authorizes identity %s",
      async (identity) => {
        const { t, doc } = await seed();
        const asUser = identity
          ? t.withIdentity({ tokenIdentifier: identity })
          : t;
        await asUser.run(async (ctx) => {
          const actor =
            (await ctx.auth.getUserIdentity())?.tokenIdentifier ?? null;
          const ownsRecord = async ({ actor }: RuleContext, doc: RecordDoc) =>
            actor === doc.owner;
          const db = wrapDatabaseWriter(
            { actor },
            ctx.db,
            { records: { read: ownsRecord, modify: ownsRecord } },
            { defaultPolicy: "deny" },
          );
          if (identity === "owner") {
            await modify(db, style, operation, doc._id);
            const updated = await ctx.db.get("records", doc._id);
            if (operation === "delete") {
              expect(updated).toBeNull();
            } else {
              expect(updated).toMatchObject({
                owner: "new owner",
                content: "changed",
              });
              // A successful ownership transfer must take effect immediately.
              expect(await db.get("records", doc._id)).toBeNull();
              await expect(
                modify(db, style, operation, doc._id),
              ).rejects.toThrow("no read access or doc does not exist");
              expect(await ctx.db.get("records", doc._id)).toEqual(updated);
            }
          } else {
            await expect(modify(db, style, operation, doc._id)).rejects.toThrow(
              "no read access or doc does not exist",
            );
            expect(await ctx.db.get("records", doc._id)).toEqual(doc);
          }
        });
      },
    );
  });
});

test("legacy RLS middleware forwards default deny to readers and writers", async () => {
  const { t, doc } = await seed();
  const { withQueryRLS, withMutationRLS } = RowLevelSecurity<
    RuleContext,
    DataModel
  >({}, { defaultPolicy: "deny" });
  await t.run(async (ctx) => {
    const wrappedCtx = { ...ctx, ...actor };
    const read = withQueryRLS(async ({ db }: typeof wrappedCtx) => {
      // eslint-disable-next-line @convex-dev/explicit-table-ids -- testing the implicit API
      return db.get(doc._id);
    });
    expect(await read(wrappedCtx)).toBeNull();
    const write = withMutationRLS(async ({ db }: typeof wrappedCtx) => {
      // eslint-disable-next-line @convex-dev/explicit-table-ids -- testing the implicit API
      await db.delete(doc._id);
    });
    await expect(write(wrappedCtx)).rejects.toThrow(
      "no read access or doc does not exist",
    );
    expect(await ctx.db.get("records", doc._id)).toEqual(doc);
  });
});
