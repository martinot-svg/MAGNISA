import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!url || !anonKey || !email || !password) {
  throw new Error("Missing local Supabase credentials for concurrent stock reservation test.");
}

const client = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password });
if (authError || !auth.user || !auth.session) {
  throw authError ?? new Error("Could not authenticate concurrent reservation test user.");
}
const organizationId = "e1000000-0000-4000-8000-000000000001";
const itemId = "e1000000-0000-4000-8000-000000000132";
const locationId = "e1000000-0000-4000-8000-000000000133";
const attempts = [
  {
    orderId: "e1000000-0000-4000-8000-000000000134",
    requestKey: "e1000000-0000-4000-8000-000000000136",
  },
  {
    orderId: "e1000000-0000-4000-8000-000000000135",
    requestKey: "e1000000-0000-4000-8000-000000000137",
  },
];

const lineIds = await Promise.all(attempts.map(async ({ orderId }) => {
  const { data, error } = await client.from("order_lines")
    .select("id").eq("organization_id", organizationId).eq("order_id", orderId)
    .eq("item_id", itemId).single();
  if (error || !data) throw error ?? new Error("Concurrent reservation order line is missing.");
  return data.id;
}));

// Both HTTP requests are launched together. PostgREST executes them in independent
// PostgreSQL transactions, so this exercises the advisory lock rather than a
// sequential oversubscription check inside one SQL transaction.
const results = await Promise.all(attempts.map(({ orderId, requestKey }, index) =>
  client.rpc("reserve_stock", {
    p_organization_id: organizationId,
    p_order_id: orderId,
    p_order_line_id: lineIds[index],
    p_item_id: itemId,
    p_stock_location_id: locationId,
    p_quantity: 4,
    p_request_key: requestKey,
  }),
));

const successes = results.filter((result) => !result.error);
const failures = results.filter((result) => result.error);
if (successes.length !== 1 || failures.length !== 1) {
  throw new Error("Expected exactly one of two concurrent reservations to succeed; got " +
    JSON.stringify(results.map((result) => result.error?.message ?? "success")));
}
const { data: balance, error: balanceError } = await client.from("stock_available")
  .select("quantity_on_hand,quantity_reserved,quantity_available")
  .eq("organization_id", organizationId).eq("item_id", itemId)
  .eq("stock_location_id", locationId).eq("stock_bucket", "resale").single();
if (balanceError) throw balanceError;
if (Number(balance.quantity_on_hand) !== 5 ||
    Number(balance.quantity_reserved) !== 4 ||
    Number(balance.quantity_available) !== 1) {
  throw new Error("Concurrent reservation left an invalid stock balance: " + JSON.stringify(balance));
}
process.stdout.write("PASS PostgreSQL concurrency: 2 simultaneous sessions, 1 reservation accepted, 1 rejected; physical=5 reserved=4 available=1\n");
