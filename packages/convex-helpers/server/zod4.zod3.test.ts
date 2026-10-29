// This is a copy of the tests in zod3.test.ts, but ported to use Zod 4 instead

import type {
  DataModelFromSchemaDefinition,
  QueryBuilder,
  ApiFromModules,
  RegisteredQuery,
  DefaultFunctionArgs,
  FunctionReference,
} from "convex/server";
import { defineTable, defineSchema, queryGeneric, anyApi } from "convex/server";
import type { Equals } from "../index.js";
import { omit } from "../index.js";
import { convexTest } from "convex-test";
import { assertType, describe, expect, expectTypeOf, test } from "vitest";
import { modules } from "./setup.test.js";
import type { ZCustomCtx } from "./zod4.js";
import {
  zCustomQuery,
  zid,
  zodOutputToConvex,
  zodToConvexFields,
  zodToConvex,
  convexToZod,
  convexToZodFields,
} from "./zod4.js";
import { customCtx } from "./customFunctions.js";
import type { VString, VFloat64, VObject, VId, Infer } from "convex/values";
import { v } from "convex/values";
import { z } from "zod/v4";
import { ignoreUnionOrder } from "../test/zodToConvex";

// This is an example of how to make a version of `zid` that
// enforces that the type matches one of your defined tables.
// Note that it can't be used in anything imported by schema.ts
// since the types would be circular.
// For argument validation it might be useful to you, however.
// const zId = zid<DataModel>;

export const kitchenSinkValidator = {
  email: z.email(),
  userId: zid("users"),
  // Otherwise this is equivalent, but wouldn't catch zid("CounterTable")
  // counterId: zid("counter_table"),
  num: z.number().min(0),
  nan: z.nan(),
  bigint: z.bigint(),
  bool: z.boolean(),
  null: z.null(),
  any: z.unknown(),
  array: z.array(z.string()),
  object: z.object({ a: z.string(), b: z.number() }),
  objectWithOptional: z.object({ a: z.string(), b: z.number().optional() }),
  record: z.record(
    z.union([z.string(), zid("users")]),
    z.union([z.number(), z.string()]),
  ),
  union: z.union([z.string(), z.number()]),
  discriminatedUnion: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("a"), a: z.string() }),
    z.object({ kind: z.literal("b"), b: z.number() }),
  ]),
  literal: z.literal("hi"),
  tuple: z.tuple([z.string(), z.number()]),
  lazy: z.lazy(() => z.string()),
  enum: z.enum(["a", "b"]),
  optional: z.object({ a: z.string(), b: z.number() }).optional(),
  nullableOptional: z.nullable(z.string().optional()),
  optionalNullable: z.nullable(z.string()).optional(),
  nullable: z.nullable(z.string()),
  branded: z.string().brand("branded"),
  default: z.string().default("default"),
  readonly: z.object({ a: z.string(), b: z.number() }).readonly(),
  pipeline: z.number().pipe(z.coerce.string()),
};

const schema = defineSchema({
  sink: defineTable(zodToConvexFields(kitchenSinkValidator)).index("email", [
    "email",
  ]),
  users: defineTable({}),
});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
// type DatabaseReader = GenericDatabaseReader<DataModel>;
// type DatabaseWriter = GenericDatabaseWriter<DataModel>;

const zQuery = zCustomQuery(query, {
  // You could require arguments for all queries here.
  args: {},
  input: async () => {
    // Here you could use the args you declared and return patches for the
    // function's ctx and args. e.g. looking up a user and passing it in ctx.
    // Or just asserting that the user is logged in.
    return { ctx: {}, args: {} };
  },
});

export const kitchenSink = zQuery({
  args: kitchenSinkValidator,
  handler: async (_ctx, args) => {
    return {
      args,
      json: (v.object(zodToConvexFields(kitchenSinkValidator)) as any).json,
    };
  },
  returns: z.object({
    args: z.object({
      ...kitchenSinkValidator,
      // round trip the pipeline
      pipeline: z.string().pipe(z.coerce.number()),
    }),
    json: z.any(),
  }),
  // You can add .strict() to fail if any more fields are passed
  // .strict(),
});

export const dateRoundTrip = zQuery({
  args: { date: z.string().transform((s) => new Date(Date.parse(s))) },
  handler: async (ctx, args) => {
    return args.date;
  },
  returns: z.date().transform((d) => d.toISOString()),
});

export const failsReturnsValidator = zQuery({
  args: {},
  returns: z.number(),
  handler: async () => {
    return "foo" as unknown as number;
  },
});

export const returnsWithoutArgs = zQuery({
  returns: z.number(),
  handler: async () => {
    return 1;
  },
});

export const zodOutputCompliance = zQuery({
  // Note no args validator
  handler: (ctx, args: { optionalString?: string | undefined }) => {
    return {
      undefinedBecomesFooString: undefined,
      stringBecomesNull: "bar",
      threeBecomesString: 3,
      extraArg: "extraArg",
      optionalString: args.optionalString,
      arrayWithDefaultFoo: [undefined],
      objectWithDefaultFoo: { foo: undefined },
      unionOfDefaultFoo: undefined,
    };
  },
  // Note inline record of zod validators works.
  returns: {
    undefinedBecomesFooString: z.string().default("foo"),
    stringBecomesNull: z.string().transform((_) => null),
    threeBecomesString: z.number().pipe(z.coerce.string()),
    optionalString: z.string().optional(),
    arrayWithDefaultFoo: z.array(z.string().default("foo")),
    objectWithDefaultFoo: z.object({ foo: z.string().default("foo") }),
    unionOfDefaultFoo: z.union([z.string().default("foo"), z.number()]),
  },
});

export const zodArgsObject = zQuery({
  args: z.object({ a: z.string() }),
  handler: async (ctx, args) => {
    return args;
  },
  returns: z.object({ a: z.string() }),
});

// example of helper function
type ZodQueryCtx = ZCustomCtx<typeof zQuery>;
const myArgs = z.object({ a: z.string() });
const myHandler = async (_ctx: ZodQueryCtx, _args: z.infer<typeof myArgs>) => {
  return "foo";
};
export const viaHelper = zQuery({
  args: myArgs,
  handler: myHandler,
  returns: z.string(),
});

/**
 * Testing custom zod function modifications.
 */

/**
 * Adding ctx
 */
const addCtxArg = zCustomQuery(
  query,
  customCtx(() => {
    return { a: "hi" };
  }),
);
export const addC = addCtxArg({
  args: {},
  handler: async (ctx) => {
    return { ctxA: ctx.a }; // !!!
  },
});
queryMatches(addC, {}, { ctxA: "" });
// Unvalidated
export const addCU = addCtxArg({
  handler: async (ctx) => {
    return { ctxA: ctx.a }; // !!!
  },
});
// Unvalidated variant 2
queryMatches(addCU, {}, { ctxA: "" });
export const addCU2 = addCtxArg(async (ctx) => {
  return { ctxA: ctx.a }; // !!!
});
queryMatches(addCU2, {}, { ctxA: "" });

export const addCtxWithExistingArg = addCtxArg({
  args: { b: z.string() },
  handler: async (ctx, args) => {
    return { ctxA: ctx.a, argB: args.b }; // !!!
  },
});
queryMatches(addCtxWithExistingArg, { b: "" }, { ctxA: "", argB: "" });
/**
 * Adding arg
 */
const addArg = zCustomQuery(query, {
  args: {},
  input: async () => {
    return { ctx: {}, args: { a: "hi" } };
  },
});
export const add = addArg({
  args: {},
  handler: async (_ctx, args) => {
    return { argsA: args.a }; // !!!
  },
});
queryMatches(add, {}, { argsA: "" });
export const addUnverified = addArg({
  handler: async (_ctx, args) => {
    return { argsA: args.a }; // !!!
  },
});
queryMatches(addUnverified, {}, { argsA: "" });
export const addUnverified2 = addArg((_ctx, args) => {
  return { argsA: args.a }; // !!!
});
queryMatches(addUnverified2, {}, { argsA: "" });

/**
 * Consuming arg, add to ctx
 */
const consumeArg = zCustomQuery(query, {
  args: { a: v.string() },
  input: async (_ctx, { a }) => {
    return { ctx: { a }, args: {} };
  },
});
export const consume = consumeArg({
  args: {},
  handler: async (ctx, emptyArgs) => {
    assertType<Record<string, never>>(emptyArgs); // !!!
    return { ctxA: ctx.a };
  },
});
queryMatches(consume, { a: "" }, { ctxA: "" });

export const necromanceArg = consumeArg({
  args: { a: z.string() },
  handler: async (ctx, args) => {
    assertType<{ a: string }>(args);
    return { ctxA: ctx.a, argsA: args.a };
  },
});
queryMatches(necromanceArg, { a: "" }, { ctxA: "", argsA: "" });

/**
 * Passing Through arg, also add to ctx for fun
 */
const passThrougArg = zCustomQuery(query, {
  args: { a: v.string() },
  input: async (_ctx, args) => {
    return { ctx: { a: args.a }, args };
  },
});
export const passThrough = passThrougArg({
  args: {},
  handler: async (ctx, args) => {
    return { ctxA: ctx.a, argsA: args.a }; // !!!
  },
});
queryMatches(passThrough, { a: "" }, { ctxA: "", argsA: "" });

/**
 * Modify arg type, don't need to re-defined "a" arg
 */
const modifyArg = zCustomQuery(query, {
  args: { a: v.string() },
  input: async (_ctx, { a }) => {
    return { ctx: { a }, args: { a: 123 } }; // !!!
  },
});
export const modify = modifyArg({
  args: {},
  handler: async (ctx, args) => {
    args.a.toFixed(); // !!!
    return { ctxA: ctx.a, argsA: args.a };
  },
});
queryMatches(modify, { a: "" }, { ctxA: "", argsA: 0 }); // !!!

/**
 * Redefine arg type with the same type: OK!
 */
const redefineArg = zCustomQuery(query, {
  args: { a: v.string() },
  input: async (_ctx, args) => ({ ctx: {}, args }),
});
export const redefine = redefineArg({
  args: { a: z.string() },
  handler: async (_ctx, args) => {
    return { argsA: args.a };
  },
});
queryMatches(redefine, { a: "" }, { argsA: "" });

/**
 * Refine arg type with a more specific type: OK!
 */
const refineArg = zCustomQuery(query, {
  args: { a: v.optional(v.string()) },
  input: async (_ctx, args) => ({ ctx: {}, args }),
});
export const refined = refineArg({
  args: { a: z.string() },
  handler: async (_ctx, args) => {
    return { argsA: args.a };
  },
});
queryMatches(refined, { a: "" }, { argsA: "" });

/**
 * Redefine arg type with different type: error!
 */
const badRedefineArg = zCustomQuery(query, {
  args: { a: v.string(), b: v.number() },
  input: async (_ctx, args) => ({ ctx: {}, args }),
});
expect(() =>
  badRedefineArg({
    args: { a: z.number() },
    handler: async (_ctx, args) => {
      return { argsA: args.a };
    },
  }),
).toThrow();
/**
 * Test helpers
 */
function queryMatches<
  A extends DefaultFunctionArgs,
  R,
  T extends RegisteredQuery<"public", A, R>,
>(_f: T, _a: A, _v: R) {}

const testApi: ApiFromModules<{
  fns: {
    kitchenSink: typeof kitchenSink;
    dateRoundTrip: typeof dateRoundTrip;
    failsReturnsValidator: typeof failsReturnsValidator;
    returnsWithoutArgs: typeof returnsWithoutArgs;
    zodOutputCompliance: typeof zodOutputCompliance;
    zodArgsObject: typeof zodArgsObject;
    addC: typeof addC;
    addCU: typeof addCU;
    addCU2: typeof addCU2;
    addCtxWithExistingArg: typeof addCtxWithExistingArg;
    add: typeof add;
    addUnverified: typeof addUnverified;
    addUnverified2: typeof addUnverified2;
    consume: typeof consume;
    necromanceArg: typeof necromanceArg;
    passThrough: typeof passThrough;
    modify: typeof modify;
    redefine: typeof redefine;
    refined: typeof refined;
  };
}>["fns"] = anyApi["zod4.zod3.test"] as any;

test("zod kitchen sink", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const kitchenSink = {
    email: "email@example.com",
    userId,
    num: 1,
    nan: NaN,
    bigint: BigInt(1),
    bool: true,
    null: null,
    any: [1, "2"],
    array: ["1", "2"],
    object: { a: "1", b: 2 },
    objectWithOptional: { a: "1" },
    record: { a: 1 },
    union: 1,
    discriminatedUnion: { kind: "a" as const, a: "1" },
    literal: "hi" as const,
    tuple: ["2", 1] as [string, number],
    lazy: "lazy",
    enum: "b" as const,
    optional: undefined,
    nullable: null,
    branded: "branded" as string & z.BRAND<"branded">,
    default: undefined,
    readonly: { a: "1", b: 2 },
    pipeline: 0,
  };
  const response = await t.query(testApi.kitchenSink, kitchenSink);
  expect(response.args).toMatchObject({
    ...omit(kitchenSink, ["optional"]),
    default: "default",
  });
  expect(response.json).toMatchObject({
    type: "object",
    value: {
      any: { fieldType: { type: "any" }, optional: false },
      array: {
        fieldType: { type: "array", value: { type: "string" } },
        optional: false,
      },
      bigint: { fieldType: { type: "bigint" }, optional: false },
      bool: { fieldType: { type: "boolean" }, optional: false },
      branded: { fieldType: { type: "string" }, optional: false },
      default: { fieldType: { type: "string" }, optional: true },
      discriminatedUnion: {
        fieldType: {
          type: "union",
          value: [
            {
              type: "object",
              value: {
                a: { fieldType: { type: "string" }, optional: false },
                kind: {
                  fieldType: { type: "literal", value: "a" },
                  optional: false,
                },
              },
            },
            {
              type: "object",
              value: {
                b: { fieldType: { type: "number" }, optional: false },
                kind: {
                  fieldType: { type: "literal", value: "b" },
                  optional: false,
                },
              },
            },
          ],
        },
        optional: false,
      },
      email: { fieldType: { type: "string" }, optional: false },
      enum: {
        fieldType: {
          type: "union",
          value: [
            { type: "literal", value: "a" },
            { type: "literal", value: "b" },
          ],
        },
        optional: false,
      },
      lazy: { fieldType: { type: "string" }, optional: false },
      literal: { fieldType: { type: "literal", value: "hi" }, optional: false },
      nan: { fieldType: { type: "number" }, optional: false },
      null: { fieldType: { type: "null" }, optional: false },
      nullable: {
        fieldType: {
          type: "union",
          value: [{ type: "string" }, { type: "null" }],
        },
        optional: false,
      },
      num: { fieldType: { type: "number" }, optional: false },
      object: {
        fieldType: {
          type: "object",
          value: {
            a: { fieldType: { type: "string" }, optional: false },
            b: { fieldType: { type: "number" }, optional: false },
          },
        },
        optional: false,
      },
      objectWithOptional: {
        fieldType: {
          type: "object",
          value: {
            a: { fieldType: { type: "string" }, optional: false },
            b: { fieldType: { type: "number" }, optional: true },
          },
        },
        optional: false,
      },
      optional: {
        fieldType: {
          type: "object",
          value: {
            a: { fieldType: { type: "string" }, optional: false },
            b: { fieldType: { type: "number" }, optional: false },
          },
        },
        optional: true,
      },
      pipeline: { fieldType: { type: "number" }, optional: false },
      readonly: {
        fieldType: {
          type: "object",
          value: {
            a: { fieldType: { type: "string" }, optional: false },
            b: { fieldType: { type: "number" }, optional: false },
          },
        },
        optional: false,
      },
      record: {
        fieldType: {
          keys: {
            type: "union",
            value: [{ type: "string" }, { tableName: "users", type: "id" }],
          },
          type: "record",
          values: {
            fieldType: {
              type: "union",
              value: [{ type: "number" }, { type: "string" }],
            },
          },
        },
      },
      tuple: {
        fieldType: {
          type: "array",
          value: {
            type: "union",
            value: [{ type: "string" }, { type: "number" }],
          },
        },
        optional: false,
      },
      union: {
        fieldType: {
          type: "union",
          value: [{ type: "string" }, { type: "number" }],
        },
        optional: false,
      },
      userId: {
        fieldType: { tableName: "users", type: "id" },
        optional: false,
      },
    },
  });
  const stored = await t.run(async (ctx) => {
    const id = await ctx.db.insert("sink", kitchenSink);
    return ctx.db.get("sink", id);
  });
  expect(stored).toMatchObject(omit(kitchenSink, ["optional", "default"]));
});

test("zod date round trip", async () => {
  const t = convexTest(schema, modules);
  const date = new Date().toISOString();
  const response = await t.query(testApi.dateRoundTrip, { date });
  expect(response).toBe(date);
});

test("zod fails returns validator", async () => {
  const t = convexTest(schema, modules);
  await expect(() =>
    t.query(testApi.failsReturnsValidator, {}),
  ).rejects.toThrow();
});

test("zod returns without args works", async () => {
  const t = convexTest(schema, modules);
  const response = await t.query(testApi.returnsWithoutArgs, {});
  expect(response).toBe(1);
});

test("output validators work for arrays objects and unions", async () => {
  const array = zodOutputToConvex(z.array(z.string().default("foo")));
  expect(array.kind).toBe("array");
  expect(array.element.kind).toBe("string");
  expect(array.element.isOptional).toBe("required");
  const object = zodOutputToConvex(
    z.object({ foo: z.string().default("foo") }),
  );
  expect(object.kind).toBe("object");
  expect(object.fields.foo.kind).toBe("string");
  expect(object.fields.foo.isOptional).toBe("required");
  const union = zodOutputToConvex(z.union([z.string(), z.number().default(0)]));
  expect(union.kind).toBe("union");
  expect(union.members[0].kind).toBe("string");
  expect(union.members[1].kind).toBe("float64");
  expect(union.members[1].isOptional).toBe("required");
});

test("zod output compliance", async () => {
  const t = convexTest(schema, modules);
  const response = await t.query(testApi.zodOutputCompliance, {});
  expect(response).toMatchObject({
    undefinedBecomesFooString: "foo",
    stringBecomesNull: null,
    threeBecomesString: "3",
    arrayWithDefaultFoo: ["foo"],
    objectWithDefaultFoo: { foo: "foo" },
    unionOfDefaultFoo: "foo",
  });
  const responseWithMaybe = await t.query(testApi.zodOutputCompliance, {
    optionalString: "optionalString",
  });
  expect(responseWithMaybe).toMatchObject({
    optionalString: "optionalString",
  });
  // number should fail
  await expect(() =>
    t.query(testApi.zodOutputCompliance, {
      optionalString: 1 as any,
    }),
  ).rejects.toThrow();
});

test("zod args object", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(testApi.zodArgsObject, { a: "foo" })).toMatchObject({
    a: "foo",
  });
  await expect(() =>
    t.query(testApi.zodArgsObject, { a: 1 } as any),
  ).rejects.toThrow();
});

describe("zod functions", () => {
  test("add ctx", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(testApi.addC, {})).toMatchObject({
      ctxA: "hi",
    });
    expect(await t.query(testApi.addCU, {})).toMatchObject({
      ctxA: "hi",
    });
    expect(await t.query(testApi.addCU2, {})).toMatchObject({
      ctxA: "hi",
    });
  });

  test("add ctx with existing arg", async () => {
    const t = convexTest(schema, modules);
    expect(
      await t.query(testApi.addCtxWithExistingArg, { b: "foo" }),
    ).toMatchObject({
      ctxA: "hi",
      argB: "foo",
    });
    expectTypeOf(testApi.addCtxWithExistingArg).toExtend<
      FunctionReference<
        "query",
        "public",
        { b: string },
        { ctxA: string; argB: string }
      >
    >();
    expectTypeOf<
      FunctionReference<
        "query",
        "public",
        { b: string },
        { ctxA: string; argB: string }
      >
    >().toExtend<typeof testApi.addCtxWithExistingArg>();
  });

  test("add args", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(testApi.add, {})).toMatchObject({
      argsA: "hi",
    });
    expect(await t.query(testApi.addUnverified, {})).toMatchObject({
      argsA: "hi",
    });
    expect(await t.query(testApi.addUnverified2, {})).toMatchObject({
      argsA: "hi",
    });
  });

  test("consume arg, add to ctx", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(testApi.consume, { a: "foo" })).toMatchObject({
      ctxA: "foo",
    });
  });

  test("necromance arg", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(testApi.necromanceArg, { a: "foo" })).toMatchObject({
      ctxA: "foo",
      argsA: "foo",
    });
  });

  test("pass through arg + ctx", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(testApi.passThrough, { a: "foo" })).toMatchObject({
      ctxA: "foo",
      argsA: "foo",
    });
  });

  test("modify arg type", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(testApi.modify, { a: "foo" })).toMatchObject({
      ctxA: "foo",
      argsA: 123,
    });
  });

  test("redefine arg", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(testApi.redefine, { a: "foo" })).toMatchObject({
      argsA: "foo",
    });
  });

  test("refined arg", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(testApi.refined, { a: "foo" })).toMatchObject({
      argsA: "foo",
    });
    await expect(() =>
      t.query(testApi.refined, { a: undefined as any }),
    ).rejects.toThrow("Validator error: Missing required field `a`");
  });
});

/**
 * Test type translation
 */

expectTypeOf(
  zodToConvexFields({
    s: z.email().max(5),
    n: z.number(),
    nan: z.nan(),
    optional: z.number().optional(),
    optional2: z.optional(z.number()),
    record: z.record(z.string(), z.number()),
    default: z.number().default(0),
    nullable: z.number().nullable(),
    null: z.null(),
    bi: z.bigint(),
    bool: z.boolean(),
    literal: z.literal("hi"),
    branded: z.string().brand("branded"),
  }),
).toEqualTypeOf({
  s: v.string(),
  n: v.number(),
  nan: v.number(),
  optional: v.optional(v.number()),
  optional2: v.optional(v.number()),
  record: v.record(v.string(), v.number()),
  default: v.optional(v.number()),
  nullable: v.union(v.number(), v.null()),
  null: v.null(),
  bi: v.int64(),
  bool: v.boolean(),
  literal: v.literal("hi"),
  branded: v.string() as VString<string & z.BRAND<"branded">>,
});

expectTypeOf(
  zodToConvexFields({
    simpleArray: z.array(z.boolean()),
    tuple: z.tuple([z.boolean(), z.boolean()]),
    enum: z.enum(["a", "b"]),
    obj: z.object({ a: z.string(), b: z.object({ c: z.array(z.number()) }) }),
    union: z.union([z.string(), z.object({ c: z.array(z.number()) })]),
    discUnion: z.discriminatedUnion("type", [
      z.object({ type: z.literal("a"), a: z.string() }),
      z.object({ type: z.literal("b"), b: z.number() }),
    ]),
  }),
).toEqualTypeOf({
  simpleArray: v.array(v.boolean()),
  tuple: v.array(v.union(v.boolean(), v.boolean())),
  enum: ignoreUnionOrder(v.union(v.literal("a"), v.literal("b"))),
  obj: v.object({ a: v.string(), b: v.object({ c: v.array(v.number()) }) }),
  union: v.union(v.string(), v.object({ c: v.array(v.number()) })),
  discUnion: v.union(
    v.object({
      type: v.literal("a"),
      a: v.string(),
    }),
    v.object({
      type: v.literal("b"),
      b: v.number(),
    }),
  ),
});

expectTypeOf(
  zodToConvexFields({
    lazy: z.lazy(() => z.string()),
    pipe: z.string().pipe(z.email()),
    ro: z.string().readonly(),
    unknown: z.unknown(),
    any: z.any(),
  }),
).toEqualTypeOf({
  lazy: v.string(),
  pipe: v.string(),
  ro: v.string(),
  unknown: v.any(),
  any: v.any(),
});
const _s = z.string().brand("brand");
const _n = z.number().brand("brand");
const _i = z.bigint().brand("brand");
expectTypeOf<z.input<typeof _s>>().toEqualTypeOf<string>();
expectTypeOf<z.output<typeof _s>>().toEqualTypeOf<string & z.BRAND<"brand">>();
expectTypeOf<z.input<typeof _n>>().toEqualTypeOf<number>();
expectTypeOf<z.output<typeof _n>>().toEqualTypeOf<number & z.BRAND<"brand">>();
expectTypeOf<z.input<typeof _i>>().toEqualTypeOf<bigint>();
expectTypeOf<z.output<typeof _i>>().toEqualTypeOf<bigint & z.BRAND<"brand">>();

// Test branded objects preserve their brand
const ZBrandedObject = z
  .object({ name: z.string(), age: z.number() })
  .brand<"User">();
const ZBrandedObject2 = z.object({ id: z.string() }).brand("UserId");
const _vBrandedObject = zodToConvex(ZBrandedObject);
const _vBrandedObject2 = zodToConvex(ZBrandedObject2);
const _vBrandedObjectOutput = zodOutputToConvex(ZBrandedObject);
const _vBrandedObjectOutput2 = zodOutputToConvex(ZBrandedObject2);

// Verify branded objects have the brand in their type
type _BrandedObjectType = Infer<typeof _vBrandedObject>;
type _BrandedObject2Type = Infer<typeof _vBrandedObject2>;
type _BrandedObjectOutputType = Infer<typeof _vBrandedObjectOutput>;
type _BrandedObjectOutput2Type = Infer<typeof _vBrandedObjectOutput2>;

expectTypeOf<_BrandedObjectType>().toEqualTypeOf<
  { name: string; age: number } & z.BRAND<"User">
>();
expectTypeOf<_BrandedObject2Type>().toEqualTypeOf<
  { id: string } & z.BRAND<"UserId">
>();
expectTypeOf<_BrandedObjectOutputType>().toEqualTypeOf<
  { name: string; age: number } & z.BRAND<"User">
>();
expectTypeOf<_BrandedObjectOutput2Type>().toEqualTypeOf<
  { id: string } & z.BRAND<"UserId">
>();

// Test more complex branded object (like the user's example)
const ZUserBase = z.object({
  email: z.email(),
  name: z.string(),
  createdAt: z.number(),
});
const ZUser = ZUserBase.extend({
  role: z.enum(["admin", "user"]),
}).brand<"User">();
const ZUser2 = ZUserBase.extend({ role: z.enum(["admin", "user"]) }).brand(
  "User2",
);
const _vUser = zodToConvex(ZUser);
const _vUser2 = zodToConvex(ZUser2);

type UserType = Infer<typeof _vUser>;
type User2Type = Infer<typeof _vUser2>;
expectTypeOf<UserType>().toEqualTypeOf<
  {
    email: string;
    name: string;
    createdAt: number;
    role: "admin" | "user";
  } & z.BRAND<"User">
>();
expectTypeOf<User2Type>().toEqualTypeOf<
  {
    email: string;
    name: string;
    createdAt: number;
    role: "admin" | "user";
  } & z.BRAND<"User2">
>();

function sameType<T, U>(_t: T, _u: U): Equals<T, U> {
  return true as any;
}

test("convexToZod basic types", () => {
  expect(convexToZod(v.string()).constructor.name).toBe("ZodString");
  expect(convexToZod(v.number()).constructor.name).toBe("ZodNumber");
  expect(convexToZod(v.int64()).constructor.name).toBe("ZodBigInt");
  expect(convexToZod(v.boolean()).constructor.name).toBe("ZodBoolean");
  expect(convexToZod(v.null()).constructor.name).toBe("ZodNull");
  expect(convexToZod(v.any()).constructor.name).toBe("ZodAny");
  expect(convexToZod(v.id("users")).constructor.name).toBe("ZodCustom"); // This differs in v4
});

test("convexToZod complex types", () => {
  const arrayValidator = convexToZod(v.array(v.string()));
  expect(arrayValidator.constructor.name).toBe("ZodArray");

  const objectValidator = convexToZod(
    v.object({ a: v.string(), b: v.number() }),
  );
  expect(objectValidator.constructor.name).toBe("ZodObject");

  const unionValidator = convexToZod(v.union(v.string(), v.number()));
  expect(unionValidator.constructor.name).toBe("ZodUnion");
  expect(unionValidator.options[0].constructor.name).toBe("ZodString");
  expect(unionValidator.options[1].constructor.name).toBe("ZodNumber");
  expectTypeOf(unionValidator.options[0]).toEqualTypeOf<z.ZodString>();
  expectTypeOf(unionValidator.options[1]).toEqualTypeOf<z.ZodNumber>();

  const literalValidator = convexToZod(v.literal("hi"));
  expect(literalValidator.constructor.name).toBe("ZodLiteral");

  const recordValidator = convexToZod(v.record(v.string(), v.number()));
  expect(recordValidator.constructor.name).toBe("ZodRecord");

  const optionalValidator = convexToZod(v.optional(v.string()));
  expect(optionalValidator.constructor.name).toBe("ZodOptional");
});

test("convexToZodFields", () => {
  const fields = {
    name: v.string(),
    age: v.number(),
    isActive: v.boolean(),
    tags: v.array(v.string()),
    metadata: v.object({ createdBy: v.string() }),
  };

  const zodFields = convexToZodFields(fields);

  expect(zodFields.name.constructor.name).toBe("ZodString");
  expect(zodFields.age.constructor.name).toBe("ZodNumber");
  expect(zodFields.isActive.constructor.name).toBe("ZodBoolean");
  expect(zodFields.tags.constructor.name).toBe("ZodArray");
  expect(zodFields.metadata.constructor.name).toBe("ZodObject");
});

test("convexToZod round trip", () => {
  const stringValidator = v.string();
  const zodString = convexToZod(stringValidator);
  const roundTripString = zodToConvex(zodString) as VString;
  expect(roundTripString.kind).toBe(stringValidator.kind);

  type StringType = z.infer<typeof zodString>;
  type ConvexStringType = Infer<typeof stringValidator>;
  sameType<StringType, ConvexStringType>(
    "" as StringType,
    "" as ConvexStringType,
  );

  const numberValidator = v.number();
  const zodNumber = convexToZod(numberValidator);
  const roundTripNumber = zodToConvex(zodNumber) as VFloat64;
  expect(roundTripNumber.kind).toBe(numberValidator.kind);

  type NumberType = z.infer<typeof zodNumber>;
  type ConvexNumberType = Infer<typeof numberValidator>;
  sameType<NumberType, ConvexNumberType>(
    0 as NumberType,
    0 as ConvexNumberType,
  );

  const objectValidator = v.object({
    a: v.string(),
    b: v.number(),
    c: v.boolean(),
    d: v.array(v.string()),
  });

  const zodObject = convexToZod(objectValidator);
  const roundTripObject = zodToConvex(zodObject) as VObject<any, any>;
  expect(roundTripObject.kind).toBe(objectValidator.kind);

  type ObjectType = z.infer<typeof zodObject>;
  type ConvexObjectType = Infer<typeof objectValidator>;
  sameType<ObjectType, ConvexObjectType>(
    {} as ObjectType,
    {} as ConvexObjectType,
  );

  const idValidator = v.id("users");
  const zodId = convexToZod(idValidator);
  const roundTripId = zodToConvex(zodId) as VId<"users">;
  expect(roundTripId.kind).toBe(idValidator.kind);

  type IdType = z.infer<typeof zodId>;
  type ConvexIdType = Infer<typeof idValidator>;
  sameType<IdType, ConvexIdType>("" as IdType, "" as ConvexIdType);
});

test("convexToZod validation", () => {
  const stringValidator = v.string();
  const zodString = convexToZod(stringValidator);

  expect(zodString.parse("hello")).toBe("hello");

  expect(() => zodString.parse(123)).toThrow();

  const numberValidator = v.number();
  const zodNumber = convexToZod(numberValidator);

  expect(zodNumber.parse(123)).toBe(123);

  expect(() => zodNumber.parse("hello")).toThrow();

  const boolValidator = v.boolean();
  const zodBool = convexToZod(boolValidator);

  expect(zodBool.parse(true)).toBe(true);

  expect(() => zodBool.parse("true")).toThrow();

  const arrayValidator = v.array(v.string());
  const zodArray = convexToZod(arrayValidator);

  expect(zodArray.parse(["a", "b", "c"])).toEqual(["a", "b", "c"]);

  expect(() => zodArray.parse(["a", 123, "c"])).toThrow();

  const objectValidator = v.object({
    name: v.string(),
    age: v.number(),
    active: v.boolean(),
  });
  const zodObject = convexToZod(objectValidator);

  const validObject = {
    name: "John",
    age: 30,
    active: true,
  };
  expect(zodObject.parse(validObject)).toEqual(validObject);

  const invalidObject = {
    name: "John",
    age: "thirty",
    active: true,
  };
  expect(() => zodObject.parse(invalidObject)).toThrow();

  const unionValidator = v.union(v.string(), v.number());
  const zodUnion = convexToZod(unionValidator);

  expect(zodUnion.parse("hello")).toBe("hello");

  expect(zodUnion.parse(123)).toBe(123);

  expect(() => zodUnion.parse(true)).toThrow();
});

test("convexToZod optional values", () => {
  const optionalStringValidator = v.optional(v.string());
  const zodOptionalString = convexToZod(optionalStringValidator);

  expect(zodOptionalString.constructor.name).toBe("ZodOptional");

  expect(zodOptionalString.parse("hello")).toBe("hello");
  expect(zodOptionalString.parse(undefined)).toBe(undefined);
  expect(() => zodOptionalString.parse(123)).toThrow();

  type OptionalStringType = z.infer<typeof zodOptionalString>;
  type ConvexOptionalStringType = Infer<typeof optionalStringValidator>;
  sameType<OptionalStringType, ConvexOptionalStringType>(
    "" as OptionalStringType,
    "" as ConvexOptionalStringType,
  );
  sameType<OptionalStringType, string | undefined>(
    undefined as OptionalStringType,
    undefined as string | undefined,
  );

  const optionalNumberValidator = v.optional(v.number());
  const zodOptionalNumber = convexToZod(optionalNumberValidator);

  expect(zodOptionalNumber.constructor.name).toBe("ZodOptional");

  expect(zodOptionalNumber.parse(123)).toBe(123);
  expect(zodOptionalNumber.parse(undefined)).toBe(undefined);
  expect(() => zodOptionalNumber.parse("hello")).toThrow();

  type OptionalNumberType = z.infer<typeof zodOptionalNumber>;
  type ConvexOptionalNumberType = Infer<typeof optionalNumberValidator>;
  sameType<OptionalNumberType, ConvexOptionalNumberType>(
    0 as OptionalNumberType,
    0 as ConvexOptionalNumberType,
  );

  const optionalObjectValidator = v.optional(
    v.object({
      name: v.string(),
      age: v.number(),
    }),
  );
  const zodOptionalObject = convexToZod(optionalObjectValidator);

  expect(zodOptionalObject.constructor.name).toBe("ZodOptional");

  const validObj = { name: "John", age: 30 };
  expect(zodOptionalObject.parse(validObj)).toEqual(validObj);
  expect(zodOptionalObject.parse(undefined)).toBe(undefined);
  expect(() => zodOptionalObject.parse({ name: "John", age: "30" })).toThrow();

  type OptionalObjectType = z.infer<typeof zodOptionalObject>;
  type ConvexOptionalObjectType = Infer<typeof optionalObjectValidator>;
  sameType<OptionalObjectType, ConvexOptionalObjectType>(
    { name: "", age: 0 } as OptionalObjectType,
    { name: "", age: 0 } as ConvexOptionalObjectType,
  );

  const objectWithOptionalFieldsValidator = v.object({
    name: v.string(),
    age: v.optional(v.number()),
    address: v.optional(v.string()),
  });
  const zodObjectWithOptionalFields = convexToZod(
    objectWithOptionalFieldsValidator,
  );

  expect(zodObjectWithOptionalFields.parse({ name: "John" })).toEqual({
    name: "John",
  });
  expect(zodObjectWithOptionalFields.parse({ name: "John", age: 30 })).toEqual({
    name: "John",
    age: 30,
  });
  expect(
    zodObjectWithOptionalFields.parse({
      name: "John",
      age: 30,
      address: "123 Main St",
    }),
  ).toEqual({ name: "John", age: 30, address: "123 Main St" });
  expect(() => zodObjectWithOptionalFields.parse({ age: 30 })).toThrow();

  type ObjectWithOptionalFieldsType = z.infer<
    typeof zodObjectWithOptionalFields
  >;
  type ConvexObjectWithOptionalFieldsType = Infer<
    typeof objectWithOptionalFieldsValidator
  >;
  sameType<ObjectWithOptionalFieldsType, ConvexObjectWithOptionalFieldsType>(
    { name: "" } as ObjectWithOptionalFieldsType,
    { name: "" } as ConvexObjectWithOptionalFieldsType,
  );

  const optionalArrayValidator = v.optional(v.array(v.string()));
  const zodOptionalArray = convexToZod(optionalArrayValidator);
  const roundTripOptionalArray = zodToConvex(zodOptionalArray) as unknown as {
    isOptional: string;
  };

  expect(roundTripOptionalArray.isOptional).toBe("optional");
});

test("convexToZod object with union of one literal", () => {
  const unionValidator = v.object({
    member: v.union(v.literal("hello")),
  });
  const zodUnion = convexToZod(unionValidator);
  expect(zodUnion.constructor.name).toBe("ZodObject");
  expect(zodUnion.parse({ member: "hello" })).toEqual({ member: "hello" });
  expect(() => zodUnion.parse({ member: "world" })).toThrow();
});
