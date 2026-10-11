# PayHere: Sri Lanka / LKR

The implementation uses the [official hosted Checkout API](https://support.payhere.lk/api-%26-mobile-sdk/checkout-api). The server builds the checkout hash and verifies the provider's notification checksum using the documented uppercase MD5 construction. MD5 is used solely because the provider mandates that checksum; passwords use bcrypt and account/session tokens are random secrets stored as SHA-256 hashes.

## Configuration

1. Create/approve your Sri Lankan PayHere merchant account and obtain sandbox access.
2. Add your staging domain to the merchant application's approved domains and obtain its **domain-specific merchant secret**.
3. Set `PAYHERE_MODE=sandbox`, `PAYHERE_MERCHANT_ID`, and `PAYHERE_MERCHANT_SECRET` in the server environment.
4. Set `APP_ORIGIN=https://YOUR_STAGING_DOMAIN` and `PUBLIC_API_ORIGIN` to the HTTPS origin reaching the API. The callback path is `/api/v1/payments/payhere/notify`.
5. Configure SMTP and verify the customer email. Populate real or explicit staging inventory and publish approved staging policies before a production-mode checkout.

PayHere must be able to POST to the public callback. A localhost checkout return or a local test callback does not verify the real provider integration. A staging host or an explicitly configured HTTPS tunnel is required; this project does not create a tunnel or expose your machine automatically.

## Order behavior

The server calculates every amount in integer LKR cents, validates the product/variant stock and coupon in a serializable transaction, snapshots the order, and reserves inventory for 30 minutes. A UUID idempotency key prevents a retry from creating a second order. The browser posts the server-generated fields to the configured PayHere hosted checkout URL. Card details never enter this application.

The return/cancel URL displays the persisted order; it cannot set a paid flag. A signed notification must match merchant, order, amount, currency, and payment identity. Success consumes the reservation exactly once and queues confirmation email. Failure/cancellation restores stock and releases coupon usage. Duplicate events and later failure events cannot undo a confirmed payment. A success arriving after a reservation has expired enters `PAYMENT_REVIEW` for manual stock/payment reconciliation; it does not silently fulfill an oversold item.

Orders requiring reconciliation are visible to administrators. Refunds are initiated by an authorized merchant in PayHere, then recorded in the app with the real provider reference. Setting `REFUNDED` records an already performed refund; it is not a money-transfer request. Verify settlement/refund amounts in the merchant portal before making that transition.

## Required merchant sandbox evidence

Record the staging order number, provider payment ID, callback HTTP status, database payment state, inventory movement, and received email for each case:

- Successful sandbox payment, followed by actual signed callback and order confirmation.
- Customer cancellation, failed authorization, and abandonment/30-minute expiration.
- Callback replay and page refresh without duplicate order, sale, email, or inventory movement.
- Forged checksum and wrong amount/currency rejected without changing the order.
- A public return arriving before the callback remains awaiting confirmation.
- A deliberately delayed success after expiry becomes a review order for reconciliation.
- Merchant-portal refund and the corresponding recorded refund reference.

Use the current test cards and instructions from the merchant's official sandbox documentation; no real card numbers belong in repository fixtures. Check public HTTPS and callback reachability from outside your network. Only after merchant approval and these checks, switch to `PAYHERE_MODE=live` and the live domain-specific credentials. A controlled live settlement/refund test requires the business owner's authorization and provider guidance.

Automated integration and browser tests cover our signature checks and state transitions with isolated fixture secrets. **A real PayHere sandbox transaction has not been run because no merchant credentials or public callback domain were supplied.**
