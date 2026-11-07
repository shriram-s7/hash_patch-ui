/** Single kill switch for the whole guided-discovery system. When false,
 * every tour hook/primitive renders nothing and the store's `enabled`
 * field is ignored -- flipping this back to false must reproduce the
 * exact current app (zero extra DOM nodes). */
export const FEATURE_GUIDED_UI = true;
