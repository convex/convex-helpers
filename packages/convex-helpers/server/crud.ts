import type {
  QueryBuilder,
  MutationBuilder,
  WithoutSystemFields,
  DocumentByName,
  RegisteredMutation,
  RegisteredQuery,
  FunctionVisibility,
  PaginationResult,
  SchemaDefinition,
  GenericSchema,
  TableNamesInDataModel,
  DataModelFromSchemaDefinition,
  GenericDataModel,
} from "convex/server";
import {
  paginationOptsValidator,
  internalQueryGeneric,
  internalMutationGeneric,
} from "convex/server";
import type {
  GenericId,
  Infer,
  Validator,
  VObject,
  VUnion,
} from "convex/values";
import { v } from "convex/values";
import { doc, partial, systemFields } from "../validators.js";

// Preserve the named data model in declarations instead of expanding its schema.
type CrudFunctions<
  DataModel extends GenericDataModel,
  TableName extends TableNamesInDataModel<DataModel>,
  QueryVisibility extends FunctionVisibility,
  MutationVisibility extends FunctionVisibility,
> = {
  create: RegisteredMutation<
    MutationVisibility,
    WithoutSystemFields<DocumentByName<DataModel, TableName>>,
    Promise<DocumentByName<DataModel, TableName>>
  >;
  read: RegisteredQuery<
    QueryVisibility,
    { id: GenericId<TableName> },
    Promise<DocumentByName<DataModel, TableName> | null>
  >;
  paginate: RegisteredQuery<
    QueryVisibility,
    { paginationOpts: Infer<typeof paginationOptsValidator> },
    Promise<PaginationResult<DocumentByName<DataModel, TableName>>>
  >;
  update: RegisteredMutation<
    MutationVisibility,
    {
      id: GenericId<TableName>;
      patch: Partial<WithoutSystemFields<DocumentByName<DataModel, TableName>>>;
    },
    Promise<void>
  >;
  destroy: RegisteredMutation<
    MutationVisibility,
    { id: GenericId<TableName> },
    Promise<DocumentByName<DataModel, TableName> | null>
  >;
};

/**
 * Create CRUD operations for a table.
 * You can expose these operations in your API. For example, in convex/users.ts:
 *
 * ```ts
 * // in convex/users.ts
 * import { crud } from "convex-helpers/server/crud";
 * import schema from "./schema";
 *
 * export const { create, read, update, destroy } = crud(schema, "users");
 * ```
 *
 * Then you can access the functions like `internal.users.create` from actions.
 *
 * To expose these functions publicly, you can pass in custom query and
 * mutation arguments. Be careful what you expose publicly: you wouldn't want
 * any client to be able to delete users, for example.
 *
 * @param schema Your project's schema.
 * @param table The table name to create CRUD operations for.
 * @param query The query to use - use internalQuery or query from
 * "./convex/_generated/server" or a customQuery.
 * @param mutation The mutation to use - use internalMutation or mutation from
 * "./convex/_generated/server" or a customMutation.
 * @returns An object with create, read, update, and delete functions.
 * You must export these functions at the top level of your file to use them.
 */
export function crud<
  Schema extends GenericSchema,
  TableName extends TableNamesInDataModel<
    DataModelFromSchemaDefinition<SchemaDefinition<Schema, any>>
  >,
  QueryVisibility extends FunctionVisibility = "internal",
  MutationVisibility extends FunctionVisibility = "internal",
>(
  schema: SchemaDefinition<Schema, any>,
  table: TableName,
  query: QueryBuilder<
    DataModelFromSchemaDefinition<SchemaDefinition<Schema, any>>,
    QueryVisibility
  > = internalQueryGeneric as any,
  mutation: MutationBuilder<
    DataModelFromSchemaDefinition<SchemaDefinition<Schema, any>>,
    MutationVisibility
  > = internalMutationGeneric as any,
): CrudFunctions<
  DataModelFromSchemaDefinition<SchemaDefinition<Schema, any>>,
  TableName,
  QueryVisibility,
  MutationVisibility
> {
  type DataModel = DataModelFromSchemaDefinition<SchemaDefinition<Schema, any>>;
  type Functions = CrudFunctions<
    DataModel,
    TableName,
    QueryVisibility,
    MutationVisibility
  >;
  const validator = schema.tables[table]?.validator;
  if (!validator) {
    throw new Error(
      `Table ${table} not found in schema. Did you define it in defineSchema?`,
    );
  }
  if (validator.kind !== "object" && validator.kind !== "union") {
    throw new Error("Validator must be an object or union");
  }

  const makeSystemFieldsOptional = <V extends Validator<any, any, any>>(
    validator: V,
  ): V => {
    if (validator.kind === "object") {
      return v.object({
        ...validator.fields,
        ...partial(systemFields(table)),
      }) as any;
    } else if (validator.kind === "union") {
      return v.union(
        ...validator.members.map((value) => makeSystemFieldsOptional(value)),
      ) as any;
    } else {
      throw new Error("Validator must be an object or union");
    }
  };

  return {
    create: mutation({
      args: makeSystemFieldsOptional(validator),
      handler: async (ctx, args) => {
        if ("_id" in args) delete args._id;
        if ("_creationTime" in args) delete args._creationTime;
        const id = await ctx.db.insert(table, args);
        return (await ctx.db.get(table, id))!;
      },
    }) as Functions["create"],
    read: query({
      args: { id: v.id(table) },
      handler: async (ctx, args) => {
        return await ctx.db.get(table, args.id);
      },
    }) as Functions["read"],
    paginate: query({
      args: {
        paginationOpts: paginationOptsValidator,
      },
      handler: async (ctx, args) => {
        return ctx.db.query(table).paginate(args.paginationOpts);
      },
    }) as Functions["paginate"],
    update: mutation({
      args: {
        id: v.id(table),
        // this could be partial(table.withSystemFields) but keeping
        // the api less coupled to Table
        patch: partial(
          doc(schema, table) as VObject<any, any, any> | VUnion<any, any, any>,
        ),
      },
      handler: async (ctx, args) => {
        await ctx.db.patch(
          table,
          args.id,
          args.patch as Partial<DocumentByName<DataModel, TableName>>,
        );
      },
    }) as Functions["update"],
    destroy: mutation({
      args: { id: v.id(table) },
      handler: async (ctx, args) => {
        const old = await ctx.db.get(table, args.id);
        if (old) {
          await ctx.db.delete(table, args.id);
        }
        return old;
      },
    }) as Functions["destroy"],
  };
}
