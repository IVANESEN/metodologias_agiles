# Sprint 3 - HU10: registro de recepción en obra con fotos

Responsable: Mariela Nicole Flores Arévalo.

## Criterios cubiertos

1. Se adjuntan entre una y cinco fotografías JPEG, PNG o WebP del estado de la maquinaria.
2. Se registra una lectura entera y no negativa del horómetro.
3. La recepción se guarda en PostgreSQL y queda vinculada a una máquina que pertenece al contrato.

## Flujo

1. Un usuario autenticado abre **Recepción** y pega el UUID del contrato.
2. La interfaz consulta el contrato y ofrece únicamente sus máquinas.
3. El usuario registra el horómetro y selecciona las fotografías. Las fotos grandes se
   optimizan en el navegador y se muestran antes de enviar.
4. `POST /api/recepciones` valida nuevamente todos los datos y persiste la recepción.
5. La sección consulta `GET /api/contratos/:id/recepciones` y muestra horómetro, fecha y evidencias.

El botón queda deshabilitado durante el envío. La interfaz conserva el UUID de la
operación cuando falla la conexión, por lo que un reintento idéntico no crea otra fila.
La base también impone una sola recepción por contrato y maquinaria.

## Seguridad y validaciones

- Permisos compartidos por residente y gerente: `recepciones.crear` y `recepciones.consultar`.
- Sesión, protección de origen y rutas exactas se aplican antes de procesar el negocio.
- UUID, IDs, horómetro, cantidad, Base64, firma binaria y tamaño se validan en backend.
- Máximo: cinco fotografías, 1 MB por fotografía optimizada, 5 MB decodificados en total.
- Las consultas SQL son parametrizadas.
- Una clave foránea compuesta hacia `contrato_maquinaria` protege la asociación.
- El esquema privado mantiene RLS y no concede acceso a los roles de Data API.

## Respuestas principales

| Situación | Respuesta |
| --- | --- |
| Creación | `201` y recepción persistida |
| Reintento idéntico | `200` y la recepción existente |
| Datos o fotografía inválidos | `400 VALIDATION_ERROR` |
| Contrato inexistente | `404 CONTRACT_NOT_FOUND` |
| Máquina ajena al contrato | `409 MACHINERY_NOT_IN_CONTRACT` |
| Recepción ya registrada | `409 RECEPTION_ALREADY_EXISTS` |
| Sin sesión o permiso | `401 UNAUTHENTICATED` / `403 FORBIDDEN` |

## Pruebas

Las pruebas usan PGlite en memoria o directorios temporales; no leen ni modifican la
base configurada en `.env` ni el directorio persistente `data/`.

```sh
node --test backend/recepciones.test.mjs backend/recepciones-frontend.test.mjs
npm test
```

Cubren persistencia de fotos y horómetro, relación contractual, formatos y límites,
consulta, duplicados, reintentos, permisos, restricciones PostgreSQL y regresión.

Resultado integrado del 22 de octubre de 2026: **174 pruebas aprobadas, 0 fallidas,
0 omitidas**. La ejecución terminó correctamente con `npm test` y utilizó únicamente
bases PGlite temporales o en memoria.

## Validación manual sugerida

Usar únicamente una base local o de pruebas:

1. Crear un contrato con una o varias máquinas y copiar su UUID.
2. Abrir `/#recepcion`, buscarlo y comprobar que aparecen solo esas máquinas.
3. Adjuntar fotos desde computadora y teléfono, retirar una vista previa y guardar.
4. Recargar las evidencias y comprobar fotos, horómetro y fecha.
5. Intentar repetir la misma máquina y verificar el mensaje de recepción existente.
6. Probar más de cinco fotos, archivo no permitido y horómetro negativo.
7. Revisar navegación con teclado, mensajes accesibles y presentación en pantalla pequeña.

Antes de desplegar sobre PostgreSQL existente se debe ejecutar primero `db:inspect` y
revisar manualmente el inventario. La preparación remota, commit y push requieren una
autorización separada; no forman parte de la implementación automática.
