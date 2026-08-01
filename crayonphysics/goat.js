(() => {
  'use strict';

  const STYLE_ID = 'crayon-physics-toolbar-ui';
  const icons = {
    draw: '<svg viewBox="0 0 48 48"><path d="M7 37c8-23 13 12 22-10 5-13 8 4 13-8"/><path d="m31 8 9 9-20 20-11 2 2-11Z"/><path d="m28 11 9 9" opacity=".5"/></svg>',
    pivot: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="5"/><path d="M24 3v10m0 22v10M3 24h10m22 0h10"/></svg>',
    rope: '<svg viewBox="0 0 48 48"><circle cx="8" cy="12" r="4"/><circle cx="40" cy="36" r="4"/><path d="M11 15c11-2 7 18 18 17 6-.5 5-9 9-9"/><path d="M14 18c7 2 4 11 11 12" opacity=".45"/></svg>',
    erase: '<svg viewBox="0 0 48 48"><path d="m8 31 17-20a5 5 0 0 1 7 0l7 7a5 5 0 0 1 0 7L24 40H13l-6-6a4 4 0 0 1 1-3Z"/><path d="m19 18 14 14M23 40h18"/></svg>',
    undo: '<svg viewBox="0 0 48 48"><path d="M18 11 7 21l11 10"/><path d="M8 21h18c10 0 16 5 16 15"/></svg>',
    redo: '<svg viewBox="0 0 48 48"><path d="m30 11 11 10-11 10"/><path d="M40 21H22C12 21 6 26 6 36"/></svg>',
    restart: '<svg viewBox="0 0 48 48"><path d="M37 14A18 18 0 1 0 41 32"/><path d="M37 5v12H25"/></svg>',
    hint: '<svg viewBox="0 0 48 48"><path d="M15 19a9 9 0 1 1 14 7c-3 2-5 4-5 8"/><path d="M24 41h.01"/></svg>'
  };

  const controls = [
    ['[data-tool="draw"]', 'draw', 'Dibujar', 'Dibujar objeto inteligente'],
    ['[data-tool="pivot"]', 'pivot', 'Pivote', 'Pivote'],
    ['[data-tool="rope"]', 'rope', 'Cuerda', 'Cuerda'],
    ['[data-tool="erase"]', 'erase', 'Borrar', 'Borrador'],
    ['#undoBtn', 'undo', 'Deshacer', 'Deshacer'],
    ['#redoBtn', 'redo', 'Rehacer', 'Rehacer'],
    ['#restartBtn', 'restart', 'Reiniciar', 'Reiniciar nivel'],
    ['#hintBtn', 'hint', 'Pista', 'Pista']
  ];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .game-toolbar{min-height:96px!important;padding:10px 12px calc(10px + var(--safe-bottom))!important;gap:11px!important;overscroll-behavior-x:contain;scroll-snap-type:x proximity;scroll-padding-inline:12px;-webkit-overflow-scrolling:touch;background-image:repeating-linear-gradient(-4deg,rgba(45,95,134,.025) 0 2px,transparent 2px 7px)!important}
      .tool-btn{flex:0 0 82px!important;width:82px;height:76px!important;padding:6px 5px!important;border:3px solid currentColor!important;border-radius:45% 55% 48% 52%/56% 43% 57% 44%!important;box-shadow:2px 4px 0 rgba(36,51,66,.14),inset 0 0 0 2px rgba(255,255,255,.18)!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important;scroll-snap-align:center;transform:rotate(-.35deg)}
      .tool-btn:nth-child(even){transform:rotate(.35deg)}.tool-btn:active{transform:translateY(2px) rotate(0)}
      .tool-icon{width:42px;height:42px;display:grid;place-items:center;pointer-events:none}.tool-icon svg{width:39px;height:39px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
      .tool-label{font-family:"Comic Sans MS","Bradley Hand","Segoe Print",cursive;font-size:.72rem!important;line-height:1;font-weight:900;white-space:nowrap;pointer-events:none}.tool-btn.tool-action{color:var(--orange)}.tool-btn.active{color:#fff!important;background:var(--blue)!important}
      @media(max-width:420px){.game-toolbar{min-height:89px!important;padding-inline:8px!important;gap:8px!important}.tool-btn{flex-basis:72px!important;width:72px;height:69px!important}.tool-icon{width:36px;height:36px}.tool-icon svg{width:34px;height:34px}.tool-label{font-size:.65rem!important}}
      @media(orientation:landscape) and (max-height:520px){.game-toolbar{width:84px!important;padding:8px calc(8px + var(--safe-right)) calc(8px + var(--safe-bottom)) 8px!important;gap:8px!important;scroll-snap-type:y proximity}.game-stage{margin-right:84px!important}.sandbox-bar{right:94px!important}.tool-btn{width:66px!important;height:62px!important;min-height:62px!important;flex-basis:62px!important}.tool-icon{width:40px;height:40px}.tool-icon svg{width:37px;height:37px}.tool-label{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function syncPressed(toolbar) {
    toolbar.querySelectorAll('.tool-btn[data-tool]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    });
  }

  function enhanceToolbar() {
    const toolbar = document.querySelector('.game-toolbar');
    if (!toolbar) return;
    toolbar.setAttribute('aria-label', 'Herramientas de CRAYON PHYSICS');
    controls.forEach(([selector, key, label, aria], index) => {
      const button = toolbar.querySelector(selector);
      if (!button) return;
      button.setAttribute('aria-label', aria);
      button.title = aria;
      button.innerHTML = `<span class="tool-icon" aria-hidden="true">${icons[key]}</span><span class="tool-label">${label}</span>`;
      button.classList.toggle('tool-action', index >= 4);
      if (button.dataset.tool) button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    });
    toolbar.addEventListener('click', () => requestAnimationFrame(() => syncPressed(toolbar)));
    const observer = new MutationObserver(() => syncPressed(toolbar));
    toolbar.querySelectorAll('.tool-btn[data-tool]').forEach((button) => observer.observe(button, { attributes: true, attributeFilter: ['class'] }));
  }

  function normaliseInterface() {
    document.title = 'CRAYON PHYSICS — Dibuja y resuelve';
    const title = document.querySelector('.hero h1');
    if (title) title.innerHTML = 'CRAYON<br>PHYSICS';
    const creditTitle = document.querySelector('#creditsScreen .credits-content h2');
    if (creditTitle) creditTitle.textContent = 'CRAYON PHYSICS';
    document.querySelector('[data-tool="shape"]')?.remove();
    document.querySelector('[data-tool="wheel"]')?.remove();
    document.querySelector('.ink-wrap')?.remove();
    document.querySelector('#editorInk')?.closest('.field')?.remove();
    const legend = document.querySelector('#helpScreen .tool-legend');
    if (legend) {
      [...legend.children].forEach((item) => {
        if (/Trazo|Forma|Rueda/.test(item.textContent || '')) item.remove();
      });
      if (!legend.querySelector('[data-smart-pencil]')) {
        const item = document.createElement('div');
        item.dataset.smartPencil = 'true';
        item.innerHTML = '<strong>✎ Dibujar</strong><br>Reconoce vigas, trazos libres, cuerpos cerrados y ruedas. La masa depende del tamaño.';
        legend.prepend(item);
      }
    }
  }

  function installPhysicsCompatibility(app) {
    const M = window.Matter;
    const physics = app.physics;
    if (!M || !physics || physics.maxFrameSteps) return;

    physics.engine.positionIterations = 18;
    physics.engine.velocityIterations = 14;
    physics.engine.constraintIterations = 12;
    physics.engine.gravity.scale = 9.81 * 100 / 1e6;
    physics.fixedDelta = 1000 / 180;
    physics.maxFrameSteps = 8;
    physics.maxMicroSteps = 5;
    physics.maxUserBodies = 20;
    Object.assign(physics.materials.platform, { friction: .78, frictionStatic: 1.18, restitution: .008, slop: .02 });
    Object.assign(physics.materials.ball, { friction: .34, frictionStatic: .82, frictionAir: .00022, restitution: .085, slop: .022, density: .0019 });
    Object.assign(physics.materials.block, { friction: .58, frictionStatic: .96, frictionAir: .00018, restitution: .035, slop: .028, density: .00165 });
    Object.assign(physics.materials.wheel, { friction: .78, frictionStatic: 1.28, frictionAir: .00014, restitution: .04, slop: .022, density: .00155 });
    Object.assign(physics.materials.stroke, { friction: .7, frictionStatic: 1.12, frictionAir: .00016, restitution: .02, slop: .024, density: .00155 });
    Object.assign(physics.materials.shape, { friction: .66, frictionStatic: 1.04, frictionAir: .00017, restitution: .025, slop: .028, density: .0017 });

    physics.pathLength = function(points) { let total = 0; for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]); return total; };
    physics.resamplePath = function(points, spacing = 5) {
      if (points.length < 2) return points.slice();
      const out = [{ ...points[0] }]; let carry = 0; let previous = { ...points[0] };
      for (let i = 1; i < points.length; i += 1) {
        const target = points[i]; let dx = target.x - previous.x; let dy = target.y - previous.y; let segment = Math.hypot(dx, dy);
        if (segment < .001) continue;
        while (carry + segment >= spacing) {
          const t = (spacing - carry) / segment;
          previous = { x: previous.x + dx * t, y: previous.y + dy * t };
          out.push(previous); dx = target.x - previous.x; dy = target.y - previous.y; segment = Math.hypot(dx, dy); carry = 0;
        }
        carry += segment; previous = { ...target };
      }
      if (distance(out[out.length - 1], points[points.length - 1]) > 1) out.push({ ...points[points.length - 1] });
      return out;
    };
    physics.smoothPath = function(points, closed = false, passes = 1) {
      let out = points.map((point) => ({ ...point }));
      for (let pass = 0; pass < passes; pass += 1) {
        if (out.length < 3) break;
        const next = []; if (!closed) next.push(out[0]); const count = closed ? out.length : out.length - 1;
        for (let i = 0; i < count; i += 1) {
          const a = out[i], b = out[(i + 1) % out.length];
          next.push({ x: a.x * .72 + b.x * .28, y: a.y * .72 + b.y * .28 });
          next.push({ x: a.x * .28 + b.x * .72, y: a.y * .28 + b.y * .72 });
        }
        if (!closed) next.push(out[out.length - 1]); out = next;
      }
      return out;
    };
    physics.polygonArea = function(points) { let area = 0; for (let i = 0, j = points.length - 1; i < points.length; j = i++) area += points[j].x * points[i].y - points[i].x * points[j].y; return area / 2; };
    physics.solidBodies = function(exclude = null) { return [...this.bodies.values()].filter((b) => b !== exclude && !b.isSensor && b.label !== 'bound').concat(this.boundBodies.filter((b) => b !== exclude)); };
    physics.userBodies = function() { return [...this.bodies.values()].filter((b) => b.plugin?.visual?.user); };
    physics.separateFromSolids = function(body, maxPasses = 8) {
      if (!body || body.isStatic || body.isSensor) return true;
      const solids = this.solidBodies(body);
      for (let pass = 0; pass < maxPasses; pass += 1) {
        const hits = M.Query.collides(body, solids).filter((collision) => collision.depth > .08);
        if (!hits.length) break;
        const collision = hits.reduce((best, item) => !best || item.depth > best.depth ? item : best, null);
        const isA = collision.bodyA === body || collision.bodyA?.parent === body;
        const normal = isA ? M.Vector.neg(collision.normal) : collision.normal;
        M.Body.translate(body, M.Vector.mult(normal, collision.depth + .45));
      }
      M.Body.setVelocity(body, { x: 0, y: 0 }); M.Body.setAngularVelocity(body, 0); return true;
    };

    physics.addBody = function(body, visual = {}) {
      body.plugin = body.plugin || {}; body.plugin.visual = visual; body.plugin.uid = visual.uid || `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
      this.bodies.set(body.plugin.uid, body); M.World.add(this.world, body); if (!body.isStatic && !body.isSensor) this.separateFromSolids(body); return body;
    };

    physics.createStroke = function(points, { user = true, color = '#4e8b68', ink = 0, closed = false } = {}) {
      if (points.length < 2) return null;
      const sampled = this.resamplePath(points, 4.5), smooth = this.smoothPath(sampled, closed, 1); let simplified = this.simplify(smooth, closed ? 3.2 : 3.6);
      if (simplified.length < 2) return null;
      if (closed) {
        if (distance(simplified[0], simplified[simplified.length - 1]) < 45) simplified = simplified.slice(0, -1);
        if (simplified.length < 3) return null;
        let vertices = simplified.map((point) => ({ x: point.x, y: point.y }));
        if (!M.Vertices.isConvex(vertices) || Math.abs(this.polygonArea(vertices)) < 300) vertices = M.Vertices.hull(vertices);
        if (vertices.length < 3 || Math.abs(this.polygonArea(vertices)) < 300) return null;
        try {
          const centre = M.Vertices.centre(vertices), body = M.Bodies.fromVertices(centre.x, centre.y, [vertices], { label: user ? 'user' : 'shape' }, true, .01, 10, .01);
          if (!body) return null;
          this.applyMaterial(body, { ...this.materials.shape, name: 'shape', sleepThreshold: 115 });
          M.Body.setMass(body, clamp(Math.abs(this.polygonArea(vertices)) * this.materials.shape.density, .7, 34));
          const local = body.vertices.map((vertex) => M.Vector.sub(vertex, body.position));
          return this.addBody(body, { type: 'shape', color, user, ink, points: local, thickness: 14 });
        } catch (error) { return null; }
      }
      const fullLength = this.pathLength(simplified); if (fullLength < 14) return null;
      if (distance(simplified[0], simplified[simplified.length - 1]) / Math.max(1, fullLength) > .965) simplified = [simplified[0], simplified[simplified.length - 1]];
      const thickness = 15, radius = thickness / 2, parts = [];
      for (let i = 1; i < simplified.length; i += 1) {
        const a = simplified[i - 1], b = simplified[i], length = distance(a, b); if (length < 6) continue;
        parts.push(M.Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, length + radius * 1.25, thickness, { angle: Math.atan2(b.y - a.y, b.x - a.x), chamfer: { radius: radius * .76 } }));
      }
      simplified.forEach((point, index) => {
        let add = index === 0 || index === simplified.length - 1;
        if (!add) {
          const u = M.Vector.normalise(M.Vector.sub(simplified[index], simplified[index - 1])), v = M.Vector.normalise(M.Vector.sub(simplified[index + 1], simplified[index]));
          add = M.Vector.dot(u, v) < .94;
        }
        if (add) parts.push(M.Bodies.circle(point.x, point.y, radius * .96));
      });
      if (!parts.length) return null;
      const body = M.Body.create({ parts, label: user ? 'user' : 'stroke' });
      this.applyMaterial(body, { ...this.materials.stroke, name: 'stroke', sleepThreshold: 115 });
      M.Body.setMass(body, clamp(this.pathLength(simplified) * thickness * this.materials.stroke.density + Math.PI * radius * radius * this.materials.stroke.density, .65, 32));
      return this.addBody(body, { type: 'stroke', color, user, ink, points: simplified.map((point) => M.Vector.sub(point, body.position)), thickness });
    };

    physics.attachPivot = function(body, pivot, user = true) {
      const local = M.Vector.rotate(M.Vector.sub(pivot, body.position), -body.angle);
      const constraint = M.Constraint.create({ bodyA: body, pointA: local, pointB: { x: pivot.x, y: pivot.y }, stiffness: 1, damping: .16, length: 0, angularStiffness: 0 });
      constraint.plugin = { uid: `${Math.random()}`, kind: 'pivot', user, pivot: { x: pivot.x, y: pivot.y }, bodyUid: body.plugin.uid };
      M.World.add(this.world, constraint); (user ? this.userConstraints : this.staticConstraints).push(constraint); pivot.used = true; M.Sleeping.set(body, false); return constraint;
    };
    physics.addRope = function(a, b, user = true) {
      const ea = this.endpointAt(a), eb = this.endpointAt(b), restLength = Math.max(8, distance(a, b));
      const options = { stiffness: 0, damping: .12, length: restLength, angularStiffness: 0 };
      if (ea.body) { options.bodyA = ea.body; options.pointA = ea.point; } else options.pointA = a;
      if (eb.body) { options.bodyB = eb.body; options.pointB = eb.point; } else options.pointB = b;
      const constraint = M.Constraint.create(options);
      constraint.plugin = { uid: `${Math.random()}`, kind: 'rope', user, restLength, aUid: ea.body?.plugin.uid || null, bUid: eb.body?.plugin.uid || null, aPoint: ea.point, bPoint: eb.point, aWorld: ea.body ? null : a, bWorld: eb.body ? null : b };
      M.World.add(this.world, constraint); (user ? this.userConstraints : this.staticConstraints).push(constraint); return constraint;
    };
    physics.constraintWorldPoint = function(c, side) { const body = side === 'A' ? c.bodyA : c.bodyB, point = side === 'A' ? c.pointA : c.pointB; return body ? M.Vector.add(body.position, M.Vector.rotate(point || { x: 0, y: 0 }, body.angle)) : point; };
    physics.updateRopeTension = function() {
      for (const constraint of [...this.staticConstraints, ...this.userConstraints]) {
        if (constraint.plugin?.kind !== 'rope') continue;
        const a = this.constraintWorldPoint(constraint, 'A'), b = this.constraintWorldPoint(constraint, 'B'); if (!a || !b) continue;
        const rest = constraint.plugin.restLength || constraint.length || distance(a, b), stretch = distance(a, b) - rest; constraint.length = rest;
        if (stretch > 0) { constraint.stiffness = clamp(.82 + stretch / Math.max(20, rest) * .12, .82, .96); constraint.damping = .14; } else { constraint.stiffness = 0; constraint.damping = 0; }
      }
    };
    physics.maximumDynamicSpeed = function() { let max = 0; for (const body of this.bodies.values()) if (!body.isStatic && !body.isSensor) max = Math.max(max, M.Vector.magnitude(body.velocity)); return max; };
    physics.stabiliseDynamics = function() {
      for (const body of this.bodies.values()) {
        if (body.isStatic || body.isSensor) continue;
        const speed = M.Vector.magnitude(body.velocity); if (speed > 90) M.Body.setVelocity(body, M.Vector.mult(M.Vector.normalise(body.velocity), 90));
        if (Math.abs(body.angularVelocity) > 4.5) M.Body.setAngularVelocity(body, Math.sign(body.angularVelocity) * 4.5);
        if (!Number.isFinite(body.position.x) || !Number.isFinite(body.position.y)) { M.Body.setPosition(body, { x: 500, y: 80 }); M.Body.setVelocity(body, { x: 0, y: 0 }); M.Body.setAngularVelocity(body, 0); }
      }
    };
    physics.update = function(dt) {
      this.accumulator += Math.min(dt, 50); let frameSteps = 0;
      while (this.accumulator >= this.fixedDelta && frameSteps < this.maxFrameSteps) {
        const travel = this.maximumDynamicSpeed() * (this.fixedDelta / (1000 / 60));
        const microSteps = clamp(Math.ceil(travel / 6), 1, this.maxMicroSteps), step = this.fixedDelta / microSteps;
        for (let i = 0; i < microSteps; i += 1) { this.updateRopeTension(); this.applyContinuousForces(step); M.Engine.update(this.engine, step, 1); this.stabiliseDynamics(); }
        this.accumulator -= this.fixedDelta; frameSteps += 1;
      }
      if (frameSteps === this.maxFrameSteps) this.accumulator = Math.min(this.accumulator, this.fixedDelta);
      if (this.ball && (this.ball.position.y > 830 || this.ball.position.x < -160 || this.ball.position.x > 1160)) this.resetBall();
    };

    const drawing = app.drawing;
    drawing.analyseGesture = function(raw) {
      const points = this.app.physics.resamplePath(raw, 4.5); if (points.length < 2) return null;
      const length = this.app.physics.pathLength(points), xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), width = maxX - minX, height = maxY - minY, diagonal = Math.hypot(width, height);
      const closure = distance(points[0], points[points.length - 1]) / Math.max(1, diagonal); let turn = 0;
      for (let i = 1; i < points.length - 1; i += 1) { const a = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x), b = Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x); let delta = b - a; while (delta > Math.PI) delta -= Math.PI * 2; while (delta < -Math.PI) delta += Math.PI * 2; turn += delta; }
      const closed = diagonal > 25 && closure < .18 && Math.abs(turn) > 4.2, straightness = distance(points[0], points[points.length - 1]) / Math.max(1, length);
      if (!closed) return { kind: straightness > .955 ? 'beam' : 'stroke', points: straightness > .955 ? [points[0], points[points.length - 1]] : points };
      const polygon = points.slice(0, -1), area = Math.abs(this.app.physics.polygonArea(polygon)), perimeter = this.app.physics.pathLength([...polygon, polygon[0]]), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const radii = polygon.map((p) => Math.hypot(p.x - cx, p.y - cy)), mean = radii.reduce((a, b) => a + b, 0) / radii.length, variance = radii.reduce((sum, radius) => sum + (radius - mean) ** 2, 0) / radii.length;
      const wheel = mean >= 18 && mean <= 100 && width / Math.max(1, height) > .72 && width / Math.max(1, height) < 1.38 && Math.sqrt(variance) / Math.max(1, mean) < .2 && 4 * Math.PI * area / Math.max(1, perimeter * perimeter) > .68;
      return { kind: wheel ? 'wheel' : 'shape', points, center: { x: cx, y: cy }, radius: clamp(mean, 18, 95) };
    };
    drawing.createFromPoints = function(length) {
      if (length < 14) return;
      if (this.app.physics.userBodies().length >= this.app.physics.maxUserBodies) { this.app.toast(`Máximo de ${this.app.physics.maxUserBodies} objetos`); return; }
      const gesture = this.analyseGesture(this.points); if (!gesture) return; this.app.pushHistory(); let body = null;
      if (gesture.kind === 'wheel') body = this.app.physics.addWheel({ x: gesture.center.x, y: gesture.center.y, r: gesture.radius }, true);
      else body = this.app.physics.createStroke(gesture.points, { user: true, color: '#4e8b68', closed: gesture.kind === 'shape' });
      if (!body) { this.app.history.pop(); this.app.toast('Dibujo demasiado pequeño o inválido'); return; }
      this.app.usedTools.add(gesture.kind);
      if (this.pendingPivot && distance(body.position, this.pendingPivot) < 190) { this.app.physics.attachPivot(body, this.pendingPivot, true); this.pendingPivot = null; this.app.usedTools.add('pivot'); }
      this.app.afterAction();
      if (gesture.kind === 'wheel') this.app.toast('Círculo reconocido como rueda'); else if (gesture.kind === 'shape') this.app.toast('Contorno reconocido como cuerpo sólido'); else if (gesture.kind === 'beam') this.app.toast('Línea recta reconocida como viga');
    };

    app.canSpendInk = () => true; app.useInk = () => {}; app.refundInk = () => {}; app.flashInk = () => {};
    const originalLoad = app.loadLevel.bind(app);
    app.loadLevel = function(level) { originalLoad(level); this.inkMax = 999999; this.inkLeft = 999999; };
    app.updateHud = function() { const total = this.physics.stars.length; document.querySelector('#starHud').textContent = `★ ${this.collected}/${total}`; document.querySelector('#timeHud').textContent = fmt(this.elapsed); document.querySelector('#objectHud').textContent = `✎ ${this.physics.serializeUser().bodies.length}`; };
  }

  function waitForGame(tries = 0) {
    if (window.app?.physics && window.app?.drawing && window.Matter) { installPhysicsCompatibility(window.app); return; }
    if (tries < 120) setTimeout(() => waitForGame(tries + 1), 50);
  }

  function init() { addStyles(); normaliseInterface(); enhanceToolbar(); waitForGame(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
