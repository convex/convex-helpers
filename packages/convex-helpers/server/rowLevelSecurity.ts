import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
  DocumentByInfo,
  DocumentByName,
  FunctionArgs,
  GenericDataModel,
  GenericTableInfo,
  GenericMutationCtx,
  NamedTableInfo,
  GenericQueryCtx,
  QueryInitializer,
  TableNamesInDataModel,
  WithOptionalSystemFields,
  WithoutSystemFields,
} from "convex/server";
import type { GenericId } from "convex/values";
import { filter } from "./filter.js";

type Rule<Ctx, D> = (ctx: Ctx, doc: D) => Promise<boolean>;

export type Rules<Ctx, DataModel extends GenericDataModel> = {
  [T in TableNamesInDataModel<DataModel>]?: {
    read?: Rule<Ctx, DocumentByName<DataModel, T>>;
    modify?: Rule<Ctx, DocumentByName<DataModel, T>>;
    insert?: Rule<Ctx, WithoutSystemFields<DocumentByName<DataModel, T>>>;
  };
};

export type RLSConfig = {
  /**
   * Default policy when no rule is defined for a table.
   * - "allow": Allow access by default (default behavior)
   * - "deny": Deny access by default
   */
  defaultPolicy?: "allow" | "deny";
};

/**
 * Apply row level security (RLS) to queries and mutations with the returned
 * middleware functions.
 * @deprecated Use `wrapDatabaseReader`/`Writer` with `customFunction` instead.
 *
 * Example:
 * ```
 * // Defined in a common file so it can be used by all queries and mutations.
 * import { Auth } from "convex/server";
 * import { DataModel } from "./_generated/dataModel";
 * import { DatabaseReader } from "./_generated/server";
 * import { RowLevelSecurity } from "./rowLevelSecurity";
 *
 * export const {withMutationRLS} = RowLevelSecurity<{auth: Auth, db: DatabaseReader}, DataModel>(
 *  {
 *    cookies: {
 *      read: async ({auth}, cookie) => !cookie.eaten,
 *      modify: async ({auth, db}, cookie) => {
 *        const user = await getUser(auth, db);
 *        return user.isParent;  // only parents can reach the cookies.
 *      },
 *  },
 *  { defaultPolicy: "deny" }
 * );
 * // Mutation with row level security enabled.
 * export const eatCookie = mutation(withMutationRLS(
 *  async ({db}, {cookieId}) => {
 *   // throws "does not exist" error if cookie is already eaten or doesn't exist.
 *   // throws "write access" error if authorized user is not a parent.
 *   await db.patch(cookieId, {eaten: true});
 * }));
 * ```
 *
 * Notes:
 * * Rules may read any row in `db` -- rules do not apply recursively within the
 *   rule functions themselves.
 * * Tables with no rule have `defaultPolicy` set to "allow" by default.
 * * Middleware functions like `withUser` can be composed with RowLevelSecurity
 *   to cache fetches in `ctx`. e.g.
 * ```
 * const {withQueryRLS} = RowLevelSecurity<{user: Doc<"users">}, DataModel>(
 *  {
 *    cookies: async ({user}, cookie) => user.isParent,
 *  },
 *  { defaultPolicy: "deny" }
 * );
 * export default query(withUser(withRLS(...)));
 * ```
 *
 * @param rules - rule for each table, determining whether a row is accessible.
 *  - "read" rule says whether a document should be visible.
 *  - "modify" rule says whether to throw an error on `replace`, `patch`, and `delete`.
 *  - "insert" rule says whether to throw an error on `insert`.
 *
 * @returns Functions `withQueryRLS` and `withMutationRLS` to be passed to
 * `query` or `mutation` respectively.
 *  For each row read, modified, or inserted, the security rules are applied.
 */
export const RowLevelSecurity = <RuleCtx, DataModel extends GenericDataModel>(
  rules: Rules<RuleCtx, DataModel>,
  config?: RLSConfig,
) => {
  const withMutationRLS = <
    Ctx extends GenericMutationCtx<DataModel>,
    Args extends ArgsArray,
    Output,
  >(
    f: Handler<Ctx, Args, Output>,
  ): Handler<Ctx, Args, Output> => {
    return ((ctx: any, ...args: any[]) => {
      const wrappedDb = new WrapWriter(ctx, ctx.db, rules, config);
      return (f as any)({ ...ctx, db: wrappedDb }, ...args);
    }) as Handler<Ctx, Args, Output>;
  };
  const withQueryRLS = <
    Ctx extends GenericQueryCtx<DataModel>,
    Args extends ArgsArray,
    Output,
  >(
    f: Handler<Ctx, Args, Output>,
  ): Handler<Ctx, Args, Output> => {
    return ((ctx: any, ...args: any[]) => {
      const wrappedDb = new WrapReader(ctx, ctx.db, rules, config);
      return (f as any)({ ...ctx, db: wrappedDb }, ...args);
    }) as Handler<Ctx, Args, Output>;
  };
  return {
    withMutationRLS,
    withQueryRLS,
  };
};

/**
 * If you just want to read from the DB, you can copy this.
 * Later, you can use `generateQueryWithMiddleware` along
 * with a custom function using wrapQueryDB with rules that
 * depend on values generated once at the start of the function.
 * E.g. Looking up a user to use for your rules:
 * //TODO: Add example
export function BasicRowLevelSecurity(
  rules: Rules<GenericQueryCtx<DataModel>, DataModel>
) {
  return {
    queryWithRLS: customQuery(
      query,
      customCtx((ctx) => ({ db: wrapDatabaseReader(ctx, ctx.db, rules) }))
    ),

    mutationWithRLS: customMutation(
      mutation,
      customCtx((ctx) => ({ db: wrapDatabaseWriter(ctx, ctx.db, rules) }))
    ),

    internalQueryWithRLS: customQuery(
      internalQuery,
      customCtx((ctx) => ({ db: wrapDatabaseReader(ctx, ctx.db, rules) }))
    ),

    internalMutationWithRLS: customMutation(
      internalMutation,
      customCtx((ctx) => ({ db: wrapDatabaseWriter(ctx, ctx.db, rules) }))
    ),
  };
}
 */

export function wrapDatabaseReader<Ctx, DataModel extends GenericDataModel>(
  ctx: Ctx,
  db: GenericDatabaseReader<DataModel>,
  rules: Rules<Ctx, DataModel>,
  config?: RLSConfig,
): GenericDatabaseReader<DataModel> {
  return new WrapReader(ctx, db, rules, config);
}

export function wrapDatabaseWriter<Ctx, DataModel extends GenericDataModel>(
  ctx: Ctx,
  db: GenericDatabaseWriter<DataModel>,
  rules: Rules<Ctx, DataModel>,
  config?: RLSConfig,
): GenericDatabaseWriter<DataModel> {
  return new WrapWriter(ctx, db, rules, config);
}

type ArgsArray = [] | [FunctionArgs<any>];
type Handler<Ctx, Args extends ArgsArray, Output> = (
  ctx: Ctx,
  ...args: Args
) => Output;

class WrapReader<
  Ctx,
  DataModel extends GenericDataModel,
> implements GenericDatabaseReader<DataModel> {
  ctx: Ctx;
  db: GenericDatabaseReader<DataModel>;
  system: GenericDatabaseReader<DataModel>["system"];
  rules: Rules<Ctx, DataModel>;
  config: RLSConfig;

  constructor(
    ctx: Ctx,
    db: GenericDatabaseReader<DataModel>,
    rules: Rules<Ctx, DataModel>,
    config?: RLSConfig,
  ) {
    this.ctx = ctx;
    this.db = db;
    this.system = db.system;
    this.rules = rules;
    this.config = config ?? { defaultPolicy: "allow" };
  }

  normalizeId<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName,
    id: string,
  ): GenericId<TableName> | null {
    return this.db.normalizeId(tableName, id);
  }

  tableName<TableName extends string>(
    id: GenericId<TableName>,
  ): TableName | null {
    for (const tableName of Object.keys(this.rules)) {
      if (this.db.normalizeId(tableName, id)) {
        return tableName as TableName;
      }
    }
    return null;
  }

  async predicate<T extends GenericTableInfo>(
    tableName: string,
    doc: DocumentByInfo<T>,
  ): Promise<boolean> {
    if (!this.rules[tableName]?.read) {
      return (this.config.defaultPolicy ?? "allow") === "allow";
    }
    return await this.rules[tableName]!.read!(this.ctx, doc);
  }

  get<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    id: GenericId<NonUnion<TableName>>,
  ): Promise<DocumentByName<DataModel, TableName> | null>;
  get<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>,
  ): Promise<DocumentByName<DataModel, TableName> | null>;
  async get(arg0: any, arg1?: any): Promise<any> {
    const [tableName, id]: [string | null, GenericId<string>] =
      arg1 !== undefined ? [arg0, arg1] : [this.tableName(arg0), arg0];
    const doc = tableName
      ? await this.db.get(tableName, id)
      : // eslint-disable-next-line @convex-dev/explicit-table-ids -- tableName not available here
        await this.db.get(id);
    if (doc) {
      if (
        tableName
          ? !(await this.predicate(tableName, doc))
          : this.config.defaultPolicy === "deny"
      ) {
        return null;
      }
      return doc;
    }
    return null;
  }

  query<TableName extends string>(
    tableName: TableName,
  ): QueryInitializer<NamedTableInfo<DataModel, TableName>> {
    return filter(this.db.query(tableName), (d) =>
      this.predicate(tableName, d),
    );
  }
}

class WrapWriter<
  Ctx,
  DataModel extends GenericDataModel,
> implements GenericDatabaseWriter<DataModel> {
  ctx: Ctx;
  db: GenericDatabaseWriter<DataModel>;
  system: GenericDatabaseWriter<DataModel>["system"];
  vars: GenericDatabaseWriter<DataModel>["vars"];
  reader: GenericDatabaseReader<DataModel>;
  rules: Rules<Ctx, DataModel>;
  config: RLSConfig;

  async modifyPredicate<T extends GenericTableInfo>(
    tableName: string,
    doc: DocumentByInfo<T>,
  ): Promise<boolean> {
    if (!this.rules[tableName]?.modify) {
      return (this.config.defaultPolicy ?? "allow") === "allow";
    }
    return await this.rules[tableName]!.modify!(this.ctx, doc);
  }

  constructor(
    ctx: Ctx,
    db: GenericDatabaseWriter<DataModel>,
    rules: Rules<Ctx, DataModel>,
    config?: RLSConfig,
  ) {
    this.ctx = ctx;
    this.db = db;
    this.system = db.system;
    this.vars = db.vars;
    this.reader = new WrapReader(ctx, db, rules, config);
    this.rules = rules;
    this.config = config ?? { defaultPolicy: "allow" };
  }

  normalizeId<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName,
    id: string,
  ): GenericId<TableName> | null {
    return this.db.normalizeId(tableName, id);
  }

  async insert<TableName extends string>(
    table: TableName,
    value: any,
  ): Promise<any> {
    const rules = this.rules[table];
    if (rules?.insert) {
      if (!(await rules.insert(this.ctx, value))) {
        throw new Error("insert access not allowed");
      }
    } else if ((this.config.defaultPolicy ?? "allow") === "deny") {
      throw new Error("insert access not allowed");
    }
    return await this.db.insert(table, value);
  }

  tableName<TableName extends string>(
    id: GenericId<TableName>,
  ): TableName | null {
    for (const tableName of Object.keys(this.rules)) {
      if (this.db.normalizeId(tableName, id)) {
        return tableName as TableName;
      }
    }
    return null;
  }

  async checkAuth<TableName extends string>(
    tableNameArg: string | null,
    id: GenericId<TableName>,
  ) {
    // Note all writes already do a `db.get` internally, so this isn't
    // an extra read; it's just populating the cache earlier.
    // Since we call `this.get`, read access controls apply and this may return
    // null even if the document exists.
    const doc = tableNameArg
      ? await this.get(tableNameArg as any, id)
      : await this.get(id);
    if (doc === null) {
      throw new Error("no read access or doc does not exist");
    }
    const tableName = tableNameArg ?? this.tableName(id);
    if (tableName === null) {
      return;
    }
    if (!(await this.modifyPredicate(tableName, doc))) {
      throw new Error("write access not allowed");
    }
  }

  patch<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    id: GenericId<NonUnion<TableName>>,
    value: Partial<DocumentByName<DataModel, TableName>>,
  ): Promise<void>;
  patch<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>,
    value: Partial<DocumentByName<DataModel, TableName>>,
  ): Promise<void>;
  async patch(arg0: any, arg1: any, arg2?: any): Promise<void> {
    const [tableName, id, value]: [string | null, GenericId<string>, any] =
      arg2 !== undefined ? [arg0, arg1, arg2] : [null, arg0, arg1];
    await this.checkAuth(tableName, id);
    return tableName
      ? this.db.patch(tableName, id, value)
      : // eslint-disable-next-line @convex-dev/explicit-table-ids -- tableName not available here
        this.db.patch(id, value);
  }

  replace<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    id: GenericId<NonUnion<TableName>>,
    value: WithOptionalSystemFields<DocumentByName<DataModel, TableName>>,
  ): Promise<void>;
  replace<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>,
    value: WithOptionalSystemFields<DocumentByName<DataModel, TableName>>,
  ): Promise<void>;
  async replace(arg0: any, arg1: any, arg2?: any): Promise<void> {
    const [tableName, id, value]: [string | null, GenericId<string>, any] =
      arg2 !== undefined ? [arg0, arg1, arg2] : [null, arg0, arg1];
    await this.checkAuth(tableName, id);
    return tableName
      ? this.db.replace(tableName, id, value)
      : // eslint-disable-next-line @convex-dev/explicit-table-ids -- tableName not available here
        this.db.replace(id, value);
  }

  delete<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    id: GenericId<NonUnion<TableName>>,
  ): Promise<void>;
  delete(id: GenericId<TableNamesInDataModel<DataModel>>): Promise<void>;
  async delete(arg0: any, arg1?: any): Promise<void> {
    const [tableName, id]: [string | null, GenericId<string>] =
      arg1 !== undefined ? [arg0, arg1] : [null, arg0];
    await this.checkAuth(tableName, id);

    return tableName
      ? this.db.delete(tableName, id)
      : // eslint-disable-next-line @convex-dev/explicit-table-ids -- tableName not available here
        this.db.delete(id);
  }

  get<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    id: GenericId<NonUnion<TableName>>,
  ): Promise<DocumentByName<DataModel, TableName> | null>;
  get<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>,
  ): Promise<DocumentByName<DataModel, TableName> | null>;
  get(arg0: any, arg1?: any): Promise<any> {
    return this.reader.get(arg0, arg1);
  }
  query<TableName extends string>(tableName: TableName): QueryInitializer<any> {
    return this.reader.query(tableName);
  }
}

type NonUnion<T> = T extends never ? never : T;
