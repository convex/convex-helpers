import * as zCore from "zod/v4/core";
import * as z from "zod/v4";
import { assertType, describe, expect, expectTypeOf, test } from "vitest";
import {
  CommitTsPlaceholder,
  GenericId,
  GenericValidator,
  Infer,
  v,
  VCommitTs,
  VFloat64,
  VFunction,
  VString,
} from "convex/values";
import {
  convexToZod,
  ZCommitTs,
  zCommitTs,
  ZFunction,
  zFunction,
  Zid,
  zid,
  zodOutputToConvex,
  zodToConvex,
  ZodValidatorFromConvex,
} from "./zod4";
import { literals } from "../validators";
import { isSameType } from "zod-compare";

test("Zid is a record key", () => {
  const myZid = zid("users");
  expectTypeOf(myZid).toExtend<zCore.$ZodRecordKey>();
});

describe("convexToZod", () => {
  test("id", () => {
    expectTypeOf(convexToZod(v.id("users"))).toEqualTypeOf<Zid<"users">>();
  });
  test("string", () => testConvexToZod(v.string(), z.string()));
  test("number", () => testConvexToZod(v.number(), z.number()));
  test("int64", () => testConvexToZod(v.int64(), z.bigint()));
  test("commitTs", () => {
    const _expected = z.union([z.bigint(), z.instanceof(CommitTsPlaceholder)]);
    const actual = convexToZod(v.commitTs());
    expectTypeOf(actual).toEqualTypeOf<typeof _expected>();
    expect(actual.safeParse(1n).success).toBe(true);
    expect(actual.safeParse(new CommitTsPlaceholder()).success).toBe(true);
  });
  test("boolean", () => testConvexToZod(v.boolean(), z.boolean()));
  test("null", () => testConvexToZod(v.null(), z.null()));
  test("any", () => testConvexToZod(v.any(), z.any()));
  test("bytes", () => {
    expect(() => convexToZod(v.bytes())).toThrow();
  });

  test("optional", () => {
    testConvexToZod(v.optional(v.string()), z.string().optional());
  });

  test("array", () => {
    testConvexToZod(v.array(v.string()), z.array(z.string()));
  });

  describe("union", () => {
    test("never", () => {
      testConvexToZod(v.union(), z.never());
    });
    test("one element (number)", () => {
      testConvexToZod(v.union(v.number()), z.number());
    });
    test("one element (string)", () => {
      testConvexToZod(v.union(v.string()), z.string());
    });
    test("multiple elements", () => {
      testConvexToZod(
        v.union(v.string(), v.number()),
        z.union([z.string(), z.number()]),
      );
    });
  });

  test("branded string", () => {
    const brandedString = z.string().brand("myBrand");
    type BrandedStringType = z.output<typeof brandedString>;

    testConvexToZod(
      v.string() as VString<BrandedStringType, "required">,
      brandedString,
    );
  });
  test("branded number", () => {
    const brandedNumber = z.number().brand("myBrand");
    type BrandedNumberType = z.output<typeof brandedNumber>;

    testConvexToZod(
      v.number() as VFloat64<BrandedNumberType, "required">,
      brandedNumber,
    );
  });

  test("object", () => {
    testConvexToZod(
      v.object({
        name: v.string(),
        age: v.number(),
        picture: v.optional(v.string()),
      }),
      z.strictObject({
        name: z.string(),
        age: z.number(),
        picture: z.string().optional(),
      }),
    );
  });

  describe("record", () => {
    test("key = string", () => {
      testConvexToZod(
        v.record(v.string(), v.number()),
        z.record(z.string(), z.number()),
      );
    });

    test("key = literal", () => {
      testConvexToZod(
        v.record(v.literal("user"), v.number()),
        z.record(z.literal("user"), z.number()),
      );
    });

    test("key = union of literals", () => {
      const convexValidator = v.record(
        v.union(v.literal("user"), v.literal("admin")),
        v.number(),
      );
      const zodSchema = z.record(
        z.union([z.literal("user"), z.literal("admin")]),
        z.number(),
      );
      testConvexToZod(convexValidator, zodSchema);

      // On both Zod and Convex, the record must be exhaustive when the key is a union of literals.
      const partial = { user: 42 } as const;
      // @ts-expect-error -- This should not typecheck
      const _asConvex: Infer<typeof convexValidator> = partial;
      // @ts-expect-error -- This should not typecheck
      const _asZod: z.output<typeof zodSchema> = partial;
    });

    test("key = v.id()", () => {
      const convexValidator = v.record(v.id("users"), v.number());
      const _zodSchema = z.record(zid("users"), z.number());
      expectTypeOf(convexToZod(convexValidator)).toEqualTypeOf<
        typeof _zodSchema
      >();

      const sampleId = "abc" as GenericId<"users">;
      const sampleValue: Record<GenericId<"users">, number> = {
        [sampleId]: 42,
      };
      assertType<Infer<typeof convexValidator>>(sampleValue);
      assertType<zCore.output<typeof _zodSchema>>(sampleValue);
    });

    describe("optional", () => {
      test("id", () => {
        // Testing manually the result since it’s a custom type
        const actual = convexToZod(v.optional(v.id("documents")));
        expect(actual.safeParse(undefined).success).toBe(true);
        expect(actual.safeParse("abc").success).toBe(true);
        expect(actual.safeParse(42).success).toBe(false);
      });
      test("string", () => {
        testConvexToZod(v.optional(v.string()), z.string().optional());
      });
      test("float64", () => {
        testConvexToZod(v.optional(v.float64()), z.number().optional());
      });
      test("int64", () => {
        testConvexToZod(v.optional(v.int64()), z.bigint().optional());
      });
      test("boolean", () => {
        testConvexToZod(v.optional(v.boolean()), z.boolean().optional());
      });
      test("null", () => {
        testConvexToZod(v.optional(v.null()), z.null().optional());
      });
      test("any", () => {
        testConvexToZod(v.optional(v.any()), z.any().optional());
      });
      test("literal", () => {
        testConvexToZod(v.optional(v.literal(42n)), z.literal(42n).optional());
      });
      test("object", () => {
        testConvexToZod(
          v.optional(
            v.object({
              required: v.string(),
              optional: v.optional(v.number()),
            }),
          ),
          z
            .object({
              required: z.string(),
              optional: z.number().optional(),
            })
            .optional(),
        );
      });
      test("array", () => {
        testConvexToZod(
          v.optional(v.array(v.int64())),
          z.array(z.bigint()).optional(),
        );
      });
      test("record", () => {
        testConvexToZod(
          v.optional(v.record(v.string(), v.number())),
          z.record(z.string(), z.number()).optional(),
        );
      });
      test("union", () => {
        testConvexToZod(
          v.optional(v.union(v.number(), v.string())),
          z.union([z.number(), z.string()]).optional(),
        );
      });
    });
  });

  // https://github.com/convex/convex-helpers/issues/861
  test("regression: literals helper", () => {
    testConvexToZod(
      v.object({
        firstName: v.string(),
        lastName: v.string(),
        role: literals("user", "admin"),
      }),
      z.object({
        firstName: z.string(),
        lastName: z.string(),
        role: z.union([z.literal("user"), z.literal("admin")]),
      }),
    );
  });

  // https://github.com/convex/convex-helpers/issues/861#issuecomment-3593231904
  test("regression: spreading an enum into v.union", () => {
    enum Role {
      Guest = "guest",
      User = "user",
      Admin = "admin",
    }

    testConvexToZod(
      v.union(...Object.values(Role).map(v.literal)),
      ignoreZodUnionOrder(
        z.union([
          z.literal(Role.Guest),
          z.literal(Role.User),
          z.literal(Role.Admin),
        ]),
      ),
    );
  });
});

describe("zCommitTs", () => {
  const json = (validator: GenericValidator) => (validator as any).json;
  const ts = v.commitTs();
  const object = v.object({ ts, optionalTs: v.optional(ts) });
  type OptionalCommitTs = VCommitTs<
    bigint | CommitTsPlaceholder | undefined,
    "optional"
  >;

  test("convexToZod returns zCommitTs()", () => {
    expectTypeOf(convexToZod(ts)).toEqualTypeOf<ZCommitTs>();
    expectTypeOf(zCommitTs()).toEqualTypeOf<ZCommitTs>();
    expect(zCommitTs().safeParse(1n).success).toBe(true);
    expect(zCommitTs().safeParse(new CommitTsPlaceholder()).success).toBe(true);
    expect(zCommitTs().safeParse(1).success).toBe(false);
  });

  test("zodToConvex", () => {
    const required = zodToConvex(zCommitTs());
    expectTypeOf(required).toEqualTypeOf<VCommitTs>();
    expect(json(required)).toEqual(json(ts));

    const optional = zodToConvex(zCommitTs().optional());
    expectTypeOf(optional).toEqualTypeOf<OptionalCommitTs>();
    expect(json(optional)).toEqual(json(ts));
    expect(optional.isOptional).toBe("optional");

    const nested = zodToConvex(convexToZod(object));
    expectTypeOf(nested.fields.ts).toEqualTypeOf<VCommitTs>();
    expectTypeOf(nested.fields.optionalTs).toEqualTypeOf<OptionalCommitTs>();
    expect(json(nested)).toEqual(json(object));

    expect(json(zodToConvex(zCommitTs().describe("ts")))).toEqual(json(ts));
  });

  test("zodOutputToConvex", () => {
    const required = zodOutputToConvex(zCommitTs());
    expectTypeOf(required).toEqualTypeOf<VCommitTs>();
    expect(json(required)).toEqual(json(ts));

    const optional = zodOutputToConvex(zCommitTs().optional());
    expectTypeOf(optional).toEqualTypeOf<OptionalCommitTs>();
    expect(json(optional)).toEqual(json(ts));
    expect(optional.isOptional).toBe("optional");

    const nested = zodOutputToConvex(convexToZod(object));
    expectTypeOf(nested.fields.ts).toEqualTypeOf<VCommitTs>();
    expectTypeOf(nested.fields.optionalTs).toEqualTypeOf<OptionalCommitTs>();
    expect(json(nested)).toEqual(json(object));

    expect(json(zodOutputToConvex(zCommitTs().describe("ts")))).toEqual(
      json(ts),
    );
  });
});

// Type equality helper: checks if two types are exactly equal (bidirectionally assignable)
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

function testConvexToZod<
  C extends GenericValidator,
  Expected extends zCore.$ZodType,
>(
  validator: C,
  expected: Expected &
    (Equals<Expected, ZodValidatorFromConvex<C>> extends true
      ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {}
      : "Expected type must exactly match ZodValidatorFromConvex<C>"),
) {
  const actual = convexToZod(validator);
  expect(isSameType(actual, expected)).toBe(true);
}

/**
 * The Zod analog of `ignoreUnionOrder` (from `zod4.zodtoconvex.test`),
 * for unions whose members are all Zod literals (i.e. Zod "enums").
 *
 * Widens a `z.ZodUnion<readonly [z.ZodLiteral<a>, z.ZodLiteral<b>,
 * z.ZodLiteral<c>]>` (tuple, ordered) into a `z.ZodUnion<readonly
 * z.ZodLiteral<a | b | c>[]>` (generic array, no order, literal values
 * collapsed into a single multi-value Zod literal type).
 *
 * That's the shape `convexToZod` produces when the Convex union it
 * receives has its members typed as a generic array (e.g. when callers
 * write `v.union(...Object.values(SomeEnum).map(v.literal))` and the
 * `.map` widens away the tuple shape). Tests written in tuple form can
 * wrap their expected schema with this helper to match.
 *
 * ```ts
 * const ordered: z.ZodUnion<readonly [
 *   z.ZodLiteral<1>,
 *   z.ZodLiteral<2>,
 *   z.ZodLiteral<3>,
 * ]> = z.union([z.literal(1), z.literal(2), z.literal(3)]);
 *
 * const widened: z.ZodUnion<readonly z.ZodLiteral<1 | 2 | 3>[]> =
 *   ignoreZodUnionOrder(ordered);
 * ```
 */
function ignoreZodUnionOrder<
  Members extends readonly z.ZodLiteral<zCore.util.Literal>[],
>(
  union: z.ZodUnion<Members>,
): Members extends readonly z.ZodLiteral<infer V>[]
  ? // ↓ tuple of single-value literals → array of one multi-value literal
    z.ZodUnion<readonly z.ZodLiteral<V>[]>
  : never {
  return union as any;
}

describe("ignoreZodUnionOrder", () => {
  test("collapses a tuple of literals into a generic-array multi-value literal union", () => {
    const unionWithOrder = z.union([z.literal(1), z.literal(2), z.literal(3)]);
    expectTypeOf(unionWithOrder).toEqualTypeOf<
      z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>
    >();

    const unionWithoutOrder = ignoreZodUnionOrder(unionWithOrder);
    expectTypeOf(unionWithoutOrder).toEqualTypeOf<
      z.ZodUnion<readonly z.ZodLiteral<1 | 2 | 3>[]>
    >();
  });

  test("returns the same runtime schema (identity at runtime)", () => {
    const ordered = z.union([z.literal("a"), z.literal("b")]);
    const widened = ignoreZodUnionOrder(ordered);
    expect(widened).toBe(ordered);
    // The widened schema still parses values as before.
    expect(widened.parse("a")).toBe("a");
    expect(widened.parse("b")).toBe("b");
    expect(widened.safeParse("c").success).toBe(false);
  });

  test("widens a single-literal tuple union to an array of that literal", () => {
    const single = z.union([z.literal("only")]);
    expectTypeOf(ignoreZodUnionOrder(single)).toEqualTypeOf<
      z.ZodUnion<readonly z.ZodLiteral<"only">[]>
    >();
  });

  test("handles literals of mixed primitive types", () => {
    const mixed = z.union([z.literal("a"), z.literal(1), z.literal(true)]);
    expectTypeOf(ignoreZodUnionOrder(mixed)).toEqualTypeOf<
      z.ZodUnion<readonly z.ZodLiteral<"a" | 1 | true>[]>
    >();
  });
});

describe("convexToZod function handles", () => {
  const handle = "function://test-handle#tasks:run";
  const signature = v.function({
    fnType: "mutation",
    args: { count: v.number() },
    returns: v.string(),
  });

  test("preserves the handle signature", () => {
    const schema = convexToZod(signature);
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<
      Infer<typeof signature>
    >();
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<
      Infer<typeof signature>
    >();
    expect(schema.parse(handle)).toBe(handle);
    expect(convexToZod(v.function()).parse(handle)).toBe(handle);
  });

  test.each([undefined, null, 42, {}, () => {}, "tasks:run", ""])(
    "rejects values that are not handle strings: %s",
    (value) => {
      expect(convexToZod(signature).safeParse(value).success).toBe(false);
    },
  );

  test("preserves optionality and nested signatures", () => {
    const validator = v.object({
      callback: v.optional(signature),
      callbacks: v.array(signature),
      result: v.union(v.null(), signature),
    });
    const schema = convexToZod(validator);
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<
      Infer<typeof validator>
    >();
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<
      Infer<typeof validator>
    >();
    const value = { callbacks: [handle], result: null };
    expect(schema.parse(value)).toEqual(value);
    expect(
      schema.parse({ ...value, callback: handle, result: handle }),
    ).toEqual({
      ...value,
      callback: handle,
      result: handle,
    });
    expect(schema.safeParse({ ...value, callbacks: ["invalid"] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...value, callback: 42 }).success).toBe(false);
  });
});

describe("zFunction", () => {
  const json = (validator: GenericValidator) => (validator as any).json;
  const handle = "function://test-handle#tasks:run";
  const signature = v.function({
    fnType: "mutation",
    args: { count: v.number() },
    returns: v.string(),
  });
  type Handle = Infer<typeof signature>;
  const object = v.object({
    callback: signature,
    optionalCallback: v.optional(signature),
  });

  test("convexToZod returns a zFunction()", () => {
    const schema = zFunction({
      fnType: "mutation",
      args: { count: v.number() },
      returns: v.string(),
    });
    expectTypeOf(convexToZod(signature)).toEqualTypeOf<ZFunction<Handle>>();
    expectTypeOf(schema).toEqualTypeOf<ZFunction<Handle>>();
    expect(schema.parse(handle)).toBe(handle);
    expect(schema.safeParse("tasks:run").success).toBe(false);
    expect(zFunction().safeParse(handle).success).toBe(true);
  });

  test("zodToConvex", () => {
    const required = zodToConvex(convexToZod(signature));
    expectTypeOf(required).toEqualTypeOf<VFunction<Handle>>();
    expect(required).toBe(signature);

    const optional = zodToConvex(convexToZod(v.optional(signature)));
    expectTypeOf(optional).toEqualTypeOf<
      VFunction<Handle | undefined, "optional">
    >();
    expect(json(optional)).toEqual(json(signature));
    expect(optional.isOptional).toBe("optional");

    const nested = zodToConvex(convexToZod(object));
    expect(json(nested)).toEqual(json(object));

    expect(json(zodToConvex(zFunction().describe("callback")))).toEqual(
      json(v.function()),
    );
  });

  test("zodOutputToConvex", () => {
    const required = zodOutputToConvex(convexToZod(signature));
    expectTypeOf(required).toEqualTypeOf<VFunction<Handle>>();
    expect(required).toBe(signature);

    const nested = zodOutputToConvex(convexToZod(object));
    expect(json(nested)).toEqual(json(object));
  });

  test("hand-written custom schemas are not function handles", () => {
    const validator = zodToConvex(
      z.custom<string>((value) => typeof value === "string"),
    );
    expect(json(validator)).toEqual(json(v.any()));
  });
});
