
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'corretor');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT, INSERT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "self insert corretor role" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'corretor');

CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role)
$$;

-- Seed admin for Miguel if already signed up
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
WHERE lower(email) = 'trabalhosluizmiguel@gmail.com'
ON CONFLICT DO NOTHING;

-- Link brokers to auth users
ALTER TABLE public.brokers
  ADD COLUMN user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN approved boolean NOT NULL DEFAULT false,
  ADD COLUMN email text;

-- Mark existing seeded brokers as approved so admin can manage/delete them
UPDATE public.brokers SET approved = true WHERE user_id IS NULL;

CREATE OR REPLACE FUNCTION public.current_broker_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.brokers WHERE user_id = auth.uid() LIMIT 1
$$;

-- Tighten RLS

-- brokers: everyone authenticated reads (so names show in admin view); user can insert own pending broker; admin manages everything; corretor updates own name only
DROP POLICY IF EXISTS "authenticated full access brokers" ON public.brokers;

CREATE POLICY "read brokers" ON public.brokers FOR SELECT TO authenticated USING (true);
CREATE POLICY "self insert pending broker" ON public.brokers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND approved = false);
CREATE POLICY "self update own broker name" ON public.brokers FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND approved = (SELECT approved FROM public.brokers b WHERE b.id = brokers.id));
CREATE POLICY "admin manage brokers" ON public.brokers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- contacts_queue
DROP POLICY IF EXISTS "authenticated full access contacts_queue" ON public.contacts_queue;
CREATE POLICY "rw own contacts" ON public.contacts_queue FOR ALL TO authenticated
  USING (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'));

-- calls
DROP POLICY IF EXISTS "authenticated full access calls" ON public.calls;
CREATE POLICY "rw own calls" ON public.calls FOR ALL TO authenticated
  USING (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'));

-- broker_sessions
DROP POLICY IF EXISTS "authenticated full access broker_sessions" ON public.broker_sessions;
CREATE POLICY "rw own sessions" ON public.broker_sessions FOR ALL TO authenticated
  USING (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'));

-- broker_pauses
DROP POLICY IF EXISTS "authenticated full access broker_pauses" ON public.broker_pauses;
CREATE POLICY "rw own pauses" ON public.broker_pauses FOR ALL TO authenticated
  USING (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'));
