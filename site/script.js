// ─── Tab switching ───────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const panel = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.install-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`[data-panel="${panel}"]`).classList.add('active');
  });
});

// ─── Copy button ─────────────────────────────────────────────
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const text = btn.dataset.copy || btn.closest('.code-block').querySelector('pre').textContent;
    navigator.clipboard.writeText(text.trim()).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.style.color = '#00E87A';
      setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
    });
  });
});

// ─── Hero background network ──────────────────────────────────
(function heroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, nodes, animId;

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }

  function initNodes(count = 28) {
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.8 + 0.8,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 200) {
          const alpha = (1 - dist / 200) * 0.3;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(255,85,0,${alpha})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }

    nodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,85,0,0.5)';
      ctx.fill();
    });

    nodes.forEach(n => {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
    });

    animId = requestAnimationFrame(draw);
  }

  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(animId);
    resize();
    initNodes();
    draw();
  });
  ro.observe(canvas.parentElement);
  resize(); initNodes(); draw();
})();

// ─── Swarm Animation ──────────────────────────────────────────
(function swarmAnimation() {
  const canvas = document.getElementById('swarm-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // DOM refs
  const elMission   = document.getElementById('s-mission');
  const elStatus    = document.getElementById('s-status');
  const elAgents    = document.getElementById('s-agents');
  const elMessages  = document.getElementById('s-messages');
  const elCompleted = document.getElementById('s-completed');
  const elProgress  = document.getElementById('s-progress');
  const elStep      = document.getElementById('s-step');

  // Role definitions
  const ROLES = {
    PLANNER:    { color: '#FF5500', glow: 'rgba(255,85,0,0.4)',   r: 6,   label: 'PLANNER' },
    RESEARCHER: { color: '#6B8CFF', glow: 'rgba(107,140,255,0.3)', r: 4.5, label: 'RESEARCHER' },
    EXECUTOR:   { color: '#00E87A', glow: 'rgba(0,232,122,0.3)',  r: 4.5, label: 'EXECUTOR' },
    REVIEWER:   { color: '#B57BFF', glow: 'rgba(181,123,255,0.3)',r: 4,   label: 'REVIEWER' },
    WORKER:     { color: '#3a3a3a', glow: 'rgba(100,100,100,0.2)',r: 3,   label: 'WORKER' },
  };

  const MISSIONS = [
    'ANALYZE AI TRENDS 2025',
    'RESEARCH QUANTUM COMPUTING',
    'SYNTHESIZE CLIMATE DATA',
    'MAP PROTEIN STRUCTURES',
    'AUDIT CODEBASE SECURITY',
    'COMPILE RESEARCH PAPERS',
  ];

  let W, H;
  let nodes = [];
  let messages = [];
  let phase = 'idle';
  let phaseTimer = 0;
  let totalMessages = 0;
  let totalCompleted = 0;
  let missionProgress = 0;
  let currentMission = '';
  let activeNodes = [];
  let animId;

  const PHASES = ['idle', 'summon', 'assemble', 'execute', 'review', 'complete'];
  const PHASE_MS = {
    idle:     3500,
    summon:   1500,
    assemble: 2000,
    execute:  6000,
    review:   2000,
    complete: 1200,
  };

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    W = canvas.width  = rect.width;
    H = canvas.height = rect.height;
  }

  function createNode(role, x, y) {
    return {
      x: x ?? Math.random() * W,
      y: y ?? Math.random() * H,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      targetX: null,
      targetY: null,
      role,
      active: false,
      pulse: Math.random() * Math.PI * 2,
      opacity: 1,
    };
  }

  function initNodes() {
    nodes = [];
    // 1 planner
    nodes.push(createNode('PLANNER'));
    // 8 researchers
    for (let i = 0; i < 8; i++) nodes.push(createNode('RESEARCHER'));
    // 10 executors
    for (let i = 0; i < 10; i++) nodes.push(createNode('EXECUTOR'));
    // 6 reviewers
    for (let i = 0; i < 6; i++) nodes.push(createNode('REVIEWER'));
    // 20 workers
    for (let i = 0; i < 20; i++) nodes.push(createNode('WORKER'));
  }

  function spawnMessage(from, to) {
    messages.push({
      x: from.x, y: from.y,
      tx: to.x,  ty: to.y,
      progress: 0,
      color: ROLES[from.role].color,
      speed: 0.008 + Math.random() * 0.008,
    });
    totalMessages++;
  }

  function setPhase(p) {
    phase = p;
    phaseTimer = PHASE_MS[p];
    updatePanel();
  }

  function updatePanel() {
    const active = nodes.filter(n => n.active).length;
    if (elAgents)    elAgents.textContent    = `${active} / ${nodes.length}`;
    if (elMessages)  elMessages.textContent  = totalMessages.toLocaleString();
    if (elCompleted) elCompleted.textContent = totalCompleted;
    if (elStatus) {
      const labels = {
        idle: 'STANDBY', summon: 'SUMMONING', assemble: 'ASSEMBLING',
        execute: 'EXECUTING', review: 'REVIEWING', complete: 'COMPLETE',
      };
      elStatus.textContent = labels[phase] || phase.toUpperCase();
      elStatus.style.color = phase === 'execute' ? '#FF5500' :
                             phase === 'complete' ? '#00E87A' :
                             phase === 'idle'     ? '#444'    : '#6B8CFF';
    }
    if (elMission) elMission.textContent = phase === 'idle' ? 'IDLE' : currentMission;

    const progMap = { idle: 0, summon: 5, assemble: 20, execute: 70, review: 90, complete: 100 };
    if (elProgress) elProgress.style.width = (progMap[phase] ?? 0) + '%';

    const stepMap = {
      idle: '—', summon: 'RECRUITING AGENTS', assemble: 'FORMING CLUSTER',
      execute: 'PROCESSING TASKS', review: 'REVIEWING RESULTS', complete: 'MISSION COMPLETE',
    };
    if (elStep) elStep.textContent = stepMap[phase] || '—';
  }

  function pickActiveNodes() {
    // Randomly pick some researchers, executors, reviewers to participate
    const researchers = nodes.filter(n => n.role === 'RESEARCHER');
    const executors   = nodes.filter(n => n.role === 'EXECUTOR');
    const reviewers   = nodes.filter(n => n.role === 'REVIEWER');
    const planner     = nodes.find(n => n.role === 'PLANNER');

    const shuffle = arr => arr.sort(() => Math.random() - 0.5);

    activeNodes = [
      planner,
      ...shuffle(researchers).slice(0, 4 + Math.floor(Math.random() * 3)),
      ...shuffle(executors).slice(0, 4 + Math.floor(Math.random() * 4)),
      ...shuffle(reviewers).slice(0, 2 + Math.floor(Math.random() * 3)),
    ];
  }

  function setClusterTargets() {
    // Cluster around center
    const cx = W * 0.5;
    const cy = H * 0.48;
    const r  = Math.min(W, H) * 0.22;

    activeNodes.forEach((n, i) => {
      const angle = (i / activeNodes.length) * Math.PI * 2;
      const jitter = (i === 0) ? 0 : (0.3 + Math.random() * 0.7);
      n.targetX = cx + Math.cos(angle) * r * jitter;
      n.targetY = cy + Math.sin(angle) * r * jitter;
      n.active  = true;
    });
  }

  function disperseNodes() {
    nodes.forEach(n => {
      n.active  = false;
      n.targetX = null;
      n.targetY = null;
    });
    activeNodes = [];
  }

  let lastTime = 0;

  function loop(now) {
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;

    phaseTimer -= dt;

    // Phase transitions
    if (phaseTimer <= 0) {
      const idx = PHASES.indexOf(phase);
      const next = PHASES[(idx + 1) % PHASES.length];
      if (next === 'summon') {
        currentMission = MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
        pickActiveNodes();
      }
      if (next === 'assemble') {
        setClusterTargets();
      }
      if (next === 'complete') {
        totalCompleted++;
      }
      if (next === 'idle') {
        disperseNodes();
        messages = [];
      }
      setPhase(next);
    }

    // Spawn messages during execute/review
    if ((phase === 'execute' || phase === 'review') && Math.random() < 0.12) {
      const src = activeNodes[Math.floor(Math.random() * activeNodes.length)];
      const dst = activeNodes[Math.floor(Math.random() * activeNodes.length)];
      if (src && dst && src !== dst) spawnMessage(src, dst);
    }

    // Update messages
    messages = messages.filter(m => {
      m.progress += m.speed;
      m.x = m.x + (m.tx - m.x) * m.speed * 8;
      m.y = m.y + (m.ty - m.y) * m.speed * 8;
      return m.progress < 1;
    });

    // Update nodes
    nodes.forEach(n => {
      n.pulse += 0.04;
      if (n.targetX !== null) {
        const ex = n.targetX - n.x;
        const ey = n.targetY - n.y;
        n.vx = n.vx * 0.85 + ex * 0.04;
        n.vy = n.vy * 0.85 + ey * 0.04;
      } else {
        // Gentle drift with boundary bounce
        n.vx += (Math.random() - 0.5) * 0.05;
        n.vy += (Math.random() - 0.5) * 0.05;
        n.vx *= 0.97;
        n.vy *= 0.97;
        // Repel from edges
        if (n.x < 60)  n.vx += 0.3;
        if (n.x > W - 60) n.vx -= 0.3;
        if (n.y < 60)  n.vy += 0.3;
        if (n.y > H - 60) n.vy -= 0.3;
      }
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(8, Math.min(W - 8, n.x));
      n.y = Math.max(8, Math.min(H - 8, n.y));
    });

    // Update panel counters
    if (elMessages)  elMessages.textContent  = totalMessages.toLocaleString();
    if (elCompleted) elCompleted.textContent = totalCompleted;
    if (elAgents)    elAgents.textContent    = `${activeNodes.length} / ${nodes.length}`;

    draw();
    animId = requestAnimationFrame(loop);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Draw edges between active nodes
    if (phase === 'assemble' || phase === 'execute' || phase === 'review' || phase === 'complete') {
      const edgeAlpha = phase === 'complete' ? 0.6 : 0.18;
      for (let i = 0; i < activeNodes.length; i++) {
        for (let j = i + 1; j < activeNodes.length; j++) {
          const a = activeNodes[i];
          const b = activeNodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 200) {
            const alpha = (1 - dist / 200) * edgeAlpha;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(255,85,0,${alpha})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }
    }

    // Background worker edges (very faint)
    if (phase === 'idle') {
      for (let i = 0; i < nodes.length; i += 2) {
        for (let j = i + 1; j < nodes.length; j += 2) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 120) {
            const alpha = (1 - dist / 120) * 0.05;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    }

    // Draw messages
    messages.forEach(m => {
      // Trail
      ctx.beginPath();
      ctx.arc(m.x, m.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Draw nodes
    nodes.forEach(n => {
      const role = ROLES[n.role];
      const baseR = role.r;
      const isActive = n.active;
      const pulseFactor = isActive ? 1 + Math.sin(n.pulse) * 0.25 : 1;
      const r = baseR * pulseFactor;

      // Glow for active nodes
      if (isActive && (phase === 'execute' || phase === 'review' || phase === 'complete')) {
        const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3.5);
        grd.addColorStop(0, role.glow);
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 3.5, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      }

      // Planner orbit ring during summon
      if (n.role === 'PLANNER' && phase === 'summon') {
        const orbitR = 18 + Math.sin(n.pulse * 2) * 4;
        ctx.beginPath();
        ctx.arc(n.x, n.y, orbitR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,85,0,0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Node body
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      const alpha = isActive ? 1 : (n.role === 'WORKER' ? 0.4 : 0.55);
      ctx.fillStyle = role.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.fill();

      // Active ring
      if (isActive) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = role.color + '66';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Role label for active major nodes
      if (isActive && n.role !== 'WORKER' && (phase === 'execute' || phase === 'review')) {
        ctx.font = '9px Space Mono, monospace';
        ctx.fillStyle = role.color + 'bb';
        ctx.fillText(role.label, n.x + r + 5, n.y + 3);
      }
    });

    // Complete flash
    if (phase === 'complete') {
      const progress = 1 - phaseTimer / PHASE_MS.complete;
      const alpha = Math.sin(progress * Math.PI) * 0.08;
      ctx.fillStyle = `rgba(0,232,122,${alpha})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  const ro = new ResizeObserver(() => {
    const prevW = W;
    resize();
    if (nodes.length === 0 || prevW === 0) initNodes();
  });
  ro.observe(canvas.parentElement);

  resize();
  initNodes();
  setPhase('idle');
  animId = requestAnimationFrame(loop);
})();

// ─── Nav scroll effect ────────────────────────────────────────
const nav = document.querySelector('nav');
window.addEventListener('scroll', () => {
  if (window.scrollY > 40) {
    nav.style.background = 'rgba(8,8,8,0.96)';
  } else {
    nav.style.background = 'rgba(8,8,8,0.8)';
  }
}, { passive: true });

// ─── Intersection fade-in ─────────────────────────────────────
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.style.opacity = '1';
      e.target.style.transform = 'translateY(0)';
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll('.feature-card, .how-step, .stat').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(16px)';
  el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  io.observe(el);
});
