# Fixtures del spike (Fase 0)

Aquí se dejan los IFC con los que se valida la Fase 0. **No** se suben al
repositorio modelos pesados ni de licencia dudosa (ver NFR-10 de la
especificación).

## Ficheros necesarios

| Fixture | Uso | Estado |
|---|---|---|
| Un IFC pequeño-mediano real (vivienda/edificio completo) | Pasos 1, 3 y 4: carga, selección, sección y DXF | **Pendiente de elegir** |
| Un segundo IFC **distinto**, idealmente con `expressId` solapados | Paso 2: federación | **Pendiente de elegir** |
| Un IFC corrupto o truncado | Comprobar que un error de carga no tumba la aplicación (NFR-04) | Se puede generar |

Candidatos públicos con licencia clara y bien documentada (verificar la licencia
de cada fichero antes de redistribuirlo):

- `AC20-FZK-Haus.ifc` (IFC2X3) del corpus de pruebas de IFC-Lite / IfcOpenShell.
- Modelos Duplex y similares del mismo corpus (IFC2X3 / IFC4).
- Un modelo gallego real (con permiso y sin datos sensibles): es el que de verdad
  decide si el visor sirve para nuestro caso de uso.

## Aviso sobre `.gitignore`

El `.gitignore` actual **no** ignora `*.ifc`, así que hay que tener cuidado de no
confirmar por accidente un modelo grande en este directorio. Antes de meter
fixtures en el repositorio conviene añadir una regla del estilo:

```gitignore
*.ifc
!spike-fixtures/**/*.ifc
```

o bien documentar el tamaño máximo aceptado para los ficheros de prueba.
