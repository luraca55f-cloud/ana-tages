const TEST_MODE_KEY = "tages:test-mode";
const TEST_EMAIL_KEY = "tages:test-email";

let runtimeTestMode = false;
let runtimeTestEmail = "";

export function setTestMode(enabled: boolean, email = "") {
  runtimeTestMode = enabled;
  runtimeTestEmail = enabled ? email.trim().toLowerCase() : "";
  if (typeof window !== "undefined") {
    if (enabled) {
      window.sessionStorage.setItem(TEST_MODE_KEY, "1");
      window.sessionStorage.setItem(TEST_EMAIL_KEY, runtimeTestEmail);
    } else {
      window.sessionStorage.removeItem(TEST_MODE_KEY);
      window.sessionStorage.removeItem(TEST_EMAIL_KEY);
    }
  }
}

export function isTestMode() {
  if (runtimeTestMode) return true;
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(TEST_MODE_KEY) === "1";
}

export function getTestEmail() {
  if (runtimeTestEmail) return runtimeTestEmail;
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(TEST_EMAIL_KEY) ?? "";
}
