// Tests that need Zod 4.1 or newer: `z.codec` was added in Zod 4.1. They are
// in their own file so that older Zod versions can skip it (see
// `zodTestFileMinMinor` in scripts/zodVersions.mjs).
import type {
  DataModelFromSchemaDefinition,
  QueryBuilder,
  ApiFromModules,
  FunctionReference,
} from "convex/server";
import { defineTable, defineSchema, queryGeneric, anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { assertType, describe, expect, expectTypeOf, test } from "vitest";
import { modules } from "./setup.test.js";
import { zCustomQuery } from "./zod4.js";
import { z } from "zod/v4";
import { v } from "convex/values";

const schema = defineSchema({
  users: defineTable({
    name: v.string(),
  }),
});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;

const zQuery = zCustomQuery(query, {
  args: {},
  input: async () => ({ ctx: {}, args: {} }),
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

const testApi: ApiFromModules<{
  fns: {
    codec: typeof codec;
  };
}>["fns"] = anyApi["zod4.functions.zod41.test"] as any;

describe("zCustomQuery, zCustomMutation, zCustomAction", () => {
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
