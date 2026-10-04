/**
 * A scriptable stand-in for the Supabase query builder, for unit tests of code that talks to the database
 * through chained calls (`db.from("leads").select(...).eq(...).maybeSingle()`).
 *
 * Every builder method records its arguments and returns the same chain; awaiting the chain (or calling
 * `single()` / `maybeSingle()`) asks the test's handler for the result. Not a query engine: it does not
 * filter anything. The handler decides what each call returns, and the recorded operations let the test
 * assert exactly which rows were touched and with what filters.
 */

export interface FakeOperation {
  table: string;
  action: "select" | "insert" | "update" | "delete" | "rpc";
  payload: unknown;
  filters: Array<[string, unknown]>;
}

export type FakeResult = { data: unknown; error: { message: string; code?: string } | null };
export type FakeHandler = (operation: FakeOperation) => FakeResult | undefined;

export function fakeSupabase(handler: FakeHandler) {
  const operations: FakeOperation[] = [];

  function chain(table: string) {
    const operation: FakeOperation = { table, action: "select", payload: undefined, filters: [] };
    let recorded = false;
    const resolve = (): FakeResult => {
      if (!recorded) {
        operations.push(operation);
        recorded = true;
      }
      return handler(operation) ?? { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    const filterMethods = ["eq", "neq", "in", "like", "not", "lte", "gte", "lt", "gt", "contains", "is"];
    for (const method of filterMethods) {
      builder[method] = (column: string, value: unknown) => {
        operation.filters.push([`${method}:${column}`, value]);
        return builder;
      };
    }
    for (const method of ["order", "limit", "range"]) builder[method] = () => builder;
    builder.select = () => builder; // `.insert(...).select()` — keeps the insert action
    builder.insert = (payload: unknown) => {
      operation.action = "insert";
      operation.payload = payload;
      return builder;
    };
    builder.update = (payload: unknown) => {
      operation.action = "update";
      operation.payload = payload;
      return builder;
    };
    builder.delete = () => {
      operation.action = "delete";
      return builder;
    };
    builder.single = async () => resolve();
    builder.maybeSingle = async () => resolve();
    builder.then = (onFulfilled: (value: FakeResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected);
    return builder;
  }

  const db = {
    from: (table: string) => chain(table),
    rpc: async (name: string, params: unknown) => {
      const operation: FakeOperation = { table: name, action: "rpc", payload: params, filters: [] };
      operations.push(operation);
      return handler(operation) ?? { data: null, error: null };
    },
  };

  return { db: db as never, operations };
}

/** Convenience: the operations of one kind on one table. */
export function opsOn(operations: FakeOperation[], table: string, action?: FakeOperation["action"]) {
  return operations.filter((operation) => operation.table === table && (!action || operation.action === action));
}
