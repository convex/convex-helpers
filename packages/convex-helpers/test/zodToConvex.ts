// Helpers shared by the zodToConvex / zodOutputToConvex tests.
import * as zCore from "zod/v4/core";
import { expect } from "vitest";
import type {
  GenericValidator,
  OptionalProperty,
  Validator,
  VUnion,
} from "convex/values";
import { zodOutputToConvex, zodToConvex } from "../server/zod4.js";
import type {
  ConvexValidatorFromZod,
  ConvexValidatorFromZodOutput,
} from "../server/zod4.js";
import type { Equals } from "../index.js";

export function testZodToConvex<
  Z extends zCore.$ZodType,
  Expected extends GenericValidator,
>(
  validator: Z,
  expected: Expected &
    (ExtractOptional<Expected> extends infer IsOpt extends OptionalProperty
      ? Equals<Expected, ConvexValidatorFromZod<Z, IsOpt>> extends true
        ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
          {}
        : "Expected type must exactly match ConvexValidatorFromZod<Z, IsOptional>"
      : "Could not extract IsOptional from Expected"),
) {
  const actual = zodToConvex(validator);
  expect(actual).to.deep.equal(expected);
}

export function testZodOutputToConvex<
  Z extends zCore.$ZodType,
  Expected extends GenericValidator,
>(
  validator: Z,
  expected: Expected &
    (ExtractOptional<Expected> extends infer IsOpt extends OptionalProperty
      ? Equals<Expected, ConvexValidatorFromZodOutput<Z, IsOpt>> extends true
        ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
          {}
        : "Expected type must exactly match ConvexValidatorFromZodOutput<Z, IsOptional>"
      : "Could not extract IsOptional from Expected"),
) {
  const actual = zodOutputToConvex(validator);
  expect(actual).to.deep.equal(expected);
}

// Extract the optionality (IsOptional) from a validator type
type ExtractOptional<V> =
  V extends Validator<any, infer IsOptional, any> ? IsOptional : never;

export function testZodToConvexInputAndOutput<
  Z extends zCore.$ZodType,
  Expected extends GenericValidator,
>(
  validator: Z,
  expected: Expected &
    (ExtractOptional<Expected> extends infer IsOpt extends OptionalProperty
      ? Equals<Expected, ConvexValidatorFromZod<Z, IsOpt>> extends true
        ? Equals<Expected, ConvexValidatorFromZodOutput<Z, IsOpt>> extends true
          ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
            {}
          : "Expected type must exactly match ConvexValidatorFromZodOutput<Z, IsOptional>"
        : "Expected type must exactly match ConvexValidatorFromZod<Z, IsOptional>"
      : "Could not extract IsOptional from Expected"),
) {
  testZodToConvex(validator, expected as any);
  testZodOutputToConvex(validator, expected as any);
}

type MustBeUnrepresentable<Z extends zCore.$ZodType> = [
  ConvexValidatorFromZod<Z, OptionalProperty>,
] extends [never]
  ? never
  : [ConvexValidatorFromZodOutput<Z, OptionalProperty>] extends [never]
    ? never
    : Z;

export function assertUnrepresentableType<
  Z extends MustBeUnrepresentable<zCore.$ZodType>,
>(validator: Z) {
  expect(() => {
    zodToConvex(validator);
  }).toThrowError();
  expect(() => {
    zodOutputToConvex(validator);
  }).toThrowError(/(is not supported in Convex|is not a valid Convex value)/);
}

/**
 * The TypeScript type of Convex union validators has a tuple type argument:
 *
 * ```ts
 * const sampleUnionValidator: VUnion<
 *   string | number,
 *   [
 *     VLiteral<1, "required">,
 *     VLiteral<2, "required">,
 *     VLiteral<3, "required">,
 *   ],
 *   "required",
 *   never
 * > = v.union(v.literal(1), v.literal(2), v.literal(3));
 * ```
 *
 * Some Zod schemas (e.g. `v.enum(…)` and `v.literal([…])`) store their inner
 * types as a union and not as a tuple type.
 * Since TypeScript has no guarantees about the order of union members,
 * the type returned by `zodToConvex` must be imprecise, for instance:
 *
 * ```ts
 * // The inner type 1 | 2 | 3, so any type transformation that we do could
 * // result in a different order of the union members
 * const zodLiteralValidator: z.ZodLiteral<1 | 2 | 3> = z.literal([1, 2, 3]);
 *
 * const sampleUnionValidator: VUnion<
 *   string | number,
 *   (
 *     | VLiteral<1, "required">
 *     | VLiteral<2, "required">
 *     | VLiteral<3, "required">
 *   )[],
 *   "required",
 *   never
 * > = zodToConvex(zodLiteralValidator);
 * ```
 *
 * This function takes a union validator and returns it with a more imprecise
 * type where the order of the union members is not guaranteed.
 */
export function ignoreUnionOrder<
  Type,
  Members extends Validator<any, "required", any>[],
  IsOptional extends OptionalProperty,
  FieldPaths extends string,
>(
  union: VUnion<Type, Members, IsOptional, FieldPaths>,
): VUnion<
  Type,
  // ↓ tuple to array of union
  Members[number][],
  IsOptional,
  FieldPaths
> {
  return union;
}

export function assert<_T extends true>() {}
