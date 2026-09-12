/* Storage key layout. Every key this app writes is minted here.

   The desk's own records live under `sd:`. One key per record so two
   computers editing different customers never overwrite each other.
   Everything under `sd:` routes to the shared `kv` table in Supabase.

   The staff list is the one thing shared with the time clock: it reads
   and writes the clock's `gac:employees` key so techs are entered once. */

export const CFG_KEY = "sd:config";
export const COUNTERS_KEY = "sd:counters";
export const CUSTOMER_PREFIX = "sd:customer:";
export const VEHICLE_PREFIX = "sd:vehicle:";
export const PART_PREFIX = "sd:part:";
export const VENDOR_PREFIX = "sd:vendor:";
export const JOB_PREFIX = "sd:job:";
export const ORDER_PREFIX = "sd:order:";
export const SPEC_PREFIX = "sd:spec:"; // service specs per engine (oil grade, capacity, filter numbers)
export const specStoreKey = (id) => SPEC_PREFIX + id;
export const CART_PREFIX = "sd:cart:"; // parts carts sent back by a catalog; one per punchout session
export const customerKey = (id) => CUSTOMER_PREFIX + id;
export const vehicleKey = (id) => VEHICLE_PREFIX + id;
export const partKey = (id) => PART_PREFIX + id;
export const vendorKey = (id) => VENDOR_PREFIX + id;
export const jobKey = (id) => JOB_PREFIX + id;
export const orderKey = (id) => ORDER_PREFIX + id;

/* shared with the time clock; see src/storage/cloud.js for how it's pulled */
export const ROSTER_KEY = "gac:employees";
export const SHARED_KEYS = [ROSTER_KEY];

export const SIGNREQ_KEY = "sd:signreq"; // the estimate the front desk has sent to the signature tablet
