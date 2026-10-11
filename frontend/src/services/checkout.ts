// Store only a random key, never addresses or payment details. The server scopes
// recovery to the signed-in owner and checks the original request hash.
const storageKey = (userId: string) => `cozzy:checkout:${userId}`;
export function readCheckoutKey(userId: string) {
  try {
    const key = window.sessionStorage.getItem(storageKey(userId)) ?? "";
    return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(key)
      ? key
      : "";
  } catch {
    return "";
  }
}
export function saveCheckoutKey(userId: string, key: string) {
  try {
    window.sessionStorage.setItem(storageKey(userId), key);
  } catch {
    /* Retain the component's in-memory key if storage is unavailable. */
  }
}
export function clearCheckoutKey(userId: string) {
  try {
    window.sessionStorage.removeItem(storageKey(userId));
  } catch {
    /* Storage may be disabled. */
  }
}
