import type { ZodTypeDef } from "zod/v3";
import { ZodFirstPartyTypeKind, z } from "zod/v3";
import type {
  GenericId,
  Infer,
  ObjectType,
  OptionalProperty,
  PropertyValidators,
  Value,
  VArray,
  VAny,
  VString,
  VId,
  VUnion,
  VFloat64,
  VFunction,
  VInt64,
  VCommitTs,
  VBoolean,
  VNull,
  VLiteral,
  GenericValidator,
  VOptional,
  VObject,
  Validator,
  VRecord,
} from "convex/values";
import { CommitTsPlaceholder, ConvexError, v } from "convex/values";
import type {
  FunctionVisibility,
  GenericDataModel,
  GenericActionCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder,
  GenericMutationCtx,
  ActionBuilder,
  TableNamesInDataModel,
  DefaultFunctionArgs,
  ArgsArrayToObject,
  FunctionType,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used in docs only
  defineTable,
} from "convex/server";
import type { Customization, Registration } from "./customFunctions.js";
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used in docs only
  customQuery,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used in docs only
  customMutation,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used in docs only
  customAction,
  NoOp,
} from "./customFunctions.js";
import { pick } from "../index.js";
import { addFieldsToValidator, validate, vRequired } from "../validators.js";

export type ZodValidator = Record<string, z.ZodTypeAny>;

/**
 * Creates a validator for a Convex `Id`.
 *
 * - When **used within Zod**, it will only check that the ID is a string.
 * - When **converted to a Convex validator** (e.g. through {@link zodToConvex}),
 *   it will check that it's for the right table.
 *
 * @param tableName - The table that the `Id` references. i.e. `Id<tableName>`
 * @returns A Zod object representing a Convex `Id`
 */
export const zid = <
  DataModel extends GenericDataModel,
  TableName extends TableNamesInDataModel<DataModel> =
    TableNamesInDataModel<DataModel>,
>(
  tableName: TableName,
) => new Zid({ typeName: "ConvexId", tableName });

/**
 * Creates a validator for a Convex commit timestamp, the Zod equivalent of
 * `v.commitTs()`.
 *
 * It accepts a `bigint`, or the `CommitTsPlaceholder` that `db.vars.commitTs`
 * leaves in a document when you read it back in the mutation that wrote it.
 * When converted to a Convex validator (e.g. through {@link zodToConvex}), it
 * becomes `v.commitTs()`.
 *
 * @returns A Zod schema representing a Convex commit timestamp
 */
export const zCommitTs = () => new ZCommitTs({ typeName: "ConvexCommitTs" });

/**
 * Creates a validator for a Convex function handle, the Zod equivalent of
 * `v.function()`. It takes the same optional signature.
 *
 * - When **used within Zod**, it checks that the value is a string starting
 *   with `function://`. The signature is only checked by TypeScript.
 * - When **converted to a Convex validator** (e.g. through {@link zodToConvex}),
 *   it becomes the equivalent `v.function()`, with its signature.
 *
 * @returns A Zod schema representing a Convex function handle
 */
export const zFunction = <
  Type extends FunctionType | undefined = undefined,
  Args extends GenericValidator | PropertyValidators | undefined = undefined,
  Returns extends GenericValidator | PropertyValidators | undefined = undefined,
>(signature?: {
  fnType?: Type;
  args?: Args;
  returns?: Returns;
}) =>
  new ZFunction({
    typeName: "ConvexFunction",
    validator: v.function(signature),
  });

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

/**
 * `zCustomQuery` is like {@link customQuery}, but allows validation via Zod.
 * You can define custom behavior on top of `query` or `internalQuery`
 * by passing a function that modifies the ctx and args. Or {@link NoOp} to do nothing.
 *
 * Example usage:
 * ```js
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
 * ```js
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
 * @returns A new query builder using Zod validation to define queries.
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
 * `zCustomMutation` is like {@link customMutation}, but allows validation via Zod.
 * You can define custom behavior on top of `mutation` or `internalMutation`
 * by passing a function that modifies the ctx and args. Or {@link NoOp} to do nothing.
 *
 * Example usage:
 * ```js
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
 * ```js
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
 * @returns A new mutation builder using Zod validation to define queries.
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
 * `zCustomAction` is like {@link customAction}, but allows validation via Zod.
 * You can define custom behavior on top of `action` or `internalAction`
 * by passing a function that modifies the ctx and args. Or {@link NoOp} to do nothing.
 *
 * Example usage:
 * ```js
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
 * ```js
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
 * @returns A new action builder using Zod validation to define queries.
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

function customFnBuilder(
  builder: (args: any) => any,
  customization: Customization<any, any, any, any, any>,
) {
  // Most of the code in here is identical to customFnBuilder in zod4.ts.
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
      maybeObject && !(maybeObject instanceof z.ZodType)
        ? z.object(maybeObject)
        : maybeObject;

    const returnValidator =
      returns && !skipConvexValidation
        ? { returns: zodOutputToConvex(returns) }
        : null;

    if (args) {
      let argsValidator = args;
      if (argsValidator instanceof z.ZodType) {
        if (argsValidator instanceof z.ZodObject) {
          argsValidator = argsValidator._def.shape();
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
          const parsed = z.object(argsValidator).safeParse(rawArgs);
          if (!parsed.success) {
            throw new ConvexError({
              ZodError: JSON.parse(
                JSON.stringify(parsed.error.errors, null, 2),
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
            ? returns.parse(ret === undefined ? null : ret)
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
          ? returns.parse(ret === undefined ? null : ret)
          : ret;
        if (added.onSuccess) {
          await added.onSuccess({ ctx, args, result });
        }
        return result;
      },
    });
  };
}

type OneArgArray<ArgsObject extends DefaultFunctionArgs = DefaultFunctionArgs> =
  [ArgsObject];

// Copied from convex/src/server/api.ts since they aren't exported
type NullToUndefinedOrNull<T> = T extends null ? T | undefined | void : T;
type Returns<T> = Promise<NullToUndefinedOrNull<T>> | NullToUndefinedOrNull<T>;

// The return value before it's been validated: returned by the handler
type ReturnValueInput<
  ReturnsValidator extends z.ZodTypeAny | ZodValidator | void,
> = [ReturnsValidator] extends [z.ZodTypeAny]
  ? Returns<z.input<ReturnsValidator>>
  : [ReturnsValidator] extends [ZodValidator]
    ? Returns<z.input<z.ZodObject<ReturnsValidator>>>
    : any;

// The return value after it's been validated: returned to the client
type ReturnValueOutput<
  ReturnsValidator extends z.ZodTypeAny | ZodValidator | void,
> = [ReturnsValidator] extends [z.ZodTypeAny]
  ? Returns<z.output<ReturnsValidator>>
  : [ReturnsValidator] extends [ZodValidator]
    ? Returns<z.output<z.ZodObject<ReturnsValidator>>>
    : any;

// The args before they've been validated: passed from the client
type ArgsInput<ArgsValidator extends ZodValidator | z.ZodObject<any> | void> = [
  ArgsValidator,
] extends [z.ZodObject<any>]
  ? [z.input<ArgsValidator>]
  : [ArgsValidator] extends [ZodValidator]
    ? [z.input<z.ZodObject<ArgsValidator>>]
    : OneArgArray;

// The args after they've been validated: passed to the handler
type ArgsOutput<ArgsValidator extends ZodValidator | z.ZodObject<any> | void> =
  [ArgsValidator] extends [z.ZodObject<any>]
    ? [z.output<ArgsValidator>]
    : [ArgsValidator] extends [ZodValidator]
      ? [z.output<z.ZodObject<ArgsValidator>>]
      : OneArgArray;

type Overwrite<T, U> = Omit<T, keyof U> & U;

/*
 * Hack! This type causes TypeScript to simplify how it renders object types.
 *
 * It is functionally the identity for object types, but in practice it can
 * simplify expressions like `A & B`.
 */
type Expand<ObjectType extends Record<any, any>> =
  ObjectType extends Record<any, any>
    ? {
        [Key in keyof ObjectType]: ObjectType[Key];
      }
    : never;

type ArgsForHandlerType<
  OneOrZeroArgs extends [] | [Record<string, any>],
  CustomMadeArgs extends Record<string, any>,
> =
  CustomMadeArgs extends Record<string, never>
    ? OneOrZeroArgs
    : OneOrZeroArgs extends [infer A]
      ? [Expand<A & CustomMadeArgs>]
      : [CustomMadeArgs];

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
    ArgsValidator extends ZodValidator | z.ZodObject<any> | void,
    ReturnsZodValidator extends z.ZodTypeAny | ZodValidator | void = void,
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

type ConvexUnionValidatorFromZod<T> = T extends z.ZodTypeAny[]
  ? VUnion<
      ConvexValidatorFromZod<T[number]>["type"],
      {
        [Index in keyof T]: T[Index] extends z.ZodTypeAny
          ? ConvexValidatorFromZod<T[Index]>
          : never;
      },
      "required",
      ConvexValidatorFromZod<T[number]>["fieldPaths"]
    >
  : never;

type ConvexObjectValidatorFromZod<T extends ZodValidator> = VObject<
  ObjectType<{
    [key in keyof T]: T[key] extends z.ZodTypeAny
      ? ConvexValidatorFromZod<T[key]>
      : never;
  }>,
  {
    [key in keyof T]: ConvexValidatorFromZod<T[key]>;
  }
>;

type ConvexObjectValidatorFromZodOutput<T extends ZodValidator> = VObject<
  ObjectType<{
    [key in keyof T]: T[key] extends z.ZodTypeAny
      ? ConvexValidatorFromZodOutput<T[key]>
      : never;
  }>,
  {
    [key in keyof T]: ConvexValidatorFromZodOutput<T[key]>;
  }
>;

type ConvexUnionValidatorFromZodOutput<T> = T extends z.ZodTypeAny[]
  ? VUnion<
      ConvexValidatorFromZodOutput<T[number]>["type"],
      {
        [Index in keyof T]: T[Index] extends z.ZodTypeAny
          ? ConvexValidatorFromZodOutput<T[Index]>
          : never;
      },
      "required",
      ConvexValidatorFromZodOutput<T[number]>["fieldPaths"]
    >
  : never;

/**
 * Converts a Zod validator type
 * to the corresponding Convex validator type from `convex/values`.
 *
 * ```ts
 * ConvexValidatorFromZod<z.ZodString> // → VString
 * ```
 */
export type ConvexValidatorFromZod<Z extends z.ZodTypeAny> =
  // Keep this in sync with zodToConvex implementation
  // and the ConvexValidatorFromZodOutput type
  Z extends Zid<infer TableName>
    ? VId<GenericId<TableName>>
    : Z extends z.ZodString
      ? VString
      : Z extends z.ZodNumber
        ? VFloat64
        : Z extends z.ZodNaN
          ? VFloat64
          : Z extends z.ZodBigInt
            ? VInt64
            : Z extends z.ZodBoolean
              ? VBoolean
              : Z extends z.ZodNull
                ? VNull
                : Z extends z.ZodUnknown
                  ? VAny
                  : Z extends z.ZodAny
                    ? VAny
                    : Z extends z.ZodArray<infer Inner>
                      ? VArray<
                          ConvexValidatorFromZod<Inner>["type"][],
                          ConvexValidatorFromZod<Inner>
                        >
                      : Z extends z.ZodObject<infer ZodShape>
                        ? ConvexObjectValidatorFromZod<ZodShape>
                        : Z extends z.ZodUnion<infer T>
                          ? ConvexUnionValidatorFromZod<T>
                          : Z extends z.ZodDiscriminatedUnion<any, infer T>
                            ? VUnion<
                                ConvexValidatorFromZod<T[number]>["type"],
                                {
                                  -readonly [
                                    Index in keyof T
                                  ]: ConvexValidatorFromZod<T[Index]>;
                                },
                                "required",
                                ConvexValidatorFromZod<T[number]>["fieldPaths"]
                              >
                            : Z extends z.ZodTuple<infer Inner>
                              ? VArray<
                                  ConvexValidatorFromZod<
                                    Inner[number]
                                  >["type"][],
                                  ConvexValidatorFromZod<Inner[number]>
                                >
                              : Z extends z.ZodLazy<infer Inner>
                                ? ConvexValidatorFromZod<Inner>
                                : Z extends z.ZodLiteral<infer Literal>
                                  ? VLiteral<Literal>
                                  : Z extends z.ZodEnum<infer T>
                                    ? T extends Array<any>
                                      ? VUnion<
                                          T[number],
                                          {
                                            [Index in keyof T]: VLiteral<
                                              T[Index]
                                            >;
                                          },
                                          "required",
                                          ConvexValidatorFromZod<
                                            T[number]
                                          >["fieldPaths"]
                                        >
                                      : never
                                    : Z extends z.ZodEffects<infer Inner>
                                      ? ConvexValidatorFromZod<Inner>
                                      : Z extends z.ZodOptional<infer Inner>
                                        ? ConvexValidatorFromZod<Inner> extends GenericValidator
                                          ? VOptional<
                                              ConvexValidatorFromZod<Inner>
                                            >
                                          : never
                                        : Z extends z.ZodNullable<infer Inner>
                                          ? ConvexValidatorFromZod<Inner> extends Validator<
                                              any,
                                              "required",
                                              any
                                            >
                                            ? VUnion<
                                                | null
                                                | ConvexValidatorFromZod<Inner>["type"],
                                                [
                                                  ConvexValidatorFromZod<Inner>,
                                                  VNull,
                                                ],
                                                "required",
                                                ConvexValidatorFromZod<Inner>["fieldPaths"]
                                              >
                                            : // Swap nullable(optional(foo)) for optional(nullable(foo))
                                              ConvexValidatorFromZod<Inner> extends Validator<
                                                  infer T,
                                                  "optional",
                                                  infer F
                                                >
                                              ? VUnion<
                                                  null | Exclude<
                                                    ConvexValidatorFromZod<Inner>["type"],
                                                    undefined
                                                  >,
                                                  [
                                                    Validator<T, "required", F>,
                                                    VNull,
                                                  ],
                                                  "optional",
                                                  ConvexValidatorFromZod<Inner>["fieldPaths"]
                                                >
                                              : never
                                          : Z extends
                                                | z.ZodBranded<
                                                    infer Inner,
                                                    infer Brand
                                                  >
                                                | ZodBrandedInputAndOutput<
                                                    infer Inner,
                                                    infer Brand
                                                  >
                                            ? Inner extends z.ZodString
                                              ? VString<string & z.BRAND<Brand>>
                                              : Inner extends z.ZodNumber
                                                ? VFloat64<
                                                    number & z.BRAND<Brand>
                                                  >
                                                : Inner extends z.ZodBigInt
                                                  ? VInt64<
                                                      bigint & z.BRAND<Brand>
                                                    >
                                                  : Inner extends z.ZodObject<
                                                        infer ZodShape
                                                      >
                                                    ? VObject<
                                                        ObjectType<{
                                                          [
                                                            key in keyof ZodShape
                                                          ]: ZodShape[key] extends z.ZodTypeAny
                                                            ? ConvexValidatorFromZod<
                                                                ZodShape[key]
                                                              >
                                                            : never;
                                                        }> &
                                                          z.BRAND<Brand>,
                                                        {
                                                          [
                                                            key in keyof ZodShape
                                                          ]: ConvexValidatorFromZod<
                                                            ZodShape[key]
                                                          >;
                                                        }
                                                      >
                                                    : ConvexValidatorFromZod<Inner>
                                            : Z extends z.ZodDefault<
                                                  infer Inner
                                                > // Treat like optional
                                              ? ConvexValidatorFromZod<Inner> extends GenericValidator
                                                ? VOptional<
                                                    ConvexValidatorFromZod<Inner>
                                                  >
                                                : never
                                              : Z extends z.ZodRecord<
                                                    infer K,
                                                    infer V
                                                  >
                                                ? K extends
                                                    | z.ZodString
                                                    | Zid<string>
                                                    | z.ZodUnion<
                                                        [
                                                          (
                                                            | z.ZodString
                                                            | Zid<string>
                                                          ),
                                                          (
                                                            | z.ZodString
                                                            | Zid<string>
                                                          ),
                                                          ...(
                                                            | z.ZodString
                                                            | Zid<string>
                                                          )[],
                                                        ]
                                                      >
                                                  ? VRecord<
                                                      z.RecordType<
                                                        ConvexValidatorFromZod<K>["type"],
                                                        ConvexValidatorFromZod<V>["type"]
                                                      >,
                                                      ConvexValidatorFromZod<K>,
                                                      ConvexValidatorFromZod<V>
                                                    >
                                                  : never
                                                : Z extends z.ZodReadonly<
                                                      infer Inner
                                                    >
                                                  ? ConvexValidatorFromZod<Inner>
                                                  : Z extends z.ZodPipeline<
                                                        infer Inner,
                                                        any
                                                      > // Validate input type
                                                    ? ConvexValidatorFromZod<Inner>
                                                    : // Some that are a bit unknown
                                                      // : Z extends z.ZodDate ? Validator<number>
                                                      // : Z extends z.ZodSymbol ? Validator<symbol>
                                                      // : Z extends z.ZodNever ? Validator<never>
                                                      // : Z extends z.ZodIntersection<infer T, infer U>
                                                      // ? Validator<
                                                      //     ConvexValidatorFromZod<T>["type"] &
                                                      //       ConvexValidatorFromZod<U>["type"],
                                                      //     "required",
                                                      //     ConvexValidatorFromZod<T>["fieldPaths"] |
                                                      //       ConvexValidatorFromZod<U>["fieldPaths"]
                                                      //   >
                                                      // Is arraybuffer a thing?
                                                      // Z extends z.??? ? Validator<ArrayBuffer> :
                                                      // Note: we don't handle z.undefined() in union, nullable, etc.
                                                      // : Validator<any, "required", string>
                                                      // We avoid doing this catch-all to avoid over-promising on types
                                                      // : Z extends z.ZodTypeAny
                                                      Z extends ZCommitTs
                                                      ? VCommitTs
                                                      : Z extends ZFunction<
                                                            infer Type
                                                          >
                                                        ? VFunction<Type>
                                                        : never;

/**
 * Turns a Zod validator into a Convex Validator.
 *
 * The Convex validator will be as close to possible to the Zod validator,
 * but might be broader than the Zod validator:
 *
 * ```js
 * zodToConvex(z.string().email()) // → v.string()
 * ```
 *
 * This function is useful when running the Zod validator _after_ running the Convex validator
 * (i.e. the Convex validator validates the input of the Zod validator). Hence, the Convex types
 * will match the _input type_ of Zod transformations:
 * ```js
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
export function zodToConvex<Z extends z.ZodTypeAny>(
  zod: Z,
): ConvexValidatorFromZod<Z> {
  const typeName:
    ZodFirstPartyTypeKind | "ConvexId" | "ConvexCommitTs" | "ConvexFunction" =
    zod._def.typeName;
  switch (typeName) {
    case "ConvexId":
      return v.id(zod._def.tableName) as ConvexValidatorFromZod<Z>;
    case "ConvexCommitTs":
      return v.commitTs() as ConvexValidatorFromZod<Z>;
    case "ConvexFunction":
      return zod._def.validator as ConvexValidatorFromZod<Z>;
    case "ZodString":
      return v.string() as ConvexValidatorFromZod<Z>;
    case "ZodNumber":
    case "ZodNaN":
      return v.number() as ConvexValidatorFromZod<Z>;
    case "ZodBigInt":
      return v.int64() as ConvexValidatorFromZod<Z>;
    case "ZodBoolean":
      return v.boolean() as ConvexValidatorFromZod<Z>;
    case "ZodNull":
      return v.null() as ConvexValidatorFromZod<Z>;
    case "ZodAny":
    case "ZodUnknown":
      return v.any() as ConvexValidatorFromZod<Z>;
    case "ZodArray": {
      const inner = zodToConvex(zod._def.type);
      if (inner.isOptional === "optional") {
        throw new Error("Arrays of optional values are not supported");
      }
      return v.array(inner) as ConvexValidatorFromZod<Z>;
    }
    case "ZodObject":
      return v.object(
        zodToConvexFields(zod._def.shape()),
      ) as ConvexValidatorFromZod<Z>;
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return v.union(
        ...zod._def.options.map((v: z.ZodTypeAny) => zodToConvex(v)),
      ) as ConvexValidatorFromZod<Z>;
    case "ZodTuple": {
      const allTypes = zod._def.items.map((v: z.ZodTypeAny) => zodToConvex(v));
      if (zod._def.rest) {
        allTypes.push(zodToConvex(zod._def.rest));
      }
      return v.array(
        v.union(...allTypes),
      ) as unknown as ConvexValidatorFromZod<Z>;
    }
    case "ZodLazy":
      return zodToConvex(zod._def.getter()) as ConvexValidatorFromZod<Z>;
    case "ZodLiteral":
      return v.literal(zod._def.value) as ConvexValidatorFromZod<Z>;
    case "ZodEnum":
      return v.union(
        ...zod._def.values.map((l: string | number | boolean | bigint) =>
          v.literal(l),
        ),
      ) as ConvexValidatorFromZod<Z>;
    case "ZodEffects":
      return zodToConvex(zod._def.schema) as ConvexValidatorFromZod<Z>;
    case "ZodOptional":
      return v.optional(
        zodToConvex((zod as any).unwrap()) as any,
      ) as ConvexValidatorFromZod<Z>;
    case "ZodNullable": {
      const nullable = (zod as any).unwrap();
      if (nullable._def.typeName === "ZodOptional") {
        // Swap nullable(optional(Z)) for optional(nullable(Z))
        // Casting to any to ignore the mismatch of optional
        return v.optional(
          v.union(zodToConvex(nullable.unwrap()) as any, v.null()),
        ) as unknown as ConvexValidatorFromZod<Z>;
      }
      return v.union(
        zodToConvex(nullable) as any,
        v.null(),
      ) as unknown as ConvexValidatorFromZod<Z>;
    }
    case "ZodBranded":
      return zodToConvex((zod as any).unwrap()) as ConvexValidatorFromZod<Z>;
    case "ZodDefault": {
      const withDefault = zodToConvex(zod._def.innerType);
      if (withDefault.isOptional === "optional") {
        return withDefault as ConvexValidatorFromZod<Z>;
      }
      return v.optional(withDefault) as ConvexValidatorFromZod<Z>;
    }
    case "ZodRecord": {
      const keyType = zodToConvex(
        zod._def.keyType,
      ) as ConvexValidatorFromZod<Z>;
      function ensureStringOrId(v: GenericValidator) {
        if (v.kind === "union") {
          v.members.map(ensureStringOrId);
        } else if (v.kind !== "string" && v.kind !== "id") {
          throw new Error("Record keys must be strings or ids: " + v.kind);
        }
      }
      ensureStringOrId(keyType);
      return v.record(
        keyType,
        zodToConvex(zod._def.valueType) as ConvexValidatorFromZod<Z>,
      ) as unknown as ConvexValidatorFromZod<Z>;
    }
    case "ZodReadonly":
      return zodToConvex(zod._def.innerType) as ConvexValidatorFromZod<Z>;
    case "ZodPipeline":
      return zodToConvex(zod._def.in) as ConvexValidatorFromZod<Z>;
    default:
      throw new Error(`Unknown Zod type: ${typeName}`);
    // N/A or not supported
    // case "ZodDate":
    // case "ZodSymbol":
    // case "ZodUndefined":
    // case "ZodNever":
    // case "ZodVoid":
    // case "ZodIntersection":
    // case "ZodMap":
    // case "ZodSet":
    // case "ZodFunction":
    // case "ZodNativeEnum":
    // case "ZodCatch":
    // case "ZodPromise":
  }
}

/**
 * This is the type of a Convex validator that checks the value *after* it has
 * been validated (and possibly transformed) by a Zod validator.
 *
 * The difference between {@link ConvexValidatorFromZod}
 * and `ConvexValidatorFromZodOutput` are explained in the documentation of
 * {@link zodToConvex}/{@link zodOutputToConvex}.
 */
export type ConvexValidatorFromZodOutput<Z extends z.ZodTypeAny> =
  // Keep this in sync with the zodOutputToConvex implementation
  // IMPORTANT: The differences are at the bottom
  Z extends Zid<infer TableName>
    ? VId<GenericId<TableName>>
    : Z extends z.ZodString
      ? VString
      : Z extends z.ZodNumber
        ? VFloat64
        : Z extends z.ZodNaN
          ? VFloat64
          : Z extends z.ZodBigInt
            ? VInt64
            : Z extends z.ZodBoolean
              ? VBoolean
              : Z extends z.ZodNull
                ? VNull
                : Z extends z.ZodUnknown
                  ? VAny
                  : Z extends z.ZodAny
                    ? VAny
                    : Z extends z.ZodArray<infer Inner>
                      ? VArray<
                          ConvexValidatorFromZodOutput<Inner>["type"][],
                          ConvexValidatorFromZodOutput<Inner>
                        >
                      : Z extends z.ZodObject<infer ZodShape>
                        ? ConvexObjectValidatorFromZodOutput<ZodShape>
                        : Z extends z.ZodUnion<infer T>
                          ? ConvexUnionValidatorFromZodOutput<T>
                          : Z extends z.ZodDiscriminatedUnion<any, infer T>
                            ? VUnion<
                                ConvexValidatorFromZodOutput<T[number]>["type"],
                                {
                                  -readonly [
                                    Index in keyof T
                                  ]: ConvexValidatorFromZodOutput<T[Index]>;
                                },
                                "required",
                                ConvexValidatorFromZodOutput<
                                  T[number]
                                >["fieldPaths"]
                              >
                            : Z extends z.ZodTuple<infer Inner>
                              ? VArray<
                                  ConvexValidatorFromZodOutput<
                                    Inner[number]
                                  >["type"][],
                                  ConvexValidatorFromZodOutput<Inner[number]>
                                >
                              : Z extends z.ZodLazy<infer Inner>
                                ? ConvexValidatorFromZodOutput<Inner>
                                : Z extends z.ZodLiteral<infer Literal>
                                  ? VLiteral<Literal>
                                  : Z extends z.ZodEnum<infer T>
                                    ? T extends Array<any>
                                      ? VUnion<
                                          T[number],
                                          {
                                            [Index in keyof T]: VLiteral<
                                              T[Index]
                                            >;
                                          },
                                          "required",
                                          ConvexValidatorFromZodOutput<
                                            T[number]
                                          >["fieldPaths"]
                                        >
                                      : never
                                    : Z extends z.ZodOptional<infer Inner>
                                      ? ConvexValidatorFromZodOutput<Inner> extends GenericValidator
                                        ? VOptional<
                                            ConvexValidatorFromZodOutput<Inner>
                                          >
                                        : never
                                      : Z extends z.ZodNullable<infer Inner>
                                        ? ConvexValidatorFromZodOutput<Inner> extends Validator<
                                            any,
                                            "required",
                                            any
                                          >
                                          ? VUnion<
                                              | null
                                              | ConvexValidatorFromZodOutput<Inner>["type"],
                                              [
                                                ConvexValidatorFromZodOutput<Inner>,
                                                VNull,
                                              ],
                                              "required",
                                              ConvexValidatorFromZodOutput<Inner>["fieldPaths"]
                                            >
                                          : // Swap nullable(optional(foo)) for optional(nullable(foo))
                                            ConvexValidatorFromZodOutput<Inner> extends Validator<
                                                infer T,
                                                "optional",
                                                infer F
                                              >
                                            ? VUnion<
                                                null | Exclude<
                                                  ConvexValidatorFromZodOutput<Inner>["type"],
                                                  undefined
                                                >,
                                                [
                                                  Validator<T, "required", F>,
                                                  VNull,
                                                ],
                                                "optional",
                                                ConvexValidatorFromZodOutput<Inner>["fieldPaths"]
                                              >
                                            : never
                                        : Z extends
                                              | z.ZodBranded<
                                                  infer Inner,
                                                  infer Brand
                                                >
                                              | ZodBrandedInputAndOutput<
                                                  infer Inner,
                                                  infer Brand
                                                >
                                          ? Inner extends z.ZodString
                                            ? VString<string & z.BRAND<Brand>>
                                            : Inner extends z.ZodNumber
                                              ? VFloat64<
                                                  number & z.BRAND<Brand>
                                                >
                                              : Inner extends z.ZodBigInt
                                                ? VInt64<
                                                    bigint & z.BRAND<Brand>
                                                  >
                                                : Inner extends z.ZodObject<
                                                      infer ZodShape
                                                    >
                                                  ? VObject<
                                                      ObjectType<{
                                                        [
                                                          key in keyof ZodShape
                                                        ]: ZodShape[key] extends z.ZodTypeAny
                                                          ? ConvexValidatorFromZodOutput<
                                                              ZodShape[key]
                                                            >
                                                          : never;
                                                      }> &
                                                        z.BRAND<Brand>,
                                                      {
                                                        [
                                                          key in keyof ZodShape
                                                        ]: ConvexValidatorFromZodOutput<
                                                          ZodShape[key]
                                                        >;
                                                      }
                                                    >
                                                  : ConvexValidatorFromZodOutput<Inner>
                                          : Z extends z.ZodRecord<
                                                infer K,
                                                infer V
                                              >
                                            ? K extends
                                                | z.ZodString
                                                | Zid<string>
                                                | z.ZodUnion<
                                                    [
                                                      z.ZodString | Zid<string>,
                                                      z.ZodString | Zid<string>,
                                                      ...(
                                                        | z.ZodString
                                                        | Zid<string>
                                                      )[],
                                                    ]
                                                  >
                                              ? VRecord<
                                                  z.RecordType<
                                                    ConvexValidatorFromZodOutput<K>["type"],
                                                    ConvexValidatorFromZodOutput<V>["type"]
                                                  >,
                                                  ConvexValidatorFromZodOutput<K>,
                                                  ConvexValidatorFromZodOutput<V>
                                                >
                                              : never
                                            : Z extends z.ZodReadonly<
                                                  infer Inner
                                                >
                                              ? ConvexValidatorFromZodOutput<Inner>
                                              : /*
                                                 * IMPORTANT: these are the different ones
                                                 */
                                                Z extends z.ZodDefault<
                                                    infer Inner
                                                  >
                                                ? // Default values are always set after validation
                                                  ConvexValidatorFromZodOutput<Inner>
                                                : Z extends z.ZodEffects<any>
                                                  ? // We don't know what the output type is, it's a function return
                                                    VAny
                                                  : // Validate output type instead of input
                                                    Z extends z.ZodPipeline<
                                                        z.ZodTypeAny,
                                                        infer Out
                                                      >
                                                    ? ConvexValidatorFromZodOutput<Out>
                                                    : Z extends ZCommitTs
                                                      ? VCommitTs
                                                      : Z extends ZFunction<
                                                            infer Type
                                                          >
                                                        ? VFunction<Type>
                                                        : never;

/**
 * Converts a Zod validator to a Convex validator that checks the value _after_
 * it has been validated (and possibly transformed) by the Zod validator.
 *
 * This is similar to {@link zodToConvex}, but is meant for cases where the Convex
 * validator runs _after_ the Zod validator. Thus, the Convex type refers to the
 * _output_ type of the Zod transformations:
 * ```js
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
export function zodOutputToConvex<Z extends z.ZodTypeAny>(
  zod: Z,
): ConvexValidatorFromZodOutput<Z> {
  const typeName:
    ZodFirstPartyTypeKind | "ConvexId" | "ConvexCommitTs" | "ConvexFunction" =
    zod._def.typeName;
  switch (typeName) {
    // These are the special cases that differ from the input validator
    case "ZodDefault":
      // Here we return the non-optional inner type
      return zodOutputToConvex(
        zod._def.innerType,
      ) as unknown as ConvexValidatorFromZodOutput<Z>;
    case "ZodEffects":
      // IMPORTANT: Note: ZodEffects (like z.transform) do not do output validation
      return v.any() as ConvexValidatorFromZodOutput<Z>;
    case "ZodPipeline":
      // IMPORTANT: The output type of the pipeline can differ from the input.
      return zodOutputToConvex(zod._def.out) as ConvexValidatorFromZodOutput<Z>;
    // These are the same as input
    case "ConvexId":
      return v.id(zod._def.tableName) as ConvexValidatorFromZodOutput<Z>;
    case "ConvexCommitTs":
      return v.commitTs() as ConvexValidatorFromZodOutput<Z>;
    case "ConvexFunction":
      return zod._def.validator as ConvexValidatorFromZodOutput<Z>;
    case "ZodString":
      return v.string() as ConvexValidatorFromZodOutput<Z>;
    case "ZodNumber":
    case "ZodNaN":
      return v.number() as ConvexValidatorFromZodOutput<Z>;
    case "ZodBigInt":
      return v.int64() as ConvexValidatorFromZodOutput<Z>;
    case "ZodBoolean":
      return v.boolean() as ConvexValidatorFromZodOutput<Z>;
    case "ZodNull":
      return v.null() as ConvexValidatorFromZodOutput<Z>;
    case "ZodAny":
    case "ZodUnknown":
      return v.any() as ConvexValidatorFromZodOutput<Z>;
    case "ZodArray": {
      const inner = zodOutputToConvex(zod._def.type);
      if (inner.isOptional === "optional") {
        throw new Error("Arrays of optional values are not supported");
      }
      return v.array(inner) as ConvexValidatorFromZodOutput<Z>;
    }
    case "ZodObject":
      return v.object(
        zodOutputToConvexFields(zod._def.shape()),
      ) as ConvexValidatorFromZodOutput<Z>;
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return v.union(
        ...zod._def.options.map((v: z.ZodTypeAny) => zodOutputToConvex(v)),
      ) as ConvexValidatorFromZodOutput<Z>;
    case "ZodTuple": {
      const allTypes = zod._def.items.map((v: z.ZodTypeAny) =>
        zodOutputToConvex(v),
      );
      if (zod._def.rest) {
        allTypes.push(zodOutputToConvex(zod._def.rest));
      }
      return v.array(
        v.union(...allTypes),
      ) as unknown as ConvexValidatorFromZodOutput<Z>;
    }
    case "ZodLazy":
      return zodOutputToConvex(
        zod._def.getter(),
      ) as ConvexValidatorFromZodOutput<Z>;
    case "ZodLiteral":
      return v.literal(zod._def.value) as ConvexValidatorFromZodOutput<Z>;
    case "ZodEnum":
      return v.union(
        ...zod._def.values.map((l: string | number | boolean | bigint) =>
          v.literal(l),
        ),
      ) as ConvexValidatorFromZodOutput<Z>;
    case "ZodOptional":
      return v.optional(
        zodOutputToConvex((zod as any).unwrap()) as any,
      ) as ConvexValidatorFromZodOutput<Z>;
    case "ZodNullable": {
      const nullable = (zod as any).unwrap();
      if (nullable._def.typeName === "ZodOptional") {
        // Swap nullable(optional(Z)) for optional(nullable(Z))
        // Casting to any to ignore the mismatch of optional
        return v.optional(
          v.union(zodOutputToConvex(nullable.unwrap()) as any, v.null()),
        ) as unknown as ConvexValidatorFromZodOutput<Z>;
      }
      return v.union(
        zodOutputToConvex(nullable) as any,
        v.null(),
      ) as unknown as ConvexValidatorFromZodOutput<Z>;
    }
    case "ZodBranded":
      return zodOutputToConvex(
        (zod as any).unwrap(),
      ) as ConvexValidatorFromZodOutput<Z>;
    case "ZodRecord": {
      const keyType = zodOutputToConvex(
        zod._def.keyType,
      ) as ConvexValidatorFromZodOutput<Z>;
      function ensureStringOrId(v: GenericValidator) {
        if (v.kind === "union") {
          v.members.map(ensureStringOrId);
        } else if (v.kind !== "string" && v.kind !== "id") {
          throw new Error("Record keys must be strings or ids: " + v.kind);
        }
      }
      ensureStringOrId(keyType);
      return v.record(
        keyType,
        zodOutputToConvex(
          zod._def.valueType,
        ) as ConvexValidatorFromZodOutput<Z>,
      ) as unknown as ConvexValidatorFromZodOutput<Z>;
    }
    case "ZodReadonly":
      return zodOutputToConvex(
        zod._def.innerType,
      ) as ConvexValidatorFromZodOutput<Z>;
    default:
      throw new Error(`Unknown zod type: ${typeName}`);
    // N/A or not supported
    // case "ZodDate":
    // case "ZodSymbol":
    // case "ZodUndefined":
    // case "ZodNever":
    // case "ZodVoid":
    // case "ZodIntersection":
    // case "ZodMap":
    // case "ZodSet":
    // case "ZodFunction":
    // case "ZodNativeEnum":
    // case "ZodCatch":
    // case "ZodPromise":
  }
}

/**
 * Like {@link zodToConvex}, but it takes in a bare object, as expected by Convex
 * function arguments, or the argument to {@link defineTable}.
 *
 * ```js
 * zodToConvexFields({
 *   name: z.string().default("Nicolas"),
 * }) // → { name: v.optional(v.string()) }
 * ```
 *
 * @param zod Object with string keys and Zod validators as values
 * @returns Object with the same keys, but with Convex validators as values
 */
export function zodToConvexFields<Z extends ZodValidator>(zod: Z) {
  return Object.fromEntries(
    Object.entries(zod).map(([k, v]) => [k, zodToConvex(v)]),
  ) as { [k in keyof Z]: ConvexValidatorFromZod<Z[k]> };
}

/**
 * Like {@link zodOutputToConvex}, but it takes in a bare object, as expected by
 * Convex function arguments, or the argument to {@link defineTable}.
 *
 * ```js
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
export function zodOutputToConvexFields<Z extends ZodValidator>(zod: Z) {
  return Object.fromEntries(
    Object.entries(zod).map(([k, v]) => [k, zodOutputToConvex(v)]),
  ) as { [k in keyof Z]: ConvexValidatorFromZodOutput<Z[k]> };
}

interface ZidDef<TableName extends string> extends ZodTypeDef {
  typeName: "ConvexId";
  tableName: TableName;
}

/**
 * A Zod validator for a Convex ID.
 */
export class Zid<TableName extends string> extends z.ZodType<
  GenericId<TableName>,
  ZidDef<TableName>
> {
  _parse(input: z.ParseInput) {
    return z.string()._parse(input) as z.ParseReturnType<GenericId<TableName>>;
  }
}

interface ZCommitTsDef extends ZodTypeDef {
  typeName: "ConvexCommitTs";
}

const commitTsSchema = z.union([z.bigint(), z.instanceof(CommitTsPlaceholder)]);

/**
 * A Zod validator for a Convex commit timestamp (see {@link zCommitTs}).
 */
export class ZCommitTs extends z.ZodType<
  bigint | CommitTsPlaceholder,
  ZCommitTsDef
> {
  _parse(input: z.ParseInput) {
    return commitTsSchema._parse(input);
  }
}

interface ZFunctionDef<Type> extends ZodTypeDef {
  typeName: "ConvexFunction";
  validator: VFunction<Type, "required">;
}

/**
 * A Zod validator for a Convex function handle (see {@link zFunction}).
 */
export class ZFunction<Type> extends z.ZodType<Type, ZFunctionDef<Type>> {
  _parse(input: z.ParseInput): z.ParseReturnType<Type> {
    if (validate(this._def.validator, input.data)) {
      return z.OK(input.data);
    }
    z.addIssueToContext(this._getOrReturnCtx(input), {
      code: z.ZodIssueCode.custom,
      message: "Expected a function handle",
    });
    return z.INVALID;
  }
}

/**
 * Zod helper for adding Convex system fields to a record to return.
 *
 * ```js
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
export const withSystemFields = <
  Table extends string,
  T extends { [key: string]: z.ZodTypeAny },
>(
  tableName: Table,
  zObject: T,
) => {
  return { ...zObject, _id: zid(tableName), _creationTime: z.number() };
};

/**
 * This is a copy of Zod’s `ZodBranded` which also brands the input
 * (see {@link zBrand})
 */
export class ZodBrandedInputAndOutput<
  T extends z.ZodTypeAny,
  B extends string | number | symbol,
> extends z.ZodType<
  T["_output"] & z.BRAND<B>,
  z.ZodBrandedDef<T>,
  T["_input"] & z.BRAND<B>
> {
  _parse(input: z.ParseInput) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx,
    });
  }
  unwrap() {
    return this._def.type;
  }
}

/**
 * Adds a brand to a Zod validator. Used like `zBrand(z.string(), "MyBrand")`.
 * Compared to zod's `.brand`, this also brands the input type, so if you use
 * the branded validator as an argument to a function, the input type will also
 * be branded. The normal `.brand` only brands the output type, so only the type
 * returned by validation would be branded.
 *
 * @param validator A zod validator - generally a string, number, or bigint
 * @param brand A string, number, or symbol to brand the validator with
 * @returns A zod validator that brands both the input and output types.
 */
export function zBrand<
  T extends z.ZodTypeAny,
  B extends string | number | symbol,
>(validator: T, brand?: B): ZodBrandedInputAndOutput<T, B> {
  return validator.brand(brand);
}

/**
 * Simple type conversion from a Convex validator to a Zod validator.
 *
 * ```ts
 * ConvexToZod<typeof v.string()> // → z.ZodType<string>
 * ```
 */
export type ConvexToZod<V extends GenericValidator> = z.ZodType<Infer<V>>;

type ZodFromValidatorBase<V extends GenericValidator> =
  V extends VId<GenericId<infer TableName extends string>>
    ? Zid<TableName>
    : V extends VString<infer T, any>
      ? T extends string & { _: infer Brand extends string }
        ? z.ZodBranded<z.ZodString, Brand>
        : z.ZodString
      : V extends VFloat64<any, any>
        ? z.ZodNumber
        : V extends VInt64<any, any>
          ? z.ZodBigInt
          : V extends VCommitTs<any, any>
            ? ZCommitTs
            : V extends VBoolean<any, any>
              ? z.ZodBoolean
              : V extends VNull<any, any>
                ? z.ZodNull
                : V extends VLiteral<infer T, any>
                  ? z.ZodLiteral<T>
                  : V extends VObject<any, infer Fields, any, any>
                    ? z.ZodObject<
                        {
                          [K in keyof Fields]: ZodValidatorFromConvex<
                            Fields[K]
                          >;
                        },
                        "strip"
                      >
                    : V extends VRecord<any, infer Key, infer Value, any, any>
                      ? Key extends VId<GenericId<infer TableName>>
                        ? z.ZodRecord<
                            Zid<TableName>,
                            ZodValidatorFromConvex<Value>
                          >
                        : z.ZodRecord<
                            z.ZodString,
                            ZodValidatorFromConvex<Value>
                          >
                      : V extends VArray<any, any>
                        ? z.ZodArray<ZodValidatorFromConvex<V["element"]>>
                        : V extends VUnion<
                              any,
                              [
                                infer A extends GenericValidator,
                                infer B extends GenericValidator,
                                ...infer Rest extends GenericValidator[],
                              ],
                              any,
                              any
                            >
                          ? z.ZodUnion<
                              [
                                ZodValidatorFromConvex<A>,
                                ZodValidatorFromConvex<B>,
                                ...{
                                  [K in keyof Rest]: ZodValidatorFromConvex<
                                    Rest[K]
                                  >;
                                },
                              ]
                            >
                          : V extends VFunction<infer Type, any>
                            ? ZFunction<Exclude<Type, undefined>>
                            : z.ZodTypeAny; // fallback for unknown validators

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
    ? z.ZodOptional<ZodFromValidatorBase<V>>
    : ZodFromValidatorBase<V>;

/**
 * Turns a Convex validator into a Zod validator.
 *
 * This is useful when you want to use types you defined using Convex validators
 * with external libraries that expect to receive a Zod validator.
 *
 * ```js
 * convexToZod(v.string()) // → z.string()
 * ```
 *
 * @param convexValidator Convex validator can be any validator from "convex/values" e.g. `v.string()`
 * @returns Zod validator (e.g. `z.string()`) with inferred type matching the Convex validator
 */
export function convexToZod<V extends GenericValidator>(
  convexValidator: V,
): ZodValidatorFromConvex<V> {
  const isOptional = (convexValidator as any).isOptional === "optional";

  let zodValidator: z.ZodTypeAny;

  const { kind } = convexValidator;
  switch (kind) {
    case "id":
      zodValidator = zid((convexValidator as VId<any>).tableName);
      break;
    case "function":
      zodValidator = new ZFunction({
        typeName: "ConvexFunction",
        validator: vRequired(
          convexValidator as VFunction<any, OptionalProperty>,
        ),
      });
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
      zodValidator = zCommitTs();
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
      const arrayValidator = convexValidator as VArray<any, any>;
      zodValidator = z.array(convexToZod(arrayValidator.element));
      break;
    }
    case "object": {
      const objectValidator = convexValidator as VObject<any, any>;
      zodValidator = z.object(convexToZodFields(objectValidator.fields));
      break;
    }
    case "union": {
      const unionValidator = convexValidator as VUnion<any, any, any, any>;
      const memberValidators = unionValidator.members.map(
        (member: GenericValidator) => convexToZod(member),
      );
      zodValidator = z.union([
        memberValidators[0],
        memberValidators[1],
        ...memberValidators.slice(2),
      ]);
      break;
    }
    case "literal": {
      const literalValidator = convexValidator as VLiteral<any>;
      zodValidator = z.literal(literalValidator.value);
      break;
    }
    case "record": {
      const recordValidator = convexValidator as VRecord<
        any,
        any,
        any,
        any,
        any
      >;
      zodValidator = z.record(
        convexToZod(recordValidator.key),
        convexToZod(recordValidator.value),
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
 * ```js
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
