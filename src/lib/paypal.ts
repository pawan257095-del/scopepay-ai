const baseUrl = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";

export async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("PayPal sandbox credentials are not configured.");
  const credentials = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || "Unable to authenticate with PayPal.");
  return data.access_token as string;
}

export { baseUrl as PAYPAL_BASE_URL };
