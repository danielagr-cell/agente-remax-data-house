-- ============================================================
--  Seed de ejemplo — RE/MAX Data House
--  Datos para que el bot funcione de punta a punta hoy mismo.
--  Reemplazá las propiedades por el sync real del CRM cuando esté listo.
-- ============================================================

-- --- Agentes (tenants) ---
insert into agentes (id, nombre, codigo_referido, whatsapp_numero, telefono_alertas, matricula, zonas_cobertura)
values
  ('11111111-1111-1111-1111-111111111111', 'Daniela', 'daniela-dh', '5491100000001', '5491111111111', 'CUCICBA 0000', array['Caballito','Flores','Villa Crespo']),
  ('22222222-2222-2222-2222-222222222222', 'Barby',   'barby-dh',   '5491100000002', '5491122222222', 'CUCICBA 0001', array['Palermo','Villa Urquiza','Belgrano'])
on conflict (id) do nothing;

-- --- Propiedades de ejemplo (catálogo compartido: agente_id null) ---
insert into propiedades
  (codigo_remax, operacion, tipo, titulo, zona, precio, moneda, ambientes, dormitorios, banos, cochera, metros_cubiertos, expensas, apto_credito, a_estrenar, extras, descripcion, link_oficial)
values
  ('RMX-00421','venta','departamento','Depto 2 amb a estrenar en Caballito','Caballito', 95000,'USD',2,1,1,false,48,45000,true,true, array['balcón','luminoso','apto crédito'],'2 ambientes a estrenar, muy luminoso, al frente.','https://www.remax.com.ar/listings/RMX-00421'),
  ('RMX-00422','venta','departamento','3 amb con cochera en Flores','Flores', 128000,'USD',3,2,1,true,70,60000,true,false, array['cochera','contrafrente','balcón'],'3 ambientes amplio con cochera cubierta.','https://www.remax.com.ar/listings/RMX-00422'),
  ('RMX-00423','venta','ph','PH 4 amb con patio en Villa Crespo','Villa Crespo', 165000,'USD',4,3,2,false,95,0,false,false, array['patio','parrilla','sin expensas'],'PH al frente con patio y parrilla, sin expensas.','https://www.remax.com.ar/listings/RMX-00423'),
  ('RMX-00424','venta','departamento','Monoambiente en Palermo','Palermo', 78000,'USD',1,0,1,false,32,38000,true,true, array['amenities','a estrenar'],'Monoambiente a estrenar con amenities.','https://www.remax.com.ar/listings/RMX-00424'),
  ('RMX-00425','venta','departamento','3 amb en Villa Urquiza','Villa Urquiza', 139000,'USD',3,2,1,true,68,52000,true,false, array['cochera','balcón aterrazado'],'3 ambientes con cochera y balcón aterrazado.','https://www.remax.com.ar/listings/RMX-00425'),
  ('RMX-00426','alquiler','departamento','2 amb en Belgrano','Belgrano', 650000,'ARS',2,1,1,false,50,70000,false,false, array['luminoso','apto profesional'],'2 ambientes luminoso, apto profesional.','https://www.remax.com.ar/listings/RMX-00426')
on conflict (codigo_remax) do nothing;

-- --- Disponibilidad de ejemplo (próximos días, horarios de tarde/mañana) ---
insert into disponibilidad (agente_id, inicio, fin)
values
  ('11111111-1111-1111-1111-111111111111', date_trunc('day', now()) + interval '1 day 17 hours', date_trunc('day', now()) + interval '1 day 18 hours'),
  ('11111111-1111-1111-1111-111111111111', date_trunc('day', now()) + interval '2 day 11 hours', date_trunc('day', now()) + interval '2 day 12 hours'),
  ('11111111-1111-1111-1111-111111111111', date_trunc('day', now()) + interval '2 day 16 hours', date_trunc('day', now()) + interval '2 day 17 hours'),
  ('22222222-2222-2222-2222-222222222222', date_trunc('day', now()) + interval '1 day 10 hours', date_trunc('day', now()) + interval '1 day 11 hours'),
  ('22222222-2222-2222-2222-222222222222', date_trunc('day', now()) + interval '3 day 18 hours', date_trunc('day', now()) + interval '3 day 19 hours');

-- --- Info de negocio de ejemplo (requiere 0002; editable; el agente solo afirma lo que está acá o en una tool) ---
update agentes set business_info = '{"medios_de_pago":"Contado, transferencia o apto crédito hipotecario","zona_operacion":"CABA","honorarios":"Según normativa CUCICBA","financiacion":"A consultar según la propiedad"}'::jsonb
  where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

-- --- Corrección activa de ejemplo ---
insert into agent_notes (agente_id, contenido, origen) values
  ('11111111-1111-1111-1111-111111111111', 'Confirmá siempre la zona exacta antes de ofrecer una visita.', 'manual');

