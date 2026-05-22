# Stem Player — Lógica de reproducción

## Estados por stem

| Estado | Tipo | Descripción |
|---|---|---|
| `active` | `Record<string, boolean>` | Stem habilitado (▶ verde) o deshabilitado (▶ blanco) |
| `solo` | `Record<string, boolean>` | Stem en solo (máximo 1 a la vez) |

## Estado global

| Estado | Tipo | Descripción |
|---|---|---|
| `masterPlaying` | `boolean` | Master reproduciendo o detenido |
| `masterVolume` | `number` | Volumen global (0–1) |

## Volumen final por stem

```
si !masterPlaying             → 0
si !active[key]               → 0
si hay algún solo y !solo[key] → 0
si no                          → masterVolume
```

## Comportamiento

### 1. Estado inicial
- `masterPlaying = false`
- `active = {}` (ningún stem activo)
- `solo = {}` (ningún solo)

### 2. Master Play
- Si `masterPlaying = false`:
  - `active = { todos: true }`
  - Inicia reproducción en todos los `<audio>`
  - `masterPlaying = true`
- Si `masterPlaying = true`:
  - `active = {}` (todos desactivados)
  - Detiene todos los `<audio>`
  - `masterPlaying = false`

### 3. Click en stem individual (▶)
- Si `masterPlaying = false`:
  - Si el stem estaba inactivo: `active = { key: true }` (solo este), inicia reproducción
  - Si el stem estaba activo: nada (no tiene sentido apagar el único que iba a sonar)
- Si `masterPlaying = true`:
  - Si el stem estaba inactivo: `active[key] = true` (se suma a la reproducción)
  - Si el stem estaba activo: `active[key] = false` (se silencia, los demás siguen)

### 4. Solo (S)
- Al hacer clic en S de un stem:
  - Si ese stem ya está en solo: `solo = {}` (quita solo)
  - Si otro stem estaba en solo: `solo = { key: true }` (mueve el solo)
  - Si ningún stem estaba en solo: `solo = { key: true }` (activa solo)
- **Efecto**: Solo se escucha el stem con solo, el resto se silencia (volumen 0) aunque estén activos.
- `active` no se modifica. Al quitar solo, los stems activos vuelven a sonar.

### 5. Mute (M)
- **Eliminado**. Es redundante porque desactivar un stem (▶) ya hace eso. Si se necesita silencio temporal sin cambiar el estado activo, se usa solo en otra pista o se baja el volumen.

## Diagrama de flujo

```
[Estado inicial: master detenido, todos inactivos]

   │
   ├─ Click Master Play ─────────────────────► active = todos, master play
   │
   ├─ Click stem A (inactivo) ───────────────► active = {A}, master play
   │
   └─ Click stem A (activo) ─────────────────► nada (ya está detenido)

[Estado: master reproduciendo, active = {A}]

   │
   ├─ Click Master Stop ─────────────────────► active = {}, master stop
   │
   ├─ Click stem B (inactivo) ───────────────► active = {A, B}
   │
   ├─ Click stem A (activo) ─────────────────► active = {B}
   │
   └─ Click S en stem A ─────────────────────► solo = {A}, solo se oye A

[Estado: master reproduciendo, active = {A, B}, solo = {A}]

   │
   ├─ Click S en A (quitar solo) ────────────► solo = {}, suenan A y B
   │
   ├─ Click S en B ──────────────────────────► solo = {B}, solo se oye B
   │
   └─ Click Master Stop ─────────────────────► active = {}, solo = {}, master stop

[Estado: master reproduciendo, active = {A}, master stop]

   │
   └─ Click Master Play ─────────────────────► active = {A, B, C, D, ...}, master play
```
