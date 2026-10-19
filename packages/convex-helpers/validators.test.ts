import { v } from "convex/values";
import { describe, expect, test, expectTypeOf } from "vitest";
import { vRequired, type VRequired, validate, parse } from "./validators.js";
import type { Equals } from "./index.js";
import type { Validator } from "convex/values";

describe("validate with undefined values", () => {
  test("should skip validation for undefined values in records", () => {
    const recordValidator = v.record(v.string(), v.string());
    const valueWithUndefined = {
      validKey: "validValue",
      undefinedKey: undefined,
    };

    // Should not throw because undefined values get stripped
    expect(validate(recordValidator, valueWithUndefined, { throw: true })).toBe(
      true,
    );
  });

  test("should skip validation for undefined values in objects with and without allowUnknownFields", () => {
    const objectValidator = v.object({ knownField: v.string() });
    const valueWithUndefinedUnknown = {
      knownField: "value",
      unknownField: undefined,
    };

    // Should not throw because undefined values get stripped
    expect(
      validate(objectValidator, valueWithUndefinedUnknown, {
        throw: true,
        allowUnknownFields: true,
      }),
    ).toBe(true);
    expect(
      validate(objectValidator, valueWithUndefinedUnknown, {
        throw: true,
        allowUnknownFields: false,
      }),
    ).toBe(true);
  });

  test("should strip undefined values from records when using parse", () => {
    const recordValidator = v.record(v.string(), v.string());
    const valueWithUndefined = {
      validKey: "validValue",
      undefinedKey: undefined,
    };

    const result = parse(recordValidator, valueWithUndefined);
    expect(result).toEqual({ validKey: "validValue" });
    expect("undefinedKey" in result).toBe(false);
  });
});

describe("object keys that exist on Object.prototype", () => {
  const action = v.object({ type: v.literal("intent"), intent: v.number() });
  const inheritedKeys = ["constructor", "toString", "hasOwnProperty"];

  test.each(inheritedKeys)("validate refuses an extra %s key", (key) => {
    const value = JSON.parse(`{"type":"intent","intent":1,"${key}":0}`);
    expect(validate(action, value)).toBe(false);
    expect(() => validate(action, value, { throw: true })).toThrow();
  });

  test("validate refuses an extra __proto__ key", () => {
    const value = JSON.parse(
      '{"type":"intent","intent":1,"__proto__":{"isAdmin":true}}',
    );
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(validate(action, value)).toBe(false);
  });

  test("validate refuses them in nested objects and unions", () => {
    const nested = v.object({ inner: action });
    const value = JSON.parse(
      '{"inner":{"type":"intent","intent":1,"constructor":0}}',
    );
    expect(validate(nested, value)).toBe(false);
    expect(validate(v.union(action, v.null()), value.inner)).toBe(false);
  });

  test("validate accepts them with allowUnknownFields", () => {
    const value = JSON.parse(
      '{"type":"intent","intent":1,"constructor":0,"__proto__":{"isAdmin":true}}',
    );
    expect(validate(action, value, { allowUnknownFields: true })).toBe(true);
  });

  test.each(inheritedKeys)("parse strips an extra %s key", (key) => {
    const value = JSON.parse(`{"type":"intent","intent":1,"${key}":0}`);
    const parsed = parse(action, value);
    expect(parsed).toEqual({ type: "intent", intent: 1 });
    expect(Object.hasOwn(parsed, key)).toBe(false);
  });

  test("parse strips an own __proto__ key and keeps Object.prototype", () => {
    const parsed = parse(
      action,
      JSON.parse('{"type":"intent","intent":1,"__proto__":{"isAdmin":true}}'),
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parsed.isAdmin).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(["type", "intent"]);
  });

  test("parse strips them in nested objects, arrays and unions", () => {
    const validator = v.object({
      inner: action,
      list: v.array(action),
      either: v.union(action, v.null()),
    });
    const extra = '"constructor":0,"__proto__":{"isAdmin":true}';
    const item = `{"type":"intent","intent":1,${extra}}`;
    const parsed = parse(
      validator,
      JSON.parse(`{"inner":${item},"list":[${item}],"either":${item}}`),
    );
    const expected = { type: "intent", intent: 1 };
    expect(parsed).toEqual({
      inner: expected,
      list: [expected],
      either: expected,
    });
    for (const nested of [parsed.inner, parsed.list[0], parsed.either]) {
      expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
      expect((nested as any).isAdmin).toBeUndefined();
    }
  });

  test("parse keeps a __proto__ record key as an own key", () => {
    const parsed = parse(
      v.record(v.string(), v.number()),
      JSON.parse('{"a":1,"__proto__":2}'),
    );
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.keys(parsed)).toEqual(["a", "__proto__"]);
    expect(Object.getOwnPropertyDescriptor(parsed, "__proto__")?.value).toBe(2);
  });

  test("parse does not let a record value replace the prototype", () => {
    const parsed = parse(
      v.record(v.string(), v.any()),
      JSON.parse('{"__proto__":{"isAdmin":true}}'),
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parsed.isAdmin).toBeUndefined();
  });

  test("a declared field with an inherited name is still validated and kept", () => {
    const validator = v.object({ constructor: v.number() });
    expect(validate(validator, { constructor: 1 })).toBe(true);
    expect(parse(validator, { constructor: 1 })).toEqual({ constructor: 1 });
  });

  test("a required field named like a prototype member is not satisfied by it", () => {
    const validator = v.object({ constructor: v.any() });
    const empty = JSON.parse("{}");
    expect(validate(validator, empty)).toBe(false);
    expect(() => validate(validator, empty, { throw: true })).toThrow(
      "Validator error for constructor: Expected `any`, got `undefined`",
    );
    expect(() => parse(validator, empty)).toThrow(
      "Validator error for constructor: Expected `any`, got `undefined`",
    );
  });

  test("an optional field named like a prototype member may be missing", () => {
    const validator = v.object({ toString: v.optional(v.string()) });
    const empty = JSON.parse("{}");
    expect(validate(validator, empty)).toBe(true);
    expect(parse(validator, empty)).toEqual({});
    expect(Object.hasOwn(parse(validator, empty), "toString")).toBe(false);
  });

  test("own values for fields named like prototype members are validated and kept", () => {
    const validator = v.object({
      constructor: v.number(),
      toString: v.optional(v.string()),
    });
    const value = JSON.parse('{"constructor":1,"toString":"x"}');
    expect(validate(validator, value)).toBe(true);
    expect(parse(validator, value)).toEqual({ constructor: 1, toString: "x" });
    expect(validate(validator, { constructor: 1, toString: 2 })).toBe(false);
  });

  test("a declared __proto__ field is kept as an own key", () => {
    const validator = v.object({ ["__proto__"]: v.number() });
    const value = JSON.parse('{"__proto__":1}');
    expect(validate(validator, value)).toBe(true);
    const parsed = parse(validator, value);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(parsed, "__proto__")?.value).toBe(1);
  });
});

describe("vRequired", () => {
  test("returns required validator unchanged", () => {
    testVRequired(v.string(), v.string());
  });

  test("converts optional string to required", () => {
    testVRequired(v.optional(v.string()), v.string());
  });

  test("converts optional number to required", () => {
    testVRequired(v.optional(v.float64()), v.float64());
  });

  test("converts optional boolean to required", () => {
    testVRequired(v.optional(v.boolean()), v.boolean());
  });

  test("converts optional int64 to required", () => {
    testVRequired(v.optional(v.int64()), v.int64());
  });

  test("converts optional commitTs to required", () => {
    testVRequired(v.optional(v.commitTs()), v.commitTs());
  });

  test("converts optional null to required", () => {
    testVRequired(v.optional(v.null()), v.null());
  });

  test("converts optional any to required", () => {
    testVRequired(v.optional(v.any()), v.any());
  });

  test("converts optional literal to required", () => {
    testVRequired(v.optional(v.literal("test")), v.literal("test"));
  });

  test("converts optional bytes to required", () => {
    testVRequired(v.optional(v.bytes()), v.bytes());
  });

  test("converts optional object to required", () => {
    testVRequired(
      v.optional(v.object({ name: v.string() })),
      v.object({ name: v.string() }),
    );
  });

  test("converts optional array to required", () => {
    testVRequired(v.optional(v.array(v.string())), v.array(v.string()));
  });

  test("converts optional record to required", () => {
    testVRequired(
      v.optional(v.record(v.string(), v.number())),
      v.record(v.string(), v.number()),
    );
  });

  test("converts optional union to required", () => {
    testVRequired(
      v.optional(v.union(v.string(), v.number())),
      v.union(v.string(), v.number()),
    );
  });

  test("converts optional id to required", () => {
    testVRequired(v.optional(v.id("users")), v.id("users"));
  });
});

function testVRequired<
  T extends Validator<any, any, any>,
  Expected extends Validator<any, "required", any>,
>(
  input: T,
  expected: Expected &
    (Equals<Expected, VRequired<T>> extends true
      ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {}
      : "Expected type must match VRequired<Input>"),
) {
  const result = vRequired(input);
  expect(result).toEqual(expected);
  expect(result.isOptional).toBe("required");
  // This is redundant with the type check in the argument, but good for sanity
  expectTypeOf(result).toEqualTypeOf(expected as any);
}
