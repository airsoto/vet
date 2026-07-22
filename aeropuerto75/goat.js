(() => {
  'use strict';

  if (window.__AERO_CONTROL_3D_PATCH__) return;
  window.__AERO_CONTROL_3D_PATCH__ = true;

  const originalWrite = document.write.bind(document);

  function applyAero3D(html) {
    if (typeof html !== 'string' || !html.includes('<canvas')) return html;

    const css3d = `
      #app{
        position:relative;
        filter:drop-shadow(0 22px 34px rgba(0,0,0,.24)) drop-shadow(0 8px 14px rgba(0,0,0,.14));
      }
      #app::before{
        content:'';
        position:absolute;
        left:18px;
        right:18px;
        bottom:-18px;
        height:18px;
        border-radius:0 0 16px 16px;
        background:linear-gradient(180deg,rgba(127,175,214,.22),rgba(11,29,44,.8));
        transform:skewX(-42deg);
        transform-origin:top left;
        pointer-events:none;
        opacity:.92;
      }
      #app::after{
        content:'';
        position:absolute;
        top:18px;
        right:-18px;
        bottom:18px;
        width:18px;
        border-radius:0 16px 16px 0;
        background:linear-gradient(90deg,rgba(151,201,240,.16),rgba(8,18,28,.88));
        transform:skewY(-42deg);
        transform-origin:top left;
        pointer-events:none;
        opacity:.92;
      }
      #gameCanvas{
        position:relative;
        z-index:1;
        border-radius:18px;
        box-shadow:
          inset 0 2px 0 rgba(255,255,255,.09),
          inset 0 -2px 0 rgba(0,0,0,.36),
          0 12px 26px rgba(0,0,0,.16);
      }
      #hud,.glass,#departureBtn,#hintBar{
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.08),
          0 6px 13px rgba(0,0,0,.16);
      }
      @media(pointer:coarse){
        #app::before{bottom:-12px;height:12px;left:12px;right:12px}
        #app::after{right:-12px;width:12px;top:12px;bottom:12px}
      }
    `;

    html = html.replace('</style>', `${css3d}</style>`);

    const route2d = "const routeDrawStep=compactDevice?3:coarsePointer?2:1;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i+=routeDrawStep)ctx.lineTo(pts[i].x,pts[i].y);const routeLast=pts[pts.length-1];ctx.lineTo(routeLast.x,routeLast.y);ctx.stroke();";
    const route3d = "const routeDrawStep=compactDevice?3:coarsePointer?2:1;ctx.save();ctx.translate(0,3);ctx.globalAlpha*=.22;ctx.strokeStyle='rgba(0,0,0,.38)';ctx.lineWidth*=1.35;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i+=routeDrawStep)ctx.lineTo(pts[i].x,pts[i].y);let routeLast=pts[pts.length-1];ctx.lineTo(routeLast.x,routeLast.y);ctx.stroke();ctx.restore();ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i+=routeDrawStep)ctx.lineTo(pts[i].x,pts[i].y);routeLast=pts[pts.length-1];ctx.lineTo(routeLast.x,routeLast.y);ctx.stroke();";
    html = html.replace(route2d, route3d);

    const runway2d = `const c=colorForGroup(r.group);
    ctx.fillStyle=c;ctx.globalAlpha=.9;ctx.fillRect(-4,-w/2,7,w);ctx.globalAlpha=1;
    if(r.confirmFlashUntil>mapTime&&Math.floor(mapTime/125)%2===0){const fc=r.guidanceColor||c;ctx.save();ctx.globalCompositeOperation='lighter';ctx.fillStyle=fc;ctx.globalAlpha=.38;ctx.shadowColor=fc;ctx.shadowBlur=compactDevice?14:28;roundedRect(ctx,-8,-w/2,len+16,w,7);ctx.fill();ctx.restore()}
    if(r.guidanceAircraft&&r.guidanceColor){const reverse=r.guidanceEntry&&Math.hypot(r.guidanceEntry.x-r.end.x,r.guidanceEntry.y-r.end.y)<8,t=(mapTime*.00034)%1,localX=reverse?len*(1-t):len*t,glow=8+5*Math.sin(mapTime*.012);ctx.save();ctx.globalCompositeOperation='lighter';ctx.shadowColor=r.guidanceColor;ctx.shadowBlur=compactDevice?10:18;ctx.fillStyle=r.guidanceColor;ctx.globalAlpha=.98;ctx.beginPath();ctx.arc(localX,0,4.5,0,Math.PI*2);ctx.fill();ctx.globalAlpha=.22;ctx.beginPath();ctx.arc(localX,0,glow,0,Math.PI*2);ctx.fill();ctx.restore()}
    ctx.restore();`;

    const runway3d = `const c=colorForGroup(r.group);
    ctx.save();ctx.globalAlpha=.18;ctx.fillStyle='rgba(0,0,0,.74)';roundedRect(ctx,7,-w/2+7,len,w,Math.max(6,w*.08));ctx.fill();ctx.restore();
    const deck=ctx.createLinearGradient(0,-w/2,0,w/2);deck.addColorStop(0,'rgba(255,255,255,.08)');deck.addColorStop(.1,'rgba(255,255,255,.035)');deck.addColorStop(.5,'rgba(255,255,255,0)');deck.addColorStop(.9,'rgba(0,0,0,.13)');deck.addColorStop(1,'rgba(0,0,0,.24)');ctx.fillStyle=deck;roundedRect(ctx,0,-w/2,len,w,Math.max(6,w*.08));ctx.fill();
    ctx.fillStyle=c;ctx.globalAlpha=.95;ctx.fillRect(-4,-w/2,7,w);ctx.globalAlpha=1;ctx.fillStyle='rgba(255,255,255,.09)';ctx.fillRect(0,-w/2,len,2.2);ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(0,w/2-2.2,len,2.2);
    if(r.confirmFlashUntil>mapTime&&Math.floor(mapTime/125)%2===0){const fc=r.guidanceColor||c;ctx.save();ctx.globalCompositeOperation='lighter';ctx.fillStyle=fc;ctx.globalAlpha=.38;ctx.shadowColor=fc;ctx.shadowBlur=compactDevice?14:28;roundedRect(ctx,-8,-w/2,len+16,w,7);ctx.fill();ctx.restore()}
    if(r.guidanceAircraft&&r.guidanceColor){const reverse=r.guidanceEntry&&Math.hypot(r.guidanceEntry.x-r.end.x,r.guidanceEntry.y-r.end.y)<8,t=(mapTime*.00034)%1,localX=reverse?len*(1-t):len*t,glow=8+5*Math.sin(mapTime*.012);ctx.save();ctx.globalCompositeOperation='lighter';ctx.shadowColor=r.guidanceColor;ctx.shadowBlur=compactDevice?10:18;ctx.fillStyle=r.guidanceColor;ctx.globalAlpha=.98;ctx.beginPath();ctx.arc(localX,0,4.5,0,Math.PI*2);ctx.fill();ctx.globalAlpha=.22;ctx.beginPath();ctx.arc(localX,0,glow,0,Math.PI*2);ctx.fill();ctx.restore()}
    ctx.restore();`;
    html = html.replace(runway2d, runway3d);

    const aircraft2d = `const routeBlinkOff=a.routeBlink&&Math.floor(mapTime/500)%2===1;
    if(a.routeConfirmed){const pulse=22+4*Math.sin(mapTime*.009),markColor=a.color||colorForGroup(a.group);ctx.save();ctx.translate(a.x,a.y);ctx.globalCompositeOperation='lighter';ctx.strokeStyle=markColor;ctx.lineWidth=compactDevice?2:2.5;ctx.globalAlpha=.75;ctx.shadowColor=markColor;ctx.shadowBlur=compactDevice?8:16;ctx.beginPath();ctx.arc(0,0,pulse,0,Math.PI*2);ctx.stroke();ctx.globalCompositeOperation='source-over';ctx.shadowBlur=0;ctx.fillStyle=markColor;ctx.globalAlpha=.96;ctx.font='bold 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('✓',0,-pulse-7);ctx.font='bold 9px system-ui';ctx.fillText(a.confirmedRunwayLabel||'OK',0,pulse+10);ctx.restore()}
    ctx.save();ctx.globalAlpha=(a.state==='crashed'?a.crashAlpha:1)*(routeBlinkOff?.12:1);ctx.translate(a.x,a.y);ctx.rotate(a.heading);`;

    const aircraft3d = `const routeBlinkOff=a.routeBlink&&Math.floor(mapTime/500)%2===1;
    if(a.routeConfirmed){const pulse=22+4*Math.sin(mapTime*.009),markColor=a.color||colorForGroup(a.group);ctx.save();ctx.translate(a.x,a.y);ctx.globalCompositeOperation='lighter';ctx.strokeStyle=markColor;ctx.lineWidth=compactDevice?2:2.5;ctx.globalAlpha=.75;ctx.shadowColor=markColor;ctx.shadowBlur=compactDevice?8:16;ctx.beginPath();ctx.arc(0,0,pulse,0,Math.PI*2);ctx.stroke();ctx.globalCompositeOperation='source-over';ctx.shadowBlur=0;ctx.fillStyle=markColor;ctx.globalAlpha=.96;ctx.font='bold 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('✓',0,-pulse-7);ctx.font='bold 9px system-ui';ctx.fillText(a.confirmedRunwayLabel||'OK',0,pulse+10);ctx.restore()}
    if(a.state!=='crashed'){ctx.save();ctx.translate(a.x+8,a.y+10);ctx.scale(1,.62);ctx.globalAlpha=.2;ctx.fillStyle='rgba(0,0,0,.88)';ctx.beginPath();ctx.arc(0,0,Math.max(12,(a.size||12)*1.28),0,Math.PI*2);ctx.fill();ctx.restore()}
    ctx.save();ctx.globalAlpha=(a.state==='crashed'?a.crashAlpha:1)*(routeBlinkOff?.12:1);ctx.translate(a.x,a.y);ctx.rotate(a.heading);`;
    html = html.replace(aircraft2d, aircraft3d);

    return html;
  }

  document.write = (...chunks) => originalWrite(...chunks.map(applyAero3D));
})();
