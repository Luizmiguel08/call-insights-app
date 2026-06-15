
-- =====================================================================
-- FASE 1: Organizations + Members + Invites (sem tocar nas tabelas existentes)
-- =====================================================================

-- ============= 1. Tabelas =============

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE public.org_member_role AS ENUM ('owner', 'admin', 'agent');

CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_member_role NOT NULL DEFAULT 'agent',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX organization_members_user_idx ON public.organization_members(user_id);
CREATE INDEX organization_members_org_idx  ON public.organization_members(organization_id);

CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'revoked');

CREATE TABLE public.organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  role public.org_member_role NOT NULL DEFAULT 'agent',
  status public.invite_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX organization_invites_org_idx    ON public.organization_invites(organization_id);
CREATE INDEX organization_invites_status_idx ON public.organization_invites(status);

-- ============= 2. Grants =============

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations         TO authenticated;
GRANT ALL                            ON public.organizations         TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members  TO authenticated;
GRANT ALL                            ON public.organization_members  TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invites  TO authenticated;
GRANT ALL                            ON public.organization_invites  TO service_role;

-- ============= 3. Triggers de updated_at =============

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_organization_invites_updated_at
  BEFORE UPDATE ON public.organization_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= 4. Helpers SECURITY DEFINER =============

CREATE OR REPLACE FUNCTION public.is_org_member(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _org AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _org
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
  ORDER BY joined_at ASC
  LIMIT 1
$$;

-- Leitura pública (anon + authenticated) de um convite via token — só campos necessários
CREATE OR REPLACE FUNCTION public.get_invite_by_token(_token uuid)
RETURNS TABLE (
  id              uuid,
  organization_id uuid,
  organization_name text,
  role            public.org_member_role,
  status          public.invite_status,
  expires_at      timestamptz,
  email           text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.organization_id, o.name, i.role, i.status, i.expires_at, i.email
  FROM public.organization_invites i
  JOIN public.organizations o ON o.id = i.organization_id
  WHERE i.token = _token
$$;

GRANT EXECUTE ON FUNCTION public.get_invite_by_token(uuid) TO anon, authenticated;

-- Aceitar convite atomicamente
CREATE OR REPLACE FUNCTION public.accept_organization_invite(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_invite public.organization_invites;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_invite FROM public.organization_invites
  WHERE token = _token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'invite_not_pending' USING ERRCODE = 'P0001';
  END IF;

  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0001';
  END IF;

  -- Cria membership (idempotente)
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_invite.organization_id, v_uid, v_invite.role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE public.organization_invites
  SET status = 'accepted', accepted_by = v_uid, accepted_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'organization_id', v_invite.organization_id,
    'role', v_invite.role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_organization_invite(uuid) TO authenticated;

-- ============= 5. RLS =============

ALTER TABLE public.organizations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invites  ENABLE ROW LEVEL SECURITY;

-- organizations: membros leem, admins editam
CREATE POLICY "members read own org"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));

CREATE POLICY "admins update own org"
  ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_org_admin(id))
  WITH CHECK (public.is_org_admin(id));

CREATE POLICY "authenticated can create org"
  ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- organization_members: membros veem colegas, admins gerenciam
CREATE POLICY "members read same org members"
  ON public.organization_members FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "admins manage members"
  ON public.organization_members FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- INSERT direto bloqueado para o próprio usuário — entrada é via accept_organization_invite (SECURITY DEFINER)

-- organization_invites: só admins manipulam; leitura pública é via get_invite_by_token
CREATE POLICY "admins manage invites"
  ON public.organization_invites FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- ============= 6. Backfill: organização default + memberships =============

DO $$
DECLARE
  v_org_id uuid;
  v_owner  uuid;
BEGIN
  -- escolhe um owner: primeiro admin existente
  SELECT user_id INTO v_owner
  FROM public.user_roles
  WHERE role = 'admin'
  ORDER BY user_id
  LIMIT 1;

  INSERT INTO public.organizations (name, created_by)
  VALUES ('Fortal', v_owner)
  RETURNING id INTO v_org_id;

  -- todos os usuários conhecidos (de brokers + user_roles) viram membros
  INSERT INTO public.organization_members (organization_id, user_id, role)
  SELECT
    v_org_id,
    u.user_id,
    CASE
      WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.user_id AND r.role = 'admin')
        THEN 'admin'::public.org_member_role
      ELSE 'agent'::public.org_member_role
    END
  FROM (
    SELECT user_id FROM public.brokers WHERE user_id IS NOT NULL
    UNION
    SELECT user_id FROM public.user_roles
  ) u
  WHERE u.user_id IS NOT NULL
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  -- promove o primeiro admin a owner
  IF v_owner IS NOT NULL THEN
    UPDATE public.organization_members
    SET role = 'owner'
    WHERE organization_id = v_org_id AND user_id = v_owner;
  END IF;
END $$;
