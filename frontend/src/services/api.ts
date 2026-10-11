import type { Session, PaymentForm } from "../types";
let csrfToken = "";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export function setSession(value: Session) {
  csrfToken = value.csrfToken;
}
let boot: Promise<Session> | null = null;
export async function getSession() {
  if (!boot)
    boot = fetch("/api/v1/auth/session", { credentials: "include" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new ApiError(data.error, r.status);
        setSession(data);
        return data;
      })
      .finally(() => {
        boot = null;
      });
  return boot;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const mutate = options.method && !["GET", "HEAD"].includes(options.method);
  if (mutate && !csrfToken) await getSession();
  const form = options.body instanceof FormData;
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(!form && options.body ? { "Content-Type": "application/json" } : {}),
      ...(mutate ? { "X-CSRF-Token": csrfToken } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error ?? "Please try again.",
      response.status,
      data.code,
    );
  return data;
}
export const send = <T>(
  path: string,
  body: unknown,
  method = "POST",
  headers?: Record<string, string>,
) => api<T>(path, { method, body: JSON.stringify(body), headers });
export const money = (amount: number) =>
  new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
  }).format(amount / 100);
export function submitPayment(payment: PaymentForm) {
  if (
    ![
      "https://sandbox.payhere.lk/pay/checkout",
      "https://www.payhere.lk/pay/checkout",
    ].includes(payment.action)
  )
    throw new Error("Invalid payment destination.");
  const form = document.createElement("form");
  form.method = "POST";
  form.action = payment.action;
  for (const [name, value] of Object.entries(payment.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
export function imageSet(url: string) {
  return /^\/media\/[a-f0-9]{16}\.webp$/.test(url)
    ? `${url.replace(".webp", "-480.webp")} 480w, ${url.replace(".webp", "-960.webp")} 960w, ${url} 1600w`
    : undefined;
}
