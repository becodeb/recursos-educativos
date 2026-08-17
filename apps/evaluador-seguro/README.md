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

## Sistema visual

Las dos pantallas comparten `public/tema.js` (paleta y tipografías de Tailwind) y
`public/estilo.css` (tokens y componentes). **Ahí se cambia todo**: no hay estilos
sueltos duplicados entre archivos, que era lo que las hacía divergir.

Colores institucionales, cada uno con un rol fijo:

| Token         | Color                     | Rol                                          |
| ------------- | ------------------------- | -------------------------------------------- |
| `canvas`      | `#D2D0D9` gris medio      | fondo de página                               |
| `paper`       | `#FFFFFF` blanco          | tarjetas                                      |
| `ink`         | `#17122B` violeta oscuro  | texto principal                               |
| `purple`      | `#4B2D68` violeta         | cabecera del panel docente, texto secundario  |
| `brand`       | `#243B7A` azul            | primario estructural, botones principales     |
| `accent`      | `#FF9300` naranja         | rellenos: puntos de estado, barra de progreso |
| `accent-deep` | `#8F3600` naranja quemado | el mismo naranja, ya legible como texto       |
| `accent-urgente` | `#E4510B` naranja rojizo | reloj a punto de vencer                     |
| `ok`          | `#209B8A` verde azulado   | rellenos de correcto / en curso               |
| `ok-ink`      | `#146356` verde oscuro    | ese verde como texto                          |
| `alert`       | `#C52525` rojo            | incidentes, acciones peligrosas               |
| `plum`        | `#7D2048` bordó           | nota provisoria, respuesta sin corregir       |

Varios colores vienen en dos tonos porque **el institucional puro no alcanza para
texto**: sobre fondo claro el naranja da 3,7:1 y el verde 2,9:1, por debajo del mínimo
legible. El tono vivo se usa para rellenos y el oscuro para letras.

El fondo es un **gris medio neutro**, con un matiz violáceo mínimo para que dialogue
con el violeta institucional en vez de chocar como gris frío puro. Sobre el naranja
claro que había antes la tarjeta blanca no se despegaba (1,09:1); contra este gris
llega a 1,53:1 y los elementos se distinguen. El naranja quedó donde rinde —acentos,
chips, el código de la toma— y no como fondo.

Reglas del sistema:

- **Nada translúcido**: ni fondos con alfa ni desenfoques. Todos los colores son lisos.
  La única excepción es el velo de los modales, que sí tiene que dejar ver el fondo.
- **Superficies**: se separan con un borde de 1 px y una sombra corta. Las sombras
  grandes quedan para lo que flota (modales, toast) y para el `hover` de lo clicable.
- **Tipografía**: escala fluida con `clamp()`, sin saltos entre breakpoints. El mono en
  versalitas quedó sólo para datos — horas, códigos, métricas — y ya no para cada
  rótulo de campo.
- **Color**: aparece donde significa algo (un estado, una acción, un incidente), nunca
  como decoración.
- **Componentes**: `.btn` con variantes y tamaños, `.card`, `.input`, `.chip`, `.stat`,
  `.opcion`, `.skel`. Todo lo que se dibuja desde JavaScript usa estas clases.
- **Responsive**: el layout cambia de forma, no sólo de tamaño. La tabla de alumnos se
  vuelve tarjeta apilada en teléfono y los modales suben como hoja desde abajo.

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
  index.html   vista del alumno
  docente.html panel del docente
  tema.js      paleta y tipografías (config de Tailwind), compartida
  estilo.css   tokens, componentes y animaciones, compartidos
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
