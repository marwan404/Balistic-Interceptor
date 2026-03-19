// ══════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════
const DT = 0.012;
const MASS = 1.5;
const AREA = 0.018;

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
let sims = []; // player rockets — ADDITIVE, never cleared on fire
let particles = [];
let explosions = [];
let preview = null;
let slowMode = false;
let globalT = 0;
let killCount = 0;
let baseDestroyed = false;
let screenFlash = 0;

let cam = {
    x: -20,
    y: -20,
    scale: 5,
    tx: 5,
    ty: -20,
    ts: 5
};
let manualCam = false; // true = user has taken control; auto-track paused
let drag = {
    active: false,
    startX: 0,
    startY: 0,
    camX0: 0,
    camY0: 0
};
let paused = false;
let followMode = false;
let followScale = 12; // zoom level used in follow mode, adjustable via scroll

// Unified target / enemy object
let tgt = {
    active: false,
    mode: 'free',
    baseX: 150,
    baseY: 40,
    x: 150,
    y: 40,
    vx: 0,
    vy: 0,
    r: 14,
    hit: false,
    hitTime: 0,
    reachedBase: false,
    trail: [],
};

const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');

// ══════════════════════════════════════════════
// ZOOM & PAN INPUT
// ══════════════════════════════════════════════

function activateManual() {
    manualCam = true;
    const badge = document.getElementById('cam-badge');
    badge.textContent = 'MANUAL — click to auto-track';
    badge.classList.add('manual');
}

function cancelFollow() {
    followMode = false;
    document.getElementById('follow-badge').style.display = 'none';
    document.getElementById('btn-follow').classList.remove('btn-active');
    document.getElementById('btn-follow').textContent = '▶ FOLLOW ROCKET';
}

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;

    if (followMode) {
        // In follow mode: just adjust the follow zoom level, keep tracking
        followScale = Math.max(1, Math.min(40, followScale * factor));
        return;
    }

    // Normal manual zoom
    if (!manualCam) activateManual();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = mouseX / cam.scale + cam.x;
    const worldY = (canvas.height - mouseY) / cam.scale + cam.y;
    cam.scale = Math.max(0.15, Math.min(40, cam.scale * factor));
    cam.ts = cam.scale;
    cam.x = worldX - mouseX / cam.scale;
    cam.y = worldY - (canvas.height - mouseY) / cam.scale;
    cam.tx = cam.x;
    cam.ty = cam.y;
}, {
    passive: false
});

canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    // Dragging always cancels follow mode — user is taking manual control
    if (followMode) cancelFollow();
    if (!manualCam) activateManual();
    drag.active = true;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.camX0 = cam.x;
    drag.camY0 = cam.y;
    canvas.classList.add('dragging');
});

window.addEventListener('mousemove', e => {
    if (!drag.active) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    cam.x = drag.camX0 - dx / cam.scale;
    cam.y = drag.camY0 + dy / cam.scale;
    cam.tx = cam.x;
    cam.ty = cam.y;
});

window.addEventListener('mouseup', () => {
    drag.active = false;
    canvas.classList.remove('dragging');
});

// Touch support
canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
        if (followMode) cancelFollow();
        if (!manualCam) activateManual();
        drag.active = true;
        drag.startX = e.touches[0].clientX;
        drag.startY = e.touches[0].clientY;
        drag.camX0 = cam.x;
        drag.camY0 = cam.y;
    }
}, {
    passive: true
});

canvas.addEventListener('touchmove', e => {
    if (!drag.active || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - drag.startX;
    const dy = e.touches[0].clientY - drag.startY;
    cam.x = drag.camX0 - dx / cam.scale;
    cam.y = drag.camY0 + dy / cam.scale;
    cam.tx = cam.x;
    cam.ty = cam.y;
}, {
    passive: true
});

canvas.addEventListener('touchend', () => {
    drag.active = false;
});

// ══════════════════════════════════════════════
// RESIZE
// ══════════════════════════════════════════════
function resize() {
    canvas.width = canvas.clientWidth || 800;
    canvas.height = canvas.clientHeight || 400;
    ['g-vy', 'g-vx', 'g-hd', 'g-sp'].forEach(id => {
        const c = document.getElementById(id);
        c.width = c.clientWidth || 200;
        c.height = c.clientHeight || 80;
    });
}
window.addEventListener('resize', resize);
setTimeout(resize, 80);

// ══════════════════════════════════════════════
// PARAMS / SIM INIT
// ══════════════════════════════════════════════
function getParams() {
    return {
        h0: +document.getElementById('sl-h0').value,
        theta: +document.getElementById('sl-ang').value,
        v0: +document.getElementById('sl-v0').value,
        wind: +document.getElementById('sl-wind').value,
        cd: +document.getElementById('sl-cd').value,
        rho: +document.getElementById('sl-rho').value,
        g: +document.getElementById('sl-g').value,
        bounce: +document.getElementById('sl-bounce').value,
    };
}

function initSim(p) {
    const rad = p.theta * Math.PI / 180;
    return {
        ...p,
        x: 0,
        y: p.h0,
        vx: p.v0 * Math.cos(rad),
        vy: p.v0 * Math.sin(rad),
        t: 0,
        trail: [],
        vyArr: [],
        vxArr: [],
        hdArr: [],
        spArr: [],
        fDx: 0,
        fDy: 0,
        maxH: p.h0,
        maxSpd: p.v0,
        done: false,
        hitTarget: false,
    };
}

// ══════════════════════════════════════════════
// TARGET POSITION (for auto-aim prediction)
// ══════════════════════════════════════════════
function tgtPos(futureT) {
    if (tgt.mode === 'intercept') return {
        x: tgt.baseX,
        y: tgt.baseY
    };
    // Evasive: linear prediction from current position+velocity
    const dt = futureT - globalT;
    return {
        x: tgt.x + tgt.vx * dt,
        y: tgt.y + tgt.vy * dt
    };
}

// ══════════════════════════════════════════════
// ENEMY ROCKET STEP (evasive mode only)
// ══════════════════════════════════════════════
function stepEnemy() {
    if (!tgt.active || tgt.mode !== 'evasive' || tgt.hit || tgt.reachedBase || baseDestroyed) return;
    const steps = slowMode ? 1 : 3;
    for (let i = 0; i < steps; i++) {
        // Proportional homing toward (0,0) the base
        const dx = -tgt.x,
            dy = -tgt.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) break;
        const guidance = 14;
        tgt.vx += (dx / dist) * guidance * DT;
        tgt.vy += (dy / dist) * guidance * DT - 1.2 * DT;
        // Speed cap
        const spd = Math.hypot(tgt.vx, tgt.vy);
        if (spd > 58) {
            tgt.vx *= 58 / spd;
            tgt.vy *= 58 / spd;
        }
        tgt.x += tgt.vx * DT;
        tgt.y += tgt.vy * DT;
        // Trail
        if (Math.random() < 0.25) tgt.trail.push({
            x: tgt.x,
            y: tgt.y
        });
        // Thruster particles (blue — enemy color)
        if (document.getElementById('tog-particles').checked && Math.random() < 0.18)
            spawnParticle(tgt.x, tgt.y, -tgt.vx * 0.1, -tgt.vy * 0.1, 'enemy');
        // Check reached base
        if (Math.hypot(tgt.x, tgt.y) < 20) {
            tgt.reachedBase = true;
            baseDestroyed = true;
            spawnExplosion(0, 0, 2.8);
            screenFlash = 1.0;
            setTimeout(showBaseDestroyed, 700);
            break;
        }
    }
}

// ══════════════════════════════════════════════
// PHYSICS STEP
// ══════════════════════════════════════════════
function stepSim(s, isPreview = false, tOffset = 0) {
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
            s.fDx = 0;
            s.fDy = 0;
            ax = s.wind / MASS;
            ay = -s.g;
        }
        s.vx += ax * DT;
        s.vy += ay * DT;
        s.x += s.vx * DT;
        s.y += s.vy * DT;
        s.t += DT;
        const spd = Math.hypot(s.vx, s.vy);
        if (s.y > s.maxH) s.maxH = s.y;
        if (spd > s.maxSpd) s.maxSpd = spd;

        if (!isPreview) {
            // Thrust particles (first 2.5s)
            if (s.t < 2.5 && document.getElementById('tog-particles').checked && Math.random() < 0.2)
                spawnParticle(s.x, s.y, -s.vx * 0.15, -s.vy * 0.15, 'fire');
            s.trail.push({
                x: s.x,
                y: s.y,
                speed: spd
            });
            if (s.t % 0.12 < DT + 0.005) {
                s.vyArr.push({
                    t: s.t,
                    v: s.vy
                });
                s.vxArr.push({
                    t: s.t,
                    v: s.vx
                });
                s.hdArr.push({
                    x: s.x,
                    y: s.y
                });
                s.spArr.push({
                    t: s.t,
                    v: spd
                });
            }
            // Hit detection
            if (tgt.active && !tgt.hit && !s.hitTarget) {
                const d = Math.hypot(s.x - tgt.x, s.y - tgt.y);
                if (d < tgt.r + 2) {
                    tgt.hit = true;
                    tgt.hitTime = globalT;
                    s.hitTarget = true;
                    s.done = true;
                    spawnExplosion(tgt.x, tgt.y, 1.6);
                    screenFlash = 0.65;
                    killCount++;
                    document.getElementById('st-kills').textContent = killCount;
                    flashHit();
                    if (tgt.mode === 'evasive') setTimeout(respawnEnemy, 2400);
                    break;
                }
            }
        } else {
            if (Math.random() < 0.12) s.trail.push({
                x: s.x,
                y: s.y
            });
            if (tgt.active) {
                const pt = tgtPos(tOffset + s.t);
                if (Math.hypot(s.x - pt.x, s.y - pt.y) < tgt.r + 1) {
                    s.done = true;
                    break;
                }
            }
        }

        // Ground
        if (s.y <= 0) {
            if (s.bounce > 0.01 && Math.abs(s.vy) > 1.5) {
                s.y = 0;
                s.vy = -s.vy * s.bounce;
                s.vx *= 0.8;
                if (document.getElementById('tog-particles').checked)
                    for (let j = 0; j < 6; j++) spawnParticle(s.x, 0, (Math.random() - .5) * 8, Math.random() * 4, 'smoke');
            } else {
                s.y = 0;
                s.done = true;
                if (!isPreview) {
                    s.trail.push({
                        x: s.x,
                        y: 0,
                        speed: 0
                    });
                    spawnExplosion(s.x, 0, 0.55);
                }
                break;
            }
        }
        if (s.t > 120) {
            s.done = true;
            break;
        }
    }
}

// ══════════════════════════════════════════════
// PARTICLES
// ══════════════════════════════════════════════
function spawnParticle(x, y, vx, vy, type) {
    particles.push({
        x,
        y,
        vx: vx + (Math.random() - .5) * 8,
        vy: vy + (Math.random() - .5) * 8,
        life: 1.0,
        decay: 0.02 + Math.random() * 0.025,
        type,
        r: type === 'fire' || type === 'enemy' ? 1.5 + Math.random() * 2 : 2.5 + Math.random() * 3,
    });
}

function updateParticles() {
    particles.forEach(p => {
        p.x += p.vx * DT * 2.5;
        p.y += p.vy * DT * 2.5;
        p.vy -= (p.type === 'smoke' ? 1 : 3) * DT;
        p.life -= p.decay;
    });
    particles = particles.filter(p => p.life > 0);
    if (particles.length > 1400) particles.splice(0, 200);
}

// ══════════════════════════════════════════════
// EXPLOSIONS
// ══════════════════════════════════════════════
function spawnExplosion(x, y, scale = 1) {
    explosions.push({
        x,
        y,
        life: 1.0,
        r: 0,
        maxR: 48 * scale,
        scale
    });
    const fc = Math.round(40 * scale);
    for (let i = 0; i < fc; i++) {
        const a = Math.random() * Math.PI * 2,
            sp = 12 + Math.random() * 60 * scale;
        spawnParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 'fire');
    }
    const sc = Math.round(16 * scale);
    for (let i = 0; i < sc; i++) {
        const a = Math.random() * Math.PI * 2,
            sp = 6 + Math.random() * 20;
        spawnParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 'smoke');
    }
    const dc = Math.round(14 * scale);
    for (let i = 0; i < dc; i++) {
        const a = Math.random() * Math.PI * 2,
            sp = 20 + Math.random() * 65;
        particles.push({
            x,
            y,
            vx: Math.cos(a) * sp + (Math.random() - .5) * 8,
            vy: Math.sin(a) * sp + (Math.random() - .5) * 8,
            life: 1.0,
            decay: 0.01 + Math.random() * 0.015,
            type: 'debris',
            r: 1.5 + Math.random() * 2.5
        });
    }
}

function updateExplosions() {
    explosions.forEach(e => {
        e.r += (e.maxR - e.r) * .18;
        e.life -= 0.026;
    });
    explosions = explosions.filter(e => e.life > 0);
}

// ══════════════════════════════════════════════
// CAMERA
// ══════════════════════════════════════════════
function updateCamera() {
    // ── Follow mode: lock cam tightly on the newest active rocket ──
    if (followMode) {
        const active = sims.filter(s => !s.done);
        const target = active[active.length - 1] || sims[sims.length - 1];
        if (target) {
            const W = canvas.width,
                H = canvas.height;
            const speed = Math.hypot(target.vx, target.vy);
            const leadFactor = Math.min(3.5, speed * 0.04);
            const leadX = (target.vx / (speed || 1)) * leadFactor;
            const leadY = (target.vy / (speed || 1)) * leadFactor;
            const worldCenterX = target.x + leadX;
            const worldCenterY = target.y + leadY;
            const targetCamX = worldCenterX - W / (followScale * 2);
            const targetCamY = worldCenterY - H / (followScale * 2);
            cam.scale = followScale;
            cam.ts = followScale;
            cam.x = targetCamX;
            cam.tx = targetCamX;
            cam.y = targetCamY;
            cam.ty = targetCamY;
        }
        return;
    }
    if (manualCam) return; // user is panning/zooming manually
    const W = canvas.width,
        H = canvas.height;
    let minX = -25,
        maxX = 70,
        minY = -10,
        maxY = 55;
    const h0 = +document.getElementById('sl-h0').value;
    if (h0 > maxY) maxY = h0 + 12;
    if (tgt.active) {
        minX = Math.min(minX, tgt.x - 28);
        maxX = Math.max(maxX, tgt.x + 28);
        maxY = Math.max(maxY, tgt.y + 28);
    }
    sims.filter(s => !s.done || s.t < 10).forEach(s => {
        minX = Math.min(minX, s.x - 18);
        maxX = Math.max(maxX, s.x + 18);
        maxY = Math.max(maxY, s.y + 18);
    });
    if (preview) preview.forEach(p => {
        minX = Math.min(minX, p.x - 6);
        maxX = Math.max(maxX, p.x + 12);
        maxY = Math.max(maxY, p.y + 12);
    });
    const pad = 0.83;
    cam.ts = Math.max(0.5, Math.min(18, Math.min((W * pad) / (maxX - minX), (H * pad) / (maxY - minY))));
    cam.tx = minX - (W / cam.ts - (maxX - minX)) * .1;
    cam.ty = minY - (H / cam.ts - (maxY - minY)) * .1;
    const l = 0.07;
    cam.scale += (cam.ts - cam.scale) * l;
    cam.x += (cam.tx - cam.x) * l;
    cam.y += (cam.ty - cam.y) * l;
}

function toggleAutoTrack() {
    // If follow mode is on, turn it off first
    if (followMode) {
        toggleFollow();
        return;
    }
    manualCam = !manualCam;
    const badge = document.getElementById('cam-badge');
    if (manualCam) {
        badge.textContent = 'MANUAL — click to auto-track';
        badge.classList.add('manual');
    } else {
        badge.textContent = 'AUTO-TRACK';
        badge.classList.remove('manual');
    }
}

function togglePause() {
    paused = !paused;
    const btn = document.getElementById('btn-pause');
    const mobBtn = document.getElementById('mobile-btn-pause');
    const overlay = document.getElementById('pause-overlay');
    if (paused) {
        btn.textContent = '▶ RESUME';
        btn.classList.add('btn-active');
        if (mobBtn) {
            mobBtn.textContent = '▶ RESUME';
            mobBtn.classList.add('btn-active');
        }
        overlay.style.display = 'flex';
    } else {
        btn.textContent = '⏸ PAUSE';
        btn.classList.remove('btn-active');
        if (mobBtn) {
            mobBtn.textContent = '⏸ PAUSE';
            mobBtn.classList.remove('btn-active');
        }
        overlay.style.display = 'none';
    }
}

function toggleFollow() {
    followMode = !followMode;
    const fbadge = document.getElementById('follow-badge');
    const btn = document.getElementById('btn-follow');
    if (followMode) {
        // Entering follow mode — disable manual/auto-track messaging
        manualCam = false;
        document.getElementById('cam-badge').textContent = 'AUTO-TRACK';
        document.getElementById('cam-badge').classList.remove('manual');
        fbadge.style.display = 'block';
        btn.classList.add('btn-active');
        btn.textContent = '✕ STOP FOLLOWING';
    } else {
        fbadge.style.display = 'none';
        btn.classList.remove('btn-active');
        btn.textContent = '▶ FOLLOW ROCKET';
    }
}

function wx(X) {
    return (X - cam.x) * cam.scale;
}

function wy(Y) {
    return canvas.height - ((Y - cam.y) * cam.scale);
}

// ══════════════════════════════════════════════
// PREVIEW
// ══════════════════════════════════════════════
function buildPreview() {
    if (!document.getElementById('tog-preview').checked) {
        preview = null;
        return;
    }
    const s = initSim(getParams());
    while (!s.done && s.t < 100) stepSim(s, true, globalT);
    preview = s.trail;
}

function speedColor(r) {
    r = Math.min(1, Math.max(0, r));
    return `rgb(${Math.round(79+160*r)},${Math.round(142*(1-r)+50*r)},${Math.round(247*(1-r)+50*r)})`;
}

// ══════════════════════════════════════════════
// DRAW: PLAYER ROCKET
// ══════════════════════════════════════════════
function drawRocket(sx, sy, vx, vy, isHit) {
    if (!document.getElementById('tog-rocket').checked) {
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(3, 1.5 * cam.scale), 0, Math.PI * 2);
        ctx.fillStyle = isHit ? '#10c97e' : '#4f8ef7';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
        return;
    }
    const ang = Math.atan2(vy, vx),
        sz = Math.max(7, Math.min(20, cam.scale * 2.8));
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-ang + Math.PI / 2);
    // Exhaust glow
    const g = ctx.createRadialGradient(0, sz * .6, 0, 0, sz * .6, sz * .9);
    g.addColorStop(0, 'rgba(245,158,11,.78)');
    g.addColorStop(1, 'rgba(245,158,11,0)');
    ctx.beginPath();
    ctx.arc(0, sz * .6, sz * .9, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // Body
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.roundRect(-sz * .17, -sz * .55, sz * .34, sz * 1.05, sz * .05);
    ctx.fill();
    // Nose
    ctx.fillStyle = isHit ? '#10c97e' : '#4f8ef7';
    ctx.beginPath();
    ctx.moveTo(-sz * .17, -sz * .55);
    ctx.lineTo(0, -sz * .95);
    ctx.lineTo(sz * .17, -sz * .55);
    ctx.fill();
    // Window
    ctx.fillStyle = isHit ? 'rgba(16,201,126,.6)' : 'rgba(100,160,255,.5)';
    ctx.beginPath();
    ctx.arc(0, -sz * .26, sz * .1, 0, Math.PI * 2);
    ctx.fill();
    // Fins
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(-sz * .17, sz * .28);
    ctx.lineTo(-sz * .42, sz * .6);
    ctx.lineTo(-sz * .17, sz * .44);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sz * .17, sz * .28);
    ctx.lineTo(sz * .42, sz * .6);
    ctx.lineTo(sz * .17, sz * .44);
    ctx.fill();
    ctx.restore();
}

// ══════════════════════════════════════════════
// DRAW: ENEMY ROCKET (dark red)
// ══════════════════════════════════════════════
function drawEnemyRocket(sx, sy, vx, vy) {
    if (!document.getElementById('tog-rocket').checked) {
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(4, 1.8 * cam.scale), 0, Math.PI * 2);
        ctx.fillStyle = '#f05050';
        ctx.fill();
        ctx.strokeStyle = '#ff8080';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        return;
    }
    const ang = Math.atan2(vy, vx),
        sz = Math.max(7, Math.min(22, cam.scale * 2.8));
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-ang + Math.PI / 2);
    // Blue thruster
    const g = ctx.createRadialGradient(0, sz * .6, 0, 0, sz * .6, sz * .9);
    g.addColorStop(0, 'rgba(60,130,255,.85)');
    g.addColorStop(1, 'rgba(60,130,255,0)');
    ctx.beginPath();
    ctx.arc(0, sz * .6, sz * .9, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // Body dark
    ctx.fillStyle = '#280a0a';
    ctx.beginPath();
    ctx.roundRect(-sz * .17, -sz * .55, sz * .34, sz * 1.05, sz * .05);
    ctx.fill();
    // Red stripe
    ctx.fillStyle = 'rgba(240,60,60,.4)';
    ctx.fillRect(-sz * .17, -sz * .12, sz * .34, sz * .2);
    // Red nose
    ctx.fillStyle = '#ef4040';
    ctx.beginPath();
    ctx.moveTo(-sz * .17, -sz * .55);
    ctx.lineTo(0, -sz * .95);
    ctx.lineTo(sz * .17, -sz * .55);
    ctx.fill();
    // Warhead glow dot
    ctx.fillStyle = 'rgba(255,80,80,.75)';
    ctx.beginPath();
    ctx.arc(0, -sz * .84, sz * .09, 0, Math.PI * 2);
    ctx.fill();
    // Dark red fins
    ctx.fillStyle = '#7a1a1a';
    ctx.beginPath();
    ctx.moveTo(-sz * .17, sz * .28);
    ctx.lineTo(-sz * .45, sz * .62);
    ctx.lineTo(-sz * .17, sz * .46);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sz * .17, sz * .28);
    ctx.lineTo(sz * .45, sz * .62);
    ctx.lineTo(sz * .17, sz * .46);
    ctx.fill();
    ctx.restore();
}

// ══════════════════════════════════════════════
// DRAW: BASE
// ══════════════════════════════════════════════
function drawBase() {
    const bx = wx(0),
        by = wy(0);
    if (baseDestroyed) {
        ctx.fillStyle = '#2a1208';
        ctx.beginPath();
        ctx.roundRect(bx - 18, by - 4, 36, 4, 1);
        ctx.fill();
        ctx.fillStyle = '#1c0c04';
        ctx.fillRect(bx - 10, by - 8, 18, 4);
        return;
    }
    // Bunker
    ctx.fillStyle = '#151e30';
    ctx.strokeStyle = '#253045';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx - 22, by - 11, 44, 11, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1c2840';
    ctx.fillRect(bx - 18, by - 15, 36, 4);
    // Mast
    ctx.strokeStyle = '#3a4c6a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by - 15);
    ctx.lineTo(bx, by - 27);
    ctx.stroke();
    // Dish
    ctx.strokeStyle = '#4f8ef7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by - 27, 7, Math.PI + .4, Math.PI * 2 - .4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx, by - 27, 4, Math.PI + .4, Math.PI * 2 - .4);
    ctx.stroke();
    ctx.fillStyle = '#4f8ef7';
    ctx.beginPath();
    ctx.arc(bx, by - 27, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Label
    ctx.fillStyle = 'rgba(79,142,247,.65)';
    ctx.font = `${Math.max(7,Math.min(9,cam.scale))}px Share Tech Mono`;
    ctx.textAlign = 'center';
    ctx.fillText('BASE', bx, by - 31);
    ctx.textAlign = 'left';
}

// ══════════════════════════════════════════════
// DRAW: TRAIL
// ══════════════════════════════════════════════
function drawTrail(trail, colorBySpeed, fixedColor, dashed = false) {
    if (trail.length < 2) return;
    const maxSpd = Math.max(...trail.map(p => p.speed || 1), 1);
    if (dashed) ctx.setLineDash([4, 7]);
    if (colorBySpeed && !fixedColor) {
        for (let i = 1; i < trail.length; i++) {
            const a = trail[i - 1],
                b = trail[i];
            ctx.beginPath();
            ctx.moveTo(wx(a.x), wy(a.y));
            ctx.lineTo(wx(b.x), wy(b.y));
            ctx.strokeStyle = speedColor((b.speed || 0) / maxSpd);
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
    } else {
        ctx.beginPath();
        ctx.moveTo(wx(trail[0].x), wy(trail[0].y));
        for (let i = 1; i < trail.length; i++) ctx.lineTo(wx(trail[i].x), wy(trail[i].y));
        ctx.strokeStyle = fixedColor || '#4f8ef7';
        ctx.lineWidth = 2.5;
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

// ══════════════════════════════════════════════
// DRAW: FORCE ARROW
// ══════════════════════════════════════════════
function drawArrow(sx, sy, vx, vy, col, scale = 1) {
    const len = Math.hypot(vx, vy) * scale * cam.scale;
    if (len < 3) return;
    const ang = Math.atan2(vy, vx),
        ex = sx + Math.cos(ang) * len,
        ey = sy - Math.sin(ang) * len;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 7 * Math.cos(ang - .4), ey + 7 * Math.sin(ang - .4));
    ctx.lineTo(ex - 7 * Math.cos(ang + .4), ey + 7 * Math.sin(ang + .4));
    ctx.fill();
}

// ══════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════
function render() {
    const W = canvas.width,
        H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // Scanlines
    ctx.fillStyle = 'rgba(0,0,0,.032)';
    for (let y = 0; y < H; y += 2) ctx.fillRect(0, y, W, 1);

    // Grid
    if (document.getElementById('tog-grid').checked) {
        let step = 10;
        if (cam.scale < 1) step = 100;
        else if (cam.scale < 2.5) step = 50;
        else if (cam.scale < 6) step = 25;
        ctx.strokeStyle = 'rgba(255,255,255,.03)';
        ctx.lineWidth = 1;
        const startX = Math.floor(cam.x / step) * step;
        for (let x = startX; x < cam.x + W / cam.scale; x += step) {
            ctx.beginPath();
            ctx.moveTo(wx(x), 0);
            ctx.lineTo(wx(x), H);
            ctx.stroke();
        }
        const startY = Math.floor(cam.y / step) * step;
        for (let y = startY; y < cam.y + H / cam.scale; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, wy(y));
            ctx.lineTo(W, wy(y));
            ctx.stroke();
        }
        ctx.fillStyle = 'rgba(90,104,130,.6)';
        ctx.font = `${Math.max(8,Math.min(10,cam.scale*2))}px Share Tech Mono`;
        for (let x = startX; x < cam.x + W / cam.scale; x += step)
            if (x >= 0) ctx.fillText(x + 'm', wx(x) + 3, wy(0) + 13);
        for (let y = startY + step; y < cam.y + H / cam.scale; y += step)
            if (y > 0) ctx.fillText(y + 'm', wx(0) + 3, wy(y) - 3);
    }

    // Ground
    const gy = wy(0);
    ctx.strokeStyle = 'rgba(42,50,72,.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(W, gy);
    ctx.stroke();
    const gfill = ctx.createLinearGradient(0, gy, 0, gy + 26);
    gfill.addColorStop(0, 'rgba(22,32,50,.6)');
    gfill.addColorStop(1, 'rgba(22,32,50,0)');
    ctx.fillStyle = gfill;
    ctx.fillRect(0, gy, W, 26);

    // Launch tower
    const h0 = +document.getElementById('sl-h0').value;
    if (h0 > 0) {
        const tw = 4 * cam.scale,
            th = h0 * cam.scale,
            tx = wx(0) - tw / 2,
            ty = wy(h0);
        ctx.fillStyle = '#101820';
        ctx.fillRect(tx, ty, tw, th);
        ctx.strokeStyle = 'rgba(38,48,68,.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx, ty, tw, th);
        const struts = Math.max(1, Math.floor(h0 / 18));
        ctx.strokeStyle = 'rgba(32,42,60,.8)';
        for (let i = 1; i < struts; i++) {
            const sy2 = wy(i * (h0 / struts));
            ctx.beginPath();
            ctx.moveTo(tx, sy2);
            ctx.lineTo(tx + tw, sy2);
            ctx.stroke();
        }
    }

    // Base
    drawBase();

    // ── STATIC TARGET: enemy rocket hovering ──
    if (tgt.active && tgt.mode === 'intercept' && !tgt.hit) {
        // Bracket lock-on corners
        const br = tgt.r * cam.scale * 1.7,
            ex2 = wx(tgt.x),
            ey2 = wy(tgt.y);
        ctx.strokeStyle = 'rgba(240,80,80,.55)';
        ctx.lineWidth = 1.5;
        [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1]
        ].forEach(([sx2, sy2]) => {
            ctx.beginPath();
            ctx.moveTo(ex2 + sx2 * br, ey2 + sy2 * br);
            ctx.lineTo(ex2 + sx2 * br - sx2 * 9, ey2 + sy2 * br);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(ex2 + sx2 * br, ey2 + sy2 * br);
            ctx.lineTo(ex2 + sx2 * br, ey2 + sy2 * br - sy2 * 9);
            ctx.stroke();
        });
        ctx.beginPath();
        ctx.arc(ex2, ey2, tgt.r * cam.scale * 2.4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(240,80,80,.1)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Draw stationary enemy rocket pointing down toward base
        drawEnemyRocket(ex2, ey2, 0, -1);
    }

    // ── EVASIVE: homing enemy rocket ──
    if (tgt.active && tgt.mode === 'evasive' && !tgt.hit && !tgt.reachedBase) {
        // Trail
        if (tgt.trail.length > 1) {
            ctx.beginPath();
            ctx.moveTo(wx(tgt.trail[0].x), wy(tgt.trail[0].y));
            for (let i = 1; i < tgt.trail.length; i++) ctx.lineTo(wx(tgt.trail[i].x), wy(tgt.trail[i].y));
            ctx.strokeStyle = 'rgba(220,50,50,.3)';
            ctx.lineWidth = 1.8;
            ctx.stroke();
        }
        drawEnemyRocket(wx(tgt.x), wy(tgt.y), tgt.vx, tgt.vy);
        // Distance warning — red tint as enemy approaches
        const proximity = Math.min(1, Math.max(0, 1 - Math.hypot(tgt.x, tgt.y) / 90));
        if (proximity > 0) {
            ctx.fillStyle = `rgba(220,40,40,${proximity*.14})`;
            ctx.fillRect(0, 0, W, H);
        }
    }

    // Ghost preview
    if (preview && document.getElementById('tog-preview').checked) {
        ctx.globalAlpha = .28;
        drawTrail(preview, false, '#64748b', true);
        ctx.globalAlpha = 1;
    }

    // Player rockets
    const useGrad = document.getElementById('tog-speed').checked && sims.length < 6;
    sims.forEach(s => {
        if (document.getElementById('tog-trace').checked && s.trail.length > 1)
            drawTrail(s.trail, useGrad, useGrad ? null : '#4f8ef7');
        const px = wx(s.x),
            py = wy(s.y);
        if (!s.done || s.hitTarget) drawRocket(px, py, s.vx, s.vy, s.hitTarget);
        if (document.getElementById('tog-vectors').checked && !s.done) {
            drawArrow(px, py, s.vx, s.vy, '#10c97e', .09);
            drawArrow(px, py, s.fDx, s.fDy, '#f05050', .4);
            drawArrow(px, py, 0, -s.g * MASS, '#f59e0b', .4);
        }
    });

    // Explosions
    explosions.forEach(e => {
        const ex = wx(e.x),
            ey = wy(e.y),
            fr = e.r * cam.scale;
        // Fireball gradient
        const fg = ctx.createRadialGradient(ex, ey, 0, ex, ey, fr);
        fg.addColorStop(0, `rgba(255,255,200,${e.life*.95})`);
        fg.addColorStop(.2, `rgba(255,160,20,${e.life*.85})`);
        fg.addColorStop(.55, `rgba(200,50,0,${e.life*.55})`);
        fg.addColorStop(1, 'rgba(80,20,0,0)');
        ctx.beginPath();
        ctx.arc(ex, ey, fr, 0, Math.PI * 2);
        ctx.fillStyle = fg;
        ctx.fill();
        // Primary shockwave
        const ringR = e.maxR * (1 - e.life) * cam.scale * 1.85 + fr * .3;
        ctx.beginPath();
        ctx.arc(ex, ey, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,200,80,${e.life*.38})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // Secondary ring
        ctx.beginPath();
        ctx.arc(ex, ey, ringR * 1.45, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(180,80,30,${e.life*.18})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    });

    // Particles
    if (document.getElementById('tog-particles').checked) {
        particles.forEach(p => {
            const px = wx(p.x),
                py = wy(p.y);
            if (p.type === 'fire')
                ctx.fillStyle = `rgba(255,${Math.round(90+p.life*165)},0,${p.life*.88})`;
            else if (p.type === 'enemy')
                ctx.fillStyle = `rgba(60,${Math.round(100+p.life*80)},255,${p.life*.72})`;
            else if (p.type === 'debris')
                ctx.fillStyle = `rgba(175,155,125,${p.life*.88})`;
            else
                ctx.fillStyle = `rgba(135,148,170,${p.life*.5})`;
            ctx.beginPath();
            ctx.arc(px, py, p.r, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Screen flash
    if (screenFlash > 0.01) {
        ctx.fillStyle = `rgba(255,200,80,${screenFlash*.26})`;
        ctx.fillRect(0, 0, W, H);
        screenFlash *= 0.7;
    }

    // HUD readout
    document.getElementById('h-count').textContent = 'ROCKETS: ' + sims.filter(s => !s.done).length;
    document.getElementById('h-time').textContent = 'T+' + globalT.toFixed(2) + 's';
    document.getElementById('h-rcount').textContent = sims.filter(s => !s.done).length;
    const prim = sims[sims.length - 1];
    if (prim) {
        document.getElementById('h-alt').textContent = prim.maxH.toFixed(1);
        document.getElementById('h-range').textContent = prim.x.toFixed(1);
        document.getElementById('h-vx').textContent = prim.vx.toFixed(1);
        document.getElementById('h-vy').textContent = prim.vy.toFixed(1);
        if (prim.done && !prim.hitTarget) {
            document.getElementById('st-maxh').textContent = prim.maxH.toFixed(1);
            document.getElementById('st-range').textContent = prim.x.toFixed(1);
            document.getElementById('st-time').textContent = prim.t.toFixed(2);
        }
    }
}

// ══════════════════════════════════════════════
// GRAPHS
// ══════════════════════════════════════════════

// graph config lookup
const GRAPH_CFG = {
    'g-vy': {
        label: 'VY / TIME',
        xKey: 't',
        yKey: 'v',
        color: 'rgb(16,201,126)',
        data: () => sims.length ? sims[sims.length - 1].vyArr : []
    },
    'g-vx': {
        label: 'VX / TIME',
        xKey: 't',
        yKey: 'v',
        color: 'rgb(79,142,247)',
        data: () => sims.length ? sims[sims.length - 1].vxArr : []
    },
    'g-hd': {
        label: 'HEIGHT / DIST',
        xKey: 'x',
        yKey: 'y',
        color: 'rgb(245,158,11)',
        data: () => sims.length ? sims[sims.length - 1].hdArr : []
    },
    'g-sp': {
        label: 'SPEED / TIME',
        xKey: 't',
        yKey: 'v',
        color: 'rgb(167,139,250)',
        data: () => sims.length ? sims[sims.length - 1].spArr : []
    },
};

function drawGraph(idOrCanvas, data, xKey, yKey, color) {
    const c = typeof idOrCanvas === 'string' ? document.getElementById(idOrCanvas) : idOrCanvas;
    if (!c || data.length < 2) return;
    const gctx = c.getContext('2d'),
        W = c.width,
        H = c.height;
    gctx.clearRect(0, 0, W, H);
    const xs = data.map(d => d[xKey]),
        ys = data.map(d => d[yKey]);
    const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys);
    const pad = typeof idOrCanvas === 'string' ? 14 : 32; // more padding in expanded view
    const mx = v => pad + (v - minX) / (maxX - minX + 1e-9) * (W - pad * 2);
    const my = v => H - pad - (v - minY) / (maxY - minY + 1e-9) * (H - pad * 2);

    // Zero line
    if (minY < 0 && maxY > 0) {
        gctx.strokeStyle = 'rgba(255,255,255,.08)';
        gctx.lineWidth = 1;
        gctx.setLineDash([4, 4]);
        gctx.beginPath();
        gctx.moveTo(pad, my(0));
        gctx.lineTo(W - pad, my(0));
        gctx.stroke();
        gctx.setLineDash([]);
    }

    // Subtle horizontal grid in expanded view
    if (typeof idOrCanvas !== 'string') {
        gctx.strokeStyle = 'rgba(255,255,255,.04)';
        gctx.lineWidth = 1;
        const steps = 5;
        for (let i = 0; i <= steps; i++) {
            const v = minY + (maxY - minY) * i / steps;
            gctx.beginPath();
            gctx.moveTo(pad, my(v));
            gctx.lineTo(W - pad, my(v));
            gctx.stroke();
        }
    }

    // Area fill
    const grad = gctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color.replace(')', ',0.2)').replace('rgb', 'rgba'));
    grad.addColorStop(1, color.replace(')', ',0)').replace('rgb', 'rgba'));
    gctx.beginPath();
    gctx.moveTo(mx(data[0][xKey]), H - pad);
    data.forEach(d => gctx.lineTo(mx(d[xKey]), my(d[yKey])));
    gctx.lineTo(mx(data[data.length - 1][xKey]), H - pad);
    gctx.closePath();
    gctx.fillStyle = grad;
    gctx.fill();

    // Line
    gctx.beginPath();
    data.forEach((d, i) => i === 0 ? gctx.moveTo(mx(d[xKey]), my(d[yKey])) : gctx.lineTo(mx(d[xKey]), my(d[yKey])));
    gctx.strokeStyle = color;
    gctx.lineWidth = typeof idOrCanvas === 'string' ? 1.5 : 2;
    gctx.stroke();

    // Axis labels
    const fs = typeof idOrCanvas === 'string' ? 9 : 11;
    gctx.fillStyle = 'rgba(90,104,130,.85)';
    gctx.font = `${fs}px Share Tech Mono`;
    if (typeof idOrCanvas === 'string') {
        gctx.fillText(minY.toFixed(1), 2, my(minY) + 4);
        gctx.fillText(maxY.toFixed(1), 2, my(maxY) + 9);
    } else {
        // Full axis labels in expanded view
        const steps = 5;
        for (let i = 0; i <= steps; i++) {
            const v = minY + (maxY - minY) * i / steps;
            gctx.fillText(v.toFixed(1), 2, my(v) + 4);
        }
        // X axis labels
        const xSteps = 8;
        for (let i = 0; i <= xSteps; i++) {
            const v = minX + (maxX - minX) * i / xSteps;
            gctx.fillText(v.toFixed(1), mx(v) - 10, H - 4);
        }
        // End-point dot
        const last = data[data.length - 1];
        gctx.fillStyle = color;
        gctx.beginPath();
        gctx.arc(mx(last[xKey]), my(last[yKey]), 4, 0, Math.PI * 2);
        gctx.fill();
    }
}

// Modal state
let expandedGraph = null;

function openGraph(id) {
    const cfg = GRAPH_CFG[id];
    if (!cfg) return;
    expandedGraph = id;
    document.getElementById('graph-modal-title').textContent = cfg.label;
    document.getElementById('graph-modal').classList.add('open');
    // Size canvas to its rendered size
    const mc = document.getElementById('graph-modal-canvas');
    mc.width = mc.clientWidth || 760;
    mc.height = mc.clientHeight || 320;
    // Draw immediately
    drawGraph(mc, cfg.data(), cfg.xKey, cfg.yKey, cfg.color);
}

function closeGraph() {
    expandedGraph = null;
    document.getElementById('graph-modal').classList.remove('open');
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeGraph();
});

let gTick = 0;

function updateGraphs() {
    if (++gTick % 6 !== 0 || sims.length === 0) return;
    const s = sims[sims.length - 1];
    drawGraph('g-vy', s.vyArr, 't', 'v', 'rgb(16,201,126)');
    drawGraph('g-vx', s.vxArr, 't', 'v', 'rgb(79,142,247)');
    drawGraph('g-hd', s.hdArr, 'x', 'y', 'rgb(245,158,11)');
    drawGraph('g-sp', s.spArr, 't', 'v', 'rgb(167,139,250)');
    // Mirror to expanded modal if open
    if (expandedGraph) {
        const cfg = GRAPH_CFG[expandedGraph];
        const mc = document.getElementById('graph-modal-canvas');
        if (mc.width < 100) {
            mc.width = mc.clientWidth || 760;
            mc.height = mc.clientHeight || 320;
        }
        drawGraph(mc, cfg.data(), cfg.xKey, cfg.yKey, cfg.color);
    }
}

// ══════════════════════════════════════════════
// BANNERS
// ══════════════════════════════════════════════
function flashHit() {
    const b = document.getElementById('hit-banner');
    b.style.opacity = '1';
    setTimeout(() => b.style.opacity = '0', 1700);
}

function showBaseDestroyed() {
    document.getElementById('bs-kills-txt').textContent =
        `intercepted ${killCount} missile${killCount!==1?'s':''} before base fell`;
    document.getElementById('base-screen').classList.add('show');
}

function restartMission() {
    document.getElementById('base-screen').classList.remove('show');
    baseDestroyed = false;
    killCount = 0;
    document.getElementById('st-kills').textContent = '0';
    sims = [];
    particles = [];
    explosions = [];
    preview = null;
    globalT = 0;
    screenFlash = 0;
    if (tgt.active) randomizeTarget();
    buildPreview();
}

// ══════════════════════════════════════════════
// AUTO-AIM
// ══════════════════════════════════════════════
function runAutoAim() {
    if (!tgt.active) return;
    document.getElementById('ai-msg').style.display = 'block';
    setTimeout(() => {
        const env = getParams();
        let bd = Infinity,
            ba = env.theta,
            bv = env.v0;
        for (let v = 10; v <= 280; v += 12) {
            for (let a = 5; a <= 85; a += 2.5) {
                const s = initSim({
                    ...env,
                    v0: v,
                    theta: a,
                    bounce: 0
                });
                let md = Infinity;
                while (!s.done && s.t < 30) {
                    stepSim(s, true, globalT);
                    const pt = tgtPos(globalT + s.t);
                    const d = Math.hypot(s.x - pt.x, s.y - pt.y);
                    if (d < md) md = d;
                    if (d <= tgt.r) break;
                }
                if (md < bd) {
                    bd = md;
                    ba = a;
                    bv = v;
                }
                if (bd <= tgt.r) break;
            }
            if (bd <= tgt.r) break;
        }
        for (let v = Math.max(5, bv - 12); v <= bv + 12; v += 1) {
            for (let a = Math.max(1, ba - 4); a <= Math.min(89, ba + 4); a += .5) {
                const s = initSim({
                    ...env,
                    v0: v,
                    theta: a,
                    bounce: 0
                });
                let md = Infinity;
                while (!s.done && s.t < 30) {
                    stepSim(s, true, globalT);
                    const pt = tgtPos(globalT + s.t);
                    const d = Math.hypot(s.x - pt.x, s.y - pt.y);
                    if (d < md) md = d;
                    if (d <= tgt.r) break;
                }
                if (md < bd) {
                    bd = md;
                    ba = a;
                    bv = v;
                }
            }
        }
        document.getElementById('sl-ang').value = ba;
        document.getElementById('v-ang').textContent = ba.toFixed(1) + '°';
        document.getElementById('sl-v0').value = bv;
        document.getElementById('v-v0').textContent = bv + ' m/s';
        buildPreview();
        document.getElementById('ai-msg').style.display = 'none';
        launch();
    }, 20);
}

// ══════════════════════════════════════════════
// LAUNCH (ADDITIVE — never resets sim)
// ══════════════════════════════════════════════
function launch() {
    if (baseDestroyed) return;
    sims.push(initSim(getParams()));
    if (sims.length > 65) sims.splice(0, 10); // soft cap
    buildPreview();
}

function launchVolley() {
    if (baseDestroyed) return;
    const p = getParams();
    for (let i = -2; i <= 2; i++) sims.push(initSim({
        ...p,
        theta: p.theta + i * 4,
        v0: p.v0 * (1 + i * .02)
    }));
    if (sims.length > 65) sims.splice(0, Math.max(0, sims.length - 65));
    buildPreview();
}

function reset() {
    sims = [];
    particles = [];
    explosions = [];
    preview = null;
    globalT = 0;
    screenFlash = 0;
    baseDestroyed = false;
    killCount = 0;
    document.getElementById('st-kills').textContent = '0';
    document.getElementById('base-screen').classList.remove('show');
    if (tgt.active) {
        tgt.hit = false;
        tgt.reachedBase = false;
        randomizeTarget();
    }
    ['st-maxh', 'st-range', 'st-time'].forEach(id => document.getElementById(id).textContent = '—');
    ['g-vy', 'g-vx', 'g-hd', 'g-sp'].forEach(id => {
        const c = document.getElementById(id);
        c.getContext('2d').clearRect(0, 0, c.width, c.height);
    });
    // Restore auto-track, clear pause & follow
    manualCam = false;
    paused = false;
    followMode = false;
    followScale = 12;
    document.getElementById('cam-badge').textContent = 'AUTO-TRACK';
    document.getElementById('cam-badge').classList.remove('manual');
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('btn-pause').textContent = '⏸ PAUSE';
    document.getElementById('btn-pause').classList.remove('btn-active');
    document.getElementById('btn-follow').textContent = '▶ FOLLOW ROCKET';
    document.getElementById('btn-follow').classList.remove('btn-active');
    document.getElementById('follow-badge').style.display = 'none';
    buildPreview();
}

function randomizeTarget() {
    tgt.baseX = 115 + Math.random() * 195;
    tgt.baseY = 22 + Math.random() * 60;
    tgt.x = tgt.baseX;
    tgt.y = tgt.baseY;
    tgt.hit = false;
    tgt.reachedBase = false;
    tgt.trail = [];
    if (tgt.mode === 'evasive') {
        const dx = -tgt.baseX,
            dy = -tgt.baseY,
            dist = Math.hypot(dx, dy);
        const speed = 28 + Math.random() * 12;
        tgt.vx = (dx / dist) * speed;
        tgt.vy = (dy / dist) * speed;
    }
}

function respawnEnemy() {
    if (baseDestroyed || tgt.mode !== 'evasive') return;
    tgt.hit = false;
    tgt.reachedBase = false;
    tgt.trail = [];
    tgt.baseX = 115 + Math.random() * 195;
    tgt.baseY = 22 + Math.random() * 60;
    tgt.x = tgt.baseX;
    tgt.y = tgt.baseY;
    const dx = -tgt.baseX,
        dy = -tgt.baseY,
        dist = Math.hypot(dx, dy);
    const speed = Math.min(68, 30 + killCount * 2.5 + Math.random() * 12);
    tgt.vx = (dx / dist) * speed;
    tgt.vy = (dy / dist) * speed;
    document.getElementById('h-status').textContent = 'INCOMING';
}

function toggleSlow() {
    slowMode = !slowMode;
    document.getElementById('btn-slow').classList.toggle('btn-active', slowMode);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('sidebar-toggle');
    const isOpen = sidebar.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
    btn.textContent = isOpen ? '✕ CLOSE' : '☰ CONTROLS';
}

// Close sidebar when tapping the canvas on mobile
canvas.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open') && window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        const btn = document.getElementById('sidebar-toggle');
        btn.classList.remove('open');
        btn.textContent = '☰ CONTROLS';
    }
});

// ══════════════════════════════════════════════
// SLIDER SYNC
// ══════════════════════════════════════════════
[
    ['sl-h0', 'v-h0', v => v + ' m'],
    ['sl-ang', 'v-ang', v => v + '°'],
    ['sl-v0', 'v-v0', v => v + ' m/s'],
    ['sl-bounce', 'v-bounce', v => parseFloat(v).toFixed(2)],
    ['sl-wind', 'v-wind', v => v + ' m/s'],
    ['sl-cd', 'v-cd', v => parseFloat(v).toFixed(2)],
    ['sl-rho', 'v-rho', v => parseFloat(v).toFixed(3)],
    ['sl-g', 'v-g', v => parseFloat(v).toFixed(2) + ' m/s²'],
].forEach(([sid, lid, fmt]) => document.getElementById(sid).addEventListener('input', e => {
    document.getElementById(lid).textContent = fmt(e.target.value);
    buildPreview();
}));

document.getElementById('mission').addEventListener('change', e => {
    const m = e.target.value;
    // keep mobile select in sync
    document.getElementById('mission-mob').value = m;
    tgt.mode = m;
    tgt.active = (m !== 'free');
    tgt.hit = false;
    tgt.reachedBase = false;
    tgt.trail = [];
    const st = document.getElementById('h-status');
    st.textContent = tgt.active ? (m === 'evasive' ? 'INCOMING' : 'LOCKED') : 'NO_TARGET';
    st.style.color = tgt.active ? 'var(--danger)' : 'var(--text-dim)';
    // show/hide auto-aim in both places
    document.getElementById('btn-auto').style.display = tgt.active ? 'block' : 'none';
    document.getElementById('mobile-bar-btn-auto').style.display = tgt.active ? 'block' : 'none';
    if (tgt.active) randomizeTarget();
    buildPreview();
});

document.getElementById('tog-vectors').addEventListener('change', e => {
    document.getElementById('vec-legend').style.display = e.target.checked ? 'flex' : 'none';
});
document.getElementById('tog-preview').addEventListener('change', buildPreview);

const PRESETS = {
    earth: {
        g: 9.81,
        rho: 1.225
    },
    moon: {
        g: 1.62,
        rho: 0
    },
    mars: {
        g: 3.72,
        rho: .02
    },
    jupiter: {
        g: 24.8,
        rho: .16
    },
    vacuum: {
        g: 9.81,
        rho: 0,
        cd: 0,
        wind: 0
    }
};
document.getElementById('preset').addEventListener('change', e => {
    const p = PRESETS[e.target.value];
    if (!p) return;
    if (p.g !== undefined) {
        document.getElementById('sl-g').value = p.g;
        document.getElementById('v-g').textContent = p.g.toFixed(2) + ' m/s²';
    }
    if (p.rho !== undefined) {
        document.getElementById('sl-rho').value = p.rho;
        document.getElementById('v-rho').textContent = p.rho.toFixed(3);
    }
    if (p.cd !== undefined) {
        document.getElementById('sl-cd').value = p.cd;
        document.getElementById('v-cd').textContent = p.cd.toFixed(2);
    }
    if (p.wind !== undefined) {
        document.getElementById('sl-wind').value = p.wind;
        document.getElementById('v-wind').textContent = p.wind + ' m/s';
    }
    buildPreview();
});

document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') {
        e.preventDefault();
        launch();
    }
    if (e.code === 'KeyP') {
        e.preventDefault();
        togglePause();
    }
    if (e.code === 'KeyF') {
        e.preventDefault();
        toggleFollow();
    }
});

// ══════════════════════════════════════════════
// SIDEBAR RESIZE (desktop: drag right edge; mobile: drag top handle)
// ══════════════════════════════════════════════
(function initResize() {
    const mainEl = document.querySelector('.main');
    const resizer = document.getElementById('sidebar-resizer');
    const sidebarEl = document.getElementById('sidebar');
    const handle = document.getElementById('drawer-handle');

    // ── Desktop: horizontal resize ──
    let desktopDragging = false,
        startX = 0,
        startW = 0;

    resizer.addEventListener('mousedown', e => {
        desktopDragging = true;
        startX = e.clientX;
        startW = sidebarEl.getBoundingClientRect().width;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', e => {
        if (!desktopDragging) return;
        const delta = e.clientX - startX;
        const newW = Math.min(520, Math.max(160, startW + delta));
        mainEl.style.gridTemplateColumns = `${newW}px 8px 1fr`;
    });

    window.addEventListener('mouseup', () => {
        if (!desktopDragging) return;
        desktopDragging = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    // ── Mobile: vertical drawer resize ──
    let mobileDragging = false,
        startY = 0,
        startH = 0;
    const isMobile = () => window.innerWidth <= 768;

    function getDrawerH() {
        return sidebarEl.getBoundingClientRect().height;
    }

    handle.addEventListener('mousedown', e => {
        if (!isMobile()) return;
        mobileDragging = true;
        startY = e.clientY;
        startH = getDrawerH();
        handle.classList.add('dragging');
        sidebarEl.classList.add('resizing');
        document.body.style.userSelect = 'none';
    });

    handle.addEventListener('touchstart', e => {
        if (!isMobile()) return;
        mobileDragging = true;
        startY = e.touches[0].clientY;
        startH = getDrawerH();
        handle.classList.add('dragging');
        sidebarEl.classList.add('resizing');
    }, {
        passive: true
    });

    window.addEventListener('mousemove', e => {
        if (!mobileDragging) return;
        // dragging UP increases height (clientY decreases)
        const delta = startY - e.clientY;
        const vh = window.innerHeight;
        const newH = Math.min(vh * 0.92, Math.max(100, startH + delta));
        sidebarEl.style.height = newH + 'px';
    });

    window.addEventListener('touchmove', e => {
        if (!mobileDragging) return;
        const delta = startY - e.touches[0].clientY;
        const vh = window.innerHeight;
        const newH = Math.min(vh * 0.92, Math.max(100, startH + delta));
        sidebarEl.style.height = newH + 'px';
    }, {
        passive: true
    });

    function endMobileDrag() {
        if (!mobileDragging) return;
        mobileDragging = false;
        handle.classList.remove('dragging');
        sidebarEl.classList.remove('resizing');
        document.body.style.userSelect = '';
    }
    window.addEventListener('mouseup', endMobileDrag);
    window.addEventListener('touchend', endMobileDrag);
})();
(function run() {
    if (!paused) {
        if (!baseDestroyed) {
            globalT += DT * (slowMode ? 1 : 3);
            if (tgt.active && tgt.mode === 'intercept') {
                tgt.x = tgt.baseX;
                tgt.y = tgt.baseY;
            }
            stepEnemy();
            sims.forEach(s => stepSim(s));
            updateParticles();
            updateExplosions();
        } else {
            updateParticles();
            updateExplosions();
            if (screenFlash > 0.01) screenFlash *= 0.7;
        }
    }
    updateCamera();
    render();
    if (!paused) updateGraphs();
    requestAnimationFrame(run);
})();

buildPreview();