import type {
  DataModelFromSchemaDefinition,
  QueryBuilder,
  MutationBuilder,
  ActionBuilder,
  ApiFromModules,
  FunctionReference,
} from "convex/server";
import {
  defineTable,
  defineSchema,
  queryGeneric,
  mutationGeneric,
  actionGeneric,
  anyApi,
} from "convex/server";
import { convexTest } from "convex-test";
import { assertType, describe, expect, expectTypeOf, test } from "vitest";
import { modules } from "./setup.test.js";
import {
  zCustomQuery,
  zCustomMutation,
  zCustomAction,
  zid,
  convexToZod,
  convexToZodFields,
} from "./zod4.js";
import { z } from "zod/v4";
import { v } from "convex/values";
import { NoOp } from "./customFunctions.js";

const schema = defineSchema({
  users: defineTable({
    name: v.string(),
  }),
});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

const zQuery = zCustomQuery(query, {
  args: {},
  input: async () => ({ ctx: {}, args: {} }),
});

const zMutation = zCustomMutation(mutation, {
  args: {},
  input: async () => ({ ctx: {}, args: {} }),
});

const zAction = zCustomAction(action, {
  args: {},
  input: async () => ({ ctx: {}, args: {} }),
});

/**
 * Test zCustomQuery with Zod schemas for args and return value
 */
export const testQuery = zQuery({
  args: {
    name: z.string(),
    age: z.number(),
  },
  handler: async (_ctx, args) => {
    assertType<{ name: string; age: number }>(args);
    return {
      message: `Hello ${args.name}, you are ${args.age} years old`,
      doubledAge: args.age * 2,
    };
  },
  returns: z.object({
    message: z.string(),
    doubledAge: z.number(),
  }),
});

export const testQueryNoArgs = zQuery({
  args: {},
  handler: async (_ctx, args) => {
    assertType<Record<string, never>>(args);
  },
});

/**
 * Test zCustomMutation with Zod schemas for args and return value
 */
export const testMutation = zMutation({
  args: {
    userId: z.string(),
    score: z.number().min(0).max(100),
  },
  handler: async (ctx, args) => {
    assertType<{ userId: string; score: number }>(args);
    const id = await ctx.db.insert("users", {
      name: `User ${args.userId}`,
    });
    return {
      id,
      userId: args.userId,
      score: args.score,
      passed: args.score >= 50,
    };
  },
  returns: z.object({
    id: z.string(),
    userId: z.string(),
    score: z.number(),
    passed: z.boolean(),
  }),
});

/**
 * Test converted Convex validators used inline as args. With zod >= 4.6.6,
 * inferring the converted type from the expected args type was too deep
 * to typecheck (TS2589).
 */
const vResult = v.union(
  v.object({ kind: v.literal("success"), returnValue: v.any() }),
  v.object({ kind: v.literal("failed"), error: v.string() }),
  v.object({ kind: v.literal("canceled") }),
);

export const testMutationConvexToZodArgs = zMutation({
  args: {
    result: convexToZod(vResult),
    value: convexToZod(v.any()),
  },
  handler: async (_ctx, args) => {
    expectTypeOf(args.result.kind).toEqualTypeOf<
      "success" | "failed" | "canceled"
    >();
    expectTypeOf(args.value).toEqualTypeOf<any>();
    return null;
  },
  returns: z.null(),
});

export const testMutationConvexToZodFieldsArgs = zMutation({
  args: convexToZodFields({ result: vResult, value: v.any() }),
  handler: async (_ctx, args) => {
    expectTypeOf(args.result.kind).toEqualTypeOf<
      "success" | "failed" | "canceled"
    >();
    expectTypeOf(args.value).toEqualTypeOf<any>();
    return null;
  },
  returns: z.null(),
});

/**
 * Test zCustomAction with Zod schemas for args and return value
 */
export const testAction = zAction({
  args: {
    input: z.string(),
    multiplier: z.number().int().positive(),
  },
  handler: async (_ctx, args) => {
    assertType<{ input: string; multiplier: number }>(args);
    return {
      result: args.input.repeat(args.multiplier),
      length: args.input.length * args.multiplier,
    };
  },
  returns: z.object({
    result: z.string(),
    length: z.number(),
  }),
});

export const returnsNothing = zQuery({
  handler: async () => {},
  returns: z.null(),
});

/**
 * Test transform in query args and return value
 */
export const transform = zQuery({
  args: {
    // Transform number to string in args
    count: z.number().transform((n) => n.toString()),
    items: z.array(z.string().transform((s) => s.toUpperCase())),
  },
  handler: async (_ctx, args) => {
    // Type should be the output of the transform
    assertType<{ count: string; items: string[] }>(args);
    // Verify the transform worked
    expect(typeof args.count).toBe("string");
    expect(args.items.every((item) => item === item.toUpperCase())).toBe(true);

    const total = parseInt(args.count, 10) * args.items.length;
    return {
      total,
      // Transform number to string in return value
      totalAsString: total.toString(),
      items: args.items,
    };
  },
  returns: z.object({
    total: z.number(),
    totalAsString: z.string().transform((s) => parseInt(s, 10)),
    items: z.array(z.string()),
  }),
});

export const transformAsync = zQuery({
  args: {
    count: z.number().transform(async (n) => n.toString()),
    items: z.array(z.string().transform(async (s) => s.toUpperCase())),
  },
  handler: async (_ctx, args) => {
    // Type should be the output of the transform
    assertType<{ count: string; items: string[] }>(args);
    // Verify the transform worked
    expect(typeof args.count).toBe("string");
    expect(args.items.every((item) => item === item.toUpperCase())).toBe(true);

    const total = parseInt(args.count, 10) * args.items.length;
    return {
      total,
    };
  },
  returns: z.object({
    total: z.number().transform(async (s) => s.toString()),
  }),
});

export const testQueryWithSkipConvexValidation = zQuery({
  args: {
    name: z.string(),
    age: z.number(),
    returnBadData: z.boolean().default(false),
  },
  handler: async (_ctx, args) => {
    assertType<{ name: string; age: number }>(args);
    const { name, age, returnBadData, ...rest } = args;
    if (Object.keys(rest).length > 0) {
      throw new Error("extraArg should be dropped");
    }
    if (returnBadData) {
      return {
        message: "bad data",
        doubledAge: 0n as any,
      };
    }
    return {
      message: `Hello ${name}, you are ${age} years old`,
      doubledAge: age * 2,
      extraArg: "extraArg",
    };
  },
  returns: z.object({
    message: z.string(),
    doubledAge: z.number(),
  }),
  skipConvexValidation: true,
});

/**
 * Test codec in query args and return value
 */
export const codec = zQuery({
  args: {
    // Codec: string input -> number output
    encodedNumber: z.codec(z.string(), z.number(), {
      decode: (s: string) => parseInt(s, 10),
      encode: (n: number) => n.toString(),
    }),
    // Codec: number input -> string output
    encodedString: z.codec(z.number(), z.string(), {
      decode: (n: number) => n.toString(),
      encode: (s: string) => parseInt(s, 10),
    }),
  },
  handler: async (_ctx, args) => {
    // Type should be the output type of the codec
    assertType<{ encodedNumber: number; encodedString: string }>(args);
    expect(typeof args.encodedNumber).toBe("number");
    expect(typeof args.encodedString).toBe("string");

    const sum = args.encodedNumber + parseInt(args.encodedString, 10);
    return {
      sum,
      // Codec in return: handler returns number, client receives string
      sumAsString: sum,
    };
  },
  returns: z.object({
    sum: z.number(),
    // Codec: handler returns number, client receives string
    sumAsString: z.codec(z.number(), z.string(), {
      decode: (n: number) => n.toString(),
      encode: (s: string) => parseInt(s, 10),
    }),
  }),
});

// The example from README.md
const zodQuery = zCustomQuery(query, NoOp);
export const myComplexQuery = zodQuery({
  args: {
    userId: zid("users"),
    email: z.email(),
    num: z.number().min(0),
    nullableBigint: z.nullable(z.bigint()),
    boolWithDefault: z.boolean().default(true),
    null: z.null(),
    array: z.array(z.string()),
    optionalObject: z.object({ a: z.string(), b: z.number() }).optional(),
    union: z.union([z.string(), z.number()]),
    discriminatedUnion: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("a"), a: z.string() }),
      z.object({ kind: z.literal("b"), b: z.number() }),
    ]),
    literal: z.literal("hi"),
    enum: z.enum(["a", "b"]),
    readonly: z.object({ a: z.string(), b: z.number() }).readonly(),
    pipeline: z.number().pipe(z.coerce.string()),
  },
  handler: async (_ctx, args) => {
    //... args at this point has been validated and has the types of what
    // zod parses the values into.
    // e.g. boolWithDefault is `bool` but has an input type `bool | undefined`.

    return args;
  },
});
export const generateUserId = mutation({
  args: {},
  handler: async ({ db }) => {
    return db.insert("users", { name: "Nicolas" });
  },
});

const testApi: ApiFromModules<{
  fns: {
    testQuery: typeof testQuery;
    testQueryNoArgs: typeof testQueryNoArgs;
    testMutation: typeof testMutation;
    testAction: typeof testAction;
    testQueryWithSkipConvexValidation: typeof testQueryWithSkipConvexValidation;
    returnsNothing: typeof returnsNothing;
    transform: typeof transform;
    transformAsync: typeof transformAsync;
    codec: typeof codec;
    myComplexQuery: typeof myComplexQuery;
    generateUserId: typeof generateUserId;
  };
}>["fns"] = anyApi["zod4.functions.test"] as any;

describe("zCustomQuery, zCustomMutation, zCustomAction", () => {
  describe("simple function calls", () => {
    test("zCustomQuery", async () => {
      const t = convexTest(schema, modules);
      const response = await t.query(testApi.testQuery, {
        name: "Alice",
        age: 30,
      });
      expect(response).toMatchObject({
        message: "Hello Alice, you are 30 years old",
        doubledAge: 60,
      });
      expectTypeOf(testApi.testQuery).toExtend<
        FunctionReference<
          "query",
          "public",
          { name: string; age: number },
          { message: string; doubledAge: number }
        >
      >();
    });

    describe("zCustomQuery with no args", () => {
      test("through t.query", async () => {
        const t = convexTest(schema, modules);
        const response = await t.query(testApi.testQueryNoArgs);
        expect(response).toBeNull();
      });

      test("through t.run", async () => {
        const t = convexTest(schema, modules);
        const response = await t.run((ctx) =>
          ctx.runQuery(testApi.testQueryNoArgs),
        );
        expect(response).toBeNull();
      });
    });

    test("zCustomMutation", async () => {
      const t = convexTest(schema, modules);
      const response = await t.mutation(testApi.testMutation, {
        userId: "user123",
        score: 75,
      });
      expect(response).toMatchObject({
        userId: "user123",
        score: 75,
        passed: true,
      });
      expect(response.id).toBeDefined();
      expectTypeOf(testApi.testMutation).toExtend<
        FunctionReference<
          "mutation",
          "public",
          { userId: string; score: number },
          { id: string; userId: string; score: number; passed: boolean }
        >
      >();
    });

    test("zCustomAction", async () => {
      const t = convexTest(schema, modules);
      const response = await t.action(testApi.testAction, {
        input: "test",
        multiplier: 3,
      });
      expect(response).toMatchObject({
        result: "testtesttest",
        length: 12,
      });
      expectTypeOf(testApi.testAction).toExtend<
        FunctionReference<
          "action",
          "public",
          { input: string; multiplier: number },
          { result: string; length: number }
        >
      >();
    });

    test("function that returns nothing has a return value of null", async () => {
      // `undefined` is not a valid Convex value, so functions returning `undefined` actually return `null`.
      const t = convexTest(schema, modules);
      const response = await t.query(testApi.returnsNothing, {});
      expect(response).toEqual(null);
      expectTypeOf(response).toExtend<null>();
    });

    test("README example", async () => {
      const t = convexTest(schema, modules);
      const userId = await t.mutation(testApi.generateUserId);
      const response = await t.query(testApi.myComplexQuery, {
        userId,
        email: "test@example.com",
        num: 42,
        nullableBigint: 123n,
        null: null,
        array: ["foo", "bar"],
        optionalObject: { a: "test", b: 1 },
        union: "hello",
        discriminatedUnion: { kind: "a", a: "value" },
        literal: "hi",
        enum: "a",
        readonly: { a: "readonly", b: 2 },
        pipeline: 100,
      });
      expect(response).toMatchObject({
        userId,
        email: "test@example.com",
        num: 42,
        nullableBigint: 123n,
        boolWithDefault: true,
        null: null,
        array: ["foo", "bar"],
        optionalObject: { a: "test", b: 1 },
        union: "hello",
        discriminatedUnion: { kind: "a", a: "value" },
        literal: "hi",
        enum: "a",
        readonly: { a: "readonly", b: 2 },
        pipeline: "100",
      });
    });
  });

  describe("skipConvexValidation", () => {
    test("zCustomQuery with skipConvexValidation", async () => {
      const t = convexTest(schema, modules);
      const args = {
        name: "Alice",
        age: 30,
        // Should get dropped
        extraArg: "extraArg",
      };
      const response = await t.query(
        testApi.testQueryWithSkipConvexValidation,
        args,
      );
      expect(response).toMatchObject({
        message: "Hello Alice, you are 30 years old",
        doubledAge: 60,
      });
    });
    test("throwing ConvexError on zod arg validation", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.query(testApi.testQueryWithSkipConvexValidation, {
          name: 123,
        } as any),
      ).rejects.toThrowError(
        expect.objectContaining({
          data: {
            ZodError: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_type",
                expected: "string",
                path: ["name"],
              }),
            ]),
          },
        }),
      );
    });
  });
  describe("transform", () => {
    test("calling a function with synchronous transforms in arguments and return values", async () => {
      const t = convexTest(schema, modules);
      const response = await t.query(testApi.transform, {
        count: 5,
        items: ["hello", "world"],
      });

      // Verify the transform in args worked
      expect(response.total).toBe(10); // 5 * 2 items
      expect(response.items).toEqual(["HELLO", "WORLD"]);

      // Verify the transform in return value worked
      // The return type says totalAsString is a number (after transform)
      expect(response.totalAsString).toBe(10);

      expectTypeOf(testApi.transform).toExtend<
        FunctionReference<
          "query",
          "public",
          { count: number; items: string[] },
          { total: number; totalAsString: number; items: string[] }
        >
      >();
    });

    test("calling a function with asynchronous transforms in arguments and return values", async () => {
      const t = convexTest(schema, modules);
      const response = await t.query(testApi.transformAsync, {
        count: 5,
        items: ["hello", "world"],
      });

      expect(response.total).toBe("10");

      expectTypeOf(testApi.transformAsync).toExtend<
        FunctionReference<
          "query",
          "public",
          { count: number; items: string[] },
          { total: string }
        >
      >();
    });
  });

  describe("codec", () => {
    test("calling a function with codecs in arguments and return values", async () => {
      const t = convexTest(schema, modules);
      const response = await t.query(testApi.codec, {
        encodedNumber: "10", // string input, decoded to number
        encodedString: 5, // number input, decoded to string
      });

      // Verify the codec in args worked
      expect(response.sum).toBe(15); // 10 + 5

      // Verify the codec in return value worked
      // sumAsString is encoded as string (client receives string)
      expect(response.sumAsString).toBe("15");

      expectTypeOf(testApi.codec).toExtend<
        FunctionReference<
          "query",
          "public",
          { encodedNumber: string; encodedString: number },
          { sum: number; sumAsString: string }
        >
      >();
    });

    test("calling a function with wrong argument types throws ConvexError", async () => {
      const t = convexTest(schema, modules);

      // Test with values that pass Convex validation but fail Zod validation
      await expect(
        t.query(testApi.codec, {
          encodedNumber: "not-a-number", // passes Convex (string) but fails Zod decode
          encodedString: 5, // passes Convex (number) but will be decoded to string "5" which is fine
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          data: {
            ZodError: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_type",
                expected: "number",
                path: ["encodedNumber"],
              }),
            ]),
          },
        }),
      );
    });

    test("it rejects incorrect argument types at compile and runtime", async () => {
      const t = convexTest(schema, modules);

      await expect(
        t.query(testApi.codec, {
          // @ts-expect-error - encodedNumber expects string but got number
          encodedNumber: 10,
          encodedString: 5,
        }),
      ).rejects.toThrowError();

      await expect(
        t.query(testApi.codec, {
          encodedNumber: "10",
          // @ts-expect-error - encodedString expects number but got string
          encodedString: "5",
        }),
      ).rejects.toThrowError();

      await expect(
        t.query(
          testApi.codec,
          // @ts-expect-error - missing required argument encodedNumber
          {
            encodedString: 5,
          },
        ),
      ).rejects.toThrowError();

      await expect(
        t.query(
          testApi.codec,
          // @ts-expect-error - missing required argument encodedString
          {
            encodedNumber: "10",
          },
        ),
      ).rejects.toThrowError();
    });
  });
});

const zQueryCustom = zCustomQuery(query, {
  args: {
    requiredArg: v.string(),
    optionalArg: v.optional(v.number()),
    consumedArg: v.string(),
    overridenArg: v.null(),
  },
  input: async (ctx, args) => ({
    ctx: {
      ...ctx,
      storage: undefined,
      auth: undefined,
      db: "custom db!" as const,
      runQuery: undefined,
      runSnapshotQuery: undefined,
      meta: undefined,
      ...args,
    },
    args: {
      extraArg: "extraArg" as const,
      requiredArg: args.requiredArg,
      optionalArg: args.optionalArg,
      overridenArg: true,
    },
  }),
});

export const testQueryCustom = zQueryCustom({
  args: {
    specificArg: z.string(),
    // Promote optionalArg to required
    optionalArg: z.number(),
    // Try to demote requiredArg to optional (internally it will stay required)
    requiredArg: z.optional(z.string()),
  },
  handler: async (ctx, args) => {
    assertType<{
      specificArg: string;
      optionalArg: number;
      requiredArg: string;
      extraArg: "extraArg";
      overridenArg: boolean;
    }>(args);
    assertType<{
      requiredArg: string;
      optionalArg?: number;
      consumedArg: string;
      overridenArg: null;
      db: "custom db!";
    }>(ctx);
    return { ctx, args };
  },
});
const testApiCustom: ApiFromModules<{
  fns: {
    testQueryCustom: typeof testQueryCustom;
  };
}>["fns"] = anyApi["zod4.functions.test"] as any;

describe("zCustomQuery customizations", () => {
  test("it can override args and ctx", async () => {
    const t = convexTest(schema, modules);
    const args = {
      overridenArg: null,
      requiredArg: "requiredArg",
      optionalArg: 1,
      consumedArg: "consumedArg",
    };
    const response = await t.query(testApiCustom.testQueryCustom, {
      ...args,
      specificArg: "specificArg",
    });
    expect(response).toMatchObject({
      ctx: {
        db: "custom db!",
        ...args,
      },
      args: {
        specificArg: "specificArg",
        optionalArg: 1,
        requiredArg: "requiredArg",
        extraArg: "extraArg",
        overridenArg: true,
      },
    });
  });
});
