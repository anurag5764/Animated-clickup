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

// ===== TEAM CONFIG =====
const TEAM_FILES = {
  ps:  'output_ps.json',
  ams: 'output_ams.json',
  rtl: 'output_rtl.json'
};

const teamDataCache = {};
let activeTeam = 'ps';

// ===== MAIN INIT =====
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  loadTeam('ps');
});

// ===== TAB HANDLING =====
function setupTabs() {
  const tabs = document.querySelectorAll('.team-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const team = tab.dataset.team;
      if (team === activeTeam) return;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTeam = team;
      loadTeam(team);
    });
  });
}

// ===== LOAD TEAM DATA =====
async function loadTeam(team) {
  if (teamDataCache[team]) {
    renderPipeline(teamDataCache[team].stages);
    return;
  }

  try {
    const res = await fetch(TEAM_FILES[team]);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    teamDataCache[team] = data;
    renderPipeline(data.stages);
  } catch (err) {
    document.getElementById('pipeline').innerHTML = `
      <div class="no-data">
        <div class="no-data-icon">📂</div>
        <p>No data for this team yet.<br>Run <code>node member.js</code> then <code>node analyze_workflow.js</code></p>
      </div>`;
  }
}

// ===== PIPELINE =====
function renderPipeline(stages) {
  const pipeline = document.getElementById('pipeline');
  pipeline.innerHTML = '';

  stages.forEach((stage, i) => {
    const node = document.createElement('div');
    node.className = `pipeline-node node--${stage.status}`;
    node.style.animation = `fadeSlideUp 0.5s ease ${i * 0.08}s both`;

    const circle = document.createElement('div');
    circle.className = 'node-circle';
    circle.textContent = stage.stageNumber;

    const label = document.createElement('div');
    label.className = 'node-label';
    label.textContent = STAGE_NAMES[i] || stage.stageName;

    node.appendChild(circle);
    node.appendChild(label);

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
