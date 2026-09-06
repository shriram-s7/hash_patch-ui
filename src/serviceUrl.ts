/** Base URL of the local Hash Patch analysis engine (hash_patch/service.py,
 * `hash-patch serve`). Shared by every component that talks to it, so the
 * port only ever needs to change in one place. */
export const SERVICE_BASE_URL = "http://localhost:8000";
