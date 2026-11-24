import { convexTest } from "convex-test";
import { v } from "convex/values";
import { describe, expect, test } from "vitest";
import { wrapDatabaseReader, wrapDatabaseWriter } from "./rowLevelSecurity.js";
import type {
  Auth,
  DataModelFromSchemaDefinition,
  GenericDatabaseWriter,
  MutationBuilder,
} from "convex/server";
import {
  defineSchema,
  defineTable,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { modules } from "./setup.test.js";
import { customCtx, customMutation } from "./customFunctions.js";
import { crud } from "./crud.js";

const schema = defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
  }),
  notes: defineTable({
    note: v.string(),
    userId: v.id("users"),
  }),
  publicData: defineTable({
    content: v.string(),
  }),
  privateData: defineTable({
    content: v.string(),
    ownerId: v.id("users"),
  }),
});

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

const withRLS = async (ctx: { db: DatabaseWriter; auth: Auth }) => {
  const tokenIdentifier = (await ctx.auth.getUserIdentity())?.tokenIdentifier;
  if (!tokenIdentifier) throw new Error("Unauthenticated");
  return {
    db: wrapDatabaseWriter({ tokenIdentifier }, ctx.db, {
      notes: {
        read: async ({ tokenIdentifier }, doc) => {
          const author = await ctx.db.get("users", doc.userId);
          return tokenIdentifier === author?.tokenIdentifier;
        },
      },
    }),
  };
};

describe("row level security", () => {
  test("can only read own notes", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const aId = await ctx.db.insert("users", { tokenIdentifier: "Person A" });
      const bId = await ctx.db.insert("users", { tokenIdentifier: "Person B" });
      await ctx.db.insert("notes", {
        note: "Hello from Person A",
        userId: aId,
      });
      await ctx.db.insert("notes", {
        note: "Hello from Person B",
        userId: bId,
      });
    });
    const asA = t.withIdentity({ tokenIdentifier: "Person A" });
    const asB = t.withIdentity({ tokenIdentifier: "Person B" });
    const notesA = await asA.run(async (ctx) => {
      const rls = await withRLS(ctx);
      return await rls.db.query("notes").collect();
    });
    expect(notesA).toMatchObject([{ note: "Hello from Person A" }]);

    const notesB = await asB.run(async (ctx) => {
      const rls = await withRLS(ctx);
      return await rls.db.query("notes").collect();
    });
    expect(notesB).toMatchObject([{ note: "Hello from Person B" }]);
  });

  describe("cannot delete someone else's note", () => {
    test("implicit table names", async () => {
      const t = convexTest(schema, modules);
      const noteId = await t.run(async (ctx) => {
        const aId = await ctx.db.insert("users", {
          tokenIdentifier: "Person A",
        });
        await ctx.db.insert("users", { tokenIdentifier: "Person B" });
        return ctx.db.insert("notes", {
          note: "Hello from Person A",
          userId: aId,
        });
      });
      const asA = t.withIdentity({ tokenIdentifier: "Person A" });
      const asB = t.withIdentity({ tokenIdentifier: "Person B" });
      await expect(() =>
        asB.run(async (ctx) => {
          const rls = await withRLS(ctx);
          // eslint-disable-next-line @convex-dev/explicit-table-ids -- testing the implicit API
          return rls.db.delete(noteId);
        }),
      ).rejects.toThrow(/no read access/);
      await asA.run(async (ctx) => {
        const rls = await withRLS(ctx);
        // eslint-disable-next-line @convex-dev/explicit-table-ids -- testing the implicit API
        return rls.db.delete(noteId);
      });
    });

    test("explicit table names", async () => {
      const t = convexTest(schema, modules);
      const noteId = await t.run(async (ctx) => {
        const aId = await ctx.db.insert("users", {
          tokenIdentifier: "Person A",
        });
        await ctx.db.insert("users", { tokenIdentifier: "Person B" });
        return ctx.db.insert("notes", {
          note: "Hello from Person A",
          userId: aId,
        });
      });
      const asA = t.withIdentity({ tokenIdentifier: "Person A" });
      const asB = t.withIdentity({ tokenIdentifier: "Person B" });
      await expect(() =>
        asB.run(async (ctx) => {
          const rls = await withRLS(ctx);
          return rls.db.delete("notes", noteId);
        }),
      ).rejects.toThrow(/no read access/);
      await asA.run(async (ctx) => {
        const rls = await withRLS(ctx);
        return rls.db.delete("notes", noteId);
      });
    });
  });

  test("default allow policy permits access to tables without rules", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "Person A",
      });
      await ctx.db.insert("publicData", { content: "Public content" });
      await ctx.db.insert("privateData", {
        content: "Private content",
        ownerId: userId,
      });
    });

    const asA = t.withIdentity({ tokenIdentifier: "Person A" });
    const result = await asA.run(async (ctx) => {
      const tokenIdentifier = (await ctx.auth.getUserIdentity())
        ?.tokenIdentifier;
      if (!tokenIdentifier) throw new Error("Unauthenticated");

      // Default allow - no config specified
      const db = wrapDatabaseReader({ tokenIdentifier }, ctx.db, {
        notes: {
          read: async ({ tokenIdentifier }, doc) => {
            const author = await ctx.db.get("users", doc.userId);
            return tokenIdentifier === author?.tokenIdentifier;
          },
        },
      });

      // Should be able to read publicData (no rules defined)
      const publicData = await db.query("publicData").collect();
      // Should be able to read privateData (no rules defined)
      const privateData = await db.query("privateData").collect();

      return { publicData, privateData };
    });

    expect(result.publicData).toHaveLength(1);
    expect(result.privateData).toHaveLength(1);
  });

  test("default deny policy blocks access to tables without rules", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "Person A",
      });
      await ctx.db.insert("publicData", { content: "Public content" });
      await ctx.db.insert("privateData", {
        content: "Private content",
        ownerId: userId,
      });
    });

    const asA = t.withIdentity({ tokenIdentifier: "Person A" });
    const result = await asA.run(async (ctx) => {
      const tokenIdentifier = (await ctx.auth.getUserIdentity())
        ?.tokenIdentifier;
      if (!tokenIdentifier) throw new Error("Unauthenticated");

      // Default deny policy
      const db = wrapDatabaseReader(
        { tokenIdentifier },
        ctx.db,
        {
          notes: {
            read: async ({ tokenIdentifier }, doc) => {
              const author = await ctx.db.get("users", doc.userId);
              return tokenIdentifier === author?.tokenIdentifier;
            },
          },
          // Explicitly allow publicData
          publicData: {
            read: async () => true,
          },
        },
        { defaultPolicy: "deny" },
      );

      // Should be able to read publicData (has explicit allow rule)
      const publicData = await db.query("publicData").collect();
      // Should NOT be able to read privateData (no rules, default deny)
      const privateData = await db.query("privateData").collect();

      return { publicData, privateData };
    });

    expect(result.publicData).toHaveLength(1);
    expect(result.privateData).toHaveLength(0);
  });

  test("default deny policy blocks inserts to tables without rules", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "Person A" });
    });

    const asA = t.withIdentity({ tokenIdentifier: "Person A" });

    // Test with default allow
    await asA.run(async (ctx) => {
      const tokenIdentifier = (await ctx.auth.getUserIdentity())
        ?.tokenIdentifier;
      if (!tokenIdentifier) throw new Error("Unauthenticated");

      const db = wrapDatabaseWriter(
        { tokenIdentifier },
        ctx.db,
        {},
        { defaultPolicy: "allow" },
      );

      // Should be able to insert (no rules, default allow)
      await db.insert("publicData", { content: "Allowed content" });
    });

    // Test with default deny
    await expect(() =>
      asA.run(async (ctx) => {
        const tokenIdentifier = (await ctx.auth.getUserIdentity())
          ?.tokenIdentifier;
        if (!tokenIdentifier) throw new Error("Unauthenticated");

        const db = wrapDatabaseWriter(
          { tokenIdentifier },
          ctx.db,
          {},
          { defaultPolicy: "deny" },
        );

        // Should NOT be able to insert (no rules, default deny)
        await db.insert("publicData", { content: "Blocked content" });
      }),
    ).rejects.toThrow(/insert access not allowed/);
  });

  describe("default deny policy blocks modifications to tables without rules", () => {
    test("implicit table names", async () => {
      const t = convexTest(schema, modules);
      const docId = await t.run(async (ctx) => {
        await ctx.db.insert("users", { tokenIdentifier: "Person A" });
        return ctx.db.insert("publicData", { content: "Initial content" });
      });

      const asA = t.withIdentity({ tokenIdentifier: "Person A" });

      // Test with default allow
      await asA.run(async (ctx) => {
        const tokenIdentifier = (await ctx.auth.getUserIdentity())
          ?.tokenIdentifier;
        if (!tokenIdentifier) throw new Error("Unauthenticated");

        const db = wrapDatabaseWriter(
          { tokenIdentifier },
          ctx.db,
          {
            publicData: {
              read: async () => true, // Allow reads
            },
          },
          { defaultPolicy: "allow" },
        );

        // Should be able to modify (no modify rule, default allow)
        // eslint-disable-next-line @convex-dev/explicit-table-ids -- testing the implicit API
        await db.patch(docId, { content: "Modified content" });
      });

      // Test with default deny
      await expect(() =>
        asA.run(async (ctx) => {
          const tokenIdentifier = (await ctx.auth.getUserIdentity())
            ?.tokenIdentifier;
          if (!tokenIdentifier) throw new Error("Unauthenticated");

          const db = wrapDatabaseWriter(
            { tokenIdentifier },
            ctx.db,
            {
              publicData: {
                read: async () => true, // Allow reads but no modify rule
              },
            },
            { defaultPolicy: "deny" },
          );

          // Should NOT be able to modify (no modify rule, default deny)
          // eslint-disable-next-line @convex-dev/explicit-table-ids -- testing the implicit API
          await db.patch(docId, { content: "Blocked modification" });
        }),
      ).rejects.toThrow(/write access not allowed/);
    });

    test("explicit table names", async () => {
      const t = convexTest(schema, modules);
      const docId = await t.run(async (ctx) => {
        await ctx.db.insert("users", { tokenIdentifier: "Person A" });
        return ctx.db.insert("publicData", { content: "Initial content" });
      });

      const asA = t.withIdentity({ tokenIdentifier: "Person A" });

      // Test with default allow
      await asA.run(async (ctx) => {
        const tokenIdentifier = (await ctx.auth.getUserIdentity())
          ?.tokenIdentifier;
        if (!tokenIdentifier) throw new Error("Unauthenticated");

        const db = wrapDatabaseWriter(
          { tokenIdentifier },
          ctx.db,
          {
            publicData: {
              read: async () => true, // Allow reads
            },
          },
          { defaultPolicy: "allow" },
        );

        // Should be able to modify (no modify rule, default allow)
        await db.patch("publicData", docId, { content: "Modified content" });
      });

      // Test with default deny
      await expect(() =>
        asA.run(async (ctx) => {
          const tokenIdentifier = (await ctx.auth.getUserIdentity())
            ?.tokenIdentifier;
          if (!tokenIdentifier) throw new Error("Unauthenticated");

          const db = wrapDatabaseWriter(
            { tokenIdentifier },
            ctx.db,
            {
              publicData: {
                read: async () => true, // Allow reads but no modify rule
              },
            },
            { defaultPolicy: "deny" },
          );

          // Should NOT be able to modify (no modify rule, default deny)
          await db.patch("publicData", docId, {
            content: "Blocked modification",
          });
        }),
      ).rejects.toThrow(/write access not allowed/);
    });
  });
});

const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;

const mutationWithRLS = customMutation(
  mutation,
  customCtx((ctx) => withRLS(ctx)),
);

customMutation(
  mutationWithRLS,
  customCtx((_ctx) => ({ foo: "bar" })),
) satisfies typeof mutation;

crud(schema, "users", queryGeneric, mutationWithRLS);
