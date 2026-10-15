import { ConvexReactClient } from "convex/react";
import {
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";

export class ConvexReactClientFake extends ConvexReactClient {
  constructor();

  registerQueryFake<FuncRef extends FunctionReference<"query", "public">>(
    funcRef: FuncRef,
    impl: (args: FunctionArgs<FuncRef>) => FunctionReturnType<FuncRef>,
  ): void;
  registerMutationFake<FuncRef extends FunctionReference<"mutation", "public">>(
    funcRef: FuncRef,
    impl: (args: FunctionArgs<FuncRef>) => FunctionReturnType<FuncRef>,
  ): void;
}
