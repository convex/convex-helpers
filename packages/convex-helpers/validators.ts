import type {
  DataModelFromSchemaDefinition,
  Expand,
  GenericDatabaseReader,
  SchemaDefinition,
  SystemTableNames,
  TableNamesInDataModel,
} from "convex/server";
import type {
  GenericId,
  GenericValidator,
  Infer,
  ObjectType,
  OptionalProperty,
  PropertyValidators,
  Validator,
  VAny,
  VArray,
  VBoolean,
  VBytes,
  VCommitTs,
  VFloat64,
  VId,
  VInt64,
  VLiteral,
  VNull,
  VObject,
  VOptional,
  VRecord,
  VString,
  VUnion,
} from "convex/values";
import { asObjectValidator, v } from "convex/values";
import { assert } from "./index.js";

/**
 * Helper for defining a union of literals more concisely.
 *
 * e.g. `literals("a", 1, false)` is equivalent to
 * `v.union(v.literal("a"), v.literal(1), v.literal(false))`
 * To use with an array:
 * ```ts
 * const myLiterals = ["a", 1, false] as const;
 * const literalValidator = literals(...myLiterals)
 * ```
 * A similar result can be achieved with `v.union(...myLiterals.map(v.literal))`
 * however the type of each union member will be the union of literal types,
 * rather than each member being a specific literal type.
 *
 * @param args Values you want to use in a union of literals.
 * @returns A validator for the union of the literals.
 */
export const literals = <T extends Array<string | number | boolean | bigint>>(
  ...args: T
) => {
  return v.union(...args.map(v.literal)) as VUnion<
    T[number],
    NoInfer<{ [K in keyof T]: VLiteral<T[K]> }>
  >;
};

/**
 * @deprecated Use `v.nullable` instead. (convex@1.30+)
 * nullable define a validator that can be the value or null more consisely.
 *
 * @param x The validator to make nullable. As in, it can be the value or null.
 * @returns A new validator that can be the value or null.
 */
export const nullable = <V extends Validator<any, "required", any>>(x: V) =>
  v.union(v.null(), x);

/**
 * partial helps you define an object of optional validators more concisely.
 *
 * `partial({a: v.string(), b: v.number()})` is equivalent to
 * `{a: v.optional(v.string()), b: v.optional(v.number())}`
 *
 * @param obj The object of validators to make optional. e.g. {a: v.string()}
 * @returns A new object of validators that can be the value or undefined.
 */
export function partial<T extends PropertyValidators>(
  obj: T,
): {
  [K in keyof T]: VOptional<T[K]>;
};
/**
 * @deprecated use `v.object(...).partial()` instead. (convex@1.30+)
 * partial helps you define an object of optional validators more concisely.
 *
 * `partial(v.object({a: v.string(), b: v.number()}))` is equivalent to
 * `v.object({a: v.optional(v.string()), b: v.optional(v.number())})`
 *
 * @param obj The object of validators to make optional. e.g. v.object({a: v.string()})
 * @returns A new object of validators that can be the value or undefined.
 */
export function partial<
  T,
  V extends Record<string, GenericValidator>,
  O extends OptionalProperty,
>(obj: VObject<T, V, O>): PartialVObject<T, V, O>;
/**
 * partial helps you define a union of optional validators more concisely.
 *
 * `partial(v.union(v.object({a: v.string()}), v.object({b: v.number()})))`
 * is equivalent to
 * `v.union(v.object({a: v.optional(v.string())}), v.object({b: v.optional(v.number())}))`
 *
 * @param obj The union of validators to make optional. e.g. v.union(v.object({a: v.string()}), v.object({b: v.number()}))
 * @returns A new union of validators that can be the value or undefined.
 */
export function partial<
  T,
  V extends Validator<T, "required", any>[],
  O extends OptionalProperty,
>(obj: VUnion<T, V, O>): PartialVUnion<T, V, O>;
/**
 * partial helps you define a union of optional validators more concisely.
 *
 * `partial(v.union(v.object({a: v.string()}), v.object({b: v.number()})))`
 * is equivalent to
 * `v.union(v.object({a: v.optional(v.string())}), v.object({b: v.optional(v.number())}))`
 *
 * @param obj The union of validators to make optional. e.g. v.union(v.object({a: v.string()}), v.object({b: v.number()}))
 * @returns A new union of validators that can be the value or undefined.
 */
export function partial<
  Object extends VObject<any, any, any>,
  Union extends VUnion<any, any[], any>,
>(
  obj: Object | Union,
):
  | PartialVUnion<Union["type"], Union["members"], Object["isOptional"]>
  | PartialVObject<Object["type"], Object["fields"], Object["isOptional"]>;
export function partial(
  fieldsOrObjOrUnion:
    PropertyValidators | VObject<any, any, any> | VUnion<any, any[], any>,
) {
  if (fieldsOrObjOrUnion.isConvexValidator) {
    if (fieldsOrObjOrUnion.kind === "object") {
      return partialVObject(fieldsOrObjOrUnion);
    }
    if (fieldsOrObjOrUnion.kind === "union") {
      return partialUnion(fieldsOrObjOrUnion);
    }
    throw new Error(
      "partial only works with union or object Validators, or a Record<string, Validator> currently",
    );
  }
  return partialFields(fieldsOrObjOrUnion as PropertyValidators);
}

/**
 * partialFields helps you define an object of optional validators more concisely.
 *
 * e.g. `partialFields({a: v.string(), b: v.number()})` is equivalent to
 * `{a: v.optional(v.string()), b: v.optional(v.number())}`
 *
 * @param obj The object of validators to make optional. e.g. {a: v.string()}
 * @returns A new object of validators that can be the value or undefined.
 */
function partialFields<T extends PropertyValidators>(
  obj: T,
): {
  [K in keyof T]: VOptional<T[K]>;
} {
  return Object.fromEntries(
    Object.entries(obj).map(([k, vv]) => [
      k,
      vv.isOptional === "optional" ? vv : v.optional(vv),
    ]),
  ) as any;
}

/**
 * partialObject helps you define an object of optional validators more concisely.
 *
 * e.g. `partialObject({a: v.string(), b: v.number()})` is equivalent to
 * `{a: v.optional(v.string()), b: v.optional(v.number())}`
 *
 * @param obj The object of validators to make optional. e.g. {a: v.string()}
 * @returns A new object of validators that can be the value or undefined.
 */
function partialVObject<
  T,
  V extends Record<string, GenericValidator>,
  Optional extends OptionalProperty,
>(obj: VObject<T, V, Optional>): PartialVObject<T, V, Optional> {
  const o = v.object(partialFields(obj.fields));
  if (obj.isOptional === "optional") {
    return v.optional(o) as any;
  }
  return o as any;
}

type PartialVObject<
  T,
  V extends Record<string, GenericValidator>,
  Optional extends OptionalProperty,
> = VObject<
  Partial<T>,
  {
    [K in keyof V]: VOptional<V[K]>;
  },
  Optional
>;

type PartialUnionMembers<
  Members extends readonly Validator<any, "required", any>[],
> = {
  [K in keyof Members]: Members[K] extends VObject<any, any, "required">
    ? Members[K] extends VObject<
        infer MemberT,
        infer MemberV extends PropertyValidators,
        "required"
      >
      ? PartialVObject<MemberT, MemberV, "required">
      : Members[K]
    : Members[K] extends VUnion<any, any, "required">
      ? Members[K] extends VUnion<infer MemberT, infer MemberV, "required">
        ? PartialVUnion<MemberT, MemberV, "required">
        : Members[K]
      : Members[K];
};

function partialUnion<
  T,
  V extends Validator<T, "required", any>[],
  Optional extends OptionalProperty,
>(union: VUnion<T, V, Optional>): PartialVUnion<T, V, Optional> {
  const u = v.union(
    ...union.members.map((m) => {
      assert(m.isOptional === "required", "Union members cannot be optional");
      if (m.kind === "object") {
        return partialVObject(m) as VObject<any, any, "required">;
      }
      if (m.kind === "union") {
        return partialUnion(m) as VUnion<any, any[], "required">;
      }
      throw new Error(`Invalid union member type: ${m.kind}`);
    }),
  ) as any;
  if (union.isOptional === "optional") {
    return v.optional(u) as any;
  }
  return u as any;
}

type PartialVUnion<
  T,
  Members extends Validator<T, "required", any>[],
  Optional extends OptionalProperty,
> = VUnion<Partial<T>, PartialUnionMembers<Members>, Optional>;

/**
 * Utility to get the validators for fields associated with a table.
 * e.g. for systemFields("users") it would return:
 * { _id: v.id("users"), _creationTime: v.number() }
 *
 * @param tableName The table name in the schema.
 * @returns Validators for the system fields: _id and _creationTime
 */
export const systemFields = <TableName extends string>(
  tableName: TableName,
) => ({
  _id: v.id(tableName),
  _creationTime: v.number(),
});

export type SystemFields<TableName extends string> = ReturnType<
  typeof systemFields<TableName>
>;

/**
 * @deprecated Use `schema.doc` or `docValidator` instead. (convex@1.44+)
 * Utility to add system fields to an object with fields mapping to validators.
 * e.g. withSystemFields("users", { name: v.string() }) would return:
 * { name: v.string(), _id: v.id("users"), _creationTime: v.number() }
 *
 * @param tableName Table name in the schema.
 * @param fields The fields of the table mapped to their validators.
 * @returns The fields plus system fields _id and _creationTime.
 */
export const withSystemFields = <
  TableName extends string,
  T extends Record<string, GenericValidator>,
>(
  tableName: TableName,
  fields: T,
) => {
  const system = systemFields(tableName);
  return {
    ...fields,
    ...system,
  } as Expand<T & typeof system>;
};

export type AddFieldsToValidator<
  V extends Validator<any, any, any>,
  Fields extends PropertyValidators,
> =
  V extends VObject<infer T, infer F, infer O>
    ? VObject<Expand<T & ObjectType<Fields>>, Expand<F & Fields>, O>
    : Validator<
        Expand<V["type"] & ObjectType<Fields>>,
        V["isOptional"],
        V["fieldPaths"] &
          {
            [Property in keyof Fields & string]:
              `${Property}.${Fields[Property]["fieldPaths"]}` | Property;
          }[keyof Fields & string] &
          string
      >;

/**
 * Equivalent to `v.object({ ...validator, ...fields })`.
 */
export function addFieldsToValidator<
  Props extends PropertyValidators,
  Fields extends PropertyValidators,
>(
  validator: Props,
  fields: Fields,
): VObject<ObjectType<Props & Fields>, Props & Fields, "required">;
/**
 * Add fields to an object validator.
 * Equivalent to `v.object({ ...validator.fields, ...fields })`.
 */
export function addFieldsToValidator<
  V extends VObject<any, any, any>,
  Fields extends PropertyValidators,
>(
  validator: V,
  fields: Fields,
): VObject<
  V["type"] & ObjectType<Fields>,
  V["fields"] & Fields,
  V["isOptional"]
>;
/**
 * Add fields to a union validator.
 * Equivalent to `v.union(...validator.members.map((m) => addFieldsToValidator(m, fields)))`.
 */
export function addFieldsToValidator<
  V extends VUnion<any, any[], any>,
  Fields extends PropertyValidators,
>(validator: V, fields: Fields): AddFieldsToValidator<V, Fields>;
export function addFieldsToValidator<
  V extends VObject<any, any, any> | VUnion<any, any[], any>,
  Fields extends PropertyValidators,
>(validator: V, fields: Fields): AddFieldsToValidator<V, Fields>;
export function addFieldsToValidator<
  V extends
    PropertyValidators | VObject<any, any, any> | VUnion<any, any[], any>,
  Fields extends PropertyValidators,
>(validatorOrFields: V, fields: Fields) {
  const validator = asObjectValidator(validatorOrFields);
  if (Object.keys(fields).length === 0) {
    return validator;
  }
  switch (validator.kind) {
    case "object":
      return v.object(intersectValidators(validator.fields, fields));
    case "union":
      return v.union(
        ...validator.members.map((m) => addFieldsToValidator(m, fields)),
      );
    default:
      throw new Error(
        "Cannot add arguments to a validator that is not an object or union.",
      );
  }
}

function intersectValidators(
  fields: PropertyValidators,
  fields2: PropertyValidators,
): PropertyValidators {
  const specificFields = { ...fields };
  for (const [k, v] of Object.entries(fields2)) {
    const existing = specificFields[k];
    if (existing) {
      if (existing.kind !== v.kind) {
        // TODO: handle unions & literals & other sub-types (incl. optionals)
        throw new Error(
          `Cannot intersect validators with different kinds: ${existing.kind} and ${v.kind}`,
        );
      }
      if (existing.isOptional !== v.isOptional) {
        if (existing.isOptional === "optional") {
          // prefer the required validator
          specificFields[k] = v;
        }
      }
    } else {
      specificFields[k] = v;
    }
  }
  return specificFields;
}

/** @deprecated Use `schema.doc` instead. (convex@1.44+) */
export const doc = <
  Schema extends SchemaDefinition<any, boolean>,
  TableName extends TableNamesInDataModel<
    DataModelFromSchemaDefinition<Schema>
  >,
>(
  schema: Schema,
  tableName: TableName,
): AddFieldsToValidator<
  Schema["tables"][TableName]["validator"],
  SystemFields<TableName>
> => {
  function addSystemFields<V extends Validator<any, any, any>>(
    validator: V,
  ): any {
    if (validator.kind === "object") {
      return v.object({
        ...validator.fields,
        ...systemFields(tableName),
      });
    }
    if (validator.kind !== "union") {
      throw new Error(
        "Only object and union validators are supported for documents",
      );
    }
    return v.union(...validator.members.map(addSystemFields));
  }
  return addSystemFields(schema.tables[tableName].validator);
};

/**
 * @deprecated Use `schema.doc` and `schema.id` instead. (convex@1.44+)
 * Creates a validator with a type-safe `.id(table)` and a new `.doc(table)`.
 * Can be used instead of `v` for function arugments & return validators.
 * However, it cannot be used as part of defining a schema, since it would be
 * circular.
 * ```ts
 * import schema from "./schema";
 * export const vv = typedV(schema);
 *
 * export const myQuery = query({
 *   args: { docId: vv.id("mytable") },
 *   returns: vv.doc("mytable"),
 *   handler: (ctx, args) => ctx.db.get(args.docId),
 * })
 *
 * @param schema Typically from `import schema from "./schema"`.
 * @returns A validator like `v` with type-safe `v.id` and a new `v.doc`
 */
export function typedV<Schema extends SchemaDefinition<any, boolean>>(
  schema: Schema,
): Omit<typeof v, "id"> & {
  id: <
    TableName extends TableNamesInDataModel<
      DataModelFromSchemaDefinition<Schema>
    >,
  >(
    tableName: TableName,
  ) => VId<GenericId<TableName>, "required">;
  doc: <
    TableName extends TableNamesInDataModel<
      DataModelFromSchemaDefinition<Schema>
    >,
  >(
    tableName: TableName,
  ) => AddFieldsToValidator<
    Schema["tables"][TableName]["validator"],
    SystemFields<TableName>
  >;
} {
  return {
    ...v,
    /**
     * Similar to v.id but is type-safe on the table name.
     * @param tableName A table named in your schema.
     * @returns A validator for an ID to the named table.
     */
    id: (tableName) => v.id(tableName),
    /**
     * Generates a validator for a document, including system fields.
     * To be used in validators when passing a full document in or out of a
     * function.
     * @param tableName A table named in your schema.
     * @returns A validator that matches the schema validator, adding _id and
     * _creationTime. If the validator was a union, it will update all documents
     * recursively, but will currently lose the VUnion-specific type.
     */
    doc: (tableName) => doc(schema, tableName),
  };
}

/**
 * A string validator that is a branded string type.
 *
 * Read more at https://stack.convex.dev/using-branded-types-in-validators
 *
 * @param _brand - A unique string literal to brand the string with
 */
export const brandedString = <T extends string>(_brand: T) =>
  v.string() as VString<string & { _: T }>;

/** Mark fields as deprecated with this permissive validator typed as null */
export const deprecated = v.optional(v.any()) as Validator<null, "optional">;

/** A maximally permissive validator that type checks as a given validator.
 *
 * If you want to have types that match some validator but you have invalid data
 * and you want to temporarily not validate schema for this field,
 * you can use this function to cast the permissive validator.
 *
 * Example in a schema:
 * ```ts
 * export default defineSchema({
 *   myTable: defineTable({
 *    myString: pretend(v.array(v.string())),
 *   }),
 * });
 * //...in some mutation
 * ctx.db.insert("myTable", { myString: 123 as any }); // no runtime error
 * ```
 * Example in function argument validation:
 * ```ts
 * const myQuery = defineQuery({
 *   args: { myNumber: pretend(v.number()) },
 *   handler: async (ctx, args) => {
 *     // args.myNumber is typed as number, but it's not validated.
 *     const num = typeof args.myNumber === "number" ?
 *       args.myNumber : Number(args.myNumber);
 *   },
 * });
 */
export const pretend = <T extends GenericValidator>(_typeToImmitate: T): T =>
  v.optional(v.any()) as T;

/** A validator that validates as optional but type checks as required.
 *
 * If you want to assume a field is set for type checking, but your data may not
 * actually have it set for all documents (e.g. when adding a new field),
 * you can use this function to allow the field to be unset at runtime.
 * This is unsafe, but can be convenient in these situations:
 *
 * 1. You are developing locally and want to add a required field and write
 *   code assuming it is set. Once you push the code & schema, you can update
 *   the data to match before running your code.
 * 2. You are going to run a migration right after pushing code, and are ok with
 *   and you don't want to edit your code to handle the field being unset,
 *   your app being in an inconsistent state until the migration completes.
 *
 * This differs from {@link pretend} in that it type checks the inner validator,
 * if the value is provided.
 *
 * Example in a schema:
 * ```ts
 * export default defineSchema({
 *   myTable: defineTable({
 *    myString: pretendRequired(v.array(v.string())),
 *   }),
 * });
 * //...in some mutation
 * ctx.db.insert("myTable", { myString: undefined }); // no runtime error
 * ```
 * Example in function argument validation:
 * ```ts
 * const myQuery = defineQuery({
 *   args: { myNumber: pretendRequired(v.number()) },
 *   handler: async (ctx, args) => {
 *     // args.myNumber is typed as number, but it might be undefined
 *     const num = args.myNumber || 0;
 *   },
 * });
 */
export const pretendRequired = <T extends Validator<any, "required", any>>(
  optionalType: T,
): T => v.optional(optionalType) as unknown as T;

export class ValidationError extends Error {
  constructor(
    public expected: string,
    public got: string,
    public path?: string,
  ) {
    const message = `Validator error${path ? ` for ${path}` : ""}: Expected \`${expected}\`, got \`${got}\``;
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validate a value against a validator.
 *
 * WARNING: This does not validate that v.id is an ID for the given table.
 * It only validates that the ID is a string. Function `args`, `returns` and
 * schema definitions will validate that the ID is an ID for the given table.
 *
 * @param validator The validator to validate against.
 * @param value The value to validate.
 * @returns Whether the value is valid against the validator.
 */
export function validate<T extends Validator<any, any, any>>(
  validator: T,
  value: unknown,
  opts?: {
    /* If true, throw an error if the value is not valid. */
    throw?: boolean;
    /* If provided, v.id validation will check that the id is for the table.
    Any GenericDatabaseReader works here, e.g. from a query or mutation ctx. */
    db?: GenericDatabaseReader<any>;
    /* If true, allow fields that are not in an object validator. */
    allowUnknownFields?: boolean;
    /* A prefix for the path of the value being validated, for error reporting.
    This is used for recursive calls, do not set it manually. */
    _pathPrefix?: string;
  },
): value is T["type"] {
  let valid = true;
  let expected: string = validator.kind;
  let got: string | undefined;
  if (value === undefined) {
    if (validator.isOptional !== "optional") {
      valid = false;
    }
  } else {
    switch (validator.kind) {
      case "null": {
        if (value !== null) {
          valid = false;
        }
        break;
      }
      case "float64": {
        if (typeof value !== "number") {
          expected = "number";
          valid = false;
        }
        break;
      }
      case "int64": {
        if (typeof value !== "bigint") {
          expected = "bigint";
          valid = false;
        }
        break;
      }
      case "boolean": {
        if (typeof value !== "boolean") {
          valid = false;
        }
        break;
      }
      case "string": {
        if (typeof value !== "string") {
          valid = false;
        }
        break;
      }
      case "bytes": {
        if (!(value instanceof ArrayBuffer)) {
          valid = false;
        }
        break;
      }
      case "any": {
        break;
      }
      case "literal": {
        if (value !== validator.value) {
          valid = false;
          expected = validator.value;
          if (
            ["string", "number", "boolean", "bigint"].includes(typeof value)
          ) {
            got = `"${value}"`;
          }
        }
        break;
      }
      case "id": {
        if (typeof value !== "string") {
          valid = false;
        } else if (opts?.db) {
          expected = `Id<${validator.tableName}>`;
          // System tables can only be accessed via db.system.
          const id = validator.tableName.startsWith("_")
            ? opts.db.system.normalizeId(
                validator.tableName as SystemTableNames,
                value,
              )
            : opts.db.normalizeId(validator.tableName, value);
          if (!id) {
            valid = false;
          }
        }
        break;
      }
      case "array": {
        if (!Array.isArray(value)) {
          valid = false;
          break;
        }
        for (const [index, v] of value.entries()) {
          const path = `${opts?._pathPrefix ?? ""}[${index}]`;
          valid = validate(validator.element, v, {
            ...opts,
            _pathPrefix: path,
          });
          if (!valid) {
            expected = validator.element.kind;
            break;
          }
        }
        break;
      }
      case "object": {
        if (typeof value !== "object" || value === null) {
          valid = false;
          break;
        }
        const prototype = Object.getPrototypeOf(value);
        const isSimple =
          prototype === null ||
          prototype === Object.prototype ||
          // Objects generated from other contexts (e.g. across Node.js `vm` modules) will not satisfy the previous
          // conditions but are still simple objects.
          prototype?.constructor?.name === "Object";

        if (!isSimple) {
          expected =
            (prototype?.constructor?.name ?? typeof prototype) || "object";
          valid = false;
          break;
        }
        for (const [k, fieldValidator] of Object.entries(validator.fields)) {
          const fieldValue = Object.hasOwn(value, k)
            ? (value as any)[k]
            : undefined;
          valid = validate(fieldValidator, fieldValue, {
            ...opts,
            _pathPrefix: appendPath(opts, k),
          });
          if (!valid) {
            break;
          }
        }
        if (!opts?.allowUnknownFields) {
          for (const k of Object.keys(value)) {
            if (
              !Object.hasOwn(validator.fields, k) &&
              value[k as keyof typeof value] !== undefined
            ) {
              if (opts?.throw) {
                throw new ValidationError(
                  "nothing",
                  typeof (value as any)[k],
                  appendPath(opts, k),
                );
              }
              valid = false;
              break;
            }
          }
        }
        break;
      }
      case "union": {
        valid = false;
        let error: ValidationError | undefined;
        for (const member of validator.members) {
          try {
            if (validate(member, value, opts)) {
              valid = true;
              break;
            }
          } catch (e) {
            error = e as ValidationError;
          }
        }
        if (!valid && error) {
          throw error;
        }
        break;
      }
      case "record": {
        if (typeof value !== "object" || value === null) {
          valid = false;
          break;
        }
        for (const [k, fieldValue] of Object.entries(value)) {
          // Skip validation for undefined values as they will be stripped out
          if (fieldValue === undefined) {
            continue;
          }
          valid = validate(validator.key, k, {
            ...opts,
            _pathPrefix: appendPath(opts, k),
          });
          if (!valid) {
            expected = validator.key.kind;
            break;
          }
          valid = validate(validator.value, fieldValue, {
            ...opts,
            _pathPrefix: appendPath(opts, k),
          });
          if (!valid) {
            expected = validator.value.kind;
            break;
          }
        }
        break;
      }
    }
  }
  if (!valid && opts?.throw) {
    throw new ValidationError(
      expected,
      got ?? (value === null ? "null" : typeof value),
      opts?._pathPrefix,
    );
  }
  return valid;
}

/**
 * Parse a value, using a Convex validator. This differs from `validate` in that
 * it strips unknown fields instead of throwing an error on them.
 *
 * @param validator - The Convex validator to parse the value against.
 * @param value - The value to parse.
 * @returns The parsed value, without fields not specified in the validator.
 */
export function parse<T extends Validator<any, any, any>>(
  validator: T,
  value: unknown,
): Infer<T> {
  validate(validator, value, { allowUnknownFields: true, throw: true });
  return stripUnknownFields(validator, value);
}

function stripUnknownFields<T extends Validator<any, any, any>>(
  validator: T,
  value: Infer<T>,
): Infer<T> {
  if (validator.isOptional === "optional" && value === undefined) {
    return value;
  }
  assert(value !== undefined);
  switch (validator.kind) {
    case "object": {
      const result: Infer<T> = {};
      for (const [k, v] of Object.entries(value)) {
        const fieldValidator = Object.hasOwn(validator.fields, k)
          ? validator.fields[k]
          : undefined;
        if (fieldValidator !== undefined && v !== undefined) {
          defineOwn(result, k, stripUnknownFields(fieldValidator, v));
        }
      }
      return result;
    }
    case "record": {
      const result: Infer<T> = {};
      for (const [k, v] of Object.entries(value)) {
        if (v !== undefined) {
          defineOwn(result, k, stripUnknownFields(validator.value, v));
        }
      }
      return result;
    }
    case "array": {
      return (value as any[]).map((e) =>
        stripUnknownFields(validator.element, e),
      );
    }
    case "union": {
      // First try a strict match
      for (const member of validator.members) {
        if (validate(member, value, { allowUnknownFields: false })) {
          return stripUnknownFields(member, value);
        }
      }
      // Then try a permissive match
      for (const member of validator.members) {
        if (validate(member, value, { allowUnknownFields: true })) {
          return stripUnknownFields(member, value);
        }
      }
      throw new Error("No matching member in union");
    }
    default: {
      return value as Infer<T>;
    }
  }
}

// Assigning to `__proto__` would replace the prototype instead of adding a key.
function defineOwn(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function appendPath(opts: { _pathPrefix?: string } | undefined, path: string) {
  return opts?._pathPrefix ? `${opts._pathPrefix}.${path}` : path;
}

type NotUndefined<T> = Exclude<T, undefined>;

/**
 * A type that converts an optional validator to a required validator.
 *
 * This is the inverse of `VOptional`. It takes a validator that may be optional
 * and returns the equivalent required validator type.
 *
 * @example
 * ```ts
 * type OptionalString = VOptional<VString<string, "required">>;
 * type RequiredString = VRequired<OptionalString>; // VString<string, "required">
 * ```
 */
export type VRequired<T extends Validator<any, OptionalProperty, any>> =
  T extends VId<infer Type, OptionalProperty>
    ? VId<NotUndefined<Type>, "required">
    : T extends VString<infer Type, OptionalProperty>
      ? VString<NotUndefined<Type>, "required">
      : T extends VFloat64<infer Type, OptionalProperty>
        ? VFloat64<NotUndefined<Type>, "required">
        : T extends VInt64<infer Type, OptionalProperty>
          ? VInt64<NotUndefined<Type>, "required">
          : T extends VCommitTs<infer Type, OptionalProperty>
            ? VCommitTs<NotUndefined<Type>, "required">
            : T extends VBoolean<infer Type, OptionalProperty>
              ? VBoolean<NotUndefined<Type>, "required">
              : T extends VNull<infer Type, OptionalProperty>
                ? VNull<NotUndefined<Type>, "required">
                : T extends VAny<infer Type, OptionalProperty>
                  ? VAny<NotUndefined<Type>, "required">
                  : T extends VLiteral<infer Type, OptionalProperty>
                    ? VLiteral<NotUndefined<Type>, "required">
                    : T extends VBytes<infer Type, OptionalProperty>
                      ? VBytes<NotUndefined<Type>, "required">
                      : T extends VObject<
                            infer Type,
                            infer Fields,
                            OptionalProperty,
                            infer FieldPaths
                          >
                        ? VObject<
                            NotUndefined<Type>,
                            Fields,
                            "required",
                            FieldPaths
                          >
                        : T extends VArray<
                              infer Type,
                              infer Element,
                              OptionalProperty
                            >
                          ? VArray<NotUndefined<Type>, Element, "required">
                          : T extends VRecord<
                                infer Type,
                                infer Key,
                                infer Value,
                                OptionalProperty,
                                infer FieldPaths
                              >
                            ? VRecord<
                                NotUndefined<Type>,
                                Key,
                                Value,
                                "required",
                                FieldPaths
                              >
                            : T extends VUnion<
                                  infer Type,
                                  infer Members,
                                  OptionalProperty,
                                  infer FieldPaths
                                >
                              ? VUnion<
                                  NotUndefined<Type>,
                                  Members,
                                  "required",
                                  FieldPaths
                                >
                              : never;

/**
 * Converts an optional validator to a required validator.
 *
 * This is the inverse of `v.optional()`. It takes a validator that may be optional
 * and returns the equivalent required validator.
 *
 * ```ts
 * const optionalString = v.optional(v.string());
 * const requiredString = vRequired(optionalString); // v.string()
 *
 * // Already required validators are returned as-is
 * const alreadyRequired = v.string();
 * const stillRequired = vRequired(alreadyRequired); // v.string()
 * ```
 *
 * @param validator The validator to make required.
 * @returns A required version of the validator.
 */
export function vRequired<T extends Validator<any, OptionalProperty, any>>(
  validator: T,
): VRequired<T> {
  const { kind, isOptional } = validator;
  if (isOptional === "required") {
    // TypeScript can't prove T is already VRequired<T>, so we go via unknown.
    return validator as unknown as VRequired<T>;
  }

  switch (kind) {
    case "id":
      return v.id(validator.tableName) as VRequired<T>;
    case "string":
      return v.string() as VRequired<T>;
    case "float64":
      return v.float64() as VRequired<T>;
    case "int64":
      return v.int64() as VRequired<T>;
    case "boolean":
      return v.boolean() as VRequired<T>;
    case "null":
      return v.null() as VRequired<T>;
    case "any":
      return v.any() as VRequired<T>;
    case "literal":
      return v.literal(validator.value) as VRequired<T>;
    case "bytes":
      return v.bytes() as VRequired<T>;
    case "object":
      return v.object(validator.fields) as VRequired<T>;
    case "array":
      return v.array(validator.element) as VRequired<T>;
    case "record":
      return v.record(validator.key, validator.value) as VRequired<T>;
    case "union":
      return v.union(...validator.members) as VRequired<T>;
    case "commitTs":
      return v.commitTs() as VRequired<T>;
    default:
      kind satisfies never;
      throw new Error("Unknown Convex validator type: " + kind);
  }
}
