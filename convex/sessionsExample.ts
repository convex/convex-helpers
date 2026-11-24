/**
 * Allows you to persist state server-side, associated with a sessionId stored
 * on the client (in localStorage, e.g.).
 *
 * See the associated [Stack post](https://stack.convex.dev/track-sessions-without-cookies)
 * for more information.
 */
import { action, mutation, query } from "./_generated/server";
import {
  customAction,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import {
  SessionIdArg,
  runSessionFunctions,
  vSessionId,
} from "convex-helpers/server/sessions";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

/** -----------------------------------------------------------------
 * Function wrappers
 * ----------------------------------------------------------------- */

/**
 * Wrapper for a Convex query function that takes a session.
 *
 * Requires an `sessionId: {@link SessionId}` parameter. This is provided by
 * default by using {@link useSessionQuery}. It validates and strips this
 * parameter for you.
 * E.g.:
 * ```ts
 * export default queryWithSession({
 *   args: { arg1: v.any() },
 *   handler: async ({ db, auth, sessionId }, { arg1 }) => {
 *     // ...use the session here as usual
 *   }
 * });
 * ```
 * @param func - Your function that now has a "sessionId" in the ctx param.
 * @returns A Convex serverless function that requires a "sessionid" argument.
 */
export const queryWithSession = customQuery(query, {
  args: SessionIdArg,
  input: async (ctx, { sessionId }) => {
    return { ctx: { sessionId }, args: {} };
  },
});

/**
 * Wrapper for a Convex mutation function that takes a sessionId.
 *
 * Requires an `sessionId: {@link SessionId}` parameter. This is provided by
 * default by using {@link useSessionMutation}. It validates and strips this
 * parameter for you.
 * E.g.:
 * ```ts
 * export default mutationWithSession({
 *   args: { arg1: v.any() },
 *   handler: async ({ db, auth, sessionId }, { arg1 }) => {...}
 * });
 * ```
 * @param func - Your function that takes in a `sessionId` in the ctx param.
 * @returns A Convex serverless function that takes sessionId as an argument.
 */
export const mutationWithSession = customMutation(mutation, {
  args: SessionIdArg,
  input: async (ctx, { sessionId }) => {
    return { ctx: { sessionId }, args: {} };
  },
});

/**
 * Wrapper for a Convex action function that takes a sessionId.
 *
 * Requires an `sessionId: {@link SessionId}` parameter. This is provided by
 * default by using {@link useSessionAction}. It validates and strips this
 * parameter for you.
 * E.g.:
 * ```ts
 * export default actionWithSession({
 *   args: { arg1: v.any() },
 *   handler: async ({ db, auth, sessionId }, { arg1 }) => {...}
 * });
 * ```

 * It also provides runSessionQuery, runSessionMutation, and runSessionAction
 * functions in the ctx param. These functions are wrappers around the
 * corresponding functions without "Session" but inject the sessionId argument.
 *
 * @param func - Your function that takes in a `sessionId` in the ctx param.
 * @returns A Convex serverless function that takes sessionId as an argument.
 */
export const actionWithSession = customAction(action, {
  args: SessionIdArg,
  input: async (ctx, { sessionId }) => {
    const { runSessionQuery, runSessionMutation, runSessionAction } =
      runSessionFunctions(ctx, sessionId);
    return {
      ctx: {
        runSessionQuery,
        runSessionMutation,
        runSessionAction,
        sessionId,
      },
      args: {},
    };
  },
});

/**
 * EXAMPLES
 */

/**
 * This is an example of where you could capture / invalidate a session ID.
 * You could transfer associated data from the old session to the new session.
 * You should refresh a session ID when the user logs in & out.
 * On logout you likely don't want to carry any data over, whereas for logging
 * in, you might want to transfer ownership of data from an anonymous session.
 */
export const logIn = mutationWithSession({
  args: { new: vSessionId },
  handler: async (ctx, args) => {
    console.log("copying presence data on login", ctx.sessionId);
    console.log("new session ID", args.new);
    const presenceDocs = await ctx.db
      .query("presence")
      .withIndex("user_room", (q) => q.eq("user", ctx.sessionId))
      .collect();
    await Promise.all(
      presenceDocs.map((doc) =>
        ctx.db.patch("presence", doc._id, { user: args.new }),
      ),
    );
  },
});

export const logOut = mutationWithSession({
  args: {},
  handler: async (ctx, _args) => {
    console.log("deleting presence data on logout", ctx.sessionId);
    const presenceDocs = await ctx.db
      .query("presence")
      .withIndex("user_room", (q) => q.eq("user", ctx.sessionId))
      .collect();
    await Promise.all(
      presenceDocs.map((doc) => ctx.db.delete("presence", doc._id)),
    );
  },
});

export const myPresence = queryWithSession({
  args: {},
  handler: async (ctx) => {
    const presenceDocs = await ctx.db
      .query("presence")
      .withIndex("user_room", (q) => q.eq("user", ctx.sessionId))
      .collect();
    return presenceDocs.map((p) => p.room);
  },
});

export const roomPresence = queryWithSession({
  args: { room: v.string() },
  handler: async (ctx, args) => {
    const presenceDoc = await ctx.db
      .query("presence")
      .withIndex("user_room", (q) =>
        q.eq("user", ctx.sessionId).eq("room", args.room),
      )
      .order("desc")
      .first();
    return presenceDoc?.data;
  },
});

export const joinRoom = mutationWithSession({
  args: { room: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("presence")
      .withIndex("user_room", (q) =>
        q.eq("user", ctx.sessionId).eq("room", args.room),
      )
      .first();
    if (existing) {
      await ctx.db.patch("presence", existing._id, { updated: Date.now() });
    } else {
      await ctx.db.insert("presence", {
        user: ctx.sessionId,
        room: args.room,
        data: {},
        updated: Date.now(),
      });
    }
  },
});

export const paginatedQueryWithSession = query({
  args: { paginationOpts: paginationOptsValidator, ...SessionIdArg },
  handler: async (ctx, args) => {
    const foo = await ctx.db
      .query("presence")
      .order("desc")
      .paginate(args.paginationOpts);
    return foo;
  },
});
