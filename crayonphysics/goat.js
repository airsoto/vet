(() => {
  'use strict';

  const STYLE_ID = 'crayon-physics-analog-ui';
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
    { selector: '[data-tool="draw"]', key: 'draw', label: 'Dibujar', aria: 'Dibujar objeto inteligente' },
    { selector: '[data-tool="pivot"]', key: 'pivot', label: 'Pivote' },
    { selector: '[data-tool="rope"]', key: 'rope', label: 'Cuerda' },
    { selector: '[data-tool="erase"]', key: 'erase', label: 'Borrar', aria: 'Borrador' },
    { selector: '#undoBtn', key: 'undo', label: 'Deshacer', action: true, shortcut: 'Control+Z Meta+Z' },
    { selector: '#redoBtn', key: 'redo', label: 'Rehacer', action: true, shortcut: 'Control+Shift+Z Meta+Shift+Z' },
    { selector: '#restartBtn', key: 'restart', label: 'Reiniciar', action: true },
    { selector: '#hintBtn', key: 'hint', label: 'Pista', action: true }
  ];

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .game-toolbar{
        min-height:96px!important;padding:10px 12px calc(10px + var(--safe-bottom))!important;
        gap:11px!important;overscroll-behavior-x:contain;scroll-snap-type:x proximity;
        scroll-padding-inline:12px;-webkit-overflow-scrolling:touch;
        background-image:repeating-linear-gradient(-4deg,rgba(45,95,134,.025) 0 2px,transparent 2px 7px)!important;
      }
      .tool-btn{
        flex:0 0 82px!important;width:82px;height:76px!important;padding:6px 5px!important;
        border:3px solid currentColor!important;border-radius:45% 55% 48% 52%/56% 43% 57% 44%!important;
        box-shadow:2px 4px 0 rgba(36,51,66,.14),inset 0 0 0 2px rgba(255,255,255,.18)!important;
        display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;
        gap:3px!important;scroll-snap-align:center;transform:rotate(-.35deg);
      }
      .tool-btn:nth-child(even){transform:rotate(.35deg)}
      .tool-btn:active{transform:translateY(2px) rotate(0);box-shadow:1px 1px 0 rgba(36,51,66,.14)!important}
      .tool-icon{width:42px;height:42px;display:grid;place-items:center;pointer-events:none}
      .tool-icon svg{width:39px;height:39px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
      .tool-label{font-family:"Comic Sans MS","Bradley Hand","Segoe Print",cursive;font-size:.72rem!important;line-height:1;font-weight:900;white-space:nowrap;pointer-events:none}
      .tool-btn.tool-action{color:var(--orange);background:color-mix(in srgb,var(--paper) 86%,var(--gold) 14%)!important}
      .tool-btn.active{color:#fff!important;background:var(--blue)!important;box-shadow:2px 4px 0 rgba(23,63,97,.32),inset 0 0 0 2px rgba(255,255,255,.24)!important}
      body.theme-dark .tool-btn.tool-action{background:#2c281e!important;color:var(--gold)}
      @media(max-width:420px){
        .game-toolbar{min-height:89px!important;padding-inline:8px!important;gap:8px!important}
        .tool-btn{flex-basis:72px!important;width:72px;height:69px!important}
        .tool-icon{width:36px;height:36px}.tool-icon svg{width:34px;height:34px}
        .tool-label{font-size:.65rem!important}
      }
      @media(orientation:landscape) and (max-height:520px){
        .game-toolbar{width:84px!important;padding:8px calc(8px + var(--safe-right)) calc(8px + var(--safe-bottom)) 8px!important;gap:8px!important;scroll-snap-type:y proximity}
        .game-stage{margin-right:84px!important}.sandbox-bar{right:94px!important}
        .tool-btn{width:66px!important;height:62px!important;min-height:62px!important;flex-basis:62px!important}
        .tool-icon{width:40px;height:40px}.tool-icon svg{width:37px;height:37px}.tool-label{display:none!important}
      }
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

    controls.forEach((control) => {
      const button = toolbar.querySelector(control.selector);
      if (!button) return;
      const aria = control.aria || control.label;
      button.setAttribute('aria-label', aria);
      button.setAttribute('title', aria);
      button.innerHTML = `<span class="tool-icon" aria-hidden="true">${icons[control.key]}</span><span class="tool-label">${control.label}</span>`;
      button.classList.toggle('tool-action', Boolean(control.action));
      if (control.shortcut) button.setAttribute('aria-keyshortcuts', control.shortcut);
      if (button.dataset.tool) button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    });

    toolbar.addEventListener('click', () => requestAnimationFrame(() => syncPressed(toolbar)));
    const observer = new MutationObserver(() => syncPressed(toolbar));
    toolbar.querySelectorAll('.tool-btn[data-tool]').forEach((button) => observer.observe(button, { attributes: true, attributeFilter: ['class'] }));
  }


  function waitForGame(callback, tries = 0) {
    if (window.app?.physics && window.app?.drawing && window.Matter) return callback(window.app);
    if (tries < 120) setTimeout(() => waitForGame(callback, tries + 1), 50);
  }

  function upgradeGame(app) {
    const M = window.Matter;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    document.title = 'CRAYON PHYSICS — Dibuja y resuelve';
    document.querySelector('.hero h1')?.replaceChildren('CRAYON', document.createElement('br'), 'PHYSICS');
    const creditTitle = document.querySelector('#creditsScreen .credits-content h2');
    if (creditTitle) creditTitle.textContent = 'CRAYON PHYSICS';

    document.querySelector('[data-tool="shape"]')?.remove();
    document.querySelector('[data-tool="wheel"]')?.remove();
    document.querySelector('.ink-wrap')?.remove();
    document.querySelector('#editorInk')?.closest('.field')?.remove();

    const drawButton = document.querySelector('[data-tool="draw"]');
    if (drawButton) {
      drawButton.setAttribute('aria-label', 'Dibujar objeto inteligente');
      drawButton.dataset.tool = 'draw';
    }

    document.querySelectorAll('#helpScreen .tool-legend > div').forEach((item) => {
      const text = item.textContent || '';
      if (/Trazo|Forma|Rueda/.test(text)) item.remove();
      if (/Borrador/.test(text)) item.innerHTML = '<strong>⌫ Borrador</strong><br>Elimina tus construcciones.';
    });
    const legend = document.querySelector('#helpScreen .tool-legend');
    if (legend && !legend.querySelector('[data-smart-pencil]')) {
      const item = document.createElement('div');
      item.dataset.smartPencil = 'true';
      item.innerHTML = '<strong>✎ Dibujar</strong><br>El lápiz reconoce líneas abiertas, formas cerradas y círculos automáticamente.';
      legend.prepend(item);
    }
    document.querySelectorAll('#helpScreen p').forEach((p) => {
      if (p.textContent?.includes('La primera se obtiene')) p.textContent = 'La primera medalla se obtiene resolviendo el nivel; la segunda, con una solución eficiente; la tercera, combinando mecanismos.';
    });

    app.canSpendInk = () => true;
    app.useInk = () => {};
    app.refundInk = () => {};
    app.flashInk = () => {};
    app.inkMax = 999999;
    app.inkLeft = 999999;

    const originalLoadLevel = app.loadLevel.bind(app);
    app.loadLevel = function(level) {
      originalLoadLevel(level);
      this.inkMax = 999999;
      this.inkLeft = 999999;
      document.querySelector('.ink-wrap')?.remove();
    };

    const originalFinish = app.finishLevel.bind(app);
    app.finishLevel = function() {
      const oldInkMax = this.inkMax;
      const oldInkLeft = this.inkLeft;
      this.inkMax = 1;
      this.inkLeft = 1;
      originalFinish();
      this.inkMax = oldInkMax;
      this.inkLeft = oldInkLeft;
      const result = document.querySelector('#modalBox p');
      if (result) result.textContent = result.textContent.replace(/ · Tinta [^·]+/, '');
    };

    const physics = app.physics;
    physics.engine.positionIterations = 18;
    physics.engine.velocityIterations = 16;
    physics.engine.constraintIterations = 12;
    physics.engine.gravity.scale = 9.81 * 100 / 1e6;
    physics.fixedDelta = 1000 / 240;
    physics.maxSubSteps = 14;
    Object.assign(physics.materials.platform, { friction: .72, frictionStatic: 1.1, restitution: .015, slop: .004 });
    Object.assign(physics.materials.ball, { friction: .28, frictionStatic: .72, frictionAir: .00018, restitution: .12, slop: .004 });
    Object.assign(physics.materials.block, { friction: .58, frictionStatic: .92, frictionAir: .00016, restitution: .055, slop: .005 });
    Object.assign(physics.materials.wheel, { friction: .66, frictionStatic: 1.12, frictionAir: .00012, restitution: .07, slop: .004 });
    Object.assign(physics.materials.stroke, { friction: .62, frictionStatic: 1, frictionAir: .00014, restitution: .045, slop: .004, density: .0016 });
    Object.assign(physics.materials.shape, { friction: .6, frictionStatic: .96, frictionAir: .00014, restitution: .05, slop: .004, density: .0017 });

    physics.stabiliseDynamics = function() {
      for (const body of this.bodies.values()) {
        if (body.isStatic || body.isSensor) continue;
        const speed = M.Vector.magnitude(body.velocity);
        if (speed > 75) M.Body.setVelocity(body, M.Vector.mult(M.Vector.normalise(body.velocity), 75));
        if (Math.abs(body.angularVelocity) > 3.8) M.Body.setAngularVelocity(body, Math.sign(body.angularVelocity) * 3.8);
        if (!Number.isFinite(body.position.x) || !Number.isFinite(body.position.y)) {
          M.Body.setPosition(body, { x: 500, y: 80 });
          M.Body.setVelocity(body, { x: 0, y: 0 });
          M.Body.setAngularVelocity(body, 0);
        }
      }
    };

    physics.update = function(dt) {
      const dynamic = [...this.bodies.values()].filter((b) => !b.isStatic && !b.isSensor);
      const maxSpeed = dynamic.reduce((max, b) => Math.max(max, M.Vector.magnitude(b.velocity)), 0);
      const adaptive = maxSpeed > 28 ? 2 : maxSpeed > 14 ? 1.5 : 1;
      const step = this.fixedDelta / adaptive;
      this.accumulator += Math.min(dt, 50);
      let steps = 0;
      while (this.accumulator >= step && steps < this.maxSubSteps) {
        this.applyContinuousForces(step);
        M.Engine.update(this.engine, step, 1);
        this.stabiliseDynamics();
        this.accumulator -= step;
        steps += 1;
      }
      if (steps === this.maxSubSteps) this.accumulator = 0;
      if (this.ball && (this.ball.position.y > 830 || this.ball.position.x < -160 || this.ball.position.x > 1160)) this.resetBall();
    };

    app.renderer.scribbleLine = function(points, color, width = 12, closed = false) {
      const ctx = this.ctx;
      if (points.length < 2) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let pass = 0; pass < 7; pass += 1) {
        ctx.beginPath();
        points.forEach((point, index) => {
          const jx = Math.sin(index * 12.37 + pass * 3.11) * (.55 + pass * .12);
          const jy = Math.cos(index * 9.71 + pass * 2.63) * (.5 + pass * .1);
          if (!index) ctx.moveTo(point.x + jx, point.y + jy);
          else ctx.lineTo(point.x + jx, point.y + jy);
        });
        if (closed) ctx.closePath();
        ctx.strokeStyle = color;
        ctx.globalAlpha = pass === 0 ? .62 : .11 + (pass % 2) * .025;
        ctx.lineWidth = Math.max(1, width + (pass - 3) * .72);
        ctx.stroke();
      }
      ctx.globalAlpha = .16;
      ctx.fillStyle = color;
      const grain = Math.min(180, Math.max(18, points.length * 3));
      for (let n = 0; n < grain; n += 1) {
        const point = points[(n * 17) % points.length];
        const angle = (n * 2.399) % 6.283;
        const radius = (Math.sin(n * 7.13) * .5 + .5) * width * .48;
        ctx.fillRect(point.x + Math.cos(angle) * radius, point.y + Math.sin(angle) * radius, .7 + (n % 3) * .35, .7);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    const drawing = app.drawing;
    drawing.tool = 'draw';
    const originalSetTool = drawing.setTool.bind(drawing);
    drawing.setTool = function(tool) {
      originalSetTool(tool === 'shape' || tool === 'wheel' ? 'draw' : tool);
    };

    drawing.createFromPoints = function(length) {
      if (length < 14) return;
      this.app.pushHistory();
      const points = this.points;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const width = maxX - minX, height = maxY - minY, diagonal = Math.hypot(width, height);
      const closed = diagonal > 24 && distance(points[0], points[points.length - 1]) < Math.max(22, diagonal * .18);
      let body = null;
      let kind = 'stroke';
      if (closed && points.length >= 8) {
        const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
        const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
        const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
        const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
        const variance = radii.reduce((sum, radius) => sum + (radius - mean) ** 2, 0) / radii.length;
        const circularity = Math.sqrt(variance) / Math.max(1, mean);
        const aspect = width / Math.max(1, height);
        if (mean >= 18 && mean <= 100 && aspect > .68 && aspect < 1.47 && circularity < .24) {
          body = this.app.physics.addWheel({ x: cx, y: cy, r: clamp(mean, 18, 95) }, true);
          kind = 'wheel';
        } else {
          body = this.app.physics.createStroke(points, { user: true, color: '#4e8b68', closed: true });
          kind = 'shape';
        }
      } else {
        body = this.app.physics.createStroke(points, { user: true, color: '#4e8b68', closed: false });
      }
      if (!body) {
        this.app.history.pop();
        this.app.toast('Dibujo demasiado pequeño o inválido');
        return;
      }
      this.app.usedTools.add(kind);
      if (this.pendingPivot && distance(body.position, this.pendingPivot) < 190) {
        this.app.physics.attachPivot(body, this.pendingPivot, true);
        this.pendingPivot = null;
        this.app.usedTools.add('pivot');
      }
      this.app.afterAction();
      if (kind === 'wheel') this.app.toast('Círculo reconocido como rueda');
      else if (kind === 'shape') this.app.toast('Forma cerrada reconocida');
      if (this.app.currentLevel?.tutorial) this.app.hideTip();
    };

    enhanceToolbar();
  }

  function init() { addStyles(); enhanceToolbar(); waitForGame(upgradeGame); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
