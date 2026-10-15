import { getFunctionName } from "convex/server";

// A Mock convex client
export class ConvexReactClientFake {
  constructor() {
    this.queries = {};
    this.mutations = {};
    this.actions = {};
  }

  registerQueryFake(funcRef, impl) {
    this.queries[getFunctionName(funcRef)] = impl;
  }
  registerMutationFake(funcRef, impl) {
    this.mutations[getFunctionName(funcRef)] = impl;
  }

  async setAuth() {
    throw new Error("Auth is not implemented");
  }

  clearAuth() {
    throw new Error("Auth is not implemented");
  }

  watchQuery(functionReference, args) {
    const name = getFunctionName(functionReference);
    return {
      localQueryResult: () => {
        const query = this.queries && this.queries[name];
        if (query) {
          return query(args);
        }
        throw new Error(
          `Unexpected query: ${name}. Try providing a function for this query in the mock client constructor.`,
        );
      },
      onUpdate: () => () => ({
        unsubscribe: () => null,
      }),
      journal: () => {
        throw new Error("Pagination is not implemented");
      },
    };
  }

  mutation(functionReference, args) {
    const name = getFunctionName(functionReference);
    const mutation = this.mutations && this.mutations[name];
    if (mutation) {
      return mutation(args);
    }
    throw new Error(
      `Unexpected mutation: ${name}. Try providing a function for this mutation in the mock client constructor.`,
    );
  }

  action(functionReference, args) {
    const name = getFunctionName(functionReference);
    const action = this.actions && this.actions[name];
    if (action) {
      return action(args);
    }
    throw new Error(
      `Unexpected action: ${name}. Try providing a function for this actionin the mock client constructor.`,
    );
  }

  connectionState() {
    return {
      hasInflightRequests: false,
      isWebSocketConnected: true,
    };
  }

  close() {
    return Promise.resolve();
  }
}
