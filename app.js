// ===== STAGE NAMES (all 11 stages) =====
const STAGE_NAMES = [
  'Initial Test Definition',
  'Test Procedure Discussions',
  'Test Procedure Creation',
  'Firmware Coding',
  'Automation Steps',
  'Testing on Silicon',
  'Results Review',
  'Design Expectations Check',
  'Report & Documentation',
  'Feedback to Architect',
  'Publish Data Sheet'
];

const STAGE_ICONS = ['📝','💬','🔧','💾','⚙️','🧪','🔍','✅','📄','🔁','📊'];

// ===== MAIN INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
});

async function loadDashboard() {
  let data;
  try {
    const res = await fetch('output.json');
    if (!res.ok) throw new Error('output.json not found');
    data = await res.json();
  } catch (err) {
    showNoData();
    return;
  }
  renderHero(data.currentPosition);
  renderPipeline(data.stages);
  renderDetails(data.stages);
  renderBlockers(data.blockers);
  renderNextStep(data.nextStep);
  document.getElementById('headerSubtitle').textContent = 'Real-time workflow analysis powered by AI';
}

// ===== NO DATA STATE =====
function showNoData() {
  document.getElementById('headerSubtitle').textContent = 'No analysis data found';
  document.getElementById('heroSection').innerHTML = `
    <div class="no-data">
      <div class="no-data-icon">📂</div>
      <p>No <code>output.json</code> found. Run <code>node analyze_workflow.js</code> first.</p>
    </div>
  `;
}

// ===== HERO =====
function renderHero(pos) {
  document.getElementById('heroStage').textContent = `Stage ${pos.stageNumber}: ${pos.stageName}`;
  document.getElementById('heroSummary').textContent = pos.summary;
}

// ===== PIPELINE =====
function renderPipeline(stages) {
  const pipeline = document.getElementById('pipeline');
  pipeline.innerHTML = '';

  stages.forEach((stage, i) => {
    // Node
    const node = document.createElement('div');
    node.className = `pipeline-node node--${stage.status} stagger-${i + 1}`;
    node.style.animation = `fadeSlideUp 0.5s ease ${i * 0.08}s both`;

    const circle = document.createElement('div');
    circle.className = 'node-circle';
    circle.textContent = stage.stageNumber;

    const label = document.createElement('div');
    label.className = 'node-label';
    label.textContent = STAGE_NAMES[i] || stage.stageName;

    node.appendChild(circle);
    node.appendChild(label);

    // Tooltip interaction
    node.addEventListener('mouseenter', (e) => showTooltip(e, stage, i));
    node.addEventListener('mousemove', (e) => moveTooltip(e));
    node.addEventListener('mouseleave', hideTooltip);

    pipeline.appendChild(node);

    // Connector (except after last)
    if (i < stages.length - 1) {
      const connector = document.createElement('div');
      connector.className = 'pipeline-connector';

      const currentActive = stage.status === 'active' || stage.status === 'completed';
      const nextActive = stages[i + 1].status === 'active' || stages[i + 1].status === 'completed';

      if (currentActive && nextActive) {
        connector.classList.add('connector--completed');
      } else if (currentActive) {
        connector.classList.add('connector--active');
      } else {
        connector.classList.add('connector--upcoming');
      }

      pipeline.appendChild(connector);
    }
  });
}

// ===== TOOLTIP =====
function showTooltip(e, stage, index) {
  const tooltip = document.getElementById('tooltip');
  const header = document.getElementById('tooltipHeader');
  const body = document.getElementById('tooltipBody');

  const statusColors = {
    active: 'badge--active',
    completed: 'badge--completed',
    upcoming: 'badge--upcoming',
    blocked: 'badge--blocked'
  };

  const statusLabels = {
    active: '🔥 ACTIVE',
    completed: '✅ COMPLETED',
    upcoming: '⏳ UPCOMING',
    blocked: '🚫 BLOCKED'
  };

  header.innerHTML = `
    <span class="tooltip-badge ${statusColors[stage.status]}">${statusLabels[stage.status]}</span>
    <div style="margin-top:6px;">${STAGE_ICONS[index]} Stage ${stage.stageNumber}: ${STAGE_NAMES[index]}</div>
  `;

  if (stage.tasks && stage.tasks.length > 0) {
    body.innerHTML = `<div style="margin-bottom:6px;color:var(--text-muted);font-size:0.7rem;">${stage.taskCount} task(s)</div>` +
      stage.tasks.map(t => `
        <div class="tooltip-task">
          <div class="tooltip-task-name">${t.name}</div>
          <div class="tooltip-task-assignee">👤 ${t.assignee}</div>
          ${t.detail ? `<div style="color:var(--text-muted);font-size:0.7rem;margin-top:2px;">${t.detail}</div>` : ''}
        </div>
      `).join('');
  } else {
    body.innerHTML = `<div style="color:var(--text-muted);">No tasks in this stage.</div>`;
  }

  tooltip.classList.add('visible');
  moveTooltip(e);
}

function moveTooltip(e) {
  const tooltip = document.getElementById('tooltip');
  const pad = 16;
  let x = e.clientX + pad;
  let y = e.clientY + pad;

  // Keep tooltip in viewport
  const rect = tooltip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - pad) {
    x = e.clientX - rect.width - pad;
  }
  if (y + rect.height > window.innerHeight - pad) {
    y = e.clientY - rect.height - pad;
  }

  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

function hideTooltip() {
  document.getElementById('tooltip').classList.remove('visible');
}

// ===== DETAILS GRID =====
function renderDetails(stages) {
  const grid = document.getElementById('detailsGrid');
  grid.innerHTML = '';

  const activeStages = stages.filter(s => s.taskCount > 0);

  if (activeStages.length === 0) {
    grid.innerHTML = '<div class="no-data"><p>No active stages with tasks.</p></div>';
    return;
  }

  activeStages.forEach((stage, i) => {
    const card = document.createElement('div');
    card.className = 'detail-card';
    card.dataset.status = stage.status;
    card.style.animationDelay = `${0.15 + i * 0.1}s`;

    const stageIndex = stage.stageNumber - 1;

    card.innerHTML = `
      <div class="detail-card-header">
        <span class="detail-stage-name">${STAGE_ICONS[stageIndex]} Stage ${stage.stageNumber}: ${STAGE_NAMES[stageIndex]}</span>
        <span class="detail-task-count">${stage.taskCount} task${stage.taskCount > 1 ? 's' : ''}</span>
      </div>
      ${stage.tasks.map(t => `
        <div class="detail-task-item">
          <div class="detail-task-name">${t.name}</div>
          <div class="detail-task-meta">
            <span class="detail-task-assignee">👤 ${t.assignee}</span>
            ${t.detail ? `<span class="detail-task-detail">${t.detail}</span>` : ''}
          </div>
        </div>
      `).join('')}
    `;

    grid.appendChild(card);
  });
}

// ===== BLOCKERS =====
function renderBlockers(blockers) {
  const section = document.getElementById('blockersSection');
  const list = document.getElementById('blockersList');

  if (!blockers || blockers.length === 0) {
    section.style.display = 'none';
    return;
  }

  list.innerHTML = '';

  blockers.forEach((b, i) => {
    const card = document.createElement('div');
    card.className = `blocker-card severity-${b.severity}`;
    card.style.animationDelay = `${0.2 + i * 0.12}s`;

    const icons = { high: '🔴', medium: '🟡', low: '⚪' };

    card.innerHTML = `
      <div class="blocker-icon">${icons[b.severity] || '⚠️'}</div>
      <div class="blocker-content">
        <div class="blocker-task">${b.task}</div>
        <div class="blocker-reason">${b.reason}</div>
      </div>
      <span class="blocker-severity severity-${b.severity}">${b.severity}</span>
    `;

    list.appendChild(card);
  });
}

// ===== NEXT STEP =====
function renderNextStep(nextStep) {
  document.getElementById('nextStepText').textContent = nextStep || 'No next step defined.';
}
