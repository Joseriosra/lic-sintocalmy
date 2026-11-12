# LIC Sintocalmy (Farmoquímica del Pacífico)

Live Interactive Case (Node.js + Socket.IO) para médicos: video introductorio, caso ficticio (Marcela, cuidadora) y 5 preguntas basadas únicamente en la presentación «Sintocalmy — Jornada Científica Hospital Militar». Contenido en `content.json`.

- Moderador (pantalla proyectada): `/moderador.html?key=CLAVE` (teclas ← → o espacio para avanzar)
- Participantes (QR): `/participante.html`
- Variables: `MOD_KEY` (clave del moderador), `PUBLIC_URL` (opcional), `PORT`. `npm install && npm start`.

Video introductorio: si existe `public/media/intro.mp4` se reproduce ese archivo; si no, corre una secuencia animada de 4 escenas (≈ 80 s) con la locución como subtítulos. Para cambiar el video basta subir ese archivo.

Diseño: colores y logo de Farmoquímica del Pacífico tomados de la presentación (verde #0B4F45 / #0E7C68, naranja del logo #F5701F, tipografía Nunito). Imágenes en `public/img/`.

Pendiente antes de usar: registro ISP N-624 / N-625 (aparece entre corchetes en la presentación), código de referencia, farmacovigilancia, esquema 300 mg día / 600 mg noche vs. registro, referencia Campos 2025, texto de la lámina 4 (origen de la planta) y revisión médico-legal (campos [PENDIENTE]).
