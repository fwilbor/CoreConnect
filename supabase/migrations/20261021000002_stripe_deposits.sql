-- Stripe deposits (week 5b). The payment intent id lets refunds find their payment.
alter table public.payments add column stripe_payment_intent_id text;
create unique index payments_stripe_pi_uniq on public.payments (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
