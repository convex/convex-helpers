// Tests that need Zod 4.1 or newer: `z.codec` and `z.function()` as a schema
// were added in Zod 4.1. They are in their own file so that older Zod versions
// can skip it (see `zodTestFileMinMinor` in scripts/zodVersions.mjs).
import * as z from "zod/v4";
import { describe, expect, expectTypeOf, test } from "vitest";
import { v, VString } from "convex/values";
import { zodToConvex } from "./zod4";
import {
  assertUnrepresentableType,
  testZodOutputToConvex,
  testZodToConvex,
} from "../test/zodToConvex";

describe("zodToConvex + zodOutputToConvex", () => {
  describe("unencodable types", () => {
    test("z.function", () => {
      assertUnrepresentableType(z.function());
    });
  });
});

describe("zodToConvex", () => {
  test("codec", () => {
    testZodToConvex(
      z.codec(z.string(), z.number(), {
        decode: (s: string) => parseInt(s, 10),
        encode: (n: number) => n.toString(),
      }),
      v.string(), // input type
    );
  });
});

describe("zodOutputToConvex", () => {
  describe("codec", () => {
    test("simple case", () => {
      testZodOutputToConvex(
        z.codec(z.string(), z.number(), {
          decode: (s: string) => parseInt(s, 10),
          encode: (n: number) => n.toString(),
        }),
        v.number(), // output type
      );
    });

    describe("with optional/nullable", () => {
      // Codec that transforms Date to milliseconds (number)
      const dateToMsCodec = z.codec(z.date(), z.int().min(0), {
        encode: (millis: number) => new Date(millis),
        decode: (date: Date) => date.getTime(),
      });

      test("optional codec returns VOptional<VFloat64>", () => {
        testZodOutputToConvex(dateToMsCodec.optional(), v.optional(v.number()));
      });

      test("nullable codec returns VUnion with null", () => {
        testZodOutputToConvex(
          dateToMsCodec.nullable(),
          v.union(v.number(), v.null()),
        );
      });

      test("optional nullable codec", () => {
        testZodOutputToConvex(
          dateToMsCodec.nullable().optional(),
          v.optional(v.union(v.number(), v.null())),
        );
      });

      test("nullable optional codec (swapped order)", () => {
        testZodOutputToConvex(
          dateToMsCodec.optional().nullable(),
          v.optional(v.union(v.number(), v.null())),
        );
      });

      // String to number codec
      const stringToNumberCodec = z.codec(z.string(), z.number(), {
        decode: (s: string) => parseFloat(s),
        encode: (n: number) => n.toString(),
      });

      test("optional string-to-number codec", () => {
        testZodOutputToConvex(
          stringToNumberCodec.optional(),
          v.optional(v.number()),
        );
      });

      test("codec with default", () => {
        testZodOutputToConvex(
          dateToMsCodec.default(Date.now()),
          v.number(), // default means output is always present
        );
      });
    });
  });
});

describe("codec or pipe nested in another schema", () => {
  // A nested schema is converted from the same side as the schema containing
  // it: the codec’s input (a string) in zodToConvex, and its output (a number)
  // in zodOutputToConvex.
  const stringToNumberCodec = z.codec(z.string(), z.number(), {
    decode: (s: string) => parseFloat(s),
    encode: (n: number) => n.toString(),
  });

  test("object field", () => {
    const schema = z.object({ n: stringToNumberCodec });
    testZodOutputToConvex(schema, v.object({ n: v.number() }));

    // The object type of zodToConvex comes from z.infer, so only the field is compared
    const inputValidator = zodToConvex(schema);
    expectTypeOf(inputValidator.fields.n).toEqualTypeOf<VString>();
    expect(inputValidator).toEqual(v.object({ n: v.string() }));
  });

  test("optional object field", () => {
    testZodOutputToConvex(
      z.object({ n: stringToNumberCodec.optional() }),
      v.object({ n: v.optional(v.number()) }),
    );
  });

  test("object field with a default", () => {
    testZodOutputToConvex(
      z.object({ n: stringToNumberCodec.default(0) }),
      v.object({ n: v.number() }), // default means output is always present
    );
  });

  test("array element", () => {
    testZodToConvex(z.array(stringToNumberCodec), v.array(v.string()));
    testZodOutputToConvex(z.array(stringToNumberCodec), v.array(v.number()));
  });

  test("nullable array element", () => {
    testZodToConvex(
      z.array(stringToNumberCodec.nullable()),
      v.array(v.union(v.string(), v.null())),
    );
    testZodOutputToConvex(
      z.array(stringToNumberCodec.nullable()),
      v.array(v.union(v.number(), v.null())),
    );
  });

  test("object in an array", () => {
    testZodOutputToConvex(
      z.array(z.object({ n: stringToNumberCodec })),
      v.array(v.object({ n: v.number() })),
    );
  });

  test("pipe from a transform, in an array", () => {
    const schema = z.array(
      z.pipe(
        z.transform((value: unknown) => value),
        z.object({ n: z.number() }),
      ),
    );
    testZodToConvex(schema, v.array(v.any())); // the input is a transform
    testZodOutputToConvex(schema, v.array(v.object({ n: v.number() })));
  });

  test("union member", () => {
    testZodToConvex(
      z.union([stringToNumberCodec, z.null()]),
      v.union(v.string(), v.null()),
    );
    testZodOutputToConvex(
      z.union([stringToNumberCodec, z.null()]),
      v.union(v.number(), v.null()),
    );
  });

  test("tuple item", () => {
    testZodToConvex(
      z.tuple([stringToNumberCodec]),
      v.array(v.union(v.string())),
    );
    testZodOutputToConvex(
      z.tuple([stringToNumberCodec]),
      v.array(v.union(v.number())),
    );
  });

  test("record value", () => {
    const schema = z.record(z.string(), stringToNumberCodec);
    testZodOutputToConvex(schema, v.record(v.string(), v.number()));

    // The record type of zodToConvex comes from z.infer, so only the value is compared
    const inputValidator = zodToConvex(schema);
    expectTypeOf(inputValidator.value).toEqualTypeOf<VString>();
    expect(inputValidator).toEqual(v.record(v.string(), v.string()));
  });

  test("record value, key = literal", () => {
    testZodToConvex(
      z.record(z.literal(["a", "b"]), stringToNumberCodec),
      v.object({ a: v.string(), b: v.string() }),
    );
    testZodOutputToConvex(
      z.record(z.literal(["a", "b"]), stringToNumberCodec),
      v.object({ a: v.number(), b: v.number() }),
    );
  });

  test("readonly", () => {
    testZodToConvex(stringToNumberCodec.readonly(), v.string());
    testZodOutputToConvex(stringToNumberCodec.readonly(), v.number());
  });

  test("lazy", () => {
    testZodToConvex(
      z.lazy(() => stringToNumberCodec),
      v.string(),
    );
    testZodOutputToConvex(
      z.lazy(() => stringToNumberCodec),
      v.number(),
    );
  });

  test("catch", () => {
    testZodToConvex(stringToNumberCodec.catch(0), v.string());
    testZodOutputToConvex(stringToNumberCodec.catch(0), v.number());
  });

  test("non-optional", () => {
    testZodToConvex(stringToNumberCodec.optional().nonoptional(), v.string());
    testZodOutputToConvex(
      stringToNumberCodec.optional().nonoptional(),
      v.number(),
    );
  });
});
