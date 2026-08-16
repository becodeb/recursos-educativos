# Evaluador Seguro

Exámenes en línea para el aula, con sala de espera, arranque sincronizado y auditoría
de foco. A diferencia del resto de las apps del repositorio, esta **no es un HTML
estático**: necesita un servidor, porque los alumnos entran desde sus propios equipos
y el docente tiene que verlos llegar y recibir sus respuestas.

## Cómo se usa

**El docente** entra a `/docente`, arma un examen con el editor, y toca «Iniciar toma».
Eso genera un **código de 6 caracteres** y un link para pasarle al curso. Los alumnos
van cayendo en la sala de espera y el docente los ve aparecer en vivo. Cuando están
todos, elige el tiempo máximo y toca «Iniciar examen»: el reloj arranca para todos a
la vez. Al terminar ve las respuestas ya autocorregidas, puede cambiar cualquier
corrección a mano y consultar el registro de actividad de cada alumno.

**El alumno** entra a `/`, escribe el código (o abre el link, que ya lo trae cargado),
pone su nombre y espera. No ve ninguna pregunta hasta que el docente arranca. Cuando
entrega, la pantalla de confirmación le ofrece **ingresar a otro examen**; y si vuelve
a abrir la página más tarde, cae directo en el ingreso de código en lugar de quedar
trabado en la confirmación anterior. Salir sólo suelta la sesión del navegador: las
respuestas entregadas siguen en el servidor y el docente las sigue viendo.

## Levantarlo

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

- Alumnos: <http://localhost:8081/>
- Docente: <http://localhost:8081/docente>

Sin Docker, con Node 24 o superior:

```bash
node server/server.js
```

### Variables de entorno

| Variable           | Por defecto              | Para qué sirve                       |
| ------------------ | ------------------------ | ------------------------------------ |
| `TEACHER_PASSWORD` | `profe123`               | Clave del panel docente              |
| `PORT`             | `8080`                   | Puerto de escucha                    |
| `DB_PATH`          | `data/evaluador.db`      | Archivo SQLite con todos los datos   |

> **Antes de exponerlo fuera de la red del aula, cambiá `TEACHER_PASSWORD`.**
> Es un MVP de un solo docente; todavía no hay cuentas separadas.

## Tipos de pregunta

| Tipo               | Se autocorrige                                              |
| ------------------ | ----------------------------------------------------------- |
| Opción múltiple    | Sí                                                           |
| Varias correctas   | Sí, exige el conjunto exacto                                 |
| Verdadero / Falso  | Sí                                                           |
| Respuesta corta    | Sí, contra la lista de variantes aceptadas; ignora mayúsculas y tildes |
| Desarrollo         | No: la corrige el docente a mano                             |

La nota sale sobre 10, proporcional al puntaje. Mientras quede alguna respuesta sin
corregir, la nota aparece marcada como **provisoria**.

## Auditoría de foco

Durante el examen se registra, con hora y duración: cambio de pestaña, ventana sin
foco, F12, Ctrl+C / Ctrl+V, salida de pantalla completa y cierre de pestaña. El alumno
ve un aviso cada vez y el docente los recibe en vivo. Quedan en el informe de cada
alumno.

Vale aclarar qué **no** hace: es un disuasivo, no un candado. No detecta un segundo
dispositivo, ni una máquina virtual, ni a alguien mirando por encima del hombro.

## Identidad visual

Colores institucionales, cada uno con un rol fijo. Están definidos una sola vez, en
el `tailwind.config` de cada página; para cambiar la paleta alcanza con tocar ahí.

| Token         | Color                    | Rol                                          |
| ------------- | ------------------------ | -------------------------------------------- |
| `canvas`      | `#FFF4E5` naranja muy claro | fondo de página                           |
| `paper`       | `#FFFFFF` blanco         | tarjetas, que se despegan por sombra cálida   |
| `ink`         | `#17122B` violeta oscuro | texto principal y bloques oscuros de contraste |
| `brand`       | `#243B7A` azul           | primario estructural, botones principales     |
| `accent`      | `#FF9300` naranja        | destaques, código de la toma, sala de espera  |
| `accent-deep` | `#E4510B` naranja rojizo | rótulos sobre fondo claro                     |
| `ok`          | `#209B8A` verde azulado  | correcto, examen en curso, aprobado           |
| `alert`       | `#C52525` rojo           | incidentes, acciones peligrosas               |
| `plum`        | `#7D2048` bordó          | nota provisoria, respuesta sin corregir       |

El fondo es plano: sin grilla, sin degradados, sin textura. Las superficies se separan
con **un solo recurso, el borde de 1 px**; no hay sombras salvo un susurro en los
elementos flotantes. El color aparece únicamente donde significa algo — un estado, una
acción, un incidente — nunca como decoración. Lo oscuro quedó reservado para lo que
flota por encima de la página: modales, avisos y botones primarios.

Sobre las animaciones: las listas que el servidor reenvía enteras (la sala, la tabla
de alumnos, el editor) sólo se redibujan si algo cambió de verdad. Sin esa guarda, cada
evento del stream cortaba las animaciones de entrada y hacía parpadear la tabla. Todo
el movimiento se apaga con `prefers-reduced-motion`.

## Cómo está armado

```
server/
  server.js   API HTTP, canal SSE en vivo y archivos estáticos
  db.js       esquema SQLite
  examen.js   validación de preguntas, autocorrección y cálculo de nota
public/
  index.html  vista del alumno
  docente.html panel del docente
```

Sin dependencias de npm: usa `node:http` y `node:sqlite`, que vienen con Node 24.

Decisiones que conviene conocer antes de tocar el código:

- **El servidor manda el tiempo.** El reloj del alumno es sólo un reflejo de `ends_at`.
  Cerrar la pestaña o adelantar el reloj de la máquina no cambia nada.
- **Las respuestas correctas nunca viajan al alumno.** El navegador recibe las
  preguntas sin sus claves; la corrección ocurre siempre en el servidor.
- **Cada toma se queda con su propia copia de las preguntas.** Editar o borrar un
  examen no toca los resultados de las tomas anteriores.
- **La sesión del docente vive en memoria.** Si reiniciás el servidor, hay que volver
  a entrar; los exámenes y resultados están a salvo en SQLite.
