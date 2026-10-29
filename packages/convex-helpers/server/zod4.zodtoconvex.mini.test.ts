import * as zCore from "zod/v4/core";
import * as z from "zod/v4/mini";
import { describe, expect, expectTypeOf, test } from "vitest";
import {
  GenericValidator,
  v,
  VAny,
  VFloat64,
  VLiteral,
  VNull,
  VObject,
  VOptional,
  VString,
  VUnion,
} from "convex/values";
import {
  zodToConvex,
  zid,
  zodToConvexFields,
  zodOutputToConvexFields,
} from "./zod4";
import type { Equals } from "../index.js";
import {
  assert,
  assertUnrepresentableType,
  ignoreUnionOrder,
  testZodOutputToConvex,
  testZodToConvex,
  testZodToConvexInputAndOutput,
} from "./zod4.zodtoconvex.test";

describe("zodToConvex + zodOutputToConvex", () => {
  test("id", () => {
    testZodToConvexInputAndOutput(zid("users"), v.id("users"));
  });
  test("string", () => testZodToConvexInputAndOutput(z.string(), v.string()));
  test("string formatters", () =>
    testZodToConvexInputAndOutput(z.email(), v.string()));
  test("number", () => testZodToConvexInputAndOutput(z.number(), v.number()));
  test("float64", () => testZodToConvexInputAndOutput(z.float64(), v.number()));
  test("nan", () => testZodToConvexInputAndOutput(z.nan(), v.number()));
  test("int64", () => testZodToConvexInputAndOutput(z.int64(), v.int64()));
  test("bigint", () => testZodToConvexInputAndOutput(z.bigint(), v.int64()));
  test("boolean", () =>
    testZodToConvexInputAndOutput(z.boolean(), v.boolean()));
  test("null", () => testZodToConvexInputAndOutput(z.null(), v.null()));
  test("any", () => testZodToConvexInputAndOutput(z.any(), v.any()));

  describe("literal", () => {
    test("string", () => {
      testZodToConvexInputAndOutput(z.literal("hey"), v.literal("hey"));
    });
    test("number", () => {
      testZodToConvexInputAndOutput(z.literal(42), v.literal(42));
    });
    test("int64", () => {
      testZodToConvexInputAndOutput(z.literal(42n), v.literal(42n));
    });
    test("boolean", () => {
      testZodToConvexInputAndOutput(z.literal(true), v.literal(true));
    });
    test("null", () => {
      testZodToConvexInputAndOutput(z.literal(null), v.null()); // !
    });

    test("multiple values, same type", () => {
      testZodToConvexInputAndOutput(
        z.literal([1, 2, 3]),
        ignoreUnionOrder(v.union(v.literal(1), v.literal(2), v.literal(3))),
      );
    });
    test("multiple values, different tyeps", () => {
      testZodToConvexInputAndOutput(
        z.literal([123, "xyz", null]),
        ignoreUnionOrder(v.union(v.literal(123), v.literal("xyz"), v.null())),
      );
    });
    test("union of literals", () => {
      testZodToConvexInputAndOutput(
        z.union([z.literal([1, 2]), z.literal([3, 4])]),
        v.union(
          ignoreUnionOrder(v.union(v.literal(1), v.literal(2))),
          ignoreUnionOrder(v.union(v.literal(3), v.literal(4))),
        ),
      );
    });
  });

  describe("optional", () => {
    test("z.optional()", () => {
      testZodToConvexInputAndOutput(
        z.optional(z.string()),
        v.optional(v.string()),
      );
    });
    test("z.XYZ.optional()", () => {
      testZodToConvexInputAndOutput(
        z.optional(z.string()),
        v.optional(v.string()),
      );
    });
    test("optional doesn’t propagate to array elements", () => {
      testZodToConvexInputAndOutput(
        z.optional(z.array(z.number())),
        v.optional(v.array(v.number())), // and not v.optional(v.array(v.optional(v.number())))
      );
    });
  });

  test("array", () => {
    testZodToConvexInputAndOutput(z.array(z.string()), v.array(v.string()));
  });

  describe("union", () => {
    test("never", () => {
      testZodToConvexInputAndOutput(z.never(), v.union());
    });
    test("one element (number)", () => {
      testZodToConvexInputAndOutput(z.union([z.number()]), v.union(v.number()));
    });
    test("one element (string)", () => {
      testZodToConvexInputAndOutput(z.union([z.string()]), v.union(v.string()));
    });
    test("multiple elements", () => [
      testZodToConvexInputAndOutput(
        z.union([z.string(), z.number()]),
        v.union(v.string(), v.number()),
      ),
    ]);
  });

  describe("brand", () => {
    test("string", () => {
      testZodToConvexInputAndOutput(
        z.string().brand("myBrand"),
        v.string() as VString<string & zCore.$brand<"myBrand">>,
      );
    });
    test("number", () => {
      testZodToConvexInputAndOutput(
        z.number().brand("myBrand"),
        v.number() as VFloat64<number & zCore.$brand<"myBrand">>,
      );
    });
    test("object", () => {
      testZodToConvexInputAndOutput(
        z.object({ name: z.string() }).brand("myBrand"),
        v.object({ name: v.string() }) as VObject<
          {
            name: string;
          } & zCore.$brand<"myBrand">,
          {
            name: VString<string, "required">;
          },
          "required",
          "name"
        >,
      );
    });
  });

  test("object", () => {
    testZodToConvexInputAndOutput(
      z.object({
        name: z.string(),
        age: z.number(),
        picture: z.optional(z.string()),
      }),

      // v.object() is a strict object, not a loose object,
      // but we still convert z.object() to it for convenience
      v.object({
        name: v.string(),
        age: v.number(),
        picture: v.optional(v.string()),
      }),
    );
  });

  test("strict object", () => {
    testZodToConvexInputAndOutput(
      z.strictObject({
        name: z.string(),
        age: z.number(),
        picture: z.optional(z.string()),
      }),
      v.object({
        name: v.string(),
        age: v.number(),
        picture: v.optional(v.string()),
      }),
    );
  });

  describe("record", () => {
    test("key = string", () => {
      testZodToConvexInputAndOutput(
        z.record(z.string(), z.number()),
        v.record(v.string(), v.number()),
      );
    });

    test("key = string, optional", () => {
      testZodToConvexInputAndOutput(
        z.record(z.string(), z.optional(z.number())),
        v.record(v.string(), v.number()),
      );
    });

    test("key = any", () => {
      testZodToConvexInputAndOutput(
        z.record(z.any(), z.number()),
        // v.record(v.any(), …) is not allowed in Convex validators
        v.record(v.string(), v.number()),
      );
    });

    test("key = any, optional", () => {
      testZodToConvexInputAndOutput(
        z.record(z.any(), z.optional(z.number())),
        // v.record(v.any(), …) is not allowed in Convex validators
        v.record(v.string(), v.number()),
      );
    });

    test("key = literal", () => {
      testZodToConvexInputAndOutput(
        z.record(z.literal("user"), z.number()),
        // Convex records can’t have string literals as keys
        v.object({
          user: v.number(),
        }),
      );
    });

    test("key = literal, optional", () => {
      testZodToConvexInputAndOutput(
        z.record(z.literal("user"), z.optional(z.number())),
        // Convex records can’t have string literals as keys
        v.object({
          user: v.optional(v.number()),
        }),
      );
    });

    test("key = literal with multiple values", () => {
      testZodToConvexInputAndOutput(
        z.record(z.literal(["user", "admin"]), z.number()),
        v.object({
          user: v.number(),
          admin: v.number(),
        }),
      );
    });

    test("key = literal with multiple values, optional", () => {
      testZodToConvexInputAndOutput(
        z.record(z.literal(["user", "admin"]), z.optional(z.number())),
        v.object({
          user: v.optional(v.number()),
          admin: v.optional(v.number()),
        }),
      );
    });

    test("key = union of literals", () => {
      testZodToConvexInputAndOutput(
        z.record(z.union([z.literal("user"), z.literal("admin")]), z.number()),
        v.object({
          user: v.number(),
          admin: v.number(),
        }),
      );
    });

    test("key = union of literals, optional", () => {
      testZodToConvexInputAndOutput(
        z.record(
          z.union([z.literal("user"), z.literal("admin")]),
          z.optional(z.number()),
        ),
        v.object({
          user: v.optional(v.number()),
          admin: v.optional(v.number()),
        }),
      );
    });

    test("key = union of literals with multiple values", () => {
      testZodToConvexInputAndOutput(
        z.record(
          z.union([z.literal(["one", "two"]), z.literal(["three", "four"])]),
          z.number(),
        ),
        v.object({
          one: v.number(),
          two: v.number(),
          three: v.number(),
          four: v.number(),
        }),
      );
    });

    test("key = union of literals with multiple values, optional", () => {
      testZodToConvexInputAndOutput(
        z.record(
          z.union([z.literal(["one", "two"]), z.literal(["three", "four"])]),
          z.optional(z.number()),
        ),
        v.object({
          one: v.optional(v.number()),
          two: v.optional(v.number()),
          three: v.optional(v.number()),
          four: v.optional(v.number()),
        }),
      );
    });

    test("key = v.id()", () => {
      {
        testZodToConvexInputAndOutput(
          z.record(zid("documents"), z.number()),
          v.record(v.id("documents"), v.number()),
        );
      }
    });

    test("key = v.id(), optional", () => {
      {
        testZodToConvexInputAndOutput(
          z.record(zid("documents"), z.optional(z.number())),
          v.record(v.id("documents"), v.number()),
        );
      }
    });

    test("key = union of ids", () => {
      testZodToConvexInputAndOutput(
        z.record(z.union([zid("users"), zid("documents")]), z.number()),
        v.record(v.union(v.id("users"), v.id("documents")), v.number()),
      );
    });

    test("key = union of ids, optional", () => {
      testZodToConvexInputAndOutput(
        z.record(
          z.union([zid("users"), zid("documents")]),
          z.optional(z.number()),
        ),
        v.record(v.union(v.id("users"), v.id("documents")), v.number()),
      );
    });

    test("key = other", () => {
      testZodToConvexInputAndOutput(
        z.record(z.union([zid("users"), z.literal("none")]), z.number()),
        v.record(v.string(), v.number()),
      );
    });
  });

  describe("partial record", () => {
    test("key = any", () => {
      testZodToConvexInputAndOutput(
        z.partialRecord(z.any(), z.number()),
        // v.record(v.any(), …) is not allowed in Convex validators
        v.record(v.string(), v.number()),
      );
    });

    test("key = any, optional", () => {
      testZodToConvexInputAndOutput(
        z.partialRecord(z.any(), z.optional(z.number())),
        // v.record(v.any(), …) is not allowed in Convex validators
        v.record(v.string(), v.number()),
      );
    });

    test("key = string", () => {
      testZodToConvexInputAndOutput(
        z.partialRecord(z.string(), z.number()),
        v.record(v.string(), v.number()),
      );
    });

    test("key = string, optional", () => {
      testZodToConvexInputAndOutput(
        z.partialRecord(z.string(), z.optional(z.number())),
        v.record(v.string(), v.number()),
      );
    });

    test("key = literal", () => {
      testZodToConvexInputAndOutput(
        z.partialRecord(z.literal("user"), z.number()),
        // Convex records can’t have string literals as keys
        v.object({
          user: v.optional(v.number()),
        }),
      );
    });

    test("key = literal, optional", () => {
      testZodToConvexInputAndOutput(
        z.partialRecord(z.literal("user"), z.optional(z.number())),
        // Convex records can’t have string literals as keys
        v.object({
          user: v.optional(v.number()),
        }),
      );
    });

    test("key = union of literals", () => {
      testZodToConvexInputAndOutput(
        z.partialRecord(
          z.union([z.literal("user"), z.literal("admin")]),
          z.number(),
        ),
        v.object({
          user: v.optional(v.number()),
          admin: v.optional(v.number()),
        }),
      );
    });

    test("key = union of literals, optional", () => {
      testZodToConvexInputAndOutput(
        z.partialRecord(
          z.union([z.literal("user"), z.literal("admin")]),
          z.optional(z.number()),
        ),
        v.object({
          user: v.optional(v.number()),
          admin: v.optional(v.number()),
        }),
      );
    });

    test("key = v.id()", () => {
      {
        testZodToConvexInputAndOutput(
          z.partialRecord(zid("documents"), z.number()),
          v.record(v.id("documents"), v.number()),
        );
      }
    });

    test("key = v.id(), optional", () => {
      {
        testZodToConvexInputAndOutput(
          z.partialRecord(zid("documents"), z.optional(z.number())),
          v.record(v.id("documents"), v.number()),
        );
      }
    });

    test("key = union of ids", () => {
      testZodToConvexInputAndOutput(
        z.partialRecord(z.union([zid("users"), zid("documents")]), z.number()),
        v.record(v.union(v.id("users"), v.id("documents")), v.number()),
      );
    });

    test("key = union of ids, optional", () => {
      testZodToConvexInputAndOutput(
        z.partialRecord(
          z.union([zid("users"), zid("documents")]),
          z.optional(z.number()),
        ),
        v.record(v.union(v.id("users"), v.id("documents")), v.number()),
      );
    });

    test("key = other", () => {
      testZodToConvexInputAndOutput(
        z.record(z.union([zid("users"), z.literal("none")]), z.number()),
        v.record(v.string(), v.number()),
      );
    });
  });

  test("readonly", () => {
    testZodToConvexInputAndOutput(
      z.readonly(z.array(z.string())),
      v.array(v.string()),
    );
  });

  // Discriminated union
  test("discriminated union", () => {
    testZodToConvexInputAndOutput(
      z.discriminatedUnion("status", [
        z.object({ status: z.literal("success"), data: z.string() }),
        z.object({ status: z.literal("failed"), error: z.string() }),
      ]),
      v.union(
        v.object({ status: v.literal("success"), data: v.string() }),
        v.object({ status: v.literal("failed"), error: v.string() }),
      ),
    );
  });

  describe("enum", () => {
    test("const array", () => {
      testZodToConvexInputAndOutput(
        z.enum(["Salmon", "Tuna", "Trout"]),
        ignoreUnionOrder(
          v.union(v.literal("Salmon"), v.literal("Tuna"), v.literal("Trout")),
        ),
      );
    });

    test("const array with a number", () => {
      testZodToConvexInputAndOutput(
        z.enum(["2", "Salmon", "Tuna"]),
        ignoreUnionOrder(
          v.union(v.literal("2"), v.literal("Salmon"), v.literal("Tuna")),
        ),
      );
    });

    test("enum-like object literal", () => {
      const Fish = {
        Salmon: 0,
        Tuna: 1,
      } as const;
      testZodToConvexInputAndOutput(
        z.enum(Fish),
        ignoreUnionOrder(v.union(v.literal(0), v.literal(1))),
      );
    });

    test("TypeScript string enum", () => {
      enum Fish {
        Salmon = 0,
        Tuna = 1,
      }

      testZodToConvexInputAndOutput(
        z.enum(Fish),
        // Interestingly, TypeScript enums make Fish.Salmon be its own type,
        // even if its value is 0 at runtime.
        ignoreUnionOrder(v.union(v.literal(Fish.Salmon), v.literal(Fish.Tuna))),
      );
    });
  });

  // Tuple
  describe("tuple", () => {
    test("one-element tuple", () => {
      testZodToConvexInputAndOutput(
        z.tuple([z.string()]),
        v.array(v.union(v.string())), // suboptimal, we could remove the union
      );
    });
    test("fixed elements, same type", () => {
      testZodToConvexInputAndOutput(
        z.tuple([z.string(), z.string()]),
        v.array(v.union(v.string(), v.string())), // suboptimal, we could remove duplicates
      );
    });
    test("fixed elements", () => {
      testZodToConvexInputAndOutput(
        z.tuple([z.string(), z.number()]),
        v.array(v.union(v.string(), v.number())),
      );
    });
    test("variadic element, same type", () => {
      testZodToConvexInputAndOutput(
        z.tuple([z.string()], z.string()),
        v.array(v.union(v.string(), v.string())), // suboptimal, we could remove duplicates
      );
    });
    test("variadic element", () => {
      testZodToConvexInputAndOutput(
        z.tuple([z.string()], z.number()),
        v.array(v.union(v.string(), v.number())),
      );
    });
  });

  describe("nullable", () => {
    test("nullable(string)", () => {
      testZodToConvexInputAndOutput(
        z.nullable(z.string()),
        v.union(v.string(), v.null()),
      );
    });
    test("nullable(number)", () => {
      testZodToConvexInputAndOutput(
        z.nullable(z.number()),
        v.union(v.number(), v.null()),
      );
    });
    test("optional(nullable(string))", () => {
      testZodToConvexInputAndOutput(
        z.optional(z.nullable(z.string())),
        v.optional(v.union(v.string(), v.null())),
      );

      zodToConvex(z.optional(z.nullable(z.string()))) satisfies VUnion<
        string | null | undefined,
        [VString, VNull],
        "optional"
      >;
    });
    test("nullable(optional(string)) → swap nullable and optional", () => {
      testZodToConvexInputAndOutput(
        z.optional(z.nullable(z.string())),
        v.optional(v.union(v.string(), v.null())),
      );

      zodToConvex(z.optional(z.nullable(z.string()))) satisfies VUnion<
        string | null | undefined,
        [VString, VNull],
        "optional"
      >;
    });
  });

  test("optional", () => {
    testZodToConvexInputAndOutput(
      z.optional(z.string()),
      v.optional(v.string()),
    );
  });

  describe("non-optional", () => {
    test("id", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(zid("documents"))),
        v.id("documents"),
      );
    });
    test("string", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(z.string())),
        v.string(),
      );
    });
    test("float64", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(z.float64())),
        v.float64(),
      );
    });
    test("int64", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(z.int64())),
        v.int64(),
      );
    });
    test("boolean", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(z.boolean())),
        v.boolean(),
      );
    });
    test("null", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(z.null())),
        v.null(),
      );
    });
    test("any", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(z.any())),
        v.any(),
      );
    });
    test("literal", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(z.literal(42n))),
        v.literal(42n),
      );
    });
    test("object", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(
          z.optional(
            z.object({
              required: z.string(),
              optional: z.optional(z.number()),
            }),
          ),
        ),
        v.object({ required: v.string(), optional: v.optional(v.number()) }),
      );
    });
    test("array", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(z.array(z.int64()))),
        v.array(v.int64()),
      );
    });
    test("record", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(z.record(z.string(), z.number()))),
        v.record(v.string(), v.number()),
      );
    });
    test("union", () => {
      testZodToConvexInputAndOutput(
        z.nonoptional(z.optional(z.union([z.number(), z.string()]))),
        v.union(v.number(), v.string()),
      );
    });

    test("nonoptional on non-optional type", () => {
      testZodToConvexInputAndOutput(z.nonoptional(z.string()), v.string());
    });
  });

  test("lazy", () => {
    testZodToConvexInputAndOutput(
      z.lazy(() => z.string()),
      v.string(),
    );
  });

  test("custom", () => {
    testZodToConvexInputAndOutput(
      z.custom<string & { __myBrand: true }>(() => true),
      v.any(),
    );
  });

  test("recursive type", () => {
    // Cast through `as zCore.$ZodType` to keep the Type slot opaque: a
    // self-referential schema makes `ConvexValidatorFromZod` circularly
    // reference itself, a recoverable TS2615. Compile-time shape verification
    // is covered by the non-recursive tests; this only asserts the runtime
    // conversion produces the right validator.
    const category = z.object({
      name: z.string(),
      get subcategories() {
        return z.array(category);
      },
    });

    testZodToConvexInputAndOutput(
      category,
      // @ts-expect-error -- the TypeScript type is recursive, while the
      // runtime time uses `v.any()` since Convex validators can’t be recursive
      v.object({
        name: v.string(),
        subcategories: v.array(v.any()),
      }),
    );
  });

  test("catch", () => {
    testZodToConvexInputAndOutput(z.catch(z.string(), "hello"), v.string());
  });

  describe("template literals", () => {
    test("constant string", () => {
      testZodToConvexInputAndOutput(
        z.templateLiteral(["hi there"]),
        v.string() as VString<"hi there", "required">,
      );
    });
    test("string interpolation", () => {
      testZodToConvexInputAndOutput(
        z.templateLiteral(["email: ", z.string()]),
        v.string() as VString<`email: ${string}`, "required">,
      );
    });
    test("literal interpolation", () => {
      testZodToConvexInputAndOutput(
        z.templateLiteral(["high", z.literal(5)]),
        v.string() as VString<"high5", "required">,
      );
    });
    test("nullable interpolation", () => {
      testZodToConvexInputAndOutput(
        z.templateLiteral([z.nullable(z.literal("grassy"))]),
        v.string() as VString<"grassy" | "null", "required">,
      );
    });
    test("enum interpolation", () => {
      testZodToConvexInputAndOutput(
        z.templateLiteral([z.number(), z.enum(["px", "em", "rem"])]),
        v.string() as VString<`${number}${"px" | "em" | "rem"}`, "required">,
      );
    });
  });

  test("intersection", () => {
    // We could do some more advanced logic here where we compute
    // the Convex validator that results from the intersection.
    // For now, we simply use v.any()
    testZodToConvexInputAndOutput(
      z.intersection(
        z.object({ key1: z.string() }),
        z.object({ key2: z.string() }),
      ),
      v.any(),
    );
  });

  describe("unencodable types", () => {
    test("z.date", () => {
      assertUnrepresentableType(z.date());
    });
    test("z.symbol", () => {
      assertUnrepresentableType(z.symbol());
    });
    test("z.map", () => {
      assertUnrepresentableType(z.map(z.string(), z.string()));
    });
    test("z.set", () => {
      assertUnrepresentableType(z.set(z.string()));
    });
    test("z.promise", () => {
      assertUnrepresentableType(z.promise(z.string()));
    });
    test("z.file", () => {
      assertUnrepresentableType(z.file());
    });
    test("z.function", () => {
      assertUnrepresentableType(z.function());
    });
    test("z.void", () => {
      assertUnrepresentableType(z.void());
    });
    test("z.undefined", () => {
      assertUnrepresentableType(z.undefined());
    });
    test("z.literal(undefined)", () => {
      assertUnrepresentableType(z.literal(undefined));
    });
    test("z.literal including undefined", () => {
      assertUnrepresentableType(z.literal([123, undefined]));
    });
  });
});

describe("zodToConvex", () => {
  test("transform", () => {
    testZodOutputToConvex(
      z.transform((s: number) => s.toString()),
      v.any(), // input type unknown here
    );
  });

  test("pipe", () => {
    testZodToConvex(
      z.pipe(
        z.number(),
        z.transform((s) => s.toString()),
      ),
      v.number(), // input type
    );
  });

  test("codec", () => {
    testZodToConvex(
      z.codec(z.string(), z.number(), {
        decode: (s: string) => parseInt(s, 10),
        encode: (n: number) => n.toString(),
      }),
      v.string(), // input type
    );
  });

  test("default", () => {
    testZodToConvex(z._default(z.string(), "hello"), v.optional(v.string()));
  });

  describe("problematic inputs", () => {
    test("unknown", () => {
      const someType: unknown = z.string();
      const _asConvex = zodToConvex(
        // @ts-expect-error Can’t use unknown
        someType,
      );
      assert<Equals<typeof _asConvex, GenericValidator>>();
    });

    test("ZodType<unknown>", () => {
      const someType: zCore.$ZodType<unknown> = z.string();
      const _asConvex = zodToConvex(someType);
      assert<Equals<typeof _asConvex, GenericValidator>>();
    });

    test("ZodType<some>", () => {
      const someType: zCore.$ZodType<string> = z.string();
      const _asConvex = zodToConvex(someType);
      assert<Equals<typeof _asConvex, GenericValidator>>();
    });

    test("any type", () => {
      const someType: any = z.string();
      const _asConvex = zodToConvex(someType);
      assert<Equals<typeof _asConvex, GenericValidator>>();
    });
  });

  describe("lazy", () => {
    test("throwing", () => {
      expect(() =>
        zodToConvex(
          z.lazy((): zCore.$ZodString => {
            throw new Error("This shouldn’t throw but it did");
          }),
        ),
      ).toThrowError("This shouldn’t throw but it did");
    });
  });
});

describe("zodOutputToConvex", () => {
  test("transform", () => {
    testZodOutputToConvex(
      z.transform((s: number) => s.toString()),
      v.any(), // this transform doesn’t hold runtime info about the output type
    );
  });

  test("pipe", () => {
    testZodOutputToConvex(
      z.pipe(
        z.number(),
        z.transform((s) => s.toString()),
      ),
      v.any(), // this transform doesn’t hold runtime info about the output type
    );
  });

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
      const dateToMsCodec = z.codec(z.date(), z.int().check(z.gte(10)), {
        encode: (millis: number) => new Date(millis),
        decode: (date: Date) => date.getTime(),
      });

      test("optional codec returns VOptional<VFloat64>", () => {
        testZodOutputToConvex(
          z.optional(dateToMsCodec),
          v.optional(v.number()),
        );
      });

      test("nullable codec returns VUnion with null", () => {
        testZodOutputToConvex(
          z.nullable(dateToMsCodec),
          v.union(v.number(), v.null()),
        );
      });

      test("optional nullable codec", () => {
        testZodOutputToConvex(
          z.optional(z.nullable(dateToMsCodec)),
          v.optional(v.union(v.number(), v.null())),
        );
      });

      test("nullable optional codec (swapped order)", () => {
        testZodOutputToConvex(
          z.nullable(z.optional(dateToMsCodec)),
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
          z.optional(stringToNumberCodec),
          v.optional(v.number()),
        );
      });

      test("codec with default", () => {
        testZodOutputToConvex(
          z._default(dateToMsCodec, Date.now()),
          v.number(), // default means output is always present
        );
      });
    });
  });

  test("default", () => {
    testZodOutputToConvex(z._default(z.string(), "hello"), v.string());
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
      z.object({ n: z.optional(stringToNumberCodec) }),
      v.object({ n: v.optional(v.number()) }),
    );
  });

  test("object field with a default", () => {
    testZodOutputToConvex(
      z.object({ n: z._default(stringToNumberCodec, 0) }),
      v.object({ n: v.number() }), // default means output is always present
    );
  });

  test("array element", () => {
    testZodToConvex(z.array(stringToNumberCodec), v.array(v.string()));
    testZodOutputToConvex(z.array(stringToNumberCodec), v.array(v.number()));
  });

  test("nullable array element", () => {
    testZodToConvex(
      z.array(z.nullable(stringToNumberCodec)),
      v.array(v.union(v.string(), v.null())),
    );
    testZodOutputToConvex(
      z.array(z.nullable(stringToNumberCodec)),
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
    testZodToConvex(z.readonly(stringToNumberCodec), v.string());
    testZodOutputToConvex(z.readonly(stringToNumberCodec), v.number());
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
    testZodToConvex(z.catch(stringToNumberCodec, 0), v.string());
    testZodOutputToConvex(z.catch(stringToNumberCodec, 0), v.number());
  });

  test("non-optional", () => {
    testZodToConvex(z.nonoptional(z.optional(stringToNumberCodec)), v.string());
    testZodOutputToConvex(
      z.nonoptional(z.optional(stringToNumberCodec)),
      v.number(),
    );
  });
});

test("zodToConvexFields", () => {
  const convexFields = zodToConvexFields({
    name: z.string(),
    age: z.optional(z.number()),
    transform: z.pipe(
      z.number(),
      z.transform((z) => z.toString()),
    ),
  });

  assert<
    Equals<
      typeof convexFields,
      {
        name: VString;
        age: VOptional<VFloat64>;
        transform: VFloat64;
      }
    >
  >();

  expect(convexFields).toEqual({
    name: v.string(),
    age: v.optional(v.number()),
    transform: v.number(),
  });
});

test("zodOutputToConvexFields", () => {
  const convexFields = zodOutputToConvexFields({
    name: z.string(),
    age: z.optional(z.number()),
    transform: z.pipe(
      z.number(),
      z.transform((z) => z.toString()),
    ),
  });

  assert<
    Equals<
      typeof convexFields,
      {
        name: VString;
        age: VOptional<VFloat64>;
        transform: VAny;
      }
    >
  >();

  expect(convexFields).toEqual({
    name: v.string(),
    age: v.optional(v.number()),
    transform: v.any(),
  });
});

describe("testing infrastructure", () => {
  test("test methods don’t typecheck if the IsOptional value of the result isn’t set correctly", () => {
    // eslint-disable-next-line no-constant-condition
    if (false) {
      // typecheck only
      testZodToConvex(
        z.string(),
        // @ts-expect-error -- This error should be caught by TypeScript
        v.optional(v.string()),
      );
      testZodToConvex(
        z.optional(z.string()),
        // @ts-expect-error -- This error should be caught by TypeScript
        v.string(),
      );

      testZodOutputToConvex(
        z.string(),
        // @ts-expect-error -- This error should be caught by TypeScript
        v.optional(v.string()),
      );
      testZodOutputToConvex(
        z.optional(z.string()),
        // @ts-expect-error -- This error should be caught by TypeScript
        v.string(),
      );

      testZodToConvexInputAndOutput(
        z.string(),
        // @ts-expect-error -- This error should be caught by TypeScript
        v.optional(v.string()),
      );
      testZodToConvexInputAndOutput(
        z.optional(z.string()),
        // @ts-expect-error -- This error should be caught by TypeScript
        v.string(),
      );
    }
  });

  test("test methods typecheck if the IsOptional value of the result is set correctly", () => {
    testZodToConvex(z.optional(z.string()), v.optional(v.string()));
    testZodToConvex(z.string(), v.string());

    testZodOutputToConvex(z.optional(z.string()), v.optional(v.string()));
    testZodOutputToConvex(z.string(), v.string());

    testZodToConvexInputAndOutput(
      z.optional(z.string()),
      v.optional(v.string()),
    );
    testZodToConvexInputAndOutput(z.string(), v.string());
  });

  test("removeUnionOrder", () => {
    const unionWithOrder = v.union(v.literal(1), v.literal(2), v.literal(3));
    assert<
      Equals<
        typeof unionWithOrder,
        VUnion<
          1 | 2 | 3,
          [
            VLiteral<1, "required">,
            VLiteral<2, "required">,
            VLiteral<3, "required">,
          ],
          "required",
          never
        >
      >
    >();

    const _unionWithoutOrder = ignoreUnionOrder(unionWithOrder);
    assert<
      Equals<
        typeof _unionWithoutOrder,
        VUnion<
          1 | 2 | 3,
          (
            | VLiteral<1, "required">
            | VLiteral<2, "required">
            | VLiteral<3, "required">
          )[],
          "required",
          never
        >
      >
    >();
  });

  test("assertUnrepresentableType", () => {
    expect(() => {
      assertUnrepresentableType(z.string());
    }).toThrowError();
  });
});
