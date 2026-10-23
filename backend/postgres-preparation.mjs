const APP_TABLES = [
  'maquinaria',
  'contrato',
  'contrato_maquinaria',
  'pago',
  'usuario',
  'sesion',
  'token_recuperacion',
  'recepcion_maquinaria',
];
const API_ROLES = ['anon', 'authenticated', 'service_role'];
const INTERNAL_SCHEMAS = new Set(['auth', 'storage', 'realtime', '_realtime', 'extensions',
  'supabase_functions', 'supabase_migrations', 'vault', 'graphql', 'graphql_public',
  'pgsodium', 'pgsodium_masks', 'net', 'cron']);

const LEGACY_COLUMNS = {
  maquinaria: { id: 'integer', nombre: 'character varying(120)', tipo: 'character varying(80)',
    descripcion: 'text', tarifa_diaria: 'numeric(12,2)', disponible: 'boolean' },
  contrato: { id: 'uuid', maquinaria_id: 'integer', maquinaria_nombre: 'character varying(120)',
    cliente: 'character varying(160)', fecha_inicio: 'date', fecha_fin: 'date', dias: 'integer',
    tarifa_diaria: 'numeric(12,2)', total: 'numeric(14,2)', estado: 'character varying(20)',
    creado_en: 'timestamp with time zone' },
  contrato_maquinaria: { contrato_id: 'uuid', maquinaria_id: 'integer',
    maquinaria_nombre: 'character varying(120)', tarifa_diaria: 'numeric(12,2)' },
  pago: { id: 'uuid', contrato_id: 'uuid', monto: 'numeric(14,2)',
    creado_en: 'timestamp with time zone' },
};
const CURRENT_COLUMNS = {
  maquinaria: { ...LEGACY_COLUMNS.maquinaria, ubicacion: 'character varying(100)',
    horometro: 'integer', ficha_tecnica: 'text', foto_url: 'text' },
  contrato: { ...LEGACY_COLUMNS.contrato, ciudad: 'character varying(100)',
    operador: 'character varying(160)', operador_documento: 'character varying(20)',
    seguro: 'character varying(30)', forma_pago: 'character varying(30)',
    condiciones_especiales: 'text', firma: 'jsonb', firmado_en: 'timestamp with time zone' },
  contrato_maquinaria: LEGACY_COLUMNS.contrato_maquinaria,
  pago: LEGACY_COLUMNS.pago,
  usuario: { id: 'uuid', correo: 'character varying(254)', nombre: 'character varying(160)', clave_hash: 'text',
    rol: 'character varying(20)', activo: 'boolean', creado_en: 'timestamp with time zone' },
  sesion: { id: 'uuid', usuario_id: 'uuid', token_hash: 'text', expira_en: 'timestamp with time zone',
    creado_en: 'timestamp with time zone' },
  token_recuperacion: { id: 'uuid', usuario_id: 'uuid', token_hash: 'text', expira_en: 'timestamp with time zone',
    usado_en: 'timestamp with time zone', creado_en: 'timestamp with time zone' },
  recepcion_maquinaria: {
    id: 'uuid',
    contrato_id: 'uuid',
    maquinaria_id: 'integer',
    horometro: 'integer',
    fotos: 'jsonb',
    fecha_recepcion: 'timestamp with time zone',
  },
};

export class PostgresPreparationError extends Error {
  constructor(code, safeMessage) {
    super(safeMessage);
    this.name = 'PostgresPreparationError';
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

function fail(code, message) { throw new PostgresPreparationError(code, message); }
function schemaFor(database) {
  const schema = database.schema || 'constructora_private';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema) || schema === 'public' ||
      schema.startsWith('pg_') || schema === 'information_schema' || INTERNAL_SCHEMAS.has(schema)) {
    fail('INVALID_PRIVATE_SCHEMA', 'Configura un esquema privado válido para la aplicación.');
  }
  return schema;
}
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const roleCategory = (value, isCurrentRole = false) => value === 'PUBLIC' || API_ROLES.includes(value)
  ? value : isCurrentRole ? 'current_role' : 'other_role';
const safeCount = (value) => Number.isSafeInteger(Number(value)) ? Number(value) : String(value);

/** Read only: metadata and counts, never contract contents or connection identity. */
export async function inspectPostgresDatabase(database) {
  const schema = schemaFor(database);
  try {
    const { rows: relations } = await database.query(`/* inventory */
      SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
        c.relrowsecurity AS "rlsEnabled", c.relforcerowsecurity AS "forceRls",
        c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS "ownerIsCurrentRole",
        owner.rolname = ANY($1::text[]) AS "ownerIsApiRole"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles owner ON owner.oid = c.relowner
      WHERE c.relkind IN ('r', 'p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      ORDER BY n.nspname, c.relname`, [API_ROLES]);
    const { rows: columns } = await database.query(`/* app-columns */
      SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
        format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS "notNull",
        pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE c.relname = ANY($1::text[]) AND c.relkind IN ('r','p') AND a.attnum > 0
        AND NOT a.attisdropped AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      ORDER BY n.nspname, c.relname, a.attnum`, [APP_TABLES]);
    const { rows: policies } = await database.query(`/* app-policies */
      SELECT schemaname AS schema, tablename AS table, policyname AS name,
        cmd AS command, roles::text[] AS roles FROM pg_policies WHERE tablename = ANY($1::text[])`, [APP_TABLES]);
    const { rows: constraints } = await database.query(`/* app-constraints */
      SELECT n.nspname AS schema, c.relname AS table, con.conname AS name, con.contype AS type,
        con.convalidated AS validated, con.confdeltype AS "onDelete",
        pg_get_constraintdef(con.oid, true) AS definition,
        ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum ORDER BY k.position) AS columns,
        rn.nspname AS "referenceSchema", rc.relname AS "referenceTable",
        ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = rc.oid AND a.attnum = k.attnum ORDER BY k.position) AS "referenceColumns"
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_class rc ON rc.oid = con.confrelid LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
      WHERE c.relname = ANY($1::text[]) AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      ORDER BY n.nspname, c.relname, con.conname`, [APP_TABLES]);
    const { rows: grants } = await database.query(`/* app-grants */
      SELECT n.nspname AS schema, c.relname AS table,
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee,
        r.rolname = current_user AS "isCurrentRole", acl.privilege_type AS privilege
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      LEFT JOIN pg_roles r ON r.oid = acl.grantee
      WHERE c.relname = ANY($1::text[]) AND c.relkind IN ('r','p')
        AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'`, [APP_TABLES]);
    // Effective privileges also detect access inherited through another role.
    const { rows: effective } = await database.query(`/* api-effective-privileges */
      SELECT n.nspname AS schema, c.relname AS table, r.rolname AS grantee, p.privilege
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN pg_roles r CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
        ('TRUNCATE'),('REFERENCES'),('TRIGGER')) AS p(privilege)
      WHERE c.relname = ANY($1::text[]) AND c.relkind IN ('r','p') AND r.rolname = ANY($2::text[])
        AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND has_table_privilege(r.oid, c.oid, p.privilege)`, [APP_TABLES, API_ROLES]);
    const { rows: settings } = await database.query(`/* data-api-settings */
      SELECT current_setting('pgrst.db_schemas', true) AS value
      UNION SELECT substring(config FROM length('pgrst.db_schemas=') + 1)
        FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) config
        WHERE config LIKE 'pgrst.db_schemas=%' AND
          (s.setdatabase = 0 OR s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()))`);
    const { rows: defaults } = await database.query(`/* app-default-privileges */
      SELECT COALESCE(n.nspname, '*') AS schema,
        d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS "ownerIsCurrentRole",
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee,
        r.rolname = current_user AS "isCurrentRole", acl.privilege_type AS privilege
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) acl LEFT JOIN pg_roles r ON r.oid = acl.grantee
      WHERE d.defaclobjtype = 'r' AND (d.defaclnamespace = 0 OR n.nspname = $1)`, [schema]);
    const { rows: namespace } = await database.query(`/* target-schema */
      SELECT n.oid, n.nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS "ownerIsCurrentRole",
        owner.rolname = ANY($2::text[]) AS "ownerIsApiRole"
      FROM pg_namespace n JOIN pg_roles owner ON owner.oid = n.nspowner WHERE n.nspname = $1`, [schema, API_ROLES]);
    const { rows: schemaGrants } = await database.query(`/* target-schema-grants */
      SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee,
        r.rolname = current_user AS "isCurrentRole", acl.privilege_type AS privilege
      FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
      LEFT JOIN pg_roles r ON r.oid = acl.grantee WHERE n.nspname = $1`, [schema]);
    const { rows: objects } = await database.query(`/* target-schema-objects */
      SELECT 'relation' AS kind, c.relname AS name,
        CASE WHEN c.relkind = 'r' AND c.relname = ANY($2::text[]) THEN true
          WHEN c.relkind = 'i' AND EXISTS (SELECT 1 FROM pg_index i JOIN pg_class parent ON parent.oid = i.indrelid
            WHERE i.indexrelid = c.oid AND parent.relnamespace = n.oid AND parent.relname = ANY($2::text[]))
          THEN true ELSE false END AS "applicationObject"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1
      UNION ALL SELECT 'function', p.proname, false FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1
      UNION ALL SELECT 'trigger', tr.tgname, false FROM pg_trigger tr JOIN pg_class c ON c.oid = tr.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND NOT tr.tgisinternal
      UNION ALL SELECT 'rule', rw.rulename, false FROM pg_rewrite rw JOIN pg_class c ON c.oid = rw.ev_class
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND rw.rulename <> '_RETURN'
      UNION ALL SELECT 'type', t.typname,
        EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'r'
          AND c.relname = ANY($2::text[]) AND c.relnamespace = n.oid)
        OR EXISTS (SELECT 1 FROM pg_type element JOIN pg_class c ON c.oid = element.typrelid
          WHERE element.oid = t.typelem AND c.relkind = 'r' AND c.relname = ANY($2::text[]) AND c.relnamespace = n.oid)
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1`, [schema, APP_TABLES]);
    const appTables = [];
    for (const relation of relations.filter((row) => APP_TABLES.includes(row.name))) {
      const matches = (row) => row.schema === relation.schema && row.table === relation.name;
      const result = await database.query(`/* app-row-count */ SELECT COUNT(*)::text AS count FROM
        ${quoteIdentifier(relation.schema)}.${quoteIdentifier(relation.name)}`);
      appTables.push({ ...relation, rowCount: safeCount(result.rows[0].count),
        columns: columns.filter(matches).map(({ name, type, notNull, defaultValue }) => ({ name, type, notNull, defaultValue })),
        constraints: constraints.filter(matches).map(({ schema: ignoredSchema, table: ignoredTable, ...constraint }) => constraint),
        policies: policies.filter(matches).map(({ name, command, roles }) => ({ name, command,
          roles: [...new Set(roles.map((role) => roleCategory(role === 'public' ? 'PUBLIC' : role)))] })),
        grants: grants.filter(matches).map(({ grantee, isCurrentRole, privilege }) => ({
          grantee: roleCategory(grantee, isCurrentRole), privilege })),
        apiPrivileges: effective.filter(matches).map(({ grantee, privilege }) => ({ grantee, privilege })),
      });
    }
    return { provider: 'postgresql', databaseSchema: schema,
      tables: relations.filter((row) => !INTERNAL_SCHEMAS.has(row.schema)), appTables,
      visibleDataApiSchemas: [...new Set(settings.flatMap(({ value }) =>
        value ? value.split(',').map((name) => name.trim().replace(/^"|"$/g, '')).filter(Boolean) : []))],
      defaultPrivileges: defaults.map(({ schema: defaultSchema, ownerIsCurrentRole, grantee, isCurrentRole, privilege }) => ({
        schema: defaultSchema, ownerIsCurrentRole, grantee: roleCategory(grantee, isCurrentRole), privilege })),
      targetSchema: { exists: namespace.length > 0,
        ownerIsCurrentRole: namespace[0]?.ownerIsCurrentRole === true,
        ownerIsApiRole: namespace[0]?.ownerIsApiRole === true,
        grants: schemaGrants.map(({ grantee, isCurrentRole, privilege }) => ({
          grantee: roleCategory(grantee, isCurrentRole), privilege })), objects },
      dataApiPanelReviewRequired: database.requiresDataApiReview !== false,
    };
  } catch (error) {
    if (error instanceof PostgresPreparationError) throw error;
    fail('DATABASE_INSPECTION_FAILED', 'No se pudo inspeccionar la base de datos. Revisa la conexión y los permisos del backend.');
  }
}

function checkInventory(inventory, schema, { current = false, existingReviewed = false } = {}) {
  if (inventory.visibleDataApiSchemas.includes(schema)) {
    fail('SCHEMA_EXPOSED_TO_DATA_API', 'El esquema de la aplicación está expuesto por la Data API. Retíralo de Exposed schemas antes de continuar.');
  }
  if (inventory.appTables.some((table) => table.schema !== schema)) {
    fail('APPLICATION_TABLES_IN_OTHER_SCHEMA', 'Ya existen tablas de la aplicación en otro esquema. Revisa su ubicación antes de crear o mover tablas.');
  }
  if (inventory.targetSchema.exists && (!inventory.targetSchema.ownerIsCurrentRole ||
      inventory.targetSchema.ownerIsApiRole || inventory.targetSchema.objects.some((object) => !object.applicationObject) ||
      inventory.targetSchema.grants.some(({ grantee }) => grantee !== 'current_role'))) {
    fail('PRIVATE_SCHEMA_REVIEW_REQUIRED', 'El esquema privado existente pertenece a otro rol, tiene permisos ajenos o contiene otros objetos. Revísalo manualmente antes de continuar.');
  }
  const existing = inventory.appTables.filter((table) => table.schema === schema);
  const unsafeDefaults = inventory.defaultPrivileges.filter(({ grantee }) =>
    grantee === 'PUBLIC' || API_ROLES.includes(grantee));
  if (unsafeDefaults.some((grant) => grant.schema === '*') || (existing.length && unsafeDefaults.length)) {
    fail('UNSAFE_DEFAULT_DATABASE_ACCESS', 'Los privilegios predeterminados conceden acceso a roles de Data API. Revísalos manualmente antes de continuar.');
  }
  if (!current && existing.length && !existingReviewed) {
    fail('EXISTING_TABLES_REVIEW_REQUIRED', 'Ya existen tablas de la aplicación. Inspecciónalas antes de usar db:init -- --existing-reviewed.');
  }
  for (const table of existing) {
    if (table.kind !== 'r' || !table.ownerIsCurrentRole || table.ownerIsApiRole || table.policies.length || table.apiPrivileges.length ||
        table.grants.some(({ grantee }) => grantee !== 'current_role')) {
      fail('UNSAFE_EXISTING_DATABASE_ACCESS', 'Las tablas existentes tienen políticas, permisos de Data API o una estructura que requiere revisión manual. No se modificaron.');
    }
    const required = current ? CURRENT_COLUMNS[table.name] : LEGACY_COLUMNS[table.name] || CURRENT_COLUMNS[table.name];
    const compatible = Object.entries(required).every(([name, type]) =>
      table.columns.some((column) => column.name === name && column.type.replaceAll(' ', '') === type.replaceAll(' ', '')));
    if (!compatible) {
      if (current) fail('DATABASE_SCHEMA_NOT_READY', 'Faltan columnas de la aplicación o sus tipos no coinciden. Revisa la base y ejecuta db:init antes de iniciar PostgreSQL.');
      fail('INCOMPATIBLE_EXISTING_TABLES', 'El esquema existente no es compatible con la aplicación. Revisa las columnas antes de inicializar.');
    }
    const sameColumns = (actual, expected) => Array.isArray(actual) && actual.length === expected.length &&
      [...actual].sort().join(',') === [...expected].sort().join(',');
    const normalizeExpression = (definition) => (definition || '').replace(/[\s()]/g, '').toLowerCase();
    const primaryKey = table.name === 'contrato_maquinaria' ? ['contrato_id', 'maquinaria_id'] : ['id'];
    const hasPrimaryKey = table.constraints.some((constraint) => constraint.type === 'p' &&
      sameColumns(constraint.columns, primaryKey));
    const recepcionForeignKey = table.name === 'recepcion_maquinaria' &&
      table.constraints.some((constraint) => constraint.type === 'f' && constraint.validated &&
        sameColumns(constraint.columns, ['contrato_id', 'maquinaria_id']) &&
        constraint.referenceSchema === schema && constraint.referenceTable === 'contrato_maquinaria' &&
        sameColumns(constraint.referenceColumns, ['contrato_id', 'maquinaria_id']) && constraint.onDelete === 'r');
    const foreignKeys = ['maquinaria', 'usuario'].includes(table.name) ? [] : ['sesion', 'token_recuperacion'].includes(table.name)
      ? [['usuario_id', 'usuario']] : table.name === 'contrato'
      ? [['maquinaria_id', 'maquinaria']] : table.name === 'pago' ? [['contrato_id', 'contrato']]
        : [['maquinaria_id', 'maquinaria'], ['contrato_id', 'contrato']];
    const hasForeignKeys = table.name === 'recepcion_maquinaria'
      ? recepcionForeignKey
      : foreignKeys.every(([column, referenceTable]) => table.constraints.some((constraint) =>
        constraint.type === 'f' && constraint.validated && sameColumns(constraint.columns, [column]) &&
        constraint.referenceSchema === schema && constraint.referenceTable === referenceTable &&
        sameColumns(constraint.referenceColumns, ['id'])));
    if (!hasPrimaryKey || !hasForeignKeys) {
      fail('INCOMPATIBLE_EXISTING_TABLES', 'Faltan claves primarias o relaciones esperadas en las tablas existentes. Revisa el esquema antes de continuar.');
    }
    if (['usuario', 'sesion', 'token_recuperacion'].includes(table.name)) {
      const uniqueColumn = table.name === 'usuario' ? 'correo' : 'token_hash';
      const notNull = Object.keys(CURRENT_COLUMNS[table.name]).filter(name => name !== 'usado_en').every(name =>
        table.columns.some(column => column.name === name && column.notNull));
      const unique = table.constraints.some(constraint => constraint.type === 'u' &&
        sameColumns(constraint.columns, [uniqueColumn]));
      const cascade = table.name === 'usuario' || table.constraints.some(constraint =>
        constraint.type === 'f' && sameColumns(constraint.columns, ['usuario_id']) && constraint.onDelete === 'c');
      if (!notNull || !unique || !cascade) fail('INCOMPATIBLE_EXISTING_TABLES',
        'Las tablas de autenticación requieren datos obligatorios, identificadores únicos y relaciones protegidas.');
    }
    if (table.name === 'pago') {
      const requiredNotNull = Object.keys(LEGACY_COLUMNS.pago).every((name) =>
        table.columns.some((column) => column.name === name && column.notNull));
      const positiveAmount = table.constraints.some((constraint) => constraint.type === 'c' &&
        constraint.validated && sameColumns(constraint.columns, ['monto']) &&
        /^checkmonto>0(?:::numeric)?$/.test(normalizeExpression(constraint.definition)));
      const restrictedContract = table.constraints.some((constraint) => constraint.type === 'f' &&
        constraint.validated && sameColumns(constraint.columns, ['contrato_id']) &&
        constraint.referenceSchema === schema && constraint.referenceTable === 'contrato' &&
        sameColumns(constraint.referenceColumns, ['id']) && constraint.onDelete === 'r');
      const createdTimestamp = table.columns.some((column) => column.name === 'creado_en' &&
        normalizeExpression(column.defaultValue) === 'current_timestamp');
      if (!requiredNotNull || !positiveAmount || !restrictedContract || !createdTimestamp) {
        fail('INCOMPATIBLE_EXISTING_TABLES', 'Las restricciones de pagos no coinciden con las esperadas. Revisa importes positivos, datos obligatorios, fechas y relaciones antes de continuar.');
      }
    }
    if (table.name === 'recepcion_maquinaria') {
      const requiredNotNull = Object.keys(CURRENT_COLUMNS.recepcion_maquinaria).every((name) =>
        table.columns.some((column) => column.name === name && column.notNull));
      const uniqueMachine = table.constraints.some((constraint) => constraint.type === 'u' &&
        sameColumns(constraint.columns, ['contrato_id', 'maquinaria_id']));
      const nonNegativeHours = table.constraints.some((constraint) => constraint.type === 'c' &&
        constraint.validated && sameColumns(constraint.columns, ['horometro']) &&
        /^checkhorometro>=0$/.test(normalizeExpression(constraint.definition)));
      const photoArray = table.constraints.some((constraint) => constraint.type === 'c' &&
        constraint.validated && sameColumns(constraint.columns, ['fotos']) &&
        normalizeExpression(constraint.definition).includes("jsonb_typeoffotos='array'::text"));
      const photoCount = table.constraints.some((constraint) => constraint.type === 'c' &&
        constraint.validated && sameColumns(constraint.columns, ['fotos']) &&
        normalizeExpression(constraint.definition).includes('jsonb_array_lengthfotos>=1') &&
        normalizeExpression(constraint.definition).includes('jsonb_array_lengthfotos<=5'));
      const createdTimestamp = table.columns.some((column) => column.name === 'fecha_recepcion' &&
        normalizeExpression(column.defaultValue) === 'current_timestamp');
      if (!requiredNotNull || !uniqueMachine || !nonNegativeHours || !photoArray || !photoCount || !createdTimestamp) {
        fail('INCOMPATIBLE_EXISTING_TABLES', 'Las restricciones de recepción no coinciden con las esperadas. Revisa evidencias, horómetro, unicidad, fecha y relación contractual.');
      }
    }
    if (current && !table.rlsEnabled) {
      fail('DATABASE_PRIVACY_NOT_READY', 'Falta proteger las tablas del backend. Revisa la base e inicializa de forma explícita.');
    }
  }
  if (current && existing.length !== APP_TABLES.length) {
    fail('DATABASE_SCHEMA_NOT_READY', 'Faltan tablas o columnas de la aplicación. Ejecuta la inspección y db:init antes de iniciar PostgreSQL.');
  }
  return existing;
}

/** Runtime preflight never applies migrations or seeds. */
export async function assertPostgresReady(database) {
  const inventory = await inspectPostgresDatabase(database);
  checkInventory(inventory, schemaFor(database), { current: true });
  return inventory;
}

function validateScripts(schemaSql, seedsSql) {
  if (typeof schemaSql !== 'string' || typeof seedsSql !== 'string') {
    fail('INVALID_DATABASE_SCRIPTS', 'Los scripts de esquema y semillas deben ser texto SQL revisado.');
  }
  const sql = `${schemaSql}\n${seedsSql}`.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '');
  if (/(?:^|;)\s*(?:DROP|TRUNCATE|DELETE|UPDATE|CALL|DO|GRANT|REVOKE)\b/i.test(sql) ||
      /\bON\s+CONFLICT\b[^;]*\bDO\s+UPDATE\b/i.test(sql) ||
      /\bALTER\s+TABLE\b[^;]*\b(?:DROP|RENAME|DISABLE|SET\s+SCHEMA|ALTER\s+COLUMN)\b/i.test(sql)) {
    fail('UNSAFE_DATABASE_SCRIPT', 'El script contiene operaciones que requieren revisión y autorización antes de ejecutarse.');
  }
}

/** Explicit preparation: inspect first, refuse ambiguity, retain existing rows. */
export async function initializePostgresDatabase(database, {
  schemaSql, seedsSql, existingReviewed = false,
  dataApiReviewed = process.env.SUPABASE_DATA_API_REVIEWED === 'true',
} = {}) {
  const schema = schemaFor(database);
  if (database.requiresDataApiReview !== false && !dataApiReviewed) {
    fail('DATA_API_REVIEW_REQUIRED', 'Antes de crear tablas, confirma en Supabase que el esquema privado no figura en Exposed schemas o desactiva la Data API. Después configura SUPABASE_DATA_API_REVIEWED=true.');
  }
  validateScripts(schemaSql, seedsSql);
  const verified = await database.verifyConnection();
  const privateNetwork = database.renderInternal === true && verified?.privateNetwork === true;
  if (!privateNetwork && (!verified?.tls?.encrypted || !verified.tls.authorized)) {
    fail('DATABASE_TLS_NOT_VERIFIED', 'La preparación requiere TLS verificado o la red privada interna de Render.');
  }
  const connection = { provider: 'postgresql', targetProjectVerified: verified.targetProjectVerified === true,
    databaseSchema: schema, privateNetwork,
    tls: { encrypted: verified.tls?.encrypted === true, authorized: verified.tls?.authorized === true,
      protocol: verified.tls?.encrypted === true
        ? (/^TLSv\d(?:\.\d)?$/.test(verified.tls.protocol) ? verified.tls.protocol : 'TLS') : null } };
  const before = await inspectPostgresDatabase(database);
  checkInventory(before, schema, { existingReviewed });
  return database.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`constructora-init:${schema}`]);
    const lockedInventory = await inspectPostgresDatabase({ ...tx, schema, requiresDataApiReview: database.requiresDataApiReview });
    const existing = checkInventory(lockedInventory, schema, { existingReviewed });
    const { rows: roles } = await tx.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])', [API_ROLES]);
    const grantees = ['PUBLIC', ...roles.map(({ rolname }) => quoteIdentifier(rolname))].join(', ');
    await tx.exec(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)};
      REVOKE ALL ON SCHEMA ${quoteIdentifier(schema)} FROM ${grantees};`);
    await tx.query("SELECT set_config('search_path', $1, true)", [`${quoteIdentifier(schema)}, pg_catalog`]);
    await tx.exec(schemaSql);
    for (const table of APP_TABLES) {
      await tx.exec(`ALTER TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} FROM ${grantees};`);
    }
    await tx.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdentifier(schema)}
      REVOKE ALL ON TABLES FROM ${grantees};`);
    // The advisory lock coordinates this CLI; the table lock also excludes an
    // independent SQL writer between the emptiness check and the demo inserts.
    await tx.exec(`LOCK TABLE ${quoteIdentifier(schema)}.maquinaria IN SHARE ROW EXCLUSIVE MODE`);
    const { rows } = await tx.query(`SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(schema)}.maquinaria`);
    const seeded = String(rows[0].count) === '0' && Boolean(seedsSql.trim());
    if (seeded) await tx.exec(seedsSql);
    const after = await inspectPostgresDatabase({ ...tx, schema, requiresDataApiReview: database.requiresDataApiReview });
    checkInventory(after, schema, { current: true });
    return { provider: 'postgresql', databaseSchema: schema, connection, seeded,
      createdTables: APP_TABLES.filter((name) => !existing.some((table) => table.name === name)),
      existingTables: existing.map(({ name }) => name),
      tables: after.appTables.map(({ name, rowCount }) => ({ name, rowCount })),
    };
  });
}
