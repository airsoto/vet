(() => {
  'use strict';

  const STYLE_ID = 'crayon-physics-v2-ui';
  const M = window.Matter;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const icons = {
    smart: '<svg viewBox="0 0 40 40"><path d="M4 27c6-17 11 9 18-7s10 4 14-7"/><path d="M30 6l1.5 4.5L36 12l-4.5 1.5L30 18l-1.5-4.5L24 12l4.5-1.5Z"/></svg>',
    pivot: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="14"/><circle cx="20" cy="20" r="5"/><path d="M20 2v8m0 20v8M2 20h8m20 0h8"/></svg>',
    rope: '<svg viewBox="0 0 40 40"><circle cx="7" cy="11" r="3"/><circle cx="33" cy="29" r="3"/><path d="M9.5 13c9 0 4 15 13 15 5 0 5-6 8-6"/><path d="M12 16c6 2 3 9 9 10" opacity=".45"/></svg>',
    erase: '<svg viewBox="0 0 40 40"><path d="m8 25 14-16a4 4 0 0 1 6 0l5 5a4 4 0 0 1 0 6L20 33H11l-4-4a3 3 0 0 1 1-4Z"/><path d="m17 15 12 11M19 33h16"/></svg>',
    undo: '<svg viewBox="0 0 40 40"><path d="M15 10 6 18l9 8"/><path d="M7 18h15c8 0 13 4 13 12"/></svg>',
    redo: '<svg viewBox="0 0 40 40"><path d="m25 10 9 8-9 8"/><path d="M33 18H18C10 18 5 22 5 30"/></svg>',
    restart: '<svg viewBox="0 0 40 40"><path d="M31 11a15 15 0 1 0 3.5 15"/><path d="M31 4v9h-9"/></svg>',
    hint: '<svg viewBox="0 0 40 40"><path d="M13 16a7 7 0 1 1 11 5.7c-2.5 1.8-4 3-4 6.3"/><path d="M20 34h.01"/></svg>'
  };

  const controls = [
    { selector: '[data-tool="smart"]', key: 'smart', label: 'Dibujar', aria: 'Dibujo inteligente', pressed: true },
    { selector: '[data-tool="pivot"]', key: 'pivot', label: 'Pivote' },
    { selector: '[data-tool="rope"]', key: 'rope', label: 'Cuerda' },
    { selector: '[data-tool="erase"]', key: 'erase', label: 'Borrar', aria: 'Borrador' },
    { selector: '#undoBtn', key: 'undo', label: 'Deshacer', action: true, shortcut: 'Control+Z Meta+Z' },
    { selector: '#redoBtn', key: 'redo', label: 'Rehacer', action: true, shortcut: 'Control+Shift+Z Meta+Shift+Z' },
    { selector: '#restartBtn', key: 'restart', label: 'Reiniciar', aria: 'Reiniciar nivel', action: true },
    { selector: '#hintBtn', key: 'hint', label: 'Pista', action: true }
  ];

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :root{--chalk:#f8f0d8;--crayon-edge:rgba(31,47,60,.42);--rough-shadow:rgba(35,43,49,.18)}
      html,body{font-family:"Chalkboard SE","Comic Sans MS","Bradley Hand","Trebuchet MS",system-ui,sans-serif}
      body:before{content:"";position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:.18;mix-blend-mode:multiply;background-image:radial-gradient(circle at 17% 23%,rgba(70,48,28,.18) 0 .6px,transparent .8px),radial-gradient(circle at 73% 64%,rgba(70,48,28,.14) 0 .7px,transparent .9px);background-size:11px 13px,17px 19px}
      .ink-wrap{display:none!important}
      .draw-mode-badge{position:absolute;left:12px;top:10px;z-index:3;padding:7px 11px;border:2px dashed var(--blue);border-radius:13px;background:var(--panel);box-shadow:2px 3px 0 var(--rough-shadow);font-size:.72rem;font-weight:900;pointer-events:none;letter-spacing:.015em}
      .paper-card,.world-card,.level-card,.footer,.modal{border-style:solid!important;border-width:3px!important;border-color:var(--crayon-edge)!important;box-shadow:3px 4px 0 var(--rough-shadow),-2px 1px 0 rgba(255,255,255,.32),inset 0 0 18px rgba(80,56,27,.045)!important}
      .crayon-btn,.icon-btn,.tool-btn,.sandbox-bar button,.editor-tools button{border-width:3px!important;border-style:solid!important;border-color:currentColor!important;box-shadow:3px 4px 0 var(--rough-shadow),inset 0 0 0 2px rgba(255,255,255,.17)!important;font-weight:900;transform:rotate(-.2deg)}
      .crayon-btn:nth-child(even),.tool-btn:nth-child(even){transform:rotate(.35deg)}
      .game-toolbar{min-height:94px!important;padding:9px 10px calc(9px + var(--safe-bottom))!important;gap:10px!important;overscroll-behavior-x:contain;scroll-snap-type:x proximity;scroll-padding-inline:10px;-webkit-overflow-scrolling:touch;background-image:repeating-linear-gradient(-3deg,transparent 0 9px,rgba(45,95,134,.025) 10px 11px)}
      .tool-btn{position:relative;overflow:hidden;flex:0 0 76px!important;width:76px;height:74px!important;border-radius:18px!important;gap:4px!important;padding:5px 4px 4px!important;font-size:initial!important;scroll-snap-align:center;transition:transform .1s,background .12s,border-color .12s,box-shadow .12s}
      .tool-btn:after{content:"";position:absolute;inset:4px;border:1px dashed currentColor;border-radius:13px;opacity:.22;pointer-events:none}.tool-btn.active:after{opacity:.48}
      .tool-btn:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(36,51,66,.14)!important}
      .tool-btn .tool-icon{width:40px;height:38px;display:grid;place-items:center;flex:0 0 auto;pointer-events:none}
      .tool-btn .tool-icon svg{width:36px;height:36px;display:block;fill:none;stroke:currentColor;stroke-width:2.35;stroke-linecap:round;stroke-linejoin:round;overflow:visible}
      .tool-btn .tool-label{display:block;max-width:100%;font-size:.69rem!important;line-height:1;letter-spacing:-.015em;white-space:nowrap;pointer-events:none}
      .tool-btn.tool-action{border-color:rgba(183,119,32,.55)!important;background:#fff4d8}.tool-btn.active{border-color:var(--blue2)!important;box-shadow:0 3px 0 rgba(23,63,97,.35),inset 0 0 0 2px rgba(255,255,255,.2)!important}
      body.theme-dark:before{mix-blend-mode:screen;opacity:.06}body.theme-dark .draw-mode-badge{background:rgba(25,32,39,.94)}body.theme-dark .tool-btn.tool-action{background:#28271f!important;border-color:rgba(241,198,90,.5)!important}
      @media(max-width:420px){.draw-mode-badge{font-size:.64rem;max-width:54vw;padding:6px 8px}.game-toolbar{min-height:88px!important;gap:8px!important;padding-inline:8px!important}.tool-btn{flex-basis:70px!important;width:70px;height:68px!important;border-radius:17px!important}.tool-btn .tool-icon{width:36px;height:34px}.tool-btn .tool-icon svg{width:33px;height:33px}.tool-btn .tool-label{font-size:.64rem!important}}
      @media(orientation:landscape) and (max-height:520px){.game-toolbar{width:80px!important;padding:7px calc(7px + var(--safe-right)) calc(7px + var(--safe-bottom)) 7px!important;gap:7px!important;scroll-snap-type:y proximity}.game-stage{margin-right:80px!important}.tool-btn{width:64px!important;min-height:60px!important;height:60px!important;flex-basis:60px!important;padding:4px!important}.tool-btn .tool-icon{width:38px;height:38px;display:grid!important}.tool-btn .tool-icon svg{width:35px;height:35px}.tool-btn .tool-label{display:none!important}.sandbox-bar{right:90px!important}}
    `;
    document.head.appendChild(style);
  }

  function patchDocument() {
    document.title = 'CRAYON PHYSICS — Dibuja. Construye. Resuelve.';
    const h1 = document.querySelector('.hero h1');
    if (h1) h1.innerHTML = 'CRAYON<br>PHYSICS';
    const creditsTitle = document.querySelector('#creditsScreen .credits-content h2');
    if (creditsTitle) creditsTitle.textContent = 'CRAYON PHYSICS';
    const version = document.querySelector('.version');
    if (version) version.textContent = 'Versión 2.0 · Física y dibujo inteligente';

    const ink = document.querySelector('.ink-wrap');
    if (ink && !document.querySelector('.draw-mode-badge')) {
      const badge = document.createElement('div');
      badge.className = 'draw-mode-badge';
      badge.setAttribute('aria-live', 'polite');
      badge.textContent = '✎ Dibujo inteligente · tinta ilimitada';
      ink.insertAdjacentElement('afterend', badge);
    }

    const editorInk = document.querySelector('#editorInk')?.closest('.field');
    if (editorInk) editorInk.style.display = 'none';
    const editorInkInput = document.querySelector('#editorInk');
    if (editorInkInput) editorInkInput.value = '999999';

    const toolbar = document.querySelector('.game-toolbar');
    if (toolbar) {
      const draw = toolbar.querySelector('[data-tool="draw"]') || toolbar.querySelector('[data-tool="smart"]');
      if (draw) {
        draw.dataset.tool = 'smart';
        draw.classList.add('active');
        draw.setAttribute('aria-label', 'Dibujo inteligente');
      }
      toolbar.querySelector('[data-tool="shape"]')?.remove();
      toolbar.querySelector('[data-tool="wheel"]')?.remove();
      toolbar.setAttribute('aria-label', 'Herramientas de dibujo y acciones');
    }

    const legend = document.querySelector('.tool-legend');
    if (legend) {
      const entries = [...legend.children];
      entries.slice(0, 3).forEach((node, i) => { if (i) node.remove(); });
      if (entries[0]) entries[0].innerHTML = '<strong>✎ Dibujo inteligente</strong><br>Dibuja libremente: una línea crea una pieza, un contorno cerrado crea un sólido y un círculo crea una rueda.';
      [...legend.children].forEach((node) => {
        node.innerHTML = node.innerHTML.replace('Elimina tus construcciones y recupera tinta.', 'Elimina cualquiera de tus construcciones.');
      });
    }
    document.querySelectorAll('#helpScreen p').forEach((p) => {
      p.textContent = p.textContent.replace('La primera se obtiene resolviendo el nivel; la segunda, usando poca tinta; la tercera, combinando mecanismos como ruedas, cuerdas o pivotes.', 'La primera se obtiene resolviendo el nivel; la segunda, con pocos objetos y buen tiempo; la tercera, combinando ruedas, sólidos, cuerdas o pivotes.');
    });
  }

  function enhanceToolbar() {
    const toolbar = document.querySelector('.game-toolbar');
    if (!toolbar) return;
    controls.forEach((control) => {
      const button = toolbar.querySelector(control.selector);
      if (!button) return;
      const aria = control.aria || control.label;
      button.setAttribute('aria-label', aria);
      button.setAttribute('title', aria);
      button.innerHTML = `<span class="tool-icon" aria-hidden="true">${icons[control.key]}</span><span class="tool-label">${control.label}</span>`;
      if (control.action) button.classList.add('tool-action');
      if (control.shortcut) button.setAttribute('aria-keyshortcuts', control.shortcut);
      if (button.dataset.tool) button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    });
    const sync = () => toolbar.querySelectorAll('.tool-btn[data-tool]').forEach((button) => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
    toolbar.addEventListener('click', () => requestAnimationFrame(sync));
    const observer = new MutationObserver(sync);
    toolbar.querySelectorAll('.tool-btn[data-tool]').forEach((button) => observer.observe(button, { attributes: true, attributeFilter: ['class'] }));
  }

  function patchRenderer(app) {
    const renderer = app.renderer;
    renderer.scribbleLine = function scribbleLine(points, color, width = 12, closed = false) {
      const ctx = this.ctx;
      if (points.length < 2) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      const passes = [{ o: 0, w: 1, a: .55 }, { o: 1.15, w: .82, a: .26 }, { o: -1.35, w: .68, a: .22 }, { o: .45, w: .48, a: .18 }, { o: -.55, w: .34, a: .14 }];
      passes.forEach((q, pass) => {
        ctx.beginPath();
        points.forEach((p, i) => {
          const j = Math.sin(i * 7.31 + pass * 2.17) * q.o;
          const k = Math.cos(i * 5.13 + pass) * q.o * .55;
          if (!i) ctx.moveTo(p.x + j, p.y + k); else ctx.lineTo(p.x + j, p.y + k);
        });
        if (closed) ctx.closePath();
        ctx.globalAlpha = q.a;
        ctx.lineWidth = Math.max(1.2, width * q.w);
        ctx.stroke();
      });
      ctx.globalAlpha = .16;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), steps = Math.min(7, Math.floor(len / 14));
        if (!steps) continue;
        const nx = -dy / (len || 1), ny = dx / (len || 1);
        for (let s = 1; s <= steps; s++) {
          const t = s / (steps + 1), seed = Math.sin((i * 37 + s * 19) * 1.73), off = seed * width * .38;
          ctx.beginPath();
          ctx.arc(a.x + dx * t + nx * off, a.y + dy * t + ny * off, .65 + Math.abs(seed) * 1.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    };
  }

  function patchPhysics(app) {
    if (!M) return;
    const pw = app.physics;
    pw.engine.positionIterations = 18;
    pw.engine.velocityIterations = 16;
    pw.engine.constraintIterations = 12;
    pw.engine.gravity.scale = 9.81 * 100 / 1e6;
    pw.fixedDelta = 1000 / 240;
    pw.maxSubSteps = 14;
    Object.assign(pw.materials, {
      platform: { friction: .74, frictionStatic: 1.35, restitution: .005, slop: .004 },
      ball: { friction: .24, frictionStatic: .72, frictionAir: .00018, restitution: .08, slop: .004, mass: 3.25 },
      block: { friction: .58, frictionStatic: 1.08, frictionAir: .0002, restitution: .03, slop: .005 },
      wheel: { friction: .82, frictionStatic: 1.45, frictionAir: .00012, restitution: .025, slop: .004 },
      stroke: { friction: .7, frictionStatic: 1.25, frictionAir: .0002, restitution: .018, slop: .004, density: .00125 },
      shape: { friction: .64, frictionStatic: 1.16, frictionAir: .00018, restitution: .025, slop: .005, density: .0014 },
      rocket: { friction: .52, frictionStatic: .92, frictionAir: .00028, restitution: .02, slop: .005 }
    });

    const oldAddBlock = pw.addBlock.bind(pw);
    pw.addBlock = function addBlock(bd, isUser = false) {
      const body = oldAddBlock(bd, isUser);
      if (bd.mass == null) M.Body.setMass(body, clamp(bd.w * bd.h * .0012, 1.8, 20));
      return body;
    };
    const oldAddWheel = pw.addWheel.bind(pw);
    pw.addWheel = function addWheel(w, isUser = false) {
      const body = oldAddWheel(w, isUser);
      if (w.mass == null) M.Body.setMass(body, clamp(Math.PI * w.r * w.r * .00108, 2.2, 18));
      return body;
    };
    const oldAttach = pw.attachPivot.bind(pw);
    pw.attachPivot = function attachPivot(body, pivot, user = true) {
      const c = oldAttach(body, pivot, user);
      c.stiffness = .999;
      c.damping = .14;
      return c;
    };
    const oldRope = pw.addRope.bind(pw);
    pw.addRope = function addRope(a, b, user = true) {
      const c = oldRope(a, b, user);
      c.stiffness = .985;
      c.damping = .12;
      return c;
    };
    pw.stabiliseDynamics = function stabiliseDynamics() {
      for (const body of this.bodies.values()) {
        if (body.isStatic || body.isSensor) continue;
        const speed = M.Vector.magnitude(body.velocity);
        if (speed > 60) M.Body.setVelocity(body, M.Vector.mult(M.Vector.normalise(body.velocity), 60));
        if (Math.abs(body.angularVelocity) > 3.2) M.Body.setAngularVelocity(body, Math.sign(body.angularVelocity) * 3.2);
        if (Math.abs(body.velocity.x) < .0008 && Math.abs(body.velocity.y) < .0008 && Math.abs(body.angularVelocity) < .00008) {
          M.Body.setVelocity(body, { x: 0, y: 0 });
          M.Body.setAngularVelocity(body, 0);
        }
        if (!Number.isFinite(body.position.x) || !Number.isFinite(body.position.y)) {
          M.Body.setPosition(body, { x: 500, y: 80 });
          M.Body.setVelocity(body, { x: 0, y: 0 });
          M.Body.setAngularVelocity(body, 0);
        }
      }
    };
  }

  function patchDrawing(app) {
    const drawing = app.drawing;
    drawing.tool = 'smart';
    drawing.gestureMetrics = function gestureMetrics(points, length) {
      const pts = this.app.physics.simplify(points, 3.2);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), w = maxX - minX, h = maxY - minY, diag = Math.hypot(w, h);
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const radii = pts.map((p) => Math.hypot(p.x - cx, p.y - cy)), meanR = radii.reduce((a, b) => a + b, 0) / Math.max(1, radii.length);
      const variance = radii.reduce((a, r) => a + (r - meanR) ** 2, 0) / Math.max(1, radii.length), radialCV = Math.sqrt(variance) / Math.max(1, meanR);
      const gap = dist(pts[0], pts[pts.length - 1]), aspect = Math.min(w, h) / Math.max(1, Math.max(w, h)), circumference = 2 * Math.PI * meanR;
      const closed = pts.length >= 6 && gap <= Math.max(28, diag * .23) && length > Math.max(52, diag * 1.45);
      const circle = closed && meanR >= 18 && meanR <= 100 && aspect > .7 && radialCV < .24 && length / circumference > .68 && length / circumference < 1.48;
      return { pts, cx, cy, meanR, closed, circle };
    };
    drawing.move = function move(e) {
      e.preventDefault();
      if (!this.start) return;
      const p = this.renderer.toWorld(e.clientX, e.clientY);
      this.pointer = p;
      if (this.tool !== 'smart' || !this.points.length) return;
      const last = this.points[this.points.length - 1];
      if (dist(last, p) > 2.5) {
        this.points.push(p);
        this.app.particles.dust(p.x, p.y, '#4e8b68');
        if (this.points.length % 8 === 0) this.app.audio.draw();
        if (dist(this.start, p) > 9) clearTimeout(this.longTimer);
      }
    };
    drawing.up = function up(e) {
      e.preventDefault();
      clearTimeout(this.longTimer);
      const p = this.renderer.toWorld(e.clientX, e.clientY);
      const duration = performance.now() - this.downAt;
      const travelled = this.points.length > 1 ? this.points.reduce((a, q, i) => i ? a + dist(q, this.points[i - 1]) : 0, 0) : 0;
      if (this.tool === 'smart' && this.points.length) {
        if (travelled < 10 && duration < 350 && this.app.physics.ball && dist(p, this.app.physics.ball.position) < 35) {
          this.nudge(p);
          this.points = [];
          this.start = null;
          return;
        }
        this.createFromPoints(travelled);
      }
      this.points = [];
      this.start = null;
      this.pointer = null;
    };
    drawing.createFromPoints = function createFromPoints(length) {
      if (length < 14) return;
      const g = this.gestureMetrics(this.points, length);
      this.app.pushHistory();
      let body = null, kind = 'stroke';
      if (g.circle) {
        body = this.app.physics.addWheel({ x: g.cx, y: g.cy, r: clamp(g.meanR, 18, 95), ink: 0 }, true);
        kind = 'wheel';
        this.app.toast('Rueda detectada');
      } else if (g.closed) {
        const closedPoints = g.pts.slice();
        if (dist(closedPoints[0], closedPoints[closedPoints.length - 1]) > 2) closedPoints.push({ ...closedPoints[0] });
        body = this.app.physics.createStroke(closedPoints, { user: true, color: '#4e8b68', ink: 0, closed: true });
        kind = 'shape';
        this.app.toast('Forma cerrada detectada');
      } else {
        body = this.app.physics.createStroke(g.pts, { user: true, color: '#4e8b68', ink: 0, closed: false });
      }
      if (!body) {
        this.app.history.pop();
        this.app.toast('Dibujo demasiado pequeño o inválido');
        return;
      }
      this.app.usedTools.add(kind);
      if (this.pendingPivot && dist(body.position, this.pendingPivot) < 190) {
        this.app.physics.attachPivot(body, this.pendingPivot, true);
        this.pendingPivot = null;
        this.app.usedTools.add('pivot');
      }
      this.app.afterAction();
      if (this.app.currentLevel?.tutorial) this.app.hideTip();
    };
  }

  function patchApp(app) {
    app.canSpendInk = () => true;
    app.useInk = () => {};
    app.refundInk = () => {};
    app.flashInk = () => {};
    app.updateHud = function updateHud() {
      const total = this.physics.stars.length;
      document.querySelector('#starHud').textContent = `★ ${this.collected}/${total}`;
      document.querySelector('#timeHud').textContent = fmt(this.elapsed);
      document.querySelector('#objectHud').textContent = `✎ ${this.physics.serializeUser().bodies.length}`;
    };
    app.finishLevel = function finishLevel() {
      this.paused = true;
      const snap = this.physics.serializeUser();
      let medals = 1;
      const target = this.currentLevel?.time || 75;
      const efficientLimit = Math.max(4, Math.ceil((this.physics.stars.length || 1) * 2.5) + 2);
      if (snap.bodies.length <= efficientLimit && this.elapsed <= target * 1.8) medals++;
      const mechanisms = new Set(snap.bodies.map((b) => b.type).filter((t) => ['wheel', 'shape'].includes(t)));
      snap.constraints.forEach((c) => mechanisms.add(c.kind));
      if (mechanisms.size >= 2 || (mechanisms.size >= 1 && snap.bodies.length >= 3)) medals++;
      medals = Math.min(3, medals);
      const score = Math.max(100, Math.round(12000 - this.elapsed * 35 - snap.bodies.length * 180 - this.nudges * 120 - this.hintsUsed * 300 - this.restarts * 180));
      if (this.mode === 'campaign') this.save.record(this.currentLevel.id, medals, score);
      this.audio.win();
      this.particles.burst(this.physics.ball.position.x, this.physics.ball.position.y, '#dd594d', 60, 10);
      const stars = '★'.repeat(medals) + '☆'.repeat(3 - medals);
      this.showModal(`<h2>¡Nivel resuelto!</h2><div class="medal-row">${stars}</div><div class="score-big">${score}</div><p>${fmt(this.elapsed)} · ${snap.bodies.length} objetos · tinta ilimitada</p><div class="modal-actions"><button class="crayon-btn primary" id="nextModal">Siguiente</button><button class="crayon-btn" id="againModal">Repetir</button><button class="crayon-btn" id="mapFinishModal">Mapa</button></div>`);
      document.querySelector('#againModal').onclick = () => { this.closeModal(); this.restart(); };
      document.querySelector('#mapFinishModal').onclick = () => { this.closeModal(); this.running = false; this.showScreen(this.mode === 'campaign' ? 'mapScreen' : 'homeScreen'); };
      document.querySelector('#nextModal').onclick = () => { this.closeModal(); if (this.mode === 'campaign') { const n = this.levels.get(`L${this.currentLevel.number + 1}`); if (n) this.startLevel(n, 'campaign'); else this.showScreen('mapScreen'); } else this.showScreen('homeScreen'); };
    };

    const oldStart = app.startLevel.bind(app);
    app.startLevel = function startLevel(level, mode = 'campaign') {
      oldStart(level, mode);
      this.drawing.setTool('smart');
      this.inkMax = Infinity;
      this.inkLeft = Infinity;
      this.updateHud();
    };
    const oldRenderCustom = app.renderCustom.bind(app);
    app.renderCustom = function renderCustom() {
      oldRenderCustom();
      document.querySelectorAll('#customList .small.muted').forEach((el) => { el.textContent = el.textContent.replace(/·\s*Tinta\s+\S+/i, '· tinta ilimitada'); });
    };
    const oldRenderMap = app.renderMap.bind(app);
    app.renderMap = function renderMap() {
      oldRenderMap();
      document.querySelectorAll('.world-card .small.muted').forEach((el) => { el.textContent = el.textContent.replace('Rampas, puentes y tinta.', 'Rampas, puentes y formas libres.'); });
    };
  }

  function init() {
    addStyles();
    patchDocument();
    const app = window.app;
    if (!app || !app.physics || !app.drawing) return;
    patchPhysics(app);
    patchRenderer(app);
    patchDrawing(app);
    patchApp(app);
    enhanceToolbar();
    app.renderMap();
    app.renderCustom();
    app.drawing.setTool('smart');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
