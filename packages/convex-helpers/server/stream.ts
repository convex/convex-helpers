/* eslint-disable no-unexpected-multiline */
import type { Value } from "convex/values";
import {
  convexToJson,
  compareValues,
  jsonToConvex,
  getDocumentSize,
} from "convex/values";
import type {
  DataModelFromSchemaDefinition,
  DocumentByInfo,
  DocumentByName,
  GenericDataModel,
  GenericDatabaseReader,
  IndexNames,
  IndexRange,
  IndexRangeBuilder,
  NamedIndex,
  NamedTableInfo,
  OrderedQuery,
  PaginationOptions,
  PaginationResult,
  Query,
  QueryInitializer,
  SchemaDefinition,
  SystemDataModel,
  TableNamesInDataModel,
} from "convex/server";

export type IndexKey = (Value | undefined)[];

// From https://docs.convex.dev/production/state/limits#transactions
const MAX_DOCUMENT_SCAN_LEN = 32000;
// Value used to trigger page split suggestions. This is kind of
// a backstop value to mitigate additional scans over the full
// original range if documents change later. Making it smaller
// would result in more splits (equal to the divisor) as the
// number of documents scanned approaches the max.
const SOFT_MAX_SCAN_LEN = MAX_DOCUMENT_SCAN_LEN / 2;

//
// Helper functions
//

function makeExclusive(boundType: "gt" | "lt" | "gte" | "lte") {
  if (boundType === "gt" || boundType === "gte") {
    return "gt";
  }
  return "lt";
}

type Bound = ["gt" | "lt" | "gte" | "lte" | "eq", string, Value];

/** Split a range query between two index keys into a series of range queries
 * that should be executed in sequence. This is necessary because Convex only
 * supports range queries of the form
 * q.eq("f1", v).eq("f2", v).lt("f3", v).gt("f3", v).
 * i.e. all fields must be equal except for the last field, which can have
 * two inequalities.
 *
 * For example, the range from >[1, 2, 3] to <=[1, 3, 2] would be split into
 * the following queries:
 * 1. q.eq("f1", 1).eq("f2", 2).gt("f3", 3)
 * 2. q.eq("f1", 1).gt("f2", 2).lt("f2", 3)
 * 3. q.eq("f1", 1).eq("f2", 3).lte("f3", 2)
 */
function splitRange(
  indexFields: string[],
  // For descending queries, the resulting queries are reversed.
  order: "asc" | "desc",
  startBound: IndexKey,
  endBound: IndexKey,
  startBoundType: "gt" | "lt" | "gte" | "lte",
  endBoundType: "gt" | "lt" | "gte" | "lte",
): Bound[][] {
  // Three parts to the split:
  // 1. reduce down from startBound to common prefix
  // 2. range with common prefix
  // 3. build back up from common prefix to endBound
  const commonPrefix: Bound[] = [];
  while (
    startBound.length > 0 &&
    endBound.length > 0 &&
    compareValues(startBound[0]!, endBound[0]!) === 0
  ) {
    const indexField = indexFields[0]!;
    indexFields = indexFields.slice(1);
    const eqBound = startBound[0]!;
    startBound = startBound.slice(1);
    endBound = endBound.slice(1);
    commonPrefix.push(["eq", indexField, eqBound]);
  }
  const makeCompare = (
    boundType: "gt" | "lt" | "gte" | "lte",
    key: IndexKey,
  ) => {
    const range = commonPrefix.slice();
    let i = 0;
    for (; i < key.length - 1; i++) {
      range.push(["eq", indexFields[i]!, key[i]!]);
    }
    if (i < key.length) {
      range.push([boundType, indexFields[i]!, key[i]!]);
    }
    return range;
  };
  // Stage 1.
  const startRanges: Bound[][] = [];
  while (startBound.length > 1) {
    startRanges.push(makeCompare(startBoundType, startBound));
    startBoundType = makeExclusive(startBoundType);
    startBound = startBound.slice(0, -1);
  }
  // Stage 3.
  const endRanges: Bound[][] = [];
  while (endBound.length > 1) {
    endRanges.push(makeCompare(endBoundType, endBound));
    endBoundType = makeExclusive(endBoundType);
    endBound = endBound.slice(0, -1);
  }
  endRanges.reverse();
  // Stage 2.
  let middleRange;
  if (endBound.length === 0) {
    middleRange = makeCompare(startBoundType, startBound);
  } else if (startBound.length === 0) {
    middleRange = makeCompare(endBoundType, endBound);
  } else {
    const startValue = startBound[0]!;
    const endValue = endBound[0]!;
    middleRange = commonPrefix.slice();
    middleRange.push([startBoundType, indexFields[0]!, startValue]);
    middleRange.push([endBoundType, indexFields[0]!, endValue]);
  }
  const ranges = [...startRanges, middleRange, ...endRanges];
  if (order === "desc") {
    ranges.reverse();
  }
  return ranges;
}

function rangeToQuery(range: Bound[]) {
  return (q: any) => {
    for (const [boundType, field, value] of range) {
      q = q[boundType](field, value);
    }
    return q;
  };
}

/**
 * Get the ordered list of fields for a given table's index based on the schema.
 *
 * - For "by_creation_time", returns ["_creationTime", "_id"].
 * - For "by_id", returns ["_id"].
 * - Otherwise, looks up the named index in the schema and returns its fields
 *   followed by ["_creationTime", "_id"].
 * e.g. for an index defined like `.index("abc", ["a", "b"])`,
 * returns ["a", "b", "_creationTime", "_id"].
 */
export function getIndexFields<
  Schema extends SchemaDefinition<any, boolean>,
  T extends TableNamesInDataModel<DM<Schema>>,
>(
  table: T,
  index?: IndexNames<NamedTableInfo<DM<Schema>, T>>,
  schema?: Schema,
): string[] {
  const indexDescriptor = String(index ?? "by_creation_time");
  if (indexDescriptor === "by_creation_time") {
    return ["_creationTime", "_id"];
  }
  if (indexDescriptor === "by_id") {
    return ["_id"];
  }
  if (!schema) {
    throw new Error("schema is required to infer index fields");
  }
  const tableInfo = schema.tables[table];
  const indexInfo = tableInfo.indexes.find(
    (index: any) => index.indexDescriptor === indexDescriptor,
  );
  if (!indexInfo) {
    throw new Error(`Index ${indexDescriptor} not found in table ${table}`);
  }
  const fields = indexInfo.fields.slice();
  fields.push("_creationTime");
  fields.push("_id");
  return fields;
}

function getIndexKey<
  DataModel extends GenericDataModel,
  T extends TableNamesInDataModel<DataModel>,
>(doc: DocumentByName<DataModel, T>, indexFields: string[]): IndexKey {
  const key: IndexKey = [];
  for (const field of indexFields) {
    let obj: any = doc;
    for (const subfield of field.split(".")) {
      obj = obj[subfield];
    }
    key.push(obj);
  }
  return key;
}

/**
 * A "stream" is an async iterable of query results, ordered by an index on a table.
 *
 * Use it as you would use `ctx.db`.
 * If using pagination in a reactive query, see the warnings on the `paginator`
 * function. TL;DR: you need to pass in `endCursor` to prevent holes or overlaps
 * between pages.
 *
 * Once you have a stream, you can use `mergeStreams` or `filterStream` to make
 * more streams. Then use `queryStream` to convert it into an OrderedQuery,
 * so you can call `.paginate()`, `.collect()`, etc.
 */
export function stream<Schema extends SchemaDefinition<any, boolean>>(
  db: GenericDatabaseReader<DM<Schema>>,
  schema: Schema,
): StreamDatabaseReader<Schema> {
  return new StreamDatabaseReader(db, schema);
}

type GenericStreamItem = NonNullable<unknown>;

type StreamIterable<T> = AsyncIterable<[T | null, IndexKey, number], undefined>;
type StreamResult<T> = IteratorResult<[T | null, IndexKey, number], undefined>;

/**
 * A "QueryStream" is an async iterable of query results, ordered by indexed fields.
 */
export abstract class QueryStream<
  T extends GenericStreamItem,
> implements GenericOrderedQuery<T> {
  // Methods that subclasses must implement so OrderedQuery can be implemented.
  /**
   * Iterate over documents with their index keys and bandwidth consumed.
   * @param trackBandwidth - If true, tracks bytes read using getDocumentSize. Defaults to false for efficiency.
   * @returns AsyncIterable of [document | null, indexKey, bytesRead]
   *   - document: The document or null if filtered out
   *   - indexKey: The index key for cursor positioning
   *   - bytesRead: Bytes consumed to produce this result (0 if trackBandwidth is false)
   */
  abstract iterWithKeys(trackBandwidth?: boolean): StreamIterable<T>;
  abstract narrow(indexBounds: IndexBounds): QueryStream<T>;

  // Methods so subclasses can make sure streams are combined correctly.
  abstract getOrder(): "asc" | "desc";
  abstract getIndexFields(): string[];
  // Values that must match a prefix of the index key.
  abstract getEqualityIndexFilter(): Value[];

  /** @internal A cursor with the same pagination boundary as this index key. */
  getPaginationKey(indexKey: IndexKey): IndexKey {
    return indexKey;
  }

  /// Methods for creating new streams as modifications of the current stream.

  /**
   * Create a new stream with a TypeScript filter applied.
   *
   * This is similar to `db.query(tableName).filter(predicate)`, but it's more
   * general because it can call arbitrary TypeScript code, including more
   * database queries.
   *
   * All documents filtered out are still considered "read" from the database;
   * they are just excluded from the output stream.
   *
   * In contrast to `filter` from convex-helpers/server/filter, this filterWith
   * is applied *before* any pagination. That means if the filter excludes a lot
   * of documents, the `.paginate()` method will read a lot of documents until
   * it gets as many documents as it wants. If you run into issues with reading
   * too much data, you can pass `maximumRowsRead` to `paginate()`.
   *
   * When a read limit stops a page that has returned at least one document,
   * the page's cursors point at returned documents, never at filtered-out ones,
   * and the rows scanned after the last returned document are re-scanned by the
   * next page. A page stopped before returning anything continues from the last
   * row scanned, so its cursor does name a filtered-out document.
   */
  filterWith(predicate: (doc: T) => Promise<boolean>): QueryStream<T> {
    const order = this.getOrder();
    return new FlatMapStream(
      this,
      async (doc: T) => {
        const filtered = (await predicate(doc)) ? doc : null;
        return new SingletonStream(filtered, order, [], [], []);
      },
      [],
    );
  }
  /**
   * Create a new stream where each element is the result of applying the mapper
   * function to the elements of the original stream.
   *
   * Similar to how [1, 2, 3].map(x => x * 2) => [2, 4, 6]
   */
  map<U extends GenericStreamItem>(
    mapper: (doc: T) => Promise<U | null>,
  ): QueryStream<U> {
    const order = this.getOrder();
    return new FlatMapStream(
      this,
      async (doc: T) => {
        const mapped = await mapper(doc);
        return new SingletonStream(mapped, order, [], [], []);
      },
      [],
    );
  }
  /**
   * Similar to flatMap on an array, but iterate over a stream, and then for each
   * element, iterate over the stream created by the mapper function.
   *
   * Ordered by the original stream order, then the mapped stream. Similar to
   * how ["a", "b"].flatMap(letter => [letter, letter]) => ["a", "a", "b", "b"]
   *
   * @param mapper A function that takes a document and returns a new stream.
   * @param mappedIndexFields The index fields of the streams created by mapper.
   * @returns A stream of documents returned by the mapper streams,
   *   grouped by the documents in the original stream.
   */
  flatMap<U extends GenericStreamItem>(
    mapper: (doc: T) => Promise<QueryStream<U>>,
    mappedIndexFields: string[],
  ): QueryStream<U> {
    normalizeIndexFields(mappedIndexFields);
    return new FlatMapStream(this, mapper, mappedIndexFields);
  }

  /**
   * Get the first item from the original stream for each distinct value of the
   * selected index fields.
   *
   * e.g. if the stream has an equality filter on `a`, and index fields `[a, b, c]`,
   * we can do `stream.distinct(["b"])` to get a stream of the first item for
   * each distinct value of `b`.
   * Similarly, you could do `stream.distinct(["a", "b"])` with the same result,
   * or `stream.distinct(["a", "b", "c"])` to get the original stream.
   *
   * This stream efficiently skips past items with the same value for the selected
   * distinct index fields.
   *
   * This can be used to perform a loose index scan.
   *
   * Read limits (`maximumRowsRead` / `maximumBytesRead`) apply to the whole
   * page, not separately to each group. When a limit stops a page that has
   * returned at least one item, the page resumes after its last returned item,
   * so groups examined after it are re-scanned with a fresh budget on the next
   * page. When a limit stops a page before it returns anything, the page
   * advances past the last group examined, even if that group still has unread
   * matching items, so those items are skipped.
   */
  distinct(distinctIndexFields: string[]): QueryStream<T> {
    return new DistinctStream(this, distinctIndexFields);
  }

  /// Implementation of OrderedQuery

  filter(_predicate: any): never {
    throw new Error(
      "Cannot call .filter() directly on a query stream. Use .filterWith() for filtering or .collect() if you want to convert the stream to an array first.",
    );
  }
  async paginate(
    opts: PaginationOptions & {
      endCursor?: string | null;
      maximumRowsRead?: number;
      maximumBytesRead?: number;
    },
  ): Promise<PaginationResult<T>> {
    if (opts.numItems === 0) {
      if (opts.cursor === null) {
        throw new Error(
          ".paginate called with cursor of null and 0 for numItems. " +
            "This is not supported, as null is not a valid continueCursor. " +
            "Advice: avoid calling paginate entirely in these cases.",
        );
      }
      return {
        page: [],
        isDone: false,
        continueCursor: opts.cursor,
      };
    }
    const order = this.getOrder();
    let newStartKey = {
      key: [] as IndexKey,
      inclusive: true,
    };
    if (opts.cursor !== null) {
      newStartKey = {
        key: deserializeCursor(opts.cursor),
        inclusive: false,
      };
    }
    let newEndKey = {
      key: [] as IndexKey,
      inclusive: true,
    };
    const maxRowsToRead = opts.maximumRowsRead;
    let maxRows: number | undefined = opts.numItems;
    if (opts.endCursor) {
      newEndKey = {
        key: deserializeCursor(opts.endCursor),
        inclusive: true,
      };
      // If there's an endCursor, continue until we get there even if it's more
      // than numItems.
      maxRows = undefined;
    }
    const newLowerBound = order === "asc" ? newStartKey : newEndKey;
    const newUpperBound = order === "asc" ? newEndKey : newStartKey;
    const narrowStream = this.narrow({
      lowerBound: newLowerBound.key,
      lowerBoundInclusive: newLowerBound.inclusive,
      upperBound: newUpperBound.key,
      upperBoundInclusive: newUpperBound.inclusive,
    });
    const page: T[] = [];
    const indexKeys: IndexKey[] = [];
    const resultKeys: IndexKey[] = [];
    let hasMore = opts.endCursor && opts.endCursor !== "[]";
    let continueCursor = opts.endCursor ?? "[]";
    const maxBytesToRead = opts.maximumBytesRead;
    const trackBandwidth = maxBytesToRead !== undefined;
    let totalBytesRead = 0;
    let hitLimit = false;
    for await (const [doc, indexKey, bandwidth] of narrowStream.iterWithKeys(
      trackBandwidth,
    )) {
      if (doc !== null) {
        page.push(doc);
        resultKeys.push(indexKey);
      }
      indexKeys.push(indexKey);
      totalBytesRead += bandwidth;
      if (
        (maxBytesToRead !== undefined && totalBytesRead >= maxBytesToRead) ||
        (maxRowsToRead !== undefined && indexKeys.length >= maxRowsToRead)
      ) {
        hitLimit = true;
      }
      if (hitLimit || (maxRows !== undefined && page.length >= maxRows)) {
        hasMore = true;
        // Retry work after the last result when choosing a new boundary. Keep
        // existing progress semantics for refreshes with a fixed endCursor.
        // Empty pages still advance; distinct uses a whole-group boundary.
        continueCursor = serializeCursor(
          opts.endCursor
            ? indexKey
            : (resultKeys.at(-1) ?? this.getPaginationKey(indexKey)),
        );
        break;
      }
    }
    let pageStatus: "SplitRecommended" | "SplitRequired" | undefined =
      undefined;
    let splitCursor: IndexKey | undefined = undefined;
    // Split at a returned item whenever there is one, so a nonempty page's
    // cursors only ever name documents the caller was allowed to see. Only an
    // empty page falls back to a position among the scanned (filtered) rows.
    const splitKeys = resultKeys.length > 0 ? resultKeys : indexKeys;
    const splitIndex = Math.floor((splitKeys.length - 1) / 2);
    if (hitLimit) {
      pageStatus = "SplitRequired";
      splitCursor = splitKeys[splitIndex];
    } else if (
      indexKeys.length >= SOFT_MAX_SCAN_LEN ||
      page.length > opts.numItems + 1
    ) {
      pageStatus = "SplitRecommended";
      splitCursor = splitKeys[splitIndex];
    }
    return {
      page,
      isDone: !hasMore,
      continueCursor,
      pageStatus,
      splitCursor: splitCursor
        ? serializeCursor(
            resultKeys.length > 0
              ? splitCursor
              : this.getPaginationKey(splitCursor),
          )
        : undefined,
    };
  }
  async collect() {
    return await this.take(Infinity);
  }
  async take(n: number) {
    const results: T[] = [];
    for await (const [doc] of this.iterWithKeys()) {
      if (doc === null) {
        continue;
      }
      results.push(doc);
      if (results.length === n) {
        break;
      }
    }
    return results;
  }
  async unique() {
    const docs = await this.take(2);
    if (docs.length === 2) {
      throw new Error("Query is not unique");
    }
    return docs[0] ?? null;
  }
  async first() {
    const docs = await this.take(1);
    return docs[0] ?? null;
  }
  [Symbol.asyncIterator](): AsyncIterator<T, undefined> {
    const iterator = this.iterWithKeys()[Symbol.asyncIterator]();
    return {
      async next() {
        const result = await iterator.next();
        if (result.done) {
          return { done: true, value: undefined };
        }
        return { done: false, value: result.value[0]! };
      },
    };
  }
}

/**
 * GenericOrderedQuery<DocumentByInfo<TableInfo>> is equivalent to OrderedQuery<TableInfo>
 */
export interface GenericOrderedQuery<T> extends AsyncIterable<T> {
  /**
   * Load a page of `n` results and obtain a {@link Cursor} for loading more.
   *
   * Note: If this is called from a reactive query function the number of
   * results may not match `paginationOpts.numItems`!
   *
   * `paginationOpts.numItems` is only an initial value. After the first invocation,
   * `paginate` will return all items in the original query range. This ensures
   * that all pages will remain adjacent and non-overlapping.
   *
   * @param paginationOpts - A {@link PaginationOptions} object containing the number
   * of items to load and the cursor to start at.
   * @returns A {@link PaginationResult} containing the page of results and a
   * cursor to continue paginating.
   */
  paginate(paginationOpts: PaginationOptions): Promise<PaginationResult<T>>;

  /**
   * Execute the query and return all of the results as an array.
   *
   * Note: when processing a query with a lot of results, it's often better to use the `Query` as an
   * `AsyncIterable` instead.
   *
   * @returns - An array of all of the query's results.
   */
  collect(): Promise<Array<T>>;

  /**
   * Execute the query and return the first `n` results.
   *
   * @param n - The number of items to take.
   * @returns - An array of the first `n` results of the query (or less if the
   * query doesn't have `n` results).
   */
  take(n: number): Promise<Array<T>>;

  /**
   * Execute the query and return the first result if there is one.
   *
   * @returns - The first value of the query or `null` if the query returned no results.
   * */
  first(): Promise<T | null>;

  /**
   * Execute the query and return the singular result if there is one.
   *
   * @returns - The single result returned from the query or null if none exists.
   * @throws  Will throw an error if the query returns more than one result.
   */
  unique(): Promise<T | null>;

  /**
   * Not supported. Use `filterWith` instead.
   */
  filter(predicate: any): this;
}

export class StreamDatabaseReader<
  Schema extends SchemaDefinition<any, boolean>,
> implements GenericDatabaseReader<DM<Schema>> {
  // TODO: support system tables
  public system: GenericDatabaseReader<SystemDataModel>["system"];

  constructor(
    public db: GenericDatabaseReader<DM<Schema>>,
    public schema: Schema,
  ) {
    this.system = db.system;
  }

  query<TableName extends TableNamesInDataModel<DM<Schema>>>(
    tableName: TableName,
  ): StreamQueryInitializer<Schema, TableName> {
    return new StreamQueryInitializer(this, tableName);
  }
  get(_id: any): any {
    throw new Error("get() not supported for `paginator`");
  }
  normalizeId(_tableName: any, _id: any): any {
    throw new Error("normalizeId() not supported for `paginator`.");
  }
}

type DM<Schema extends SchemaDefinition<any, boolean>> =
  DataModelFromSchemaDefinition<Schema>;

export type IndexBounds = {
  lowerBound: IndexKey;
  lowerBoundInclusive: boolean;
  upperBound: IndexKey;
  upperBoundInclusive: boolean;
};

export type QueryReflection<
  Schema extends SchemaDefinition<any, boolean>,
  T extends TableNamesInDataModel<DM<Schema>>,
  IndexName extends IndexNames<NamedTableInfo<DM<Schema>, T>>,
> = {
  db: GenericDatabaseReader<DataModelFromSchemaDefinition<Schema>>;
  schema: Schema;
  table: T;
  index: IndexName;
  indexFields: string[];
  order: "asc" | "desc";
  bounds: IndexBounds;
  indexRange?: (
    q: IndexRangeBuilder<
      DocumentByInfo<NamedTableInfo<DM<Schema>, T>>,
      NamedIndex<NamedTableInfo<DM<Schema>, T>, IndexName>
    >,
  ) => IndexRange;
};

export abstract class StreamableQuery<
  Schema extends SchemaDefinition<any, boolean>,
  T extends TableNamesInDataModel<DM<Schema>>,
  IndexName extends IndexNames<NamedTableInfo<DM<Schema>, T>>,
>
  extends QueryStream<DocumentByInfo<NamedTableInfo<DM<Schema>, T>>>
  // this "implements" is redundant, since QueryStream implies it, but it acts as a type-time assertion.
  implements OrderedQuery<NamedTableInfo<DM<Schema>, T>>
{
  abstract reflect(): QueryReflection<Schema, T, IndexName>;
}

export class StreamQueryInitializer<
  Schema extends SchemaDefinition<any, boolean>,
  T extends TableNamesInDataModel<DM<Schema>>,
>
  extends StreamableQuery<Schema, T, "by_creation_time">
  implements QueryInitializer<NamedTableInfo<DM<Schema>, T>>
{
  constructor(
    public parent: StreamDatabaseReader<Schema>,
    public table: T,
  ) {
    super();
  }
  fullTableScan(): StreamQuery<Schema, T, "by_creation_time"> {
    return this.withIndex("by_creation_time");
  }
  withIndex<IndexName extends IndexNames<NamedTableInfo<DM<Schema>, T>>>(
    indexName: IndexName,
    indexRange?: (
      q: IndexRangeBuilder<
        DocumentByInfo<NamedTableInfo<DM<Schema>, T>>,
        NamedIndex<NamedTableInfo<DM<Schema>, T>, IndexName>
      >,
    ) => IndexRange,
  ): StreamQuery<Schema, T, IndexName> {
    const indexFields = getIndexFields<Schema, T>(
      this.table,
      indexName,
      this.parent.schema,
    );
    const q = new ReflectIndexRange(indexFields);
    if (indexRange) {
      indexRange(q as any);
    }
    return new StreamQuery(this, indexName, q, indexRange);
  }
  withSearchIndex(_indexName: any, _searchFilter: any): any {
    throw new Error("Cannot paginate withSearchIndex");
  }
  inner() {
    return this.fullTableScan();
  }
  order(
    order: "asc" | "desc",
  ): OrderedStreamQuery<Schema, T, "by_creation_time"> {
    return this.inner().order(order);
  }
  reflect() {
    return this.inner().reflect();
  }
  iterWithKeys(trackBandwidth = false) {
    return this.inner().iterWithKeys(trackBandwidth);
  }
  getOrder(): "asc" | "desc" {
    return this.inner().getOrder();
  }
  getEqualityIndexFilter(): Value[] {
    return this.inner().getEqualityIndexFilter();
  }
  getIndexFields(): string[] {
    return this.inner().getIndexFields();
  }
  narrow(indexBounds: IndexBounds) {
    return this.inner().narrow(indexBounds);
  }
}

// Not to be confused with QueryStream or StreamableQuery.
export class StreamQuery<
  Schema extends SchemaDefinition<any, boolean>,
  T extends TableNamesInDataModel<DM<Schema>>,
  IndexName extends IndexNames<NamedTableInfo<DM<Schema>, T>>,
>
  extends StreamableQuery<Schema, T, IndexName>
  implements Query<NamedTableInfo<DM<Schema>, T>>
{
  constructor(
    public parent: StreamQueryInitializer<Schema, T>,
    public index: IndexName,
    public q: ReflectIndexRange,
    public indexRange:
      | ((
          q: IndexRangeBuilder<
            DocumentByInfo<NamedTableInfo<DM<Schema>, T>>,
            NamedIndex<NamedTableInfo<DM<Schema>, T>, IndexName>
          >,
        ) => IndexRange)
      | undefined,
  ) {
    super();
  }
  order(order: "asc" | "desc") {
    return new OrderedStreamQuery(this, order);
  }
  inner() {
    return this.order("asc");
  }
  reflect() {
    return this.inner().reflect();
  }
  iterWithKeys(trackBandwidth = false) {
    return this.inner().iterWithKeys(trackBandwidth);
  }
  getOrder(): "asc" | "desc" {
    return this.inner().getOrder();
  }
  getEqualityIndexFilter(): Value[] {
    return this.inner().getEqualityIndexFilter();
  }
  getIndexFields(): string[] {
    return this.inner().getIndexFields();
  }
  narrow(indexBounds: IndexBounds) {
    return this.inner().narrow(indexBounds);
  }
}

export class OrderedStreamQuery<
  Schema extends SchemaDefinition<any, boolean>,
  T extends TableNamesInDataModel<DM<Schema>>,
  IndexName extends IndexNames<NamedTableInfo<DM<Schema>, T>>,
>
  extends StreamableQuery<Schema, T, IndexName>
  implements OrderedQuery<NamedTableInfo<DM<Schema>, T>>
{
  constructor(
    public parent: StreamQuery<Schema, T, IndexName>,
    public order: "asc" | "desc",
  ) {
    super();
  }
  reflect() {
    return {
      db: this.parent.parent.parent.db,
      schema: this.parent.parent.parent.schema,
      table: this.parent.parent.table,
      index: this.parent.index,
      indexFields: this.parent.q.indexFields,
      order: this.order,
      bounds: {
        lowerBound: this.parent.q.lowerBoundIndexKey ?? [],
        lowerBoundInclusive: this.parent.q.lowerBoundInclusive,
        upperBound: this.parent.q.upperBoundIndexKey ?? [],
        upperBoundInclusive: this.parent.q.upperBoundInclusive,
      },
      indexRange: this.parent.indexRange,
    };
  }
  /**
   * inner() is as if you had used ctx.db to construct the query.
   */
  inner(): OrderedQuery<NamedTableInfo<DM<Schema>, T>> {
    const { db, table, index, order, indexRange } = this.reflect();
    return db.query(table).withIndex(index, indexRange).order(order);
  }
  iterWithKeys(
    trackBandwidth = false,
  ): StreamIterable<DocumentByName<DM<Schema>, T>> {
    const { indexFields } = this.reflect();
    const iterable = this.inner();
    return {
      [Symbol.asyncIterator]() {
        const iterator = iterable[Symbol.asyncIterator]();
        return {
          async next() {
            const result = await iterator.next();
            if (result.done) {
              return { done: true, value: undefined };
            }
            const doc = result.value;
            const bandwidth = trackBandwidth ? getDocumentSize(doc) : 0;
            return {
              done: false,
              value: [doc, getIndexKey(doc, indexFields), bandwidth],
            };
          },
        };
      },
    };
  }
  getOrder(): "asc" | "desc" {
    return this.order;
  }
  getEqualityIndexFilter(): Value[] {
    return this.parent.q.equalityIndexFilter;
  }
  getIndexFields(): string[] {
    return this.parent.q.indexFields;
  }
  narrow(indexBounds: IndexBounds) {
    const { db, table, index, order, bounds, schema } = this.reflect();
    let maxLowerBound = bounds.lowerBound;
    let maxLowerBoundInclusive = bounds.lowerBoundInclusive;
    if (
      compareKeys(
        {
          value: indexBounds.lowerBound,
          kind: indexBounds.lowerBoundInclusive ? "predecessor" : "successor",
        },
        {
          value: bounds.lowerBound,
          kind: bounds.lowerBoundInclusive ? "predecessor" : "successor",
        },
      ) > 0
    ) {
      maxLowerBound = indexBounds.lowerBound;
      maxLowerBoundInclusive = indexBounds.lowerBoundInclusive;
    }
    let minUpperBound = bounds.upperBound;
    let minUpperBoundInclusive = bounds.upperBoundInclusive;
    if (
      compareKeys(
        {
          value: indexBounds.upperBound,
          kind: indexBounds.upperBoundInclusive ? "successor" : "predecessor",
        },
        {
          value: bounds.upperBound,
          kind: bounds.upperBoundInclusive ? "successor" : "predecessor",
        },
      ) < 0
    ) {
      minUpperBound = indexBounds.upperBound;
      minUpperBoundInclusive = indexBounds.upperBoundInclusive;
    }
    const narrowed = streamIndexRange(
      db,
      schema,
      table,
      index,
      {
        lowerBound: maxLowerBound,
        lowerBoundInclusive: maxLowerBoundInclusive,
        upperBound: minUpperBound,
        upperBoundInclusive: minUpperBoundInclusive,
      },
      order,
    );
    // Retain fixed index fields when the intersection is empty.
    return narrowed instanceof EmptyStream
      ? new EmptyStream<DocumentByName<DM<Schema>, T>>(
          order,
          this.getIndexFields(),
          this.getEqualityIndexFilter(),
        )
      : narrowed;
  }
}

/**
 * Create a stream of documents using the given index and bounds.
 */
export function streamIndexRange<
  Schema extends SchemaDefinition<any, boolean>,
  T extends TableNamesInDataModel<DM<Schema>>,
  IndexName extends IndexNames<NamedTableInfo<DM<Schema>, T>>,
>(
  db: GenericDatabaseReader<DM<Schema>>,
  schema: Schema,
  table: T,
  index: IndexName,
  bounds: IndexBounds,
  order: "asc" | "desc",
): QueryStream<DocumentByName<DM<Schema>, T>> {
  const indexFields = getIndexFields(table, index, schema);
  // Empty intersections have no subranges to split.
  if (
    compareKeys(
      {
        value: bounds.lowerBound,
        kind: bounds.lowerBoundInclusive ? "predecessor" : "successor",
      },
      {
        value: bounds.upperBound,
        kind: bounds.upperBoundInclusive ? "successor" : "predecessor",
      },
    ) >= 0
  ) {
    return new EmptyStream(order, indexFields);
  }
  const splitBounds = splitRange(
    indexFields,
    order,
    bounds.lowerBound,
    bounds.upperBound,
    bounds.lowerBoundInclusive ? "gte" : "gt",
    bounds.upperBoundInclusive ? "lte" : "lt",
  );
  const subQueries = splitBounds.map((splitBound) =>
    stream(db, schema)
      .query(table)
      .withIndex(index, rangeToQuery(splitBound))
      .order(order),
  );
  return new ConcatStreams(...subQueries);
}

class ReflectIndexRange {
  #hasSuffix = false;
  public lowerBoundIndexKey: IndexKey | undefined = undefined;
  public lowerBoundInclusive: boolean = true;
  public upperBoundIndexKey: IndexKey | undefined = undefined;
  public upperBoundInclusive: boolean = true;
  public equalityIndexFilter: Value[] = [];
  constructor(public indexFields: string[]) {}
  eq(field: string, value: Value) {
    if (!this.#canLowerBound(field) || !this.#canUpperBound(field)) {
      throw new Error(`Cannot use eq on field '${field}'`);
    }
    this.lowerBoundIndexKey = this.lowerBoundIndexKey ?? [];
    this.lowerBoundIndexKey.push(value);
    this.upperBoundIndexKey = this.upperBoundIndexKey ?? [];
    this.upperBoundIndexKey.push(value);
    this.equalityIndexFilter.push(value);
    return this;
  }
  lt(field: string, value: Value) {
    if (!this.#canUpperBound(field)) {
      throw new Error(`Cannot use lt on field '${field}'`);
    }
    this.upperBoundIndexKey = this.upperBoundIndexKey ?? [];
    this.upperBoundIndexKey.push(value);
    this.upperBoundInclusive = false;
    this.#hasSuffix = true;
    return this;
  }
  lte(field: string, value: Value) {
    if (!this.#canUpperBound(field)) {
      throw new Error(`Cannot use lte on field '${field}'`);
    }
    this.upperBoundIndexKey = this.upperBoundIndexKey ?? [];
    this.upperBoundIndexKey.push(value);
    this.#hasSuffix = true;
    return this;
  }
  gt(field: string, value: Value) {
    if (!this.#canLowerBound(field)) {
      throw new Error(`Cannot use gt on field '${field}'`);
    }
    this.lowerBoundIndexKey = this.lowerBoundIndexKey ?? [];
    this.lowerBoundIndexKey.push(value);
    this.lowerBoundInclusive = false;
    this.#hasSuffix = true;
    return this;
  }
  gte(field: string, value: Value) {
    if (!this.#canLowerBound(field)) {
      throw new Error(`Cannot use gte on field '${field}'`);
    }
    this.lowerBoundIndexKey = this.lowerBoundIndexKey ?? [];
    this.lowerBoundIndexKey.push(value);
    this.#hasSuffix = true;
    return this;
  }
  #canLowerBound(field: string) {
    const currentLowerBoundLength = this.lowerBoundIndexKey?.length ?? 0;
    const currentUpperBoundLength = this.upperBoundIndexKey?.length ?? 0;
    if (currentLowerBoundLength > currentUpperBoundLength) {
      // Already have a lower bound.
      return false;
    }
    if (
      currentLowerBoundLength === currentUpperBoundLength &&
      this.#hasSuffix
    ) {
      // Already have a lower bound and an upper bound.
      return false;
    }
    return (
      currentLowerBoundLength < this.indexFields.length &&
      this.indexFields[currentLowerBoundLength] === field
    );
  }
  #canUpperBound(field: string) {
    const currentLowerBoundLength = this.lowerBoundIndexKey?.length ?? 0;
    const currentUpperBoundLength = this.upperBoundIndexKey?.length ?? 0;
    if (currentUpperBoundLength > currentLowerBoundLength) {
      // Already have an upper bound.
      return false;
    }
    if (
      currentLowerBoundLength === currentUpperBoundLength &&
      this.#hasSuffix
    ) {
      // Already have a lower bound and an upper bound.
      return false;
    }
    return (
      currentUpperBoundLength < this.indexFields.length &&
      this.indexFields[currentUpperBoundLength] === field
    );
  }
}

/**
 * Merge multiple streams, provided in any order, into a single stream.
 *
 * The streams will be merged into a stream of documents ordered by the index keys,
 * i.e. by "author" (then by the implicit "_creationTime").
 *
 * e.g. ```ts
 * mergedStream([
 *   stream(db, schema).query("messages").withIndex("by_author", q => q.eq("author", "user3")),
 *   stream(db, schema).query("messages").withIndex("by_author", q => q.eq("author", "user1")),
 *   stream(db, schema).query("messages").withIndex("by_author", q => q.eq("author", "user2")),
 * ], ["author"])
 * ```
 *
 * returns a stream of messages for user1, then user2, then user3.
 *
 * You can also use `orderByIndexFields` to change the indexed fields before merging, which changes the order of the merged stream.
 * This only works if the streams are already ordered by `orderByIndexFields`,
 * which happens if each does a .eq(field, value) on all index fields before `orderByIndexFields`.
 *
 * e.g. if the "by_author" index is defined as being ordered by ["author", "_creationTime"],
 * and each query does an equality lookup on "author", each individual query before merging is in fact ordered by "_creationTime".
 *
 * e.g. ```ts
 * mergedStream([
 *   stream(db, schema).query("messages").withIndex("by_author", q => q.eq("author", "user3")),
 *   stream(db, schema).query("messages").withIndex("by_author", q => q.eq("author", "user1")),
 *   stream(db, schema).query("messages").withIndex("by_author", q => q.eq("author", "user2")),
 * ], ["_creationTime"])
 * ```
 *
 * This returns a stream of messages from all three users, sorted by creation time.
 */
export function mergedStream<T extends GenericStreamItem>(
  streams: QueryStream<T>[],
  orderByIndexFields: string[],
): QueryStream<T> {
  return new MergedStream(streams, orderByIndexFields);
}

export class MergedStream<T extends GenericStreamItem> extends QueryStream<T> {
  #order: "asc" | "desc";
  #streams: QueryStream<T>[];
  #equalityIndexFilter: Value[];
  #indexFields: string[];
  constructor(streams: QueryStream<T>[], orderByIndexFields: string[]) {
    super();
    if (streams.length === 0) {
      throw new Error("Cannot union empty array of streams");
    }
    this.#order = allSame(
      streams.map((stream) => stream.getOrder()),
      "Cannot merge streams with different orders",
    );
    this.#streams = streams.map(
      (stream) => new OrderByStream(stream, orderByIndexFields),
    );
    this.#indexFields = allSame(
      this.#streams.map((stream) => stream.getIndexFields()),
      "Cannot merge streams with different index fields. Consider using .orderBy()",
    );
    // Calculate common prefix of equality index filters.
    this.#equalityIndexFilter = commonPrefix(
      this.#streams.map((stream) => stream.getEqualityIndexFilter()),
    );
  }
  iterWithKeys(trackBandwidth = false): StreamIterable<T> {
    const iterables = this.#streams.map((stream) =>
      stream.iterWithKeys(trackBandwidth),
    );
    const comparisonInversion = this.#order === "asc" ? 1 : -1;
    return {
      [Symbol.asyncIterator]() {
        const iterators = iterables.map((iterable) =>
          iterable[Symbol.asyncIterator](),
        );
        const results: (StreamResult<T> | undefined)[] = Array(
          iterators.length,
        );
        // Track bandwidth from pre-fetched documents not yet yielded
        const pendingBandwidth = Array(iterators.length).fill(0);
        return {
          async next() {
            let bandwidthThisIteration = 0;
            // Fill results from iterators with no value yet.
            await Promise.all(
              iterators.map(async (iterator, i) => {
                if (!results[i]) {
                  const result = await iterator.next();
                  results[i] = result;
                  // Track bandwidth from pre-fetched documents
                  if (trackBandwidth && !result.done && result.value) {
                    pendingBandwidth[i] = result.value[2];
                  }
                }
              }),
            );
            // Sum all pending bandwidth (pre-fetched docs) for this iteration
            if (trackBandwidth) {
              for (let i = 0; i < pendingBandwidth.length; i++) {
                bandwidthThisIteration += pendingBandwidth[i]!;
                pendingBandwidth[i] = 0;
              }
            }
            // Find index for the value with the lowest index key.
            let minIndexKeyAndIndex: [IndexKey, number] | undefined = undefined;
            for (let i = 0; i < results.length; i++) {
              const result = results[i]!;
              if (result.done || !result.value) {
                continue;
              }
              const [_, resultIndexKey] = result.value;
              if (minIndexKeyAndIndex === undefined) {
                minIndexKeyAndIndex = [resultIndexKey, i];
                continue;
              }
              const [prevMin] = minIndexKeyAndIndex;
              if (
                compareKeys(
                  { value: resultIndexKey, kind: "exact" },
                  { value: prevMin, kind: "exact" },
                ) *
                  comparisonInversion <
                0
              ) {
                minIndexKeyAndIndex = [resultIndexKey, i];
              }
            }
            if (minIndexKeyAndIndex === undefined) {
              return { done: true, value: undefined };
            }
            const [_, minIndex] = minIndexKeyAndIndex;
            const [doc, indexKey] = results[minIndex]!.value!;
            // indicate that we've used this result
            results[minIndex] = undefined;
            return {
              done: false,
              value: [doc, indexKey, bandwidthThisIteration],
            };
          },
        };
      },
    };
  }
  getOrder(): "asc" | "desc" {
    return this.#order;
  }
  getEqualityIndexFilter(): Value[] {
    return this.#equalityIndexFilter;
  }
  getIndexFields(): string[] {
    return this.#indexFields;
  }
  narrow(indexBounds: IndexBounds) {
    return new MergedStream(
      this.#streams.map((stream) => stream.narrow(indexBounds)),
      this.#indexFields,
    );
  }
}

function allSame<T extends Value>(values: T[], errorMessage: string): T {
  const first = values[0]!;
  for (const value of values) {
    if (compareValues(value, first)) {
      throw new Error(errorMessage);
    }
  }
  return first;
}

function commonPrefix(values: Value[][]) {
  let commonPrefix = values[0]!;
  for (const value of values) {
    for (let i = 0; i < commonPrefix.length; i++) {
      if (i >= value.length || compareValues(commonPrefix[i], value[i])) {
        commonPrefix = commonPrefix.slice(0, i);
        break;
      }
    }
  }
  return commonPrefix;
}

/**
 * Concatenate multiple streams into a single stream.
 * This assumes that the streams correspond to disjoint index ranges,
 * and are provided in the same order as the index ranges.
 *
 * e.g. ```ts
 * new ConcatStreams(
 *   stream(db, schema).query("messages").withIndex("by_author", q => q.eq("author", "user1")),
 *   stream(db, schema).query("messages").withIndex("by_author", q => q.eq("author", "user2")),
 * )
 * ```
 *
 * is valid, but if the stream arguments were reversed, or the queries were
 * `.order("desc")`, it would be invalid.
 *
 * It's not recommended to use `ConcatStreams` directly, since it has the same
 * behavior as `MergedStream`, but with fewer runtime checks.
 */
class ConcatStreams<T extends GenericStreamItem> extends QueryStream<T> {
  #order: "asc" | "desc";
  #streams: QueryStream<T>[];
  #equalityIndexFilter: Value[];
  #indexFields: string[];
  constructor(...streams: QueryStream<T>[]) {
    super();
    this.#streams = streams;
    if (streams.length === 0) {
      throw new Error("Cannot concat empty array of streams");
    }
    this.#order = allSame(
      streams.map((stream) => stream.getOrder()),
      "Cannot concat streams with different orders. Consider using .orderBy()",
    );
    this.#indexFields = allSame(
      streams.map((stream) => stream.getIndexFields()),
      "Cannot concat streams with different index fields. Consider using .orderBy()",
    );
    this.#equalityIndexFilter = commonPrefix(
      streams.map((stream) => stream.getEqualityIndexFilter()),
    );
  }
  iterWithKeys(trackBandwidth = false): StreamIterable<T> {
    const iterables = this.#streams.map((stream) =>
      stream.iterWithKeys(trackBandwidth),
    );
    const comparisonInversion = this.#order === "asc" ? 1 : -1;
    let previousIndexKey: IndexKey | undefined = undefined;
    return {
      [Symbol.asyncIterator]() {
        const iterators = iterables.map((iterable) =>
          iterable[Symbol.asyncIterator](),
        );
        return {
          async next() {
            while (iterators.length > 0) {
              const result = await iterators[0]!.next();
              if (result.done) {
                iterators.shift();
              } else {
                const [_, indexKey] = result.value;
                if (
                  previousIndexKey !== undefined &&
                  compareKeys(
                    {
                      value: previousIndexKey,
                      kind: "exact",
                    },
                    {
                      value: indexKey,
                      kind: "exact",
                    },
                  ) *
                    comparisonInversion >
                    0
                ) {
                  throw new Error(
                    `ConcatStreams in wrong order: ${JSON.stringify(previousIndexKey)}, ${JSON.stringify(indexKey)}`,
                  );
                }
                previousIndexKey = indexKey;
                return result;
              }
            }
            return { done: true, value: undefined };
          },
        };
      },
    };
  }
  getOrder(): "asc" | "desc" {
    return this.#order;
  }
  getEqualityIndexFilter(): Value[] {
    return this.#equalityIndexFilter;
  }
  getIndexFields(): string[] {
    return this.#indexFields;
  }
  narrow(indexBounds: IndexBounds) {
    return new ConcatStreams(
      ...this.#streams.map((stream) => stream.narrow(indexBounds)),
    );
  }
}

class FlatMapStreamIterator<
  T extends GenericStreamItem,
  U extends GenericStreamItem,
> implements AsyncIterator<[U | null, IndexKey, number], undefined> {
  #outerStream: QueryStream<T>;
  #outerIterator: AsyncIterator<[T | null, IndexKey, number], undefined>;
  #currentOuterItem: {
    t: T | null;
    indexKey: IndexKey;
    innerIterator: AsyncIterator<[U | null, IndexKey, number], undefined>;
    count: number;
    bandwidth: number; // bandwidth from reading outer doc
  } | null = null;
  #mapper: (doc: T, indexKey: IndexKey) => Promise<QueryStream<U>>;
  #mappedIndexFields: string[];
  #trackBandwidth: boolean;
  #skipEmptyAt: IndexKey | undefined;
  #pendingBandwidth = 0;

  constructor(
    outerStream: QueryStream<T>,
    mapper: (doc: T, indexKey: IndexKey) => Promise<QueryStream<U>>,
    mappedIndexFields: string[],
    trackBandwidth: boolean,
    skipEmptyAt?: IndexKey,
  ) {
    this.#outerIterator = outerStream
      .iterWithKeys(trackBandwidth)
      [Symbol.asyncIterator]();
    this.#outerStream = outerStream;
    this.#mapper = mapper;
    this.#mappedIndexFields = mappedIndexFields;
    this.#trackBandwidth = trackBandwidth;
    this.#skipEmptyAt = skipEmptyAt;
  }
  skipEmptyAt(indexKey: IndexKey): boolean {
    return (
      this.#skipEmptyAt !== undefined &&
      compareKeys(
        { value: indexKey, kind: "exact" },
        { value: this.#skipEmptyAt, kind: "exact" },
      ) === 0
    );
  }
  singletonSkipInnerStream(): QueryStream<U> {
    // If the outer stream is a filtered value, yield a singleton
    // filtered value from the inner stream, with index key of nulls.
    const indexKey = this.#mappedIndexFields.map(() => null);
    return new SingletonStream<U>(
      null,
      this.#outerStream.getOrder(),
      this.#mappedIndexFields,
      indexKey,
      indexKey,
    );
  }
  async setCurrentOuterItem(item: [T | null, IndexKey, number]) {
    const [t, indexKey, bandwidth] = item;
    let innerStream: QueryStream<U>;
    if (t === null) {
      innerStream = this.skipEmptyAt(indexKey)
        ? new EmptyStream(this.#outerStream.getOrder(), this.#mappedIndexFields)
        : this.singletonSkipInnerStream();
    } else {
      innerStream = await this.#mapper(t, indexKey);
      if (
        !equalIndexFields(innerStream.getIndexFields(), this.#mappedIndexFields)
      ) {
        throw new Error(
          `FlatMapStream: inner stream has different index fields than expected: ${JSON.stringify(innerStream.getIndexFields())} vs ${JSON.stringify(this.#mappedIndexFields)}`,
        );
      }
      if (innerStream.getOrder() !== this.#outerStream.getOrder()) {
        throw new Error(
          `FlatMapStream: inner stream has different order than outer stream: ${innerStream.getOrder()} vs ${this.#outerStream.getOrder()}`,
        );
      }
    }
    this.#currentOuterItem = {
      t,
      indexKey,
      innerIterator: innerStream
        .iterWithKeys(this.#trackBandwidth)
        [Symbol.asyncIterator](),
      count: 0,
      bandwidth,
    };
  }
  async next(): Promise<StreamResult<U>> {
    if (this.#currentOuterItem === null) {
      const result = await this.#outerIterator.next();
      if (result.done) {
        return { done: true, value: undefined };
      }
      await this.setCurrentOuterItem(result.value);
      return await this.next();
    }
    const result = await this.#currentOuterItem.innerIterator.next();
    if (result.done) {
      if (this.#currentOuterItem.count > 0) {
        this.#currentOuterItem = null;
      } else if (this.skipEmptyAt(this.#currentOuterItem.indexKey)) {
        // Resuming already included this outer item. Emitting its placeholder
        // again can repeat the cursor (or move it backwards). Carry the cost of
        // rereading it to the next result and advance to the next outer item.
        this.#pendingBandwidth += this.#currentOuterItem.bandwidth;
        this.#currentOuterItem = null;
      } else {
        // The inner stream was completely empty, so we should inject a null
        // (which will be skipped by everything except the maximumRowsRead count)
        // to account for the cost of the outer stream.
        this.#currentOuterItem.innerIterator = this.singletonSkipInnerStream()
          .iterWithKeys(this.#trackBandwidth)
          [Symbol.asyncIterator]();
      }
      return await this.next();
    }
    const [u, indexKey, innerBandwidth] = result.value;
    this.#currentOuterItem.count++;
    const fullIndexKey = [...this.#currentOuterItem.indexKey, ...indexKey];
    // On first yield for this outer item, include outer bandwidth
    const bandwidth =
      (this.#currentOuterItem.count === 1
        ? this.#currentOuterItem.bandwidth
        : 0) +
      innerBandwidth +
      this.#pendingBandwidth;
    this.#pendingBandwidth = 0;
    return { done: false, value: [u, fullIndexKey, bandwidth] };
  }
}

class FlatMapStream<
  T extends GenericStreamItem,
  U extends GenericStreamItem,
> extends QueryStream<U> {
  #stream: QueryStream<T>;
  #mapper: (doc: T, indexKey: IndexKey) => Promise<QueryStream<U>>;
  #mappedIndexFields: string[];
  #skipEmptyAt: IndexKey | undefined;
  constructor(
    stream: QueryStream<T>,
    mapper: (doc: T, indexKey: IndexKey) => Promise<QueryStream<U>>,
    mappedIndexFields: string[],
    skipEmptyAt?: IndexKey,
  ) {
    super();
    this.#stream = stream;
    this.#mapper = mapper;
    this.#mappedIndexFields = mappedIndexFields;
    this.#skipEmptyAt = skipEmptyAt;
  }
  iterWithKeys(trackBandwidth = false): StreamIterable<U> {
    const outerStream = this.#stream;
    const mapper = this.#mapper;
    const mappedIndexFields = this.#mappedIndexFields;
    const skipEmptyAt = this.#skipEmptyAt;
    return {
      [Symbol.asyncIterator]() {
        return new FlatMapStreamIterator(
          outerStream,
          mapper,
          mappedIndexFields,
          trackBandwidth,
          skipEmptyAt,
        );
      },
    };
  }
  getOrder(): "asc" | "desc" {
    return this.#stream.getOrder();
  }
  getEqualityIndexFilter(): Value[] {
    return this.#stream.getEqualityIndexFilter();
  }
  getIndexFields(): string[] {
    return [...this.#stream.getIndexFields(), ...this.#mappedIndexFields];
  }
  override getPaginationKey(indexKey: IndexKey): IndexKey {
    // map/filter retain the outer pagination boundary. A real flatMap needs
    // its full inner position to avoid skipping remaining inner results.
    return this.#mappedIndexFields.length === 0
      ? this.#stream.getPaginationKey(indexKey)
      : indexKey;
  }
  narrow(indexBounds: IndexBounds) {
    const outerLength = this.#stream.getIndexFields().length;
    const outerLowerBound = indexBounds.lowerBound.slice(0, outerLength);
    const outerUpperBound = indexBounds.upperBound.slice(0, outerLength);
    const innerLowerBound = indexBounds.lowerBound.slice(outerLength);
    const innerUpperBound = indexBounds.upperBound.slice(outerLength);
    // An exclusive start inside an outer item must still visit its remaining
    // inner rows, but must not emit another placeholder if none remain. Retain
    // the furthest such start when narrowing an already narrowed stream.
    const startBound =
      this.getOrder() === "asc"
        ? {
            outer: outerLowerBound,
            inner: innerLowerBound,
            inclusive: indexBounds.lowerBoundInclusive,
          }
        : {
            outer: outerUpperBound,
            inner: innerUpperBound,
            inclusive: indexBounds.upperBoundInclusive,
          };
    let skipEmptyAt = this.#skipEmptyAt;
    if (
      startBound.inner.length > 0 &&
      !startBound.inclusive &&
      (skipEmptyAt === undefined ||
        compareKeys(
          { value: startBound.outer, kind: "exact" },
          { value: skipEmptyAt, kind: "exact" },
        ) *
          (this.getOrder() === "asc" ? 1 : -1) >
          0)
    ) {
      skipEmptyAt = startBound.outer;
    }
    const outerIndexBounds = {
      lowerBound: outerLowerBound,
      lowerBoundInclusive:
        innerLowerBound.length === 0 ? indexBounds.lowerBoundInclusive : true,
      upperBound: outerUpperBound,
      upperBoundInclusive:
        innerUpperBound.length === 0 ? indexBounds.upperBoundInclusive : true,
    };
    return new FlatMapStream(
      this.#stream.narrow(outerIndexBounds),
      async (t, indexKey) => {
        const innerStream = await this.#mapper(t, indexKey);
        // An inner bound only constrains the outer item at that edge of the
        // range. Other outer items retain their entire inner streams. Use the
        // iterator's key, since map() can change or remove indexed fields.
        const atLowerBound =
          innerLowerBound.length > 0 &&
          compareKeys(
            { value: indexKey, kind: "exact" },
            { value: outerLowerBound, kind: "exact" },
          ) === 0;
        const atUpperBound =
          innerUpperBound.length > 0 &&
          compareKeys(
            { value: indexKey, kind: "exact" },
            { value: outerUpperBound, kind: "exact" },
          ) === 0;
        if (!atLowerBound && !atUpperBound) {
          return innerStream;
        }
        return innerStream.narrow({
          lowerBound: atLowerBound ? innerLowerBound : [],
          lowerBoundInclusive: atLowerBound
            ? indexBounds.lowerBoundInclusive
            : true,
          upperBound: atUpperBound ? innerUpperBound : [],
          upperBoundInclusive: atUpperBound
            ? indexBounds.upperBoundInclusive
            : true,
        });
      },
      this.#mappedIndexFields,
      skipEmptyAt,
    );
  }
}

export class SingletonStream<
  T extends GenericStreamItem,
> extends QueryStream<T> {
  #value: T | null;
  #order: "asc" | "desc";
  #indexFields: string[];
  #indexKey: IndexKey;
  #equalityIndexFilter: Value[];
  #bandwidth: number;
  constructor(
    value: T | null,
    order: "asc" | "desc" = "asc",
    indexFields: string[],
    indexKey: IndexKey,
    equalityIndexFilter: Value[],
    bandwidth = 0,
  ) {
    super();
    this.#value = value;
    this.#order = order;
    this.#indexFields = indexFields;
    this.#indexKey = indexKey;
    this.#equalityIndexFilter = equalityIndexFilter;
    this.#bandwidth = bandwidth;
    if (indexKey.length !== indexFields.length) {
      throw new Error(
        `indexKey must have the same length as indexFields: ${JSON.stringify(
          indexKey,
        )} vs ${JSON.stringify(indexFields)}`,
      );
    }
  }
  iterWithKeys(_trackBandwidth = false): StreamIterable<T> {
    const value = this.#value;
    const indexKey = this.#indexKey;
    const bandwidth = this.#bandwidth;
    return {
      [Symbol.asyncIterator]() {
        let sent = false;
        return {
          async next() {
            if (sent) {
              return { done: true, value: undefined };
            }
            sent = true;
            return {
              done: false,
              value: [value, indexKey, bandwidth],
            };
          },
        };
      },
    };
  }
  getOrder(): "asc" | "desc" {
    return this.#order;
  }
  getIndexFields(): string[] {
    return this.#indexFields;
  }
  getEqualityIndexFilter(): Value[] {
    return this.#equalityIndexFilter;
  }
  narrow(indexBounds: IndexBounds): QueryStream<T> {
    const compareLowerBound = compareKeys(
      {
        value: indexBounds.lowerBound,
        kind: indexBounds.lowerBoundInclusive ? "exact" : "successor",
      },
      {
        value: this.#indexKey,
        kind: "exact",
      },
    );
    const compareUpperBound = compareKeys(
      {
        value: this.#indexKey,
        kind: "exact",
      },
      {
        value: indexBounds.upperBound,
        kind: indexBounds.upperBoundInclusive ? "exact" : "predecessor",
      },
    );
    // If lowerBound <= this.indexKey <= upperBound, return this.value
    if (compareLowerBound <= 0 && compareUpperBound <= 0) {
      return new SingletonStream(
        this.#value,
        this.#order,
        this.#indexFields,
        this.#indexKey,
        this.#equalityIndexFilter,
      );
    }
    return new EmptyStream(this.#order, this.#indexFields);
  }
}

/**
 * This is a completely empty stream that yields no values, and in particular
 * does not count towards maximumRowsRead.
 * Compare to SingletonStream(null, ...), which yields no values but does count
 * towards maximumRowsRead.
 */
export class EmptyStream<T extends GenericStreamItem> extends QueryStream<T> {
  #order: "asc" | "desc";
  #indexFields: string[];
  #equalityIndexFilter: Value[];
  constructor(
    order: "asc" | "desc",
    indexFields: string[],
    equalityIndexFilter: Value[] = [],
  ) {
    super();
    this.#order = order;
    this.#indexFields = indexFields;
    this.#equalityIndexFilter = equalityIndexFilter;
  }
  iterWithKeys(_trackBandwidth = false): StreamIterable<T> {
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: true, value: undefined };
          },
        };
      },
    };
  }
  getOrder(): "asc" | "desc" {
    return this.#order;
  }
  getIndexFields(): string[] {
    return this.#indexFields;
  }
  getEqualityIndexFilter(): Value[] {
    return this.#equalityIndexFilter;
  }
  narrow(_indexBounds: IndexBounds) {
    return this;
  }
}

function normalizeIndexFields(indexFields: string[]) {
  // Append _creationTime and _id to the index fields if they're not already there
  if (!indexFields.includes("_creationTime")) {
    // With one exception: if indexFields is ["_id"], we don't need to add _creationTime
    if (indexFields.length !== 1 || indexFields[0] !== "_id") {
      indexFields.push("_creationTime");
    }
  }
  if (!indexFields.includes("_id")) {
    indexFields.push("_id");
  }
}

// Given a stream ordered by `indexFields`, where the first `equalityIndexLength`
// fields are bounded by equality filters, return a generator of the possible
// index fields used for ordering.
function* getOrderingIndexFields<T extends GenericStreamItem>(
  stream: QueryStream<T>,
): Generator<string[]> {
  const streamEqualityIndexLength = stream.getEqualityIndexFilter().length;
  const streamIndexFields = stream.getIndexFields();
  for (let i = 0; i <= streamEqualityIndexLength; i++) {
    yield streamIndexFields.slice(i);
  }
}

class OrderByStream<T extends GenericStreamItem> extends QueryStream<T> {
  #staticFilter: Value[];
  #stream: QueryStream<T>;
  #indexFields: string[];
  constructor(stream: QueryStream<T>, indexFields: string[]) {
    super();
    this.#stream = stream;
    this.#indexFields = indexFields;
    normalizeIndexFields(this.#indexFields);
    // indexFields must be a suffix of the stream's index fields, and include
    // all of the non-equality index fields.
    const streamIndexFields = stream.getIndexFields();
    const orderingIndexFields = Array.from(getOrderingIndexFields(stream));
    if (
      !orderingIndexFields.some((orderingIndexFields) =>
        equalIndexFields(orderingIndexFields, indexFields),
      )
    ) {
      throw new Error(
        `indexFields must be some sequence of fields the stream is ordered by: ${JSON.stringify(
          indexFields,
        )}, ${JSON.stringify(
          streamIndexFields,
        )} (${stream.getEqualityIndexFilter().length} equality fields)`,
      );
    }
    this.#staticFilter = stream
      .getEqualityIndexFilter()
      .slice(0, streamIndexFields.length - indexFields.length);
  }
  getOrder(): "asc" | "desc" {
    return this.#stream.getOrder();
  }
  getEqualityIndexFilter(): Value[] {
    return this.#stream
      .getEqualityIndexFilter()
      .slice(this.#staticFilter.length);
  }
  getIndexFields(): string[] {
    return this.#indexFields;
  }
  iterWithKeys(trackBandwidth = false): StreamIterable<T> {
    const iterable = this.#stream.iterWithKeys(trackBandwidth);
    const staticFilter = this.#staticFilter;
    return {
      [Symbol.asyncIterator]() {
        const iterator = iterable[Symbol.asyncIterator]();
        return {
          async next() {
            const result = await iterator.next();
            if (result.done) {
              return result;
            }
            const [doc, indexKey, bandwidth] = result.value;
            return {
              done: false,
              value: [doc, indexKey.slice(staticFilter.length), bandwidth],
            };
          },
        };
      },
    };
  }
  narrow(indexBounds: IndexBounds) {
    return new OrderByStream(
      this.#stream.narrow({
        lowerBound: [...this.#staticFilter, ...indexBounds.lowerBound],
        lowerBoundInclusive: indexBounds.lowerBoundInclusive,
        upperBound: [...this.#staticFilter, ...indexBounds.upperBound],
        upperBoundInclusive: indexBounds.upperBoundInclusive,
      }),
      this.#indexFields,
    );
  }
}

class DistinctStream<T extends GenericStreamItem> extends QueryStream<T> {
  #distinctIndexFieldsLength: number;
  #stream: QueryStream<T>;
  #distinctIndexFields: string[];

  constructor(stream: QueryStream<T>, distinctIndexFields: string[]) {
    super();
    this.#stream = stream;
    this.#distinctIndexFields = distinctIndexFields;
    // distinctIndexFields must be a prefix of the stream's ordering index fields
    let distinctIndexFieldsLength: number | undefined = undefined;
    for (const orderingIndexFields of getOrderingIndexFields(stream)) {
      const prefix = orderingIndexFields.slice(0, distinctIndexFields.length);
      if (equalIndexFields(prefix, distinctIndexFields)) {
        const equalityLength =
          stream.getIndexFields().length - orderingIndexFields.length;
        distinctIndexFieldsLength = equalityLength + distinctIndexFields.length;
        break;
      }
    }
    if (distinctIndexFieldsLength === undefined) {
      throw new Error(
        `distinctIndexFields must be a prefix of the stream's ordering index fields: ${JSON.stringify(
          distinctIndexFields,
        )}, ${JSON.stringify(stream.getIndexFields())} (${stream.getEqualityIndexFilter().length} equality fields)`,
      );
    }
    this.#distinctIndexFieldsLength = distinctIndexFieldsLength;
  }
  override iterWithKeys(trackBandwidth = false): StreamIterable<T> {
    const stream = this.#stream;
    const distinctIndexFieldsLength = this.#distinctIndexFieldsLength;
    return {
      [Symbol.asyncIterator]() {
        let currentStream = stream;
        let currentIterator = currentStream
          .iterWithKeys(trackBandwidth)
          [Symbol.asyncIterator]();
        return {
          async next() {
            const result = await currentIterator.next();
            if (result.done) {
              return { done: true, value: undefined };
            }
            const [doc, indexKey, bandwidth] = result.value;
            if (doc === null) {
              // If the original stream has a post-filter `.filterWith`, we will
              // iterate over filtered items -- possibly many with the same set of
              // distinct index fields -- before finding the first item for the set
              // of distinct index fields.
              // So it's recommended to put `.filterWith` after `.distinct`.
              return {
                done: false,
                value: [null, indexKey, bandwidth],
              };
            }
            const distinctIndexKey = indexKey.slice(
              0,
              distinctIndexFieldsLength,
            );
            if (stream.getOrder() === "asc") {
              currentStream = currentStream.narrow({
                lowerBound: distinctIndexKey,
                lowerBoundInclusive: false,
                upperBound: [],
                upperBoundInclusive: true,
              });
            } else {
              currentStream = currentStream.narrow({
                lowerBound: [],
                lowerBoundInclusive: true,
                upperBound: distinctIndexKey,
                upperBoundInclusive: false,
              });
            }
            currentIterator = currentStream
              .iterWithKeys(trackBandwidth)
              [Symbol.asyncIterator]();
            return result;
          },
        };
      },
    };
  }
  override getPaginationKey(indexKey: IndexKey): IndexKey {
    return indexKey.slice(0, this.#distinctIndexFieldsLength);
  }
  override narrow(indexBounds: IndexBounds): QueryStream<T> {
    const indexBoundsPrefix: IndexBounds = {
      ...indexBounds,
      lowerBound: indexBounds.lowerBound.slice(
        0,
        this.#distinctIndexFieldsLength,
      ),
      upperBound: indexBounds.upperBound.slice(
        0,
        this.#distinctIndexFieldsLength,
      ),
    };
    return new DistinctStream(
      this.#stream.narrow(indexBoundsPrefix),
      this.#distinctIndexFields,
    );
  }
  override getOrder(): "asc" | "desc" {
    return this.#stream.getOrder();
  }
  override getIndexFields(): string[] {
    return this.#stream.getIndexFields();
  }
  override getEqualityIndexFilter(): Value[] {
    return this.#stream.getEqualityIndexFilter();
  }
}

function equalIndexFields(
  indexFields1: string[],
  indexFields2: string[],
): boolean {
  if (indexFields1.length !== indexFields2.length) {
    return false;
  }
  for (let i = 0; i < indexFields1.length; i++) {
    if (indexFields1[i] !== indexFields2[i]) {
      return false;
    }
  }
  return true;
}

type Key = {
  value: IndexKey;
  kind: "successor" | "predecessor" | "exact";
};

function getValueAtIndex(
  v: Value[],
  index: number,
): { kind: "found"; value: Value } | undefined {
  if (index >= v.length) {
    return undefined;
  }
  return { kind: "found", value: v[index]! };
}

function compareDanglingSuffix(
  shorterKeyKind: "exact" | "successor" | "predecessor",
  longerKeyKind: "exact" | "successor" | "predecessor",
  shorterKey: Key,
  longerKey: Key,
): number {
  if (shorterKeyKind === "exact" && longerKeyKind === "exact") {
    throw new Error(
      `Exact keys are not the same length:  ${JSON.stringify(
        shorterKey.value,
      )}, ${JSON.stringify(longerKey.value)}`,
    );
  }
  if (shorterKeyKind === "exact") {
    throw new Error(
      `Exact key is shorter than prefix: ${JSON.stringify(
        shorterKey.value,
      )}, ${JSON.stringify(longerKey.value)}`,
    );
  }
  if (shorterKeyKind === "predecessor" && longerKeyKind === "successor") {
    // successor is longer than predecessor, so it is bigger
    return -1;
  }
  if (shorterKeyKind === "successor" && longerKeyKind === "predecessor") {
    // successor is shorter than predecessor, so it is larger
    return 1;
  }
  if (shorterKeyKind === "predecessor" && longerKeyKind === "predecessor") {
    // predecessor of [2, 3] contains [2, 1] while predecessor of [2] doesn't, so longer predecessors are larger
    return -1;
  }
  if (shorterKeyKind === "successor" && longerKeyKind === "successor") {
    // successor of [2, 3] contains [2, 4] while successor of [2] doesn't, so longer successors are smaller
    return 1;
  }
  if (shorterKeyKind === "predecessor" && longerKeyKind === "exact") {
    return -1;
  }
  if (shorterKeyKind === "successor" && longerKeyKind === "exact") {
    return 1;
  }
  throw new Error(`Unexpected key kinds: ${shorterKeyKind}, ${longerKeyKind}`);
}

function compareKeys(key1: Key, key2: Key): number {
  let i = 0;
  while (i < Math.max(key1.value.length, key2.value.length)) {
    const v1 = getValueAtIndex(key1.value as any, i);
    const v2 = getValueAtIndex(key2.value as any, i);
    if (v1 === undefined) {
      return compareDanglingSuffix(key1.kind, key2.kind, key1, key2);
    }
    if (v2 === undefined) {
      return -1 * compareDanglingSuffix(key2.kind, key1.kind, key2, key1);
    }
    const result = compareValues(v1.value, v2.value);
    if (result !== 0) {
      return result;
    }
    // if the prefixes are the same so far, keep going with the comparison
    i++;
  }

  if (key1.kind === key2.kind) {
    return 0;
  }

  // keys are the same length and values
  if (key1.kind === "exact") {
    if (key2.kind === "successor") {
      return -1;
    } else {
      return 1;
    }
  }
  if (key1.kind === "predecessor") {
    return -1;
  }
  if (key1.kind === "successor") {
    return 1;
  }
  // Note: we're being cautious here, but we aren't checking above that the type
  // of key2.kind is valid...
  throw new Error(`Unexpected key kind: ${key1.kind as any}`);
}

function serializeCursor(key: IndexKey): string {
  return JSON.stringify(
    convexToJson(
      key.map((v): Value =>
        v === undefined
          ? "undefined"
          : typeof v === "string" && v.endsWith("undefined")
            ? // in the unlikely case their string was "undefined"
              // or "_undefined" etc, we escape it.
              "_" + v
            : v,
      ),
    ),
  );
}

function deserializeCursor(cursor: string): IndexKey {
  return (jsonToConvex(JSON.parse(cursor)) as Value[]).map((v) => {
    if (typeof v === "string") {
      if (v === "undefined") {
        // This is a special case for the undefined value.
        // It's not a valid value in the index, but it's a valid value in the
        // cursor.
        return undefined;
      }
      if (v.endsWith("undefined")) {
        // in the unlikely case their string was "undefined" it was changed to
        // "_undefined" in the serialization process.
        // NB: if their string was "_undefined" it was changed to
        // "__undefined" in the serialization process, and so on.
        return v.slice(1);
      }
    }
    return v;
  });
}
