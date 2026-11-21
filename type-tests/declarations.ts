// Compile against the published entrypoints, never the package's source files.
import { convexToZod as convexToZod3 } from "convex-helpers/server/zod3";
import { convexToZod as convexToZod4 } from "convex-helpers/server/zod4";
import { parse, vRequired } from "convex-helpers/validators";
import { crud } from "convex-helpers/server/crud";
import { stream } from "convex-helpers/server/stream";
import type { QueryReflection } from "convex-helpers/server/stream";
import {
  defineSchema,
  defineTable,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import type {
  ApiFromModules,
  DataModelFromSchemaDefinition,
  DocumentByName,
  FunctionArgs,
  FunctionHandle_future,
  FunctionReturnType,
  GenericDatabaseReader,
  MutationBuilder,
  PaginationResult,
  QueryBuilder,
} from "convex/server";
import { v } from "convex/values";
import type { GenericId } from "convex/values";

const tables = {
  users: defineTable({ name: v.string(), age: v.optional(v.number()) }).index(
    "by_name",
    ["name"],
  ),
  events: defineTable(
    v.union(
      v.object({ kind: v.literal("joined"), userId: v.id("users") }),
      v.object({ kind: v.literal("left"), reason: v.string() }),
    ),
  ),
};
const schema = defineSchema(tables);
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type User = DocumentByName<DataModel, "users">;

function expectType<T>(_value: T) {}

export function checkCrud(id: GenericId<"users">) {
  const users = crud(schema, "users");
  const api = null! as ApiFromModules<{ users: typeof users }>["users"];
  expectType<true>(users.create.isInternal);
  expectType<FunctionArgs<typeof api.create>>({ name: "Ada" });
  expectType<FunctionArgs<typeof api.read>>({ id });
  expectType<FunctionArgs<typeof api.paginate>>({
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expectType<FunctionArgs<typeof api.update>>({ id, patch: { age: 42 } });
  expectType<User>(api.create._returnType);
  expectType<User | null>(api.read._returnType);
  expectType<PaginationResult<User>>(api.paginate._returnType);
  expectType<null>(api.update._returnType);
  expectType<User | null>(api.destroy._returnType);

  // @ts-expect-error The required field must still be checked.
  expectType<FunctionArgs<typeof api.create>>({});
  // @ts-expect-error Invalid patch fields must still be rejected.
  expectType<FunctionArgs<typeof api.update>>({ id, patch: { age: "42" } });
  const wrongId = "id" as GenericId<"events">;
  // @ts-expect-error IDs must still belong to the selected table.
  expectType<FunctionArgs<typeof api.read>>({ id: wrongId });
  // @ts-expect-error Returned document fields must retain their types.
  expectType<number>(api.create._returnType.name);

  const publicUsers = crud(
    schema,
    "users",
    queryGeneric as QueryBuilder<DataModel, "public">,
    mutationGeneric as MutationBuilder<DataModel, "public">,
  );
  expectType<true>(publicUsers.read.isPublic);
  expectType<true>(publicUsers.create.isPublic);

  const _events = crud(schema, "events");
  const eventsApi = null! as ApiFromModules<{
    events: typeof _events;
  }>["events"];
  expectType<DocumentByName<DataModel, "events">>(eventsApi.create._returnType);
  expectType<FunctionArgs<typeof eventsApi.create>>({
    kind: "joined",
    userId: id,
  });
  expectType<FunctionArgs<typeof eventsApi.create>>({
    kind: "left",
    reason: "Done",
  });
  // @ts-expect-error Union members must retain their required fields.
  expectType<FunctionArgs<typeof eventsApi.create>>({ kind: "joined" });
}

export function checkStreams(db: GenericDatabaseReader<DataModel>) {
  const users = stream(db, schema).query("users");
  expectType<QueryReflection<typeof schema, "users", "by_creation_time">>(
    users.reflect(),
  );
  const indexed = users.withIndex("by_name", (q) => q.eq("name", "Ada"));
  expectType<QueryReflection<typeof schema, "users", "by_name">>(
    indexed.reflect(),
  );
  expectType<QueryReflection<typeof schema, "users", "by_name">>(
    indexed.order("desc").reflect(),
  );
  expectType<Promise<User[]>>(indexed.collect());
  // @ts-expect-error Index field types must still be checked.
  users.withIndex("by_name", (q) => q.eq("name", 42));
  // @ts-expect-error Unknown indexes must still be rejected.
  users.withIndex("missing");
}

const looseSchema = defineSchema(tables, { strictTableNameTypes: false });
export function checkLooseSchema(
  db: GenericDatabaseReader<DataModelFromSchemaDefinition<typeof looseSchema>>,
) {
  expectType<QueryReflection<typeof looseSchema, "users", "by_name">>(
    stream(db, looseSchema).query("users").withIndex("by_name").reflect(),
  );
}

export function checkFunctionHandles(value: unknown) {
  const signature = v.function({
    fnType: "mutation",
    args: { count: v.number() },
    returns: v.string(),
  });
  type Handle = FunctionHandle_future<"mutation", { count: number }, string>;
  const required = vRequired(v.optional(signature));
  expectType<Handle>(required.type);
  const handle3 = convexToZod3(required).parse(value);
  const handle4 = convexToZod4(required).parse(value);
  expectType<Handle>(handle3);
  expectType<Handle>(handle4);
  expectType<Handle>(parse(required, value));
  // @ts-expect-error Conversion must retain the argument type, not widen to any.
  expectType<string>((null! as FunctionArgs<typeof handle3>).count);
  // @ts-expect-error Conversion must retain the return type, not widen to any.
  expectType<number>(null! as FunctionReturnType<typeof handle4>);
  // @ts-expect-error Removing optionality must exclude undefined.
  expectType<typeof required.type>(undefined);

  const optional = v.optional(signature);
  expectType<Handle | undefined>(convexToZod3(optional).parse(value));
  expectType<Handle | undefined>(convexToZod4(optional).parse(value));
}
