# Trazabilidad de historias y evidencia de cierre

Revisión del 1 de noviembre de 2026, zona `America/El_Salvador`. La implementación actual permite comprobar comportamientos; no demuestra una aceptación histórica del Product Owner ni una prueba realizada por otra persona. Este registro conserva los estados del tablero y propone ajustes sin escribir en Google Sheets.

## Fuentes y versión examinada

- [Tablero de referencia](https://docs.google.com/spreadsheets/d/1aHvbDplsFXqzVZgihQGV05PwfuZEv1wSXmTZ4msjij0/edit?gid=1211446867#gid=1211446867), consultado en modo lectura. La copia [evidencia-tablero-20261101.json](evidencia-tablero-20261101.json) conserva rangos y valores de la hoja general y los sprints 1, 2 y 3.
- Documento proporcionado `Cambios_y_reajustes_del_sistema.docx` y solicitud del usuario. Los cortes contrastados son Sprint 2, **17 de octubre**, y Sprint 3, **24 de octubre**; coinciden con los títulos de las hojas consultadas.
- Historial Git disponible localmente y archivos versionados. Al comenzar esta tarea, `victo` apuntaba a `b8a580d`; los reajustes de esta entrega son cambios de trabajo posteriores, todavía sin commit. No se realizó merge ni despliegue.
- `refs/heads/main` local apunta a `2f9b92e`. La referencia remota conservada localmente `refs/remotes/origin/main` apunta a `ff45082` y contiene el merge PR #23 de `victo`. No se actualizó esa referencia mediante red: prueba el historial disponible, no el estado remoto en tiempo real.

Los nombres de la tabla histórica reproducen el campo **autor de Git**, sin direcciones de correo. El autor de un commit no acredita una revisión independiente ni la identidad de quien ejecutó pruebas. Las fechas Git también son metadatos declarados por los commits; no son registros externos de despliegue.

## HU5 y el corte de Sprint 2

La autoría del código y su integración en `main` tienen fechas diferentes:

| Evidencia | Fecha Git local y autor | Alcance comprobado |
| --- | --- | --- |
| `92c0b3b` | 14 oct 2026, 15:44:38 -0600; Mariela | Cambia `frontend/app.js` y `frontend/index.html` para ficha, fotos y horómetro en la rama de trabajo. |
| `6579d7a` | 14 oct 2026, 18:05:55 -0600; Mariela | Añade campos del esquema, consulta API y presentación de HU5. |
| `e60bd12`, PR #19 | **22 oct 2026, 22:10:17 -0600**; Zbouuu09 | Primer commit de la línea principal local que incorpora ambos commits anteriores. Ambos son ancestros de este merge y ninguno es ancestro de su primer padre. |
| `5af189c` → `aa8c0cc`, PR #20 | 22 oct 2026, 22:39:20 → **22:42:30 -0600**; Zbouuu09 | Corrige la preparación del esquema HU5/HU10 y la incorpora en la línea principal. |

Por tanto, el tablero registra HU5 como `DONE` en Sprint 2 y hay trabajo fechado el 14 de octubre, pero la integración comprobable en la línea principal es **posterior al corte del 17 de octubre**. La preparación corregida del esquema queda integrada después del primer merge del 22. Esto no demuestra que HU5 estuviera operativa en un ambiente compartido el 17 ni que el despliegue del 22 tuviera éxito.

La versión examinada consulta `id`, `nombre`, `horometro`, `ficha_tecnica` y `foto_url` de la misma fila de `maquinaria`. La pantalla construye cada ficha con el objeto de esa tarjeta; `frontend/ficha-tecnica.mjs` conserva explícitamente la asociación mediante `data-maquinaria-id`. Presenta **No disponible** para horómetro ausente o inválido y ficha ausente o en blanco; **0 horas** es válido. Si falta o falla la fotografía muestra **Fotografía no disponible**. No hay evidencia suficiente para acreditar que las fotos del catálogo sean actuales: deben ser confirmadas por el equipo responsable del inventario.

La nueva suite [ficha-tecnica.test.mjs](../backend/ficha-tecnica.test.mjs) prueba correspondencia DB/API y ejecuta el constructor real de la pantalla con un DOM mínimo: equipos distintos, datos ausentes, cero y evento de imagen fallida. El 1 de noviembre pasó **3/3** con `node --test --test-isolation=none backend/ficha-tecnica.test.mjs`, usando PGlite en memoria. No es una prueba de navegador, de dispositivo ni una aceptación histórica del equipo.

## HU9a y el corte de Sprint 3

| Evidencia | Fecha Git local y autor | Alcance comprobado |
| --- | --- | --- |
| `fb0387d` | **26 oct 2026, 09:52:24 -0600**; Kevin Landos | Introduce programación de entrega y transportista desde el detalle del contrato. |
| `220946d` | 26 oct 2026, 14:49:36 -0600; Kevin Landos | Documenta orden de migración, permisos y resultados declarados de pruebas. |
| `2f9b92e`, PR #22 | **26 oct 2026, 14:56:23 -0600**; Zbouuu09 | Integra HU9a en la línea principal local; `fb0387d` es ancestro de este merge. |

Estas fechas son posteriores al corte de Sprint 3 del **24 de octubre**. Las hojas general y Sprint 3 conservan `TO DO`; una propuesta de actualización debe registrar la incorporación posterior, sin presentar la historia como cerrada el 24.

La implementación y [entregas.test.mjs](../backend/entregas.test.mjs) vinculan la programación al contrato mediante `contrato_id`, comprueban fecha real entre hoy de El Salvador y fin del contrato, ventana `HH:MM` con inicio anterior al fin, transportista obligatorio, consultas de programación, reprogramación e idempotencia. [entregas-frontend.test.mjs](../backend/entregas-frontend.test.mjs) comprueba borradores y presentación del estado. HU9b usa esos datos persistidos para preparar la orden de despacho; sus pruebas actuales están en [despacho-evidencias.test.mjs](../backend/despacho-evidencias.test.mjs).

[SPRINT3_KEVIN.md](../SPRINT3_KEVIN.md) declara 207 pruebas y comprobaciones manuales externas del 26 de octubre, y reconoce que estas últimas no son reproducibles desde el repositorio. Se conserva ese documento original. Aquí sus resultados se consideran **declarados**, sin atribuirlos a una segunda persona ni convertirlos en prueba verificable de Supabase, ambiente compartido, revisión independiente o entrega de HU9b. El envío de recuperación de contraseña de HU1b no prueba la notificación de despacho.

## Registro de las 14 historias

La columna de criterios resume los criterios originales del tablero y los vincula a pruebas reproducibles de la versión de trabajo. La presencia de una suite acredita cobertura escrita; los resultados efectivos de su ejecución global se registran en [REAJUSTES_20261101.md](REAJUSTES_20261101.md). **Implementado**, **verificado técnicamente** y **aceptado por el equipo** son estados diferentes.

| Historia y sprint del tablero | Estado original | Criterios y evidencia técnica actual | Versión histórica y autor de Git | Integración en la línea principal local |
| --- | --- | --- | --- | --- |
| HU3, Sprint 1 | DONE | Filtros tipo/fechas/ubicación y fin ≥ inicio: `app.test.mjs`; elegibilidad y ocupación: `alquiler-reglas.test.mjs`. | `134bd8c`, 8 oct 18:08:13; José Mario Sandoval. | `597d6ab`, 8 oct 18:20:12; jose-mario-sandoval. |
| HU8, Sprint 1 | Done | Bloqueo, solapamientos inclusivos y simultaneidad: `reservas.test.mjs`, `app.test.mjs`, `alquiler-reglas.test.mjs`; ahora entrega completada conserva renta. | `9a2dc34`, 9 oct 17:28:45; Mariela. | `5b09de6`, 9 oct 17:49:18; Zbouuu09. Reajustes actuales aún sin integrar. |
| HU6a, Sprint 1 | Done | Guardar cliente/equipos/fechas/operador/condiciones, obligatorios y recuperación por ID: `contrato-formal.test.mjs`, `app.test.mjs`; elegibilidad transaccional en `alquiler-reglas.test.mjs`. | `bc97462`, 9 oct 18:20:04; IVANESEN. | `cfc1b37`, 9 oct 18:25:28; IVANESEN. Reajustes actuales aún sin integrar. |
| HU6b, Sprint 1 | Done | PDF legible, datos DB/API/PDF, nombres admitidos e ID ausente: `contrato-pdf.test.mjs`. Restricción de caracteres explícita antes de guardar; incompatibles históricos producen error controlado. | `7694a0a`, 9 oct 19:13:01; Kevin Landos. | `fc416be`, 9 oct 19:27:08; Zbouuu09. Corrección H11 actual sin integrar. |
| HU7, Sprint 1 | done | Firma persistida y vinculada, lienzo vacío, idempotencia y reinicio: `contrato-firma.test.mjs`. | `367b8f6`, 9 oct 20:12:12; autor Git `=` (identidad personal No verificable). | `21ed999`, 9 oct 20:16:27; marieflo1010-blip. |
| HU5, Sprint 2 | DONE | Fotos/horómetro/ficha, datos ausentes y correspondencia equipo: `ficha-tecnica.test.mjs` 3/3 el 1 nov; actualidad de las fotos No verificable. | `92c0b3b` y `6579d7a`, 14 oct; Mariela. | `e60bd12`, 22 oct 22:10:17; Zbouuu09; corrección esquema `aa8c0cc`, 22 oct 22:42:30. Posterior al corte. |
| HU4a, Sprint 2 | DONE | Umbral N, exclusión fuera de rango y siguiente consulta tras cambios: `contratos-por-vencer.test.mjs`. | `13aa540`, 15 oct 00:05:43; Kevin Landos. | `22e3594`, 17 oct 06:56:58; Zbouuu09. |
| HU4b, Sprint 2 | DONE | Pendientes, exclusión de pagados, saldo tras pago: `cobros.test.mjs`, `cobros-frontend.test.mjs`. | `4c90f06`, 15 oct 15:15:15; autor Git `=` (identidad personal No verificable). | `33017d8`, 15 oct 15:15:27; autor Git `=`. |
| HU1a, Sprint 2 | DONE | Credenciales válidas, rechazo genérico, sesión y acceso protegido: `auth.test.mjs`, `login.test.mjs`. | `b740205`, 17 oct 09:18:19; Zbouuu09. | `f3656c0`, 17 oct 16:22:24; Zbouuu09. |
| HU1b, Sprint 2 | DONE | Enlace, cambio de clave, token de un uso y respuesta genérica: `recuperacion.test.mjs`, `mailer.test.mjs`. Entrega histórica de correo real No verificable. | `2821acf`, 17 oct 09:30:54; Zbouuu09. | `ed478d5`, 17 oct 17:34:53; Zbouuu09. |
| HU2, Sprint 3 | TO DO | Vistas/acciones por rol y rechazo API directo: `permisos.test.mjs`, `permisos-frontend.test.mjs`. | `04d2f37`, 22 oct 15:42:16; autor Git `=`; complemento `b8a580d`, 26 oct 17:21:05, autor Git `=`. | Base `d22aff2`, 22 oct 15:44:46, jose-mario-sandoval. Complemento no es ancestro de `main` local `2f9b92e`, sí de `origin/main` conservado localmente `ff45082`, 26 oct 18:22:51, Zbouuu09. |
| HU10, Sprint 3 | TO DO | Fotos, horómetro, contrato/equipo: `recepciones.test.mjs`, `recepciones-frontend.test.mjs`; daños/límites: `imagenes.test.mjs`; corrección autorizada e historial: `despacho-evidencias.test.mjs`. | `6c72360`, 22 oct 21:45:52; marieflo1010-blip, cambios ya presentes en la línea principal. | `6c72360`, 22 oct 21:45:52, y preparación corregida `aa8c0cc` 22 oct. Corrección H01 actual sin integrar. |
| HU9a, Sprint 3 | TO DO | Fecha, franja, transportista, validación y consulta: `entregas.test.mjs`, `entregas-frontend.test.mjs`; relación HU9b en `despacho-evidencias.test.mjs`. | `fb0387d`, 26 oct 09:52:24; Kevin Landos. | `2f9b92e`, 26 oct 14:56:23; Zbouuu09. Posterior al corte. |
| HU9b, Sprint 3 | TO DO | Orden desde programación real, fallos y reintento sin duplicación: `despacho-evidencias.test.mjs` en entorno simulado. Canal/destino operativo y entrega real pendientes de decisión/configuración del equipo. | Cambios de trabajo actuales sobre `b8a580d`, 1 nov; agente Codex en esta sesión, sin commit. Fecha/autoría de una implementación histórica No verificable. | Reajuste actual sin commit, sin integración en `main` y sin despliegue. |

Todas las fechas de la tabla son de 2026 y usan `-0600`. Los merges anteriores se localizaron en `git log --first-parent main`; las relaciones entre commit de origen y merge se comprobaron con `git merge-base --is-ancestor`. Se conserva el texto `Done`/`done` del sprint de origen; la hoja general lo normaliza a `DONE`.

## Evidencia de aceptación y cierre pendiente

Para cada celda **No verificable** faltan persona, fecha, versión y artefacto que permitan corroborar ese acto. No deben rellenarse con el autor Git, el responsable del tablero ni el ejecutor automatizado actual. La evidencia de integración de la tabla anterior cubre solamente la dimensión Git; un merge no acredita aprobación ni un CI aprobado.

| Historia | Aceptación Product Owner | Prueba por otra persona | Ambiente compartido operativo | Revisión independiente |
| --- | --- | --- | --- | --- |
| HU3 | No verificable | No verificable | No verificable | No verificable |
| HU8 | No verificable | No verificable | No verificable | No verificable |
| HU6a | No verificable | No verificable | No verificable | No verificable |
| HU6b | No verificable | No verificable | No verificable | No verificable |
| HU7 | No verificable | No verificable | No verificable | No verificable |
| HU5 | No verificable | No verificable | No verificable | No verificable |
| HU4a | No verificable | No verificable | No verificable | No verificable |
| HU4b | No verificable | No verificable | No verificable | No verificable |
| HU1a | No verificable | No verificable | No verificable | No verificable |
| HU1b | No verificable | No verificable | No verificable | No verificable |
| HU2 | No verificable | No verificable | No verificable | No verificable |
| HU10 | No verificable | No verificable | No verificable | No verificable |
| HU9a | No verificable | No verificable | No verificable | No verificable |
| HU9b | No verificable | No verificable | No verificable | No verificable |

Para completar una dimensión, añadir un registro con `historia`, `criterio o acto`, `persona y rol`, `fecha y zona`, `commit o versión`, `ambiente`, `resultado` y `enlace al artefacto`. El equipo deberá aportar aceptación expresa del PO; ejecución por un compañero identificado con datos de prueba; URL y versión de ambiente compartido con comprobación de funcionamiento; y revisión independiente identificada. Registrar la integración de los reajustes solo después de que exista su commit y merge autorizado. Mantener separados los resultados actuales de cualquier evidencia histórica recuperada.

## Propuestas de ajuste del tablero

1. **HU5:** conservar el `DONE` histórico y añadir una observación de trazabilidad: código en rama el 14 oct, integración en `main` el 22 oct tras corte del Sprint 2 y corrección de preparación del esquema a las 22:42. Solicitar evidencia del cierre original y confirmar actualidad/correspondencia de las fotos en inventario.
2. **HU9a:** anotar incorporación el 26 oct después de corte del Sprint 3; vincular `fb0387d`, PR #22 y suites actuales. El PO debe decidir el estado tras revisar criterios y ambiente, sin cambiar retroactivamente el corte.
3. **HU2 y HU10:** registrar la discrepancia entre `TO DO` y código integrado; pedir revisión de criterios y evidencias faltantes antes de proponer cierre. Para HU2 distinguir complemento del 26 y la antigüedad de la referencia `main` local.
4. **HU9b:** registrar integración simulada actual, canal y destino aún pendientes, y pruebas de fallos/reintentos. Completar una prueba acordada de recepción real antes de afirmar funcionamiento en el canal operativo.
5. **Las 14 historias:** vincular esta matriz y completar las cuatro dimensiones de aceptación pendientes con sus artefactos. No sustituir esas dimensiones por el estado del tablero o por la ejecución automatizada del 1 de noviembre.

No se alteró ningún registro del tablero ni los documentos originales de sprints.

## Reproducción de la investigación histórica

```powershell
git log --first-parent main --format='%h %ad %an %s' --date=iso
git show --no-patch --format=fuller 92c0b3b 6579d7a e60bd12 5af189c aa8c0cc fb0387d 2f9b92e
git merge-base --is-ancestor 92c0b3b e60bd12
git merge-base --is-ancestor 6579d7a e60bd12
git merge-base --is-ancestor 92c0b3b 'e60bd12^1'
git merge-base --is-ancestor 6579d7a 'e60bd12^1'
git merge-base --is-ancestor 5af189c aa8c0cc
git merge-base --is-ancestor fb0387d 2f9b92e
git merge-base --is-ancestor b8a580d main
git merge-base --is-ancestor b8a580d origin/main
node --test --test-isolation=none backend/ficha-tecnica.test.mjs
```

`merge-base --is-ancestor` devolvió 0 para relaciones presentes, y 1 para los dos primeros padres sin HU5 y para `b8a580d → main` local. El estado 1 en esos tres casos es el resultado esperado de la investigación, no una prueba funcional fallida.
