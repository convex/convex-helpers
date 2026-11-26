import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, mutation } from "./_generated/server";

import { makeActionRetrier } from "convex-helpers/server/retries";

// Export the helpers, with the name of the retry function.
export const { runWithRetries, retry } = makeActionRetrier(
  "retriesExample:retry",
  { retryBackoff: 1000, log: console.warn }, // options for demo purposes.
);

// This is a sample action will fail randomly based on the `failureRate`
// argument. It's safe to retry since it doesn't have any side effects.
export const unreliableAction = internalAction({
  args: { failureRate: v.number() }, // 0.0 - 1.0
  handler: async (_ctx, { failureRate }) => {
    console.log("Running an action with failure rate " + failureRate);
    if (Math.random() < failureRate) {
      throw new Error("action failed.");
    }
    console.log("action succeeded.");
  },
});

// This calls the `unreliableAction` function with retries.
// Try it for yourself with:
// e.g. `npx convex run retriesExample:runUnreliableActionWithRetries`
export const runUnreliableActionWithRetries = mutation({
  args: {},
  handler: async (ctx, _args) => {
    await runWithRetries(ctx, internal.retriesExample.unreliableAction, {
      failureRate: 0.8,
    });
    // Possibly do something else besides scheduling the action,
    // for instance check if the logged in user has permission to run it.
    // If an error is thrown in a mutation, the transaction will be rolled back
    // and the action will not be scheduled to run.
  },
});

// Calling an action with retries from an action works too.
export const runFromAnAction = internalAction({
  args: {},
  handler: async (ctx) => {
    const email = { to: "user@example.com", subject: "Hello", body: "World" };
    await runWithRetries(
      ctx,
      internal.retriesExample.sendWelcomeEmail,
      { email },
      {
        // You can limit the number of retries and wait longer between attempts
        // if the action is not time sensitive and generally reliable.
        // Note: generally the default options are fine.

        // After 5 failures, give up.
        maxFailures: 5,
        // Wait 10 seconds before retrying the first time.
        retryBackoff: 10_000,
        // This is the multiplier for the next wait time.
        // e.g. if base is 10, the next wait time will be 10 times the previous.
        base: 10,
        // Wait time is then retryBackoff * base^(retryNumber).
        // This will result in waiting:
        // 10 seconds before retrying the first time,
        // 100 seconds before retrying the second time (~1.7 minutes),
        // 1000 seconds before retrying the third time (~16.7 minutes),
        // 10000 seconds before retrying the fourth and final time (~2.7 hours),
        // giving the action 5 chances to succeed over ~3 hours.
      },
    );
    // Unlike in mutations, in an action the scheduler will immediately be
    // given the action & parameters to run, even if there's an exception thrown
    // afterwards.
  },
});

// This is a pretend email sending function.
export const sendWelcomeEmail = internalAction({
  args: {
    email: v.object({ to: v.string(), subject: v.string(), body: v.string() }),
  },
  handler: async () => {
    // If the email provider is down, it could fail.
    // Hopefully it will be back up within minutes, but if it still isn't up
    // hours later, it's ok to skip sending this non-essential.
    // Note: If we wanted to ensure we don't send the same email twice,
    // we would need something like an idempotency key to pass to the provider.
  },
});
