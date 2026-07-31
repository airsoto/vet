(() => {
  'use strict';

  const STYLE_ID = 'crayon-toolbar-accessibility';

  const icons = {
    draw: '<svg viewBox="0 0 40 40"><path d="M4 27c6-17 11 9 18-7s10 4 14-7"/></svg>',
    shape: '<svg viewBox="0 0 40 40"><path d="M20 4 34 12v16L20 36 6 28V12Z"/><path d="m10 13 9-5 11 6" opacity=".45"/></svg>',
    wheel: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15"/><circle cx="20" cy="20" r="4"/><path d="M20 5v11m0 8v11M5 20h11m8 0h11M9.4 9.4l7.8 7.8m5.6 5.6 7.8 7.8m0-21.2-7.8 7.8m-5.6 5.6-7.8 7.8"/></svg>',
    pivot: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="14"/><circle cx="20" cy="20" r="5"/><path d="M20 2v8m0 20v8M2 20h8m20 0h8"/></svg>',
    rope: '<svg viewBox="0 0 40 40"><circle cx="7" cy="11" r="3"/><circle cx="33" cy="29" r="3"/><path d="M9.5 13c9 0 4 15 13 15 5 0 5-6 8-6"/><path d="M12 16c6 2 3 9 9 10" opacity=".45"/></svg>',
    erase: '<svg viewBox="0 0 40 40"><path d="m8 25 14-16a4 4 0 0 1 6 0l5 5a4 4 0 0 1 0 6L20 33H11l-4-4a3 3 0 0 1 1-4Z"/><path d="m17 15 12 11M19 33h16"/></svg>',
    undo: '<svg viewBox="0 0 40 40"><path d="M15 10 6 18l9 8"/><path d="M7 18h15c8 0 13 4 13 12"/></svg>',
    redo: '<svg viewBox="0 0 40 40"><path d="m25 10 9 8-9 8"/><path d="M33 18H18C10 18 5 22 5 30"/></svg>',
    restart: '<svg viewBox="0 0 40 40"><path d="M31 11a15 15 0 1 0 3.5 15"/><path d="M31 4v9h-9"/></svg>',
    hint: '<svg viewBox="0 0 40 40"><path d="M13 16a7 7 0 1 1 11 5.7c-2.5 1.8-4 3-4 6.3"/><path d="M20 34h.01"/></svg>'
  };

  const controls = [
    { selector: '[data-tool="draw"]', key: 'draw', label: 'Trazo', pressed: true },
    { selector: '[data-tool="shape"]', key: 'shape', label: 'Forma', aria: 'Forma cerrada' },
    { selector: '[data-tool="wheel"]', key: 'wheel', label: 'Rueda' },
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
      .game-toolbar{
        min-height:94px!important;
        padding:9px 10px calc(9px + var(--safe-bottom))!important;
        gap:10px!important;
        overscroll-behavior-x:contain;
        scroll-snap-type:x proximity;
        scroll-padding-inline:10px;
        -webkit-overflow-scrolling:touch;
      }
      .tool-btn{
        flex:0 0 76px!important;
        width:76px;
        height:74px!important;
        border-radius:18px!important;
        border-width:2.5px!important;
        border-color:rgba(36,51,66,.28)!important;
        box-shadow:0 3px 0 rgba(36,51,66,.14);
        gap:4px!important;
        padding:5px 4px 4px!important;
        font-size:initial!important;
        scroll-snap-align:center;
        transition:transform .1s,background .12s,border-color .12s,box-shadow .12s;
      }
      .tool-btn:active{
        transform:translateY(2px);
        box-shadow:0 1px 0 rgba(36,51,66,.14);
      }
      .tool-btn .tool-icon{
        width:40px;
        height:38px;
        display:grid;
        place-items:center;
        flex:0 0 auto;
        pointer-events:none;
      }
      .tool-btn .tool-icon svg{
        width:36px;
        height:36px;
        display:block;
        fill:none;
        stroke:currentColor;
        stroke-width:2.35;
        stroke-linecap:round;
        stroke-linejoin:round;
        overflow:visible;
      }
      .tool-btn .tool-label{
        display:block;
        max-width:100%;
        font-size:.69rem!important;
        line-height:1;
        letter-spacing:-.015em;
        white-space:nowrap;
        pointer-events:none;
      }
      .tool-btn.tool-action{
        border-color:rgba(183,119,32,.55)!important;
        background:#fff4d8;
      }
      .tool-btn.active{
        border-color:var(--blue2)!important;
        box-shadow:0 3px 0 rgba(23,63,97,.35),inset 0 0 0 2px rgba(255,255,255,.2);
      }
      body.theme-dark .tool-btn.tool-action{
        background:#28271f!important;
        border-color:rgba(241,198,90,.5)!important;
      }
      @media(max-width:420px){
        .game-toolbar{min-height:88px!important;gap:8px!important;padding-inline:8px!important}
        .tool-btn{flex-basis:70px!important;width:70px;height:68px!important;border-radius:17px!important}
        .tool-btn .tool-icon{width:36px;height:34px}
        .tool-btn .tool-icon svg{width:33px;height:33px}
        .tool-btn .tool-label{font-size:.64rem!important}
      }
      @media(orientation:landscape) and (max-height:520px){
        .game-toolbar{width:80px!important;padding:7px calc(7px + var(--safe-right)) calc(7px + var(--safe-bottom)) 7px!important;gap:7px!important;scroll-snap-type:y proximity}
        .game-stage{margin-right:80px!important}
        .tool-btn{width:64px!important;min-height:60px!important;height:60px!important;flex-basis:60px!important;padding:4px!important}
        .tool-btn .tool-icon{width:38px;height:38px;display:grid!important}
        .tool-btn .tool-icon svg{width:35px;height:35px}
        .tool-btn .tool-label{display:none!important}
        .sandbox-bar{right:90px!important}
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

    toolbar.setAttribute('aria-label', 'Herramientas de dibujo y acciones');

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

    toolbar.addEventListener('click', () => requestAnimationFrame(() => syncPressed(toolbar)));

    const observer = new MutationObserver(() => syncPressed(toolbar));
    toolbar.querySelectorAll('.tool-btn[data-tool]').forEach((button) => {
      observer.observe(button, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function init() {
    addStyles();
    enhanceToolbar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
