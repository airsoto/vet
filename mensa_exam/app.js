const DATA_URL = "../json/synthetic_iq_1000_dataset.json";
const EXAM_LENGTH = 35;
const EXAM_SECONDS = 25 * 60;
const PASS_SCORE = 33;

const state = {
  data: null,
  exam: [],
  answers: new Array(EXAM_LENGTH).fill(null),
  current: 0,
  secondsLeft: EXAM_SECONDS,
  timer: null,
  startedAt: null,
};

const $ = (selector) => document.querySelector(selector);

const screens = {
  intro: $("#intro-screen"),
  test: $("#test-screen"),
  result: $("#result-screen"),
};

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove("active"));
  screens[name].classList.add("active");
}

function formatTime(total) {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function setStatus() {
  $("#timer").textContent = formatTime(state.secondsLeft);
  $("#answered-count").textContent = state.answers.filter((a) => a !== null).length;
  $("#current-count").textContent = Math.min(state.current + 1, EXAM_LENGTH);
  $("#progress-fill").style.width = `${((state.current + 1) / EXAM_LENGTH) * 100}%`;
}

function pickExam(questions) {
  const ranges = ["1-7", "8-14", "15-21", "22-28", "29-35"];
  const byRange = Object.fromEntries(ranges.map((range) => [range, questions.filter((q) => q.recommended_exam_position_range === range)]));
  const selected = [];
  const used = new Set();
  for (let position = 1; position <= EXAM_LENGTH; position += 1) {
    const range = ranges[Math.min(ranges.length - 1, Math.floor((position - 1) / 7))];
    const categoryOffset = position % 8;
    const pool = byRange[range]
      .filter((q) => !used.has(q.id))
      .sort((a, b) => {
        const ac = Math.abs(categoryOffset - categoryIndex(a.category));
        const bc = Math.abs(categoryOffset - categoryIndex(b.category));
        return ac - bc || Math.random() - 0.5;
      });
    const choice = pool[0] || questions.find((q) => !used.has(q.id));
    used.add(choice.id);
    selected.push(choice);
  }
  return selected;
}

function categoryIndex(category) {
  return ["matrices", "sequences", "rotations", "symmetry", "counting", "xor_overlay", "spatial_movement", "mixed_rules"].indexOf(category);
}

function svgForObjects(objects, width = 120, height = 100) {
  const content = objects.flatMap((item) => {
    const copies = item.count || 1;
    return Array.from({ length: copies }, (_, i) => drawObject(item, i, copies));
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="figura abstracta">${content}</svg>`;
}

function drawObject(item, index, total) {
  const sizeMap = { xs: 8, sm: 12, md: 17, lg: 22 };
  const radius = sizeMap[item.size] || 16;
  const x = ((item.x || 3) / 6) * 120 + offset(index, total, "x");
  const y = ((item.y || 3) / 6) * 100 + offset(index, total, "y");
  const color = item.color || "#111827";
  const fill = item.fill === "outline" ? "none" : color;
  const stroke = color;
  const sw = item.fill === "outline" ? 4 : 2;
  const transform = `rotate(${item.rotation || 0} ${x} ${y})`;
  const pattern = item.fill === "dotted" ? `<circle cx="${x - radius / 3}" cy="${y}" r="2" fill="#fff"/><circle cx="${x + radius / 3}" cy="${y}" r="2" fill="#fff"/>` : "";

  if (item.shape === "circle") return `<g transform="${transform}"><circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>${pattern}</g>`;
  if (item.shape === "square") return `<g transform="${transform}"><rect x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>${pattern}</g>`;
  if (item.shape === "triangle") return `<polygon points="${x},${y - radius} ${x - radius},${y + radius} ${x + radius},${y + radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" transform="${transform}"/>`;
  if (item.shape === "diamond") return `<polygon points="${x},${y - radius} ${x - radius},${y} ${x},${y + radius} ${x + radius},${y}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" transform="${transform}"/>`;
  if (item.shape === "pentagon") return polygon(x, y, radius, 5, fill, stroke, sw, transform);
  if (item.shape === "hexagon") return polygon(x, y, radius, 6, fill, stroke, sw, transform);
  return star(x, y, radius, fill, stroke, sw, transform);
}

function offset(index, total, axis) {
  if (total <= 1) return 0;
  const spread = Math.min(28, 8 + total * 3);
  const centered = index - (total - 1) / 2;
  return axis === "x" ? centered * spread : Math.sin(index) * 5;
}

function polygon(x, y, r, sides, fill, stroke, sw, transform) {
  const points = Array.from({ length: sides }, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
    return `${x + Math.cos(a) * r},${y + Math.sin(a) * r}`;
  }).join(" ");
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" transform="${transform}"/>`;
}

function star(x, y, r, fill, stroke, sw, transform) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / 10;
    return `${x + Math.cos(a) * rr},${y + Math.sin(a) * rr}`;
  }).join(" ");
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" transform="${transform}"/>`;
}

function renderPrompt(prompt) {
  if (prompt.type === "linear_sequence") {
    const cells = prompt.items.map((item) => renderCell(item)).join("");
    return `<div style="display:grid;grid-template-columns:repeat(${prompt.items.length},110px);gap:10px;">${cells}</div>`;
  }
  const rows = prompt.cells.length;
  const cols = prompt.cells[0].length;
  const cells = prompt.cells.flat().map((item) => renderCell(item)).join("");
  return `<div style="display:grid;grid-template-columns:repeat(${cols},110px);grid-template-rows:repeat(${rows},100px);gap:10px;">${cells}</div>`;
}

function renderCell(item) {
  if (item.missing) {
    return `<div style="display:grid;place-items:center;border:2px dashed #8d98a7;border-radius:8px;background:#fff;font-size:34px;font-weight:900;color:#8d98a7;">?</div>`;
  }
  return `<div style="display:grid;place-items:center;border:1px solid #d9dee6;border-radius:8px;background:#fff;">${svgForObjects(item.objects || [])}</div>`;
}

function renderQuestion() {
  const q = state.exam[state.current];
  $("#question-title").textContent = `Pregunta ${state.current + 1} de ${EXAM_LENGTH}`;
  $("#question-subtitle").textContent = `${label(q.category)} · dificultad ${q.difficulty}`;
  $("#tag-row").innerHTML = q.tags.slice(0, 4).map((tag) => `<span class="tag">${tag.replaceAll("_", " ")}</span>`).join("");
  $("#visual").innerHTML = renderPrompt(q.prompt);
  $("#options").innerHTML = q.answer_choices.map((option, index) => `
    <button class="option ${state.answers[state.current] === index ? "selected" : ""}" data-option="${index}" aria-label="Opción ${index + 1}">
      <span class="option-label">Opción ${index + 1}</span>
      ${svgForObjects(option.objects || [])}
    </button>
  `).join("");
  document.querySelectorAll(".option").forEach((button) => {
    button.addEventListener("click", () => {
      state.answers[state.current] = Number(button.dataset.option);
      renderQuestion();
      renderDots();
      setStatus();
    });
  });
  $("#prev").disabled = state.current === 0;
  $("#next").textContent = state.current === EXAM_LENGTH - 1 ? "Finalizar" : "Siguiente";
  setStatus();
  renderDots();
}

function label(category) {
  return {
    matrices: "Matrices",
    sequences: "Secuencias",
    rotations: "Rotaciones",
    symmetry: "Simetría",
    counting: "Conteo",
    xor_overlay: "XOR / superposición",
    spatial_movement: "Movimiento espacial",
    mixed_rules: "Reglas mixtas",
  }[category] || category;
}

function renderDots() {
  $("#question-list").innerHTML = state.exam.map((_, index) => `
    <button class="qdot ${index === state.current ? "current" : ""} ${state.answers[index] !== null ? "answered" : ""}" data-jump="${index}">${index + 1}</button>
  `).join("");
  document.querySelectorAll(".qdot").forEach((button) => {
    button.addEventListener("click", () => {
      state.current = Number(button.dataset.jump);
      renderQuestion();
    });
  });
}

function startTimer() {
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    state.secondsLeft -= 1;
    setStatus();
    if (state.secondsLeft <= 0) finishExam();
  }, 1000);
}

function startExam() {
  state.exam = pickExam(state.data.questions);
  state.answers = new Array(EXAM_LENGTH).fill(null);
  state.current = 0;
  state.secondsLeft = EXAM_SECONDS;
  state.startedAt = Date.now();
  showScreen("test");
  renderQuestion();
  startTimer();
}

function finishExam() {
  clearInterval(state.timer);
  const correct = state.exam.reduce((total, q, index) => total + (state.answers[index] === q.correct_answer_index ? 1 : 0), 0);
  const pass = correct >= PASS_SCORE;
  const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
  $("#result-image").src = pass ? "assets/mensa1.png" : "assets/mensa2.png";
  $("#result-image").alt = pass ? "Resultado apto" : "Resultado no apto";
  $("#result-title").textContent = pass ? "Eres apto para Mensa" : "No eres apto para Mensa";
  $("#result-title").className = pass ? "pass" : "fail";
  $("#score").textContent = `${correct}/${EXAM_LENGTH}`;
  $("#result-detail").textContent = `Umbral orientativo: ${PASS_SCORE} aciertos. Tiempo usado: ${formatTime(Math.min(elapsed, EXAM_SECONDS))}. Este test es una simulación de práctica, no una prueba oficial ni válida para admisión.`;
  $("#review").innerHTML = state.exam.map((q, index) => {
    const ok = state.answers[index] === q.correct_answer_index;
    return `<p><strong>${index + 1}.</strong> ${ok ? "Correcta" : "Incorrecta"} · ${q.explanation}</p>`;
  }).join("");
  showScreen("result");
}

async function init() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error("No se pudo cargar el JSON");
    state.data = await response.json();
    $("#dataset-count").textContent = state.data.questions.length;
    $("#start").disabled = false;
  } catch (error) {
    $("#load-state").textContent = "No se pudo cargar el archivo JSON. Abre la web desde un servidor local para permitir la carga del dataset.";
  }
}

$("#start").addEventListener("click", startExam);
$("#restart").addEventListener("click", startExam);
$("#again").addEventListener("click", startExam);
$("#prev").addEventListener("click", () => {
  state.current = Math.max(0, state.current - 1);
  renderQuestion();
});
$("#next").addEventListener("click", () => {
  if (state.current === EXAM_LENGTH - 1) finishExam();
  else {
    state.current += 1;
    renderQuestion();
  }
});
$("#finish").addEventListener("click", finishExam);

init();
