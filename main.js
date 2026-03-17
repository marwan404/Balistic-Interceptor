// ════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════
const DT   = 0.012;
const MASS = 1.5;
const AREA = 0.018;

let sims      = [];
let particles = [];
let preview   = null;
let slowMode  = false;
let globalT   = 0;

// Camera
let cam = { x:-20, y:-20, scale:5, tx:5, ty:-20, ts:5 };

// Target
let tgt = { active:false, mode:'free', baseX:0, baseY:0, x:0, y:0, r:14, hit:false, hitTime:0 };

// Canvas
const canvas = document.getElementById('sim');
const ctx    = canvas.getContext('2d');

// ════════════════════════════════════════════════
// RESIZE
// ════════════════════════════════════════════════
function resize() {
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  // also resize graph canvases
  ['g-vy','g-vx','g-hd','g-sp'].forEach(id => {
    const c = document.getElementById(id);
    c.width  = c.clientWidth  || 200;
    c.height = c.clientHeight || 80;
  });
}
window.addEventListener('resize', resize);
setTimeout(resize, 100);

// ════════════════════════════════════════════════
// PARAMS
// ════════════════════════════════════════════════
function getParams() {
  return {
    h0:     +document.getElementById('sl-h0').value,
    theta:  +document.getElementById('sl-ang').value,
    v0:     +document.getElementById('sl-v0').value,
    wind:   +document.getElementById('sl-wind').value,
    cd:     +document.getElementById('sl-cd').value,
    rho:    +document.getElementById('sl-rho').value,
    g:      +document.getElementById('sl-g').value,
    bounce: +document.getElementById('sl-bounce').value,
  };
}

function initSim(p) {
  const rad = p.theta * Math.PI / 180;
  return {
    ...p,
    x: 0, y: p.h0,
    vx: p.v0 * Math.cos(rad),
    vy: p.v0 * Math.sin(rad),
    t: 0,
    trail: [],
    vyArr:[], vxArr:[], hdArr:[], spArr:[],
    fDx:0, fDy:0,
    maxH: p.h0, maxSpd: p.v0,
    done: false, hitTarget: false,
  };
}

// ════════════════════════════════════════════════
// TARGET POSITION (supports oscillation)
// ════════════════════════════════════════════════
function tgtPos(t) {
  if (tgt.mode !== 'evasive') return { x: tgt.baseX, y: tgt.baseY };
  return {
    x: tgt.baseX + Math.cos(t * 0.9) * 22,
    y: Math.max(tgt.r, tgt.baseY + Math.sin(t * 1.8) * 14),
  };
}

// ════════════════════════════════════════════════
// PHYSICS STEP
// ════════════════════════════════════════════════
function stepSim(s, isPreview=false, tOffset=0) {
  if (s.done) return;
  const steps = isPreview ? 1 : (slowMode ? 1 : 3);

  for (let i = 0; i < steps; i++) {
    const v = Math.hypot(s.vx, s.vy);
    let ax, ay;
    if (v > 0) {
      const Fd = 0.5 * s.rho * v * v * s.cd * AREA;
      s.fDx = -Fd * (s.vx / v);
      s.fDy = -Fd * (s.vy / v);
      ax = (s.fDx / MASS) + (s.wind / MASS);
      ay = (s.fDy / MASS) - s.g;
    } else {
      s.fDx = 0; s.fDy = 0;
      ax = s.wind / MASS;
      ay = -s.g;
    }

    s.vx += ax * DT;
    s.vy += ay * DT;
    s.x  += s.vx * DT;
    s.y  += s.vy * DT;
    s.t  += DT;

    const spd = Math.hypot(s.vx, s.vy);
    if (s.y > s.maxH)  s.maxH  = s.y;
    if (spd > s.maxSpd) s.maxSpd = spd;

    if (!isPreview) {
      // particles on thrust
      if (s.t < 2.5 && document.getElementById('tog-particles').checked) {
        if (Math.random() < 0.25) spawnParticle(s.x, s.y, -s.vx*0.15, -s.vy*0.15, 'fire');
      }

      s.trail.push({ x:s.x, y:s.y, speed:spd });
      if (s.t % 0.12 < DT + 0.005) {
        s.vyArr.push({ t:s.t, v:s.vy });
        s.vxArr.push({ t:s.t, v:s.vx });
        s.hdArr.push({ x:s.x, y:s.y  });
        s.spArr.push({ t:s.t, v:spd  });
      }

      // target hit check
      if (tgt.active && !tgt.hit && !s.hitTarget) {
        const d = Math.hypot(s.x - tgt.x, s.y - tgt.y);
        if (d < tgt.r + 1.5) {
          tgt.hit = true; tgt.hitTime = globalT;
          s.hitTarget = true; s.done = true;
          if (document.getElementById('tog-particles').checked) {
            for (let j=0;j<40;j++) spawnParticle(s.x,s.y,(Math.random()-0.5)*30,(Math.random()-0.5)*30,'fire');
          }
          flashHit();
          break;
        }
      }
    } else {
      if (Math.random() < 0.12) s.trail.push({ x:s.x, y:s.y });
      // preview hit pred
      if (tgt.active) {
        const pt = tgtPos(tOffset + s.t);
        if (Math.hypot(s.x - pt.x, s.y - pt.y) < tgt.r + 1) { s.done=true; break; }
      }
    }

    // Bounce / land
    if (s.y <= 0) {
      if (s.bounce > 0.01 && Math.abs(s.vy) > 1.5) {
        s.y = 0; s.vy = -s.vy * s.bounce; s.vx *= 0.8;
        if (document.getElementById('tog-particles').checked)
          for (let j=0;j<6;j++) spawnParticle(s.x,0,(Math.random()-0.5)*8,Math.random()*4,'smoke');
      } else {
        s.y = 0; s.done = true;
        if (!isPreview && document.getElementById('tog-particles').checked)
          for (let j=0;j<16;j++) spawnParticle(s.x,0,(Math.random()-0.5)*10,Math.random()*5,'smoke');
        if (!isPreview) s.trail.push({ x:s.x, y:0, speed:0 });
        break;
      }
    }
    if (s.t > 120) { s.done=true; break; }
  }
}

// ════════════════════════════════════════════════
// PARTICLES
// ════════════════════════════════════════════════
function spawnParticle(x, y, vx, vy, type) {
  particles.push({
    x, y,
    vx: vx + (Math.random()-0.5)*8,
    vy: vy + (Math.random()-0.5)*8,
    life: 1.0,
    decay: 0.025 + Math.random()*0.03,
    type,
    r: type==='fire' ? 2+Math.random()*2 : 3+Math.random()*3,
  });
}

function updateParticles() {
  particles.forEach(p => {
    p.x  += p.vx * DT * 2;
    p.y  += p.vy * DT * 2;
    p.vy -= 4 * DT;
    p.life -= p.decay;
  });
  particles = particles.filter(p => p.life > 0);
}

// ════════════════════════════════════════════════
// CAMERA
// ════════════════════════════════════════════════
function updateCamera() {
  const W = canvas.width, H = canvas.height;
  let minX=-15, maxX=60, minY=-5, maxY=40;

  const h0 = +document.getElementById('sl-h0').value;
  if (h0 > maxY) maxY = h0 + 10;

  if (tgt.active) {
    minX = Math.min(minX, tgt.x-25); maxX = Math.max(maxX, tgt.x+25);
    maxY = Math.max(maxY, tgt.y+25);
  }
  sims.forEach(s => {
    minX = Math.min(minX, s.x-15); maxX = Math.max(maxX, s.x+15);
    maxY = Math.max(maxY, s.y+15);
  });
  if (preview) preview.forEach(p => {
    minX = Math.min(minX, p.x-5); maxX = Math.max(maxX, p.x+10);
    maxY = Math.max(maxY, p.y+10);
  });

  const pad = 0.83;
  cam.ts = Math.max(0.5, Math.min(18, Math.min((W*pad)/(maxX-minX), (H*pad)/(maxY-minY))));
  cam.tx = minX - (W/cam.ts-(maxX-minX))*0.1;
  cam.ty = minY - (H/cam.ts-(maxY-minY))*0.1;

  const l = 0.07;
  cam.scale += (cam.ts - cam.scale)*l;
  cam.x     += (cam.tx - cam.x)*l;
  cam.y     += (cam.ty - cam.y)*l;
}

function wx(worldX) { return (worldX - cam.x) * cam.scale; }
function wy(worldY) { return canvas.height - (worldY - cam.y) * cam.scale; }

// ════════════════════════════════════════════════
// PREVIEW
// ════════════════════════════════════════════════
function buildPreview() {
  if (!document.getElementById('tog-preview').checked) { preview=null; return; }
  const s = initSim(getParams());
  while (!s.done && s.t < 100) stepSim(s, true, globalT);
  preview = s.trail;
}

// ════════════════════════════════════════════════
// SPEED COLOR
// ════════════════════════════════════════════════
function speedColor(ratio) {
  const r = Math.min(1, Math.max(0,ratio));
  return `rgb(${Math.round(79+160*r)},${Math.round(142*(1-r)+50*r)},${Math.round(247*(1-r)+50*r)})`;
}

// ════════════════════════════════════════════════
// DRAW ROCKET
// ════════════════════════════════════════════════
function drawRocket(x, y, vx, vy, hitTarget) {
  if (!document.getElementById('tog-rocket').checked) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(3, 1.5*cam.scale), 0, Math.PI*2);
    ctx.fillStyle = hitTarget ? '#10c97e' : '#4f8ef7';
    ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.stroke();
    return;
  }
  const ang = Math.atan2(vy, vx);
  const sz  = Math.max(8, Math.min(22, cam.scale * 3));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-ang + Math.PI/2);

  // Exhaust glow
  const grad = ctx.createRadialGradient(0, sz*0.6, 0, 0, sz*0.6, sz*0.8);
  grad.addColorStop(0, 'rgba(245,158,11,0.7)');
  grad.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.beginPath(); ctx.arc(0, sz*0.6, sz*0.8, 0, Math.PI*2);
  ctx.fillStyle = grad; ctx.fill();

  // Body
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.roundRect(-sz*0.18, -sz*0.6, sz*0.36, sz*1.1, sz*0.05);
  ctx.fill();

  // Nose cone
  ctx.fillStyle = hitTarget ? '#10c97e' : '#4f8ef7';
  ctx.beginPath();
  ctx.moveTo(-sz*0.18, -sz*0.6);
  ctx.lineTo(0, -sz);
  ctx.lineTo(sz*0.18, -sz*0.6);
  ctx.fill();

  // Fins
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath(); ctx.moveTo(-sz*0.18, sz*0.35); ctx.lineTo(-sz*0.45, sz*0.65); ctx.lineTo(-sz*0.18, sz*0.5); ctx.fill();
  ctx.beginPath(); ctx.moveTo(sz*0.18, sz*0.35);  ctx.lineTo(sz*0.45, sz*0.65);  ctx.lineTo(sz*0.18, sz*0.5);  ctx.fill();

  ctx.restore();
}

// ════════════════════════════════════════════════
// DRAW TRAIL
// ════════════════════════════════════════════════
function drawTrail(trail, colorBySpeed, fixedColor, dashed=false) {
  if (trail.length < 2) return;
  const maxSpd = Math.max(...trail.map(p=>p.speed||1), 1);
  if (dashed) ctx.setLineDash([4,7]);

  if (colorBySpeed && !fixedColor) {
    for (let i=1;i<trail.length;i++) {
      const a=trail[i-1], b=trail[i];
      ctx.beginPath();
      ctx.moveTo(wx(a.x),wy(a.y));
      ctx.lineTo(wx(b.x),wy(b.y));
      ctx.strokeStyle = speedColor((b.speed||0)/maxSpd);
      ctx.lineWidth=2.5; ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(wx(trail[0].x),wy(trail[0].y));
    for (let i=1;i<trail.length;i++) ctx.lineTo(wx(trail[i].x),wy(trail[i].y));
    ctx.strokeStyle = fixedColor||'#4f8ef7';
    ctx.lineWidth=2.5; ctx.stroke();
  }
  ctx.setLineDash([]);
}

// ════════════════════════════════════════════════
// DRAW ARROWS (force vectors)
// ════════════════════════════════════════════════
function drawArrow(sx, sy, vx, vy, color, scale=1) {
  const len = Math.hypot(vx,vy) * scale * cam.scale;
  if (len < 3) return;
  const ang = Math.atan2(vy, vx);
  const ex = sx + Math.cos(ang)*len;
  const ey = sy - Math.sin(ang)*len;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(ex,ey); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex,ey);
  ctx.lineTo(ex-7*Math.cos(ang-0.4), ey+7*Math.sin(ang-0.4));
  ctx.lineTo(ex-7*Math.cos(ang+0.4), ey+7*Math.sin(ang+0.4));
  ctx.fill();
}

// ════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════
function render() {
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);

  // Scanline texture
  ctx.fillStyle='rgba(0,0,0,0.04)';
  for (let y=0;y<H;y+=2) { ctx.fillRect(0,y,W,1); }

  // Adaptive grid
  if (document.getElementById('tog-grid').checked) {
    let step=10;
    if (cam.scale<1) step=100;
    else if (cam.scale<2.5) step=50;
    else if (cam.scale<6) step=25;

    ctx.strokeStyle='rgba(255,255,255,0.035)'; ctx.lineWidth=1;
    const startX=Math.floor(cam.x/step)*step;
    for (let x=startX; x<cam.x+W/cam.scale; x+=step) {
      ctx.beginPath(); ctx.moveTo(wx(x),0); ctx.lineTo(wx(x),H); ctx.stroke();
    }
    const startY=Math.floor(cam.y/step)*step;
    for (let y=startY; y<cam.y+H/cam.scale; y+=step) {
      ctx.beginPath(); ctx.moveTo(0,wy(y)); ctx.lineTo(W,wy(y)); ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle='rgba(90,104,130,0.7)';
    ctx.font=`${Math.max(8,Math.min(10,cam.scale*2))}px 'Share Tech Mono'`;
    for (let x=startX; x<cam.x+W/cam.scale; x+=step) {
      if (x>=0) ctx.fillText(x+'m', wx(x)+3, wy(0)+12);
    }
    for (let y=startY+step; y<cam.y+H/cam.scale; y+=step) {
      if (y>0) ctx.fillText(y+'m', wx(0)+3, wy(y)-3);
    }
  }

  // Ground
  const gy = wy(0);
  ctx.strokeStyle='rgba(46,55,80,0.8)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(W,gy); ctx.stroke();

  // Ground fill gradient
  const gfill = ctx.createLinearGradient(0,gy,0,gy+20);
  gfill.addColorStop(0,'rgba(30,37,53,0.5)');
  gfill.addColorStop(1,'rgba(30,37,53,0)');
  ctx.fillStyle=gfill;
  ctx.fillRect(0,gy,W,20);

  // Launch tower
  const h0 = +document.getElementById('sl-h0').value;
  if (h0 > 0) {
    const tw=5*cam.scale, th=h0*cam.scale;
    const tx=wx(0)-tw/2, ty=wy(h0);
    ctx.fillStyle='#111520';
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle='rgba(46,55,80,0.8)'; ctx.lineWidth=1;
    ctx.strokeRect(tx, ty, tw, th);
    // Horizontal struts
    ctx.strokeStyle='rgba(42,50,71,0.8)'; ctx.lineWidth=1;
    const struts=Math.floor(h0/15);
    for (let i=0;i<=struts;i++) {
      const sy2=wy(i*(h0/(struts+1)));
      ctx.beginPath(); ctx.moveTo(tx,sy2); ctx.lineTo(tx+tw,sy2); ctx.stroke();
    }
  }

  // Target
  if (tgt.active) {
    const tx=wx(tgt.x), ty=wy(tgt.y), tr=tgt.r*cam.scale;
    const hitAge = tgt.hit ? (globalT - tgt.hitTime) : -1;
    const pulse  = (hitAge>0&&hitAge<1.5) ? Math.sin(hitAge*14)*0.4 : 0;
    const drawR  = tr*(1+pulse);
    const col    = tgt.hit ? '#10c97e' : '#f05050';

    // Outer ring
    ctx.beginPath(); ctx.arc(tx,ty,drawR,0,Math.PI*2);
    ctx.strokeStyle=col; ctx.lineWidth=2;
    ctx.setLineDash([5,3]); ctx.stroke(); ctx.setLineDash([]);
    // Inner fill
    ctx.beginPath(); ctx.arc(tx,ty,drawR*0.45,0,Math.PI*2);
    ctx.fillStyle = tgt.hit ? 'rgba(16,201,126,0.25)' : 'rgba(240,80,80,0.15)';
    ctx.fill();
    // Crosshair
    ctx.strokeStyle=col; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(tx-drawR*1.4,ty); ctx.lineTo(tx-drawR*0.6,ty); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx+drawR*0.6,ty); ctx.lineTo(tx+drawR*1.4,ty); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx,ty-drawR*1.4); ctx.lineTo(tx,ty-drawR*0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx,ty+drawR*0.6); ctx.lineTo(tx,ty+drawR*1.4); ctx.stroke();
    // Range ring
    ctx.beginPath(); ctx.arc(tx,ty,drawR*1.8,0,Math.PI*2);
    ctx.strokeStyle=tgt.hit ? 'rgba(16,201,126,0.2)':'rgba(240,80,80,0.15)';
    ctx.lineWidth=1; ctx.stroke();
  }

  // Ghost preview
  if (preview && document.getElementById('tog-preview').checked) {
    ctx.globalAlpha=0.3;
    drawTrail(preview, false, '#64748b', true);
    ctx.globalAlpha=1;
  }

  // Projectile trails
  sims.forEach(s => {
    if (document.getElementById('tog-trace').checked && s.trail.length>1) {
      const useGrad = document.getElementById('tog-speed').checked && sims.length<4;
      drawTrail(s.trail, useGrad, useGrad ? null : '#4f8ef7');
    }
    // Rocket body
    const px=wx(s.x), py=wy(s.y);
    drawRocket(px, py, s.vx, s.vy, s.hitTarget);
    // Force vectors
    if (document.getElementById('tog-vectors').checked && !s.done) {
      drawArrow(px,py, s.vx, s.vy, '#10c97e', 0.09);
      drawArrow(px,py, s.fDx, s.fDy, '#f05050', 0.4);
      drawArrow(px,py, 0, -s.g*MASS, '#f59e0b', 0.4);
    }
  });

  // Particles
  if (document.getElementById('tog-particles').checked) {
    particles.forEach(p => {
      const px2=wx(p.x), py2=wy(p.y);
      if (p.type==='fire') {
        ctx.fillStyle=`rgba(${255},${Math.round(100+p.life*155)},0,${p.life*0.85})`;
      } else {
        ctx.fillStyle=`rgba(140,150,170,${p.life*0.6})`;
      }
      ctx.beginPath(); ctx.arc(px2,py2,p.r*(p.type==='fire'?1:1.4),0,Math.PI*2); ctx.fill();
    });
  }
}

// ════════════════════════════════════════════════
// GRAPHS
// ════════════════════════════════════════════════
function drawGraph(id, data, xKey, yKey, color) {
  const c = document.getElementById(id);
  if (!c || data.length<2) return;
  const gctx=c.getContext('2d'), W=c.width, H=c.height;
  gctx.clearRect(0,0,W,H);

  const xs=data.map(d=>d[xKey]), ys=data.map(d=>d[yKey]);
  const minX=Math.min(...xs), maxX=Math.max(...xs);
  const minY=Math.min(...ys), maxY=Math.max(...ys);
  const pad=14;
  const mx=v=>pad+(v-minX)/(maxX-minX+1e-9)*(W-pad*2);
  const my=v=>H-pad-(v-minY)/(maxY-minY+1e-9)*(H-pad*2);

  // Zero line
  if (minY<0&&maxY>0) {
    gctx.strokeStyle='rgba(255,255,255,0.06)'; gctx.lineWidth=1;
    gctx.setLineDash([3,3]);
    gctx.beginPath(); gctx.moveTo(pad,my(0)); gctx.lineTo(W-pad,my(0)); gctx.stroke();
    gctx.setLineDash([]);
  }

  // Area fill
  const grad=gctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,color.replace(')',',0.2)').replace('rgb','rgba'));
  grad.addColorStop(1,color.replace(')',',0)').replace('rgb','rgba'));
  gctx.beginPath();
  gctx.moveTo(mx(data[0][xKey]),H-pad);
  data.forEach(d=>gctx.lineTo(mx(d[xKey]),my(d[yKey])));
  gctx.lineTo(mx(data[data.length-1][xKey]),H-pad);
  gctx.closePath(); gctx.fillStyle=grad; gctx.fill();

  // Line
  gctx.beginPath();
  data.forEach((d,i)=>i===0?gctx.moveTo(mx(d[xKey]),my(d[yKey])):gctx.lineTo(mx(d[xKey]),my(d[yKey])));
  gctx.strokeStyle=color; gctx.lineWidth=1.5; gctx.stroke();

  // Labels
  gctx.fillStyle='rgba(90,104,130,0.8)'; gctx.font='9px Share Tech Mono';
  gctx.fillText(minY.toFixed(1), 2, my(minY)+4);
  gctx.fillText(maxY.toFixed(1), 2, my(maxY)+9);
}

// ════════════════════════════════════════════════
// HUD UPDATE
// ════════════════════════════════════════════════
function updateHUD() {
  document.getElementById('h-count').textContent='OBJECTS: '+sims.length;
  document.getElementById('h-time').textContent='T+'+globalT.toFixed(2)+'s';

  const s = sims[0];
  if (s) {
    document.getElementById('h-alt').textContent     = s.maxH.toFixed(1);
    document.getElementById('h-range').textContent   = s.x.toFixed(1);
    document.getElementById('h-vx').textContent      = s.vx.toFixed(1);
    document.getElementById('h-vy').textContent      = s.vy.toFixed(1);
    document.getElementById('h-simtime').textContent = s.t.toFixed(1);

    if (s.done && !s.hitTarget) {
      document.getElementById('st-maxh').textContent  = s.maxH.toFixed(1);
      document.getElementById('st-range').textContent = s.x.toFixed(1);
      document.getElementById('st-time').textContent  = s.t.toFixed(2);
      document.getElementById('st-spd').textContent   = s.maxSpd.toFixed(1);
    }
  }
}

// ════════════════════════════════════════════════
// HIT BANNER
// ════════════════════════════════════════════════
function flashHit() {
  const b=document.getElementById('hit-banner');
  b.style.opacity='1';
  setTimeout(()=>b.style.opacity='0', 1500);
}

// ════════════════════════════════════════════════
// LOOP
// ════════════════════════════════════════════════
function loop() {
  globalT += DT * (slowMode ? 1 : 3);

  // Update target position
  if (tgt.active) {
    const p = tgtPos(globalT);
    tgt.x = p.x; tgt.y = p.y;
  }

  let anyActive = false;
  sims.forEach(s => {
    stepSim(s);
    if (!s.done) anyActive=true;
  });

  updateParticles();
  updateCamera();
  render();
  if (anyActive) updateHUD();

  requestAnimationFrame(loop);
}

// ════════════════════════════════════════════════
// AUTO-AIM
// ════════════════════════════════════════════════
function runAutoAim() {
  if (!tgt.active) return;
  document.getElementById('ai-computing').style.display='block';

  setTimeout(() => {
    const env = getParams();
    let bestDist=Infinity, bestA=env.theta, bestV=env.v0;

    // Coarse scan
    for (let v=10; v<=280; v+=12) {
      for (let a=5; a<=85; a+=2.5) {
        const s=initSim({...env,v0:v,theta:a,bounce:0});
        let minD=Infinity;
        while(!s.done&&s.t<30) {
          stepSim(s,true,globalT);
          const pt=tgtPos(globalT+s.t);
          const d=Math.hypot(s.x-pt.x,s.y-pt.y);
          if(d<minD) minD=d;
          if(d<=tgt.r) break;
        }
        if(minD<bestDist) { bestDist=minD; bestA=a; bestV=v; }
        if(bestDist<=tgt.r) break;
      }
      if(bestDist<=tgt.r) break;
    }

    // Fine scan
    for (let v=Math.max(5,bestV-12); v<=bestV+12; v+=1) {
      for (let a=Math.max(1,bestA-4); a<=Math.min(89,bestA+4); a+=0.5) {
        const s=initSim({...env,v0:v,theta:a,bounce:0});
        let minD=Infinity;
        while(!s.done&&s.t<30) {
          stepSim(s,true,globalT);
          const pt=tgtPos(globalT+s.t);
          const d=Math.hypot(s.x-pt.x,s.y-pt.y);
          if(d<minD) minD=d;
          if(d<=tgt.r) break;
        }
        if(minD<bestDist) { bestDist=minD; bestA=a; bestV=v; }
      }
    }

    // Apply
    document.getElementById('sl-ang').value=bestA;
    document.getElementById('v-ang').textContent=bestA.toFixed(1)+'°';
    document.getElementById('sl-v0').value=bestV;
    document.getElementById('v-v0').textContent=bestV+' m/s';
    buildPreview();

    document.getElementById('ai-computing').style.display='none';
    launch();
  }, 20);
}

// ════════════════════════════════════════════════
// LAUNCH / RESET
// ════════════════════════════════════════════════
function launch() {
  clearStats();
  sims = [initSim(getParams())];
  globalT = 0;
  if (tgt.active) tgt.hit = false;
  buildPreview();
}

function launchVolley() {
  clearStats();
  const p=getParams(); sims=[]; globalT=0;
  if (tgt.active) tgt.hit=false;
  for (let i=-2;i<=2;i++) {
    sims.push(initSim({...p, theta:p.theta+i*4, v0:p.v0*(1+i*0.02)}));
  }
  buildPreview();
}

function reset() {
  sims=[]; particles=[]; globalT=0; preview=null;
  if (tgt.active) { tgt.hit=false; randomizeTarget(); }
  clearStats();
  ['g-vy','g-vx','g-hd','g-sp'].forEach(id=>{
    const c=document.getElementById(id);
    c.getContext('2d').clearRect(0,0,c.width,c.height);
  });
}

function clearStats() {
  ['st-maxh','st-range','st-time','st-spd'].forEach(id=>document.getElementById(id).textContent='—');
}

function randomizeTarget() {
  tgt.baseX = 90 + Math.random()*200;
  tgt.baseY = 15 + Math.random()*55;
  tgt.hit = false;
}

function toggleSlow() {
  slowMode = !slowMode;
  document.getElementById('btn-slow').classList.toggle('btn-active', slowMode);
}

// ════════════════════════════════════════════════
// SLIDER SYNC
// ════════════════════════════════════════════════
const sliderDefs = [
  ['sl-h0',     'v-h0',     v => v + ' m'],
  ['sl-ang',    'v-ang',    v => v + '°'],
  ['sl-v0',     'v-v0',     v => v + ' m/s'],
  ['sl-bounce', 'v-bounce', v => parseFloat(v).toFixed(2)],
  ['sl-wind',   'v-wind',   v => v + ' m/s'],
  ['sl-cd',     'v-cd',     v => parseFloat(v).toFixed(2)],
  ['sl-rho',    'v-rho',    v => parseFloat(v).toFixed(3)],
  ['sl-g',      'v-g',      v => parseFloat(v).toFixed(2)+' m/s²'],
];
sliderDefs.forEach(([sid,lid,fmt]) => {
  document.getElementById(sid).addEventListener('input', e => {
    document.getElementById(lid).textContent = fmt(e.target.value);
    buildPreview();
  });
});

// Mission mode
document.getElementById('mission').addEventListener('change', e => {
  const m = e.target.value;
  tgt.mode   = m;
  tgt.active = (m !== 'free');
  tgt.hit    = false;
  document.getElementById('h-status').textContent = tgt.active ? 'LOCKED' : 'NO_TARGET';
  document.getElementById('h-status').style.color = tgt.active ? 'var(--danger)' : 'var(--text-dim)';
  document.getElementById('btn-auto').style.display = tgt.active ? 'block' : 'none';
  if (tgt.active) randomizeTarget();
  buildPreview();
});

// Display toggles
document.getElementById('tog-vectors').addEventListener('change', e => {
  document.getElementById('vec-legend').style.display = e.target.checked ? 'flex' : 'none';
});
document.getElementById('tog-preview').addEventListener('change', buildPreview);

// Planet presets
const planetPresets = {
  earth:   { g:9.81,  rho:1.225 },
  moon:    { g:1.62,  rho:0.0   },
  mars:    { g:3.72,  rho:0.02  },
  jupiter: { g:24.8,  rho:0.16  },
  vacuum:  { g:9.81,  rho:0.0, cd:0, wind:0 },
};
document.getElementById('preset').addEventListener('change', e => {
  const p=planetPresets[e.target.value]; if(!p) return;
  if(p.g   !==undefined){document.getElementById('sl-g').value=p.g;    document.getElementById('v-g').textContent=p.g.toFixed(2)+' m/s²';}
  if(p.rho !==undefined){document.getElementById('sl-rho').value=p.rho;document.getElementById('v-rho').textContent=p.rho.toFixed(3);}
  if(p.cd  !==undefined){document.getElementById('sl-cd').value=p.cd;  document.getElementById('v-cd').textContent=p.cd.toFixed(2);}
  if(p.wind!==undefined){document.getElementById('sl-wind').value=p.wind;document.getElementById('v-wind').textContent=p.wind+' m/s';}
  buildPreview();
});

// Keyboard shortcut
document.addEventListener('keydown', e => {
  if (e.code==='Space'&&e.target.tagName!=='INPUT'&&e.target.tagName!=='SELECT') { e.preventDefault(); launch(); }
});

// Also update graphs from loop (call periodically)
let graphTimer=0;
const _origLoop = loop;
function graphLoop() {
  graphTimer++;
  if (graphTimer%6===0 && sims.length>0) {
    const s=sims[0];
    drawGraph('g-vy', s.vyArr, 't','v', 'rgb(16,201,126)');
    drawGraph('g-vx', s.vxArr, 't','v', 'rgb(79,142,247)');
    drawGraph('g-hd', s.hdArr, 'x','y', 'rgb(245,158,11)');
    drawGraph('g-sp', s.spArr, 't','v', 'rgb(167,139,250)');
  }
}

// Override loop to include graph updates
(function run() {
  globalT += DT * (slowMode ? 1 : 3);
  if (tgt.active) { const p=tgtPos(globalT); tgt.x=p.x; tgt.y=p.y; }
  let anyActive=false;
  sims.forEach(s=>{stepSim(s);if(!s.done)anyActive=true;});
  updateParticles();
  updateCamera();
  render();
  if (anyActive) updateHUD();
  graphLoop();
  requestAnimationFrame(run);
})();

buildPreview();
