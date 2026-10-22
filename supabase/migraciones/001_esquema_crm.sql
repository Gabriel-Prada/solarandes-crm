-- Esquema del CRM de SolarAndes. El diseño está explicado en docs/modelo-datos.md.

-- ---------------------------------------------------------------------------
-- Listas fijas (D5): la base de datos no acepta valores que no estén aquí
-- ---------------------------------------------------------------------------

create type rol_usuario as enum ('gerente', 'asesor', 'tecnico', 'contadora');
create type ciudad as enum ('Bogotá', 'Medellín', 'Cali');
create type tipo_contacto as enum ('hogar', 'negocio');
create type canal_origen as enum ('anuncios', 'whatsapp', 'web', 'referido');
create type etapa_oportunidad as enum (
  'nuevo', 'contactado', 'visita_agendada', 'cotizado', 'negociacion', 'ganado', 'perdido'
);
create type tipo_oportunidad as enum ('nueva', 'ampliacion');
create type motivo_perdida as enum (
  'precio', 'competencia', 'no_respondio', 'techo_no_apto', 'sin_financiacion', 'aplazo'
);
create type tipo_actividad as enum ('llamada', 'whatsapp', 'correo', 'visita', 'nota', 'tarea');
create type estado_cotizacion as enum ('enviada', 'aceptada', 'rechazada', 'reemplazada');

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

-- Las personas del equipo. El id es el mismo del usuario de Supabase Auth.
create table perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  codigo text not null unique,
  nombre text not null,
  email text not null unique,
  rol rol_usuario not null,
  ciudad ciudad,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table productos (
  sku text primary key,
  nombre text not null,
  categoria text not null check (categoria in ('panel', 'inversor', 'bateria', 'estructura', 'servicio')),
  precio_cop bigint not null check (precio_cop >= 0),
  activo boolean not null default true
);

-- Códigos legibles (D4): C0001, O0001... los genera la base de datos para los registros nuevos
create sequence contactos_codigo_seq;
create sequence oportunidades_codigo_seq;

create table contactos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default 'C' || lpad(nextval('contactos_codigo_seq')::text, 4, '0'),
  tipo tipo_contacto not null,
  nombre text not null,
  empresa text,
  telefono text not null check (telefono ~ '^\+573[0-9]{9}$'),
  email text,
  ciudad ciudad not null,
  direccion text,
  estrato smallint check (estrato between 1 and 6),
  consumo_kwh_mes integer check (consumo_kwh_mes > 0),
  canal_origen canal_origen not null,
  asesor_id uuid not null references perfiles (id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- D1: hogares y negocios en la misma tabla, pero cada uno con sus campos
  constraint empresa_solo_negocios check (tipo = 'negocio' or empresa is null),
  constraint estrato_solo_hogares check (tipo = 'hogar' or estrato is null)
);

create table oportunidades (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default 'O' || lpad(nextval('oportunidades_codigo_seq')::text, 4, '0'),
  contacto_id uuid not null references contactos (id) on delete cascade,
  asesor_id uuid not null references perfiles (id),
  tipo tipo_oportunidad not null default 'nueva',
  nombre text not null,
  etapa etapa_oportunidad not null default 'nuevo',
  potencia_kwp numeric(6, 2),
  valor_cop bigint check (valor_cop >= 0),
  -- La probabilidad sale de la etapa: se calcula sola y nunca queda desactualizada
  probabilidad smallint generated always as (
    case etapa
      when 'nuevo' then 5
      when 'contactado' then 15
      when 'visita_agendada' then 35
      when 'cotizado' then 50
      when 'negociacion' then 70
      when 'ganado' then 100
      else 0
    end
  ) stored,
  motivo_perdida motivo_perdida,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  fecha_cierre timestamptz,
  constraint motivo_solo_si_perdida check ((etapa = 'perdido') = (motivo_perdida is not null)),
  constraint cierre_solo_si_cerrada check ((etapa in ('ganado', 'perdido')) = (fecha_cierre is not null))
);

create table actividades (
  id uuid primary key default gen_random_uuid(),
  contacto_id uuid not null references contactos (id) on delete cascade,
  oportunidad_id uuid references oportunidades (id) on delete cascade,
  usuario_id uuid not null references perfiles (id),
  tipo tipo_actividad not null,
  descripcion text not null,
  fecha timestamptz not null,
  completada boolean not null default false,
  creada_en timestamptz not null default now()
);

-- D3: cada cotización guarda la "foto" del cálculo del día en que se envió
create table cotizaciones (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  oportunidad_id uuid not null references oportunidades (id) on delete cascade,
  version smallint not null default 1,
  fecha timestamptz not null default now(),
  consumo_kwh_mes integer not null check (consumo_kwh_mes > 0),
  potencia_kwp numeric(6, 2) not null,
  num_paneles integer not null check (num_paneles > 0),
  precio_kwp bigint not null,
  descuento_pct numeric(4, 1) not null default 0 check (descuento_pct between 0 and 100),
  valor_total bigint not null check (valor_total >= 0),
  estado estado_cotizacion not null default 'enviada',
  unique (oportunidad_id, version)
);

-- D2: el recorrido de cada venta. cambiado_por vacío = lo hizo el sistema.
create table historial_etapas (
  id uuid primary key default gen_random_uuid(),
  oportunidad_id uuid not null references oportunidades (id) on delete cascade,
  etapa_anterior etapa_oportunidad,
  etapa_nueva etapa_oportunidad not null,
  cambiado_por uuid references perfiles (id),
  fecha timestamptz not null default now()
);

-- Índices: aceleran las búsquedas más comunes (por asesor, por contacto, por fecha)
create index on contactos (asesor_id);
create index on oportunidades (contacto_id);
create index on oportunidades (asesor_id, etapa);
create index on actividades (contacto_id);
create index on actividades (oportunidad_id);
create index on actividades (usuario_id, fecha);
create index on cotizaciones (oportunidad_id);
create index on historial_etapas (oportunidad_id, fecha);

-- ---------------------------------------------------------------------------
-- Automatismos (triggers)
-- ---------------------------------------------------------------------------

-- Durante la carga de datos de prueba se apagan, porque esos datos ya traen sus fechas e historial
create function en_carga_masiva() returns boolean
language sql stable as $$
  select coalesce(current_setting('solarandes.carga_masiva', true), '') = 'on'
$$;

create function marcar_actualizacion() returns trigger
language plpgsql as $$
begin
  if not en_carga_masiva() then
    new.actualizado_en := now();
  end if;
  return new;
end;
$$;

create trigger contactos_actualizado_en
  before update on contactos
  for each row execute function marcar_actualizacion();

-- Anota en el historial cada cambio de etapa y mantiene coherentes las fechas de cierre.
-- security definer: se ejecuta con permisos del dueño, porque nadie puede escribir el historial a mano.
create function registrar_cambio_etapa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if en_carga_masiva() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into historial_etapas (oportunidad_id, etapa_anterior, etapa_nueva, cambiado_por, fecha)
    values (new.id, null, new.etapa, auth.uid(), new.creada_en);
    return new;
  end if;

  new.actualizada_en := now();
  if new.etapa is distinct from old.etapa then
    insert into historial_etapas (oportunidad_id, etapa_anterior, etapa_nueva, cambiado_por, fecha)
    values (new.id, old.etapa, new.etapa, auth.uid(), now());

    if new.etapa in ('ganado', 'perdido') then
      new.fecha_cierre := coalesce(new.fecha_cierre, now());
    else
      -- Si una venta cerrada se reabre, deja de tener fecha de cierre y motivo de pérdida
      new.fecha_cierre := null;
      new.motivo_perdida := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger oportunidades_historial_al_crear
  after insert on oportunidades
  for each row execute function registrar_cambio_etapa();

create trigger oportunidades_historial_al_cambiar
  before update on oportunidades
  for each row execute function registrar_cambio_etapa();

-- ---------------------------------------------------------------------------
-- Permisos por rol (Row Level Security). Ver docs/modelo-datos.md, sección 4.
-- ---------------------------------------------------------------------------

-- El rol de quien está conectado. security definer para poder leer perfiles sin dar vueltas.
create function mi_rol() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

-- ¿El contacto es de quien está conectado?
create function es_mi_contacto(p_contacto_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from contactos where id = p_contacto_id and asesor_id = auth.uid())
$$;

-- ¿La oportunidad es de quien está conectado?
create function es_mi_oportunidad(p_oportunidad_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from oportunidades where id = p_oportunidad_id and asesor_id = auth.uid())
$$;

alter table perfiles enable row level security;
alter table productos enable row level security;
alter table contactos enable row level security;
alter table oportunidades enable row level security;
alter table actividades enable row level security;
alter table cotizaciones enable row level security;
alter table historial_etapas enable row level security;

-- perfiles: todos ven los nombres del equipo; solo la gerente edita
create policy "equipo ve perfiles" on perfiles for select to authenticated using (true);
create policy "gerente edita perfiles" on perfiles for update to authenticated
  using ((select mi_rol()) = 'gerente') with check ((select mi_rol()) = 'gerente');

-- productos: todos ven el catálogo; solo la gerente lo cambia
create policy "equipo ve productos" on productos for select to authenticated using (true);
create policy "gerente administra productos" on productos for all to authenticated
  using ((select mi_rol()) = 'gerente') with check ((select mi_rol()) = 'gerente');

-- contactos: la gerente todo; cada asesor los suyos; técnico y contadora nada
create policy "ver contactos" on contactos for select to authenticated
  using ((select mi_rol()) = 'gerente' or asesor_id = (select auth.uid()));
create policy "crear contactos" on contactos for insert to authenticated
  with check ((select mi_rol()) = 'gerente' or ((select mi_rol()) = 'asesor' and asesor_id = (select auth.uid())));
create policy "editar contactos" on contactos for update to authenticated
  using ((select mi_rol()) = 'gerente' or asesor_id = (select auth.uid()))
  with check ((select mi_rol()) = 'gerente' or asesor_id = (select auth.uid()));
create policy "borrar contactos" on contactos for delete to authenticated
  using ((select mi_rol()) = 'gerente');

-- oportunidades: mismo criterio que contactos
create policy "ver oportunidades" on oportunidades for select to authenticated
  using ((select mi_rol()) = 'gerente' or asesor_id = (select auth.uid()));
create policy "crear oportunidades" on oportunidades for insert to authenticated
  with check (
    (select mi_rol()) = 'gerente'
    or ((select mi_rol()) = 'asesor' and asesor_id = (select auth.uid()) and es_mi_contacto(contacto_id))
  );
create policy "editar oportunidades" on oportunidades for update to authenticated
  using ((select mi_rol()) = 'gerente' or asesor_id = (select auth.uid()))
  with check ((select mi_rol()) = 'gerente' or asesor_id = (select auth.uid()));
create policy "borrar oportunidades" on oportunidades for delete to authenticated
  using ((select mi_rol()) = 'gerente');

-- actividades: la gerente todo; el asesor las de sus contactos; cada quien las que tiene asignadas
create policy "ver actividades" on actividades for select to authenticated
  using ((select mi_rol()) = 'gerente' or usuario_id = (select auth.uid()) or es_mi_contacto(contacto_id));
create policy "crear actividades" on actividades for insert to authenticated
  with check ((select mi_rol()) = 'gerente' or es_mi_contacto(contacto_id));
create policy "editar actividades" on actividades for update to authenticated
  using ((select mi_rol()) = 'gerente' or usuario_id = (select auth.uid()) or es_mi_contacto(contacto_id))
  with check ((select mi_rol()) = 'gerente' or usuario_id = (select auth.uid()) or es_mi_contacto(contacto_id));
create policy "borrar actividades" on actividades for delete to authenticated
  using ((select mi_rol()) = 'gerente' or es_mi_contacto(contacto_id));

-- cotizaciones: las de las oportunidades propias
create policy "ver cotizaciones" on cotizaciones for select to authenticated
  using ((select mi_rol()) = 'gerente' or es_mi_oportunidad(oportunidad_id));
create policy "crear cotizaciones" on cotizaciones for insert to authenticated
  with check ((select mi_rol()) = 'gerente' or es_mi_oportunidad(oportunidad_id));
create policy "editar cotizaciones" on cotizaciones for update to authenticated
  using ((select mi_rol()) = 'gerente' or es_mi_oportunidad(oportunidad_id))
  with check ((select mi_rol()) = 'gerente' or es_mi_oportunidad(oportunidad_id));

-- historial: solo se lee. Lo escribe únicamente el trigger, nunca una persona.
create policy "ver historial" on historial_etapas for select to authenticated
  using ((select mi_rol()) = 'gerente' or es_mi_oportunidad(oportunidad_id));

-- ---------------------------------------------------------------------------
-- Vista del técnico: RLS filtra filas, no columnas. Esta vista solo muestra
-- lo que el técnico necesita de sus visitas, sin consumos, correos ni valores.
-- ---------------------------------------------------------------------------

create view visitas_tecnico as
select
  a.id,
  a.tipo,
  a.descripcion,
  a.fecha,
  a.completada,
  c.nombre as cliente,
  c.empresa,
  c.telefono,
  c.direccion,
  c.ciudad
from actividades a
join contactos c on c.id = a.contacto_id
where a.usuario_id = (select auth.uid())
  and a.tipo in ('visita', 'tarea');

-- ---------------------------------------------------------------------------
-- Acceso desde la app. El proyecto no expone tablas automáticamente:
-- solo los usuarios con sesión iniciada (authenticated) pueden llegar a ellas,
-- y siempre pasando por las reglas de arriba. Los visitantes anónimos, nada.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select on perfiles, productos, historial_etapas, visitas_tecnico to authenticated;
grant update on perfiles to authenticated;
grant insert, update, delete on productos to authenticated;
grant select, insert, update, delete on contactos, oportunidades, actividades to authenticated;
grant select, insert, update on cotizaciones to authenticated;
grant usage on sequence contactos_codigo_seq, oportunidades_codigo_seq to authenticated;
revoke all on all tables in schema public from anon;
