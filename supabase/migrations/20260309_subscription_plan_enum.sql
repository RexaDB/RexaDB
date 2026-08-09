-- Must run in its own migration/transaction before enum values are used.
alter type public.subscription_plan add value if not exists 'team';
alter type public.subscription_plan add value if not exists 'enterprise';
