import { CommitTsPlaceholder, ConvexError, v } from "convex/values";
import type {
  GenericId,
  GenericValidator,
  ObjectType,
  OptionalProperty,
  PropertyValidators,
  Validator,
  Value,
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
import * as zCore from "zod/v4/core";
import * as z from "zod/v4";
import type {
  ActionBuilder,
  ArgsArrayToObject,
  DefaultFunctionArgs,
  FunctionVisibility,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder,
  TableNamesInDataModel,
} from "convex/server";
import { pick, type Expand } from "../index.js";
import type { Customization, Registration } from "./customFunctions.js";
import { NoOp } from "./customFunctions.js";
import {
  addFieldsToValidator,
  vRequired,
  type VRequired,
} from "../validators.js";

// #region Convex function definition with Zod

/**
 * zCustomQuery is like customQuery, but allows validation via zod.
 * You can define custom behavior on top of `query` or `internalQuery`
 * by passing a function that modifies the ctx and args. Or NoOp to do nothing.
 *
 * Example usage:
 * ```ts
 * const myQueryBuilder = zCustomQuery(query, {
 *   args: { sessionId: v.id("sessions") },
 *   input: async (ctx, args) => {
 *     const user = await getUserOrNull(ctx);
 *     const session = await db.get(sessionId);
 *     const db = wrapDatabaseReader({ user }, ctx.db, rlsRules);
 *     return { ctx: { db, user, session }, args: {} };
 *   },
 * });
 *
 * // Using the custom builder
 * export const getSomeData = myQueryBuilder({
 *   args: { someArg: z.string() },
 *   handler: async (ctx, args) => {
 *     const { db, user, session, scheduler } = ctx;
 *     const { someArg } = args;
 *     // ...
 *   }
 * });
 * ```
 *
 * Simple usage only modifying ctx:
 * ```ts
 * const myInternalQuery = zCustomQuery(
 *   internalQuery,
 *   customCtx(async (ctx) => {
 *     return {
 *       // Throws an exception if the user isn't logged in
 *       user: await getUserByTokenIdentifier(ctx),
 *     };
 *   })
 * );
 *
 * // Using it
 * export const getUser = myInternalQuery({
 *   args: { email: z.string().email() },
 *   handler: async (ctx, args) => {
 *     console.log(args.email);
 *     return ctx.user;
 *   },
 * });
 *
 * @param query The query to be modified. Usually `query` or `internalQuery`
 *   from `_generated/server`.
 * @param customization The customization to be applied to the query, changing ctx and args.
 * @returns A new query builder using zod validation to define queries.
 */
export function zCustomQuery<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel,
  ExtraArgs extends Record<string, any> = object,
>(
  query: QueryBuilder<DataModel, Visibility>,
  customization: Customization<
    GenericQueryCtx<DataModel>,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >,
) {
  return customFnBuilder(query, customization) as CustomBuilder<
    "query",
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    GenericQueryCtx<DataModel>,
    Visibility,
    ExtraArgs
  >;
}

/**
 * zCustomMutation is like customMutation, but allows validation via zod.
 * You can define custom behavior on top of `mutation` or `internalMutation`
 * by passing a function that modifies the ctx and args. Or NoOp to do nothing.
 *
 * Example usage:
 * ```ts
 * const myMutationBuilder = zCustomMutation(mutation, {
 *   args: { sessionId: v.id("sessions") },
 *   input: async (ctx, args) => {
 *     const user = await getUserOrNull(ctx);
 *     const session = await db.get(sessionId);
 *     const db = wrapDatabaseReader({ user }, ctx.db, rlsRules);
 *     return { ctx: { db, user, session }, args: {} };
 *   },
 * });
 *
 * // Using the custom builder
 * export const getSomeData = myMutationBuilder({
 *   args: { someArg: z.string() },
 *   handler: async (ctx, args) => {
 *     const { db, user, session, scheduler } = ctx;
 *     const { someArg } = args;
 *     // ...
 *   }
 * });
 * ```
 *
 * Simple usage only modifying ctx:
 * ```ts
 * const myInternalMutation = zCustomMutation(
 *   internalMutation,
 *   customCtx(async (ctx) => {
 *     return {
 *       // Throws an exception if the user isn't logged in
 *       user: await getUserByTokenIdentifier(ctx),
 *     };
 *   })
 * );
 *
 * // Using it
 * export const getUser = myInternalMutation({
 *   args: { email: z.string().email() },
 *   handler: async (ctx, args) => {
 *     console.log(args.email);
 *     return ctx.user;
 *   },
 * });
 *
 * @param mutation The mutation to be modified. Usually `mutation` or `internalMutation`
 *   from `_generated/server`.
 * @param customization The customization to be applied to the mutation, changing ctx and args.
 * @returns A new mutation builder using zod validation to define queries.
 */
export function zCustomMutation<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel,
  ExtraArgs extends Record<string, any> = object,
>(
  mutation: MutationBuilder<DataModel, Visibility>,
  customization: Customization<
    GenericMutationCtx<DataModel>,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >,
) {
  return customFnBuilder(mutation, customization) as CustomBuilder<
    "mutation",
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    GenericMutationCtx<DataModel>,
    Visibility,
    ExtraArgs
  >;
}

/**
 * zCustomAction is like customAction, but allows validation via zod.
 * You can define custom behavior on top of `action` or `internalAction`
 * by passing a function that modifies the ctx and args. Or NoOp to do nothing.
 *
 * Example usage:
 * ```ts
 * const myActionBuilder = zCustomAction(action, {
 *   args: { sessionId: v.id("sessions") },
 *   input: async (ctx, args) => {
 *     const user = await getUserOrNull(ctx);
 *     const session = await db.get(sessionId);
 *     const db = wrapDatabaseReader({ user }, ctx.db, rlsRules);
 *     return { ctx: { db, user, session }, args: {} };
 *   },
 * });
 *
 * // Using the custom builder
 * export const getSomeData = myActionBuilder({
 *   args: { someArg: z.string() },
 *   handler: async (ctx, args) => {
 *     const { db, user, session, scheduler } = ctx;
 *     const { someArg } = args;
 *     // ...
 *   }
 * });
 * ```
 *
 * Simple usage only modifying ctx:
 * ```ts
 * const myInternalAction = zCustomAction(
 *   internalAction,
 *   customCtx(async (ctx) => {
 *     return {
 *       // Throws an exception if the user isn't logged in
 *       user: await getUserByTokenIdentifier(ctx),
 *     };
 *   })
 * );
 *
 * // Using it
 * export const getUser = myInternalAction({
 *   args: { email: z.string().email() },
 *   handler: async (ctx, args) => {
 *     console.log(args.email);
 *     return ctx.user;
 *   },
 * });
 *
 * @param action The action to be modified. Usually `action` or `internalAction`
 *   from `_generated/server`.
 * @param customization The customization to be applied to the action, changing ctx and args.
 * @returns A new action builder using zod validation to define queries.
 */
export function zCustomAction<
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel,
  ExtraArgs extends Record<string, any> = object,
>(
  action: ActionBuilder<DataModel, Visibility>,
  customization: Customization<
    GenericActionCtx<DataModel>,
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs
  >,
) {
  return customFnBuilder(action, customization) as CustomBuilder<
    "action",
    CustomArgsValidator,
    CustomCtx,
    CustomMadeArgs,
    GenericActionCtx<DataModel>,
    Visibility,
    ExtraArgs
  >;
}

// #endregion

// #region Convex IDs

/**
 * Creates a validator for a Convex `Id`.
 *
 * - When **used within Zod**, it will only check that the ID is a string.
 * - When **converted to a Convex validator** (e.g. through {@link zodToConvex}),
 *   it will check that it's for the right table.
 *
 * @param tableName - The table that the `Id` references. i.e. `Id<tableName>`
 * @returns A Zod schema representing a Convex `Id`
 */
export const zid = <
  DataModel extends GenericDataModel,
  TableName extends TableNamesInDataModel<DataModel> =
    TableNamesInDataModel<DataModel>,
>(
  tableName: TableName,
): Zid<TableName> => {
  const result = z.custom<GenericId<TableName>>(
    (val) => typeof val === "string",
  );
  _zidRegistry.add(result, { tableName });
  return result;
};

/** The type of Convex validators in Zod */
export type Zid<TableName extends string> = z.ZodCustom<
  GenericId<TableName>,
  string
> &
  zCore.$ZodRecordKey;

/**
 * Useful to get the input context type for a custom function using Zod.
 */
export type ZCustomCtx<Builder> =
  Builder extends CustomBuilder<
    any,
    any,
    infer CustomCtx,
    any,
    infer InputCtx,
    any,
    any
  >
    ? Overwrite<InputCtx, CustomCtx>
    : never;

// #endregion

// #region Zod → Convex

/**
 * Turns a Zod or Zod Mini validator into a Convex validator.
 *
 * The Convex validator will be as close to possible to the Zod validator,
 * but might be broader than the Zod validator:
 *
 * ```ts
 * zodToConvex(z.string().email()) // → v.string()
 * ```
 *
 * This function is useful when running the Zod validator _after_ running the Convex validator
 * (i.e. the Convex validator validates the input of the Zod validator). Hence, the Convex types
 * will match the _input type_ of Zod transformations:
 * ```ts
 * zodToConvex(z.object({
 *   name: z.string().default("Nicolas"),
 * })) // → v.object({ name: v.optional(v.string()) })
 *
 * zodToConvex(z.object({
 *   name: z.string().transform(s => s.length)
 * })) // → v.object({ name: v.string() })
 * ````
 *
 * This function is useful for:
 * * **Validating function arguments with Zod**: through {@link zCustomQuery},
 *   {@link zCustomMutation} and {@link zCustomAction}, you can define the argument validation logic
 *   using Zod validators instead of Convex validators. `zodToConvex` will generate a Convex validator
 *   from your Zod validator. This will allow you to:
 *     - validate at run time that Convex IDs are from the right table (using {@link zid})
 *     - allow some features of Convex to understand the expected shape of the arguments
 *       (e.g. argument validation/prefilling in the function runner on the Convex dashboard)
 *     - still run the full Zod validation when the function runs
 *       (which is useful for more advanced Zod validators like `z.string().email()`)
 * * **Validating data after reading it from the database**: if you want to write your DB schema
 *   with Zod, you can run Zod whenever you read from the database to check that the data
 *   still matches the schema. Note that this approach won’t ensure that the data stored in the DB
 *   matches the Zod schema; see
 *   https://stack.convex.dev/typescript-zod-function-validation#can-i-use-zod-to-define-my-database-types-too
 *   for more details.
 *
 * Note that some values might be valid in Zod but not in Convex,
 * in the same way that valid JavaScript values might not be valid
 * Convex values for the corresponding Convex type.
 * (see the limits of Convex data types on https://docs.convex.dev/database/types).
 *
 * ```
 * ┌─────────────────────────────────────┬─────────────────────────────────────┐
 * │          **zodToConvex**            │          zodOutputToConvex          │
 * ├─────────────────────────────────────┼─────────────────────────────────────┤
 * │ For when the Zod validator runs     │ For when the Zod validator runs     │
 * │ _after_ the Convex validator        │ _before_ the Convex validator       │
 * ├─────────────────────────────────────┼─────────────────────────────────────┤
 * │ Convex types use the _input types_  │ Convex types use the _return types_ │
 * │ of Zod transformations              │ of Zod transformations              │
 * ├─────────────────────────────────────┼─────────────────────────────────────┤
 * │ The Convex validator can be less    │ The Convex validator can be less    │
 * │ strict (i.e. some inputs might be   │ strict (i.e. the type in Convex can │
 * │ accepted by Convex then rejected    │ be less precise than the type in    │
 * │ by Zod)                             │ the Zod output)                     │
 * ├─────────────────────────────────────┼─────────────────────────────────────┤
 * │ When using Zod schemas              │ When using Zod schemas              │
 * │ for function definitions:           │ for function definitions:           │
 * │ used for _arguments_                │ used for _return values_            │
 * ├─────────────────────────────────────┼─────────────────────────────────────┤
 * │ When validating contents of the     │ When validating contents of the     │
 * │ database with a Zod schema:         │ database with a Zod schema:         │
 * │ used to validate data               │ used to validate data               │
 * │ _after reading_                     │ _before writing_                    │
 * └─────────────────────────────────────┴─────────────────────────────────────┘
 * ```
 *
 * @param zod Zod validator can be a Zod object, or a Zod type like `z.string()`
 * @returns Convex Validator (e.g. `v.string()` from "convex/values")
 * @throws If there is no equivalent Convex validator for the value (e.g. `z.date()`)
 */
export function zodToConvex<Z extends zCore.$ZodType>(
  validator: Z,
): ConvexValidatorFromZod<Z, "required"> {
  const visited = new WeakSet<zCore.$ZodType>();

  function zodToConvexInner(validator: zCore.$ZodType): GenericValidator {
    // Circular validator definitions are not supported by Convex validators,
    // so we use v.any() when there is a cycle.
    if (visited.has(validator)) {
      return v.any();
    }
    visited.add(validator);

    const result =
      validator instanceof zCore.$ZodDefault
        ? v.optional(zodToConvexInner(validator._zod.def.innerType))
        : validator instanceof zCore.$ZodPipe
          ? zodToConvexInner(validator._zod.def.in)
          : zodToConvexCommon(validator, zodToConvexInner);

    // After returning, we remove the validator from the visited set because
    // we only want to detect circular types, not cases where part of a type
    // is reused (e.g. `v.object({ field1: mySchema, field2: mySchema })`).
    visited.delete(validator);
    return result;
  }

  // `as any` because ConvexValidatorFromZod is defined from the behavior of zodToConvex.
  // We assume the type is correct to simplify the life of the compiler.
  return zodToConvexInner(validator) as any;
}

/**
 * Converts a Zod or Zod Mini validator to a Convex validator that checks the value _after_
 * it has been validated (and possibly transformed) by the Zod validator.
 *
 * This is similar to {@link zodToConvex}, but is meant for cases where the Convex
 * validator runs _after_ the Zod validator. Thus, the Convex type refers to the
 * _output_ type of the Zod transformations:
 * ```ts
 * zodOutputToConvex(z.object({
 *   name: z.string().default("Nicolas"),
 * })) // → v.object({ name: v.string() })
 *
 * zodOutputToConvex(z.object({
 *   name: z.string().transform(s => s.length)
 * })) // → v.object({ name: v.number() })
 * ````
 *
 * This function can be useful for:
 * - **Validating function return values with Zod**: through {@link zCustomQuery},
 *   {@link zCustomMutation} and {@link zCustomAction}, you can define the `returns` property
 *   of a function using Zod validators instead of Convex validators.
 * - **Validating data after reading it from the database**: if you want to write your DB schema
 *   Zod validators, you can run Zod whenever you write to the database to ensure your data matches
 *   the expected format. Note that this approach won’t ensure that the data stored in the DB
 *   isn’t modified manually in a way that doesn’t match your Zod schema; see
 *   https://stack.convex.dev/typescript-zod-function-validation#can-i-use-zod-to-define-my-database-types-too
 *   for more details.
 *
 * ```
 * ┌─────────────────────────────────────┬─────────────────────────────────────┐
 * │            zodToConvex              │        **zodOutputToConvex**        │
 * ├─────────────────────────────────────┼─────────────────────────────────────┤
 * │ For when the Zod validator runs     │ For when the Zod validator runs     │
 * │ _after_ the Convex validator        │ _before_ the Convex validator       │
 * ├─────────────────────────────────────┼─────────────────────────────────────┤
 * │ Convex types use the _input types_  │ Convex types use the _return types_ │
 * │ of Zod transformations              │ of Zod transformations              │
 * ├─────────────────────────────────────┼─────────────────────────────────────┤
 * │ The Convex validator can be less    │ The Convex validator can be less    │
 * │ strict (i.e. some inputs might be   │ strict (i.e. the type in Convex can │
 * │ accepted by Convex then rejected    │ be less precise than the type in    │
 * │ by Zod)                             │ the Zod output)                     │
 * ├─────────────────────────────────────┼─────────────────────────────────────┤
 * │ When using Zod schemas              │ When using Zod schemas              │
 * │ for function definitions:           │ for function definitions:           │
 * │ used for _arguments_                │ used for _return values_            │
 * ├─────────────────────────────────────┼─────────────────────────────────────┤
 * │ When validating contents of the     │ When validating contents of the     │
 * │ database with a Zod schema:         │ database with a Zod schema:         │
 * │ used to validate data               │ used to validate data               │
 * │ _after reading_                     │ _before writing_                    │
 * └─────────────────────────────────────┴─────────────────────────────────────┘
 * ```
 *
 * @param z The zod validator
 * @returns Convex Validator (e.g. `v.string()` from "convex/values")
 * @throws If there is no equivalent Convex validator for the value (e.g. `z.date()`)
 */
export function zodOutputToConvex<Z extends zCore.$ZodType>(
  validator: Z,
): ConvexValidatorFromZodOutput<Z, "required"> {
  const visited = new WeakSet<zCore.$ZodType>();

  function zodOutputToConvexInner(validator: zCore.$ZodType): GenericValidator {
    // Circular validator definitions are not supported by Convex validators,
    // so we use v.any() when there is a cycle.
    if (visited.has(validator)) {
      return v.any();
    }
    visited.add(validator);

    const result =
      validator instanceof zCore.$ZodDefault
        ? zodOutputToConvexInner(validator._zod.def.innerType)
        : validator instanceof zCore.$ZodPipe
          ? zodOutputToConvexInner(validator._zod.def.out)
          : validator instanceof zCore.$ZodTransform
            ? v.any()
            : zodToConvexCommon(validator, zodOutputToConvexInner);

    // After returning, we remove the validator from the visited set because
    // we only want to detect circular types, not cases where part of a type
    // is reused (e.g. `v.object({ field1: mySchema, field2: mySchema })`).
    visited.delete(validator);
    return result;
  }

  // `as any` because ConvexValidatorFromZodOutput is defined from the behavior of zodOutputToConvex.
  // We assume the type is correct to simplify the life of the compiler.
  return zodOutputToConvexInner(validator) as any;
}

type ZodFields = Record<string, zCore.$ZodType>;

/**
 * Like {@link zodToConvex}, but it takes in a bare object, as expected by Convex
 * function arguments, or the argument to {@link defineTable}.
 *
 * ```ts
 * zodToConvexFields({
 *   name: z.string().default("Nicolas"),
 * }) // → { name: v.optional(v.string()) }
 * ```
 *
 * @param fields Object with string keys and Zod validators as values
 * @returns Object with the same keys, but with Convex validators as values
 */
export function zodToConvexFields<Fields extends ZodFields>(fields: Fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, zodToConvex(v)]),
  ) as {
    [k in keyof Fields]: Fields[k] extends zCore.$ZodType
      ? ConvexValidatorFromZod<Fields[k], "required">
      : never;
  };
}

/**
 * Like {@link zodOutputToConvex}, but it takes in a bare object, as expected by
 * Convex function arguments, or the argument to {@link defineTable}.
 *
 * ```ts
 * zodOutputToConvexFields({
 *   name: z.string().default("Nicolas"),
 * }) // → { name: v.string() }
 * ```
 *
 * This is different from {@link zodToConvexFields} because it generates the
 * Convex validator for the output of the Zod validator, not the input;
 * see the documentation of {@link zodToConvex} and {@link zodOutputToConvex}
 * for more details.
 *
 * @param zod Object with string keys and Zod validators as values
 * @returns Object with the same keys, but with Convex validators as values
 */
export function zodOutputToConvexFields<Fields extends ZodFields>(
  fields: Fields,
) {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, zodOutputToConvex(v)]),
  ) as {
    [k in keyof Fields]: ConvexValidatorFromZodOutput<Fields[k], "required">;
  };
}

// #endregion

// #region Convex → Zod

/**
 * Turns a Convex validator into a Zod validator.
 *
 * This is useful when you want to use types you defined using Convex validators
 * with external libraries that expect to receive a Zod validator.
 *
 * ```ts
 * convexToZod(v.string()) // → z.string()
 * ```
 *
 * This function returns Zod validators, not Zod Mini validators.
 *
 * @param convexValidator Convex validator can be any validator from "convex/values" e.g. `v.string()`
 * @returns Zod validator (e.g. `z.string()`) with inferred type matching the Convex validator
 */
export function convexToZod<V extends GenericValidator>(
  convexValidator: V,
): ZodValidatorFromConvex<V> {
  const isOptional = (convexValidator as any).isOptional === "optional";

  let zodValidator: zCore.$ZodType;

  const { kind } = convexValidator;
  switch (kind) {
    case "id":
      convexValidator satisfies VId<any>;
      zodValidator = zid(convexValidator.tableName);
      break;
    case "string":
      zodValidator = z.string();
      break;
    case "float64":
      zodValidator = z.number();
      break;
    case "int64":
      zodValidator = z.bigint();
      break;
    case "commitTs":
      zodValidator = z.union([z.bigint(), z.instanceof(CommitTsPlaceholder)]);
      break;
    case "boolean":
      zodValidator = z.boolean();
      break;
    case "null":
      zodValidator = z.null();
      break;
    case "any":
      zodValidator = z.any();
      break;
    case "array": {
      convexValidator satisfies VArray<any, any>;
      zodValidator = z.array(convexToZod(convexValidator.element));
      break;
    }
    case "object": {
      convexValidator satisfies VObject<any, any>;
      zodValidator = z.object(convexToZodFields(convexValidator.fields));
      break;
    }
    case "union": {
      convexValidator satisfies VUnion<any, any, any, any>;

      if (convexValidator.members.length === 0) {
        zodValidator = z.never();
        break;
      }

      if (convexValidator.members.length === 1) {
        zodValidator = convexToZod(convexValidator.members[0]!);
        break;
      }

      const memberValidators = convexValidator.members.map(
        (member: GenericValidator) => convexToZod(member),
      );
      zodValidator = z.union([...memberValidators]);
      break;
    }
    case "literal": {
      const literalValidator = convexValidator as VLiteral<any>;
      zodValidator = z.literal(literalValidator.value);
      break;
    }
    case "record": {
      convexValidator satisfies VRecord<any, any, any, any, any>;
      zodValidator = z.record(
        convexToZod(convexValidator.key) as zCore.$ZodRecordKey,
        convexToZod(convexValidator.value),
      );
      break;
    }
    case "bytes":
      throw new Error("v.bytes() is not supported");
    default:
      kind satisfies never;
      throw new Error(`Unknown convex validator type: ${kind}`);
  }

  return isOptional
    ? (z.optional(zodValidator) as ZodValidatorFromConvex<V>)
    : (zodValidator as ZodValidatorFromConvex<V>);
}

/**
 * Like {@link convexToZod}, but it takes in a bare object, as expected by Convex
 * function arguments, or the argument to {@link defineTable}.
 *
 * ```ts
 * convexToZodFields({
 *   name: v.string(),
 * }) // → { name: z.string() }
 * ```
 *
 * @param convexValidators Object with string keys and Convex validators as values
 * @returns Object with the same keys, but with Zod validators as values
 */
export function convexToZodFields<C extends PropertyValidators>(
  convexValidators: C,
) {
  return Object.fromEntries(
    Object.entries(convexValidators).map(([k, v]) => [k, convexToZod(v)]),
  ) as { [k in keyof C]: ZodValidatorFromConvex<C[k]> };
}

// #endregion

// #region Utils

/**
 * Zod helper for adding Convex system fields to a record to return.
 *
 * ```ts
 * withSystemFields("users", {
 *   name: z.string(),
 * })
 * // → {
 * //   name: z.string(),
 * //   _id: zid("users"),
 * //   _creationTime: z.number(),
 * // }
 * ```
 *
 * @param tableName - The table where records are from, i.e. Doc<tableName>
 * @param zObject - Validators for the user-defined fields on the document.
 * @returns Zod shape for use with `z.object(shape)` that includes system fields.
 */
export function withSystemFields<
  Table extends string,
  T extends { [key: string]: zCore.$ZodType },
>(tableName: Table, zObject: T) {
  return { ...zObject, _id: zid(tableName), _creationTime: z.number() };
}

// #endregion

// #region Implementation: Convex function definition with Zod

/**
 * A builder that customizes a Convex function, whether or not it validates
 * arguments. If the customization requires arguments, however, the resulting
 * builder will require argument validation too.
 */
export type CustomBuilder<
  FuncType extends "query" | "mutation" | "action",
  CustomArgsValidator extends PropertyValidators,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  InputCtx,
  Visibility extends FunctionVisibility,
  ExtraArgs extends Record<string, any>,
> = {
  <
    ArgsValidator extends ZodFields | zCore.$ZodObject<any> | void,
    ReturnsZodValidator extends zCore.$ZodType | ZodFields | void = void,
    ReturnValue extends ReturnValueInput<ReturnsZodValidator> = any,
    // Note: this differs from customFunctions.ts b/c we don't need to track
    // the exact args to match the standard builder types. For Zod we don't
    // try to ever pass a custom function as a builder to another custom
    // function, so we can be looser here.
  >(
    func:
      | ({
          /**
           * Specify the arguments to the function as a Zod validator.
           */
          args?: ArgsValidator;
          handler: (
            ctx: Overwrite<InputCtx, CustomCtx>,
            ...args: ArgsForHandlerType<
              ArgsOutput<ArgsValidator>,
              CustomMadeArgs
            >
          ) => ReturnValue;
          /**
           * Validates the value returned by the function.
           * Note: you can't pass an object directly without wrapping it
           * in `z.object()`.
           */
          returns?: ReturnsZodValidator;
          /**
           * If true, the function will not be validated by Convex,
           * in case you're seeing performance issues with validating twice.
           */
          skipConvexValidation?: boolean;
        } & {
          [
            key in keyof ExtraArgs as key extends
              "args" | "handler" | "skipConvexValidation" | "returns"
              ? never
              : key
          ]: ExtraArgs[key];
        })
      | {
          (
            ctx: Overwrite<InputCtx, CustomCtx>,
            ...args: ArgsForHandlerType<
              ArgsOutput<ArgsValidator>,
              CustomMadeArgs
            >
          ): ReturnValue;
        },
  ): Registration<
    FuncType,
    Visibility,
    ArgsArrayToObject<
      CustomArgsValidator extends Record<string, never>
        ? ArgsInput<ArgsValidator>
        : ArgsInput<ArgsValidator> extends [infer A]
          ? [Expand<A & ObjectType<CustomArgsValidator>>]
          : [ObjectType<CustomArgsValidator>]
    >,
    ReturnsZodValidator extends void
      ? ReturnValue
      : ReturnValueOutput<ReturnsZodValidator>
  >;
};

function customFnBuilder(
  builder: (args: any) => any,
  customization: Customization<any, any, any, any, any>,
) {
  // Most of the code in here is identical to customFnBuilder in zod3.ts.
  // If making changes, please keep zod3.ts in sync.

  // Looking forward to when input / args / ... are optional
  const customInput: Customization<any, any, any, any, any>["input"] =
    customization.input ?? NoOp.input;
  const inputArgs = customization.args ?? NoOp.args;
  return function customBuilder(fn: any): any {
    const {
      args,
      handler = fn,
      skipConvexValidation = false,
      returns: maybeObject,
      ...extra
    } = fn;

    const returns =
      maybeObject && !(maybeObject instanceof zCore.$ZodType)
        ? z.object(maybeObject)
        : maybeObject;

    const returnValidator =
      returns && !skipConvexValidation
        ? { returns: zodOutputToConvex(returns) }
        : null;

    if (args) {
      let argsValidator = args;
      if (argsValidator instanceof zCore.$ZodType) {
        if (argsValidator instanceof zCore.$ZodObject) {
          argsValidator = argsValidator._zod.def.shape;
        } else {
          throw new Error(
            "Unsupported zod type as args validator: " +
              argsValidator.constructor.name,
          );
        }
      }
      const convexValidator = zodToConvexFields(argsValidator);
      return builder({
        args: skipConvexValidation
          ? undefined
          : addFieldsToValidator(convexValidator, inputArgs),
        ...returnValidator,
        handler: async (ctx: any, allArgs: any) => {
          const added = await customInput(
            ctx,
            pick(allArgs, Object.keys(inputArgs)) as any,
            extra,
          );
          const rawArgs = pick(allArgs, Object.keys(argsValidator));
          const parsed = await z.object(argsValidator).safeParseAsync(rawArgs);
          if (!parsed.success) {
            throw new ConvexError({
              ZodError: JSON.parse(
                JSON.stringify(parsed.error.issues, null, 2),
              ) as Value[],
            });
          }
          const args = parsed.data;
          const finalCtx = { ...ctx, ...added.ctx };
          const finalArgs = { ...args, ...added.args };
          const ret = await handler(finalCtx, finalArgs);
          // We don't catch the error here. It's a developer error and we
          // don't want to risk exposing the unexpected value to the client.
          const result = returns
            ? await returns.parseAsync(ret === undefined ? null : ret)
            : ret;
          if (added.onSuccess) {
            await added.onSuccess({ ctx, args, result });
          }
          return result;
        },
      });
    }
    if (skipConvexValidation && Object.keys(inputArgs).length > 0) {
      throw new Error(
        "If you're using a custom function with arguments for the input " +
          "customization, you cannot skip convex validation.",
      );
    }
    return builder({
      ...returnValidator,
      handler: async (ctx: any, args: any) => {
        const added = await customInput(ctx, args, extra);
        const finalCtx = { ...ctx, ...added.ctx };
        const finalArgs = { ...args, ...added.args };
        const ret = await handler(finalCtx, finalArgs);
        // We don't catch the error here. It's a developer error and we
        // don't want to risk exposing the unexpected value to the client.
        const result = returns
          ? await returns.parseAsync(ret === undefined ? null : ret)
          : ret;
        if (added.onSuccess) {
          await added.onSuccess({ ctx, args, result });
        }
        return result;
      },
    });
  };
}

type ArgsForHandlerType<
  OneOrZeroArgs extends [] | [Record<string, any>],
  CustomMadeArgs extends Record<string, any>,
> =
  CustomMadeArgs extends Record<string, never>
    ? OneOrZeroArgs
    : OneOrZeroArgs extends [infer A]
      ? [Expand<A & CustomMadeArgs>]
      : [CustomMadeArgs];

// Copied from convex/src/server/api.ts since they aren't exported
type NullToUndefinedOrNull<T> = T extends null ? T | undefined | void : T;
type Returns<T> = Promise<NullToUndefinedOrNull<T>> | NullToUndefinedOrNull<T>;

// The return value before it's been validated: returned by the handler
type ReturnValueInput<
  ReturnsValidator extends zCore.$ZodType | ZodFields | void,
> = [ReturnsValidator] extends [zCore.$ZodType]
  ? Returns<zCore.input<ReturnsValidator>>
  : [ReturnsValidator] extends [ZodFields]
    ? Returns<zCore.input<zCore.$ZodObject<ReturnsValidator>>>
    : any;

// The return value after it's been validated: returned to the client
type ReturnValueOutput<
  ReturnsValidator extends zCore.$ZodType | ZodFields | void,
> = [ReturnsValidator] extends [zCore.$ZodType]
  ? Returns<zCore.output<ReturnsValidator>>
  : [ReturnsValidator] extends [ZodFields]
    ? Returns<zCore.output<zCore.$ZodObject<ReturnsValidator, zCore.$strict>>>
    : any;

// The args before they've been validated: passed from the client
type ArgsInput<ArgsValidator extends ZodFields | zCore.$ZodObject<any> | void> =
  [ArgsValidator] extends [zCore.$ZodObject<any>]
    ? [zCore.input<ArgsValidator>]
    : ArgsValidator extends Record<string, never>
      ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        [{}]
      : [ArgsValidator] extends [Record<string, z.ZodTypeAny>]
        ? [zCore.input<zCore.$ZodObject<ArgsValidator, zCore.$strict>>]
        : OneArgArray;

// The args after they've been validated: passed to the handler
type ArgsOutput<
  ArgsValidator extends ZodFields | zCore.$ZodObject<any> | void,
> = [ArgsValidator] extends [zCore.$ZodObject<any>]
  ? [zCore.output<ArgsValidator>]
  : [ArgsValidator] extends [ZodFields]
    ? [zCore.output<zCore.$ZodObject<ArgsValidator, zCore.$strict>>]
    : OneArgArray;

type Overwrite<T, U> = Omit<T, keyof U> & U;
type OneArgArray<ArgsObject extends DefaultFunctionArgs = DefaultFunctionArgs> =
  [ArgsObject];

// #endregion

// #region Implementation: Zod → Convex

/**
 * Return type of {@link zodToConvex}.
 */
export type ConvexValidatorFromZod<
  Z extends zCore.$ZodType,
  IsOptional extends "required" | "optional",
> =
  // `unknown` / `any`: we can’t infer a precise return type at compile time
  IsUnknownOrAny<Z> extends true
    ? GenericValidator
    : // z.default()
      Z extends zCore.$ZodDefault<infer Inner extends zCore.$ZodType> // input: Treat like optional
      ? VOptional<ConvexValidatorFromZod<Inner, "optional">>
      : // z.pipe()
        Z extends zCore.$ZodPipe<
            infer Input extends zCore.$ZodType,
            infer _Output extends zCore.$ZodType
          >
        ? ConvexValidatorFromZod<Input, IsOptional>
        : // All other schemas have the same input/output types
          // (the schemas nested in them are converted from their input)
          ConvexValidatorFromZodCommon<Z, IsOptional, "input">;

/**
 * Return type of {@link zodOutputToConvex}.
 */
export type ConvexValidatorFromZodOutput<
  Z extends zCore.$ZodType,
  IsOptional extends "required" | "optional",
> =
  // `unknown` / `any`: we can't infer a precise return type at compile time
  IsUnknownOrAny<Z> extends true
    ? GenericValidator
    : // z.default()
      Z extends zCore.$ZodDefault<infer Inner extends zCore.$ZodType> // output: always there
      ? VRequired<ConvexValidatorFromZodOutput<Inner, "required">>
      : // z.pipe() - use output schema for zodOutputToConvex
        Z extends zCore.$ZodPipe<
            infer _Input extends zCore.$ZodType,
            infer Output extends zCore.$ZodType
          >
        ? ConvexValidatorFromZodOutput<Output, IsOptional>
        : // All other schemas have the same input/output types
          // (the schemas nested in them are converted from their output)
          ConvexValidatorFromZodCommon<Z, IsOptional, "output">;

// Converts a schema nested in another one (e.g. an array element) from the
// same side as its parent, like the `toConvex` callback of zodToConvexCommon.
// `[Side]` keeps the conditional non-distributive: with a bare `Side`,
// TypeScript reports the object validators as circular (TS4109).
type ConvexValidatorFromZodSide<
  Z extends zCore.$ZodType,
  IsOptional extends "required" | "optional",
  Side extends "input" | "output",
> = [Side] extends ["input"]
  ? ConvexValidatorFromZod<Z, IsOptional>
  : ConvexValidatorFromZodOutput<Z, IsOptional>;

// Conversions used for both zodToConvex and zodOutputToConvex
type ConvexValidatorFromZodCommon<
  Z extends zCore.$ZodType,
  IsOptional extends "required" | "optional",
  Side extends "input" | "output",
> =
  // Basic types
  Z extends Zid<infer TableName>
    ? VId<GenericId<TableName>>
    : Z extends zCore.$ZodString
      ? VString<zCore.infer<Z>, IsOptional>
      : Z extends zCore.$ZodNumber
        ? VFloat64<zCore.infer<Z>, IsOptional>
        : Z extends zCore.$ZodNaN
          ? VFloat64<zCore.infer<Z>, IsOptional>
          : Z extends zCore.$ZodBigInt
            ? VInt64<zCore.infer<Z>, IsOptional>
            : Z extends zCore.$ZodBoolean
              ? VBoolean<zCore.infer<Z>, IsOptional>
              : Z extends zCore.$ZodNull
                ? VNull<zCore.infer<Z>, IsOptional>
                : Z extends zCore.$ZodUnknown
                  ? VAny<any, "required">
                  : Z extends zCore.$ZodAny
                    ? VAny<zCore.infer<Z>, "required">
                    : // z.array()
                      Z extends zCore.$ZodArray<
                          infer Inner extends zCore.$ZodType
                        >
                      ? ConvexValidatorFromZodSide<
                          Inner,
                          "required",
                          Side
                        > extends GenericValidator
                        ? VArray<
                            ConvexValidatorFromZodSide<
                              Inner,
                              "required",
                              Side
                            >["type"][],
                            ConvexValidatorFromZodSide<Inner, "required", Side>,
                            IsOptional
                          >
                        : never
                      : // z.object()
                        Z extends zCore.$ZodObject<
                            infer Fields extends Readonly<zCore.$ZodShape>
                          >
                        ? // z.brand()
                          // The Type slot comes from Zod's own (recursion-safe)
                          // inferred type, with `| undefined` stripped from
                          // optional props so it stays assignable to
                          // `Record<string, Value>` under
                          // `exactOptionalPropertyTypes`. We deliberately do NOT
                          // map `ObjectType<F>` over the validator record here, and
                          // we pass `ConvexObjectFromZodShape<Fields, Side>` straight
                          // through rather than binding it via
                          // `extends infer F extends Record<string, GenericValidator>`:
                          // both force the self-referential record to expand
                          // eagerly, which makes tsc emit — and on TS 5.5–6.0 crash
                          // while emitting — the TS2615 circular-reference
                          // diagnostic. Keeping the record lazy lets recursive
                          // schemas degrade to a recoverable error instead.
                          // `$ZodBranded<$ZodObject>` is structurally
                          // `$ZodObject & ...`, so this branch also matches branded
                          // objects. Drop the `[$brand]` key so that `EOPTInfer`
                          // doesn't expand it into a regular property, then
                          // reattach every brand (`.brand("A").brand("B")` keeps
                          // both). The brands come from the inferred type rather
                          // than from `$ZodBranded<infer Inner, infer Brand>`,
                          // which only gives the outermost brand (and, before
                          // Zod 4.3, the branded schema itself as `Inner` for
                          // zod/mini).
                          zCore.infer<Z> extends zCore.$brand<infer Brand>
                          ? VObject<
                              EOPTInfer<
                                Omit<zCore.infer<Z>, typeof zCore.$brand>
                              > &
                                zCore.$brand<Brand>,
                              ConvexObjectFromZodShape<Fields, Side>,
                              IsOptional
                            >
                          : VObject<
                              EOPTInfer<zCore.infer<Z>>,
                              ConvexObjectFromZodShape<Fields, Side>,
                              IsOptional
                            >
                        : // z.never() (→ z.union() with no elements)
                          Z extends zCore.$ZodNever
                          ? VUnion<never, [], IsOptional, never>
                          : // z.union()
                            Z extends zCore.$ZodUnion<
                                infer T extends readonly zCore.$ZodType[]
                              >
                            ? ConvexUnionValidatorFromZod<T, Side>
                            : // z.tuple()
                              Z extends zCore.$ZodTuple<
                                  infer Inner extends readonly zCore.$ZodType[],
                                  infer Rest extends null | zCore.$ZodType
                                >
                              ? VArray<
                                  null extends Rest
                                    ? Array<
                                        ConvexValidatorFromZodSide<
                                          Inner[number],
                                          "required",
                                          Side
                                        >["type"]
                                      >
                                    : Array<
                                        | ConvexValidatorFromZodSide<
                                            Inner[number],
                                            "required",
                                            Side
                                          >["type"]
                                        | zCore.infer<Rest>
                                      >,
                                  null extends Rest
                                    ? ConvexUnionValidatorFromZod<Inner, Side>
                                    : ConvexUnionValidatorFromZod<
                                        [
                                          ...Inner,
                                          Rest extends zCore.$ZodType // won’t be null here
                                            ? Rest
                                            : never,
                                        ],
                                        Side
                                      >,
                                  IsOptional
                                >
                              : // z.literal()
                                Z extends zCore.$ZodLiteral<
                                    infer Literal extends zCore.util.Literal
                                  >
                                ? ConvexLiteralFromZod<Literal, IsOptional>
                                : // z.enum()
                                  Z extends zCore.$ZodEnum<
                                      infer EnumContents extends
                                        zCore.util.EnumLike
                                    >
                                  ? VUnion<
                                      zCore.infer<Z>,
                                      keyof EnumContents extends string
                                        ? {
                                            [K in keyof EnumContents]: VLiteral<
                                              EnumContents[K],
                                              "required"
                                            >;
                                          }[keyof EnumContents][]
                                        : never,
                                      IsOptional
                                    >
                                  : // z.optional()
                                    Z extends zCore.$ZodOptional<
                                        infer Inner extends zCore.$ZodType
                                      >
                                    ? VOptional<
                                        ConvexValidatorFromZodSide<
                                          Inner,
                                          "optional",
                                          Side
                                        >
                                      >
                                    : // z.nonoptional()
                                      Z extends zCore.$ZodNonOptional<
                                          infer Inner extends zCore.$ZodType
                                        >
                                      ? VRequired<
                                          ConvexValidatorFromZodSide<
                                            Inner,
                                            "required",
                                            Side
                                          >
                                        >
                                      : // z.nullable()
                                        Z extends zCore.$ZodNullable<
                                            infer Inner extends zCore.$ZodType
                                          >
                                        ? ConvexValidatorFromZodSide<
                                            Inner,
                                            IsOptional,
                                            Side
                                          > extends Validator<
                                            any,
                                            "optional",
                                            any
                                          >
                                          ? VUnion<
                                              | ConvexValidatorFromZodSide<
                                                  Inner,
                                                  IsOptional,
                                                  Side
                                                >["type"]
                                              | null
                                              | undefined,
                                              [
                                                VRequired<
                                                  ConvexValidatorFromZodSide<
                                                    Inner,
                                                    IsOptional,
                                                    Side
                                                  >
                                                >,
                                                VNull,
                                              ],
                                              "optional",
                                              ConvexValidatorFromZodSide<
                                                Inner,
                                                IsOptional,
                                                Side
                                              >["fieldPaths"]
                                            >
                                          : VUnion<
                                              | ConvexValidatorFromZodSide<
                                                  Inner,
                                                  IsOptional,
                                                  Side
                                                >["type"]
                                              | null,
                                              [
                                                VRequired<
                                                  ConvexValidatorFromZodSide<
                                                    Inner,
                                                    IsOptional,
                                                    Side
                                                  >
                                                >,
                                                VNull,
                                              ],
                                              IsOptional,
                                              ConvexValidatorFromZodSide<
                                                Inner,
                                                IsOptional,
                                                Side
                                              >["fieldPaths"]
                                            >
                                        : // z.record()
                                          Z extends zCore.$ZodRecord<
                                              infer Key extends
                                                zCore.$ZodRecordKey,
                                              infer Value extends zCore.$ZodType
                                            >
                                          ? ConvexValidatorFromZodRecord<
                                              Key,
                                              Value,
                                              IsOptional,
                                              Side
                                            >
                                          : // z.readonly()
                                            Z extends zCore.$ZodReadonly<
                                                infer Inner extends
                                                  zCore.$ZodType
                                              >
                                            ? ConvexValidatorFromZodSide<
                                                Inner,
                                                IsOptional,
                                                Side
                                              >
                                            : // z.lazy()
                                              Z extends zCore.$ZodLazy<
                                                  infer Inner extends
                                                    zCore.$ZodType
                                                >
                                              ? ConvexValidatorFromZodSide<
                                                  Inner,
                                                  IsOptional,
                                                  Side
                                                >
                                              : // z.templateLiteral()
                                                Z extends zCore.$ZodTemplateLiteral<
                                                    infer Template extends
                                                      string
                                                  >
                                                ? VString<Template, IsOptional>
                                                : // z.catch()
                                                  Z extends zCore.$ZodCatch<
                                                      infer T extends
                                                        zCore.$ZodType
                                                    >
                                                  ? ConvexValidatorFromZodSide<
                                                      T,
                                                      IsOptional,
                                                      Side
                                                    >
                                                  : // z.transform()
                                                    Z extends zCore.$ZodTransform<
                                                        any,
                                                        any
                                                      >
                                                    ? VAny<any, "required"> // No runtime info about types so we use v.any()
                                                    : // z.custom()
                                                      Z extends zCore.$ZodCustom<any>
                                                      ? VAny<any, "required">
                                                      : // z.intersection()
                                                        // We could do some more advanced logic here where we compute
                                                        // the Convex validator that results from the intersection.
                                                        // For now, we simply use v.any()
                                                        Z extends zCore.$ZodIntersection<any>
                                                        ? VAny<any, "required">
                                                        : // unencodable types
                                                          IsConvexUnencodableType<Z> extends true
                                                          ? never
                                                          : // Other validators: we don’t return VAny
                                                            // because it might be a type that is
                                                            // recognized at runtime but is not
                                                            // recognized at typecheck time
                                                            // (e.g. zCore.$ZodType<string>)
                                                            GenericValidator;

type ConvexUnionValidatorFromZod<
  T extends readonly zCore.$ZodType[],
  Side extends "input" | "output",
> = VUnion<
  ConvexValidatorFromZodSide<T[number], "required", Side>["type"],
  T extends readonly [
    infer Head extends zCore.$ZodType,
    ...infer Tail extends zCore.$ZodType[],
  ]
    ? [
        VRequired<ConvexValidatorFromZodSide<Head, "required", Side>>,
        ...ConvexUnionValidatorFromZodMembers<Tail, Side>,
      ]
    : T extends readonly []
      ? []
      : Validator<any, "required", any>[],
  "required",
  ConvexValidatorFromZodSide<T[number], "required", Side>["fieldPaths"]
>;

type ConvexUnionValidatorFromZodMembers<
  T extends readonly zCore.$ZodType[],
  Side extends "input" | "output",
> = T extends readonly [
  infer Head extends zCore.$ZodType,
  ...infer Tail extends zCore.$ZodType[],
]
  ? [
      VRequired<ConvexValidatorFromZodSide<Head, "required", Side>>,
      ...ConvexUnionValidatorFromZodMembers<Tail, Side>,
    ]
  : T extends readonly []
    ? []
    : Validator<any, "required", any>[];

type ConvexObjectFromZodShape<
  Fields extends Readonly<zCore.$ZodShape>,
  Side extends "input" | "output",
> = Fields extends infer F // dark magic to get the TypeScript compiler happy about circular types
  ? {
      [K in keyof F]: F[K] extends zCore.$ZodType
        ? ConvexValidatorFromZodSide<F[K], "required", Side>
        : Validator<any, "required", any>;
    }
  : never;

// EOPTInfer<{ a?: string | undefined }> = { a?: string }
// Recursively drops `| undefined` from optional properties so the Type slot
// matches `ObjectType<F>` and stays assignable to Convex's `Value` (which
// excludes `undefined`) under `exactOptionalPropertyTypes: true`.
//
// Branded primitives must short-circuit before the `extends object` branch:
// `GenericId<T>` is `string & { __tableName: T }`, which satisfies
// `extends object`. Without this guard, the mapped type below would enumerate
// every `string` prototype member, inflating a `zid` field into
// `{ [x: number]: string; toString: {}; …; __tableName: T }` instead of leaving
// it as `GenericId<T>`.
type EOPTInfer<T> = T extends readonly unknown[]
  ? { [K in keyof T]: EOPTInfer<T[K]> }
  : T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : T extends object
      ? Expand<
          {
            [K in keyof T as undefined extends T[K] ? never : K]: EOPTInfer<
              T[K]
            >;
          } & {
            [K in keyof T as undefined extends T[K] ? K : never]?: EOPTInfer<
              Exclude<T[K], undefined>
            >;
          }
        >
      : T;

// Shape for the literal-keyed `z.record()` path (via
// `ConvexObjectValidatorFromRecord`). The keys are fixed string literals, so the
// validator record is never self-referential here and Convex's own
// `ObjectType<F>` is safe to use; it strips `| undefined` from optional value
// positions so the result is assignable to `Record<string, Value>` under
// `exactOptionalPropertyTypes: true`.
type BridgedObject<
  F extends Record<string, GenericValidator>,
  IsOptional extends "required" | "optional",
> = VObject<ObjectType<F>, F, IsOptional>;

type ConvexObjectValidatorFromRecord<
  Key extends string,
  Value extends zCore.$ZodType,
  IsOptional extends "required" | "optional",
  IsPartial extends "partial" | "full",
  Side extends "input" | "output",
> = (
  IsPartial extends "partial"
    ? {
        [K in Key]: VOptional<
          ConvexValidatorFromZodSide<Value, "required", Side>
        >;
      }
    : {
        [K in Key]: ConvexValidatorFromZodSide<Value, "required", Side>;
      }
) extends infer F extends Record<string, GenericValidator>
  ? BridgedObject<F, IsOptional>
  : never;

type ConvexValidatorFromZodRecord<
  Key extends zCore.$ZodRecordKey,
  Value extends zCore.$ZodType,
  IsOptional extends "required" | "optional",
  Side extends "input" | "output",
> =
  // key = v.string() / v.id() / v.union(v.id())
  Key extends
    | zCore.$ZodString
    | Zid<any>
    | zCore.$ZodUnion<infer _Ids extends readonly Zid<any>[]>
    ? VRecord<
        Record<zCore.infer<Key>, NotUndefined<zCore.infer<Value>>>,
        VRequired<ConvexValidatorFromZodSide<Key, "required", Side>>,
        VRequired<ConvexValidatorFromZodSide<Value, "required", Side>>,
        IsOptional
      >
    : // key = v.literal()
      Key extends zCore.$ZodLiteral<infer Literal extends string>
      ? ConvexObjectValidatorFromRecord<
          Literal,
          Value,
          IsOptional,
          Key extends zCore.$partial ? "partial" : "full",
          Side
        >
      : // key = v.union(v.literal())
        Key extends zCore.$ZodUnion<
            infer Literals extends readonly zCore.$ZodLiteral[]
          >
        ? ConvexObjectValidatorFromRecord<
            zCore.infer<Literals[number]> extends string
              ? zCore.infer<Literals[number]>
              : never,
            Value,
            IsOptional,
            Key extends zCore.$partial ? "partial" : "full",
            Side
          >
        : // key = z.enum()
          Key extends zCore.$ZodEnum
          ? zCore.infer<Key> extends string
            ? ConvexObjectValidatorFromRecord<
                zCore.infer<Key>,
                Value,
                IsOptional,
                Key extends zCore.$partial ? "partial" : "full",
                Side
              >
            : VRecord<
                Record<string, NotUndefined<zCore.infer<Value>>>,
                VString<string, "required">,
                VRequired<ConvexValidatorFromZodSide<Value, "required", Side>>,
                IsOptional
              >
          : // key = v.any() / otehr
            VRecord<
              Record<string, NotUndefined<zCore.infer<Value>>>,
              VString<string, "required">,
              VRequired<ConvexValidatorFromZodSide<Value, "required", Side>>,
              IsOptional
            >;

type IsConvexUnencodableType<Z extends zCore.$ZodType> = Z extends
  | zCore.$ZodDate
  | zCore.$ZodSymbol
  | zCore.$ZodMap
  | zCore.$ZodSet
  | zCore.$ZodPromise
  | zCore.$ZodFile
  | zCore.$ZodFunction
  // undefined is not a valid Convex value. Consider using v.optional() or v.null() instead
  | zCore.$ZodUndefined
  | zCore.$ZodVoid
  ? true
  : false;

type IsUnion<T, U extends T = T> = T extends unknown
  ? [U] extends [T]
    ? false
    : true
  : false;
type ConvexLiteralFromZod<
  Literal extends zCore.util.Literal,
  IsOptional extends "required" | "optional",
> = undefined extends Literal // undefined is not a valid Convex valvue
  ? never
  : // z.literal(null) → v.null()
    [Literal] extends [null]
    ? VNull<null, IsOptional>
    : // z.literal([…]) (multiple values)
      IsUnion<Literal> extends true
      ? VUnion<
          Literal,
          Array<
            // `extends unknown` forces TypeScript to map over each member of the union
            Literal extends unknown
              ? ConvexLiteralFromZod<Literal, "required">
              : never
          >,
          IsOptional,
          never
        >
      : VLiteral<Literal, IsOptional>;

type IsUnknownOrAny<T> =
  // any?
  0 extends 1 & T
    ? true
    : // unknown?
      unknown extends T
      ? true
      : false;

function zodToConvexCommon<Z extends zCore.$ZodType>(
  validator: Z,
  toConvex: (x: zCore.$ZodType) => GenericValidator,
): GenericValidator {
  if (validator instanceof zCore.$ZodString) {
    return v.string();
  }

  if (
    validator instanceof zCore.$ZodNumber ||
    validator instanceof zCore.$ZodNaN
  ) {
    return v.number();
  }

  if (validator instanceof zCore.$ZodBigInt) {
    return v.int64();
  }

  if (validator instanceof zCore.$ZodBoolean) {
    return v.boolean();
  }

  if (validator instanceof zCore.$ZodNull) {
    return v.null();
  }

  if (
    validator instanceof zCore.$ZodAny ||
    validator instanceof zCore.$ZodUnknown
  ) {
    return v.any();
  }

  if (validator instanceof zCore.$ZodArray) {
    const inner = toConvex(validator._zod.def.element);
    if (inner.isOptional === "optional") {
      throw new Error("Arrays of optional values are not supported");
    }
    return v.array(inner);
  }

  if (validator instanceof zCore.$ZodObject) {
    return v.object(
      Object.fromEntries(
        Object.entries(validator._zod.def.shape).map(([k, v]) => [
          k,
          toConvex(v),
        ]),
      ),
    );
  }

  if (validator instanceof zCore.$ZodUnion) {
    return v.union(...validator._zod.def.options.map(toConvex));
  }

  if (validator instanceof zCore.$ZodNever) {
    return v.union();
  }

  if (validator instanceof zCore.$ZodTuple) {
    const { items, rest } = validator._zod.def;
    return v.array(
      v.union(
        ...[
          ...items,
          // + rest if set
          ...(rest !== null ? [rest] : []),
        ].map(toConvex),
      ),
    );
  }

  if (validator instanceof zCore.$ZodLiteral) {
    const { values } = validator._zod.def;
    if (values.length === 1) {
      return convexToZodLiteral(values[0]);
    }

    return v.union(...values.map(convexToZodLiteral));
  }

  if (validator instanceof zCore.$ZodEnum) {
    return v.union(
      ...Object.entries(validator._zod.def.entries)
        .filter(([key, value]) => key === value || isNaN(Number(key)))
        .map(([_key, value]) => v.literal(value)),
    );
  }

  if (validator instanceof zCore.$ZodOptional) {
    return v.optional(toConvex(validator._zod.def.innerType));
  }

  if (validator instanceof zCore.$ZodNonOptional) {
    return vRequired(toConvex(validator._zod.def.innerType));
  }

  if (validator instanceof zCore.$ZodNullable) {
    const inner = toConvex(validator._zod.def.innerType);

    // Invert z.optional().nullable() → v.optional(v.nullable())
    if (inner.isOptional === "optional") {
      return v.optional(v.union(vRequired(inner), v.null()));
    }

    return v.union(inner, v.null());
  }

  if (validator instanceof zCore.$ZodRecord) {
    const { keyType, valueType } = validator._zod.def;

    // Zod < 4.5 marks partial records by clearing the key values, Zod ≥ 4.5
    // sets `def.partial` instead (and keeps the key values).
    const isPartial =
      keyType._zod.values === undefined ||
      (validator._zod.def as { partial?: boolean }).partial === true;

    // Convert value type, stripping optional
    const valueValidator = toConvex(valueType);

    // Convert key type
    const keyValidator = toConvex(keyType);

    // key = string literals?
    // If so, not supported by v.record() → use v.object() instead
    const stringLiterals = extractStringLiterals(keyValidator);
    if (stringLiterals !== null) {
      const fieldValue =
        isPartial || valueValidator.isOptional === "optional"
          ? v.optional(valueValidator)
          : vRequired(valueValidator);
      const fields: Record<string, GenericValidator> = {};
      for (const literal of stringLiterals) {
        fields[literal] = fieldValue;
      }
      return v.object(fields);
    }

    return v.record(
      isValidRecordKey(keyValidator) ? keyValidator : v.string(),
      vRequired(valueValidator),
    );
  }

  if (validator instanceof zCore.$ZodReadonly) {
    return toConvex(validator._zod.def.innerType);
  }

  if (validator instanceof zCore.$ZodLazy) {
    return toConvex(validator._zod.def.getter());
  }

  if (validator instanceof zCore.$ZodTemplateLiteral) {
    return v.string();
  }

  if (validator instanceof zCore.$ZodCustom) {
    // Check for zid (Convex ID) validators inside the $ZodCustom branch
    // since zid() produces a $ZodCustom. Keeping this check here (rather
    // than at the top of the function) ensures type-specific instanceof
    // handlers always take priority.
    const idTableName = _zidRegistry.get(validator);
    if (
      idTableName !== undefined &&
      typeof idTableName.tableName === "string"
    ) {
      return v.id(idTableName.tableName);
    }
    return v.any();
  }

  if (validator instanceof zCore.$ZodIntersection) {
    return v.any();
  }

  if (validator instanceof zCore.$ZodCatch) {
    return toConvex(validator._zod.def.innerType);
  }

  if (
    validator instanceof zCore.$ZodDate ||
    validator instanceof zCore.$ZodSymbol ||
    validator instanceof zCore.$ZodMap ||
    validator instanceof zCore.$ZodSet ||
    validator instanceof zCore.$ZodPromise ||
    validator instanceof zCore.$ZodFile ||
    validator instanceof zCore.$ZodFunction ||
    validator instanceof zCore.$ZodVoid ||
    validator instanceof zCore.$ZodUndefined
  ) {
    throw new Error(
      `Validator ${validator.constructor.name} is not supported in Convex`,
    );
  }

  // Unsupported type
  return v.any();
}

function convexToZodLiteral(literal: zCore.util.Literal): GenericValidator {
  if (literal === undefined) {
    throw new Error("undefined is not a valid Convex value");
  }

  if (literal === null) {
    return v.null();
  }

  return v.literal(literal);
}

function extractStringLiterals(validator: GenericValidator): string[] | null {
  if (validator.kind === "literal") {
    const literalValidator = validator as VLiteral<any>;
    if (typeof literalValidator.value === "string") {
      return [literalValidator.value];
    }
    return null;
  }
  if (validator.kind === "union") {
    const unionValidator = validator as VUnion<any, any, any, any>;
    const literals: string[] = [];
    for (const member of unionValidator.members) {
      const memberLiterals = extractStringLiterals(member);
      if (memberLiterals === null) {
        return null; // Not all members are string literals
      }
      literals.push(...memberLiterals);
    }
    return literals;
  }
  return null; // Not a literal or union of literals
}

function isValidRecordKey(validator: GenericValidator): boolean {
  if (validator.kind === "string" || validator.kind === "id") {
    return true;
  }
  if (validator.kind === "union") {
    const unionValidator = validator as VUnion<any, any, any, any>;
    return unionValidator.members.every(isValidRecordKey);
  }
  return false;
}

// #endregion

// #region Implementation: Convex → Zod

/**
 * Better type conversion from a Convex validator to a Zod validator
 * where the output is not a generic ZodType but it's more specific.
 *
 * This allows you to use methods specific to the Zod type (e.g. `.email()` for `z.ZodString`).
 *
 * ```ts
 * ZodValidatorFromConvex<typeof v.string()> // → z.ZodString
 * ```
 */
export type ZodValidatorFromConvex<V extends GenericValidator> =
  V extends Validator<any, "optional", any>
    ? z.ZodOptional<ZodFromValidatorBase<VRequired<V>>>
    : ZodFromValidatorBase<V>;

export type ZodFromValidatorBase<V extends GenericValidator> =
  V extends VId<infer Type>
    ? Zid<TableNameFromType<NotUndefined<Type>>>
    : V extends VString<infer T>
      ? BrandIfBranded<T, z.ZodString>
      : V extends VFloat64<infer T>
        ? BrandIfBranded<T, z.ZodNumber>
        : V extends VInt64<any>
          ? z.ZodBigInt
          : V extends VCommitTs<any>
            ? z.ZodUnion<
                readonly [
                  z.ZodBigInt,
                  // `ZodCustom` before Zod 4.6, `ZodInstanceOf` since then
                  ReturnType<typeof z.instanceof<typeof CommitTsPlaceholder>>,
                ]
              >
            : V extends VBoolean<any>
              ? z.ZodBoolean
              : V extends VNull<any>
                ? z.ZodNull
                : V extends VArray<any, infer Element>
                  ? Element extends VArray<any, any> // This check is used to avoid TypeScript complaining about infinite type instantiation
                    ? z.ZodArray<zCore.SomeType>
                    : z.ZodArray<ZodFromValidatorBase<Element>>
                  : V extends VObject<
                        any,
                        infer Fields extends Record<string, GenericValidator>
                      >
                    ? z.ZodObject<
                        ZodShapeFromConvexObject<Fields>,
                        zCore.$strict
                      >
                    : V extends VBytes<any, any>
                      ? never
                      : V extends VLiteral<
                            infer T extends zCore.util.Literal,
                            OptionalProperty
                          >
                        ? z.ZodLiteral<NotUndefined<T>>
                        : V extends VRecord<
                              any,
                              infer Key,
                              infer Value,
                              OptionalProperty,
                              any
                            >
                          ? // Like the union fallback below, stop when the value is the
                            // maximally-generic validator type (e.g. while TypeScript
                            // infers `V` of `convexToZod` from its expected return
                            // type). Otherwise this recurses into itself, which is
                            // too deep to typecheck since zod 4.6.6.
                            [GenericValidator] extends [Value]
                            ? z.ZodRecord<
                                ZodFromStringValidator<Key>,
                                zCore.SomeType
                              >
                            : z.ZodRecord<
                                ZodFromStringValidator<Key>,
                                ZodFromValidatorBase<Value>
                              >
                          : // Union: must handle separately cases for 0/1/2+ elements
                            // instead of simply writing it as
                            // V extends VUnion<any, infer Elements extends GenericValidator[], any, any>
                            //                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                            //   ? z.ZodUnion<{ [k in keyof Elements]: ZodValidatorFromConvex<Elements[k]> }>
                            //                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                            // because the TypeScript compiler would complain about infinite type instantiation otherwise :(
                            V extends VUnion<any, [], OptionalProperty, any>
                            ? z.ZodNever
                            : V extends VUnion<
                                  any,
                                  [infer I extends GenericValidator],
                                  OptionalProperty,
                                  any
                                >
                              ? ZodValidatorFromConvex<I>
                              : V extends VUnion<
                                    any,
                                    [
                                      infer A extends GenericValidator,
                                      ...infer Rest extends GenericValidator[],
                                    ],
                                    OptionalProperty,
                                    any
                                  >
                                ? z.ZodUnion<
                                    readonly [
                                      ZodValidatorFromConvex<A>,
                                      ...{
                                        [
                                          K in keyof Rest
                                        ]: ZodValidatorFromConvex<Rest[K]>;
                                      },
                                    ]
                                  >
                                : // Fallback for unions whose members are a
                                  // generic array (e.g. `VLiteral<X>[]`) rather
                                  // than a tuple. That happens when callers
                                  // spread an array into `v.union(...)` and
                                  // TypeScript cannot recover the tuple shape;
                                  // the order is unknown, so we widen to a
                                  // generic-array union of the element
                                  // validator. The `[GenericValidator] extends [E]`
                                  // guard avoids infinite recursion when `E` is the
                                  // maximally-generic validator type — that
                                  // happens during recursive type evaluation of
                                  // `convexToZod` itself.
                                  V extends VUnion<
                                      any,
                                      (infer E extends GenericValidator)[],
                                      OptionalProperty,
                                      any
                                    >
                                  ? [GenericValidator] extends [E]
                                    ? z.ZodUnion<readonly zCore.SomeType[]>
                                    : z.ZodUnion<
                                        readonly ZodValidatorFromConvex<E>[]
                                      >
                                  : V extends VAny<any, OptionalProperty, any>
                                    ? z.ZodAny
                                    : never;

type BrandIfBranded<InnerType, Validator extends zCore.SomeType> =
  InnerType extends zCore.$brand<infer Brand>
    ? zCore.$ZodBranded<Validator, Brand>
    : Validator;

type StringValidator = Validator<string, "required", any>;
type ZodFromStringValidator<V extends StringValidator> =
  V extends VId<GenericId<infer TableName extends string>>
    ? Zid<TableName>
    : V extends VString<infer T, any>
      ? BrandIfBranded<T, z.ZodString>
      : // Literals
        V extends VLiteral<infer Literal extends string>
        ? z.ZodLiteral<Literal>
        : // Union (see below)
          V extends VUnion<any, [], any, any>
          ? z.ZodNever
          : V extends VUnion<any, [infer I extends GenericValidator], any, any>
            ? ZodFromStringValidator<I>
            : V extends VUnion<
                  any,
                  [
                    infer A extends GenericValidator,
                    ...infer Rest extends GenericValidator[],
                  ],
                  any,
                  any
                >
              ? z.ZodUnion<
                  readonly [
                    ZodFromStringValidator<A>,
                    ...{
                      [K in keyof Rest]: ZodFromStringValidator<Rest[K]>;
                    },
                  ]
                >
              : never;

type ZodShapeFromConvexObject<Fields extends Record<string, GenericValidator>> =
  Fields extends infer F // dark magic to get the TypeScript compiler happy about circular types
    ? {
        [K in keyof F]: F[K] extends GenericValidator
          ? ZodValidatorFromConvex<F[K]>
          : never;
      }
    : never;

// #endregion

// #region Implementation: zid

/** Stores the table names for each `Zid` instance that is created. */
const _zidRegistry = zCore.registry<{ tableName: string }>();

// #endregion

// #region Implementation: Utilities

type NotUndefined<T> = Exclude<T, undefined>;

type TableNameFromType<T> =
  T extends GenericId<infer TableName> ? TableName : string;

// #endregion
